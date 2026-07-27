import { useState, useMemo, useEffect, Fragment } from "react";
import { useExplorer } from "../../store/useExplorer";

// ── Estilos por tipo ──────────────────────────────────────────────────────────
const TYPE_STYLE = {
  banner:      { label: "text-[13px] font-bold text-white uppercase tracking-widest",   num: "text-white font-bold text-[13px]" },
  cuenca:      { label: "text-[13px] font-bold text-white uppercase tracking-widest",   num: "text-white font-bold text-[13px]" },
  ubicacion:   { label: "text-[13px] font-bold text-white uppercase tracking-widest",   num: "text-white font-bold text-[13px]" },
  planheader:  { label: "text-[13.5px] font-bold pl-2",                                  num: "font-bold text-[13.5px]" },
  total:       { label: "text-[13.5px] font-bold text-teal-700 pl-4",                   num: "text-teal-700 font-bold text-[13.5px]" },
  subtotal:    { label: "text-[13px] font-semibold text-teal-600 pl-6",                 num: "text-teal-600 font-semibold text-[13px]" },
  operator:    { label: "text-[12.5px] text-slate-600 pl-8",                            num: "text-slate-600 text-[12.5px]" },
  planoperator:{ label: "text-[12.5px] text-slate-600 pl-4",                            num: "text-slate-600 text-[12.5px]" },
  totaloperator:{ label: "text-[12.5px] font-bold text-teal-700 pl-8",                  num: "text-teal-700 font-bold text-[12.5px]" },
};

const ROW_BG = {
  banner:      null,
  cuenca:      null,
  ubicacion:   "border-b border-slate-300",
  planheader:  "border-b border-teal-200",
  total:       "bg-teal-50/70 border-b border-teal-100",
  subtotal:    "bg-white border-b border-slate-100",
  operator:    "bg-white border-b border-slate-50 hover:bg-slate-50/80 transition-colors",
  planoperator:"bg-white border-b border-slate-50 hover:bg-slate-50/80 transition-colors",
  totaloperator:"bg-teal-50/40 border-b border-slate-100 hover:bg-teal-50/70 transition-colors",
};

// ── Tonos por nivel de anidamiento (Ambiente → Cuenca → Tipo/Categoría) ───────
// Cada nivel de "planheader" usa un tono distinto para que la jerarquía se lea
// de un vistazo, en vez de que todos los niveles se vean con el mismo verde.
const PLANHEADER_TONES = [
  { bg: "#ccfbf1", border: "#2dd4bf", text: "#0f766e" },
  { bg: "#dbeafe", border: "#60a5fa", text: "#1d4ed8" },
  { bg: "#fef3c7", border: "#fbbf24", text: "#92400e" },
  { bg: "#fae8ff", border: "#e879f9", text: "#a21caf" },
];

// ── Tipos que tienen chevron y son colapsables ────────────────────────────────
const COLLAPSIBLE = new Set(["ubicacion", "planheader"]);

// ── Inicializar grupos abiertos según el modo ─────────────────────────────────
function initOpenGroups(resultado, groupBy) {
  const init = new Set();
  if (!resultado?.groups) return init;

  if (!groupBy || groupBy === "operador") {
    // Vista general: abrir Nacional|Nacional
    init.add("Nacional|Nacional");
  }
  if (groupBy === "cuenca") {
    for (const g of resultado.groups) {
      if (g.cuenca !== "Nacional") init.add(`cuenca|${g.cuenca}`);
    }
  }
  if (groupBy === "ubicacion") {
    const nac = resultado.groups.find(g => g.cuenca === "Nacional");
    for (const sg of nac?.subgroups ?? []) {
      if (sg.ubicacion !== "Nacional") init.add(`ub|${sg.ubicacion}`);
    }
  }
  if (groupBy === "plan") {
    const nac = resultado.groups.find(g => g.cuenca === "Nacional");
    const nacSg = nac?.subgroups?.find(sg => sg.ubicacion === "Nacional");
    for (const row of nacSg?.rows ?? []) {
      if (row.type === "subtotal") init.add(`plan|${row.label}`);
    }
  }
  return init;
}

// Devuelve true si la fila tiene al menos un valor > 0
function hasData(dataArr) {
  return dataArr?.some(v => v != null && v !== 0);
}

// Filas de operadores de un subgrupo. Sin divisiones: junta los operadores
// repetidos entre categorías (Desarrollo/Exploración/etc.) sumando sus
// valores en vez de mostrar al mismo operador varias veces.
function pushOperatorRows(rows, sgRows, gk, cuenca, ubicacion, cats, hideDivisions, groupBy, vis, q, forceDivisions) {
  if (hideDivisions) {
    let totalRow = null;
    const merged = new Map();
    for (const row of sgRows) {
      if (row.type !== "operator") continue;
      if (row.label === "Todos los operadores") { totalRow = row; continue; }
      if (!merged.has(row.label)) {
        merged.set(row.label, { label: row.label, data: row.data.map(v => v ?? 0) });
      } else {
        const acc = merged.get(row.label);
        acc.data = acc.data.map((v, ci) => v + (row.data[ci] ?? 0));
      }
    }
    if (totalRow) {
      rows.push({
        _id: `r|${gk}|Total`, _type: "totaloperator",
        _cuenca: cuenca, _ub: ubicacion, label: "Total",
        ...Object.fromEntries(cats.map((c, ci) => [c, totalRow.data[ci] ?? 0])),
      });
    }
    let visible = [...merged.values()];
    visible = groupBy === "operador" ? visible.filter(o => vis[o.label] !== false) : visible;
    visible = visible.filter(o => hasData(o.data));
    if (q) visible = visible.filter(o => o.label.toLowerCase().includes(q));
    for (const op of visible) {
      rows.push({
        _id: `r|${gk}|${op.label}`, _type: "operator",
        _cuenca: cuenca, _ub: ubicacion, label: op.label,
        ...Object.fromEntries(cats.map((c, ci) => [c, op.data[ci] ?? 0])),
      });
    }
    return;
  }

  let i = 0; let parentLabel = "";
  while (i < sgRows.length) {
    const row = sgRows[i];
    if (row.type !== "operator") {
      parentLabel = row.label;
      // Con forceDivisions el subtotal ES el producto que controlan los chips
      // de series: se oculta el bloque entero si está apagado.
      const skipGroup = forceDivisions && vis[row.label] === false;
      // El header "Total (Pozos)" es redundante con la fila "Total" de abajo.
      if (row.type !== "total" && !skipGroup) {
        rows.push({
          _id: `r|${gk}|${row.label}`, _type: row.type,
          _cuenca: cuenca, _ub: ubicacion, label: row.label,
          ...Object.fromEntries(cats.map((c, ci) => [c, row.data[ci] ?? 0])),
        });
      }
      i++;
      const ops = [];
      while (i < sgRows.length && sgRows[i].type === "operator") { ops.push(sgRows[i]); i++; }
      if (skipGroup) continue;
      let visible = groupBy === "operador" ? ops.filter(o => vis[o.label] !== false) : ops;
      visible = visible.filter(o => hasData(o.data));
      if (q) visible = visible.filter(o => o.label.toLowerCase().includes(q));
      for (const op of visible) {
        const isTotalRow = op.label === "Todos los operadores";
        rows.push({
          _id: `r|${gk}|${parentLabel}|${op.label}`, _type: isTotalRow ? "totaloperator" : "operator",
          _cuenca: cuenca, _ub: ubicacion, label: isTotalRow ? "Total" : op.label,
          ...Object.fromEntries(cats.map((c, ci) => [c, op.data[ci] ?? 0])),
        });
      }
    } else { i++; }
  }
}

// Fusiona uno o más subgrupos en un total + lista de operadores únicos
// (fusionados a través de categorías/ambientes, cada operador aparece una vez).
function mergeSubgroups(subgroups, cats) {
  const total = cats.map(() => 0);
  const merged = new Map();
  for (const sg of subgroups) {
    for (const row of sg.rows) {
      if (row.type !== "operator") continue;
      if (row.label === "Todos los operadores") {
        row.data.forEach((v, ci) => { total[ci] += v ?? 0; });
        continue;
      }
      if (!merged.has(row.label)) merged.set(row.label, { label: row.label, data: cats.map(() => 0) });
      const acc = merged.get(row.label);
      row.data.forEach((v, ci) => { acc.data[ci] += v ?? 0; });
    }
  }
  return { total, ops: [...merged.values()] };
}

// Agrupación multinivel (AND de filtros): Ambiente → Cuenca → Categoría → Operador.
// Solo se anida por dimensiones con filtro activo; el backend ya aplica el AND,
// aquí solo se re-organiza el desglose.
const HIER_LEVELS = [
  { key: "ubicacion", filter: "ubicaciones", of: l => l.ubicacion },
  { key: "cuenca",    filter: "cuencas",     of: l => l.cuenca },
  { key: "categoria", filter: "categorias",  of: l => l.categoria },
];

// Extrae registros hoja {cuenca, ubicacion, categoria, operator, data} de las
// cuencas reales (no Nacional), que traen el desglose completo.
function extractLeaves(resultado) {
  const leaves = [];
  for (const g of resultado.groups ?? []) {
    if (g.cuenca === "Nacional") continue;
    for (const sg of g.subgroups ?? []) {
      let cat = null;
      for (const row of sg.rows) {
        if (row.type === "subtotal") { cat = row.label; continue; }
        if (row.type === "total")    { cat = null; continue; }
        if (row.type === "operator") {
          if (row.label === "Todos los operadores" || cat == null) continue;
          leaves.push({ cuenca: g.cuenca, ubicacion: sg.ubicacion, categoria: cat, operator: row.label, data: row.data });
        }
      }
    }
  }
  return leaves;
}

function sumLeaves(list, cats) {
  const t = cats.map(() => 0);
  for (const lf of list) lf.data.forEach((v, i) => { t[i] += v ?? 0; });
  return t;
}

const dataObj = (cats, arr) => Object.fromEntries(cats.map((c, i) => [c, arr[i]]));

function activeHierLevels(perfFiltros) {
  return HIER_LEVELS.filter(lv => (perfFiltros?.[lv.filter]?.length ?? 0) > 0);
}

function flattenMultiLevel(resultado, perfFiltros, openGroups, search, vis, forceDivisions) {
  const cats = resultado.categories;
  const q = search.trim().toLowerCase();
  const levels = activeHierLevels(perfFiltros);
  const leaves = extractLeaves(resultado);
  const rows = [];

  // Se omite el total con forceDivisions: ahí las categorías tienen unidades
  // distintas (Mbd, MMpcd) y sumarlas no tiene sentido.
  rows.push({ _id: "banner|Nacional", _type: "banner", label: "Nacional", ...dataObj(cats, cats.map(() => null)) });
  if (!forceDivisions) {
    rows.push({ _id: "total|Nacional", _type: "total", label: "Total", ...dataObj(cats, sumLeaves(leaves, cats)) });
  }

  function renderOperators(bucket, key, indentDepth) {
    const merged = new Map();
    for (const lf of bucket) {
      if (!merged.has(lf.operator)) merged.set(lf.operator, cats.map(() => 0));
      const acc = merged.get(lf.operator);
      lf.data.forEach((v, i) => { acc[i] += v ?? 0; });
    }
    let ops = [...merged].map(([label, data]) => ({ label, data }));
    ops = ops.filter(o => hasData(o.data) && (!q || o.label.toLowerCase().includes(q)));
    ops.sort((a, b) => a.label.localeCompare(b.label));
    for (const op of ops) {
      rows.push({
        _id: `o|${key}|${op.label}`, _type: "planoperator", _indent: 12 + indentDepth * 18 + 6,
        label: op.label, ...dataObj(cats, op.data),
      });
    }
  }

  // Si un nivel solo tiene un valor posible, no aporta mostrarlo en su propia
  // fila (repetiría el número de su padre): se combina su nombre con el del
  // siguiente nivel real ("Aguas someras · Cuencas del Sureste · Desarrollo").
  const walk = (subLeaves, levelIdx, pathKey, depth, applyVis, pendingLabels) => {
    const lv = levels[levelIdx];
    const buckets = new Map();
    for (const lf of subLeaves) {
      const k = lv.of(lf);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(lf);
    }
    const entries = [...buckets].sort((a, b) => a[0].localeCompare(b[0]));
    const isSingleton = entries.length === 1;

    for (const [name, bucket] of entries) {
      if (applyVis && vis[name] === false) continue;
      const key = `${pathKey}/${name}`;

      const bucketTotal = sumLeaves(bucket, cats);
      if (!hasData(bucketTotal)) continue;

      if (isSingleton) {
        const nextPending = [...pendingLabels, name];
        if (levelIdx + 1 < levels.length) {
          walk(bucket, levelIdx + 1, key, depth, false, nextPending);
        } else {
          const isOpen = !openGroups.has(key);
          rows.push({
            _id: `h|${key}`, _type: "planheader", _groupKey: key, _open: isOpen, _indent: 12 + depth * 18, _depth: depth,
            label: nextPending.join(" · "), ...dataObj(cats, forceDivisions ? cats.map(() => null) : bucketTotal),
          });
          if (!isOpen) continue;
          renderOperators(bucket, key, depth + 1);
        }
        continue;
      }

      const label = pendingLabels.length ? [...pendingLabels, name].join(" · ") : name;
      const isOpen = !openGroups.has(key);
      // Con forceDivisions, los encabezados de nivel no muestran número:
      // mezclarían unidades distintas (Mbd, MMpcd) de los productos que agrupan.
      rows.push({
        _id: `h|${key}`, _type: "planheader", _groupKey: key, _open: isOpen, _indent: 12 + depth * 18, _depth: depth,
        label, ...dataObj(cats, forceDivisions ? cats.map(() => null) : bucketTotal),
      });
      if (!isOpen) continue;

      if (levelIdx + 1 < levels.length) {
        walk(bucket, levelIdx + 1, key, depth + 1, false, []);
      } else {
        renderOperators(bucket, key, depth + 1);
      }
    }
  };

  walk(leaves, 0, "ml", 0, true, []);
  return rows;
}

// ── Aplanar según el modo activo ──────────────────────────────────────────────
function flattenGroups(resultado, visibleSeries, search, openGroups, groupBy, hideDivisions, forceDivisions) {
  const rows = [];
  if (!resultado?.groups) return rows;
  const cats = resultado.categories;
  const q    = search.trim().toLowerCase();
  const vis  = visibleSeries ?? {};

  const nacGroup = resultado.groups.find(g => g.cuenca === "Nacional");

  // ── null / operador: Nacional completo ──────────────────────────────────────
  if (!groupBy || groupBy === "operador") {
    if (!nacGroup) return rows;

    // Cuenca header Nacional
    rows.push({
      _id: "c|Nacional", _type: "cuenca", _cuenca: "Nacional", _ub: "", label: "Nacional",
      ...Object.fromEntries(cats.map(c => [c, null])),
    });

    for (const sg of nacGroup.subgroups) {
      if (sg.ubicacion !== "Nacional") continue;   // solo el total, sin desglose por ubicación
      const gk     = `Nacional|${sg.ubicacion}`;
      const isOpen = openGroups.has(gk);

      rows.push({
        _id: `u|${gk}`, _type: "ubicacion", _cuenca: "Nacional",
        _ub: sg.ubicacion, _groupKey: gk, _open: isOpen, label: sg.ubicacion,
        ...Object.fromEntries(cats.map(c => [c, null])),
      });

      if (!isOpen) continue;

      pushOperatorRows(rows, sg.rows, gk, "Nacional", sg.ubicacion, cats, hideDivisions, groupBy, vis, q, forceDivisions);
    }
    return rows;
  }

  // ── Por cuenca: cada cuenca como encabezado colapsable (estilo categoría) ─────
  if (groupBy === "cuenca") {
    // Banner NACIONAL + Total general arriba
    const nacSg = nacGroup?.subgroups?.find(s => s.ubicacion === "Nacional");
    if (nacSg) {
      const { total } = mergeSubgroups([nacSg], cats);
      rows.push({
        _id: "banner|Nacional", _type: "banner", _cuenca: "Nacional", _ub: "", label: "Nacional",
        ...Object.fromEntries(cats.map(c => [c, null])),
      });
      rows.push({
        _id: "total|Nacional", _type: "total", _cuenca: "Nacional", _ub: "", label: "Total",
        ...Object.fromEntries(cats.map((c, ci) => [c, total[ci]])),
      });
    }

    for (const g of resultado.groups) {
      if (g.cuenca === "Nacional") continue;
      if (vis[g.cuenca] === false) continue;

      const gk     = `cuenca|${g.cuenca}`;
      const isOpen = openGroups.has(gk);
      const { total, ops } = mergeSubgroups(g.subgroups, cats);

      rows.push({
        _id: `ph|${gk}`, _type: "planheader",
        _cuenca: g.cuenca, _ub: "", _groupKey: gk, _open: isOpen, label: g.cuenca,
        ...Object.fromEntries(cats.map((c, ci) => [c, total[ci]])),
      });
      if (!isOpen) continue;

      const visible = ops.filter(o => hasData(o.data) && (!q || o.label.toLowerCase().includes(q)));
      for (const op of visible) {
        rows.push({
          _id: `po|${gk}|${op.label}`, _type: "planoperator",
          _cuenca: g.cuenca, _ub: "", label: op.label,
          ...Object.fromEntries(cats.map((c, ci) => [c, op.data[ci] ?? 0])),
        });
      }
    }
    return rows;
  }

  // ── Por ambiente: cada ambiente como encabezado colapsable (estilo categoría) ─
  if (groupBy === "ubicacion") {
    if (!nacGroup) return rows;
    // Banner NACIONAL + Total general arriba
    const nacSg = nacGroup.subgroups.find(s => s.ubicacion === "Nacional");
    if (nacSg) {
      const { total } = mergeSubgroups([nacSg], cats);
      rows.push({
        _id: "banner|Nacional", _type: "banner", _cuenca: "Nacional", _ub: "", label: "Nacional",
        ...Object.fromEntries(cats.map(c => [c, null])),
      });
      rows.push({
        _id: "total|Nacional", _type: "total", _cuenca: "Nacional", _ub: "", label: "Total",
        ...Object.fromEntries(cats.map((c, ci) => [c, total[ci]])),
      });
    }

    for (const sg of nacGroup.subgroups) {
      if (sg.ubicacion === "Nacional") continue;
      if (vis[sg.ubicacion] === false) continue;

      const gk     = `ub|${sg.ubicacion}`;
      const isOpen = openGroups.has(gk);
      const { total, ops } = mergeSubgroups([sg], cats);

      rows.push({
        _id: `ph|${gk}`, _type: "planheader",
        _cuenca: "Nacional", _ub: sg.ubicacion, _groupKey: gk, _open: isOpen, label: sg.ubicacion,
        ...Object.fromEntries(cats.map((c, ci) => [c, total[ci]])),
      });
      if (!isOpen) continue;

      const visible = ops.filter(o => hasData(o.data) && (!q || o.label.toLowerCase().includes(q)));
      for (const op of visible) {
        rows.push({
          _id: `po|${gk}|${op.label}`, _type: "planoperator",
          _cuenca: "Nacional", _ub: sg.ubicacion, label: op.label,
          ...Object.fromEntries(cats.map((c, ci) => [c, op.data[ci] ?? 0])),
        });
      }
    }
    return rows;
  }

  // ── Por categoría: cada categoría como encabezado colapsable (estilo ambiente) ─
  if (groupBy === "plan") {
    const nacSg = nacGroup?.subgroups?.find(sg => sg.ubicacion === "Nacional");
    if (!nacSg) return rows;

    // Banner NACIONAL + Total general arriba
    const { total } = mergeSubgroups([nacSg], cats);
    rows.push({
      _id: "banner|Nacional", _type: "banner", _cuenca: "Nacional", _ub: "", label: "Nacional",
      ...Object.fromEntries(cats.map(c => [c, null])),
    });
    rows.push({
      _id: "total|Nacional", _type: "total", _cuenca: "Nacional", _ub: "", label: "Total",
      ...Object.fromEntries(cats.map((c, ci) => [c, total[ci]])),
    });

    let i = 0;
    while (i < nacSg.rows.length) {
      const row = nacSg.rows[i];
      if (row.type === "subtotal") {
        if (vis[row.label] === false) {
          i++;
          while (i < nacSg.rows.length && nacSg.rows[i].type === "operator") i++;
          continue;
        }
        const gk     = `plan|${row.label}`;
        const isOpen = openGroups.has(gk);
        rows.push({
          _id: `ph|${row.label}`, _type: "planheader",
          _cuenca: "Nacional", _ub: row.label, _groupKey: gk, _open: isOpen, label: row.label,
          ...Object.fromEntries(cats.map((c, ci) => [c, row.data[ci] ?? 0])),
        });
        i++;
        const ops = [];
        while (i < nacSg.rows.length && nacSg.rows[i].type === "operator") { ops.push(nacSg.rows[i]); i++; }
        if (!isOpen) continue;
        const visible = ops.filter(o => hasData(o.data) && (!q || o.label.toLowerCase().includes(q)));
        for (const op of visible) {
          rows.push({
            _id: `po|${row.label}|${op.label}`, _type: "planoperator",
            _cuenca: "Nacional", _ub: row.label, label: op.label,
            ...Object.fromEntries(cats.map((c, ci) => [c, op.data[ci] ?? 0])),
          });
        }
      } else { i++; }
    }
    return rows;
  }

  return rows;
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
const PERIOD_LABEL = { annually: "Anual", monthly: "Mensual" };

function Toolbar({ search, setSearch, hiddenCols, setHiddenCols, categories, allRows, titulo, period, start_year, end_year, opCount, entityLabel = "operadores", sumaDisponible, sumaOculta, setSumaOculta, isMonthly }) {
  const [showCols, setShowCols] = useState(false);

  function exportCSV() {
    const visCats = categories.filter(c => !hiddenCols.has(c));
    const header  = ["Tipo", "Cuenca Geológica", "Ambiente", "Etiqueta", ...visCats].join(",");
    const lines   = allRows.map(r =>
      [r._type, r._cuenca, r._ub, `"${r.label}"`, ...visCats.map(c => r[c] ?? "")].join(",")
    );
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement("a"), { href: url, download: "datos.csv" });
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      {titulo && (
        <div className="flex flex-col justify-center mr-2 min-w-0">
          <span style={{ fontFamily: "'Patria', Georgia, serif", color: "#10312B", fontSize: 17, fontWeight: 700, lineHeight: 1.1, whiteSpace: "nowrap" }}>
            {titulo}
          </span>
          <span style={{ fontFamily: "'Noto Sans', sans-serif", fontSize: 10, color: "#94a3b8", fontWeight: 500, marginTop: 1, letterSpacing: "0.03em", whiteSpace: "nowrap" }}>
            {PERIOD_LABEL[period] ?? period} · {start_year} – {end_year}
          </span>
        </div>
      )}
      <div className="flex-1" />
      <div className="relative min-w-[180px] max-w-[240px]">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="6.5" cy="6.5" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/>
        </svg>
        <input
          className="w-full pl-8 pr-8 py-1.5 text-[13px] text-slate-800 placeholder-slate-400 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-400 bg-white"
          placeholder="Buscar operador, categoría…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-[11px]"
            onClick={() => setSearch("")}>✕</button>
        )}
      </div>

      <div className="relative">
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50"
          onClick={() => setShowCols(v => !v)}>
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="1" y="1" width="4" height="14" rx="1"/><rect x="6" y="1" width="4" height="14" rx="1"/><rect x="11" y="1" width="4" height="14" rx="1"/>
          </svg>
          Columnas
        </button>
        {showCols && (
          <div className="absolute top-full mt-1 right-0 bg-white border border-slate-200 rounded-lg shadow-lg p-3 z-50 min-w-[130px]">
            <p className="text-[10px] font-semibold text-slate-400 uppercase mb-2 tracking-wide">Visibles</p>
            {!isMonthly && categories.map(c => (
              <label key={c} className="flex items-center gap-2 py-0.5 cursor-pointer">
                <input type="checkbox" checked={!hiddenCols.has(c)} className="accent-teal-600"
                  onChange={() => setHiddenCols(s => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; })} />
                <span className="text-[12px] text-slate-700">{c}</span>
              </label>
            ))}
            {sumaDisponible && (
              <>
                {!isMonthly && <div className="h-px bg-slate-100 my-1.5" />}
                <label className="flex items-center gap-2 py-0.5 cursor-pointer">
                  <input type="checkbox" checked={!sumaOculta} className="accent-teal-600"
                    onChange={() => setSumaOculta(v => !v)} />
                  <span className="text-[12px] text-slate-700">Suma</span>
                </label>
              </>
            )}
          </div>
        )}
      </div>

      <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50">
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 2v10M4 8l4 4 4-4"/><path d="M2 14h12"/>
        </svg>
        Exportar CSV
      </button>

      <span className="text-[11px] text-slate-400 whitespace-nowrap">
        {opCount} {entityLabel}{search && ` · "${search}"`}
      </span>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function DynamicTable({ resultado, visibleSeries, groupBy, titulo, period, start_year, end_year, compareMode, entityLabel, forceDivisions, filtros }) {
  const [search,     setSearch]     = useState("");
  const [hiddenCols, setHiddenCols] = useState(new Set());
  const [openGroups, setOpenGroups] = useState(() => initOpenGroups(resultado, groupBy));
  const [hoveredRow,  setHoveredRow]  = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [hoveredCol,  setHoveredCol]  = useState(null);
  const [sumaOculta,  setSumaOculta]  = useState(false);

  // Resetear grupos abiertos al cambiar de modo o al cambiar los datos (filtros)
  useEffect(() => {
    setOpenGroups(initOpenGroups(resultado, groupBy));
  }, [groupBy, resultado]);

  function toggleGroup(key) {
    setOpenGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  // "openGroups" guarda las cerradas en flattenMultiLevel y las abiertas en
  // flattenGroups — semántica opuesta entre modos.
  function collapseAll() {
    if (!resultado?.groups) return;
    if (hierLevels.length > 0) {
      const keys = new Set();
      rows.forEach(r => { if (r._type === "planheader") keys.add(r._groupKey); });
      setOpenGroups(keys);
    } else {
      setOpenGroups(new Set());
    }
  }

  function expandAll() {
    if (!resultado?.groups) return;
    if (hierLevels.length > 0) {
      setOpenGroups(new Set()); // vacío = todo abierto (isOpen = !openGroups.has)
    } else {
      setOpenGroups(new Set(["Nacional|Nacional"])); // única llave colapsable en este modo
    }
  }

  function toggleAllGroups() {
    hasOpenGroups ? collapseAll() : expandAll();
  }

  const { perfFiltros } = useExplorer();
  const filtrosActivos = filtros ?? perfFiltros;
  // Dimensiones con filtro activo → niveles de anidamiento (Ambiente > Cuenca > Categoría).
  const hierLevels = activeHierLevels(filtrosActivos);
  const hideDivisions = !forceDivisions && filtrosActivos.categorias.length === 0;

  const categories = resultado?.categories ?? [];
  const visCats    = categories.filter(c => !hiddenCols.has(c));

  const rows = useMemo(
    () => hierLevels.length > 0
      ? flattenMultiLevel(resultado, filtrosActivos, openGroups, search, visibleSeries ?? {}, forceDivisions)
      : flattenGroups(resultado, visibleSeries, search, openGroups, groupBy, hideDivisions, forceDivisions),
    [resultado, visibleSeries, search, openGroups, filtrosActivos, hierLevels.length, hideDivisions, forceDivisions, groupBy]
  );
  const cuencaCount = useMemo(() => rows.filter(r => r._type === "cuenca").length, [rows]);

  if (!resultado?.groups?.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div className="rounded-xl border border-slate-200 shadow-sm bg-white overflow-hidden">
          <div style={{
            background: "linear-gradient(90deg,#10312B,#1a4a3a)", color: "#fff",
            padding: "10px 16px", fontWeight: 700, fontSize: 13,
            letterSpacing: "0.08em", textTransform: "uppercase",
          }}>
            Nacional
          </div>
        </div>
      </div>
    );
  }

  const opCount = new Set(
    rows.filter(r => r._type === "operator" || r._type === "planoperator").map(r => r.label)
  ).size;

  // Detectar si las categorías son mensuales (formato "YYYY-MM")
  const isMonthly = visCats.length > 0 && /^\d{4}-\d{2}$/.test(visCats[0]);
  const MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

  // Paleta mensual: colores vivos
  const YEAR_COLORS = [
    { bg: "#f0fdf4", border: "#86efac", text: "#166534", monthBg: "#f0fdf4" },
    { bg: "#eff6ff", border: "#93c5fd", text: "#1e40af", monthBg: "#eff6ff" },
    { bg: "#fdf4ff", border: "#d8b4fe", text: "#7e22ce", monthBg: "#fdf4ff" },
    { bg: "#fff7ed", border: "#fdba74", text: "#9a3412", monthBg: "#fff7ed" },
    { bg: "#f0fdfa", border: "#5eead4", text: "#0f766e", monthBg: "#f0fdfa" },
    { bg: "#fef9c3", border: "#fde047", text: "#854d0e", monthBg: "#fef9c3" },
  ];

  // Paleta anual: verdes olivo/salvia
  const ANNUAL_COLORS = [
    { bg: "#f2f5ee", border: "#a3b899", text: "#3a5240" },
    { bg: "#eaf0e8", border: "#8aab82", text: "#2e4a34" },
    { bg: "#f5f7ee", border: "#b5bc8a", text: "#484f28" },
    { bg: "#eef2ec", border: "#96af90", text: "#344d30" },
    { bg: "#f0f4eb", border: "#a8bc8e", text: "#3d5230" },
    { bg: "#edf1e6", border: "#9aad88", text: "#364c2e" },
  ];

  // Agrupar por año para el encabezado de dos niveles (mensual)
  const yearGroups = isMonthly
    ? Object.entries(
        visCats.reduce((acc, c) => {
          const [y] = c.split("-");
          (acc[y] = acc[y] ?? []).push(c);
          return acc;
        }, {})
      )
    : null;

  // Mapa de columna → índice (para colorear, vista anual)
  const colYearIdx = Object.fromEntries(visCats.map((c, i) => [c, i]));

  // Modo "Comparar años": exactamente 2 años, en orden cronológico + columna de diferencia.
  const isCompare = !!compareMode && !isMonthly && visCats.length === 2;

  // Columna de suma a la derecha con 2+ años (vista anual); en vista mensual
  // se agrega al final de cada año en vez de una sola global.
  const sumaDisponible = isMonthly ? visCats.length > 0 : visCats.length >= 2;
  const showSuma = sumaDisponible && !sumaOculta;
  const extraSumaCols = isMonthly ? (showSuma ? yearGroups.length : 0) : (showSuma ? 1 : 0);

  // En modo anual el año más reciente va primero; en modo comparación se
  // respeta el orden cronológico (antes → después).
  const displayCats = isMonthly || isCompare ? visCats : [...visCats].reverse();

  // Resalte de columna al hacer hover (overlay translúcido, no pisa el color de fondo existente)
  const colHighlightShadow = "inset 0 0 0 9999px rgba(13,148,136,0.12)";

  const hasOpenGroups = hierLevels.length > 0
    ? rows.some(r => r._type === "planheader" && r._open)
    : openGroups.size > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Toolbar search={search} setSearch={setSearch} hiddenCols={hiddenCols}
        setHiddenCols={setHiddenCols} categories={categories} allRows={rows}
        titulo={titulo} period={period} start_year={start_year} end_year={end_year}
        opCount={opCount} entityLabel={entityLabel}
        sumaDisponible={sumaDisponible} sumaOculta={sumaOculta} setSumaOculta={setSumaOculta} isMonthly={isMonthly} />

      <div className="rounded-xl border border-slate-200 shadow-sm bg-white overflow-auto" style={{ flex: 1, minHeight: 0 }}>
          <table className="border-collapse" style={{ width: isMonthly ? "100%" : "auto", tableLayout: isMonthly ? "fixed" : "auto", minWidth: isMonthly ? `${240 + visCats.length * 52 + (showSuma ? yearGroups.length * 56 : 0)}px` : undefined }}>
            {isMonthly && (
              <colgroup>
                <col style={{ width: "240px" }} />
                {yearGroups.map(([year, cols]) => (
                  <Fragment key={year}>
                    {cols.map(c => <col key={c} />)}
                    {showSuma && <col key={`${year}-suma`} style={{ width: "56px" }} />}
                  </Fragment>
                ))}
              </colgroup>
            )}
            <thead style={{ position: "sticky", top: 0, zIndex: 30 }}>
              {isMonthly ? (
                <>
                  {/* Fila 1: años */}
                  <tr className="border-b border-slate-200">
                    <th className="sticky left-0 bg-white z-10 px-4 py-2" style={{ minWidth: 280 }} />
                    {yearGroups.map(([year, cols], yi) => {
                      const clr = YEAR_COLORS[yi % YEAR_COLORS.length];
                      return (
                        <th key={year}
                          colSpan={cols.length + (showSuma ? 1 : 0)}
                          className="text-center px-2 py-2 text-[12px] font-bold whitespace-nowrap"
                          style={{ minWidth: cols.length * 52, background: clr.bg, color: clr.text, borderLeft: yi > 0 ? `2px solid ${clr.border}` : undefined }}
                        >
                          {year}
                        </th>
                      );
                    })}
                  </tr>
                  {/* Fila 2: meses */}
                  <tr className="border-b-2 border-slate-300">
                    <th className="sticky left-0 bg-white z-10 px-4 py-2" style={{ minWidth: 280 }} />
                    {yearGroups.map(([year, cols], yi) => {
                      const clr = YEAR_COLORS[yi % YEAR_COLORS.length];
                      return (
                        <Fragment key={year}>
                          {cols.map((c, ci) => {
                            const mes = parseInt(c.split("-")[1], 10);
                            return (
                              <th key={c}
                                className="text-center px-1 py-1.5 text-[11px] font-semibold whitespace-nowrap"
                                style={{
                                  minWidth: 52,
                                  background: clr.monthBg,
                                  color: clr.text,
                                  borderLeft: ci === 0 && yi > 0 ? `2px solid ${clr.border}` : undefined,
                                  boxShadow: hoveredCol === c ? colHighlightShadow : undefined,
                                }}
                                onMouseEnter={() => setHoveredCol(c)}
                                onMouseLeave={() => setHoveredCol(null)}
                              >
                                {MESES[mes - 1]}
                              </th>
                            );
                          })}
                          {showSuma && (
                            <th className="text-center px-1 py-1.5 text-[11px] font-semibold whitespace-nowrap"
                              style={{ minWidth: 56, background: "#eef2ff", color: "#6366f1" }}>
                              Suma
                            </th>
                          )}
                        </Fragment>
                      );
                    })}
                  </tr>
                </>
              ) : (
                <tr className="border-b-2 border-slate-200 bg-white">
                  <th className="text-left px-4 py-3 sticky left-0 bg-white z-10" style={{ minWidth: 160 }} />
                  {displayCats.map((c) => {
                    const clr = ANNUAL_COLORS[colYearIdx[c] % ANNUAL_COLORS.length];
                    return (
                      <th key={c}
                        className="text-center px-2 py-3 text-[13px] font-bold whitespace-nowrap"
                        style={{ minWidth: 72, background: clr.bg, color: clr.text, boxShadow: hoveredCol === c ? colHighlightShadow : undefined }}
                        onMouseEnter={() => setHoveredCol(c)}
                        onMouseLeave={() => setHoveredCol(null)}
                      >
                        {c}
                      </th>
                    );
                  })}
                  {isCompare && (
                    <th className="text-center px-2 py-3 text-[13px] font-bold whitespace-nowrap" style={{ minWidth: 96, background: "#f1f5f9", color: "#334155" }}>
                      Diferencia
                    </th>
                  )}
                  {showSuma && (
                    <th className="text-center px-2 py-3 text-[13px] font-bold whitespace-nowrap" style={{ minWidth: 96, background: "#eef2ff", color: "#818cf8" }}>
                      Suma
                    </th>
                  )}
                </tr>
              )}
            </thead>
            <tbody>
              {rows.map(row => {
                const cfg         = TYPE_STYLE[row._type] ?? TYPE_STYLE.operator;
                const bg          = ROW_BG[row._type];
                const isCollapse  = COLLAPSIBLE.has(row._type);
                const useColSpan  = row._type === "ubicacion" || row._type === "cuenca" || row._type === "banner";
                const isCuencaRow = row._type === "cuenca";

                if (isCuencaRow && cuencaCount === 1) return null;

                const isDark      = isCuencaRow || row._type === "ubicacion" || row._type === "banner";
                const isSelected  = selectedRow === row._id && !isDark;
                const isHovered   = hoveredRow === row._id && !isDark && !isSelected;
                const selectedBg  = "#ccfbf1";
                const hoverBg     = "#e6f4f1";
                const tone        = row._type === "planheader" ? PLANHEADER_TONES[(row._depth ?? 0) % PLANHEADER_TONES.length] : null;

                return (
                  <tr key={row._id}
                    className={`${bg ?? ""} ${isCollapse ? "cursor-pointer select-none" : ""} transition-colors duration-100`}
                    style={{
                      ...(isDark ? { background: "linear-gradient(90deg,#10312B,#1a4a3a)" } : {}),
                      ...(tone && !isSelected && !isHovered ? { background: tone.bg + "60" } : {}),
                      ...(isCuencaRow ? { position: "sticky", top: isMonthly ? 57 : 41, zIndex: 20 } : {}),
                      ...(isSelected ? { background: selectedBg, boxShadow: "0 -2px 0 #14b8a6, 0 2px 0 #14b8a6", zIndex: 5 } : {}),
                      ...(isHovered  ? { background: hoverBg,   boxShadow: "0 -1px 0 #94a3b8, 0 1px 0 #94a3b8", transform: "scale(1.002)", zIndex: 5 } : {}),
                    }}
                    onMouseEnter={() => setHoveredRow(row._id)}
                    onMouseLeave={() => setHoveredRow(null)}
                    onClick={() => {
                      if (isCollapse) toggleGroup(row._groupKey);
                      if (!isDark) setSelectedRow(selectedRow === row._id ? null : row._id);
                    }}
                  >
                    <td className={`px-4 py-[5px] whitespace-nowrap overflow-hidden text-ellipsis ${cfg.label}`}
                      style={{
                        position: "sticky", left: 0, zIndex: isDark ? 25 : 10,
                        ...(row._indent != null ? { paddingLeft: row._indent } : {}),
                        ...(tone ? { color: tone.text, borderLeft: `3px solid ${tone.border}` } : {}),
                        background: isDark      ? "linear-gradient(90deg,#10312B,#1a4a3a)"
                          : isSelected            ? selectedBg
                          : isHovered             ? hoverBg
                          : tone                  ? tone.bg
                          : row._type === "total" ? "#f0fdfa"
                          : "#ffffff"
                      }}
                    >
                      {isCollapse && (
                        <svg className={`inline-block w-3 h-3 mr-1.5 transition-transform duration-150 ${row._open ? "rotate-90" : ""}`}
                          viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <polyline points="4,2 8,6 4,10" />
                        </svg>
                      )}
                      <span className="inline-flex items-center gap-2">
                        {row.label}
                        {row._type === "banner" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleAllGroups(); }}
                            title={hasOpenGroups ? "Contraer todos los grupos" : "Expandir todos los grupos"}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10.5px] font-medium rounded-md border transition-colors normal-case tracking-normal"
                            style={{ color: "#a7f3d0", borderColor: "rgba(167,243,208,0.35)", background: "rgba(255,255,255,0.06)" }}
                            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.14)"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                          >
                            <svg className={`w-3 h-3 transition-transform duration-150 ${hasOpenGroups ? "" : "rotate-180"}`}
                              viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <polyline points="2.5,4 6,7.5 9.5,4" />
                            </svg>
                            {hasOpenGroups ? "Contraer todo" : "Expandir todo"}
                          </button>
                        )}
                      </span>
                    </td>
                    {useColSpan && (
                      <td colSpan={visCats.length + (isCompare ? 1 : 0) + extraSumaCols}
                        style={{ background: "linear-gradient(90deg,#1a4a3a,#1a4a3a)" }} />
                    )}
                    {!useColSpan && isMonthly && (() => {
                      const isCuenca = row._type === "cuenca";
                      return yearGroups.map(([year, cols], yi) => {
                        const clr = !isCuenca ? YEAR_COLORS[yi % YEAR_COLORS.length] : null;
                        const sumaVals = cols.map(c => row[c]).filter(v => v !== null);
                        const suma = sumaVals.length ? sumaVals.reduce((a, b) => a + b, 0) : null;
                        return (
                          <Fragment key={year}>
                            {cols.map((c, ci) => {
                              const val = row[c];
                              return (
                                <td key={c}
                                  className={`px-2 py-[5px] text-center tabular-nums ${
                                    val === null ? "" : val === 0 ? "text-slate-300 text-[12px]" : cfg.num
                                  }`}
                                  style={{
                                    ...(clr ? {
                                      background: clr.bg + "80",
                                      borderLeft: ci === 0 && yi > 0 ? `2px solid ${clr.border}` : undefined,
                                    } : {}),
                                    ...(tone && val !== 0 ? { color: tone.text } : {}),
                                    ...(hoveredCol === c ? { boxShadow: colHighlightShadow } : {}),
                                  }}
                                  onMouseEnter={() => setHoveredCol(c)}
                                  onMouseLeave={() => setHoveredCol(null)}
                                >
                                  {val === null ? "" : val === 0 ? "—" : val.toLocaleString("es-MX")}
                                </td>
                              );
                            })}
                            {showSuma && (
                              <td className="px-2 py-[5px] text-center tabular-nums text-[12px] font-medium"
                                style={{ color: "#818cf8", background: "#eef2ff80" }}>
                                {suma === null ? "" : suma === 0 ? "—" : suma.toLocaleString("es-MX")}
                              </td>
                            )}
                          </Fragment>
                        );
                      });
                    })()}
                    {!useColSpan && !isMonthly && displayCats.map(c => {
                      const val = row[c];
                      const yi  = colYearIdx[c];
                      const clr = ANNUAL_COLORS[yi % ANNUAL_COLORS.length];
                      return (
                        <td key={c}
                          className={`px-2 py-[5px] text-center tabular-nums ${
                            val === null ? "" : val === 0 ? "text-slate-300 text-[12px]" : cfg.num
                          }`}
                          style={{
                            background: clr.bg + "80",
                            ...(tone && val !== 0 ? { color: tone.text } : {}),
                            ...(hoveredCol === c ? { boxShadow: colHighlightShadow } : {}),
                          }}
                          onMouseEnter={() => setHoveredCol(c)}
                          onMouseLeave={() => setHoveredCol(null)}
                        >
                          {val === null ? "" : val === 0 ? "—" : val.toLocaleString("es-MX")}
                        </td>
                      );
                    })}
                    {isCompare && !useColSpan && (() => {
                      const a = row[displayCats[0]];
                      const b = row[displayCats[1]];
                      if (a === null || b === null) return <td />;
                      const diff = b - a;
                      const pct = a !== 0 ? (diff / a) * 100 : null;
                      const color = diff > 0 ? "#059669" : diff < 0 ? "#dc2626" : "#94a3b8";
                      const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "—";
                      return (
                        <td className="px-2 py-[5px] text-center tabular-nums text-[12px] font-semibold" style={{ color, background: "#f8fafc" }}>
                          {diff === 0 ? "—" : (
                            <>
                              {arrow} {Math.abs(diff).toLocaleString("es-MX")}
                              {pct !== null && <span className="opacity-70"> ({pct > 0 ? "+" : ""}{pct.toFixed(1)}%)</span>}
                            </>
                          )}
                        </td>
                      );
                    })()}
                    {showSuma && !isMonthly && !useColSpan && (() => {
                      const vals = displayCats.map(c => row[c]).filter(v => v !== null);
                      if (!vals.length) return <td />;
                      const suma = vals.reduce((a, b) => a + b, 0);
                      return (
                        <td className="px-2 py-[5px] text-center tabular-nums text-[12px] font-medium" style={{ color: "#a5b4fc", background: "#eef2ff60" }}>
                          {suma === 0 ? "—" : suma.toLocaleString("es-MX")}
                        </td>
                      );
                    })()}
                  </tr>
                );
              })}
            </tbody>
          </table>
      </div>
    </div>
  );
}
