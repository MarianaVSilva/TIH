import { useState, useMemo, useEffect, Fragment } from "react";
import { useExplorer } from "../../store/useExplorer";
import ReportBuilderModal from "./ReportBuilderModal";

// ── Estilos por tipo ──────────────────────────────────────────────────────────
const TYPE_STYLE = {
  banner:      { label: "text-[13px] font-bold text-white uppercase tracking-widest",   num: "text-white font-bold text-[13px]" },
  cuenca:      { label: "text-[13px] font-bold text-white uppercase tracking-widest",   num: "text-white font-bold text-[13px]" },
  ubicacion:   { label: "text-[13px] font-bold text-white uppercase tracking-widest",   num: "text-white font-bold text-[13px]" },
  planheader:  { label: "text-[13.5px] font-bold pl-2",                                  num: "font-bold text-[13.5px]" },
  total:       { label: "text-[13.5px] font-bold text-teal-700 pl-4",                   num: "text-teal-700 font-bold text-[13.5px]" },
  subtotal:    { label: "text-[13px] font-semibold text-teal-600 pl-6",                 num: "text-teal-600 font-semibold text-[13px]" },
  subtotalcol: { label: "text-[13px] font-semibold text-teal-600 pl-6",                 num: "text-teal-600 font-semibold text-[13px]" },
  operator:    { label: "text-[12.5px] text-slate-600 pl-8",                            num: "text-slate-600 text-[12.5px]" },
  planoperator:{ label: "text-[12.5px] text-slate-600 pl-4",                            num: "text-slate-600 text-[12.5px]" },
  totaloperator:{ label: "text-[12.5px] font-bold text-teal-700 pl-8",                  num: "text-teal-700 font-bold text-[12.5px]" },
  totalmbd:    { label: "text-[13px] font-bold text-blue-700 pl-4",                    num: "text-blue-700 font-bold text-[13px]" },
  totalmmpcd:  { label: "text-[13px] font-bold text-orange-700 pl-4",                  num: "text-orange-700 font-bold text-[13px]" },
};

const ROW_BG = {
  banner:      null,
  cuenca:      null,
  ubicacion:   "border-b border-slate-300",
  planheader:  "border-b border-teal-200",
  total:       "bg-teal-50/70 border-b border-teal-100",
  subtotal:    "bg-white border-b border-slate-100",
  subtotalcol: "bg-white border-b border-slate-100 cursor-pointer hover:bg-slate-50/60",
  operator:    "bg-white border-b border-slate-50 hover:bg-slate-50/80 transition-colors",
  planoperator:"bg-white border-b border-slate-50 hover:bg-slate-50/80 transition-colors",
  totaloperator:"bg-teal-50/40 border-b border-slate-100 hover:bg-teal-50/70 transition-colors",
  totalmbd:    "bg-blue-100 border-b border-blue-200",
  totalmmpcd:  "bg-orange-100 border-b border-orange-200",
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
const COLLAPSIBLE = new Set(["ubicacion", "planheader", "subtotalcol"]);

// ── Inicializar grupos abiertos según el modo ─────────────────────────────────
function initOpenGroups(resultado, groupBy, expandirConSubtotal) {
  const init = new Set();
  if (!resultado?.groups) return init;

  if (!groupBy || groupBy === "operador") {
    // Vista general: abrir Nacional|Nacional
    init.add("Nacional|Nacional");
  }
  if (groupBy === "cuenca") {
    for (const g of resultado.groups) {
      if (g.cuenca === "Nacional") continue;
      // "Producción por operador" trae muchas empresas (Producto→Contrato
      // dentro de cada una) — arrancan colapsadas, a diferencia de Campos/API
      // que solo tienen unas pocas cuencas y sí conviene ver expandidas.
      const filasGrupo = g.subgroups?.[0]?.rows ?? [];
      // Empresas/cuencas sin producción en el rango (rows vacío) no tienen nada
      // que abrir — sin este guard contaban como "sin subtotal" y se forzaban
      // a "abiertas", inflando hasOpenGroups aunque todo estuviera colapsado.
      const tieneSubtotal = filasGrupo.length === 0 || filasGrupo.some(r => r.type === "subtotal");
      if (!tieneSubtotal || expandirConSubtotal) init.add(`cuenca|${g.cuenca}`);
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
function pushOperatorRows(rows, sgRows, gk, cuenca, ubicacion, cats, hideDivisions, groupBy, vis, q, forceDivisions, openGroups) {
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
        _cuenca: cuenca, _ub: ubicacion, label: op.label, _code: op.code,
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
      i++;
      const ops = [];
      while (i < sgRows.length && sgRows[i].type === "operator") { ops.push(sgRows[i]); i++; }
      if (skipGroup) continue;
      let visible = groupBy === "operador" ? ops.filter(o => vis[o.label] !== false) : ops;
      visible = visible.filter(o => hasData(o.data));
      // Si lo que coincidió con la búsqueda es el propio subtotal (p. ej. una
      // Entidad Federativa o Licitación), se muestran TODOS sus hijos —
      // filtrar además por texto en las hojas dejaría la rama vacía aunque el
      // usuario sí encontró lo que buscaba.
      const parentCoincide = !!q && row.label.toLowerCase().includes(q);
      if (q && !parentCoincide) visible = visible.filter(o => o.label.toLowerCase().includes(q));
      // Con forceDivisions cada subtotal (producto) es colapsable — el estado
      // "abierto" es la convención "cerrado si está en openGroups" (igual que
      // planheader/ubicacion), así por defecto arrancan expandidos.
      // Con un único hijo visible (p. ej. un solo tipo de pozo bajo esta
      // cuenca), la cifra del subtotal repetiría exactamente la del hijo de
      // abajo — pero solo es redundante mientras el hijo esté VISIBLE
      // (expandido); si está colapsado, es la única cifra en pantalla, así
      // que se muestra ahí y se oculta justo al expandir.
      const subgk = `sub|${gk}|${row.label}`;
      const isOpenSub = !forceDivisions || !openGroups?.has(subgk);
      const soloUnHijo = visible.length === 1 && isOpenSub;
      if (row.type !== "total" && !skipGroup) {
        rows.push({
          _id: `r|${gk}|${row.label}`, _type: forceDivisions ? "subtotalcol" : row.type,
          _cuenca: cuenca, _ub: ubicacion, label: row.label,
          ...(forceDivisions ? { _groupKey: subgk, _open: isOpenSub } : {}),
          ...Object.fromEntries(cats.map((c, ci) => [c, soloUnHijo ? null : (row.data[ci] ?? 0)])),
        });
      }
      if (!isOpenSub) continue;
      for (const op of visible) {
        const isTotalRow = op.label === "Todos los operadores";
        rows.push({
          _id: `r|${gk}|${parentLabel}|${op.label}`, _type: isTotalRow ? "totaloperator" : "operator",
          _cuenca: cuenca, _ub: ubicacion, label: isTotalRow ? "Total" : op.label,
          _code: isTotalRow ? undefined : op.code,
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

// Extrae los 2 totales por unidad (Mbd/MMpcd) de las filas de subtotal de
// producto de una entidad/Nacional — usa los rollups ya calculados por el
// backend ("Hidrocarburos líquidos (Mbd)" y "Gas (MMpcd)"), que ya suman sus
// componentes (Petróleo+Condensado / Gas asociado+no asociado) sin duplicar.
function totalesPorUnidad(sgRows, cats) {
  const buscar = (label) => sgRows.find(r => r.type === "subtotal" && r.label === label);
  const liquidos = buscar("Hidrocarburos líquidos (Mbd)");
  const gas = buscar("Gas (MMpcd)");
  return {
    mbd: liquidos ? cats.map((c, ci) => liquidos.data[ci] ?? 0) : null,
    mmpcd: gas ? cats.map((c, ci) => gas.data[ci] ?? 0) : null,
  };
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
          leaves.push({ cuenca: g.cuenca, ubicacion: sg.ubicacion, categoria: cat, operator: row.label, code: row.code, data: row.data });
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

// ── Exportar: tabla PLANA/pivote (1 fila por combinación hoja, 1 columna por
// producto/serie) en vez del árbol indentado que se ve en pantalla — pedido
// explícito del usuario, con TIH_Producción por cuenca y ubicación_ejemplo.xlsx
// como referencia exacta de formato. `categoria` (producto) se pivotea a
// columnas cuando distingue valores reales (drill-down a nivel Producto);
// si no, se pivotea `operator` (que en temas sin dimensión de operador propia
// —Cuenca, Gcompo— es directamente el nombre del producto).
export function buildPivotExport(resultado, filtrosActivos, visibleSeries, search, displayCats, entityLabel) {
  let leaves = extractLeaves(resultado);
  // Sin filtros de Cuenca/Ambiente activos, el backend solo trae el grupo
  // "Nacional" (extractLeaves lo descarta a propósito para el drill-down) —
  // en ese caso se arma un solo "leaf" por cada producto de ese grupo, para
  // que la vista Nacional también exporte filas en vez de quedar vacía.
  if (!leaves.length) {
    const nac = resultado?.groups?.find(g => g.cuenca === "Nacional");
    const sg = nac?.subgroups?.find(s => s.ubicacion === "Nacional") ?? nac?.subgroups?.[0];
    let cat = null;
    for (const row of sg?.rows ?? []) {
      if (row.type === "subtotal") { cat = row.label; continue; }
      if (row.type === "total") { cat = null; continue; }
      if (row.type === "operator") {
        if (row.label === "Todos los operadores" || cat == null) continue;
        leaves.push({ cuenca: "Nacional", ubicacion: "Nacional", categoria: cat, operator: row.label, data: row.data });
      }
    }
  }
  const levels = activeHierLevels(filtrosActivos);
  const q = search.trim().toLowerCase();
  const vis = visibleSeries ?? {};

  const catValues = new Set(leaves.map(l => l.categoria));
  const opValues = new Set(leaves.map(l => l.operator));
  const categoriaEsNivel = levels.some(l => l.key === "categoria") && catValues.size > 1;
  const pivotField = categoriaEsNivel ? "categoria" : "operator";

  const identityFields = [];
  if (levels.some(l => l.key === "ubicacion") || !levels.length) identityFields.push({ key: "ubicacion", header: "Ambiente" });
  if (levels.some(l => l.key === "cuenca") || !levels.length) identityFields.push({ key: "cuenca", header: "Cuenca" });
  if (pivotField !== "operator" && opValues.size > 1) {
    identityFields.push({ key: "operator", header: entityLabel ? entityLabel[0].toUpperCase() + entityLabel.slice(1) : "Entidad" });
  }

  // La visibilidad de "series" (chips) solo aplica al primer nivel activo de
  // la jerarquía — igual que en pantalla (flattenMultiLevel solo respeta vis
  // en el nivel más externo). Aplicarla a producto/operador descartaría casi
  // todo, porque esas chips vienen apagadas por defecto para la mayoría.
  const nivelConVis = levels[0]?.key;
  const filtered = leaves.filter(lf => {
    if (nivelConVis && vis[lf[nivelConVis]] === false) return false;
    if (q) {
      const texto = `${lf.ubicacion} ${lf.cuenca} ${lf.categoria ?? ""} ${lf.operator}`.toLowerCase();
      if (!texto.includes(q)) return false;
    }
    return true;
  });

  const idxPorCat = displayCats.map(c => resultado.categories.indexOf(c));
  const colOrder = [];
  for (const lf of filtered) if (!colOrder.includes(lf[pivotField])) colOrder.push(lf[pivotField]);

  const groupMap = new Map();
  for (const lf of filtered) {
    const idKey = identityFields.map(f => lf[f.key]).join("||");
    if (!groupMap.has(idKey)) {
      groupMap.set(idKey, { identidad: identityFields.map(f => lf[f.key]), valores: new Map() });
    }
    const grupo = groupMap.get(idKey);
    const colKey = lf[pivotField];
    if (!grupo.valores.has(colKey)) grupo.valores.set(colKey, displayCats.map(() => 0));
    const acc = grupo.valores.get(colKey);
    idxPorCat.forEach((idx, i) => { acc[i] += lf.data[idx] ?? 0; });
  }

  const multiPeriodo = displayCats.length > 1;
  const columnasValor = multiPeriodo
    ? colOrder.flatMap(col => displayCats.map(c => `${col} — ${c}`))
    : colOrder;

  const filas = [...groupMap.values()].map(g => ({
    identidad: g.identidad,
    valores: multiPeriodo
      ? colOrder.flatMap(col => (g.valores.get(col) ?? displayCats.map(() => null)))
      : colOrder.map(col => (g.valores.get(col)?.[0] ?? null)),
  }));

  return { columnasIdentidad: identityFields.map(f => f.header), columnasValor, filas };
}

// ── Exportar plano para "Actividad Petrolera" (Perforación): una fila por
// Ambiente + Campo/Operador, con "Cant. pozos" (o "Cant. pozos — <periodo>"
// si hay 2+ periodos) como columna de valor — sin pivotear la entidad
// (Campo/Operador) a columnas, que es lo que hacía buildPivotExport (correcto
// para Producción, donde el operador SÍ tiene sentido como serie/columna,
// pero aquí producía una columna por cada campo/operador). Se suma a través
// de Cuenca y Categoría (tipo de pozo) — no se exponen como columnas aparte,
// pedido explícito: Ambiente, Campo/Operador, Cant. pozos y ya.
export function buildFlatExport(resultado, filtrosActivos, visibleSeries, search, displayCats, entidadHeader, valorLabel) {
  let leaves = extractLeaves(resultado);
  if (!leaves.length) {
    const nac = resultado?.groups?.find(g => g.cuenca === "Nacional");
    const sg = nac?.subgroups?.find(s => s.ubicacion === "Nacional") ?? nac?.subgroups?.[0];
    let cat = null;
    for (const row of sg?.rows ?? []) {
      if (row.type === "subtotal") { cat = row.label; continue; }
      if (row.type === "total") { cat = null; continue; }
      if (row.type === "operator") {
        if (row.label === "Todos los operadores" || cat == null) continue;
        leaves.push({ cuenca: "Nacional", ubicacion: "Nacional", categoria: cat, operator: row.label, data: row.data });
      }
    }
  }
  const q = search.trim().toLowerCase();
  const vis = visibleSeries ?? {};
  const levels = activeHierLevels(filtrosActivos);
  const nivelConVis = levels[0]?.key;

  const filtered = leaves.filter(lf => {
    if (nivelConVis && vis[lf[nivelConVis]] === false) return false;
    if (q) {
      const texto = `${lf.ubicacion} ${lf.cuenca} ${lf.categoria ?? ""} ${lf.operator}`.toLowerCase();
      if (!texto.includes(q)) return false;
    }
    return true;
  });

  const idxPorCat = displayCats.map(c => resultado.categories.indexOf(c));
  const groupMap = new Map();
  for (const lf of filtered) {
    const idKey = `${lf.ubicacion}||${lf.operator}`;
    if (!groupMap.has(idKey)) {
      groupMap.set(idKey, { identidad: [lf.ubicacion, lf.operator], valores: displayCats.map(() => 0) });
    }
    const acc = groupMap.get(idKey);
    idxPorCat.forEach((idx, i) => { acc.valores[i] += lf.data[idx] ?? 0; });
  }

  const multiPeriodo = displayCats.length > 1;
  const columnasValor = multiPeriodo ? displayCats.map(c => `${valorLabel} — ${c}`) : [valorLabel];

  const filas = [...groupMap.values()].map(g => ({ identidad: g.identidad, valores: g.valores }));

  return { columnasIdentidad: ["Ambiente", entidadHeader], columnasValor, filas };
}

function flattenMultiLevel(resultado, perfFiltros, openGroups, search, vis, forceDivisions, ocultarTotalesUnidad) {
  const cats = resultado.categories;
  const q = search.trim().toLowerCase();
  const levels = activeHierLevels(perfFiltros);
  const leaves = extractLeaves(resultado);
  const rows = [];

  // Con búsqueda activa, el Total nacional también se recalcula solo sobre
  // lo que coincide con la búsqueda — mismo criterio que los encabezados de
  // rama en walk() (ver bucketMostrado), para no mostrar el total de TODOS
  // los operadores cuando el usuario ya filtró por uno.
  const leavesMostradas = q
    ? leaves.filter(lf => [lf.cuenca, lf.ubicacion, lf.categoria, lf.operator].some(v => v && v.toLowerCase().includes(q)))
    : leaves;

  rows.push({ _id: "banner|Nacional", _type: "banner", label: "Nacional", ...dataObj(cats, cats.map(() => null)) });
  if (!forceDivisions) {
    rows.push({ _id: "total|Nacional", _type: "total", label: "Total", ...dataObj(cats, sumLeaves(leavesMostradas, cats)) });
  } else if (!ocultarTotalesUnidad) {
    // Con forceDivisions un solo "Total" mezclaría unidades distintas
    // (Mbd, MMpcd) — se muestran los 2 totales por unidad en su lugar.
    const mbdLeaves = leavesMostradas.filter(l => l.categoria === "Hidrocarburos líquidos (Mbd)");
    const mmpcdLeaves = leavesMostradas.filter(l => l.categoria === "Gas (MMpcd)");
    if (mbdLeaves.length) rows.push({ _id: "total|Nacional|mbd", _type: "totalmbd", label: "Total Mbd", ...dataObj(cats, sumLeaves(mbdLeaves, cats)) });
    if (mmpcdLeaves.length) rows.push({ _id: "total|Nacional|mmpcd", _type: "totalmmpcd", label: "Total MMpcd", ...dataObj(cats, sumLeaves(mmpcdLeaves, cats)) });
  }

  function renderOperators(bucket, key, indentDepth, qLocal, dims = {}) {
    const merged = new Map();
    for (const lf of bucket) {
      if (!merged.has(lf.operator)) merged.set(lf.operator, { data: cats.map(() => 0), code: lf.code });
      const acc = merged.get(lf.operator);
      lf.data.forEach((v, i) => { acc.data[i] += v ?? 0; });
    }
    let ops = [...merged].map(([label, v]) => ({ label, data: v.data, code: v.code }));
    ops = ops.filter(o => hasData(o.data) && (!qLocal || o.label.toLowerCase().includes(qLocal)));
    ops.sort((a, b) => a.label.localeCompare(b.label));
    for (const op of ops) {
      rows.push({
        _id: `o|${key}|${op.label}`, _type: "planoperator", _indent: 12 + indentDepth * 18 + 6,
        label: op.label, _code: op.code,
        // Dimensiones efectivamente activas en esta rama del árbol (Ambiente/
        // Cuenca/Categoría) — a diferencia de flattenGroups, aquí SÍ pueden
        // coexistir varias a la vez (AND de filtros), por eso van en objeto
        // aparte en vez de reusar _cuenca/_ub.
        _dimUbicacion: dims.ubicacion, _dimCuenca: dims.cuenca, _dimCategoria: dims.categoria,
        ...dataObj(cats, op.data),
      });
    }
  }

  // Si un nivel solo tiene un valor posible, no aporta mostrarlo en su propia
  // fila (repetiría el número de su padre): se combina su nombre con el del
  // siguiente nivel real ("Aguas someras · Cuencas del Sureste · Desarrollo").
  //
  // Búsqueda: aplica en CUALQUIER nivel (Ambiente, Cuenca, Producto), no solo
  // en la hoja — así se puede buscar directamente por nombre de cuenca (p. ej.
  // "Burgos"). Si el nombre del propio nivel coincide, se muestran todos sus
  // hijos sin seguir filtrando hacia abajo (mismo patrón que "nombreCoincide"
  // en la vista por operador).
  const walk = (subLeaves, levelIdx, pathKey, depth, applyVis, pendingLabels, qLocal, dims = {}) => {
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
      // Las chips de series (Petróleo/Condensado/Gas/…) controlan el nivel
      // Producto sin importar la profundidad — a diferencia de Ambiente, que
      // solo se filtra por "vis" en el nivel raíz (applyVis).
      if ((applyVis || lv.key === "categoria") && vis[name] === false) continue;
      const key = `${pathKey}/${name}`;

      const bucketTotal = sumLeaves(bucket, cats);
      if (!hasData(bucketTotal)) continue;
      const nextDims = { ...dims, [lv.key]: name };

      const nombreCoincide = !!qLocal && name.toLowerCase().includes(qLocal);
      // No basta con mirar el nombre de este nivel o el operador de la hoja:
      // el término buscado puede vivir en un nivel intermedio más abajo (p.
      // ej. buscar una cuenca estando parado en el nivel Ambiente) — hay que
      // revisar todos los campos de cada leaf del bucket antes de podar la rama.
      const tieneCoincidencia = !qLocal || nombreCoincide || bucket.some(lf =>
        [lf.cuenca, lf.ubicacion, lf.categoria, lf.operator].some(v => v && v.toLowerCase().includes(qLocal))
      );
      if (!tieneCoincidencia) continue;
      const qEfectiva = nombreCoincide ? "" : qLocal;

      // Con búsqueda activa (y sin que el propio nombre de esta rama sea lo
      // que coincidió), el número que se muestra en el encabezado debe
      // reflejar solo lo que coincide con la búsqueda (p. ej. un operador) —
      // no el total de TODOS los operadores de esa rama, que hacía parecer
      // que el operador buscado tenía producción en ramas donde no tiene
      // nada. Si el nombre de la propia rama coincidió (el usuario buscó esa
      // cuenca/ambiente), se sigue mostrando el total real sin filtrar.
      const bucketMostrado = (qLocal && !nombreCoincide)
        ? bucket.filter(lf => [lf.cuenca, lf.ubicacion, lf.categoria, lf.operator].some(v => v && v.toLowerCase().includes(qLocal)))
        : bucket;
      const bucketTotalMostrado = bucketMostrado === bucket ? bucketTotal : sumLeaves(bucketMostrado, cats);

      // Se muestra la suma real en todos los niveles (Ambiente, Cuenca,
      // Producto) — pedido explícito, aunque en Ambiente/Cuenca combine
      // productos de distintas unidades (Mbd, MMpcd). Excepción: cuando este
      // nivel es singleton (una sola categoría) Y su padre ya tiene fila
      // propia (no venía combinándose por el camino "· "), la cifra sería
      // idéntica a la del padre — se oculta por redundante.
      if (isSingleton) {
        const nextPending = [...pendingLabels, name];
        if (levelIdx + 1 < levels.length) {
          walk(bucket, levelIdx + 1, key, depth, false, nextPending, qEfectiva, nextDims);
        } else {
          const isOpen = !openGroups.has(key);
          // Redundante con la fila del padre solo mientras esté expandida
          // (visible el hijo de abajo); colapsada, es la única cifra visible.
          const esRedundante = pendingLabels.length === 0 && isOpen;
          rows.push({
            _id: `h|${key}`, _type: "planheader", _groupKey: key, _open: isOpen, _indent: 12 + depth * 18, _depth: depth,
            label: nextPending.join(" · "), ...dataObj(cats, esRedundante ? cats.map(() => null) : bucketTotalMostrado),
          });
          if (!isOpen) continue;
          renderOperators(bucket, key, depth + 1, qEfectiva, nextDims);
        }
        continue;
      }

      const label = pendingLabels.length ? [...pendingLabels, name].join(" · ") : name;
      const isOpen = !openGroups.has(key);
      rows.push({
        _id: `h|${key}`, _type: "planheader", _groupKey: key, _open: isOpen, _indent: 12 + depth * 18, _depth: depth,
        label, ...dataObj(cats, bucketTotalMostrado),
      });
      if (!isOpen) continue;

      if (levelIdx + 1 < levels.length) {
        walk(bucket, levelIdx + 1, key, depth + 1, false, [], qEfectiva, nextDims);
      } else {
        renderOperators(bucket, key, depth + 1, qEfectiva, nextDims);
      }
    }
  };

  walk(leaves, 0, "ml", 0, true, [], q);
  return rows;
}

// ── Aplanar según el modo activo ──────────────────────────────────────────────
function flattenGroups(resultado, visibleSeries, search, openGroups, groupBy, hideDivisions, forceDivisions, mostrarTotalesUnidad, ocultarTotalesUnidad) {
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

      if (mostrarTotalesUnidad && !ocultarTotalesUnidad) {
        const { mbd, mmpcd } = totalesPorUnidad(sg.rows, cats);
        if (mbd) rows.push({ _id: `${gk}|totalmbd`, _type: "totalmbd", _cuenca: "Nacional", _ub: sg.ubicacion, label: "Total Mbd", ...dataObj(cats, mbd) });
        if (mmpcd) rows.push({ _id: `${gk}|totalmmpcd`, _type: "totalmmpcd", _cuenca: "Nacional", _ub: sg.ubicacion, label: "Total MMpcd", ...dataObj(cats, mmpcd) });
      }
      pushOperatorRows(rows, sg.rows, gk, "Nacional", sg.ubicacion, cats, hideDivisions, groupBy, vis, q, forceDivisions, openGroups);
    }
    return rows;
  }

  // ── Por cuenca: cada cuenca como encabezado colapsable (estilo categoría) ─────
  if (groupBy === "cuenca") {
    // Banner NACIONAL + Total general arriba
    const nacSg = nacGroup?.subgroups?.find(s => s.ubicacion === "Nacional");
    if (nacSg) {
      rows.push({
        _id: "banner|Nacional", _type: "banner", _cuenca: "Nacional", _ub: "", label: "Nacional",
        ...Object.fromEntries(cats.map(c => [c, null])),
      });
      if (mostrarTotalesUnidad) {
        // Con productos de distintas unidades (Mbd/MMpcd), un solo "Total"
        // los mezclaría sin sentido — se muestran los 2 totales por unidad.
        const { mbd, mmpcd } = totalesPorUnidad(nacSg.rows, cats);
        if (mbd && !ocultarTotalesUnidad) rows.push({ _id: "total|Nacional|mbd", _type: "totalmbd", _cuenca: "Nacional", _ub: "", label: "Total Mbd", ...dataObj(cats, mbd) });
        if (mmpcd && !ocultarTotalesUnidad) rows.push({ _id: "total|Nacional|mmpcd", _type: "totalmmpcd", _cuenca: "Nacional", _ub: "", label: "Total MMpcd", ...dataObj(cats, mmpcd) });
      } else {
        const { total } = mergeSubgroups([nacSg], cats);
        rows.push({
          _id: "total|Nacional", _type: "total", _cuenca: "Nacional", _ub: "", label: "Total",
          ...Object.fromEntries(cats.map((c, ci) => [c, total[ci]])),
        });
      }
    }

    for (const g of resultado.groups) {
      if (g.cuenca === "Nacional") continue;
      if (vis[g.cuenca] === false) continue;

      const gk     = `cuenca|${g.cuenca}`;
      const sgRows = g.subgroups?.[0]?.rows ?? [];
      const nombreCoincide = q ? g.cuenca.toLowerCase().includes(q) : false;
      // "Producción por operador": cada empresa trae Producto (subtotal) →
      // Contrato (hoja) — mergeSubgroups aplanaría el subtotal y mezclaría
      // unidades (Mbd/MMpcd) en un solo total, por eso aquí se respeta la
      // jerarquía con pushOperatorRows en vez del merge plano de abajo.
      if (sgRows.some(r => r.type === "subtotal")) {
        // También cuenta como match un subtotal intermedio (Entidad Federativa,
        // Licitación…) — antes solo miraba las hojas ("operator") y una
        // búsqueda por el nombre de ese nivel intermedio (p. ej. "Campeche")
        // no encontraba nada aunque sí existiera.
        const contratoCoincide = q ? sgRows.some(r => (r.type === "operator" || r.type === "subtotal") && r.label.toLowerCase().includes(q)) : true;
        if (q && !nombreCoincide && !contratoCoincide) continue; // ni la empresa ni ningún contrato/subtotal coincide con la búsqueda
        // Si coincide el nombre de la empresa, se muestran todos sus contratos
        // (la búsqueda ya cumplió su propósito a ese nivel).
        const qEfectiva = nombreCoincide ? "" : q;
        const isOpen = q ? true : openGroups.has(gk); // autoexpandir resultados de búsqueda
        rows.push({
          _id: `ph|${gk}`, _type: "planheader",
          _cuenca: g.cuenca, _ub: "", _groupKey: gk, _open: isOpen, label: g.cuenca,
          ...Object.fromEntries(cats.map(c => [c, null])),
        });
        if (!isOpen) continue;
        if (mostrarTotalesUnidad && !ocultarTotalesUnidad) {
          const { mbd, mmpcd } = totalesPorUnidad(sgRows, cats);
          if (mbd) rows.push({ _id: `${gk}|totalmbd`, _type: "totalmbd", _cuenca: g.cuenca, _ub: "", label: "Total Mbd", ...dataObj(cats, mbd) });
          if (mmpcd) rows.push({ _id: `${gk}|totalmmpcd`, _type: "totalmmpcd", _cuenca: g.cuenca, _ub: "", label: "Total MMpcd", ...dataObj(cats, mmpcd) });
        }
        pushOperatorRows(rows, sgRows, gk, g.cuenca, "Nacional", cats, false, groupBy, vis, qEfectiva, true, openGroups);
        continue;
      }

      const { total, ops } = mergeSubgroups(g.subgroups, cats);
      // Si la búsqueda solo coincide con una hoja de este grupo (p. ej. una
      // empresa), se abre aunque el usuario lo haya colapsado a mano —
      // si no, quedaría "encontrado" pero invisible.
      const nombreCoincideCuenca = q ? g.cuenca.toLowerCase().includes(q) : false;
      const hijoCoincide = q && !nombreCoincideCuenca ? ops.some(o => o.label.toLowerCase().includes(q)) : false;
      const isOpen = openGroups.has(gk) || hijoCoincide;

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

// ── Ordenar por columna ────────────────────────────────────────────────────────
// Solo se reordenan las filas de "dato" (hoja: operador/producto), nunca los
// encabezados de categoría/subcategoría (banner, cuenca, ubicación, planheader,
// subtotal, total…) — se reordena cada corrida contigua de filas hoja por
// separado, así cada grupo/subcategoría conserva su propio orden interno sin
// mezclarse con el de otro grupo.
const SORTABLE_ROW_TYPES = new Set(["operator", "planoperator"]);

function sortLeafRuns(rows, sortState) {
  if (!sortState) return rows;
  const { col, dir } = sortState;
  const result = [...rows];
  let i = 0;
  while (i < result.length) {
    if (!SORTABLE_ROW_TYPES.has(result[i]._type)) { i++; continue; }
    let j = i;
    while (j < result.length && SORTABLE_ROW_TYPES.has(result[j]._type)) j++;
    const run = result.slice(i, j);
    run.sort((a, b) => {
      const av = a[col];
      const bv = b[col];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir === "asc" ? av - bv : bv - av;
    });
    result.splice(i, j - i, ...run);
    i = j;
  }
  return result;
}

// Flechita de orden en el encabezado de columna: apagada (gris tenue) cuando
// esa columna no es la que ordena, resaltada con la dirección activa cuando sí.
function SortIcon({ active, dir }) {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      style={{ opacity: active ? 1 : 0.35, flexShrink: 0 }}>
      {dir === "asc"
        ? <polyline points="2.5,6 5,3 7.5,6" />
        : <polyline points="2.5,4 5,7 7.5,4" />}
    </svg>
  );
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
const PERIOD_LABEL = { annually: "Anual", monthly: "Mensual" };

function Toolbar({ search, setSearch, hiddenCols, setHiddenCols, categories, titulo, filtroLabel, period, start_year, end_year, opCount, entityLabel = "operadores", sumaDisponible, sumaOculta, setSumaOculta, totalesUnidadDisponible, totalesUnidadOcultos, setTotalesUnidadOcultos, isMonthly, searchPlaceholder = "Buscar Operador o contrato", onExportExcel, onExportHistorico, onOpenReport }) {
  const [showCols, setShowCols] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [exportandoTodo, setExportandoTodo] = useState(false);

  async function handleExportExcel() {
    setExportando(true);
    try { await onExportExcel(); } finally { setExportando(false); }
  }

  async function handleExportHistorico() {
    setExportandoTodo(true);
    try { await onExportHistorico(); } finally { setExportandoTodo(false); }
  }

  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      {titulo && (
        <div className="flex flex-col justify-center mr-2 min-w-0 gap-1">
          <span style={{ fontFamily: "'Patria', Georgia, serif", color: "#10312B", fontSize: 17, fontWeight: 700, lineHeight: 1.1, whiteSpace: "nowrap" }}>
            {titulo}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {period && (
              <span style={{ fontFamily: "'Noto Sans', sans-serif", fontSize: 10, color: "#94a3b8", fontWeight: 500, letterSpacing: "0.03em", whiteSpace: "nowrap" }}>
                {PERIOD_LABEL[period] ?? period} · {start_year} – {end_year}
              </span>
            )}
            {filtroLabel && (
              <span className="inline-flex items-center gap-1 rounded-full whitespace-nowrap"
                style={{ background: "#e6f4f1", color: "#0d6a5c", fontSize: 11, fontWeight: 600, padding: "2px 9px 2px 7px", fontFamily: "'Noto Sans', sans-serif" }}>
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 3h12l-4.5 5.5V13l-3 1.5V8.5Z" />
                </svg>
                {filtroLabel}
              </span>
            )}
          </div>
        </div>
      )}
      <div className="flex-1" />
      {totalesUnidadDisponible && (
        <button
          onClick={() => setTotalesUnidadOcultos(v => !v)}
          title={totalesUnidadOcultos ? "Mostrar totales Mbd/MMpcd" : "Ocultar totales Mbd/MMpcd"}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-slate-500 border border-slate-200 rounded-lg bg-white hover:bg-slate-50"
        >
          {totalesUnidadOcultos ? (
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" opacity="0.4" />
              <circle cx="8" cy="8" r="2" opacity="0.4" />
              <line x1="1.5" y1="1.5" x2="14.5" y2="14.5" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" />
              <circle cx="8" cy="8" r="2" />
            </svg>
          )}
          Totales Mbd/MMpcd
        </button>
      )}
      <div className="relative min-w-[180px] max-w-[240px]">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="6.5" cy="6.5" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/>
        </svg>
        <input
          className="w-full pl-8 pr-8 py-1.5 text-[13px] text-slate-800 placeholder-slate-400 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-400 bg-white"
          placeholder={searchPlaceholder}
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

      <button onClick={handleExportExcel} disabled={exportando} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-60">
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 2v10M4 8l4 4 4-4"/><path d="M2 14h12"/>
        </svg>
        {exportando ? "Exportando…" : "Exportar Excel"}
      </button>

      {onExportHistorico && (
        <button onClick={handleExportHistorico} disabled={exportandoTodo}
          title="Descarga el histórico completo de esta tabla, sin filtros ni periodo — consulta directa a la base"
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-60">
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="2" width="12" height="12" rx="1.5" />
            <path d="M5 6.5h6M5 9h6M5 11.5h3.5" />
          </svg>
          {exportandoTodo ? "Descargando…" : "Descargar todo"}
        </button>
      )}

      <button onClick={onOpenReport}
        title="Arma un PDF personalizado eligiendo qué bloques incluir y en qué orden"
        className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50">
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2.5" y="1.5" width="11" height="13" rx="1.2" />
          <path d="M5 5h6M5 7.5h6M5 10h3.5" />
        </svg>
        Generar reporte
      </button>

      <span className="text-[11px] text-slate-400 whitespace-nowrap">
        {opCount} {entityLabel}{search && ` · "${search}"`}
      </span>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function DynamicTable({ resultado, visibleSeries, groupBy, titulo, period, start_year, end_year, compareMode, entityLabel, forceDivisions, filtros, rowHeaderLabel, searchPlaceholder, onRowClick, onCellClick, flatExportEntidad, historicoTopic, preserveColumnOrder }) {
  const { pendingBusqueda, setPendingBusqueda } = useExplorer();
  const [search,     setSearch]     = useState("");

  // Búsqueda pendiente al saltar desde otro tema (p. ej. Asignaciones →
  // Producción por campo con el campo ya elegido) — se aplica una sola vez.
  useEffect(() => {
    if (pendingBusqueda == null) return;
    setSearch(pendingBusqueda);
    setPendingBusqueda(null);
  }, [pendingBusqueda, setPendingBusqueda]);
  const [hiddenCols, setHiddenCols] = useState(new Set());
  const [openGroups, setOpenGroups] = useState(() => initOpenGroups(resultado, groupBy, preserveColumnOrder));
  const [hoveredRow,  setHoveredRow]  = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [hoveredCol,  setHoveredCol]  = useState(null);
  const [sumaOculta,  setSumaOculta]  = useState(false);
  const [totalesUnidadOcultos, setTotalesUnidadOcultos] = useState(false);
  const [sortState, setSortState] = useState(null); // { col, dir: "asc" | "desc" }

  function toggleSort(col) {
    setSortState(prev => {
      if (!prev || prev.col !== col) return { col, dir: "desc" };
      if (prev.dir === "desc") return { col, dir: "asc" };
      return null;
    });
  }

  // Resetear grupos abiertos al cambiar de modo o al cambiar los datos (filtros)
  useEffect(() => {
    setOpenGroups(initOpenGroups(resultado, groupBy, preserveColumnOrder));
  }, [groupBy, resultado]);

  function toggleGroup(key) {
    setOpenGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  // Distintas partes de la tabla usan convenciones opuestas para el mismo Set
  // "openGroups" — algunas filas están abiertas cuando su llave SÍ está en el
  // Set (p. ej. cada empresa en la vista "por operador"), otras cuando NO lo
  // está (p. ej. cada producto colapsable, con llave "sub|...", o el
  // planheader de ambiente/cuenca/producto, con llave "ml/..."). La convención
  // de cada llave se deduce de su propio prefijo (no de comparar el estado ya
  // renderizado contra el Set, que fallaba en dejar sin tocar los productos
  // anidados dentro de una empresa al Contraer/Expandir todo).
  function toggleAllGroups() {
    setOpenGroups(prev => {
      const targetOpen = !hasOpenGroups;
      let next = new Set(prev);
      // Expandir todo: limpiar las llaves de convención "cerrado si está en
      // el Set" (planheader de Ambiente/Cuenca/Producto con prefijo "ml/", y
      // el subtotal de producto colapsable con prefijo "sub|") abre TODOS los
      // niveles de un tirón, incluidos los que estaban ocultos detrás de un
      // padre todavía cerrado (p. ej. los productos dentro de cada empresa en
      // "por operador", o el nivel Producto en el drill-down de Campo/
      // Asignación) — iterar solo "rows" no bastaba, porque un nivel cerrado
      // nunca renderiza a sus hijos y sus llaves no aparecían para abrirlas.
      if (targetOpen) {
        next = new Set([...next].filter(k => !k.startsWith("ml/") && !k.startsWith("sub|")));
      }
      rows.forEach(r => {
        if (r._groupKey == null) return;
        // El envoltorio interno "Nacional" (fila tipo "ubicacion" sin cuenca
        // real detrás, usado en Contrato/Campo/Operadores sin filtrar) nunca
        // debe cerrarse: es solo un gate interno, no una categoría real — si
        // se cierra, esconde de un tirón TODAS las categorías de producto que
        // "Contraer todo" debía dejar visibles (colapsadas, no ocultas).
        if (r._type === "ubicacion" && r.label === "Nacional") return;
        const convencionInvertida = r._groupKey.startsWith("sub|") || r._groupKey.startsWith("ml/");
        const debeEstarEnSet = convencionInvertida ? !targetOpen : targetOpen;
        debeEstarEnSet ? next.add(r._groupKey) : next.delete(r._groupKey);
      });
      return next;
    });
  }

  const { perfFiltros, perfOpciones, prodOpciones } = useExplorer();
  const filtrosActivos = filtros ?? perfFiltros;
  // Dimensiones con filtro activo → niveles de anidamiento (Ambiente > Cuenca > Categoría).
  const hierLevels = activeHierLevels(filtrosActivos);
  const hideDivisions = !forceDivisions && filtrosActivos.categorias.length === 0;

  // Resumen legible de los filtros activos, para mostrar junto al título
  // (p. ej. "Cuenca Geológica: Burgos · Categoría: Desarrollo") — mismo
  // vocabulario que ya usa el export a Excel. Si la selección cubre todas
  // las opciones disponibles de esa dimensión, se muestra solo el nombre de
  // la dimensión (equivale a "todas", no aporta listar cada una).
  const filtroLabel = useMemo(() => {
    const partes = [];
    const parte = (nombre, seleccion, universo) => {
      const sel = seleccion ?? [];
      if (!sel.length) return;
      const esTodas = universo?.length && sel.length >= universo.length;
      partes.push(esTodas ? nombre : `${nombre}: ${sel.join(", ")}`);
    };
    // Perforación (perfOpciones) y Producción (prodOpciones) traen cada una su
    // propio universo de opciones — según el tema activo solo una de las dos
    // está poblada, se usa la que tenga datos.
    parte("Cuenca Geológica", filtrosActivos?.cuencas, perfOpciones?.cuencas?.length ? perfOpciones.cuencas : prodOpciones?.cuencas);
    parte("Ambiente", filtrosActivos?.ubicaciones, perfOpciones?.ubicaciones?.length ? perfOpciones.ubicaciones : prodOpciones?.ubicaciones);
    const categoriasReales = (filtrosActivos?.categorias ?? []).filter(c => c !== "_producto");
    parte("Categoría", categoriasReales, perfOpciones?.categorias);
    parte("Operador", filtrosActivos?.operadores, perfOpciones?.operadores);
    return partes.join(" · ");
  }, [filtrosActivos, perfOpciones, prodOpciones]);

  const categories = resultado?.categories ?? [];
  const visCats    = categories.filter(c => !hiddenCols.has(c));

  // forceDivisions ya identifica exactamente los temas de Producción donde
  // cada entidad/grupo mezcla productos de distintas unidades (Mbd/MMpcd):
  // Cuenca, Contratos, Campos, Asignaciones, Estado, Gcompo y Operadores —
  // en todos aplican los mismos 2 totales por unidad, ocultables.
  const mostrarTotalesUnidad = forceDivisions;
  const rowsSinOrdenar = useMemo(
    () => hierLevels.length > 0
      ? flattenMultiLevel(resultado, filtrosActivos, openGroups, search, visibleSeries ?? {}, forceDivisions, totalesUnidadOcultos)
      : flattenGroups(resultado, visibleSeries, search, openGroups, groupBy, hideDivisions, forceDivisions, mostrarTotalesUnidad, totalesUnidadOcultos),
    [resultado, visibleSeries, search, openGroups, filtrosActivos, hierLevels.length, hideDivisions, forceDivisions, groupBy, mostrarTotalesUnidad, totalesUnidadOcultos]
  );
  const rows = useMemo(() => sortLeafRuns(rowsSinOrdenar, sortState), [rowsSinOrdenar, sortState]);
  const cuencaCount = useMemo(() => rows.filter(r => r._type === "cuenca").length, [rows]);
  // Índice de la primera fila que sí se renderiza (la fila "cuenca" se
  // descarta cuando cuencaCount === 1, así que no cuenta como "primera").
  const primeraFilaVisibleIdx = rows.findIndex(r => !(r._type === "cuenca" && cuencaCount === 1));

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

  // En la jerarquía multinivel (Ambiente > Cuenca > Producto), las filas
  // "planoperator" son el producto/hoja final, no la entidad que describe
  // entityLabel (p. ej. "ambientes") — ahí se cuenta el primer nivel real
  // (profundidad 0) en vez de las hojas.
  const opCount = hierLevels.length > 0
    ? new Set(rows.filter(r => r._type === "planheader" && r._depth === 0).map(r => r.label)).size
    : new Set(
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

  // Mapa de columna → índice (para colorear, vista anual)
  const colYearIdx = Object.fromEntries(visCats.map((c, i) => [c, i]));

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

  // Modo "Comparar años": exactamente 2 años, en orden cronológico + columna de diferencia.
  const isCompare = !!compareMode && !isMonthly && visCats.length === 2;

  // Columna de suma a la derecha con 2+ años (vista anual); en vista mensual
  // se agrega al final de cada año en vez de una sola global.
  const sumaDisponible = isMonthly ? visCats.length > 0 : visCats.length >= 2;
  const showSuma = sumaDisponible && !sumaOculta;
  const extraSumaCols = isMonthly ? (showSuma ? yearGroups.length : 0) : (showSuma ? 1 : 0);

  // En modo anual el año más reciente va primero; en modo comparación se
  // respeta el orden cronológico (antes → después). Columnas que no son años
  // (p. ej. Ambiente en Pozos/Inversión comprometida) usan el orden tal cual
  // viene del backend — invertirlas no tiene sentido cronológico.
  const displayCats = isMonthly || isCompare || preserveColumnOrder ? visCats : [...visCats].reverse();

  // Resalte de columna al hacer hover (overlay translúcido, no pisa el color de fondo existente)
  const colHighlightShadow = "inset 0 0 0 9999px rgba(13,148,136,0.12)";

  // Universal: cualquier fila colapsable (empresa, ambiente, cuenca,
  // producto…) ya trae su "_open" resuelto al aplanar — sin importar qué
  // convención de "openGroups" use esa rama. El envoltorio interno "Nacional"
  // (ver toggleAllGroups) se excluye: siempre está abierto, así que contarlo
  // dejaría "hasOpenGroups" en true para siempre e impediría mostrar
  // "Expandir todo" una vez colapsadas las categorías reales.
  const hasOpenGroups = rows.some(r => r._groupKey != null && r._open && !(r._type === "ubicacion" && r.label === "Nacional"));

  const hasCollapsible = rows.some(r => r._groupKey != null);
  const hasBanner = rows.some(r => r._type === "banner");
  // Cuando el encabezado de la columna de nombres tiene su propia etiqueta
  // (p. ej. "Privados" en Operadores filtrado a un solo grupo), esa etiqueta
  // ES la "categoría padre" — el botón va junto a ella, en el encabezado, no
  // junto a la primera empresa. Con banner "Nacional" (Cuenca/Gcompo/etc.), el
  // botón vive en esa misma fila. Sin ninguno de los dos (Contrato/Campo/
  // Asignación sin nodo "Nacional" con banner propio), se ofrece junto a la
  // PRIMERA fila renderizada, sea cual sea su tipo.
  const showHeaderToggle = hasCollapsible && !hasBanner && !!rowHeaderLabel;
  const showToggleEnPrimeraFila = hasCollapsible && !hasBanner && !rowHeaderLabel;

  function ToggleTodoBtn({ dark }) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); toggleAllGroups(); }}
        title={hasOpenGroups ? "Contraer todos los grupos" : "Expandir todos los grupos"}
        className="inline-flex items-center gap-1 px-2 py-0.5 text-[10.5px] font-medium rounded-md border transition-colors normal-case tracking-normal shrink-0"
        style={dark
          ? { color: "#a7f3d0", borderColor: "rgba(167,243,208,0.35)", background: "rgba(255,255,255,0.06)" }
          : { color: "#0f766e", borderColor: "#99f6e4", background: "#f0fdfa" }}
        onMouseEnter={e => { e.currentTarget.style.background = dark ? "rgba(255,255,255,0.14)" : "#ccfbf1"; }}
        onMouseLeave={e => { e.currentTarget.style.background = dark ? "rgba(255,255,255,0.06)" : "#f0fdfa"; }}
      >
        <svg className={`w-3 h-3 transition-transform duration-150 ${hasOpenGroups ? "" : "rotate-180"}`}
          viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <polyline points="2.5,4 6,7.5 9.5,4" />
        </svg>
        {hasOpenGroups ? "Contraer todo" : "Expandir todo"}
      </button>
    );
  }

  // Nivel de sangría de cada fila tal como se ve en pantalla (misma jerarquía
  // visual: Nacional/banner en el tope, luego subtotales de producto/ambiente,
  // luego el detalle/hoja) — para que el Excel se lea igual que la tabla.
  function nivelDeFila(row) {
    if (row._indent != null) return Math.max(0, Math.round((row._indent - 12) / 18));
    if (row._type === "banner" || row._type === "cuenca" || row._type === "ubicacion") return 0;
    if (row._type === "total" || row._type === "subtotal" || row._type === "subtotalcol" || row._type === "planheader" || row._type === "totalmbd" || row._type === "totalmmpcd") return 1;
    return 2;
  }

  // Descripción de lo que el usuario tiene seleccionado/filtrado en este
  // momento (Cuenca/Ambiente activos, grupo Pemex/Privadas, búsqueda) — el
  // mismo contexto que se ve en pantalla, para que el archivo no quede
  // "mudo" sobre qué recorte de datos representa. Compartido entre "Exportar
  // Excel" y "Generar reporte" (PDF).
  function buildFiltrosPartes() {
    const partes = [];
    if (filtrosActivos?.cuencas?.length) partes.push(`Cuenca Geológica: ${filtrosActivos.cuencas.join(", ")}`);
    else partes.push("Cuenca Geológica: Todas");
    if (filtrosActivos?.ubicaciones?.length) partes.push(`Ambiente: ${filtrosActivos.ubicaciones.join(", ")}`);
    else partes.push("Ambiente: Todos");
    if (rowHeaderLabel) partes.push(`Grupo: ${rowHeaderLabel}`);
    if (search.trim()) partes.push(`Búsqueda: "${search.trim()}"`);
    return partes;
  }

  async function exportExcel() {
    const { exportarProduccionExcel } = await import("../../utils/exportExcel");
    const tablaPivot = flatExportEntidad
      ? buildFlatExport(resultado, filtrosActivos, visibleSeries, search, displayCats, flatExportEntidad, "Cant. pozos")
      : buildPivotExport(resultado, filtrosActivos, visibleSeries, search, displayCats, entityLabel);
    const subtitulo = `Filtros — ${buildFiltrosPartes().join("\n")}`;

    await exportarProduccionExcel({
      titulo: titulo || "Datos",
      subtitulo,
      periodoNota: `${PERIOD_LABEL[period] ?? period} — ${start_year} — ${end_year}`,
      tablaPivot,
      nombreArchivo: `TIH_${titulo || "datos"}.xlsx`,
    });
  }

  // Reporte PDF: usa las mismas filas ya calculadas para lo que se ve en
  // pantalla (con la sangría por nivel de nivelDeFila) — a diferencia del
  // export a Excel (que aplana/pivotea), aquí se busca que la tabla del PDF
  // se lea igual que el árbol en pantalla.
  const REPORTE_TIPOS_NEGRITA = new Set([
    "banner", "cuenca", "ubicacion", "total", "subtotal", "subtotalcol",
    "planheader", "totalmbd", "totalmmpcd", "totaloperator",
  ]);
  function buildReporteTabla() {
    const columnas = ["", ...displayCats];
    const filas = [];
    const filasNegritas = new Set();
    rows.forEach((row, i) => {
      const nivel = nivelDeFila(row);
      const label = "    ".repeat(nivel) + (row.label ?? "");
      const valores = displayCats.map(c => {
        const v = row[c];
        return v === null || v === undefined ? "" : (v === 0 ? "—" : v.toLocaleString("es-MX"));
      });
      filas.push([label, ...valores]);
      if (REPORTE_TIPOS_NEGRITA.has(row._type)) filasNegritas.add(i);
    });
    return { columnas, filas, filasNegritas };
  }

  const [reportModalOpen, setReportModalOpen] = useState(false);

  async function generarReportePdf(bloquesSeleccionados) {
    const { exportarReportePdf } = await import("../../utils/exportPdf");
    const bloques = [];
    for (const id of bloquesSeleccionados) {
      if (id === "filtros") {
        bloques.push({ tipo: "filtros", lineas: buildFiltrosPartes() });
      } else if (id === "tabla") {
        bloques.push({ tipo: "titulo", texto: titulo || "Tabla de datos" });
        bloques.push({ tipo: "tabla", ...buildReporteTabla() });
      }
    }
    await exportarReportePdf({
      titulo: titulo || "Reporte",
      periodoNota: `${PERIOD_LABEL[period] ?? period} — ${start_year} — ${end_year}`,
      bloques,
      nombreArchivo: `TIH_${titulo || "reporte"}_reporte.pdf`,
    });
  }

  // "Descargar todo": consulta directa a la tabla de origen, sin filtros ni
  // periodo — histórico completo (pedido explícito, distinto de "Exportar
  // Excel" que respeta lo que está viendo el usuario en pantalla).
  async function exportHistorico() {
    const [{ exportarProduccionExcel }, { fetchPerforacionHistorico }] = await Promise.all([
      import("../../utils/exportExcel"),
      import("../../api/client"),
    ]);
    const { columnas, filas, periodo_nota } = await fetchPerforacionHistorico(historicoTopic);
    await exportarProduccionExcel({
      titulo: titulo ? `${titulo} — Histórico completo` : "Histórico completo",
      periodoNota: periodo_nota,
      tablaHistorica: { columnas, filas },
      nombreArchivo: `TIH_${titulo || "datos"}_historico.xlsx`,
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
      <Toolbar search={search} setSearch={setSearch} hiddenCols={hiddenCols}
        setHiddenCols={setHiddenCols} categories={categories}
        titulo={titulo} filtroLabel={filtroLabel} period={period} start_year={start_year} end_year={end_year}
        opCount={opCount} entityLabel={entityLabel}
        sumaDisponible={sumaDisponible} sumaOculta={sumaOculta} setSumaOculta={setSumaOculta} isMonthly={isMonthly}
        totalesUnidadDisponible={mostrarTotalesUnidad} totalesUnidadOcultos={totalesUnidadOcultos} setTotalesUnidadOcultos={setTotalesUnidadOcultos}
        onExportExcel={exportExcel}
        onExportHistorico={historicoTopic ? exportHistorico : undefined}
        onOpenReport={() => setReportModalOpen(true)}
        {...(searchPlaceholder ? { searchPlaceholder } : {})} />

      {reportModalOpen && (
        <ReportBuilderModal
          onClose={() => setReportModalOpen(false)}
          onGenerar={generarReportePdf}
        />
      )}

      <div className="rounded-xl border border-slate-200 shadow-sm bg-white overflow-auto" style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
          <table className="border-collapse" style={{ width: isMonthly ? "100%" : "auto", tableLayout: isMonthly ? "fixed" : "auto", minWidth: isMonthly ? `${240 + visCats.length * 68 + (showSuma ? yearGroups.length * 76 : 0)}px` : undefined }}>
            {isMonthly && (
              <colgroup>
                <col style={{ width: "240px" }} />
                {yearGroups.map(([year, cols]) => (
                  <Fragment key={year}>
                    {cols.map(c => <col key={c} />)}
                    {showSuma && <col key={`${year}-suma`} style={{ width: "76px" }} />}
                  </Fragment>
                ))}
              </colgroup>
            )}
            <thead style={{ position: "sticky", top: 0, zIndex: 30 }}>
              {isMonthly ? (
                <>
                  {/* Fila 1: años */}
                  <tr className="border-b border-slate-200">
                    <th className="static sm:sticky sm:left-0 bg-white z-10 px-4 py-2" style={{ minWidth: 280 }} />
                    {yearGroups.map(([year, cols], yi) => {
                      const clr = YEAR_COLORS[yi % YEAR_COLORS.length];
                      return (
                        <th key={year}
                          colSpan={cols.length + (showSuma ? 1 : 0)}
                          className="text-center px-2 py-2 text-[12px] font-bold whitespace-nowrap"
                          style={{ minWidth: cols.length * 68, background: clr.bg, color: clr.text, borderLeft: yi > 0 ? `2px solid ${clr.border}` : undefined }}
                        >
                          {year}
                        </th>
                      );
                    })}
                  </tr>
                  {/* Fila 2: meses */}
                  <tr className="border-b-2 border-slate-300">
                    <th
                      className="text-left static sm:sticky sm:left-0 z-10 px-4 py-2 text-[13px] font-bold text-white uppercase tracking-widest"
                      style={{ minWidth: 280, background: rowHeaderLabel ? "linear-gradient(90deg,#10312B,#1a4a3a)" : "#fff" }}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span>{rowHeaderLabel}</span>
                        {showHeaderToggle && <ToggleTodoBtn dark />}
                      </span>
                    </th>
                    {yearGroups.map(([year, cols], yi) => {
                      const clr = YEAR_COLORS[yi % YEAR_COLORS.length];
                      return (
                        <Fragment key={year}>
                          {cols.map((c, ci) => {
                            const mes = parseInt(c.split("-")[1], 10);
                            return (
                              <th key={c}
                                className="text-center px-1 py-1.5 text-[11px] font-semibold whitespace-nowrap cursor-pointer select-none"
                                style={{
                                  minWidth: 68,
                                  background: clr.monthBg,
                                  color: clr.text,
                                  borderLeft: ci === 0 && yi > 0 ? `2px solid ${clr.border}` : undefined,
                                  boxShadow: hoveredCol === c ? colHighlightShadow : undefined,
                                }}
                                onMouseEnter={() => setHoveredCol(c)}
                                onMouseLeave={() => setHoveredCol(null)}
                                onClick={() => toggleSort(c)}
                              >
                                <span className="inline-flex items-center gap-0.5">
                                  {MESES[mes - 1]}
                                  <SortIcon active={sortState?.col === c} dir={sortState?.col === c ? sortState.dir : null} />
                                </span>
                              </th>
                            );
                          })}
                          {showSuma && (
                            <th className="text-center px-1 py-1.5 text-[11px] font-semibold whitespace-nowrap"
                              style={{ minWidth: 76, background: "#eef2ff", color: "#6366f1" }}>
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
                  <th
                    className="text-left px-4 py-3 static sm:sticky sm:left-0 z-10 text-[13px] font-bold text-white uppercase tracking-widest"
                    style={{ minWidth: 160, background: rowHeaderLabel ? "linear-gradient(90deg,#10312B,#1a4a3a)" : "#fff" }}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span>{rowHeaderLabel}</span>
                      {showHeaderToggle && <ToggleTodoBtn dark />}
                    </span>
                  </th>
                  {displayCats.map((c) => {
                    const clr = ANNUAL_COLORS[colYearIdx[c] % ANNUAL_COLORS.length];
                    return (
                      <th key={c}
                        className="text-center px-2 py-3 text-[13px] font-bold whitespace-nowrap cursor-pointer select-none"
                        style={{ minWidth: 72, background: clr.bg, color: clr.text, boxShadow: hoveredCol === c ? colHighlightShadow : undefined }}
                        onMouseEnter={() => setHoveredCol(c)}
                        onMouseLeave={() => setHoveredCol(null)}
                        onClick={() => toggleSort(c)}
                      >
                        <span className="inline-flex items-center gap-0.5">
                          {c}
                          <SortIcon active={sortState?.col === c} dir={sortState?.col === c ? sortState.dir : null} />
                        </span>
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
              {rows.map((row, idx) => {
                const cfg         = TYPE_STYLE[row._type] ?? TYPE_STYLE.operator;
                const bg          = ROW_BG[row._type];
                // El envoltorio interno "Nacional" (fila "ubicacion" sin cuenca
                // real detrás, ver toggleAllGroups) es solo un gate estructural,
                // no una categoría real — no debe poder colapsarse con clic
                // directo (encogería todo el desglose de abajo sin avisar).
                const esWrapperNacional = row._type === "ubicacion" && row.label === "Nacional";
                const isCollapse  = COLLAPSIBLE.has(row._type) && !esWrapperNacional;
                const useColSpan  = row._type === "ubicacion" || row._type === "cuenca" || row._type === "banner";
                const isCuencaRow = row._type === "cuenca";

                if (isCuencaRow && cuencaCount === 1) return null;

                const isDark      = isCuencaRow || row._type === "ubicacion" || row._type === "banner";
                // El botón "Contraer/Expandir todo" va junto al banner
                // "Nacional" si existe, o si no (y no hay rowHeaderLabel para
                // mostrarlo en el encabezado) junto a la primera fila VISIBLE,
                // sea cual sea (la fila "cuenca" se descarta arriba cuando
                // cuencaCount === 1, así que no cuenta como "primera").
                const esPrimeraVisible = idx === primeraFilaVisibleIdx;
                const isSelected  = selectedRow === row._id && !isDark;
                const isHovered   = hoveredRow === row._id && !isDark && !isSelected;
                const selectedBg  = "#ccfbf1";
                const hoverBg     = "#e6f4f1";
                const tone        = row._type === "planheader" ? PLANHEADER_TONES[(row._depth ?? 0) % PLANHEADER_TONES.length] : null;
                // Celdas con desglose por pozo (Perforación): solo filas hoja de
                // operador, ver onCellClick en ChartArea.
                const celdaClickeable = !!onCellClick && (row._type === "operator" || row._type === "planoperator");

                return (
                  <tr key={row._id}
                    className={`${bg ?? ""} ${isCollapse || row._code ? "cursor-pointer select-none" : ""} transition-colors duration-100`}
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
                      if (row._code && onRowClick) onRowClick(row._code, row.label);
                    }}
                  >
                    <td className={`px-4 py-[5px] whitespace-nowrap overflow-hidden text-ellipsis static sm:sticky sm:left-0 ${cfg.label}`}
                      style={{
                        zIndex: isDark ? 25 : 10,
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
                        {((row._type === "banner" && hasCollapsible) || (showToggleEnPrimeraFila && esPrimeraVisible)) && (
                          <ToggleTodoBtn dark={isDark || !!tone} />
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
                              const esClick = celdaClickeable && val > 0;
                              return (
                                <td key={c}
                                  className={`px-2 py-[5px] text-center tabular-nums ${
                                    val === null ? "" : val === 0 ? "text-slate-300 text-[12px]" : cfg.num
                                  } ${esClick ? "cursor-pointer underline decoration-dotted decoration-slate-300 hover:decoration-teal-500 hover:text-teal-700" : ""}`}
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
                                  onClick={esClick ? (e) => { e.stopPropagation(); onCellClick(row, c, val); } : undefined}
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
                      const esClick = celdaClickeable && val > 0;
                      return (
                        <td key={c}
                          className={`px-2 py-[5px] text-center tabular-nums ${
                            val === null ? "" : val === 0 ? "text-slate-300 text-[12px]" : cfg.num
                          } ${esClick ? "cursor-pointer underline decoration-dotted decoration-slate-300 hover:decoration-teal-500 hover:text-teal-700" : ""}`}
                          style={{
                            background: clr.bg + "80",
                            ...(tone && val !== 0 ? { color: tone.text } : {}),
                            ...(hoveredCol === c ? { boxShadow: colHighlightShadow } : {}),
                          }}
                          onMouseEnter={() => setHoveredCol(c)}
                          onMouseLeave={() => setHoveredCol(null)}
                          onClick={esClick ? (e) => { e.stopPropagation(); onCellClick(row, c, val); } : undefined}
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
