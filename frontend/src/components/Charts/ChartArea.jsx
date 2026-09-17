import { useState, useRef, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import ReactECharts from "echarts-for-react";
import * as echarts from "echarts";
import { useExplorer } from "../../store/useExplorer";
import LoadingSpinner from "../UI/LoadingSpinner";
import DynamicTable, { buildPivotExport, buildFlatExport, buildOperadorTabla } from "./DynamicTable";
import { acentuarTema } from "../../utils/acentuarTema";
import HeatmapChart from "./HeatmapChart";
import HomeDashboard from "./HomeDashboard";
import PozosExplorer from "./PozosExplorer";
import AsignacionesRanking from "./AsignacionesRanking";
import { useAbrirFicha } from "../Fichas/FichaContext";
import PerforacionPozosDetallePanel from "./PerforacionPozosDetallePanel";
import PozosCampoDetallePanel from "./PozosCampoDetallePanel";
import PozosComprometidosDetallePanel from "./PozosComprometidosDetallePanel";
import ContratosAdjudicadosDetallePanel from "./ContratosAdjudicadosDetallePanel";
import ReportBuilderModal from "./ReportBuilderModal";
import { descargarCsvConHeader } from "../../utils/exportCsv";
import { fmt2, fmtNum } from "../../utils/formato";
import { AGUA_COLOR, esAgua } from "../../utils/estiloAgua";
import { sinCerosIniciales } from "../../utils/seriesUtils";

const PALETTE = [
  "#0db4be","#6366f1","#f59e0b","#ef4444",
  "#10b981","#8b5cf6","#0ea5e9","#ec4899",
  "#84cc16","#f97316","#64748b","#eab308",
];

const CHART_TYPES = [
  {
    id: "line",
    label: "Línea",
    icon: (
      <svg viewBox="0 0 20 14" width="18" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
        <polyline points="1,12 5,5 9,8 13,3 19,7" />
      </svg>
    ),
  },
  {
    id: "pie",
    label: "Pastel",
    icon: (
      <svg viewBox="0 0 20 20" width="15" height="15" fill="currentColor">
        <path d="M10 2a8 8 0 1 0 8 8A8 8 0 0 0 10 2zm0 2v6h6a6 6 0 0 1-6 6 6 6 0 0 1-6-6 6 6 0 0 1 6-6z" opacity="0.3"/>
        <path d="M10 2v8h8A8 8 0 0 0 10 2z"/>
      </svg>
    ),
  },
  {
    id: "bar",
    label: "Barras",
    icon: (
      <svg viewBox="0 0 20 14" width="18" height="13" fill="currentColor">
        <rect x="1"  y="6"  width="3" height="8" rx="1" />
        <rect x="6"  y="3"  width="3" height="11" rx="1" />
        <rect x="11" y="7"  width="3" height="7" rx="1" />
        <rect x="16" y="1"  width="3" height="13" rx="1" />
      </svg>
    ),
  },
  {
    id: "heatmap",
    label: "Mapa de calor",
    icon: (
      <svg viewBox="0 0 20 20" width="15" height="15" fill="currentColor">
        <rect x="1"  y="1"  width="8"  height="8"  rx="1" opacity="0.3"/>
        <rect x="11" y="1"  width="8"  height="8"  rx="1" opacity="0.7"/>
        <rect x="1"  y="11" width="8"  height="8"  rx="1" opacity="0.9"/>
        <rect x="11" y="11" width="8"  height="8"  rx="1" opacity="0.5"/>
      </svg>
    ),
  },
];

// Mismo lenguaje visual que las tablas de DynamicTable.jsx (encabezado verde
// oscuro sticky, filas zebra, contenedor redondeado) — antes esta tabla tenía
// su propio estilo genérico y, sin alto máximo, una tabla larga (p. ej.
// Precios con un registro por día) se salía del contenedor sin poder
// scrollear dentro de la página.
function DataTable({ title, categories, series, periodoNota }) {
  return (
    <div className="rounded-xl border border-slate-200 shadow-sm bg-white overflow-hidden mb-4">
      {(title || series.length > 0) && (
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
          {title ? <p className="text-xs font-semibold text-slate-600">{title}</p> : <span />}
          <button
            onClick={() => descargarCsvConHeader({
              titulo: title || "Datos",
              periodoNota,
              columnas: ["Periodo", ...series.map(s => s.name)],
              filas: categories.map((cat, i) => [cat, ...series.map(s => s.data[i] ?? "")]),
              nombreArchivo: `TIH_${title || "datos"}.csv`,
            })}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 shrink-0"
          >
            Exportar CSV
          </button>
        </div>
      )}
      <div className="overflow-auto" style={{ maxHeight: 480 }}>
        <table className="w-full text-xs border-collapse">
          <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
            <tr>
              <th className="text-left px-4 py-2.5 font-bold text-white uppercase tracking-wide text-[11px] sticky left-0"
                style={{ background: "linear-gradient(90deg,#10312B,#1a4a3a)" }}>
                Periodo
              </th>
              {series.map(s => (
                <th key={s.name} className="text-right px-3 py-2.5 font-bold text-white whitespace-nowrap text-[11px]"
                  style={{ background: "linear-gradient(90deg,#10312B,#1a4a3a)" }}>
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((cat, i) => (
              <tr key={`${cat}-${i}`} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/70"}>
                <td className="px-4 py-1.5 text-slate-700 font-medium sticky left-0 bg-inherit whitespace-nowrap">{cat}</td>
                {series.map(s => (
                  <td key={s.name} className="px-3 py-1.5 text-right text-slate-600 tabular-nums">
                    {s.data[i] != null ? fmt2(s.data[i]) : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CHART_TYPE_LABEL = Object.fromEntries(CHART_TYPES.map(t => [t.id, t.label]));

// Extraído de SingleChart para poder reusarlo con un ref propio (necesario
// para exportar a PNG en "Gráfica individual").
function buildChartOption(categories, series, chartType, { zoomable = false } = {}) {
  const isPie = chartType === "pie";
  const isBar = chartType === "bar";
  const showZoom = zoomable && !isPie && categories.length > 12;

  const pieData = isPie
    ? series.map(s => ({
        name: s.name,
        value: (s.data ?? []).reduce((a, b) => a + (b ?? 0), 0),
        itemStyle: { color: colorDeSerie(s.name) },
      })).filter(d => d.value > 0)
    : [];

  return isPie
    ? {
        backgroundColor: "#fff",
        color: PALETTE,
        tooltip: {
          trigger: "item",
          backgroundColor: "#fff",
          borderColor: "#e2e8f0",
          textStyle: { color: "#374151", fontSize: 11 },
          valueFormatter: v => fmt2(v),
          formatter: p => `${p.name}: ${fmt2(p.value)} (${p.percent}%)`,
        },
        legend: { type: "plain", bottom: 0, textStyle: { color: "#6b7280", fontSize: 10 } },
        series: [{
          type: "pie",
          radius: ["35%", "65%"],
          center: ["50%", "45%"],
          data: pieData,
          label: { fontSize: 11, color: "#374151" },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.15)" } },
        }],
      }
    : {
        backgroundColor: "#fff",
        color: PALETTE,
        tooltip: {
          trigger: "axis",
          backgroundColor: "#fff",
          borderColor: "#e7e5e0",
          textStyle: { color: "#1f2430", fontSize: 11 },
          valueFormatter: v => (v == null ? "—" : fmt2(v)),
        },
        legend: { type: "plain", bottom: showZoom ? 26 : 0, left: "center", width: "92%", itemGap: 14, textStyle: { color: "#767b87", fontSize: 10 } },
        grid: { top: 30, right: 24, bottom: (series.length > 6 ? 90 : 50) + (showZoom ? 26 : 0), left: 20, containLabel: true },
        xAxis: {
          type: "category",
          data: categories,
          axisLabel: {
            color: "#767b87", fontSize: 10, fontWeight: 600,
            // interval 0 = no ocultar ninguna. Por defecto ECharts esconde las
            // que se encimarían, y con pocas categorías de nombre largo
            // (Aguas profundas / Aguas someras / Terrestre) desaparecía la de
            // en medio: quedaba una barra sin etiqueta, imposible de leer.
            // Con muchas categorías sí conviene que ECharts decida.
            ...(categories.length <= 12 ? { interval: 0 } : {}),
            // Al forzarlas todas hay que darles espacio: varias etiquetas
            // largas seguidas (cuencas) se encimarían en horizontal.
            rotate: categories.length > 24 ? 45
              : (categories.length > 3 && categories.length <= 12
                 && categories.some(c => String(c).length > 10) ? 30 : 0),
          },
          axisLine: { lineStyle: { color: "#e7e5e0" } },
          axisTick: { show: false },
        },
        yAxis: {
          type: "value",
          axisLabel: { color: "#767b87", fontSize: 10, formatter: v => fmt2(v) },
          splitLine: { show: false },
        },
        ...(showZoom ? {
          dataZoom: [
            { type: "inside", start: 100 - Math.min(100, (12 / categories.length) * 100 * 3), end: 100 },
            { type: "slider", bottom: 0, height: 16, start: 100 - Math.min(100, (12 / categories.length) * 100 * 3), end: 100,
              borderColor: "#e7e5e0", fillerColor: "rgba(13,180,190,0.15)", handleStyle: { color: "#0db4be" },
              textStyle: { color: "#767b87", fontSize: 9 } },
          ],
        } : {}),
        series: series.map((s, idx) => (esAgua(s.name) ? {
          // El agua siempre se dibuja como línea continua, aunque el resto
          // sean barras: es contexto de la producción, no una barra más que
          // se compare por altura. Comparte el mismo eje (pedido explícito),
          // sin relleno — solo su color la distingue.
          name: s.name,
          type: "line",
          // Series como Agua/Nitrógeno empiezan a reportarse años después de
          // que arranca la tabla (antes traen 0.0, no null) — sin esto la
          // línea aparecía plana en el suelo antes de existir de verdad.
          data: sinCerosIniciales(s.data),
          smooth: true,
          symbol: categories.length <= 1 ? "circle" : "none",
          symbolSize: 8,
          z: 3,
          lineStyle: { width: 2, color: AGUA_COLOR },
          itemStyle: { color: AGUA_COLOR },
        } : {
          name: s.name,
          type: isBar ? "bar" : "line",
          data: sinCerosIniciales(s.data),
          smooth: true,
          lineStyle: { width: 2, color: colorDeSerie(s.name) },
          // Con una sola categoría no hay segmento de línea que dibujar —
          // symbol:"none" dejaba la gráfica completamente en blanco aunque el
          // dato sí estuviera ahí (el tooltip lo mostraba al pasar el cursor,
          // pero nada visible sin eso). Con 2+ categorías el punto se sigue
          // ocultando para no ensuciar la línea.
          symbol: categories.length <= 1 ? "circle" : "none",
          symbolSize: 8,
          barMaxWidth: 32,
          stack: isBar ? "total" : undefined,
          itemStyle: { color: colorDeSerie(s.name), ...(isBar ? { borderRadius: idx === series.length - 1 ? [6, 6, 0, 0] : 0 } : {}) },
        })),
      };
}

function SingleChart({ title, categories, series, chartType, subtitle, zoomable = false }) {
  const isPie = chartType === "pie";
  const isBar = chartType === "bar";
  const option = buildChartOption(categories, series, chartType, { zoomable });

  // Con pocas categorías y series, limitar y centrar el ancho del gráfico
  // (si no, las barras se ven sueltas). Con muchas series se desactiva para
  // dejarle espacio a la leyenda.
  // El ancho por categoría tiene que crecer con el número de SERIES: son
  // barras agrupadas, así que 3 categorías × 2 series son 6 barras. Con el
  // ancho fijo anterior (130 por categoría) se apretaban y las etiquetas del
  // eje se encimaban hasta desaparecer.
  const anchoPorCategoria = Math.max(130, 60 * Math.max(1, series.length));
  const chartMaxWidth = isBar && categories.length > 0 && categories.length <= 8 && series.length <= 4
    ? Math.max(220, categories.length * anchoPorCategoria)
    : null;

  const chartHeight = !isPie && series.length > 6 ? 380 : 320;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm mb-4">
      <div className="flex items-baseline justify-between mb-3">
        {subtitle
          ? <span className="text-[11px] font-semibold text-teal-700">{subtitle}</span>
          : <span />}
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          {CHART_TYPE_LABEL[chartType] ?? chartType}
        </span>
      </div>
      <ReactECharts
        key={`${chartType}-${chartMaxWidth ?? "full"}`}
        option={option}
        style={chartMaxWidth ? { height: chartHeight, width: chartMaxWidth, margin: "0 auto" } : { height: chartHeight }}
        notMerge
      />
    </div>
  );
}

// "Precios de petróleo y gas": diseño propio (no el genérico Simple/
// SingleChart) — separa Petróleo (Brent/WTI/MME, USD/bbl) de Gas (Henry Hub,
// USD/MMBtu), que son unidades distintas y antes se mezclaban en una sola
// gráfica. Tarjetas grandes con el último valor + variación, más una gráfica
// por grupo con degradado bajo la línea (área semitransparente) — mismo
// lenguaje visual (verde=líquidos, azul=gas) que el resto del tablero.
const PRECIOS_COLORS = {
  "Brent (USD/bbl)": "#0d7a4a",
  "WTI (USD/bbl)": "#3fa66b",
  "MME (USD/bbl)": "#c2661a",
  "Henry Hub (USD/MMBtu)": "#1d6fa5",
};

function PrecioStatCard({ nombre, valor, unidad, cambio, color, min, max, fecha }) {
  if (valor == null) return null;
  const subiendo = cambio > 0, bajando = cambio < 0;
  return (
    <div className="rounded-xl p-4 flex-1 min-w-[150px]" style={{ background: `${color}14`, border: `1px solid ${color}33` }}>
      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color }}>{nombre}</p>
      <p style={{ fontFamily: "'Patria', Georgia, serif", color: "#10312B", fontSize: 26, fontWeight: 700, lineHeight: 1.2, marginTop: 2 }}>
        ${valor.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        <span className="text-[12px] font-normal text-slate-400"> {unidad}</span>
      </p>
      <p className="text-[10px] text-slate-400 -mt-0.5">{fecha ?? "Último dato"}</p>
      {cambio != null && (
        <p className="text-[12px] font-semibold mt-0.5" style={{ color: subiendo ? "#059669" : bajando ? "#dc2626" : "#94a3b8" }}>
          {subiendo ? "↑" : bajando ? "↓" : "—"} {Math.abs(cambio).toFixed(1)}% <span className="font-normal text-slate-400">vs periodo anterior</span>
        </p>
      )}
      {min != null && max != null && (
        <p className="text-[11px] text-slate-400 mt-1">
          Mín ${min.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          {" · "}Máx ${max.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          <span className="block text-[9.5px] text-slate-300">del periodo mostrado</span>
        </p>
      )}
    </div>
  );
}

// Fila de tarjetas de precio (Brent/WTI/MME/Henry Hub) — compartida por la
// vista de tabla y la de gráficos de "Precios de petróleo y gas". El
// mín/máx viene de `extremos` (calculado en el backend sobre el dato diario
// crudo de TODO el periodo mostrado, con la fecha exacta) — antes cada
// tarjeta usaba s.min/s.max, que son el mín/máx solo del ÚLTIMO bucket
// (mes/año), no del periodo completo seleccionado.
function PreciosStatCards({ series, extremos, categories }) {
  const EXTREMOS_KEY = { "Brent (USD/bbl)": "brent", "WTI (USD/bbl)": "wti", "MME (USD/bbl)": "mme", "Henry Hub (USD/MMBtu)": "henry_hub" };

  function ultimoYCambio(s) {
    const vals = s.data.map((v, i) => ({ v, i })).filter(d => d.v != null && d.v !== 0);
    if (!vals.length) return { valor: null, cambio: null, fecha: null };
    const ultimo = vals[vals.length - 1];
    const anterior = vals.length > 1 ? vals[vals.length - 2].v : null;
    return {
      valor: ultimo.v,
      cambio: anterior ? ((ultimo.v - anterior) / anterior) * 100 : null,
      fecha: categories?.[ultimo.i] ?? null,
    };
  }

  if (!series.length) return null;
  return (
    <div className="flex gap-3 flex-wrap mb-5">
      {series.map(s => {
        const { valor, cambio, fecha } = ultimoYCambio(s);
        const ext = extremos?.[EXTREMOS_KEY[s.name]];
        return (
          <PrecioStatCard key={s.name} nombre={s.name.replace(/\s*\(.*\)/, "")}
            valor={valor} unidad={s.name.match(/\((.*)\)/)?.[1] ?? ""} cambio={cambio}
            min={ext?.min?.valor ?? null} max={ext?.max?.valor ?? null} fecha={fecha}
            color={PRECIOS_COLORS[s.name] ?? "#64748b"} />
        );
      })}
    </div>
  );
}

function PreciosGroupChart({ titulo, unidad, categories, series, height = 300 }) {
  if (!series.length) return null;
  const option = {
    color: series.map(s => PRECIOS_COLORS[s.name] ?? "#64748b"),
    tooltip: { trigger: "axis" },
    legend: { top: 0, textStyle: { fontSize: 11 } },
    grid: { left: 48, right: 34, top: 36, bottom: 28 },
    xAxis: { type: "category", data: categories, axisLabel: { fontSize: 10 } },
    yAxis: { type: "value", name: unidad, nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
    series: series.map(s => ({
      name: s.name, type: "line", data: sinCerosIniciales(s.data), smooth: true, showSymbol: false,
      areaStyle: { opacity: 0.12 },
      lineStyle: { width: 2.5 },
      // Líneas punteadas horizontales en el máximo y mínimo de la serie
      // mostrada — mismo color que la línea, sin afectar al eje ni al
      // tooltip de las demás series.
      markLine: {
        symbol: "none",
        lineStyle: { type: "dashed", width: 1, opacity: 0.35 },
        label: { formatter: p => p.name, fontSize: 9, opacity: 0.6 },
        data: [{ type: "max", name: "Máx" }, { type: "min", name: "Mín" }],
      },
    })),
  };
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex-1 min-w-0">
      <p className="text-[12px] font-semibold text-slate-600 mb-1">{titulo}</p>
      <ReactECharts option={option} style={{ height }} notMerge />
    </div>
  );
}

// Centro aproximado de cada país (lng, lat) — suficiente para ubicar el
// clúster de sus empresas sobre el mapa, no se necesita precisión de límites.
const PAIS_CENTRO = {
  ALEMANIA: [10.45, 51.16], ARGENTINA: [-63.62, -38.42], AUSTRALIA: [133.78, -25.27],
  CANADÁ: [-106.35, 56.13], CATAR: [51.18, 25.35], CHINA: [104.2, 35.86],
  COLOMBIA: [-74.3, 4.57], EGIPTO: [30.8, 26.82], ESPAÑA: [-3.75, 40.46],
  "ESTADOS UNIDOS": [-98.58, 39.83], FRANCIA: [2.21, 46.23], HOLANDA: [5.29, 52.13],
  ITALIA: [12.57, 41.87], JAPÓN: [138.25, 36.2], MALASIA: [101.98, 4.21],
  MÉXICO: [-102.55, 23.63], NORUEGA: [8.47, 60.47], "REINO UNIDO": [-3.44, 55.38],
  RUSIA: [49, 56], TAILANDIA: [100.99, 15.87],
};
// Nombre en el mapa (world.json, en inglés) para cada país de nuestros datos.
const PAIS_MAPA_EN = {
  ALEMANIA: "Germany", ARGENTINA: "Argentina", AUSTRALIA: "Australia",
  CANADÁ: "Canada", CATAR: "Qatar", CHINA: "China", COLOMBIA: "Colombia",
  EGIPTO: "Egypt", ESPAÑA: "Spain", "ESTADOS UNIDOS": "United States",
  FRANCIA: "France", HOLANDA: "Netherlands", ITALIA: "Italy", JAPÓN: "Japan",
  MALASIA: "Malaysia", MÉXICO: "Mexico", NORUEGA: "Norway",
  "REINO UNIDO": "United Kingdom", RUSIA: "Russia", TAILANDIA: "Thailand",
};

let worldMapPromise = null;
function useWorldMap() {
  const [ready, setReady] = useState(() => echarts.getMap("world") != null);
  useEffect(() => {
    if (ready) return;
    worldMapPromise ??= fetch("/world.json").then(r => r.json());
    worldMapPromise.then(geo => { echarts.registerMap("world", geo); setReady(true); });
  }, [ready]);
  return ready;
}

// Punto alrededor de un centro en un patrón espiral (índice i-ésimo del
// clúster) — mismo espíritu visual que el "cluster" de fuerza anterior, pero
// con coordenadas geográficas reales en vez de un layout abstracto. La
// distancia en longitud se corrige por la latitud (1° de longitud encoge
// hacia los polos) para que el clúster se vea igual de compacto/redondo sin
// importar el país.
function puntoEnEspiral(i, [lng, lat]) {
  const paso = 0.62, angulo = i * 2.4;
  const r = paso * Math.sqrt(i + 1);
  const corrLng = 1 / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
  return [lng + r * Math.cos(angulo) * corrLng, lat + r * Math.sin(angulo)];
}

// "Contratos adjudicados" — vista de gráficos: con ~20 países como series
// (uno por línea/barra) el gráfico genérico quedaba ilegible. En su lugar,
// un mapa del mundo con un punto grande y fijo por país (su ubicación real)
// y un punto por empresa alrededor, en espiral — mismo "look" de clústers
// que antes, pero sobre geografía real en vez de un layout de fuerza
// abstracto (pedido explícito). Tamaño del punto = total de contratos
// adjudicados (todas las licitaciones/bloques sumados).
function EmpresasClusterChart({ resultado, visibleSeries, onSelectEmpresa }) {
  const mapaListo = useWorldMap();
  // País enfocado (clic en su punto o en su territorio) — acerca el mapa a
  // su zona; "Volver" lo limpia y regresa a la vista mundial completa.
  const [foco, setFoco] = useState(null);
  const paisesVisibles = (resultado.groups ?? []).filter(g => g.cuenca !== "Total general" && visibleSeries[g.cuenca] !== false);

  const totalGeneral = paisesVisibles.reduce((acc, g) => acc + (g.data ?? []).reduce((a, b) => a + (b ?? 0), 0), 0);
  if (!totalGeneral) return <p className="text-sm text-slate-400 p-4">Sin empresas para graficar.</p>;
  if (!mapaListo) return <LoadingSpinner />;

  const empresaMax = Math.max(1, ...paisesVisibles.flatMap(g =>
    (g.subgroups?.[0]?.rows ?? []).filter(r => r.type === "operator").map(r => (r.data ?? []).reduce((a, b) => a + (b ?? 0), 0))
  ));

  const hubs = [];
  const empresas = [];
  const regiones = [];
  paisesVisibles.forEach((g, gi) => {
    const centro = PAIS_CENTRO[g.cuenca];
    const totalPais = (g.data ?? []).reduce((a, b) => a + (b ?? 0), 0);
    if (!totalPais || !centro) return;
    const color = PALETTE[gi % PALETTE.length];
    const nombreMapa = PAIS_MAPA_EN[g.cuenca];
    if (nombreMapa) regiones.push({ name: nombreMapa, itemStyle: { areaColor: color, opacity: 0.18 } });
    hubs.push({
      name: g.cuenca, value: [...centro, totalPais],
      itemStyle: { color, opacity: 0.95, borderWidth: 2, borderColor: "#fff" },
      symbolSize: 14 + 16 * Math.sqrt(totalPais / totalGeneral),
      label: { show: true, formatter: g.cuenca, fontWeight: 700, fontSize: 10.5, color: "#1f2937" },
    });
    let i = 0;
    for (const row of g.subgroups?.[0]?.rows ?? []) {
      if (row.type !== "operator") continue;
      const total = (row.data ?? []).reduce((a, b) => a + (b ?? 0), 0);
      if (!total) continue;
      i++;
      empresas.push({
        name: row.label, pais: g.cuenca, value: [...puntoEnEspiral(i, centro), total],
        itemStyle: { color, opacity: 0.75 },
        symbolSize: 5 + 16 * Math.sqrt(total / empresaMax),
      });
    }
  });

  // Acercamiento: centra el mapa en el país enfocado con un zoom fijo; sin
  // foco, deja que ECharts encuadre el mundo completo (centro/zoom por
  // defecto). El nivel de zoom es fijo (no por tamaño real del país) porque
  // el interés aquí es ver bien el clúster de empresas alrededor del punto,
  // no el país de borde a borde.
  const centroFoco = foco ? PAIS_CENTRO[foco] : null;

  const option = {
    tooltip: {
      formatter: p => `<b>${p.name}</b><br/>${p.value[2]} contrato${p.value[2] === 1 ? "" : "s"}`,
    },
    geo: {
      map: "world", roam: true, top: 44, bottom: 10, left: 10, right: 10,
      itemStyle: { areaColor: "#eef2f5", borderColor: "#cbd5e1", borderWidth: 0.6 },
      emphasis: { itemStyle: { areaColor: "#e2e8f0" }, label: { show: false } },
      regions: regiones,
      ...(centroFoco ? { center: centroFoco, zoom: 7 } : { center: null, zoom: 1 }),
    },
    series: [
      { type: "scatter", coordinateSystem: "geo", data: empresas, silent: false, zlevel: 2 },
      { type: "scatter", coordinateSystem: "geo", data: hubs, silent: false, zlevel: 3 },
    ],
  };

  // Clic en el punto de una EMPRESA -> Ver como tablas, filtrada a esa
  // empresa (pedido explícito: de "vi el clúster" a "vi el detalle" en un
  // clic). Clic en el punto de un país o en su territorio -> enfoca/acerca
  // ese país en el mapa, sin salir de la vista de gráficos.
  const onChartClick = (params) => {
    if (params.componentType === "series") {
      if (params.seriesIndex === 0) { onSelectEmpresa?.(params.name); return; }
      if (params.name) setFoco(params.name);
      return;
    }
    if (params.componentType === "geo") {
      const pais = Object.entries(PAIS_MAPA_EN).find(([, en]) => en === params.name)?.[0];
      if (pais && PAIS_CENTRO[pais]) setFoco(pais);
    }
    // Clic sencillo en zona sin país (mar) no hace nada — doble clic ahí
    // sí resetea (ver dblclick abajo), para no perder el zoom por error con
    // un clic que caiga un poco fuera del territorio.
  };
  // Doble clic en cualquier parte (típicamente el mar/área en blanco, sin
  // país) -> vuelve al mapa mundial en su estado inicial.
  const onChartDblClick = () => setFoco(null);

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex flex-col" style={{ flex: 1, minHeight: 0 }}>
      <div className="flex items-baseline justify-between mb-3 shrink-0">
        <span className="text-[11px] font-semibold text-teal-700">
          Empresas por país
          {foco && <span className="text-slate-400 font-normal"> · enfocado en {foco}</span>}
        </span>
        <div className="flex items-center gap-2">
          {foco && (
            <button onClick={() => setFoco(null)}
              className="px-2.5 py-1 rounded-md text-[10.5px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100">
              ← Volver al mundo
            </button>
          )}
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Clústers</span>
        </div>
      </div>
      <ReactECharts option={option} style={{ flex: 1, minHeight: 0 }} notMerge onEvents={{ click: onChartClick, dblclick: onChartDblClick }} />
    </div>
  );
}

// "Reservas por campo": cascada horizontal por campo (Top N por 3P) en vez
// del genérico Simple/SingleChart — 1P (garantizado) como base, +2P/+3P como
// incrementos apilados, mismos colores que las filas de DynamicTable (verde/
// azul/naranja) para que la lectura sea consistente entre tabla y gráfica.
const RESERVAS_UNIDAD = {
  ReservasP: "MMb", ReservasG: "MMMpc", ReservasPCE: "MMbpce",
  ReservasAsigP: "MMb", ReservasAsigG: "MMMpc", ReservasAsigPCE: "MMbpce",
};
const RESERVAS_TITULO = {
  ReservasP: "Reservas de petróleo por campo", ReservasG: "Reservas de gas por campo", ReservasPCE: "Reservas de petróleo crudo equivalente por campo",
  ReservasAsigP: "Reservas de petróleo por asignación-contrato", ReservasAsigG: "Reservas de gas por asignación-contrato", ReservasAsigPCE: "Reservas de petróleo crudo equivalente por asignación-contrato",
};
// Mismas 3 pestañas Aceite/Gas/PCE, con el json_arg de la familia activa
// (Reservas por campo vs Reservas por asignación-contrato comparten toda la
// UI/gráficas, solo cambia la tabla origen en el backend).
function reservasTabs(esAsig) {
  return esAsig
    ? [["ReservasAsigP", "Aceite"], ["ReservasAsigG", "Gas"], ["ReservasAsigPCE", "PCE"]]
    : [["ReservasP", "Aceite"], ["ReservasG", "Gas"], ["ReservasPCE", "PCE"]];
}

function ultimoValor(arr) {
  return arr?.length ? arr[arr.length - 1] ?? 0 : 0;
}

function sumaArrays(...arrs) {
  const len = Math.max(0, ...arrs.map(a => a?.length ?? 0));
  const out = new Array(len).fill(0);
  for (const a of arrs) (a ?? []).forEach((v, i) => { out[i] += v ?? 0; });
  return out;
}

// Recorre resultado.groups -> subgroups -> rows UNA sola vez y regresa la lista
// plana de items (campo o asignacion/contrato) con su cuenca y sus 3 series
// COMPLETAS (1P/2P/3P, un valor por año) -- base de la que se derivan tanto
// los rankings/snapshots (ultimo año) como las graficas de evolucion anual.
function extraerReservasItems(resultado) {
  const items = [];
  for (const g of resultado.groups ?? []) {
    if (g.cuenca === "Total general") continue;
    for (const sg of g.subgroups ?? []) {
      const rows = sg.rows ?? [];
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].type !== "subtotal") continue;
        const [r1, r2, r3] = [rows[i + 1], rows[i + 2], rows[i + 3]];
        // Reservas por asignacion-contrato intercala un subtotal de Cuenca
        // antes de cada item -- solo es una hoja real si le siguen sus 3 filas
        // 1P/2P/3P (type "operator"), si no, es solo un encabezado de Cuenca.
        if (!r1 || !r2 || !r3 || r1.type !== "operator" || r2.type !== "operator" || r3.type !== "operator") continue;
        items.push({ nombre: rows[i].label, cuenca: g.cuenca, p1: r1.data ?? [], p2: r2.data ?? [], p3: r3.data ?? [] });
      }
    }
  }
  return items;
}

function buildReservasWaterfall(resultado, topN = 8, search = "") {
  const items = extraerReservasItems(resultado);
  const q = search.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const filtrados = q ? items.filter(c => c.nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(q)) : items;
  return filtrados
    .map(c => ({ campo: c.nombre, p1: ultimoValor(c.p1), p2: ultimoValor(c.p2), p3: ultimoValor(c.p3), p1Serie: c.p1, p2Serie: c.p2, p3Serie: c.p3 }))
    .sort((a, b) => b.p3 - a.p3)
    .slice(0, topN);
}

// Tabla para "Generar reporte": una fila real por item (campo/asignación/
// contrato) y año, sin sumarlos entre sí — buildPivotExport (genérico, usado
// por el resto de temas) no distingue el nivel de item aquí y terminaba
// sumando todo dentro de (Ambiente, grupo), de ahí los totales inflados que
// se veían en el PDF. En Asignaciones la Cuenca real sí se conoce (subtotal
// intercalado); en Contratos no se guarda por item, columna en "—".
function buildReservasTabla(resultado, { esReservasAsig, entidadLabel, unidad }) {
  const anios = resultado.categories ?? [];
  const filas = [];
  for (const g of resultado.groups ?? []) {
    if (g.cuenca === "Total general") continue;
    for (const sg of g.subgroups ?? []) {
      const rows = sg.rows ?? [];
      let cuencaActual = null;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].type !== "subtotal") continue;
        const [r1, r2, r3] = [rows[i + 1], rows[i + 2], rows[i + 3]];
        const esItem = r1?.type === "operator" && r2?.type === "operator" && r3?.type === "operator";
        if (!esItem) { cuencaActual = rows[i].label; continue; }
        anios.forEach((anio, ai) => {
          const base = esReservasAsig ? [g.cuenca, cuencaActual ?? "—"] : [g.cuenca];
          filas.push([
            ...base, sg.ubicacion, rows[i].label, anio,
            fmt2(r1.data[ai] ?? 0),
            fmt2(r2.data[ai] ?? 0),
            fmt2(r3.data[ai] ?? 0),
          ]);
        });
      }
    }
  }
  const columnas = esReservasAsig
    ? ["Modalidad", "Cuenca", "Ambiente", entidadLabel, "Año", `1P (${unidad})`, `2P (${unidad})`, `3P (${unidad})`]
    : ["Cuenca", "Ambiente", entidadLabel, "Año", `1P (${unidad})`, `2P (${unidad})`, `3P (${unidad})`];
  return { columnas, filas };
}

// Colores fijos del reporte de referencia (verde=1P, amarillo=2P, naranja=3P)
// — deliberadamente distintos de RESERVAS_CIRCULOS_PALETAS, que varía por
// tipo (Aceite/Gas/PCE); aquí siempre son los mismos 3 colores.
const RESERVAS_CAMPO_GROUP_COLORS = { p1: "#9CCC65", p2: "#FBC02D", p3: "#FFA726" };

// Barras AGRUPADAS (no apiladas) con el valor real de 1P/2P/3P — cada barra
// es el acumulado tal cual (2P y 3P no se convierten a incremento aquí, van
// completas una junto a otra), con eje Y visible. Reemplaza el diseño previo
// de barra apilada por incrementos, que el usuario pidió cambiar por este.
function buildReservasCampoGroupedOption(categories, p1, p2, p3, unidad) {
  const fmt = v => (v ?? 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    backgroundColor: "#fff",
    tooltip: {
      trigger: "axis", axisPointer: { type: "shadow" },
      valueFormatter: v => `${fmt(v)} ${unidad}`,
    },
    legend: {
      data: ["1P", "2P", "3P"],
      top: 0, left: "center", itemGap: 24, icon: "circle",
      textStyle: { fontSize: 12, color: "#475569" },
    },
    grid: { left: 12, right: 16, top: 44, bottom: 30, containLabel: true },
    xAxis: {
      type: "category", data: categories,
      axisLabel: { fontSize: 11, fontWeight: 600, color: "#0f766e" },
      axisLine: { lineStyle: { color: "#cbd5e1" } }, axisTick: { show: false },
    },
    yAxis: {
      type: "value", name: unidad, nameLocation: "end", nameGap: 12,
      nameTextStyle: { fontSize: 11, color: "#334155", align: "left" },
      axisLabel: { fontSize: 10, color: "#64748b" },
      splitLine: { lineStyle: { color: "#f1f5f9" } },
    },
    series: [
      { name: "1P", type: "bar", data: p1, itemStyle: { color: RESERVAS_CAMPO_GROUP_COLORS.p1 }, barMaxWidth: 16 },
      { name: "2P", type: "bar", data: p2, itemStyle: { color: RESERVAS_CAMPO_GROUP_COLORS.p2 }, barMaxWidth: 16 },
      { name: "3P", type: "bar", data: p3, itemStyle: { color: RESERVAS_CAMPO_GROUP_COLORS.p3 }, barMaxWidth: 16 },
    ],
  };
}

// "Gráfica individual por campo": elegir UN campo y ver su evolución anual
// 1P/2P/3P en barras agrupadas.
function ReservasCampoCustomChart({ resultado, unidad, entidad = "campos", selected, onSelectedChange }) {
  const campos = useMemo(
    () => buildReservasWaterfall(resultado, Infinity).sort((a, b) => a.campo.localeCompare(b.campo)),
    [resultado],
  );
  const actual = campos.find(c => c.campo === selected) ?? campos[0];

  if (!campos.length) return <p className="text-sm text-slate-400 p-4">Sin {entidad} con reservas 1P vigentes en el rango seleccionado.</p>;

  const categories = resultado.categories ?? [];
  const option = actual
    ? buildReservasCampoGroupedOption(categories, actual.p1Serie, actual.p2Serie, actual.p3Serie, unidad)
    : null;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm mb-4">
      <div className="mb-3">
        <SearchableSelect options={campos.map(c => c.campo)} value={selected || campos[0]?.campo} onChange={onSelectedChange} />
      </div>
      {option && <ReactECharts option={option} style={{ height: 380 }} notMerge />}
    </div>
  );
}

// Vista por defecto de "Ver como gráficos" (sin modo personalizado elegido):
// suma 1P/2P/3P de TODOS los campos/asignaciones del rango — mismas barras
// agrupadas por año que "Gráfica individual por campo", pero a nivel
// nacional en vez de un campo/asignación puntual.
function ReservasNacionalChart({ resultado, unidad, entidad = "campos" }) {
  const { p1, p2, p3 } = useMemo(() => {
    let p1 = [], p2 = [], p3 = [];
    for (const it of extraerReservasItems(resultado)) {
      p1 = sumaArrays(p1, it.p1);
      p2 = sumaArrays(p2, it.p2);
      p3 = sumaArrays(p3, it.p3);
    }
    return { p1, p2, p3 };
  }, [resultado]);

  if (!p3.some(v => v > 0)) return <p className="text-sm text-slate-400 p-4">Sin {entidad} con reservas 1P vigentes en el rango seleccionado.</p>;

  const categories = resultado.categories ?? [];
  const option = buildReservasCampoGroupedOption(categories, p1, p2, p3, unidad);
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm mb-4">
      <ReactECharts option={option} style={{ height: 380 }} notMerge />
    </div>
  );
}


function PreciosDashboard({ categories, series }) {
  const petroleo = series.filter(s => s.name.includes("USD/bbl"));
  const gas = series.filter(s => s.name.includes("USD/MMBtu"));
  const [grupo, setGrupo] = useState("petroleo");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5 w-fit">
        {[
          { id: "petroleo", label: "Petróleo (USD/bbl)" },
          { id: "gas", label: "Gas natural (USD/MMBtu)" },
        ].map(({ id, label }) => (
          <button key={id} onClick={() => setGrupo(id)}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
              grupo === id ? "bg-tih-dark text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}>
            {label}
          </button>
        ))}
      </div>
      {grupo === "petroleo"
        ? <PreciosGroupChart titulo="Petróleo (USD/bbl)" unidad="USD/bbl" categories={categories} series={petroleo} height={440} />
        : <PreciosGroupChart titulo="Gas natural (USD/MMBtu)" unidad="USD/MMBtu" categories={categories} series={gas} height={440} />}
      <p className="text-[10.5px] text-slate-400">Fuente: Energy Information Administration y Banco de México.</p>
      <p className="text-[10.5px] text-slate-400">
        USD: dólares estadounidenses · bbl: barril · BTU (British Thermal Unit): unidad de energía equivalente al calor necesario para elevar 1°F la temperatura de una libra de agua · MMBtu: millón de BTU, unidad usada para el gas natural.
      </p>
    </div>
  );
}

// ── Inversiones aprobadas por cuenca ────────────────────────────────────────
// El switch "Ver como tablas/gráficos" (ViewBar) vive lógicamente aquí en
// ChartArea —el estado (viewMode, chartType) y las opciones dependen de qué
// tema está activo, calculadas junto al resto de esta pantalla—, pero se
// pidió que aparezca VISUALMENTE en la barra de filtros del encabezado
// (tema/periodicidad/periodo), cargado a la derecha bajo el buscador. En vez
// de mover ese estado al store global solo para poder pintarlo desde TopBar,
// se porta con un Portal al hueco que TopBar ya deja listo
// (#tih-viewbar-slot, ver styles/header.css) — el DOM final queda en el
// header, pero la lógica sigue en un solo lugar.
//
// `useSlot` reintenta encontrar el nodo en cada render (barato: un solo
// getElementById) porque en el primer montaje de la app TopBar podría no
// haber pintado el slot todavía cuando ChartArea corre su primer render.
function useSlot(id) {
  const [el, setEl] = useState(() => (typeof document !== "undefined" ? document.getElementById(id) : null));
  useEffect(() => {
    if (!el) setEl(document.getElementById(id));
  });
  return el;
}

function ViewBarPortal({ children }) {
  const slot = useSlot("tih-viewbar-slot");
  if (!slot) return null;
  return createPortal(children, slot);
}

function ViewBar({ viewMode, setViewMode, chartType, setChartType, hideGraphics = false, extra, extraModos = [], onGenerarReporte, hideChartTypes = false, chartTypes = CHART_TYPES }) {
  const modos = [
    ...(hideGraphics
      ? [{ id: "tablas", label: "Ver como tablas" }]
      : [{ id: "tablas", label: "Ver como tablas" }, { id: "graficos", label: "Ver como gráficos" }]),
    ...extraModos,
  ];
  // Sin margen inferior: ahora vive en el hueco de la barra de filtros del
  // encabezado (ver ViewBarPortal más abajo), no ya al tope del contenido.
  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
          {modos.map(({ id, label }) => (
            <button key={id} onClick={() => setViewMode(id)}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewMode === id ? "bg-tih-dark text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}>
              {label}
            </button>
          ))}
        </div>
        {!hideGraphics && viewMode === "graficos" && extra}
      </div>
      <div className="flex items-center gap-2">
        {!hideGraphics && !hideChartTypes && viewMode === "graficos" && (
          <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
            {chartTypes.map(({ id, label, icon }, idx) => (
              <button key={id} title={label} onClick={() => setChartType(id)}
                className={`px-3 py-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors ${
                  chartType === id ? "bg-tih-dark text-white" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                } ${idx < chartTypes.length - 1 ? "border-r border-slate-200" : ""}`}>
                {icon}
              </button>
            ))}
          </div>
        )}
        {!hideGraphics && viewMode === "graficos" && onGenerarReporte && (
          <button onClick={onGenerarReporte}
            title="Arma un PDF eligiendo la gráfica, la tabla y/o los filtros"
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 shrink-0">
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2.5" y="1.5" width="11" height="13" rx="1.2" />
              <path d="M5 5h6M5 7.5h6M5 10h3.5" />
            </svg>
            Generar reporte
          </button>
        )}
      </div>
    </div>
  );
}

function filterSeries(series, visibleSeries) {
  return series.filter(s => visibleSeries[s.name] !== false);
}

// Series que son la SUMA de otras series de la misma lista. Graficarlas junto
// a sus componentes no agrega informacion —"Hidrocarburos liquidos" es
// petroleo + condensado, "Gas" es asociado + no asociado— y si duplica la
// escala del eje, que tiene que llegar al total y deja a los componentes
// aplastados abajo. Se quitan de la GRAFICA (y por lo tanto de las chips, que
// son su control); en la TABLA se quedan, ahi el subtotal si se lee.
const PARTES_DEL_SUBTOTAL = {
  "Hidrocarburos líquidos": ["Petróleo", "Condensado", "Súper-ligero", "Ligero", "Mediano", "Pesado", "Extra-pesado"],
  "Gas": ["Gas asociado", "Gas no asociado", "Metano", "Etano", "Propano", "Butano", "Isobutano", "Pentano +", "Ácido sulfhídrico", "Dióxido de carbono"],
  "Producción": ["Petróleo", "Condensado", "Gas", "Gas asociado", "Gas no asociado"],
};
const _base = n => String(n ?? "").split(" (")[0].trim();

function sinSubtotales(series) {
  const presentes = new Set((series ?? []).map(s => _base(s.name)));
  const sobran = new Set();
  for (const [total, partes] of Object.entries(PARTES_DEL_SUBTOTAL)) {
    // Solo se quita el total si algun componente suyo esta de verdad en la
    // grafica: hay temas que traen "Gas" sin desglose, y ahi el total ES el
    // dato. Con UN componente ya sobra: una asignacion que solo produce gas
    // asociado dibujaba "Gas" exactamente encima de "Gas asociado".
    if (presentes.has(total) && partes.some(p => presentes.has(p))) sobran.add(total);
  }
  const restantes = (series ?? []).filter(s => !sobran.has(_base(s.name)));
  return restantes.length > 0 ? restantes : series ?? [];
}

// Los paneles de una vista "por producto": se separan por UNIDAD (Mbd vs
// MMpcd), que es lo que no se puede mezclar en un mismo eje.
//
// El agua comparte unidad con petróleo y condensado pero no es un
// hidrocarburo: viaja con las series de Mbd (pedido explícito: "que el agua se
// vea en todos los gráficos de Mbd"), en el mismo eje, distinguida solo por su
// color (ver utils/estiloAgua.js). Solo cae en su propio panel si no hay
// ningún líquido con que acompañarla, o en pastel (que no tiene ejes).
function partirSeriesPorUnidad(series, { aguaAparte = false } = {}) {
  const esMMpcd = s => s.name.includes("MMpcd");
  const mbdTodo = series.filter(s => !esMMpcd(s));
  const liquidos = mbdTodo.filter(s => !esAgua(s.name));
  const agua = mbdTodo.filter(s => esAgua(s.name));
  const sola = aguaAparte || liquidos.length === 0;
  return {
    mbd: sola ? liquidos : mbdTodo,
    agua: sola ? agua : [],
    mmpcd: series.filter(esMMpcd),
  };
}

function GraficasPorUnidad({ series, categories, titulo, chartType, zoomable = false }) {
  const { mbd, agua, mmpcd } = partirSeriesPorUnidad(series, { aguaAparte: chartType === "pie" });
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {mbd.length > 0 && (
        <SingleChart title={titulo} categories={categories} series={mbd} chartType={chartType} subtitle="Mbd" zoomable={zoomable} />
      )}
      {mmpcd.length > 0 && (
        <SingleChart title={titulo} categories={categories} series={mmpcd} chartType={chartType} subtitle="MMpcd" zoomable={zoomable} />
      )}
      {agua.length > 0 && (
        <SingleChart title={titulo} categories={categories} series={agua} chartType={chartType} subtitle="Agua · Mbd" zoomable={zoomable} />
      )}
    </div>
  );
}

const GROUP_TABS = [
  { id: "cuenca",    label: "Por cuenca geológica" },
  { id: "ubicacion", label: "Por ambiente" },
  { id: "plan",      label: "Por categoría" },
  { id: "operador",  label: "Por operador" },
];

function GroupByBar({ groupBy, setGroupBy }) {
  return (
    <div className="flex items-center gap-1.5 mb-3 flex-wrap">
      {GROUP_TABS.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => setGroupBy(groupBy === id ? null : id)}
          className={`px-3 py-1 rounded-full text-[11.5px] font-medium border transition-all ${
            groupBy === id
              ? "bg-tih-dark text-white border-tih-dark"
              : "bg-white text-slate-500 border-slate-200 hover:border-teal-400 hover:text-teal-700"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Unidad correcta por tema: la mayoría son Mbd de líquidos, Gcompo es gas en MMpcd.
const PRODUCCION_TOTAL_LIQUIDOS = "Producción total de hidrocarburos líquidos (Mbd)";
const PRODUCCION_TOTAL_LABEL = {
  Cuenca: PRODUCCION_TOTAL_LIQUIDOS, Campos: PRODUCCION_TOTAL_LIQUIDOS, API: PRODUCCION_TOTAL_LIQUIDOS,
  Operadores: PRODUCCION_TOTAL_LIQUIDOS, InteresPart: PRODUCCION_TOTAL_LIQUIDOS,
  Contratos: PRODUCCION_TOTAL_LIQUIDOS, Asignaciones: PRODUCCION_TOTAL_LIQUIDOS,
  Estado: PRODUCCION_TOTAL_LIQUIDOS, Gcompo: "Gas total (MMpcd)",
};

const KPI_CONFIG = [
  {
    key:   (k) => k.total?.toLocaleString("es-MX"),
    label: (topic) => PRODUCCION_TOTAL_LABEL[topic] ?? "Total de pozos",
    nota:  (topic, kpis) => `Dato del último periodo mostrado${kpis.periodo_dato ? ` (${kpis.periodo_dato})` : ""}.`,
    // Solo donde la cifra ES el rollup de líquidos; en Gcompo (gas) o en los
    // temas de conteo de pozos la explicación no aplica.
    tooltip: (topic) => PRODUCCION_TOTAL_LABEL[topic] === PRODUCCION_TOTAL_LIQUIDOS
      ? "Hidrocarburos líquidos: es la suma de petróleo y condensado."
      : null,
    icon:  (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
        <circle cx="12" cy="12" r="9"/><line x1="12" y1="3" x2="12" y2="21"/>
        <path d="M3 12h18M5.5 6.5C7.5 9 9.5 10.5 12 10.5s4.5-1.5 6.5-4M5.5 17.5C7.5 15 9.5 13.5 12 13.5s4.5 1.5 6.5 4"/>
      </svg>
    ),
    color: "#10312B",
  },
  {
    key:   (k) => k.anio_top,
    label: "Periodo más activo",
    nota:  (topic) => {
      const label = PRODUCCION_TOTAL_LABEL[topic];
      if (!label) return "Periodo con el valor más alto dentro del rango seleccionado.";
      const que = label === PRODUCCION_TOTAL_LIQUIDOS ? "hidrocarburos líquidos" : "gas";
      return `Periodo con el valor más alto de ${que} dentro del rango seleccionado.`;
    },
    icon:  (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    ),
    color: "#059669",
  },
  {
    key:   (k) => k.cuenca_top,
    label: "Cuenca más activa",
    nota:  "Acumulado de todo el periodo seleccionado, por cuenca.",
    icon:  (
      <svg viewBox="0 0 512 512" fill="currentColor" className="w-6 h-5">
        <path d="M506.752,291.992h-28.989c-0.73,0-1.457,0.157-2.126,0.448l-25.459,11.32c-1.895,0.841-3.114,2.722-3.114,4.788v17.583c0,0.791-0.178,1.574-0.524,2.286l-11.805,24.394h-12.946c-0.68,0-1.353,0.135-1.98,0.392l-32.463,13.28c-1.706,0.698-3.65,0.449-5.126-0.662l-9.479-7.103c-0.844-0.635-1.863-0.998-2.918-1.048l-14.583-0.627c-1.693-0.079-3.249-0.97-4.168-2.387l-35.184-54.302c-0.74-1.148-1.004-2.536-0.74-3.876l13.522-67.596c0.495-2.486-0.855-4.966-3.213-5.899l-33.517-13.273c-1.204-0.47-2.187-1.374-2.76-2.528l-27.407-54.815c-0.802-1.603-2.369-2.686-4.15-2.864l-17.608-1.824c-2.048-0.214-4.032,0.798-5.069,2.572l-7.074,12.118c-0.713,1.232-1.895,2.116-3.277,2.45c-1.379,0.342-2.839,0.107-4.039-0.655l-15.695-9.882c-1.218-0.762-2.07-1.994-2.352-3.405l-3.33-16.657c-0.218-1.09-0.784-2.087-1.61-2.843l-25.171-22.954c-0.965-0.877-2.226-1.368-3.534-1.368h-22.317c-2.893,0-5.24,2.344-5.24,5.243v2.978h-34.87c-0.851,0-1.692-0.206-2.444-0.606L43.826,83.006C43.07,82.607,42.23,82.4,41.378,82.4H5.244c-1.646,0-3.199,0.769-4.185,2.087c-0.991,1.311-1.311,3.014-0.855,4.596l14.167,49.592c0.235,0.826,0.673,1.582,1.272,2.202l18.719,19.392c1.909,1.974,1.966,5.087,0.135,7.131l-7.042,7.872c-0.958,1.069-1.436,2.487-1.318,3.919c0.118,1.438,0.819,2.757,1.941,3.662l28.081,22.599c0.851,0.691,1.47,1.631,1.763,2.678l7.477,26.924c0.193,0.691,0.524,1.332,0.972,1.888l30.069,37.232c0.95,1.183,2.365,1.888,3.879,1.945c1.51,0.057,2.974-0.542,4.015-1.639l6.946-7.36c1.696-1.795,1.909-4.531,0.516-6.561l-18.887-27.607c-0.064-0.092-0.125-0.185-0.182-0.285L75.074,202.98c-0.228-0.384-0.406-0.798-0.531-1.226l-8.595-29.708c-0.172-0.577-0.442-1.126-0.798-1.624l-25.152-34.575c-0.399-0.555-0.692-1.183-0.855-1.845l-7.15-29.409l26.624,12.168c1.361,0.628,2.394,1.803,2.832,3.235l11.299,36.912c0.225,0.734,0.606,1.403,1.118,1.974l41.607,46.23c1.24,1.382,1.66,3.306,1.107,5.072l-2.322,7.438c-0.556,1.774-0.128,3.705,1.118,5.087l68.953,76.003c0.877,0.969,1.361,2.223,1.361,3.527v19.342l-4.909,1.511c-1.454,0.449-2.64,1.503-3.252,2.892c-0.613,1.39-0.595,2.978,0.05,4.353l9.775,20.768c0.517,1.104,1.408,1.994,2.518,2.515l152.764,71.608c1.999,0.94,4.371,0.526,5.935-1.04l17.234-17.226c0.98-0.984,2.316-1.54,3.705-1.54h12.582c1.094,0,2.166,0.342,3.057,0.984l30.969,22.214c1.315,0.948,2.993,1.226,4.538,0.77c1.553-0.449,2.804-1.604,3.398-3.106l6.957-17.668c0.766-1.938,2.604-3.242,4.688-3.32l13.714-0.506c2.818-0.106,5.051-2.422,5.051-5.236v-4.538c0-1.718-0.845-3.328-2.262-4.311l-6.166-4.267c-1.415-0.976-2.259-2.586-2.259-4.31v-12.048h28.326c1.81,0,3.488-0.933,4.446-2.465l34.653-55.442c0.52-0.827,0.798-1.796,0.798-2.779v-12.154C512,294.336,509.649,291.992,506.752,291.992z"/>
      </svg>
    ),
    color: "#4f46e5",
  },
  {
    key:   (k) => k.operador_top,
    label: (topic) => (topic === "PozosCampos" || topic === "Campos") ? "Campo principal"
      : topic === "API" ? "Clase API principal"
      : topic === "Contratos" ? "Grupo principal"
      : topic === "Asignaciones" ? "Cuenca principal"
      : topic === "Estado" ? "Entidad principal"
      : topic === "Gcompo" ? "Componente principal"
      : "Operador principal",
    nota:  "Acumulado de todo el periodo seleccionado.",
    icon:  (
      <svg viewBox="0 0 503.607 503.607" fill="currentColor" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <g transform="translate(1 1)">
          <path d="M477.426,416.993c-50.095-26.565-88.52-41.461-122.727-47.172l3.54-4.867c1.679-1.679,2.518-4.197,1.679-6.715l-7.866-31.463c20.804-29.41,33.046-66.178,33.046-101.153v-33.574h8.393h16.787c5.036,0,8.393-3.357,8.393-8.393s-3.357-8.393-8.393-8.393h-8.393v-8.393c0-66.308-43.646-122.544-109.115-141.01V24.18c0-13.43-10.911-25.18-25.18-25.18h-33.574c-13.43,0-25.18,10.911-25.18,25.18v1.679c-65.469,18.466-109.115,74.702-109.115,141.01v8.393h-8.393c-5.036,0-8.393,3.357-8.393,8.393s3.357,8.393,8.393,8.393h16.787h8.393v33.574c0,34.975,12.242,71.743,33.046,101.154l-7.866,31.463c0,1.679,0,5.036,1.679,6.715l3.54,4.867c-34.206,5.712-72.632,20.607-122.727,47.172C8.233,424.548-1,440.495-1,458.121v36.092c0,5.036,3.357,8.393,8.393,8.393h201.443h3.357h77.22h3.357h201.443c5.036,0,8.393-3.357,8.393-8.393v-36.092C502.607,441.334,492.534,425.387,477.426,416.993z M245.77,409.224l5.081-11.432l12.545,27.6l8.205,18.46h-40.941L245.77,409.224z M224.28,460.639h52.983l4.796,25.18h-62.815L224.28,460.639z M338.934,343.131l3.357,15.108l-8.574,11.773c-0.547,0.447-1.053,0.989-1.498,1.656l-34.912,48.34l-11.078,15.211l-22.628-50.913c27.048-3.299,51.193-16.877,70.694-36.39c0.216-0.214,0.433-0.426,0.648-0.642c0.052-0.053,0.104-0.106,0.156-0.159C336.392,345.818,337.671,344.492,338.934,343.131z M327.999,60.389c0.932,0.62,1.856,1.25,2.77,1.892c10.699,7.973,20.575,17.313,28.31,27.368l-38.61,7.554L327.999,60.389z M181.138,97.203l-38.61-7.554c7.735-10.056,17.612-19.396,28.311-27.369c0.913-0.641,1.837-1.271,2.769-1.891L181.138,97.203z M116.508,166.869c0-22.335,5.623-43.406,15.8-61.82l58.063,11.46c0.839,0,0.839,0,1.679,0c2.518,0,4.197-0.839,6.715-1.679c2.518-1.679,3.357-5.036,2.518-7.554l-11.523-56.08c6.069-2.92,12.438-5.428,19.077-7.49v22.442c0,5.036,3.357,8.393,8.393,8.393s8.393-3.357,8.393-8.393V32.574V24.18c0-4.197,3.357-8.393,8.393-8.393h33.574c4.197,0,8.393,3.357,8.393,8.393v8.393v33.574c0,5.036,3.357,8.393,8.393,8.393c5.036,0,8.393-3.357,8.393-8.393V43.706c6.86,2.13,13.435,4.734,19.685,7.779l-11.291,54.952c0,2.518,0.839,5.875,2.518,7.554s3.357,2.518,5.875,2.518c0.839,0,0.839,0,1.679,0l57.687-12.145c10.416,18.576,16.175,39.894,16.175,62.505v8.393h-8.393H124.902h-8.393V166.869z M133.295,192.049h235.016v33.574c0,36.599-12.555,69.122-31.405,93.843l-0.49,0.163c-0.839,0.839-1.679,1.679-2.518,2.518c-4.223,5.631-8.68,10.765-13.337,15.394c-19.763,18.412-43.336,29.564-66.05,30.669c-1.143-0.491-2.425-0.738-3.708-0.738c-1.29,0-2.453,0.253-3.496,0.749c-13.904-0.638-28.134-5.045-41.623-12.584c-13.665-7.851-26.52-19.169-37.977-33.49c-0.839-0.839-1.679-1.679-2.518-2.518l-0.49-0.163c-18.85-24.722-31.405-57.245-31.405-93.843V192.049z M238.005,384.308l-22.628,50.913l-11.078-15.211l-34.912-48.34c-0.267-0.267-0.563-0.532-0.869-0.793l-9.203-12.637l3.357-15.108c1.138,1.225,2.292,2.419,3.457,3.594C185.833,366.877,210.408,380.942,238.005,384.308z M15.787,458.121c0-10.911,5.875-20.984,15.948-26.02c53.501-28.423,92.015-42.688,126.323-46.949l50.088,68.87l-6.359,31.796H15.787V458.121z M485.82,485.82H299.821l-6.359-31.796l50.63-69.616c34.188,5.159,73.391,19.413,125.78,46.855c10.072,5.875,15.948,15.948,15.948,26.859V485.82z"/>
        </g>
      </svg>
    ),
    color: "#d97706",
  },
  {
    key:   (k) => k.ubicacion_top,
    label: "Ambiente principal",
    nota:  "Acumulado de todo el periodo seleccionado, por ambiente.",
    icon:  (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z"/>
      </svg>
    ),
    color: "#0d9488",
  },
];

// KPIs genéricos para resultados de una sola dimensión (operador, estado,
// grupo de contrato, componente de gas…), calculados en el cliente a partir
// de series+categorías.
function buildSimpleKpis(categories, series) {
  if (!categories?.length || !series?.length) return null;
  const lastIdx = categories.length - 1;
  // Si una serie ya es el agregado de las demás (p. ej. "Gas total" en Gcompo),
  // usarla directo — sumar todas las series duplicaría el total.
  const totalSerie = series.length > 1 ? series.find(s => /\btotal\b/i.test(s.name) || s.name === "Nacional") : null;
  const seriesForTotal = totalSerie ? [totalSerie] : series;
  const total = seriesForTotal.reduce((sum, s) => sum + (s.data?.[lastIdx] ?? 0), 0);
  const totalsByCat = categories.map((_, i) => seriesForTotal.reduce((sum, s) => sum + (s.data?.[i] ?? 0), 0));
  const anioTopIdx = totalsByCat.reduce((best, v, i) => (v > totalsByCat[best] ? i : best), 0);
  // Excluir el agregado del cálculo del "top" (siempre ganaría por ser la suma de todas).
  const seriesForTop = totalSerie ? series.filter(s => s !== totalSerie) : series;
  const totalsBySerie = seriesForTop.map(s => (s.data ?? []).reduce((a, b) => a + (b ?? 0), 0));
  const topSerieIdx = totalsBySerie.reduce((best, v, i) => (v > totalsBySerie[best] ? i : best), 0);
  return {
    total: Math.round(total),
    anio_top: categories[anioTopIdx],
    operador_top: seriesForTop[topSerieIdx]?.name,
    periodo_dato: categories[lastIdx],
  };
}

function KpiCards({ kpis, topic }) {
  const [oculto, setOculto] = useState(false);
  // Ocultarlas vale solo para el tema que se está viendo: cada tema arranca
  // con sus indicadores a la vista (pedido explícito). Se ajusta en el render
  // en vez de con un efecto para no dibujar un cuadro con el estado viejo.
  const [temaPrevio, setTemaPrevio] = useState(topic);
  if (topic !== temaPrevio) {
    setTemaPrevio(topic);
    setOculto(false);
  }

  if (!kpis) return null;
  const items = KPI_CONFIG
    .map(cfg => ({ ...cfg, value: cfg.key(kpis) }))
    .filter(({ value }) => value !== null && value !== undefined && value !== "" && value !== 0 && value !== "0");
  if (!items.length) return null;
  return (
    <div className="mb-5">
      <div className="flex justify-end mb-1.5">
        <button
          onClick={() => setOculto(v => !v)}
          title={oculto ? "Mostrar los indicadores" : "Ocultar los indicadores para ganar espacio"}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-slate-500 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors"
        >
          {oculto ? (
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
          {oculto ? "Mostrar indicadores" : "Ocultar indicadores"}
        </button>
      </div>
      {!oculto && (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {items.map(({ label, color, value, nota, tooltip }) => {
        const labelText = typeof label === "function" ? label(topic, kpis) : label;
        const notaText = typeof nota === "function" ? nota(topic, kpis) : nota;
        const tooltipText = typeof tooltip === "function" ? tooltip(topic, kpis) : tooltip;
        return (
          <div
            key={labelText}
            className="rounded-xl px-4 py-3.5 flex flex-col gap-2 bg-white border border-slate-200 shadow-sm"
          >
            <div className="flex items-center gap-1.5 text-slate-400">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
              <span
                className={`text-[10px] font-semibold uppercase tracking-wider leading-tight ${tooltipText ? "cursor-help" : ""}`}
                title={tooltipText || undefined}
              >
                {labelText}
                {notaText && <span className="ml-0.5 font-bold">*</span>}
              </span>
            </div>
            <p className="text-slate-800 text-lg font-bold leading-tight truncate">
              {value ?? "—"}
            </p>
            {notaText && (
              <p className="text-[9.5px] text-slate-400 leading-tight -mt-1.5">* {notaText}</p>
            )}
          </div>
        );
      })}
    </div>
      )}
    </div>
  );
}

// ── Series para la gráfica según groupBy ────────────────────────────────────
function buildHierSeries(resultado, groupBy) {
  const groups   = resultado.groups ?? [];
  const nacGroup = groups.find(g => g.cuenca === "Nacional");

  if (!groupBy || groupBy === "ubicacion") {
    if (!nacGroup) return [];
    return (nacGroup.subgroups ?? [])
      .filter(sg => sg.ubicacion !== "Nacional")
      .map(sg => ({ name: sg.ubicacion, data: sg.rows?.[0]?.data ?? [] }));
  }

  if (groupBy === "cuenca") {
    return groups
      .filter(g => g.cuenca !== "Nacional")
      .map(g => ({
        name: g.cuenca,
        data: g.subgroups?.[0]?.rows?.[0]?.data ?? [],
      }));
  }

  if (groupBy === "plan") {
    const nacSg = nacGroup?.subgroups?.find(sg => sg.ubicacion === "Nacional");
    if (!nacSg) return [];
    return (nacSg.rows ?? [])
      .filter(r => r.type === "subtotal")
      .map(r => ({ name: r.label, data: r.data }));
  }

  if (groupBy === "operador") {
    const nacSg = nacGroup?.subgroups?.find(sg => sg.ubicacion === "Nacional");
    if (!nacSg) return [];
    const ops = (nacSg.rows ?? [])
      .filter(r => r.type === "operator")
      .map(r => ({ name: r.label, data: r.data, total: r.data.reduce((a, b) => a + (b ?? 0), 0) }));

    const hasMix = ops.some(o => o.name.startsWith("Pemex")) && ops.some(o => !o.name.startsWith("Pemex"));
    if (hasMix) {
      const sum = (arr) => arr.reduce(
        (acc, r) => r.data.map((v, i) => (acc[i] ?? 0) + (v ?? 0)),
        []
      );
      const pemexOps = ops.filter(o => o.name.startsWith("Pemex"));
      const privOps  = ops.filter(o => !o.name.startsWith("Pemex"));
      return [
        { name: "Pemex",    data: sum(pemexOps), color: "#10b981" },
        { name: "Privados", data: sum(privOps),  color: "#6366f1" },
        ...ops
          .sort((a, b) => b.total - a.total)
          .slice(0, 10)
          .map(({ name, data }) => ({ name, data })),
      ];
    }

    return ops
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map(({ name, data }) => ({ name, data }));
  }

  return [];
}

// Series para "Producción por ubicación" (Cuenca+Ambiente → Producto). Aquí
// la hoja siempre es el producto; cuenca y ambiente son dimensiones de
// filtro, no de serie, y sus combinaciones seleccionadas se suman en un
// solo total por producto.
function buildProdCuencaSeries(resultado) {
  const cats = resultado.categories ?? [];
  const groups = resultado.groups ?? [];
  const nacGroup = groups.find(g => g.cuenca === "Nacional");
  const cuencaGroups = groups.filter(g => g.cuenca !== "Nacional");

  // Sin cuenca(s) filtradas: solo existe el grupo Nacional, con los productos
  // ya agregados nacionalmente como filas "subtotal".
  if (cuencaGroups.length === 0) {
    const nacSg = nacGroup?.subgroups?.find(sg => sg.ubicacion === "Nacional");
    if (!nacSg) return [];
    return (nacSg.rows ?? [])
      .filter(r => r.type === "subtotal")
      .map(r => ({ name: r.label, data: r.data }));
  }

  // Con cuenca(s) filtradas: sumar por producto a través de todas las
  // combinaciones cuenca×ambiente presentes.
  const merged = new Map();
  for (const g of cuencaGroups) {
    for (const sg of g.subgroups ?? []) {
      for (const row of sg.rows ?? []) {
        if (row.type !== "operator") continue; // fila de producto (hoja)
        if (!merged.has(row.label)) merged.set(row.label, cats.map(() => 0));
        const acc = merged.get(row.label);
        row.data.forEach((v, i) => { acc[i] += v ?? 0; });
      }
    }
  }
  return [...merged].map(([name, data]) => ({ name, data }));
}

// "Gráfica individual" de "Producción por ubicación": para un Ambiente
// elegido, suma a través de todas las cuencas la fila de cada producto (todas
// sus categorías/leaf rows con ese label exacto) — una serie por producto,
// toda la producción de ese ambiente junta en una sola gráfica.
function buildUbicacionSeries(resultado, ubicacion) {
  const cats = resultado.categories ?? [];
  const merged = new Map();
  for (const g of (resultado.groups ?? [])) {
    if (g.cuenca === "Nacional") continue;
    const sg = (g.subgroups ?? []).find(s => s.ubicacion === ubicacion);
    if (!sg) continue;
    for (const row of sg.rows ?? []) {
      if (row.label === "Producción") continue; // subtotal redundante con la suma de productos
      if (!merged.has(row.label)) merged.set(row.label, cats.map(() => 0));
      const acc = merged.get(row.label);
      row.data.forEach((v, i) => { acc[i] += v ?? 0; });
    }
  }
  return [...merged].map(([name, data]) => ({ name, data })).filter(s => s.data.some(v => v));
}

// Captura genérica de todas las gráficas ECharts montadas dentro de un
// contenedor — funciona sin necesitar un ref propio por cada variante de
// gráfica (Operadores, Cuenca, Contratos, comparaciones, small multiples…);
// usa la API global de ECharts para ubicar instancias por su nodo DOM, así
// "Generar reporte" ve cualquier gráfica que esté en pantalla en ese momento.
function capturarGraficasEnContenedor(container) {
  if (!container) return [];
  const imagenes = [];
  const vistos = new Set();
  container.querySelectorAll("div").forEach(div => {
    const inst = echarts.getInstanceByDom(div);
    if (!inst || vistos.has(inst)) return;
    vistos.add(inst);
    try {
      const dataUrl = inst.getDataURL({ pixelRatio: 2, backgroundColor: "#fff" });
      imagenes.push({ dataUrl, width: inst.getWidth(), height: inst.getHeight() });
    } catch { /* instancia no lista todavía, se omite */ }
  });
  return imagenes;
}

// Arma y descarga el PDF a partir de los bloques que el usuario eligió en
// ReportBuilderModal — usado por las 3 variantes de vista de ChartArea
// (jerárquica, tabs, simple), cada una pasando su propia "tabla" ya calculada
// como {columnas, filas} plano (misma forma que usa jspdf-autotable).
async function generarReporteDesdeBloques(seleccion, { tabla, filtrosLineas, tituloReporte, periodoNota, contentRef }) {
  const { exportarReportePdf } = await import("../../utils/exportPdf");
  const bloques = [];
  for (const id of seleccion) {
    if (id === "grafica") {
      const imgs = capturarGraficasEnContenedor(contentRef?.current);
      imgs.forEach(img => bloques.push({ tipo: "imagen", dataUrl: img.dataUrl, width: img.width, height: img.height }));
    } else if (id === "tabla" && tabla) {
      bloques.push({ tipo: "titulo", texto: tituloReporte || "Tabla de datos" });
      bloques.push({ tipo: "tabla", ...tabla });
    } else if (id === "filtros") {
      bloques.push({ tipo: "filtros", lineas: filtrosLineas ?? [] });
    }
  }
  await exportarReportePdf({
    titulo: tituloReporte || "Reporte",
    periodoNota,
    bloques,
    nombreArchivo: `TIH_${tituloReporte || "reporte"}_reporte.pdf`,
  });
}

// Exportación a PNG con branding institucional — banner con degradado verde,
// logo de Energía (el mismo del header) y título, en formato apaisado fijo
// (no depende del ancho del panel en pantalla). Toda "Gráfica individual"
// (Operadores, Producción por ubicación, y las que se agreguen después) usa
// esta misma función para que el PNG resultante tenga siempre el mismo estilo.
function exportChartPng(chartRef, { titulo, filename }) {
  const inst = chartRef.current?.getEchartsInstance?.();
  if (!inst) return;
  const original = { width: inst.getWidth(), height: inst.getHeight() };
  inst.resize({ width: 1000, height: 560 });
  const url = inst.getDataURL({ pixelRatio: 2, backgroundColor: "#fff" });
  inst.resize({ width: original.width, height: original.height });

  const logo = new Image();
  logo.crossOrigin = "anonymous";
  logo.onload = () => {
    const img = new Image();
    img.onload = () => {
      const bannerH = 56;
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height + bannerH;
      const ctx = canvas.getContext("2d");
      const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
      grad.addColorStop(0, "#10312B");
      grad.addColorStop(1, "#1a4a3a");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, bannerH);
      const logoH = bannerH - 20;
      const logoW = logoH * (logo.width / logo.height);
      ctx.drawImage(logo, 20, 10, logoW, logoH);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 15px 'Noto Sans', sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(titulo, 20 + logoW + 14, bannerH / 2);
      ctx.drawImage(img, 0, bannerH);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = filename;
      a.click();
    };
    img.src = url;
  };
  logo.src = "/logosener-blanco.png";
}

// Selector buscable: en todas las "Gráfica individual" (Operador, Cuenca/
// Ambiente, Contrato…) la lista puede tener decenas de opciones — un <select>
// nativo no deja escribir para filtrar, así que se reemplaza por un combobox
// con input de texto + lista filtrada en vivo.
function SearchableSelect({ options, value, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const ref = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = query.trim()
    ? options.filter(o => o.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(query.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()))
    : options;

  // Al abrir, escribir, o cambiar el filtrado, resaltar la opción actual (si
  // sigue en la lista) o la primera — así las flechas siempre parten de un
  // punto conocido en vez de "ninguna resaltada".
  useEffect(() => {
    if (!open) return;
    const idxActual = filtered.indexOf(value);
    setHighlight(filtered.length ? (idxActual >= 0 ? idxActual : 0) : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, filtered.length]);

  function moveHighlight(delta) {
    if (!filtered.length) return;
    setHighlight(h => {
      const next = ((h < 0 ? 0 : h) + delta + filtered.length) % filtered.length;
      listRef.current?.children?.[next]?.scrollIntoView?.({ block: "nearest" });
      return next;
    });
  }

  function elegir(o) {
    onChange(o);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(e) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { setOpen(true); return; }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); moveHighlight(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveHighlight(-1); }
    else if (e.key === "Enter") { e.preventDefault(); if (highlight >= 0 && filtered[highlight]) elegir(filtered[highlight]); }
    else if (e.key === "Escape") { setOpen(false); }
  }

  return (
    <div ref={ref} className="relative" style={{ minWidth: 240 }}>
      <input
        type="text"
        value={open ? query : value}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onKeyDown={handleKeyDown}
        placeholder="Buscar…"
        className="w-full text-[12px] border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-teal-400"
      />
      {open && (
        <ul ref={listRef} className="absolute z-50 top-full mt-1 left-0 right-0 max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
          {filtered.length === 0 && <li className="px-3 py-1.5 text-[12px] text-slate-400">Sin resultados</li>}
          {filtered.map((o, i) => (
            <li key={o}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => elegir(o)}
              className={`px-3 py-1.5 text-[12px] cursor-pointer ${
                i === highlight ? "bg-teal-100 text-teal-800" : o === value ? "text-teal-700 font-semibold bg-teal-50/50" : "text-slate-700 hover:bg-teal-50"
              }`}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Las "Gráfica individual" muestran TODOS los productos de la entidad
// elegida, y esos productos no comparten unidad: petróleo/condensado/agua van
// en Mbd y el gas en MMpcd. En un solo eje el gas (miles de MMpcd) aplastaba a
// los líquidos hasta dejarlos pegados al cero. Se parten en un panel por
// unidad, igual que la vista general (GraficasPorUnidad). El agua viaja con
// los líquidos, en su eje tenue a la derecha (ver utils/estiloAgua.js).
// Cada panel exporta su propio PNG: son gráficas distintas, no una sola.
// El nombre que llega del buscador y el que lista el selector salen de la
// misma fuente, pero no siempre con el mismo formato (acentos, mayusculas,
// espacios de mas). Se comparan normalizados para que un detalle tipografico
// no deje la preseleccion sin efecto.
function _mismaEntidad(a, b) {
  const n = v => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
  return n(a) === n(b);
}

// Busca en la lista del selector la entidad que pidio el buscador global.
function usarSeleccion(opciones, seleccionInicial, setSelected) {
  useEffect(() => {
    if (!seleccionInicial || !opciones?.length) return;
    const hit = opciones.find(o => _mismaEntidad(o, seleccionInicial));
    if (hit) setSelected(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionInicial, opciones?.length]);
}

function PanelUnidadPersonalizada({ unidad, series, categories, chartType, titulo, filenameBase, zoomable, altura }) {
  const chartRef = useRef(null);
  const option = useMemo(
    () => buildChartOption(categories, series, chartType, { zoomable }),
    [categories, series, chartType, zoomable],
  );
  return (
    <div className="mb-2">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[11px] font-semibold text-teal-700">{unidad}</span>
        <button
          onClick={() => exportChartPng(chartRef, {
            titulo: `${titulo} — ${unidad}`,
            filename: `${filenameBase}_${unidad}.png`,
          })}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50"
        >
          Exportar PNG
        </button>
      </div>
      <ReactECharts ref={chartRef} option={option} style={{ height: altura }} notMerge />
    </div>
  );
}

function GraficasPersonalizadasPorUnidad({ series, categories, chartType, titulo, filenameBase, zoomable = false, altura = 380 }) {
  const { mbd, mmpcd } = partirSeriesPorUnidad(sinSubtotales(series ?? []));
  const paneles = [["Mbd", mbd], ["MMpcd", mmpcd]].filter(([, ss]) => ss.length > 0);
  if (!paneles.length) return <p className="text-sm text-slate-400 p-4">Sin datos para graficar.</p>;
  return paneles.map(([unidad, ss]) => (
    <PanelUnidadPersonalizada
      key={unidad} unidad={unidad} series={ss} categories={categories}
      chartType={chartType} titulo={titulo} filenameBase={filenameBase}
      zoomable={zoomable} altura={paneles.length > 1 ? Math.round(altura * 0.8) : altura}
    />
  ));
}

// "Gráfica individual": el usuario elige UNA empresa y ve toda su
// producción (todos los productos con datos), en un panel por unidad,
// cada uno exportable como PNG con un banner de título superpuesto.
function OperadorCustomChart({ empresas, categories, chartType, tituloTema, visibleSeries = {}, seleccionInicial }) {
  const [selected, setSelected] = useState(empresas[0]?.empresa ?? "");
  usarSeleccion(empresas.map(e => e.empresa), seleccionInicial, setSelected);
  const emp = empresas.find(e => e.empresa === selected) ?? empresas[0];
  const series = filterSeries(emp?.series ?? [], visibleSeries);

  if (!empresas.length) return <p className="text-sm text-slate-400 p-4">Sin empresas disponibles para graficar.</p>;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm mb-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <SearchableSelect
          options={empresas.map(e => e.empresa)}
          value={selected || empresas[0]?.empresa}
          onChange={setSelected}
        />
      </div>
      <GraficasPersonalizadasPorUnidad
        series={series} categories={categories} chartType={chartType} zoomable
        titulo={`${tituloTema} — ${emp?.empresa ?? ""}`}
        filenameBase={`produccion_${(emp?.empresa ?? "operador").replace(/\s+/g, "_")}`}
      />
    </div>
  );
}

// "Gráfica individual" de "Producción por contrato": el usuario elige UN
// contrato y ve toda su producción (todos los productos con datos), en un
// panel por unidad — mismo patrón que OperadorCustomChart.
function ContratoCustomChart({ contratos, categories, chartType, tituloTema, badgeFor, seleccionInicial }) {
  const [selected, setSelected] = useState(contratos[0]?.nombre ?? "");
  usarSeleccion(contratos.map(c => c.nombre), seleccionInicial, setSelected);
  const contrato = contratos.find(c => c.nombre === selected) ?? contratos[0];
  const series = contrato?.series ?? [];

  if (!contratos.length) return <p className="text-sm text-slate-400 p-4">Sin contratos disponibles para graficar.</p>;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm mb-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <SearchableSelect
            options={contratos.map(c => c.nombre)}
            value={selected || contratos[0]?.nombre}
            onChange={setSelected}
          />
          {badgeFor && contrato && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: "#e6f4f1", color: "#0d6a5c" }}>
              {badgeFor(contrato)}
            </span>
          )}
        </div>
      </div>
      <GraficasPersonalizadasPorUnidad
        series={series} categories={categories} chartType={chartType}
        titulo={`${tituloTema} — ${contrato?.nombre ?? ""}`}
        filenameBase={`produccion_${(contrato?.nombre ?? "contrato").replace(/\s+/g, "_")}`}
      />
    </div>
  );
}

// "Gráfica individual" de "Producción por ubicación": el usuario elige UN
// Ambiente y ve toda su producción (los 8 productos con datos, sumados a
// través de todas las cuencas), en un panel por unidad, exportables a PNG.
function CuencaCustomChart({ ubicaciones, resultado, categories, chartType, tituloTema }) {
  const [selected, setSelected] = useState(ubicaciones[0] ?? "");
  const ubicacion = selected || ubicaciones[0];
  const series = useMemo(() => buildUbicacionSeries(resultado, ubicacion), [resultado, ubicacion]);

  if (!ubicaciones.length) return <p className="text-sm text-slate-400 p-4">Sin ambientes disponibles para graficar.</p>;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm mb-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <SearchableSelect
          options={ubicaciones}
          value={ubicacion}
          onChange={setSelected}
        />
      </div>
      <GraficasPersonalizadasPorUnidad
        series={series} categories={categories} chartType={chartType}
        titulo={`${tituloTema} — ${ubicacion}`}
        filenameBase={`produccion_${ubicacion.replace(/\s+/g, "_")}`}
      />
    </div>
  );
}

const CHIP_COLORS = [
  "#0db4be","#4f46e5","#f59e0b","#10b981",
  "#f43f5e","#a78bfa","#34d399","#fb923c",
  "#60a5fa","#e879f9","#84cc16","#38bdf8",
];

// El color tiene que seguir a la SERIE, no a su posicion en la lista. Antes
// chips y graficas indexaban su paleta por orden, y como cada panel (Mbd /
// MMpcd) reinicia el indice, "Gas asociado" salia del color de "Petroleo" y
// el chip decia otra cosa que la linea. Al colgar el color del nombre, chips,
// leyendas y lineas coinciden siempre, y prender o apagar una serie ya no
// repinta a las demas.
const COLOR_POR_SERIE = {
  "Petróleo": "#0db4be",
  "Condensado": "#4f46e5",
  "Hidrocarburos líquidos": "#0f766e",
  "Gas": "#0891b2",
  "Gas asociado": "#f59e0b",
  "Gas no asociado": "#10b981",
  "Nitrógeno": "#f43f5e",
  "Agua": AGUA_COLOR,
};

function colorDeSerie(nombre) {
  const base = String(nombre ?? "").split(" (")[0].trim();
  if (COLOR_POR_SERIE[base]) return COLOR_POR_SERIE[base];
  // Series sin color asignado (clases de API, componentes del gas, empresas,
  // cuencas…): un indice estable derivado del nombre, para que la serie
  // conserve su color aunque cambie el filtro o el orden.
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;
  return CHIP_COLORS[h % CHIP_COLORS.length];
}

function SeriesChips({ items, visibleSeries, toggleSerie, setAllVisible }) {
  if (!items.length) return null;
  const allNames = items.map(s => s.name);
  const allVisible = allNames.every(n => visibleSeries[n] !== false);

  return (
    <div className="flex items-center gap-2 flex-wrap mb-5">
      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest shrink-0 self-center">Series</span>
      {items.map((s) => {
        const visible = visibleSeries[s.name] !== false;
        const color = colorDeSerie(s.name);
        return (
          <button
            key={s.name}
            onClick={() => toggleSerie(s.name)}
            style={visible
              ? { background: color + "18", borderColor: color + "55", color }
              : { background: "#f1f5f9", borderColor: "#e2e8f0", color: "#cbd5e1" }
            }
            className="flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-semibold transition-all duration-200 cursor-pointer hover:scale-105 active:scale-95 select-none"
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: visible ? color : "#cbd5e1", boxShadow: visible ? `0 0 5px ${color}99` : "none" }}
            />
            {s.name}
          </button>
        );
      })}
      <button
        onClick={() => setAllVisible(allNames, !allVisible)}
        className="text-[10px] font-semibold text-tih-teal hover:underline ml-1 opacity-70 hover:opacity-100 transition-opacity"
      >
        {allVisible ? "Ocultar todo" : "Mostrar todo"}
      </button>
    </div>
  );
}

const PERIOD_LABEL = { annually: "Anual", monthly: "Mensual", daily: "Diario" };

// Contratos con su Ronda/Farmouts/Migraciones y Licitación, para el selector
// de "Gráfica individual" de Inversiones por contrato — recorre
// resultado.groups (ya viene Ronda → Licitación (subtotal) → Contrato).
function buildContratosInvCont(resultado) {
  const contratos = [];
  for (const g of resultado.groups ?? []) {
    if (g.cuenca === "Total general") continue;
    let licitacionActual = null;
    for (const row of g.subgroups?.[0]?.rows ?? []) {
      if (row.type === "subtotal") { licitacionActual = row.label; continue; }
      if (row.type === "operator") {
        contratos.push({
          nombre: row.label,
          series: [{ name: "Monto aprobado (USD)", data: row.data, type: "line" }],
          grupo: g.cuenca,
          licitacion: licitacionActual,
        });
      }
    }
  }
  return contratos;
}

function DataTitle({ titulo, period, start_year, end_year }) {
  if (!titulo) return null;
  const periodLabel = PERIOD_LABEL[period] ?? period;
  return (
    <div className="mb-4">
      <h2 style={{ fontFamily: "'Patria', Georgia, serif", color: "#10312B", fontSize: 20, fontWeight: 700, lineHeight: 1.2, margin: 0 }}>
        {titulo}
      </h2>
      <p style={{ fontFamily: "'Noto Sans', sans-serif", fontSize: 11, color: "#94a3b8", fontWeight: 500, marginTop: 3, letterSpacing: "0.03em" }}>
        {periodLabel} · {start_year} – {end_year}
      </p>
    </div>
  );
}

export default function ChartArea() {
  const { resultado, loading, error, tema, visibleSeries, toggleSerie, setAllVisible, groupBy, setGroupBy, period, start_year, end_year, start_month, end_month, perfFiltros, prodFiltros, prodOpciones, compareMode, reservasTipo, setReservasTipo, reservasSearch, setReservasSearch, reservasCampoSel, setReservasCampoSel, pendingBusqueda, pendingIndividual, setPendingIndividual } = useExplorer();
  const [viewMode, setViewMode]   = useState("tablas");
  const [chartType, setChartType] = useState("line");

  // Al llegar desde una ficha con una búsqueda dirigida a otra vista del tema
  // (hoy: el Ranking de Asignaciones, única vista donde aparece una asignación
  // individual), se cambia a esa vista para que su buscador pueda recibirla.
  useEffect(() => {
    if (!pendingBusqueda?.vista) return;
    if (pendingBusqueda.tema !== tema?.json_arg) return;
    setViewMode(pendingBusqueda.vista);
  }, [pendingBusqueda, tema?.json_arg]);
  // "Precios de petróleo y gas": arranca en gráficos (el diseño propio,
  // PreciosDashboard, es lo útil aquí) en vez de la tabla por defecto.
  useEffect(() => {
    if (tema?.json_arg === "Precios") setViewMode("graficos");
  }, [tema?.json_arg]);
  // Inversiones/Pozos comprometidos: sin línea (no aporta con pocos periodos/
  // sin serie temporal) — arranca en barras si venía de otro tema con "line".
  useEffect(() => {
    const esInvOPozos = ["InvCuenca", "InvCont", "PozosLic", "EfectivoLic", "InvLic", "EmpresasG"].includes(tema?.json_arg);
    if (esInvOPozos && chartType === "line") setChartType("bar");
  }, [tema?.json_arg]);
  // "Producción por operador": sin Pastel ni Mapa de calor (no aportan con
  // la jerarquía Empresa→Contrato→Producto de este tema).
  useEffect(() => {
    if (tema?.json_arg === "Operadores" && (chartType === "pie" || chartType === "heatmap")) setChartType("bar");
  }, [tema?.json_arg]);
  // "Licitaciones y Contratos": siempre arranca en tabla (nunca en gráfico).
  useEffect(() => {
    if (tema?.seccion === "Licitaciones y Contratos") setViewMode("tablas");
  }, [tema?.json_arg]);
  // Fichas de entidad (campo/asignación/pozo/operador): la pila vive en
  // FichaProvider (App.jsx) y el modal se monta una sola vez ahí, así que
  // aquí solo se dispara la apertura.
  const { abrirCampo, abrirAsignacion, abrirOperador } = useAbrirFicha();
  // Panel de desglose por pozo al hacer clic en una celda de la tabla de
  // Pozos perforados/terminados (Actividad petrolera).
  const [perfPozosSeleccion, setPerfPozosSeleccion] = useState(null);
  // Contrato cuyo desglose de "Pozos comprometidos" está abierto.
  const [pozosComprometidosSel, setPozosComprometidosSel] = useState(null);
  // {empresa, columna} de la celda abierta en "Contratos adjudicados".
  const [empresasSel, setEmpresasSel] = useState(null);
  // Mismo desglose por pozo, pero al hacer clic en la celda numérica de
  // "Pozos operando por campo" (campo + periodo, no cuenca/ubicación/categoría).
  const [pozosCampoSeleccion, setPozosCampoSeleccion] = useState(null);
  // Vista general vs. "Gráfica individual" (una empresa en Operadores, un
  // Ambiente en "Producción por ubicación").
  const [operadorPersonalizada, setOperadorPersonalizada] = useState(false);
  // Entidad que pidió el buscador global para la "Gráfica individual" de este
  // tema: al llegar buscando UNA asignación/campo/contrato, si el usuario pasa
  // a gráficos lo que quiere ver es la de ella, no la primera de la lista.
  const [individualSel, setIndividualSel] = useState(null);
  // Estos dos efectos van en ESTE orden a propósito: al llegar desde el
  // buscador los dos se disparan en el mismo commit (cambia el tema y llega la
  // bandera), y corren en orden de declaración. Al revés, el de limpieza
  // borraba justo después la selección que el otro acababa de poner.
  // Al cambiar de tema se olvida: la entidad pertenecía al tema anterior.
  useEffect(() => {
    setIndividualSel(null);
    setOperadorPersonalizada(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tema?.json_arg]);
  useEffect(() => {
    if (!tema) return;
    if (pendingIndividual && pendingIndividual.tema === tema.json_arg) {
      setIndividualSel(pendingIndividual.nombre);
      // Se enciende la vista individual, pero NO se cambia a gráficos: el
      // usuario llega a la tabla, que es donde ve el dato. Si decide pasar a
      // gráficos, ya está puesta la suya.
      setOperadorPersonalizada(true);
      setPendingIndividual(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingIndividual, tema?.json_arg]);

  // Inversiones por contrato: gráfica individual por contrato (el botón
  // de Filtros vive en TopBar, igual que Perforación/Producción).
  const [invPersonalizada, setInvPersonalizada] = useState(false);
  // Contratos adjudicados: clic en el punto de una empresa en el mapa de
  // clústers -> Ver como tablas, ya filtrada a esa empresa (mismo buscador
  // de texto de la tabla, controlado desde aquí para poder empujarle un
  // valor desde el mapa).
  const [empresaBuscar, setEmpresaBuscar] = useState("");
  // Buscador de la tabla general, controlado desde aquí (mismo motivo que
  // empresaBuscar/reservas): al saltar de tema desde una ficha —"Ver … en el
  // Explorador"— la DynamicTable se desmonta y remonta cuando llegan los datos
  // del tema nuevo, y una búsqueda guardada solo en su estado local se perdía.
  // Viviendo en ChartArea, que no se desmonta, sobrevive a ese remonte.
  const [busquedaTabla, setBusquedaTabla] = useState("");
  // Ídem para el buscador del Ranking de Asignaciones: también se remonta al
  // llegar sus datos y perdía la búsqueda traída desde la ficha.
  const [busquedaRanking, setBusquedaRanking] = useState("");
  // Se limpia al cambiar de tema DURANTE EL RENDER (no en un efecto): los
  // efectos de los hijos corren antes que los del padre, así que limpiarla en
  // un efecto borraría la búsqueda que la tabla acaba de aplicar al llegar
  // desde una ficha. Patrón de "reiniciar estado cuando cambia una prop".
  const [temaDeBusqueda, setTemaDeBusqueda] = useState(tema?.json_arg);
  if (temaDeBusqueda !== tema?.json_arg) {
    setTemaDeBusqueda(tema?.json_arg);
    setBusquedaTabla("");
    setBusquedaRanking("");
  }
  // Reservas por campo: "Gráfica individual" tiene dos variantes propias
  // (por cuenca / por campo) en vez del botón simple de Inversiones/Contratos.
  const [reservasModo, setReservasModo] = useState(null);
  // "Generar reporte" desde la vista de gráficas (tabs/simple/gráfico
  // jerárquico) — contentRef envuelve lo que esté montado ahora mismo, para
  // ubicar las instancias de ECharts renderizadas sin necesitar un ref propio
  // por cada variante de gráfica (Operadores, Cuenca, comparaciones…).
  const contentRef = useRef(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);

  // La tabla de Perforación agrupa por distintas dimensiones según el
  // groupBy activo (Ambiente/Cuenca/Categoría/Nacional) — "_cuenca"/"_ub" de
  // cada fila representan cosas distintas en cada caso (ver flattenGroups en
  // DynamicTable.jsx); "Nacional" es el sentinela de "sin filtrar esa
  // dimensión, no se inventa un valor".
  function celdaAFiltroPerforacion(row, groupByActivo) {
    // Vista multinivel (flattenMultiLevel — la que realmente se usa cuando
    // hay algún filtro de Ambiente/Cuenca/Categoría activo, el caso por
    // defecto en Perforación): las dimensiones activas viajan en
    // _dimUbicacion/_dimCuenca/_dimCategoria, ya resueltas por nivel.
    if (row._dimUbicacion !== undefined || row._dimCuenca !== undefined || row._dimCategoria !== undefined) {
      return {
        cuenca: row._dimCuenca ?? "",
        ubicacion: row._dimUbicacion ?? "",
        categoriaPozo: row._dimCategoria ?? "",
      };
    }
    // Vista simple (flattenGroups, sin filtros activos): _cuenca/_ub son
    // sentinelas "Nacional" cuando esa dimensión no está filtrada, y _ub
    // cambia de significado según groupBy (ambiente, cuenca o categoría).
    const cuenca = row._cuenca && row._cuenca !== "Nacional" ? row._cuenca : "";
    if (groupByActivo === "plan") {
      return { cuenca, ubicacion: "", categoriaPozo: row._ub && row._ub !== "Nacional" ? row._ub : "" };
    }
    return {
      cuenca,
      ubicacion: row._ub && row._ub !== "Nacional" ? row._ub : "",
      categoriaPozo: "",
    };
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <LoadingSpinner message="Consultando base de datos…" />
    </div>
  );

  if (error) return (
    <div className="m-4 p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-600 text-sm">{error}</div>
  );

  if (!tema) return (
    <div className="flex-1 min-h-0 flex flex-col">
      <HomeDashboard />
    </div>
  );

  // "Pozos": drill-down Cuenca→Campo→Pozo, maneja su propio fetch (no pasa por "resultado").
  if (tema?.json_arg === "Pozos") {
    return (
      <div style={{ flex: 1, minHeight: 0 }}>
        <PozosExplorer />
      </div>
    );
  }

  if (!resultado) return (
    <div className="flex flex-col items-center justify-center h-64 text-slate-400">
      <p className="text-sm">Selecciona un tema para visualizar</p>
    </div>
  );

  const tituloTema = acentuarTema(tema?.titulo || tema?.tema || "");

  // ── Inversiones aprobadas por cuenca / por contrato: Total (+ desglose) →
  // grupo → (Licitación →) hoja — mismo componente y estilo que las tablas
  // jerárquicas de Producción/Perforación (DynamicTable), backend ya entrega
  // groups/subgroups/rows en ese formato. groupBy fijo en "cuenca": es la
  // única jerarquía que tiene cada uno de estos temas, sin filtros propios
  // que la cambien. Botón "Filtros" vive en TopBar.jsx (mismo lugar que
  // Perforación/Producción, junto a Periodo) — aquí solo se lee
  // visibleSeries, que ese drawer ya controla. La búsqueda de texto de la
  // tabla cubre cualquier nivel (cuenca/entidad/ambiente o ronda/licitación/
  // contrato) y abre la rama donde está el resultado.
  if (["InvCuenca", "InvCont", "PozosLic", "EfectivoLic", "InvLic", "EmpresasG", "ReservasP", "ReservasG", "ReservasPCE", "ReservasAsigP", "ReservasAsigG", "ReservasAsigPCE"].includes(tema?.json_arg)) {
    const esCuenca = tema.json_arg === "InvCuenca";
    const esPozos = tema.json_arg === "PozosLic";
    const esEmpresas = tema.json_arg === "EmpresasG";
    const esReservasCampo = ["ReservasP", "ReservasG", "ReservasPCE"].includes(tema.json_arg);
    const esReservasAsig = ["ReservasAsigP", "ReservasAsigG", "ReservasAsigPCE"].includes(tema.json_arg);
    const esReservas = esReservasCampo || esReservasAsig;
    const reservasUnidad = RESERVAS_UNIDAD[reservasTipo] ?? "MMb";
    const tituloReservas = RESERVAS_TITULO[reservasTipo] ?? tituloTema;
    const esModalidad = ["PozosLic", "EfectivoLic", "InvLic"].includes(tema.json_arg);
    const gruposChip = (resultado.groups ?? []).filter(g => g.cuenca !== "Total general");
    const chartSeries = gruposChip
      .filter(g => visibleSeries[g.cuenca] !== false)
      .map(g => ({ name: g.cuenca, type: chartType === "bar" ? "bar" : "line", data: g.data ?? [] }));
    const contratosPersonalizada = tema.json_arg === "InvCont" ? buildContratosInvCont(resultado) : [];
    const verPersonalizada = contratosPersonalizada.length > 0 && invPersonalizada;
    const notaUnidad = esEmpresas ? "Cifras en número de contratos por empresa."
      : esPozos ? "Cifras en número de pozos comprometidos."
      : esReservas ? "1P = Probadas, 2P = Probadas + Probables, 3P = Probadas + Probables + Posibles."
      : tema.json_arg === "InvLic" ? "Montos en millones de USD (dólares estadounidenses). PMT: Programa Mínimo de Trabajo."
      : "Montos en USD (dólares estadounidenses).";
    const rowHeaderLabel = esCuenca ? "Cuenca / Entidad Federativa / Ambiente"
      : esEmpresas ? "Empresa"
      : esReservasAsig ? "Asignaciones-Contratos / Ambiente / Cuenca / item"
      : esReservas ? "Cuenca / Ambiente / Campo"
      : esModalidad ? "Modalidad / Ronda-Licitación / Contrato"
      : "Ronda / Licitación / Contrato";
    const searchPlaceholder = esCuenca ? "Buscar cuenca, entidad o ambiente"
      : esEmpresas ? "Buscar empresa o país"
      : esReservasAsig ? "Buscar cuenca, ambiente o asignación/contrato"
      : esReservas ? "Buscar cuenca, ambiente o campo"
      : esModalidad ? "Buscar modalidad, ronda, licitación o contrato"
      : "Buscar ronda, licitación o contrato";
    const reservasTabsActivas = reservasTabs(esReservasAsig);
    const entityLabelValor = esEmpresas ? "empresas" : esReservasAsig ? "asignaciones/contratos" : esReservas ? "campos" : esModalidad || !esCuenca ? "contratos" : "ambientes";

    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {esReservas && (
          <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm w-fit mb-3">
            {reservasTabsActivas.map(([id, label], idx) => (
              <button key={id} onClick={() => setReservasTipo(id)}
                className={`px-4 py-2 text-[12px] font-semibold transition-colors ${
                  reservasTipo === id ? "bg-tih-dark text-white" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                } ${idx < reservasTabsActivas.length - 1 ? "border-r border-slate-200" : ""}`}>
                {label}
              </button>
            ))}
          </div>
        )}
        <ViewBarPortal>
          <ViewBar
            viewMode={viewMode} setViewMode={setViewMode} chartType={chartType} setChartType={setChartType}
            hideChartTypes
            onGenerarReporte={() => setReportModalOpen(true)}
            extra={esReservas ? (
              <button
                onClick={() => setReservasModo(m => m === "campo" ? null : "campo")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                  reservasModo === "campo" ? "bg-tih-dark text-white border-tih-dark" : "bg-white text-slate-600 border-slate-200 hover:border-teal-400"
                }`}>
                Gráfica individual por {esReservasAsig ? "asignación/contrato" : "campo"}
              </button>
            ) : contratosPersonalizada.length > 0 ? (
              <button
                onClick={() => setInvPersonalizada(v => !v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                  invPersonalizada ? "bg-tih-dark text-white border-tih-dark" : "bg-white text-slate-600 border-slate-200 hover:border-teal-400"
                }`}>
                Gráfica individual
              </button>
            ) : null}
          />
        </ViewBarPortal>
        {viewMode === "graficos" && !verPersonalizada && !esReservas && !esEmpresas && (
          <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm w-fit mb-4">
            {CHART_TYPES.filter(t => t.id === "bar" || t.id === "pie").map(({ id, label, icon }, idx, arr) => (
              <button key={id} title={label} onClick={() => setChartType(id)}
                className={`px-3 py-2.5 min-h-[40px] min-w-[40px] flex items-center justify-center transition-colors ${
                  chartType === id ? "bg-tih-dark text-white" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                } ${idx < arr.length - 1 ? "border-r border-slate-200" : ""}`}>
                {icon}
              </button>
            ))}
          </div>
        )}
        <div ref={contentRef} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {viewMode === "graficos" ? (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {esReservas
              ? reservasModo === "campo"
                ? <ReservasCampoCustomChart resultado={resultado} unidad={reservasUnidad} entidad={esReservasAsig ? "asignaciones/contratos" : "campos"} selected={reservasCampoSel} onSelectedChange={setReservasCampoSel} />
                : <ReservasNacionalChart resultado={resultado} unidad={reservasUnidad} entidad={esReservasAsig ? "asignaciones/contratos" : "campos"} />
              : esEmpresas
              ? <EmpresasClusterChart resultado={resultado} visibleSeries={visibleSeries}
                  onSelectEmpresa={(nombre) => { setEmpresaBuscar(nombre); setViewMode("tablas"); }} />
              : verPersonalizada
              ? <ContratoCustomChart contratos={contratosPersonalizada} categories={resultado.categories ?? []} chartType={chartType === "heatmap" ? "line" : chartType} tituloTema={tituloTema}
                  badgeFor={c => `${c.grupo}${c.licitacion ? " · " + c.licitacion : ""}`} />
              : <SingleChart title={tituloTema} categories={resultado.categories ?? []} series={chartSeries} chartType={chartType === "heatmap" ? "line" : chartType} />}
            <p className="text-[10.5px] text-slate-400 mt-1">{notaUnidad} Fuente: Secretaría de Energía.</p>
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ flex: 1, minHeight: 0 }}>
              <DynamicTable
                resultado={resultado}
                visibleSeries={visibleSeries}
                groupBy="cuenca"
                titulo={esReservas ? tituloReservas : tituloTema}
                period={esModalidad || esEmpresas ? null : period} start_year={start_year} end_year={end_year}
                entityLabel={entityLabelValor}
                rowHeaderLabel={rowHeaderLabel}
                searchPlaceholder={searchPlaceholder}
                preserveColumnOrder={esModalidad || esEmpresas}
                sinResumen={esReservasAsig}
                flatAlfabetico={esEmpresas}
                temaJsonArg={tema?.json_arg}
                // "Inversiones aprobadas por contrato": las hojas son contratos
                // (CNH-…) con el mismo código que usa PRODUCCION_CAMPOS, así que
                // abren la misma ficha que en Producción y desde ahí se llega a
                // su operador, campos y pozos. Los contratos sin producción
                // existen (inversión aprobada pero aún sin producir) y la ficha
                // lo dice explícitamente en vez de fallar.
                // Todos estos temas tienen el contrato como fila hoja. El código
                // se escribe distinto según la tabla de origen
                // ("CNH-A3.CÁRDENAS-MORA/2018" en producción vs
                // "CNH-A3-CÁRDENAS-MORA/2018" en licitaciones), pero la ficha
                // compara normalizado, así que basta con mandar la etiqueta.
                onRowClick={
                  ["InvCont", "PozosLic", "EfectivoLic", "InvLic"].includes(tema.json_arg)
                    ? (code) => abrirAsignacion(code)
                    : undefined
                }
                // En Reservas la fila del campo (o de la asignación/contrato) ES
                // la entidad, pero su clic izquierdo ya está ocupado desplegando
                // el 1P/2P/3P — la ficha va con clic derecho, igual que en
                // Campos/Contratos/Asignaciones de Producción.
                onRowFicha={
                  esReservasCampo ? (code) => abrirCampo(code)
                    : esReservasAsig ? (code) => abrirAsignacion(code)
                    : undefined
                }
                // El número es un conteo del plan (sin lista detrás): el panel
                // lo desglosa por estado y nombra los pozos que el catálogo sí
                // tiene registrados para ese contrato.
                onCellClick={
                  tema.json_arg === "PozosLic"
                    ? (row) => setPozosComprometidosSel(row._code ?? row.label)
                    // "Contratos adjudicados": la celda cruza empresa (fila) ×
                    // ronda-licitación (columna); el panel abre los contratos
                    // de ese cruce con sus empresas participantes.
                    : tema.json_arg === "EmpresasG"
                    ? (row, columna) => setEmpresasSel({ empresa: row.label, columna })
                    : undefined
                }
                {...(esReservas ? { search: reservasSearch, onSearchChange: setReservasSearch }
                  : esEmpresas ? { search: empresaBuscar, onSearchChange: setEmpresaBuscar } : {})}
              />
            </div>
            <p className="text-[10.5px] text-slate-400 mt-1 shrink-0">{notaUnidad}</p>
          </div>
        )}
        </div>
        {reportModalOpen && (
          <ReportBuilderModal
            graficaDisponible={viewMode === "graficos"}
            onClose={() => setReportModalOpen(false)}
            onGenerar={(seleccion) => generarReporteDesdeBloques(seleccion, {
              tabla: buildReservasTabla(resultado, { esReservasAsig, entidadLabel: entityLabelValor, unidad: reservasUnidad }),
              filtrosLineas: [],
              tituloReporte: esReservas ? tituloReservas : tituloTema,
              periodoNota: `${PERIOD_LABEL[period] ?? period} — ${start_year} — ${end_year}`,
              contentRef,
            })}
          />
        )}
        {pozosComprometidosSel && (
          <PozosComprometidosDetallePanel
            contrato={pozosComprometidosSel}
            onClose={() => setPozosComprometidosSel(null)}
          />
        )}
        {empresasSel && (
          <ContratosAdjudicadosDetallePanel
            empresa={empresasSel.empresa}
            columna={empresasSel.columna}
            onClose={() => setEmpresasSel(null)}
          />
        )}
      </div>
    );
  }

  // ── Jerárquico (perforación) ──────────────────────────────────────────────
  if (resultado.type === "hierarchical") {
    // "Producción por ubicación" reusa los niveles de perforación (Ambiente >
    // Cuenca); "Producto" queda como hoja directa, no como tercer nivel.
    const esOperadores = tema?.json_arg === "Operadores";
    // Cuenca, Contrato, Campo, Asignación y Entidad Federativa comparten el
    // mismo diseño Nacional → Producto (subtotal) → hoja: los productos son
    // siempre las series/chips, sin dimensión Cuenca/Ambiente que filtrar
    // salvo en "Cuenca". buildProdCuencaSeries ya soporta el caso "sin
    // cuenca(s) filtradas" (solo grupo Nacional), que es el único caso para
    // los 4 temas nuevos.
    const esProdCuenca = ["Cuenca", "Contratos", "Campos", "Asignaciones", "Estado", "Gcompo"].includes(tema?.json_arg);
    // "Producción por Entidad Federativa": jerarquía fija Entidad → Producto →
    // Ambiente, cada entidad es su propio grupo (groupBy="cuenca" siempre,
    // ver TopBar.jsx) — mismo patrón que la vista "por empresa" de Operadores,
    // sin nodo "Nacional" ni dimensión Cuenca/Ambiente que filtrar.
    const esEstado = tema?.json_arg === "Estado";
    // Campo/Asignación: al filtrar por Ambiente/Cuenca se agrega un nivel
    // "Producto" forzado (vía "categorias") para el drill-down de 4 niveles
    // Ambiente→Cuenca→Producto→hoja del backend.
    const esProductoNivelForzado = ["Campos", "Asignaciones"].includes(tema?.json_arg);
    const hayFiltroCuencaUbic = (prodFiltros.cuencas?.length ?? 0) > 0 || (prodFiltros.ubicaciones?.length ?? 0) > 0;
    // Campos y API comparten la misma dimensión cuenca/ambiente que Cuenca.
    // "Producción por operador" arma su propia jerarquía en el backend
    // (Grupo Pemex/Privadas → Empresa) y siempre entrega groupBy=null (ver
    // TopBar.jsx) — la serie de cabecera (chips/gráfica) viene ya resuelta
    // en resultado.series en vez de derivarse de "groups" como Campos/API.
    const esProdHier = esProdCuenca || esOperadores || tema?.json_arg === "Campos" || tema?.json_arg === "API";
    // Campo/Asignación filtrados por Ambiente/Cuenca activan el drill-down de
    // 4 niveles (Ambiente→Cuenca→Producto→hoja) — ahí buildProdCuencaSeries
    // leería la HOJA (campo/asignación) como si fuera la serie, en vez del
    // producto. Las chips/gráfica siempre son productos: se usa
    // resultado.series (ya viene un item por producto desde el backend),
    // igual que Operadores/Estado.
    const esDrilldownForzado = esProductoNivelForzado && hayFiltroCuencaUbic;
    // Contratos: sus subtotales son los CONTRATOS (jerarquía Contrato →
    // componente), así que derivar las chips de los subtotales las convertía en
    // una lista de contratos. Las chips deben seguir siendo los productos, que
    // es lo que trae resultado.series.
    // Gcompo por el mismo motivo: sus filas hoja son los componentes más la
    // fila de convención "Todos los operadores", que se colaba como chip.
    // Campos entra por el mismo motivo desde que su jerarquía es
    // Campo → componentes: derivar las chips de los subtotales las convertía
    // en una lista de 400 campos.
    const esContratos = tema?.json_arg === "Contratos" || tema?.json_arg === "Gcompo"
      || tema?.json_arg === "Campos";
    const hierSeries = esOperadores || esEstado || esDrilldownForzado || esContratos ? (resultado.series ?? [])
      : esProdCuenca ? buildProdCuencaSeries(resultado)
      : buildHierSeries(resultado, groupBy);
    const cuencaCount = (resultado.groups ?? []).filter(g => g.cuenca !== "Nacional").length;
    // Se conservan los totales "Gas" e "Hidrocarburos líquidos" como CHIPS
    // (el usuario pidió que "Gas" exista en las series). No aplanan la gráfica
    // porque llegan APAGADOS por defecto (ver PROD_CUENCA_DEFAULT_ON en el
    // store): están disponibles para prenderlos, pero no se dibujan solos.
    const chartHierSeries = hierSeries;
    // "Gráfica individual": en Operadores elige una empresa; en "Producción
    // por ubicación" (Cuenca) elige un Ambiente; en "Producción por contrato"
    // elige un contrato — reemplaza al viejo toggle "Por cuenca" (se quitó).
    const esCuencaTopic = tema?.json_arg === "Cuenca";
    const esContratosTopic = tema?.json_arg === "Contratos";
    // Asignaciones: mismo patrón que Contratos, elegir UNA asignación y ver
    // todos sus productos. El backend manda resultado.asignaciones aparte
    // porque la jerarquía del tema se agrupa por cuenca, no por asignación.
    const esAsignacionesTopic = tema?.json_arg === "Asignaciones";
    const esCamposTopic = tema?.json_arg === "Campos";
    // Gcompo elige por CUENCA, no por entidad: es la unidad de analisis del
    // tema, igual que en el SIH.
    const esGcompoTopic = tema?.json_arg === "Gcompo";
    const esApiTopic = tema?.json_arg === "API";
    const puedeVerPersonalizada = (esOperadores && (resultado.empresas?.length ?? 0) > 0)
      || (esCuencaTopic && (prodOpciones?.ubicaciones?.length ?? 0) > 0 && cuencaCount >= 1)
      || (esContratosTopic && (resultado.contratos?.length ?? 0) > 0)
      || (esAsignacionesTopic && (resultado.asignaciones?.length ?? 0) > 0)
      || (esCamposTopic && (resultado.campos?.length ?? 0) > 0)
      || (esEstado && (resultado.entidades?.length ?? 0) > 0)
      || (esGcompoTopic && (resultado.cuencas_gas?.length ?? 0) > 0)
      || (esApiTopic && (resultado.cuencas_api?.length ?? 0) > 0);
    const verPersonalizada = puedeVerPersonalizada && operadorPersonalizada;
    // Estado no tiene filtro de Cuenca/Ambiente (su groupBy="cuenca" es fijo,
    // ver TopBar.jsx) — usar prodFiltros aquí filtraría con lo que haya
    // quedado seleccionado en el tema anterior y activaría por error el
    // drill-down multinivel.
    const filtrosActivos = esEstado
      ? { cuencas: [], categorias: [], ubicaciones: [], operadores: [] }
      : esProdHier
        ? {
            cuencas: prodFiltros.cuencas,
            categorias: (esProductoNivelForzado && hayFiltroCuencaUbic) ? ["_producto"] : [],
            ubicaciones: prodFiltros.ubicaciones,
            operadores: [],
          }
        : perfFiltros;

    // Mismos criterios que las props entityLabel/flatExportEntidad de
    // DynamicTable más abajo — extraídos aquí para reusarlos en el bloque
    // "Tabla de datos" de "Generar reporte" en la vista de gráficas.
    const entityLabelValue =
      tema?.json_arg === "PozosCampos" || tema?.json_arg === "Campos" ? "campos"
        : tema?.json_arg === "API" ? "clases API"
        : tema?.json_arg === "Cuenca" ? "ambientes"
        : tema?.json_arg === "Contratos" ? "contratos"
        : tema?.json_arg === "Asignaciones" ? "asignaciones"
        : tema?.json_arg === "Estado" ? "entidades"
        : tema?.json_arg === "Gcompo" ? "componentes"
        : "operadores";
    const flatExportEntidadValue =
      tema?.json_arg === "PozosCampos" ? "Campo"
        : tema?.json_arg === "PozTerm" || tema?.json_arg === "PozPerf" ? "Operador"
        : undefined;

    function buildTablaReporteJerarquico() {
      const pivot = esOperadores
        ? buildOperadorTabla(resultado, "", resultado.categories ?? [])
        : flatExportEntidadValue
        ? buildFlatExport(resultado, filtrosActivos, visibleSeries, "", resultado.categories ?? [], flatExportEntidadValue, "Cant. pozos")
        : buildPivotExport(resultado, filtrosActivos, visibleSeries, "", resultado.categories ?? [], entityLabelValue);
      return {
        columnas: [...pivot.columnasIdentidad, ...pivot.columnasValor],
        filas: pivot.filas.map(f => [
          ...f.identidad,
          ...f.valores.map(v => (v == null ? "" : v === 0 ? "—" : fmt2(v))),
        ]),
      };
    }
    function buildFiltrosLineasJerarquico() {
      const lineas = [];
      lineas.push(filtrosActivos?.cuencas?.length ? `Cuenca Geológica: ${filtrosActivos.cuencas.join(", ")}` : "Cuenca Geológica: Todas");
      lineas.push(filtrosActivos?.ubicaciones?.length ? `Ambiente: ${filtrosActivos.ubicaciones.join(", ")}` : "Ambiente: Todos");
      return lineas;
    }

    // Sin gráficos si el rango tiene un solo punto (nada que trazar).
    const unaCategoria  = (resultado.categories?.length ?? 0) <= 1;
    const hideGraphics  = unaCategoria;
    // Solo se desvía a "tablas" la vista de GRÁFICOS, que es la que no tiene
    // nada que dibujar. Antes se forzaba cualquier vista, así que con un único
    // año seleccionado el "Ranking" de Asignaciones era inalcanzable: el botón
    // se mostraba pero la vista nunca cambiaba.
    const vistaEfectiva = hideGraphics && viewMode === "graficos" ? "tablas" : viewMode;

    // Subtítulo: cuenca(s)/ambiente(s) representados. Si la selección cubre
    // todo el universo de opciones se resume como "Nacional". Cuencas en
    // verde, ambientes en naranja.
    let chartSubtitle;
    if (esProdHier) {
      // Operadores solo tiene 2 grupos posibles (Pemex/Privadas), a diferencia
      // de las listas abiertas de cuenca/ambiente.
      const cuencaTotal = esOperadores ? 2 : (prodOpciones?.cuencas?.length ?? 0);
      const ambienteTotal = esOperadores ? 0 : (prodOpciones?.ubicaciones?.length ?? 0);
      const cuencasSel = (cuencaTotal > 0 && prodFiltros.cuencas.length >= cuencaTotal) ? [] : prodFiltros.cuencas;
      const ambientesSel = (ambienteTotal > 0 && prodFiltros.ubicaciones.length >= ambienteTotal) ? [] : prodFiltros.ubicaciones;
      chartSubtitle = (cuencasSel.length === 0 && ambientesSel.length === 0)
        ? "Nacional"
        : (
          <>
            {cuencasSel.map((c, i) => (
              <span key={`c-${c}`} style={{ color: "#059669" }}>
                {c}{(i < cuencasSel.length - 1 || ambientesSel.length > 0) ? ", " : ""}
              </span>
            ))}
            {ambientesSel.map((a, i) => (
              <span key={`a-${a}`} style={{ color: "#d97706" }}>
                {a}{i < ambientesSel.length - 1 ? ", " : ""}
              </span>
            ))}
          </>
        );
    }

    return (
      <>
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
        <KpiCards
          kpis={resultado.kpis && { ...resultado.kpis, periodo_dato: resultado.kpis.periodo_dato ?? resultado.categories?.[resultado.categories.length - 1] }}
          topic={tema?.json_arg}
        />
        {(groupBy || esProdCuenca || esOperadores) && chartHierSeries.length > 0 && vistaEfectiva !== "ranking" && (
          <SeriesChips
            items={chartHierSeries}
            visibleSeries={visibleSeries}
            toggleSerie={toggleSerie}
            setAllVisible={setAllVisible}
          />
        )}
        <ViewBarPortal>
          <ViewBar
            viewMode={vistaEfectiva} setViewMode={setViewMode}
            chartType={chartType} setChartType={setChartType}
            hideGraphics={hideGraphics}
            chartTypes={esOperadores ? CHART_TYPES.filter(t => t.id !== "pie" && t.id !== "heatmap") : CHART_TYPES}
            onGenerarReporte={() => setReportModalOpen(true)}
            extraModos={tema?.json_arg === "Asignaciones" ? [{ id: "ranking", label: "Ranking" }] : []}
            extra={puedeVerPersonalizada ? (
              <button
                onClick={() => setOperadorPersonalizada(v => !v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                  operadorPersonalizada ? "bg-tih-dark text-white border-tih-dark" : "bg-white text-slate-600 border-slate-200 hover:border-teal-400"
                }`}>
                Gráfica individual
              </button>
            ) : null}
          />
        </ViewBarPortal>
        <div ref={contentRef} style={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: "auto" }}>
          {vistaEfectiva === "ranking"
            ? <AsignacionesRanking period={period} start_year={start_year} end_year={end_year} start_month={start_month} end_month={end_month}
                busqueda={busquedaRanking} onBusquedaChange={setBusquedaRanking} />
            : vistaEfectiva === "tablas"
            ? <DynamicTable resultado={resultado} visibleSeries={visibleSeries}
                // API sin filtros: la tabla se queda en Nacional porque el
                // camino plano solo dibuja ese grupo. Su jerarquía es
                // Cuenca→Ambiente→clase, así que se pide explícitamente la
                // división por cuenca (con filtros entra el multinivel, que ya
                // la hace por su cuenta).
                groupBy={tema?.json_arg === "API" && !hayFiltroCuencaUbic ? "cuenca" : groupBy}
                titulo={tituloTema} period={period} start_year={start_year} end_year={end_year}
                compareMode={compareMode}
                // Campos/API usan groupBy (una dimensión a la vez), no el multinivel
                // AND de Cuenca: sus filas no tienen marca "subtotal" por categoría.
                // API también: su jerarquía es Cuenca→Ambiente→clase, y sin
                // pasar filtros la tabla se quedaba solo en Nacional aunque
                // se prendieran las cuencas en el cajón de filtros.
                filtros={esProdCuenca || tema?.json_arg === "API" ? filtrosActivos : undefined}
                // Operadores también mezcla unidades (Mbd/MMpcd) en su vista
                // Nacional por producto — forceDivisions oculta el total que
                // las sumaría sin sentido, igual que en "Producción por ubicación".
                forceDivisions={esProdCuenca || esOperadores}
                ocultarSuma={tema?.json_arg === "PozosCampos"}
                entityLabel={entityLabelValue}
                temaJsonArg={tema?.json_arg}
                search={busquedaTabla}
                onSearchChange={setBusquedaTabla}
                searchPlaceholder={
                  tema?.json_arg === "PozosCampos" || tema?.json_arg === "Campos" ? "Buscar Campo"
                    : tema?.json_arg === "API" ? "Buscar Clase API"
                    : tema?.json_arg === "Cuenca" ? "Buscar Cuenca"
                    : tema?.json_arg === "Contratos" ? "Buscar Contrato"
                    : tema?.json_arg === "Asignaciones" ? "Buscar Asignación"
                    : tema?.json_arg === "Estado" ? "Buscar Entidad Federativa"
                    : tema?.json_arg === "Gcompo" ? "Buscar Componente"
                    : tema?.json_arg === "PozTerm" || tema?.json_arg === "PozPerf" ? "Buscar Operador"
                    : undefined
                }
                // "Actividad Petrolera" (Perforación): exportar en formato plano
                // (una fila por Ambiente+Campo/Operador, sin pivotear la entidad a
                // columnas) — antes salía "al revés", una columna por cada campo/
                // operador. Ver buildFlatExport en DynamicTable.jsx.
                flatExportEntidad={flatExportEntidadValue}
                // "Producción por operador": Empresa → Contrato → Producto en
                // vez de Empresa → Producto → Contrato — buildPivotExport
                // genérico no lo interpreta bien (ver buildOperadorTabla).
                exportOperadorTabla={esOperadores}
                historicoTopic={
                  tema?.json_arg === "PozosCampos" || tema?.json_arg === "PozTerm" || tema?.json_arg === "PozPerf"
                    || tema?.json_arg === "Cuenca" || tema?.json_arg === "Campos"
                    ? tema.json_arg
                    : undefined
                }
                // "Descargar todo" de Producción (Cuenca/Campos, misma fuente
                // PRODUCCION_CAMPOS) usa su propio endpoint histórico — el de
                // Perforación es el default de DynamicTable.
                historicoFetch={
                  tema?.json_arg === "Cuenca" || tema?.json_arg === "Campos"
                    ? "fetchProduccionHistorico"
                    : undefined
                }
                rowHeaderLabel={
                  esOperadores && prodFiltros.cuencas.length === 1
                    ? (prodFiltros.cuencas[0] === "Privadas" ? "Privados"
                        // Sin texto para Pemex (pedido explícito) — un espacio
                        // (no una cadena vacía) para que siga contando como
                        // "hay rowHeaderLabel" y conserve el fondo oscuro y el
                        // botón Expandir/Contraer todo en el header.
                        : prodFiltros.cuencas[0] === "Pemex Exploración y Producción" ? " "
                        : undefined)
                    : undefined
                }
                // Asignaciones y Contratos NO van aquí: desde que su jerarquía
                // es Contrato → componentes, las filas hoja son productos
                // (Petróleo, Gas…) y el clic abría la ficha de un producto.
                // Su ficha se abre con clic derecho sobre el contrato, ver
                // onRowFicha más abajo.
                onRowClick={
                  tema?.json_arg === "PozosCampos" ? (code) => abrirCampo(code)
                    // En Perforación las filas hoja también son operadores: el
                    // número abre el desglose de pozos (onCellClick, que hace
                    // stopPropagation) y el nombre abre la ficha del operador.
                    : tema?.json_arg === "Operadores" || tema?.json_arg === "PozPerf" || tema?.json_arg === "PozTerm"
                      ? (code) => abrirOperador(code)
                    : undefined
                }
                // Solo cuando el subtotal ES la entidad. En Contratos siempre lo
                // es (Contrato → componentes), pero en Asignaciones eso ocurre
                // únicamente con filtro de cuenca/ambiente: sin filtros la tabla
                // vuelve a Producto → Cuenca y el subtotal es un producto, así
                // que habilitarlo ahí abriría la ficha de "Petróleo (Mbd)".
                onRowFicha={
                  // Campos: desde que la jerarquía es Campo → componentes, las
                  // filas hoja son productos y el clic izquierdo abría la ficha
                  // de un producto. La ficha del campo va con clic derecho
                  // sobre su fila, igual que contratos y asignaciones.
                  tema?.json_arg === "Campos" ? (code) => abrirCampo(code)
                    : tema?.json_arg === "Contratos"
                    || (tema?.json_arg === "Asignaciones" && hayFiltroCuencaUbic)
                    ? (code) => abrirAsignacion(code)
                    : undefined
                }
                onCellClick={
                  (tema?.json_arg === "PozPerf" || tema?.json_arg === "PozTerm")
                    ? (row, periodoCol, valor) => setPerfPozosSeleccion({
                        topic: tema.json_arg, periodo: periodoCol, operador: row.label, valor,
                        ...celdaAFiltroPerforacion(row, groupBy),
                      })
                    : tema?.json_arg === "PozosCampos"
                    ? (row, periodoCol, valor) => setPozosCampoSeleccion({ campo: row.label, periodo: periodoCol, valor })
                    : undefined
                }
                // Los umbrales de la clasificación no se deducen de la tabla y
                // sin ellos las clases no significan nada — el SIH los trae al
                // pie por la misma razón.
                notaPie={
                  tema?.json_arg === "API"
                    ? "Hidrocarburos líquidos (Mbd) = petróleo + condensado. Clasificación por grados API (DOF 16/02/2015): Súper-ligero 39 < API · Ligero 31.1 < API ≤ 39 · Mediano 22.3 < API ≤ 31.1 · Pesado 10 < API ≤ 22.3 · Extra-pesado API < 10."
                    : tema?.json_arg === "Gcompo"
                    ? "Cifras en millones de pies cúbicos diarios (MMpcd). Los componentes suman aproximadamente el gas total; la diferencia proviene del redondeo de cada componente en la fuente."
                    : undefined
                }
              />
            : chartType === "heatmap"
              ? (
                <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm mb-4">
                  <div className="flex items-baseline justify-end mb-3">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      {CHART_TYPE_LABEL.heatmap}
                    </span>
                  </div>
                  <HeatmapChart items={chartHierSeries} categories={resultado.categories ?? []} height={420} visibleSeries={visibleSeries} />
                </div>
              )
              : esOperadores
                ? (
                  verPersonalizada
                    ? <OperadorCustomChart empresas={resultado.empresas ?? []} categories={resultado.categories ?? []} chartType={chartType} tituloTema={tituloTema} visibleSeries={visibleSeries} seleccionInicial={individualSel} />
                    : (() => {
                        // Vista por defecto: 2 gráficos totales por unidad (Mbd/MMpcd),
                        // ya reflejan el filtro Pemex/Privadas/empresas aplicado en TopBar
                        // (el backend devuelve resultado.series ya acotado a esa selección).
                        // Reemplaza la rejilla anterior de un gráfico por contrato, que
                        // salía vacía: los subtotales de contrato no traen data.
                        return (
                          <GraficasPorUnidad
                            series={filterSeries(chartHierSeries, visibleSeries)}
                            categories={resultado.categories ?? []}
                            titulo={tituloTema} chartType={chartType} zoomable
                          />
                        );
                      })()
                )
              : esCuencaTopic && verPersonalizada
                ? <CuencaCustomChart ubicaciones={prodOpciones?.ubicaciones ?? []} resultado={resultado} categories={resultado.categories ?? []} chartType={chartType} tituloTema={tituloTema} />
                : (esContratosTopic || esAsignacionesTopic || esCamposTopic || esEstado || esGcompoTopic || esApiTopic) && verPersonalizada
                  ? <ContratoCustomChart
                      contratos={(esAsignacionesTopic ? resultado.asignaciones
                                  : esCamposTopic ? resultado.campos
                                  : esEstado ? resultado.entidades
                                  : esGcompoTopic ? resultado.cuencas_gas
                                  : esApiTopic ? resultado.cuencas_api
                                  : resultado.contratos) ?? []}
                      categories={resultado.categories ?? []} chartType={chartType} tituloTema={tituloTema}
                      seleccionInicial={individualSel} />
                  : esProdCuenca
                  ? (() => {
                      // "Por producto": un panel por unidad (Mbd, MMpcd) más el
                      // de agua, que va aparte por no ser hidrocarburo.
                      return (
                        <GraficasPorUnidad
                          series={filterSeries(chartHierSeries, visibleSeries)}
                          categories={resultado.categories ?? []}
                          titulo={tituloTema} chartType={chartType}
                        />
                      );
                    })()
                  : <SingleChart title={tituloTema} categories={resultado.categories ?? []} series={filterSeries(chartHierSeries, visibleSeries)} chartType={chartType}
                      subtitle={chartSubtitle} />
          }
        </div>
      </div>
      {perfPozosSeleccion && (
        <PerforacionPozosDetallePanel
          topic={perfPozosSeleccion.topic}
          periodo={perfPozosSeleccion.periodo}
          cuenca={perfPozosSeleccion.cuenca}
          ubicacion={perfPozosSeleccion.ubicacion}
          operador={perfPozosSeleccion.operador}
          categoriaPozo={perfPozosSeleccion.categoriaPozo}
          cifraEsperada={perfPozosSeleccion.valor}
          onClose={() => setPerfPozosSeleccion(null)}
        />
      )}
      {pozosCampoSeleccion && (
        <PozosCampoDetallePanel
          campo={pozosCampoSeleccion.campo}
          periodo={pozosCampoSeleccion.periodo}
          onClose={() => setPozosCampoSeleccion(null)}
        />
      )}
      {reportModalOpen && (
        <ReportBuilderModal
          graficaDisponible={vistaEfectiva === "graficos"}
          onClose={() => setReportModalOpen(false)}
          onGenerar={(seleccion) => generarReporteDesdeBloques(seleccion, {
            tabla: buildTablaReporteJerarquico(),
            filtrosLineas: buildFiltrosLineasJerarquico(),
            tituloReporte: tituloTema,
            periodoNota: `${PERIOD_LABEL[period] ?? period} — ${start_year} — ${end_year}`,
            contentRef,
          })}
        />
      )}
      </>
    );
  }

  // ── Múltiples tabs (Reservas: aceite + gas) ───────────────────────────────
  if (resultado.tabs) {
    const allTabSeries = [...new Map(resultado.tabs.flatMap(t => t.series).map(s => [s.name, s])).values()];

    function buildTablaReporteTabs() {
      // Una sola tabla: columna "Serie" + periodo, apilando los tabs (aceite/gas).
      const columnas = ["Tab", "Serie", "Periodo", "Valor"];
      const filas = [];
      resultado.tabs.forEach(tab => {
        filterSeries(tab.series, visibleSeries).forEach(s => {
          tab.categories.forEach((cat, i) => {
            const v = s.data[i];
            filas.push([tab.label, s.name, cat, v == null ? "" : fmt2(v)]);
          });
        });
      });
      return { columnas, filas };
    }

    return (
      <div>
        <SeriesChips
          items={allTabSeries}
          visibleSeries={visibleSeries}
          toggleSerie={toggleSerie}
          setAllVisible={setAllVisible}
        />
        <ViewBarPortal>
          <ViewBar viewMode={viewMode} setViewMode={setViewMode} chartType={chartType} setChartType={setChartType}
            onGenerarReporte={() => setReportModalOpen(true)} />
        </ViewBarPortal>
        <div ref={contentRef}>
          {resultado.tabs.map(tab => {
            const series = filterSeries(tab.series, visibleSeries);
            return viewMode === "tablas"
              ? <DataTable key={tab.label} title={tab.label} categories={tab.categories} series={series}
                  periodoNota={`${PERIOD_LABEL[period] ?? period} · ${start_year} – ${end_year}`} />
              : <SingleChart key={tab.label} title={tab.label} categories={tab.categories} series={series} chartType={chartType} />;
          })}
        </div>
        {reportModalOpen && (
          <ReportBuilderModal
            graficaDisponible={viewMode === "graficos"}
            onClose={() => setReportModalOpen(false)}
            onGenerar={(seleccion) => generarReporteDesdeBloques(seleccion, {
              tabla: buildTablaReporteTabs(),
              filtrosLineas: [],
              tituloReporte: tituloTema,
              periodoNota: `${PERIOD_LABEL[period] ?? period} — ${start_year} — ${end_year}`,
              contentRef,
            })}
          />
        )}
      </div>
    );
  }

  // ── Simple ────────────────────────────────────────────────────────────────
  const allSimpleSeries = resultado.series ?? [];
  const series = filterSeries(allSimpleSeries, visibleSeries);
  const simpleKpis = buildSimpleKpis(resultado.categories ?? [], allSimpleSeries);
  const simpleHideGraphics = (resultado.categories?.length ?? 0) <= 1;

  function buildTablaReporteSimple() {
    const columnas = ["Periodo", ...series.map(s => s.name)];
    const filas = (resultado.categories ?? []).map((cat, i) => [
      cat, ...series.map(s => (s.data[i] != null ? fmt2(s.data[i]) : "—")),
    ]);
    return { columnas, filas };
  }

  return (
    <div>
      {tema?.json_arg === "Precios"
        ? <PreciosStatCards series={allSimpleSeries} extremos={resultado.extremos} categories={resultado.categories} />
        : simpleKpis && <KpiCards kpis={simpleKpis} topic={tema?.json_arg} />}
      <SeriesChips
        items={allSimpleSeries}
        visibleSeries={visibleSeries}
        toggleSerie={toggleSerie}
        setAllVisible={setAllVisible}
      />
      <ViewBarPortal>
        <ViewBar viewMode={viewMode} setViewMode={setViewMode} chartType={chartType} setChartType={setChartType} hideGraphics={simpleHideGraphics}
          hideChartTypes={tema?.json_arg === "Precios"}
          onGenerarReporte={() => setReportModalOpen(true)} />
      </ViewBarPortal>
      <div ref={contentRef}>
        {(simpleHideGraphics ? "tablas" : viewMode) === "tablas"
          ? <DataTable title={tema?.json_arg === "Precios" ? "" : tituloTema} categories={resultado.categories ?? []} series={series}
              periodoNota={`${PERIOD_LABEL[period] ?? period} · ${start_year} – ${end_year}`} />
          : tema?.json_arg === "Precios"
            ? <PreciosDashboard categories={resultado.categories ?? []} series={series} />
            : <SingleChart title={tituloTema} categories={resultado.categories ?? []} series={series} chartType={chartType} />
        }
      </div>
      {reportModalOpen && (
        <ReportBuilderModal
          graficaDisponible={(simpleHideGraphics ? "tablas" : viewMode) === "graficos"}
          onClose={() => setReportModalOpen(false)}
          onGenerar={(seleccion) => generarReporteDesdeBloques(seleccion, {
            tabla: buildTablaReporteSimple(),
            filtrosLineas: [],
            tituloReporte: tema?.json_arg === "Precios" ? "" : tituloTema,
            periodoNota: `${PERIOD_LABEL[period] ?? period} — ${start_year} — ${end_year}`,
            contentRef,
          })}
        />
      )}
    </div>
  );
}
