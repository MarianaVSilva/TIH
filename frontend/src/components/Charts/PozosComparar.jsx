import { useEffect, useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import { fetchPozosComparar } from "../../api/client";
import LoadingSpinner from "../UI/LoadingSpinner";
import { tendenciaLabel } from "../../utils/tendenciaLabel";
import { transponerAPivot } from "./DynamicTable";
import { useExplorerNav } from "../../hooks/useExplorerNav";
import { sinCerosIniciales } from "../../utils/seriesUtils";

const TENDENCIA_COLOR = { CRECIENDO: "#059669", ESTABLE: "#64748b", DECLINANDO: "#d97706", CRITICO: "#dc2626", SIN_PRODUCCION: "#94a3b8" };
// Pozo sin producción actual: la tendencia no tiene sentido, se omite.
const ESTADOS_SIN_TENDENCIA = ["Cerrado", "Inactivo", "Abandono permanente", "Abandono temporal"];

// Paleta por pozo (no por unidad, ver bug de abajo) — un color distinto por
// serie, en el mismo orden en que ECharts las lista en la leyenda, para que
// la línea de cada pozo coincida con el punto de color que la marca en la
// leyenda/tooltip. Antes se pintaba TODA la gráfica de un solo color según
// la unidad (verde=líquidos, azul=gas) — con 2+ pozos de la misma unidad
// (el caso normal al comparar) todas las líneas salían idénticas y solo la
// leyenda (con la paleta default de ECharts) mostraba colores distintos.
const PALETA_POZOS = ["#5470c6", "#91cc75", "#fac858", "#ee6666"];

function colorDe(index) {
  return PALETA_POZOS[index % PALETA_POZOS.length];
}

// Multi-select de 2-4 pozos (checkboxes en el árbol, ver PozosExplorer):
// serie superpuesta + tabla comparativa lado a lado.
export default function PozosComparar({ seleccionados, onQuitar, period, start_year, end_year, start_month, end_month }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hiddenCols, setHiddenCols] = useState(new Set());
  const [showCols, setShowCols] = useState(false);
  const [exportando, setExportando] = useState(false);
  const echartsRef = useRef(null);
  const { irAPozo } = useExplorerNav();

  useEffect(() => {
    if (seleccionados.length < 2) { setData(null); return; }
    setLoading(true);
    const pozosParam = seleccionados.map(s => `${s.campo}::${s.pozo}`).join("|");
    fetchPozosComparar({ pozos: pozosParam, period, start_year, end_year, start_month, end_month }).then(setData).finally(() => setLoading(false));
  }, [seleccionados, period, start_year, end_year, start_month, end_month]);

  // Unidad por pozo: viene en la tabla de análisis (data.tabla), no en la
  // serie del gráfico — se usa para pintar cada pozo de verde (líquidos) o
  // azul (gas) de forma consistente en la gráfica y ambas tablas.
  const unidadPorPozo = useMemo(() => {
    const m = {};
    (data?.tabla ?? []).forEach(t => { m[t.pozo] = t.unidad ?? "Mbd"; });
    return m;
  }, [data]);

  const visCats = (data?.categories ?? []).filter(c => !hiddenCols.has(c));

  async function handleExport() {
    if (!data) return;
    setExportando(true);
    try {
      const { exportarProduccionExcel } = await import("../../utils/exportExcel");
      const chartImageBase64 = echartsRef.current?.getEchartsInstance().getDataURL({ pixelRatio: 2, backgroundColor: "#fff" }) ?? null;
      const filas = data.series.map(s => {
        const idx = Object.fromEntries(data.categories.map((c, i) => [c, s.data[i]]));
        const unidad = unidadPorPozo[s.name] ?? "Mbd";
        const producto = unidad === "MMpcd" ? "Gas" : "Líquidos";
        return { label: `${s.name} · ${producto} (${unidad})`, valores: visCats.map(c => idx[c] ?? 0) };
      });
      await exportarProduccionExcel({
        titulo: "Comparación de pozos",
        subtitulo: data.tabla.map(t => t.pozo).join(" · "),
        periodoNota: `Rango: ${data.categories[0]} – ${data.categories[data.categories.length - 1]}`,
        tablaPivot: transponerAPivot(visCats, filas),
        chartImageBase64,
        chartTitulo: "Producción comparada",
      });
    } finally {
      setExportando(false);
    }
  }

  if (seleccionados.length < 2) {
    return <p className="text-[12px] text-slate-400 text-center py-16">Selecciona entre 2 y 4 pozos (checkbox en el árbol) para comparar.</p>;
  }
  if (loading) {
    return <div className="flex items-center justify-center h-64"><LoadingSpinner message="Comparando pozos…" /></div>;
  }
  if (!data || !data.series?.length) {
    return <p className="text-[12px] text-slate-400 text-center py-16">Sin datos de producción para los pozos seleccionados.</p>;
  }

  const option = {
    backgroundColor: "#fff",
    tooltip: { trigger: "axis" },
    legend: { bottom: 0, textStyle: { fontSize: 10 } },
    grid: { top: 20, right: 20, bottom: 60, left: 50, containLabel: true },
    xAxis: { type: "category", data: data.categories, axisLabel: { fontSize: 9, rotate: 45 } },
    yAxis: { type: "value", axisLabel: { fontSize: 9 } },
    series: data.series.map((s, i) => ({
      name: s.name, type: "line", data: sinCerosIniciales(s.data), smooth: true, symbol: "none",
      lineStyle: { width: 2, color: colorDe(i) },
      itemStyle: { color: colorDe(i) },
    })),
  };

  return (
    <div className="p-3">
      <ReactECharts ref={echartsRef} option={option} style={{ height: 300 }} notMerge />

      {/* Tabla resumen: análisis de tendencia por pozo */}
      <div className="rounded-xl border border-slate-200 overflow-auto mt-4 shadow-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ background: "linear-gradient(90deg,#10312B,#1a4a3a)" }}>
              <th className="text-left px-3 py-2 text-[10.5px] font-bold text-white/90 uppercase tracking-wide whitespace-nowrap">Pozo</th>
              <th className="text-right px-3 py-2 text-[10.5px] font-bold text-white/80 uppercase tracking-wide whitespace-nowrap">Producción actual</th>
              <th className="text-right px-3 py-2 text-[10.5px] font-bold text-white/80 uppercase tracking-wide whitespace-nowrap">Decl. anual</th>
              <th className="text-center px-3 py-2 text-[10.5px] font-bold text-white/80 uppercase tracking-wide whitespace-nowrap">Tendencia</th>
              <th className="text-right px-3 py-2 text-[10.5px] font-bold text-white/80 uppercase tracking-wide whitespace-nowrap">% vs pico</th>
              <th className="text-left px-3 py-2 text-[10.5px] font-bold text-white/80 uppercase tracking-wide whitespace-nowrap">Estado</th>
              <th className="text-right px-3 py-2 text-[10.5px] font-bold text-white/80 uppercase tracking-wide whitespace-nowrap">Años</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data.tabla.map((row, ri) => {
              const color = colorDe(ri);
              return (
                <tr key={row.pozo} className={ri % 2 ? "bg-slate-50/60" : "bg-white"}>
                  <td className="px-3 py-2 text-[12.5px] font-semibold whitespace-nowrap" style={{ borderLeft: `3px solid ${color}`, color: "#334155" }}>
                    <button
                      onClick={() => {
                        const s = seleccionados.find(s => s.pozo === row.pozo);
                        if (s) irAPozo(s.pozo, s.campo);
                      }}
                      title="Ver detalle del pozo"
                      className="inline-flex items-center gap-1.5 hover:underline decoration-teal-400 underline-offset-2"
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                      {row.pozo}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[12.5px] font-medium text-slate-700">
                    {row.produccion_actual_mbd != null ? `${row.produccion_actual_mbd} ${row.unidad ?? "Mbd"}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[12.5px] text-slate-700">
                    {row.tasa_declinacion_anual != null ? `${row.tasa_declinacion_anual}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {row.tendencia && !ESTADOS_SIN_TENDENCIA.includes(row.estado_operativo) ? (
                      <span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold text-white whitespace-nowrap" style={{ background: TENDENCIA_COLOR[row.tendencia] ?? "#94a3b8" }}>
                        {tendenciaLabel(row.tendencia)}
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[12.5px] text-slate-700">
                    {row.pct_vs_pico != null ? `${row.pct_vs_pico}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-[12.5px] text-slate-600 whitespace-nowrap">{row.estado_operativo ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[12.5px] text-slate-700">{row.anos_en_produccion ?? "—"}</td>
                  <td className="px-2 py-2 text-right">
                    <button onClick={() => onQuitar(row.pozo)} className="text-rose-400 hover:text-rose-600 text-[13px]" title="Quitar de la comparación">✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Tabla detalle: producción por período, una columna por año/mes */}
      <div className="flex items-center gap-2 mt-5 mb-2 flex-wrap">
        <span className="text-[12.5px] font-bold text-slate-700 mr-auto">Producción por periodo</span>
        <div className="relative">
          <button
            onClick={() => setShowCols(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-600 border border-slate-200 hover:bg-slate-50"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="1" y="1" width="4" height="14" rx="1"/><rect x="6" y="1" width="4" height="14" rx="1"/><rect x="11" y="1" width="4" height="14" rx="1"/>
            </svg>
            Columnas
          </button>
          {showCols && (
            <div className="absolute top-full mt-1 right-0 bg-white border border-slate-200 rounded-lg shadow-lg p-3 z-50 min-w-[130px] max-h-64 overflow-auto">
              <p className="text-[10px] font-semibold text-slate-400 uppercase mb-2 tracking-wide">Visibles</p>
              {data.categories.map(c => (
                <label key={c} className="flex items-center gap-2 py-0.5 cursor-pointer">
                  <input type="checkbox" checked={!hiddenCols.has(c)} className="accent-teal-600"
                    onChange={() => setHiddenCols(s => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; })} />
                  <span className="text-[12px] text-slate-700">{c}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={handleExport}
          disabled={exportando}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white bg-tih-dark hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {exportando ? "Exportando…" : "Exportar Excel"}
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-auto shadow-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ background: "linear-gradient(90deg,#10312B,#1a4a3a)" }}>
              <th className="text-left px-3 py-2 text-[10.5px] font-bold text-white/90 uppercase tracking-wide sticky left-0" style={{ background: "#10312B" }}>Pozo</th>
              {visCats.map(c => (
                <th key={c} className="text-center px-3 py-2 text-[10.5px] font-bold text-white/80 whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.series.map((s, ri) => {
              const color = colorDe(ri);
              const idx = Object.fromEntries(data.categories.map((c, i) => [c, s.data[i]]));
              const valores = visCats.map(c => idx[c]).filter(v => v);
              const max = Math.max(...valores, 0.0001);
              const min = Math.min(...valores, max);
              return (
                <tr key={s.name} className={ri % 2 ? "bg-slate-50/60" : "bg-white"}>
                  <td
                    className="px-3 py-2 text-[12.5px] font-semibold sticky left-0 whitespace-nowrap"
                    style={{ background: ri % 2 ? "#f8fafc" : "#fff", borderLeft: `3px solid ${color}`, color: "#334155" }}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                      {s.name}
                      <span className="font-normal text-slate-400">
                        · {unidadPorPozo[s.name] === "MMpcd" ? "Gas" : "Líquidos"} ({unidadPorPozo[s.name] ?? "Mbd"})
                      </span>
                    </span>
                  </td>
                  {visCats.map(c => {
                    const v = idx[c] ?? 0;
                    const intensidad = v ? 0.08 + 0.34 * ((v - min) / Math.max(max - min, 0.0001)) : 0;
                    return (
                      <td
                        key={c}
                        className="text-center px-3 py-2 text-[12.5px] font-medium tabular-nums whitespace-nowrap"
                        style={{ background: v ? `${color}${Math.round(intensidad * 255).toString(16).padStart(2, "0")}` : "transparent", color: v ? "#1e293b" : "#cbd5e1" }}
                      >
                        {v === 0 ? "—" : v.toLocaleString("es-MX", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
