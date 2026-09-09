import { useState, useMemo, useEffect, Fragment } from "react";
import { useExplorer } from "../../store/useExplorer";
import ReportBuilderModal from "./ReportBuilderModal";
import { normalizarSiMayusculas } from "../../utils/nombreCampo";
import { fmtNum } from "../../utils/formato";

// ── Banderas de país (SVG propio, no emoji) ──────────────────────────────────
// "Contratos adjudicados" antepone la bandera del país de origen al nombre de
// cada empresa (ver DynamicTable → flatAlfabetico). Los emoji de bandera
// (regional indicators) no se ven en Windows salvo excepciones — la fuente de
// sistema (Segoe UI Emoji) no trae la mayoría de las banderas, se ven como
// las dos letras del código de país sueltas o un cuadro vacío. Un SVG propio
// se ve igual en cualquier sistema operativo/navegador.
const FLAG_STRIPES = {
  ALEMANIA:  ["#000000", "#DD0000", "#FFCE00"],
  ARGENTINA: ["#74ACDF", "#FFFFFF", "#74ACDF"],
  COLOMBIA:  ["#FCD116", "#003893", "#CE1126"],
  ESPAÑA:    ["#AA151B", "#F1BF00", "#AA151B"],
  HOLANDA:   ["#AE1C28", "#FFFFFF", "#21468B"],
  RUSIA:     ["#FFFFFF", "#0039A6", "#D52B1E"],
};
const FLAG_STRIPES_V = {
  FRANCIA: ["#0055A4", "#FFFFFF", "#EF4135"],
  ITALIA:  ["#009246", "#FFFFFF", "#CE2B37"],
  MÉXICO:  ["#006847", "#FFFFFF", "#CE1126"],
};
function FlagIcon({ pais }) {
  const w = 20, h = 14;
  const base = (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="inline-block rounded-[2px] shrink-0 align-middle" style={{ boxShadow: "0 0 0 1px rgba(0,0,0,0.12)" }}>
      <FlagBody pais={pais} w={w} h={h} />
    </svg>
  );
  return base;
}
function FlagBody({ pais, w, h }) {
  if (FLAG_STRIPES[pais]) {
    const [a, b, c] = FLAG_STRIPES[pais];
    return <>
      <rect width={w} height={h / 3} y={0} fill={a} />
      <rect width={w} height={h / 3} y={h / 3} fill={b} />
      <rect width={w} height={h / 3} y={(2 * h) / 3} fill={c} />
    </>;
  }
  if (FLAG_STRIPES_V[pais]) {
    const [a, b, c] = FLAG_STRIPES_V[pais];
    return <>
      <rect width={w / 3} height={h} x={0} fill={a} />
      <rect width={w / 3} height={h} x={w / 3} fill={b} />
      <rect width={w / 3} height={h} x={(2 * w) / 3} fill={c} />
    </>;
  }
  switch (pais) {
    case "ESTADOS UNIDOS":
      return <>
        <rect width={w} height={h} fill="#B22234" />
        {[0, 2, 4, 6, 8, 10, 12].map(y => <rect key={y} width={w} height={h / 13} y={y * (h / 13)} fill="#FFFFFF" />)}
        <rect width={w * 0.4} height={h * 0.55} fill="#3C3B6E" />
      </>;
    case "REINO UNIDO":
      return <>
        <rect width={w} height={h} fill="#012169" />
        <rect width={w} height={h * 0.22} y={h * 0.39} fill="#FFFFFF" />
        <rect width={w * 0.22} height={h} x={w * 0.39} fill="#FFFFFF" />
        <rect width={w} height={h * 0.12} y={h * 0.44} fill="#C8102E" />
        <rect width={w * 0.12} height={h} x={w * 0.44} fill="#C8102E" />
      </>;
    case "CANADÁ":
      return <>
        <rect width={w} height={h} fill="#FFFFFF" />
        <rect width={w * 0.28} height={h} x={0} fill="#FF0000" />
        <rect width={w * 0.28} height={h} x={w * 0.72} fill="#FF0000" />
        <rect x={w / 2 - 1.5} y={h / 2 - 1.5} width={3} height={3} fill="#FF0000" transform={`rotate(45 ${w / 2} ${h / 2})`} />
      </>;
    case "JAPÓN":
      return <>
        <rect width={w} height={h} fill="#FFFFFF" />
        <circle cx={w / 2} cy={h / 2} r={h * 0.3} fill="#BC002D" />
      </>;
    case "CHINA":
      return <>
        <rect width={w} height={h} fill="#DE2910" />
        <circle cx={w * 0.2} cy={h * 0.3} r={h * 0.16} fill="#FFDE00" />
      </>;
    case "NORUEGA":
      return <>
        <rect width={w} height={h} fill="#BA0C2F" />
        <rect width={w} height={h * 0.22} y={h * 0.39} fill="#FFFFFF" />
        <rect width={w * 0.22} height={h} x={w * 0.28} fill="#FFFFFF" />
        <rect width={w} height={h * 0.12} y={h * 0.44} fill="#00205B" />
        <rect width={w * 0.12} height={h} x={w * 0.34} fill="#00205B" />
      </>;
    case "AUSTRALIA":
      return <>
        <rect width={w} height={h} fill="#00008B" />
        <rect width={w * 0.5} height={h * 0.5} fill="#012169" />
        <rect width={w * 0.5} height={h * 0.14} y={h * 0.18} fill="#FFFFFF" />
        <rect width={w * 0.14} height={h * 0.5} x={w * 0.18} fill="#FFFFFF" />
        {[[0.75, 0.25], [0.85, 0.6], [0.6, 0.85]].map(([x, y], i) => (
          <circle key={i} cx={w * x} cy={h * y} r={0.8} fill="#FFFFFF" />
        ))}
      </>;
    case "EGIPTO":
      return <>
        <rect width={w} height={h / 3} y={0} fill="#CE1126" />
        <rect width={w} height={h / 3} y={h / 3} fill="#FFFFFF" />
        <rect width={w} height={h / 3} y={(2 * h) / 3} fill="#000000" />
        <circle cx={w / 2} cy={h / 2} r={1.5} fill="#C09300" />
      </>;
    case "MALASIA":
      return <>
        <rect width={w} height={h} fill="#CC0000" />
        {[1, 3, 5, 7, 9, 11, 13].map(y => <rect key={y} width={w} height={h / 14} y={y * (h / 14)} fill="#FFFFFF" />)}
        <rect width={w * 0.45} height={h * 0.55} fill="#010066" />
        <circle cx={w * 0.18} cy={h * 0.28} r={h * 0.16} fill="#FFCC00" />
      </>;
    case "CATAR":
      return <>
        <rect width={w} height={h} fill="#8D1B3D" />
        <rect width={w * 0.3} height={h} fill="#FFFFFF" />
      </>;
    case "TAILANDIA":
      return <>
        {["#A51931", "#F4F5F8", "#2D2A4A", "#F4F5F8", "#A51931"].map((c, i) => (
          <rect key={i} width={w} height={h / 5} y={i * (h / 5)} fill={c} />
        ))}
      </>;
    default:
      return <rect width={w} height={h} fill="#94a3b8" />;
  }
}

// ── Estilos por tipo ──────────────────────────────────────────────────────────
const TYPE_STYLE = {
  banner:      { label: "text-[13px] font-bold text-white uppercase tracking-widest",   num: "text-white font-bold text-[13px]" },
  cuenca:      { label: "text-[13px] font-bold text-white uppercase tracking-widest",   num: "text-white font-bold text-[13px]" },
  ubicacion:   { label: "text-[13px] font-bold text-white uppercase tracking-widest",   num: "text-white font-bold text-[13px]" },
  ambienteheader:{ label: "text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide", num: "text-slate-500 font-semibold text-[11.5px]" },
  planheader:  { label: "text-[13.5px] font-bold pl-2",                                  num: "font-bold text-[13.5px]" },
  total:       { label: "text-[13.5px] font-bold text-teal-700 pl-4",                   num: "text-teal-700 font-bold text-[13.5px]" },
  subtotal:    { label: "text-[13px] font-semibold text-teal-600 pl-6",                 num: "text-teal-600 font-semibold text-[13px]" },
  subtotalcol: { label: "text-[13px] font-semibold text-teal-600 pl-6",                 num: "text-teal-600 font-semibold text-[13px]" },
  subtotalcuenca:{ label: "text-[13px] font-bold text-teal-700 pl-2",                   num: "text-teal-700 font-bold text-[13px]" },
  cuencaasig:  { label: "text-[13px] font-bold text-teal-700 pl-2",                     num: "text-teal-700 font-bold text-[13px]" },
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
  ambienteheader:"bg-slate-100/70 border-b border-slate-200 cursor-pointer hover:bg-slate-100",
  planheader:  "border-b border-teal-200",
  total:       "bg-teal-50/70 border-b border-teal-100",
  subtotal:    "bg-white border-b border-slate-100",
  subtotalcol: "bg-white border-b border-slate-100 cursor-pointer hover:bg-slate-50/60",
  subtotalcuenca:"bg-teal-50/70 border-b border-teal-100 cursor-pointer hover:bg-teal-50",
  cuencaasig:  "bg-teal-50/70 border-b border-teal-100 cursor-pointer hover:bg-teal-50",
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

// Filas "1P = PROBADAS", "2P = ..." (Reservas por campo) — colorea la celda de
// etiqueta según la categoría, la parte numérica queda sin tocar.
const RESERVA_TONES = {
  "1": { bg: "#dcfce7", border: "#22c55e", text: "#15803d" }, // verde
  "2": { bg: "#dbeafe", border: "#3b82f6", text: "#1d4ed8" }, // azul
  "3": { bg: "#ffedd5", border: "#f97316", text: "#c2410c" }, // naranja
};
const RESERVA_LABEL_RE = /^([123])P\s*=/;

// ── Tipos que tienen chevron y son colapsables ────────────────────────────────
const COLLAPSIBLE = new Set(["ubicacion", "planheader", "subtotalcol", "subtotalcuenca", "cuencaasig", "ambienteheader"]);

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
function pushOperatorRows(rows, sgRows, gk, cuenca, ubicacion, cats, hideDivisions, groupBy, vis, q, forceDivisions, openGroups, sinResumen, ocultarDetalleInicial = false, indentarInicial = false) {
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
    if (q) visible = visible.filter(o => o.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(q));
    for (const op of visible) {
      rows.push({
        _id: `r|${gk}|${op.label}`, _type: "operator",
        _cuenca: cuenca, _ub: ubicacion, label: op.label, _code: op.code,
        ...Object.fromEntries(cats.map((c, ci) => [c, op.data[ci] ?? 0])),
      });
    }
    return;
  }

  let i = 0; let parentLabel = ""; let saltandoCuenca = false; let dentroDeCuenca = indentarInicial; let ocultarDetalleItems = ocultarDetalleInicial;
  while (i < sgRows.length) {
    const row = sgRows[i];
    if (row.type !== "operator") {
      parentLabel = row.label;
      const i0 = i; // misma Cuenca puede repetirse en más de un Ambiente (Reservas por asignación-contrato) — desambigua las _id
      // Con forceDivisions el subtotal ES el producto que controlan los chips
      // de series: se oculta el bloque entero si está apagado.
      const skipGroup = forceDivisions && vis[row.label] === false;
      i++;
      const ops = [];
      while (i < sgRows.length && sgRows[i].type === "operator") { ops.push(sgRows[i]); i++; }
      if (skipGroup) continue;
      // Reservas por asignación-contrato intercala un subtotal de Cuenca sin
      // filas "operator" propias justo debajo (sus hijos son otros subtotales
      // de item, no operadores) — es la única cabecera "vacía" que aparece
      // aquí, así que sirve de marca para colapsar/expandir todo lo suyo de
      // un clic, hasta la siguiente Cuenca.
      if (forceDivisions && ops.length === 0) {
        const subgkCuenca = `sub|${gk}|${row.label}`;
        const itemsgkCuenca = `items|${gk}|${row.label}`;
        // 3 estados por clic (ver cycleCuenca en el render): cerrada → abierta
        // con el detalle 1P/2P/3P de cada asignación → abierta solo con los
        // nombres de asignación (detalle colapsado) → cerrada otra vez.
        const isOpenCuenca = openGroups?.has(subgkCuenca);
        const detalleOculto = openGroups?.has(itemsgkCuenca);
        rows.push({
          _id: `r|${gk}|${row.label}|${i0}`, _type: "subtotalcuenca",
          _cuenca: cuenca, _ub: ubicacion, label: row.label,
          _groupKey: subgkCuenca, _open: isOpenCuenca,
          _groupKeyItems: itemsgkCuenca, _detalleOculto: detalleOculto,
          ...Object.fromEntries(cats.map((c, ci) => [c, sinResumen ? null : (row.data[ci] ?? 0)])),
        });
        saltandoCuenca = !isOpenCuenca;
        dentroDeCuenca = true;
        ocultarDetalleItems = detalleOculto;
        continue;
      }
      if (saltandoCuenca) continue;
      // Con forceDivisions (Producción por cuenca y ubicación, por operador…)
      // el nombre del "operator" hoja también puede ser el producto (Gas,
      // Gas asociado…) cuando Cuenca queda como padre — antes solo se
      // aplicaba `vis` aquí si groupBy === "operador", así que apagar un
      // chip de serie no ocultaba nada en esta rama (Ambiente → Cuenca →
      // Producto), aunque sí desaparecía de la gráfica.
      let visible = (groupBy === "operador" || forceDivisions) ? ops.filter(o => vis[o.label] !== false) : ops;
      visible = visible.filter(o => hasData(o.data));
      // Si lo que coincidió con la búsqueda es el propio subtotal (p. ej. una
      // Entidad Federativa o Licitación), se muestran TODOS sus hijos —
      // filtrar además por texto en las hojas dejaría la rama vacía aunque el
      // usuario sí encontró lo que buscaba.
      const parentCoincide = !!q && row.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(q);
      if (q && !parentCoincide) visible = visible.filter(o => o.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(q));
      // Con forceDivisions cada subtotal (producto) es colapsable — el estado
      // "abierto" es la convención "cerrado si está en openGroups" (igual que
      // planheader/ubicacion), así por defecto arrancan expandidos.
      // Con un único hijo visible (p. ej. un solo tipo de pozo bajo esta
      // cuenca), la cifra del subtotal repetiría exactamente la del hijo de
      // abajo — pero solo es redundante mientras el hijo esté VISIBLE
      // (expandido); si está colapsado, es la única cifra en pantalla, así
      // que se muestra ahí y se oculta justo al expandir.
      const subgk = `sub|${gk}|${row.label}`;
      // Dentro de una Cuenca con el detalle colapsado (segundo clic), los
      // items arrancan cerrados por defecto en vez de abiertos — pero un
      // clic en uno en particular sigue pudiendo abrirlo (openGroups pasa a
      // significar "abierto" en vez de "cerrado" mientras dura ese estado).
      const isOpenSub = ocultarDetalleItems
        ? !!openGroups?.has(subgk)
        : (!forceDivisions || !openGroups?.has(subgk));
      const soloUnHijo = visible.length === 1 && isOpenSub;
      if (row.type !== "total" && !skipGroup) {
        rows.push({
          _id: `r|${gk}|${row.label}|${i0}`, _type: forceDivisions ? "subtotalcol" : row.type,
          _cuenca: cuenca, _ub: ubicacion, label: row.label,
          // El subtotal puede ser una entidad (una asignación/contrato, desde
          // que su jerarquía es Contrato → componentes): se conserva su código
          // para poder abrir su ficha con clic derecho, ya que el clic normal
          // lo ocupa expandir/colapsar el grupo.
          _code: row.code,
          ...(forceDivisions ? { _groupKey: subgk, _open: isOpenSub } : {}),
          ...(dentroDeCuenca ? { _indent: 44 } : {}),
          ...Object.fromEntries(cats.map((c, ci) => [c, soloUnHijo ? null : (row.data[ci] ?? 0)])),
        });
      }
      if (!isOpenSub) continue;
      for (const op of visible) {
        const isTotalRow = op.label === "Todos los operadores";
        rows.push({
          _id: `r|${gk}|${parentLabel}|${i0}|${op.label}`, _type: isTotalRow ? "totaloperator" : "operator",
          _cuenca: cuenca, _ub: ubicacion, label: isTotalRow ? "Total" : op.label,
          _code: isTotalRow ? undefined : op.code,
          ...(dentroDeCuenca ? { _indent: 52 } : {}),
          ...Object.fromEntries(cats.map((c, ci) => [c, op.data[ci] ?? 0])),
        });
      }
    } else { i++; }
  }
}

// Reservas por asignación-contrato: cada subgrupo (Ambiente) trae sus filas
// como [marcador de Cuenca (subtotal sin operator siguientes), item (subtotal
// + 3 operator 1P/2P/3P), item, ..., marcador de Cuenca, item, ...]. Para
// mostrar la jerarquía Cuenca → Ambiente → item (en vez de Ambiente → Cuenca →
// item, que trae el backend) hay que despojar el marcador y reagrupar todo
// por Cuenca primero, con el Ambiente como subnivel dentro.
function agruparPorCuencaAmbiente(subgrupos) {
  const porCuenca = new Map(); // cuenca -> Map(ambiente -> rows[] planas, subtotal item + operators)
  for (const sg of subgrupos) {
    const rows = sg.rows ?? [];
    let i = 0, cuencaActual = null;
    while (i < rows.length) {
      const row = rows[i];
      const esMarcadorCuenca = row.type === "subtotal" && rows[i + 1]?.type !== "operator";
      if (esMarcadorCuenca) { cuencaActual = row.label; i++; continue; }
      if (row.type !== "subtotal") { i++; continue; }
      const item = [row];
      i++;
      while (i < rows.length && rows[i].type === "operator") { item.push(rows[i]); i++; }
      if (!porCuenca.has(cuencaActual)) porCuenca.set(cuencaActual, new Map());
      const porAmbiente = porCuenca.get(cuencaActual);
      if (!porAmbiente.has(sg.ubicacion)) porAmbiente.set(sg.ubicacion, []);
      porAmbiente.get(sg.ubicacion).push(...item);
    }
  }
  return porCuenca;
}

// Header de Ambiente dentro de una Cuenca — gris tenue y con sangría (a
// diferencia de Cuenca, que es la cabecera fuerte). Mismos 3 estados por clic
// que la Cuenca de Asignaciones (ver cycleCuenca): cerrado → abierto con el
// detalle 1P/2P/3P de cada item → abierto solo con nombres (detalle
// colapsado) → cerrado.
function pushAmbienteHeader(rows, gkParent, ambiente, cuenca, cats, openGroups, itemRowsParaTotal, sinResumen, forzarAbierto = false) {
  const key = `ambcol|${gkParent}|${ambiente}`;
  const keyItems = `ambcolitems|${gkParent}|${ambiente}`;
  const isOpen = forzarAbierto || openGroups.has(key);
  const detalleOculto = openGroups.has(keyItems);
  const total = cats.map((c, ci) =>
    itemRowsParaTotal.filter(r => r.type === "operator" && r.label.startsWith("3P")).reduce((acc, r) => acc + (r.data[ci] ?? 0), 0)
  );
  rows.push({
    _id: `amb|${gkParent}|${ambiente}`, _type: "ambienteheader",
    _cuenca: cuenca, _ub: ambiente, label: ambiente,
    _groupKey: key, _open: isOpen, _groupKeyItems: keyItems, _detalleOculto: detalleOculto,
    ...Object.fromEntries(cats.map((c, ci) => [c, (sinResumen || isOpen) ? null : total[ci]])),
  });
  return { isOpen, detalleOculto };
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
      if (!merged.has(row.label)) merged.set(row.label, { label: row.label, pais: row.pais, data: cats.map(() => 0) });
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
  const buscarSubtotal = (label) => sgRows.find(r => r.type === "subtotal" && r.label === label);
  // "Producción por operador" no trae un subtotal aparte para esto (sería
  // un duplicado del banner) — el producto vive como operator repetido bajo
  // cada Contrato/Asignación, así que se suman todas esas apariciones.
  const sumarOperator = (label) => {
    const filas = sgRows.filter(r => r.type === "operator" && r.label === label);
    if (!filas.length) return null;
    return cats.map((c, ci) => filas.reduce((acc, r) => acc + (r.data[ci] ?? 0), 0));
  };
  const liquidosSub = buscarSubtotal("Hidrocarburos líquidos (Mbd)");
  const gasSub = buscarSubtotal("Gas (MMpcd)");
  return {
    mbd: liquidosSub ? cats.map((c, ci) => liquidosSub.data[ci] ?? 0) : sumarOperator("Hidrocarburos líquidos (Mbd)"),
    mmpcd: gasSub ? cats.map((c, ci) => gasSub.data[ci] ?? 0) : sumarOperator("Gas (MMpcd)"),
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
      // El subtotal puede ser una entidad con ficha (una asignación, desde que
      // su jerarquía es Asignación → componentes) y su código no viaja en las
      // hojas: se arrastra aparte para poder abrir su ficha desde el
      // encabezado del nivel "categoria".
      let catCode = null;
      for (const row of sg.rows) {
        if (row.type === "subtotal") { cat = row.label; catCode = row.code ?? null; continue; }
        if (row.type === "total")    { cat = null; catCode = null; continue; }
        if (row.type === "operator") {
          if (row.label === "Todos los operadores" || cat == null) continue;
          leaves.push({ cuenca: g.cuenca, ubicacion: sg.ubicacion, categoria: cat, categoriaCode: catCode, operator: row.label, code: row.code, data: row.data });
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

const MESES_EXPORT = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
// Las categorías vienen del backend como "YYYY-MM" (mensual) o "YYYY" (anual/
// resto) — en el Excel la fecha se quiere completa ("Enero 2025"), no el
// código crudo.
function formatFechaExport(periodo) {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo);
  if (m) return `${MESES_EXPORT[parseInt(m[2], 10) - 1]} ${m[1]}`;
  return periodo;
}

// Transpone una tabla "vieja" (label x periodo, con los periodos como
// columnas — el árbol indentado que se ve en pantalla) al formato PLANO/
// vertical (1 fila por Fecha, 1 columna por label/serie) — mismo criterio
// que buildPivotExport, para los pocos exports que todavía arman su tabla a
// mano en vez de usar el resultado jerárquico del backend (comparar pozos,
// detalle de un pozo).
export function transponerAPivot(columnasPeriodo, filas, etiquetaIdentidad = "Fecha") {
  return {
    columnasIdentidad: [etiquetaIdentidad],
    columnasValor: filas.map(f => f.label),
    filas: columnasPeriodo.map((periodo, i) => ({
      identidad: [formatFechaExport(periodo)],
      valores: filas.map(f => f.valores[i]),
    })),
  };
}

// ── Exportar: tabla PLANA/pivote (1 fila por Fecha + combinación hoja, 1
// columna por producto/serie) en vez del árbol indentado que se ve en
// pantalla — pedido explícito del usuario, con
// TIH_Producción por cuenca y ubicación_ejemplo.xlsx como referencia exacta
// de formato: Fecha va como columna/fila (no aplanada dentro del nombre de
// columna como "Producto — Año"), para que cada fila sea una fecha real.
// `categoria` (producto) se pivotea a columnas cuando distingue valores
// reales (drill-down a nivel Producto); si no, se pivotea `operator` (que en
// temas sin dimensión de operador propia —Cuenca, Gcompo— es directamente el
// nombre del producto).
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
  const q = search.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const vis = visibleSeries ?? {};

  const catValues = new Set(leaves.map(l => l.categoria));
  const opValues = new Set(leaves.map(l => l.operator));
  const categoriaEsNivel = levels.some(l => l.key === "categoria") && catValues.size > 1;
  const pivotField = categoriaEsNivel ? "categoria" : "operator";

  const identityFields = [{ key: "__fecha", header: "Fecha" }];
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
      const texto = `${lf.ubicacion} ${lf.cuenca} ${lf.categoria ?? ""} ${lf.operator}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      if (!texto.includes(q)) return false;
    }
    return true;
  });

  const idxPorCat = displayCats.map(c => resultado.categories.indexOf(c));
  const colOrder = [];
  for (const lf of filtered) if (!colOrder.includes(lf[pivotField])) colOrder.push(lf[pivotField]);

  // Una fila por (Fecha, combinación de identidad) — antes el período se
  // aplanaba como sufijo de columna ("Producto — Año"), lo que producía
  // tablas anchas y difíciles de leer; ahora Fecha es una columna más, cada
  // fila es una fecha real (mes y año completos si es mensual).
  const groupMap = new Map();
  for (const lf of filtered) {
    idxPorCat.forEach((idx, ci) => {
      const periodo = displayCats[ci];
      const idKey = [periodo, ...identityFields.slice(1).map(f => lf[f.key])].join("||");
      if (!groupMap.has(idKey)) {
        groupMap.set(idKey, {
          periodo,
          identidad: [formatFechaExport(periodo), ...identityFields.slice(1).map(f => lf[f.key])],
          valores: new Map(),
        });
      }
      const grupo = groupMap.get(idKey);
      const colKey = lf[pivotField];
      const v = lf.data[idx] ?? 0;
      grupo.valores.set(colKey, (grupo.valores.get(colKey) ?? 0) + v);
    });
  }

  const filas = [...groupMap.values()]
    .sort((a, b) => a.periodo.localeCompare(b.periodo))
    .map(g => ({
      identidad: g.identidad,
      valores: colOrder.map(col => g.valores.get(col) ?? null),
    }));

  return { columnasIdentidad: identityFields.map(f => f.header), columnasValor: colOrder, filas };
}

// ── Exportar "Producción por operador": Fecha, Operador, Contrato/Asignación
// + una columna por producto — la jerarquía en pantalla es Empresa → Contrato
// (subtotal) → Producto (hoja), invertida respecto al resto de temas de
// Producción (que van Cuenca → Producto → Ambiente), así que buildPivotExport
// genérico no la interpreta bien (asume que el "subtotal" siempre es un
// producto). Se recorre resultado.groups directamente en vez de reusar
// extractLeaves.
export function buildOperadorTabla(resultado, search, displayCats) {
  const q = search.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const idxPorCat = displayCats.map(c => resultado.categories.indexOf(c));
  const colOrder = [];
  // periodo||operador||contrato -> Map(producto -> valor)
  const grupos = new Map();

  for (const g of resultado.groups ?? []) {
    if (g.cuenca === "Nacional") continue;
    const operador = g.cuenca;
    for (const sg of g.subgroups ?? []) {
      let contrato = null;
      let esResumenUnidad = false;
      for (const row of sg.rows ?? []) {
        if (row.type === "subtotal") {
          // Los 2 subtotales "Hidrocarburos líquidos (Mbd)"/"Gas (MMpcd)" al
          // frente son el resumen para el banner Total Mbd/Total MMpcd, no
          // contratos reales — se saltan junto con su hijo sintético "Total".
          esResumenUnidad = row.label === "Hidrocarburos líquidos (Mbd)" || row.label === "Gas (MMpcd)";
          contrato = row.label;
          continue;
        }
        if (row.type !== "operator" || esResumenUnidad) continue;
        const producto = row.label;
        if (!colOrder.includes(producto)) colOrder.push(producto);
        if (q) {
          const texto = `${operador} ${contrato} ${producto}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          if (!texto.includes(q)) continue;
        }
        idxPorCat.forEach((idx, ci) => {
          const periodo = displayCats[ci];
          const key = [periodo, operador, contrato].join("||");
          if (!grupos.has(key)) {
            grupos.set(key, { identidad: [formatFechaExport(periodo), operador, contrato], valores: new Map() });
          }
          grupos.get(key).valores.set(producto, row.data[idx] ?? 0);
        });
      }
    }
  }

  const filas = [...grupos.values()].map(g => ({
    identidad: g.identidad,
    valores: colOrder.map(p => g.valores.get(p) ?? null),
  }));

  return { columnasIdentidad: ["Fecha", "Operador", "Contrato/Asignación"], columnasValor: colOrder, filas };
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
  const q = search.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const vis = visibleSeries ?? {};
  const levels = activeHierLevels(filtrosActivos);
  const nivelConVis = levels[0]?.key;

  const filtered = leaves.filter(lf => {
    if (nivelConVis && vis[lf[nivelConVis]] === false) return false;
    if (q) {
      const texto = `${lf.ubicacion} ${lf.cuenca} ${lf.categoria ?? ""} ${lf.operator}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
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
  const q = search.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const levels = activeHierLevels(perfFiltros);
  const leaves = extractLeaves(resultado);
  const rows = [];

  // Con búsqueda activa, el Total nacional también se recalcula solo sobre
  // lo que coincide con la búsqueda — mismo criterio que los encabezados de
  // rama en walk() (ver bucketMostrado), para no mostrar el total de TODOS
  // los operadores cuando el usuario ya filtró por uno.
  const leavesMostradas = q
    ? leaves.filter(lf => [lf.cuenca, lf.ubicacion, lf.categoria, lf.operator].some(v => v && v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(q)))
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
      // `orden` = posición en que el backend mandó la hoja. Se conserva para no
      // reordenar alfabéticamente lo que ya viene con un orden con significado
      // (componentes del gas por número de carbonos, clases API por ligereza,
      // productos). Donde el backend ya manda alfabético, no cambia nada.
      if (!merged.has(lf.operator)) merged.set(lf.operator, { data: cats.map(() => 0), code: lf.code, orden: merged.size });
      const acc = merged.get(lf.operator);
      lf.data.forEach((v, i) => { acc.data[i] += v ?? 0; });
    }
    let ops = [...merged].map(([label, v]) => ({ label, data: v.data, code: v.code, orden: v.orden }));
    // El nombre de operador aquí ES el producto (Gas, Gas asociado…) cuando
    // "categoria" no quedó como nivel explícito del árbol (Producción por
    // cuenca y ubicación sin drill-down forzado) — antes los chips de serie
    // no se aplicaban en este nivel hoja, así que apagar uno solo lo
    // ocultaba de la gráfica, no de la tabla.
    ops = ops.filter(o => hasData(o.data) && (!qLocal || o.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(qLocal)) && vis[o.label] !== false);
    ops.sort((a, b) => a.orden - b.orden);
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

      const nombreCoincide = !!qLocal && name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(qLocal);
      // No basta con mirar el nombre de este nivel o el operador de la hoja:
      // el término buscado puede vivir en un nivel intermedio más abajo (p.
      // ej. buscar una cuenca estando parado en el nivel Ambiente) — hay que
      // revisar todos los campos de cada leaf del bucket antes de podar la rama.
      const tieneCoincidencia = !qLocal || nombreCoincide || bucket.some(lf =>
        [lf.cuenca, lf.ubicacion, lf.categoria, lf.operator].some(v => v && v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(qLocal))
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
        ? bucket.filter(lf => [lf.cuenca, lf.ubicacion, lf.categoria, lf.operator].some(v => v && v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(qLocal)))
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
            // Último nivel: este encabezado ES la entidad (p. ej. la
            // asignación), aunque su rótulo venga fusionado con los niveles de
            // arriba. Se le pasa el código real para poder abrir su ficha.
            ...(bucket[0]?.categoriaCode ? { _code: bucket[0].categoriaCode, _esEntidad: true } : {}),
          });
          if (!isOpen) continue;
          renderOperators(bucket, key, depth + 1, qEfectiva, nextDims);
        }
        continue;
      }

      const label = pendingLabels.length ? [...pendingLabels, name].join(" · ") : name;
      const isOpen = !openGroups.has(key);
      const esUltimoNivel = levelIdx + 1 >= levels.length;
      rows.push({
        _id: `h|${key}`, _type: "planheader", _groupKey: key, _open: isOpen, _indent: 12 + depth * 18, _depth: depth,
        label, ...dataObj(cats, bucketTotalMostrado),
        // Ídem que arriba: solo el último nivel es la entidad con ficha.
        ...(esUltimoNivel && bucket[0]?.categoriaCode
          ? { _code: bucket[0].categoriaCode, _esEntidad: true } : {}),
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
function flattenGroups(resultado, visibleSeries, search, openGroups, groupBy, hideDivisions, forceDivisions, mostrarTotalesUnidad, ocultarTotalesUnidad, sinResumen, flatAlfabetico) {
  const rows = [];
  if (!resultado?.groups) return rows;
  const cats = resultado.categories;
  const q    = search.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
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

    // "Contratos adjudicados" (empresas por país): sin encabezado de país —
    // todas las empresas sueltas en una sola lista alfabética, con bandera
    // de país al frente del nombre (ver get_contratos_adjudicados). El país
    // sigue siendo el grupo real en `resultado.groups` (así el filtro de
    // país en TopBar/InvDrawer sigue funcionando, oculta el grupo entero vía
    // `vis[g.cuenca]`) y sigue siendo buscable por texto (`o.pais`), solo
    // que no se muestra como fila propia.
    if (flatAlfabetico) {
      let todas = [];
      for (const g of resultado.groups) {
        if (g.cuenca === "Nacional" || g.cuenca === "Total general") continue;
        if (vis[g.cuenca] === false) continue;
        const { ops } = mergeSubgroups(g.subgroups, cats);
        todas.push(...ops);
      }
      if (q) {
        todas = todas.filter(o =>
          o.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(q) || (o.pais ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(q)
        );
      }
      todas = todas.filter(o => hasData(o.data));
      todas.sort((a, b) => a.label.localeCompare(b.label, "es"));
      for (const op of todas) {
        rows.push({
          _id: `emp|${op.label}`, _type: "planoperator",
          _cuenca: "", _ub: "", label: op.label, _pais: op.pais,
          ...Object.fromEntries(cats.map((c, ci) => [c, op.data[ci] ?? 0])),
        });
      }
      return rows;
    }

    for (const g of resultado.groups) {
      if (g.cuenca === "Nacional") continue;
      if (vis[g.cuenca] === false) continue;

      const gk     = `cuenca|${g.cuenca}`;
      // Antes tomaba solo subgroups[0]: si el grupo tenía más de un
      // subgrupo real (Reservas por campo/asignación-contrato traen uno por
      // Ambiente, no el "Nacional" único de Inversiones/Contratos), todo lo
      // que no fuera el primer Ambiente se perdía en silencio.
      const sgRows = (g.subgroups ?? []).flatMap(sg => sg.rows ?? []);
      const nombreCoincide = q ? g.cuenca.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(q) : false;
      // "Producción por operador": cada empresa trae Producto (subtotal) →
      // Contrato (hoja) — mergeSubgroups aplanaría el subtotal y mezclaría
      // unidades (Mbd/MMpcd) en un solo total, por eso aquí se respeta la
      // jerarquía con pushOperatorRows en vez del merge plano de abajo.
      if (sgRows.some(r => r.type === "subtotal")) {
        // También cuenta como match un subtotal intermedio (Entidad Federativa,
        // Licitación…) — antes solo miraba las hojas ("operator") y una
        // búsqueda por el nombre de ese nivel intermedio (p. ej. "Campeche")
        // no encontraba nada aunque sí existiera.
        const contratoCoincide = q ? sgRows.some(r => (r.type === "operator" || r.type === "subtotal") && r.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(q)) : true;
        if (q && !nombreCoincide && !contratoCoincide) continue; // ni la empresa ni ningún contrato/subtotal coincide con la búsqueda
        // Si coincide el nombre de la empresa, se muestran todos sus contratos
        // (la búsqueda ya cumplió su propósito a ese nivel).
        const qEfectiva = nombreCoincide ? "" : q;
        const isOpen = q ? true : openGroups.has(gk); // autoexpandir resultados de búsqueda
        // Cerrado: muestra el total del grupo (g.data, mismo agregado que usa
        // la gráfica de líneas por cuenca) — abierto, se oculta porque las
        // filas hijas ya muestran el desglose.
        rows.push({
          _id: `ph|${gk}`, _type: "planheader",
          _cuenca: g.cuenca, _ub: "", _groupKey: gk, _open: isOpen, label: g.cuenca,
          ...Object.fromEntries(cats.map((c, ci) => [c, (sinResumen || isOpen) ? null : (g.data?.[ci] ?? null)])),
        });
        if (!isOpen) continue;
        if (mostrarTotalesUnidad && !ocultarTotalesUnidad) {
          const { mbd, mmpcd } = totalesPorUnidad(sgRows, cats);
          if (mbd) rows.push({ _id: `${gk}|totalmbd`, _type: "totalmbd", _cuenca: g.cuenca, _ub: "", label: "Total Mbd", ...dataObj(cats, mbd) });
          if (mmpcd) rows.push({ _id: `${gk}|totalmmpcd`, _type: "totalmmpcd", _cuenca: g.cuenca, _ub: "", label: "Total MMpcd", ...dataObj(cats, mmpcd) });
        }
        // Reservas por asignación-contrato: "Asignaciones" trae Cuenca anidada
        // dentro de cada Ambiente (el backend agrupa Ambiente → Cuenca →
        // item) — se reordena aquí a Cuenca → Ambiente → item, que es como
        // se quiere leer la tabla. "Contratos" no trae Cuenca (van directo
        // Ambiente → item), así que ese caso sigue el camino simple de abajo.
        const subgruposConDatos = (g.subgroups ?? []).filter(sg => (sg.rows ?? []).some(r => r.type === "subtotal"));
        const tieneCuencaAnidada = subgruposConDatos.some(sg =>
          (sg.rows ?? []).some((r, ri, arr) => r.type === "subtotal" && arr[ri + 1]?.type !== "operator")
        );
        if (tieneCuencaAnidada) {
          const porCuenca = agruparPorCuencaAmbiente(subgruposConDatos);
          for (const [cuencaLabel, porAmbiente] of [...porCuenca.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
            const todasFilas = [...porAmbiente.values()].flat();
            const nombreCuencaCoincide = qEfectiva ? cuencaLabel.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(qEfectiva) : false;
            const itemCoincide = qEfectiva ? todasFilas.some(r => r.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(qEfectiva)) : true;
            if (qEfectiva && !nombreCuencaCoincide && !itemCoincide) continue;
            const qCuenca = nombreCuencaCoincide ? "" : qEfectiva;
            const cuencaGk = `casig|${gk}|${cuencaLabel}`;
            const isOpenCuenca = qEfectiva ? true : openGroups.has(cuencaGk);
            const totalCuenca = cats.map((c, ci) =>
              todasFilas.filter(r => r.type === "operator" && r.label.startsWith("3P")).reduce((acc, r) => acc + (r.data[ci] ?? 0), 0)
            );
            rows.push({
              _id: `casig|${gk}|${cuencaLabel}`, _type: "cuencaasig",
              _cuenca: g.cuenca, _ub: "", _groupKey: cuencaGk, _open: isOpenCuenca, label: cuencaLabel,
              ...Object.fromEntries(cats.map((c, ci) => [c, (sinResumen || isOpenCuenca) ? null : totalCuenca[ci]])),
            });
            if (!isOpenCuenca) continue;
            for (const [ambiente, itemRows] of porAmbiente) {
              const itemsCoincide = qCuenca ? itemRows.some(r => r.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(qCuenca)) : true;
              if (qCuenca && !itemsCoincide) continue;
              const { isOpen: ambAbierto, detalleOculto: ambDetalleOculto } =
                pushAmbienteHeader(rows, cuencaGk, ambiente, g.cuenca, cats, openGroups, itemRows, sinResumen, !!qCuenca);
              if (!ambAbierto) continue;
              pushOperatorRows(rows, itemRows, `${cuencaGk}|${ambiente}`, g.cuenca, ambiente, cats, false, groupBy, vis, qCuenca, true, openGroups, sinResumen, ambDetalleOculto, true);
            }
          }
        } else {
          const subgruposConAmbiente = subgruposConDatos.length > 1;
          for (const sg of (subgruposConAmbiente ? subgruposConDatos : [{ ubicacion: "Nacional", rows: sgRows }])) {
            let ambAbierto = true, ambDetalleOculto = false;
            if (subgruposConAmbiente) {
              ({ isOpen: ambAbierto, detalleOculto: ambDetalleOculto } =
                pushAmbienteHeader(rows, gk, sg.ubicacion, g.cuenca, cats, openGroups, sg.rows ?? [], sinResumen, !!qEfectiva));
            }
            if (!ambAbierto) continue;
            pushOperatorRows(rows, sg.rows ?? [], `${gk}|${sg.ubicacion}`, g.cuenca, sg.ubicacion, cats, false, groupBy, vis, qEfectiva, true, openGroups, sinResumen, ambDetalleOculto, subgruposConAmbiente);
          }
        }
        continue;
      }

      const { total, ops } = mergeSubgroups(g.subgroups, cats);
      // Si la búsqueda solo coincide con una hoja de este grupo (p. ej. una
      // empresa), se abre aunque el usuario lo haya colapsado a mano —
      // si no, quedaría "encontrado" pero invisible.
      const nombreCoincideCuenca = q ? g.cuenca.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(q) : false;
      const hijoCoincide = q && !nombreCoincideCuenca ? ops.some(o => o.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(q)) : false;
      const isOpen = openGroups.has(gk) || hijoCoincide;

      rows.push({
        _id: `ph|${gk}`, _type: "planheader",
        _cuenca: g.cuenca, _ub: "", _groupKey: gk, _open: isOpen, label: g.cuenca,
        ...Object.fromEntries(cats.map((c, ci) => [c, total[ci]])),
      });
      if (!isOpen) continue;

      const visible = ops.filter(o => hasData(o.data) && (!q || o.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(q)));
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

      // Los chips de serie (Gas (MMpcd), Gas asociado (MMpcd)...) apagan
      // productos — antes solo se ocultaban en la gráfica (filterSeries),
      // aquí (vista "Por ambiente") se listaban igual porque mergeSubgroups
      // no aplicaba `vis`.
      const visible = ops.filter(o => hasData(o.data) && (!q || o.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(q)) && vis[o.label] !== false);
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
        const visible = ops.filter(o => hasData(o.data) && (!q || o.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(q)));
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

      {/* En vista mensual el listado de columnas (años) se oculta más abajo
          (!isMonthly && categories.map...) — si además esta sección no tiene
          columna Suma (sumaDisponible false), el menú quedaría vacío. Se
          oculta el botón entero en ese caso en vez de abrir un panel sin nada
          que mostrar. */}
      {(!isMonthly || sumaDisponible) && (
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
                    <span className="text-[12px] text-slate-700">Prom</span>
                  </label>
                </>
              )}
            </div>
          )}
        </div>
      )}

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
export default function DynamicTable({ resultado, visibleSeries, groupBy, titulo, period, start_year, end_year, compareMode, entityLabel, forceDivisions, filtros, rowHeaderLabel, searchPlaceholder, onRowClick, onCellClick, flatExportEntidad, historicoTopic, historicoFetch, preserveColumnOrder, search: searchControlada, onSearchChange, sinResumen, exportOperadorTabla, flatAlfabetico, ocultarSuma, temaJsonArg, onRowFicha, notaPie }) {
  const { pendingBusqueda, setPendingBusqueda } = useExplorer();
  const [searchLocal, setSearchLocal] = useState("");
  // Los datos van con 2 decimales (produccion, reservas, inversiones...); solo
  // los temas de CONTEO de pozos son enteros ("14 pozos", no "14.00").
  const decimalesTabla = ["PozPerf", "PozTerm", "PozosCampos"].includes(temaJsonArg) ? 0 : 2;
  const fmtCelda = (v) => (v === null || v === undefined ? "" : v === 0 ? "—" : fmtNum(v, decimalesTabla));
  // Búsqueda controlada desde afuera (Reservas, ver ChartArea): sobrevive al
  // desmontar/remontar de este componente al cambiar de pestaña Aceite/Gas/PCE.
  const search    = searchControlada ?? searchLocal;
  const setSearch = onSearchChange ?? setSearchLocal;

  // Búsqueda pendiente al saltar desde otro tema (p. ej. ficha de un campo →
  // "Ver producción completa en el Explorador" con el campo ya filtrado) — se
  // aplica una sola vez, y SOLO en la tabla del tema al que iba dirigida: si no
  // se comprueba el tema, la tabla del tema anterior (que sigue montada durante
  // el cambio) se la queda y la destino aparece sin filtrar.
  useEffect(() => {
    if (pendingBusqueda == null) return;
    if (pendingBusqueda.tema !== temaJsonArg) return;
    // Dirigida a otra vista del mismo tema (p. ej. el Ranking de Asignaciones,
    // que tiene su propio buscador): no es de esta tabla, se deja pasar.
    if (pendingBusqueda.vista && pendingBusqueda.vista !== "tablas") return;
    setSearch(pendingBusqueda.texto);
    setPendingBusqueda(null);
  }, [pendingBusqueda, setPendingBusqueda, temaJsonArg]);
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

  // Cuenca de Reservas por asignación-contrato: 3 estados por clic — cerrada →
  // abierta con el 1P/2P/3P de cada asignación → abierta solo con los nombres
  // (detalle colapsado) → cerrada. `key`=abre/cierra la Cuenca, `keyItems`=
  // colapsa el detalle de sus items sin cerrarla.
  function cycleCuenca(key, keyItems) {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (!prev.has(key)) {
        next.add(key);
        next.delete(keyItems);
      } else if (!prev.has(keyItems)) {
        next.add(keyItems);
      } else {
        next.delete(key);
        next.delete(keyItems);
      }
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
      : flattenGroups(resultado, visibleSeries, search, openGroups, groupBy, hideDivisions, forceDivisions, mostrarTotalesUnidad, totalesUnidadOcultos, sinResumen, flatAlfabetico),
    [resultado, visibleSeries, search, openGroups, filtrosActivos, hierLevels.length, hideDivisions, forceDivisions, groupBy, mostrarTotalesUnidad, totalesUnidadOcultos, sinResumen, flatAlfabetico]
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

  // Columna de promedio ("Prom") a la derecha con 2+ años (vista anual); en
  // vista mensual se agrega al final de cada año en vez de una sola global.
  // Antes sumaba las columnas visibles, pero eso no tiene significado real
  // sobre valores de tasa diaria (Mbd/MMpcd): se cambió a promedio. Algunas
  // tablas (ocultarSuma, pedido explícito) igual la ocultan porque ni el
  // promedio aplica a su dato (p.ej. conteos puntuales de pozos activos).
  const sumaDisponible = !ocultarSuma && (isMonthly ? visCats.length > 0 : visCats.length >= 2);
  const showSuma = sumaDisponible && !sumaOculta;
  const extraSumaCols = isMonthly ? (showSuma ? yearGroups.length : 0) : (showSuma ? 1 : 0);

  // En modo anual el año más reciente va primero; en modo comparación se
  // respeta el orden cronológico (antes → después). Columnas que no son años
  // (p. ej. Ambiente en Pozos/Inversión comprometida) usan el orden tal cual
  // viene del backend — invertirlas no tiene sentido cronológico.
  // Años/períodos SIEMPRE de menor a mayor de izquierda a derecha (pedido
  // explícito). visCats ya viene ascendente del backend; antes se invertía en
  // la vista anual para poner el más reciente primero, ahora se deja como está.
  const displayCats = visCats;

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
    const tablaPivot = exportOperadorTabla
      ? buildOperadorTabla(resultado, search, displayCats)
      : flatExportEntidad
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
        return fmtCelda(v);
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
    const [{ exportarProduccionExcel }, cliente] = await Promise.all([
      import("../../utils/exportExcel"),
      import("../../api/client"),
    ]);
    const fetchHistorico = cliente[historicoFetch ?? "fetchPerforacionHistorico"];
    const { columnas, filas, periodo_nota } = await fetchHistorico(historicoTopic);
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
                              Prom
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
                      Prom
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
                const useColSpan  = row._type === "ubicacion" || row._type === "cuenca" || row._type === "banner" || row._type === "ambienteheader";
                const isCuencaRow = row._type === "cuenca";

                if (isCuencaRow && cuencaCount === 1) return null;

                const isDark      = isCuencaRow || row._type === "ubicacion" || row._type === "banner";
                const isAmbienteHeader = row._type === "ambienteheader";
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
                // Solo la celda de etiqueta (no las columnas numéricas): distinto
                // de "tone" arriba, que también tiñe el fondo de la fila y los
                // valores numéricos (planheader sí lo quiere, esto no).
                const reservaMatch = row._type === "operator" ? row.label?.match(RESERVA_LABEL_RE) : null;
                const reservaTone = reservaMatch ? RESERVA_TONES[reservaMatch[1]] : null;
                // Celdas con desglose por pozo (Perforación): solo filas hoja de
                // operador, ver onCellClick en ChartArea.
                const celdaClickeable = !!onCellClick && (row._type === "operator" || row._type === "planoperator");
                // Filas que representan una entidad con ficha propia y que a la
                // vez son encabezado de grupo (clic izquierdo = expandir).
                // En la vista multinivel la entidad es un "planheader" con el
                // rótulo fusionado (Ambiente · Cuenca · Asignación) y se marca
                // con _esEntidad al construirla.
                const esFilaConFicha = row._type === "subtotal" || row._type === "subtotalcol" || row._esEntidad;

                return (
                  <tr key={row._id}
                    className={`${bg ?? ""} ${isCollapse || ((row._type === "operator" || row._type === "planoperator") && onRowClick) ? "cursor-pointer select-none" : ""} transition-colors duration-100`}
                    style={{
                      ...(isDark ? { background: "linear-gradient(90deg,#10312B,#1a4a3a)" } : {}),
                      ...(tone && !isSelected && !isHovered ? { background: tone.bg + "60" } : {}),
                      ...(isCuencaRow ? { position: "sticky", top: isMonthly ? 57 : 41, zIndex: 20 } : {}),
                      ...(isSelected ? { background: selectedBg, boxShadow: "0 -2px 0 #14b8a6, 0 2px 0 #14b8a6", zIndex: 5 } : {}),
                      ...(isHovered  ? { background: hoverBg,   boxShadow: "0 -1px 0 #94a3b8, 0 1px 0 #94a3b8", transform: "scale(1.002)", zIndex: 5 } : {}),
                    }}
                    onMouseEnter={() => setHoveredRow(row._id)}
                    onMouseLeave={() => setHoveredRow(null)}
                    onClick={(e) => {
                      // El segundo clic de un doble clic (e.detail === 2) cae en la
                      // fila que quedó justo debajo tras colapsar la primera — sin
                      // esto, un doble clic sobre una Cuenca terminaba colapsando
                      // también la siguiente. Se ignora, un doble clic no hace nada.
                      if (e.detail > 1) return;
                      if (row._type === "subtotalcuenca" || row._type === "ambienteheader") cycleCuenca(row._groupKey, row._groupKeyItems);
                      else if (isCollapse) toggleGroup(row._groupKey);
                      if (!isDark) setSelectedRow(selectedRow === row._id ? null : row._id);
                      // "_code" solo viene del backend cuando el label mostrado no es
                      // el identificador real (Asignaciones: label=BLOCK_NAME, code=
                      // ASIG_CONT). Para el resto de temas (Campos, Cuenca, etc.) el
                      // label ES el identificador — se usa como fallback para que el
                      // clic siga funcionando sin necesitar un "code" redundante.
                      if ((row._type === "operator" || row._type === "planoperator") && onRowClick) onRowClick(row._code ?? row.label, row.label);
                    }}
                    // Clic derecho = ficha de la entidad. En las tablas donde la
                    // entidad es un encabezado colapsable (Contratos/Asignaciones,
                    // que ahora van Contrato → componentes) el clic izquierdo ya
                    // está ocupado expandiendo, así que la ficha necesita otro
                    // gesto; sin esto la ficha se abría al clicar un componente.
                    onContextMenu={
                      onRowFicha && esFilaConFicha
                        ? (e) => { e.preventDefault(); onRowFicha(row._code ?? row.label, row.label); }
                        : undefined
                    }
                  >
                    <td title={onRowFicha && esFilaConFicha ? `${row.label} — clic derecho para ver su ficha` : row.label}
                      className={`px-4 py-[5px] whitespace-normal break-words static sm:sticky sm:left-0 ${cfg.label}`}
                      style={{
                        zIndex: isDark ? 25 : 10,
                        paddingLeft: row._indent != null ? row._indent : (isAmbienteHeader ? 28 : undefined),
                        ...(tone ? { color: tone.text, borderLeft: `3px solid ${tone.border}` } : {}),
                        ...(reservaTone ? { color: reservaTone.text, borderLeft: `3px solid ${reservaTone.border}` } : {}),
                        background: isDark        ? "linear-gradient(90deg,#10312B,#1a4a3a)"
                          : isAmbienteHeader        ? "#f1f5f9"
                          : isSelected              ? selectedBg
                          : isHovered               ? hoverBg
                          : tone                    ? tone.bg
                          : reservaTone             ? reservaTone.bg
                          : row._type === "total"   ? "#f0fdfa"
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
                        {row._pais && <FlagIcon pais={row._pais} />}
                        {normalizarSiMayusculas(row.label)}
                        {((row._type === "banner" && hasCollapsible) || (showToggleEnPrimeraFila && esPrimeraVisible)) && (
                          <ToggleTodoBtn dark={isDark || !!tone} />
                        )}
                      </span>
                    </td>
                    {useColSpan && (
                      <td colSpan={visCats.length + (isCompare ? 1 : 0) + extraSumaCols}
                        style={{ background: isAmbienteHeader ? "#f1f5f9" : "linear-gradient(90deg,#1a4a3a,#1a4a3a)" }} />
                    )}
                    {!useColSpan && isMonthly && (() => {
                      const isCuenca = row._type === "cuenca";
                      return yearGroups.map(([year, cols], yi) => {
                        const clr = !isCuenca ? YEAR_COLORS[yi % YEAR_COLORS.length] : null;
                        const sumaVals = cols.map(c => row[c]).filter(v => v !== null);
                        const suma = sumaVals.length ? sumaVals.reduce((a, b) => a + b, 0) / sumaVals.length : null;
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
                                  {fmtCelda(val)}
                                </td>
                              );
                            })}
                            {showSuma && (
                              <td className="px-2 py-[5px] text-center tabular-nums text-[12px] font-medium"
                                style={{ color: "#818cf8", background: "#eef2ff80" }}>
                                {suma === null ? "" : suma === 0 ? "—" : fmtNum(suma, decimalesTabla)}
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
                          {fmtCelda(val)}
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
                              {arrow} {fmtNum(Math.abs(diff), decimalesTabla)}
                              {pct !== null && <span className="opacity-70"> ({pct > 0 ? "+" : ""}{pct.toFixed(1)}%)</span>}
                            </>
                          )}
                        </td>
                      );
                    })()}
                    {showSuma && !isMonthly && !useColSpan && (() => {
                      const vals = displayCats.map(c => row[c]).filter(v => v !== null);
                      if (!vals.length) return <td />;
                      const suma = vals.reduce((a, b) => a + b, 0) / vals.length;
                      return (
                        <td className="px-2 py-[5px] text-center tabular-nums text-[12px] font-medium" style={{ color: "#a5b4fc", background: "#eef2ff60" }}>
                          {suma === 0 ? "—" : fmtNum(suma, decimalesTabla)}
                        </td>
                      );
                    })()}
                  </tr>
                );
              })}
            </tbody>
          </table>
      </div>
      {notaPie && (
        <p className="text-[10.5px] text-slate-400 mt-2 leading-relaxed shrink-0">{notaPie}</p>
      )}
    </div>
  );
}
