import { useEffect, useState } from "react";
import ReactECharts from "echarts-for-react";
import { fetchPozosComparar } from "../../api/client";
import LoadingSpinner from "../UI/LoadingSpinner";

const COLORS = ["#059669", "#d97706", "#4f46e5", "#dc2626"];

// Multi-select de 2-4 pozos (checkboxes en el árbol, ver PozosExplorer):
// serie superpuesta + tabla comparativa lado a lado.
export default function PozosComparar({ seleccionados, onQuitar, period, start_year, end_year, start_month, end_month }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (seleccionados.length < 2) { setData(null); return; }
    setLoading(true);
    const pozosParam = seleccionados.map(s => `${s.campo}::${s.pozo}`).join("|");
    fetchPozosComparar({ pozos: pozosParam, period, start_year, end_year, start_month, end_month }).then(setData).finally(() => setLoading(false));
  }, [seleccionados, period, start_year, end_year, start_month, end_month]);

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
      name: s.name, type: "line", data: s.data, smooth: true, symbol: "none",
      lineStyle: { width: 2, color: COLORS[i % COLORS.length] },
    })),
  };

  return (
    <div className="p-3">
      <ReactECharts option={option} style={{ height: 300 }} notMerge />
      <table className="w-full text-[11.5px] mt-3">
        <thead>
          <tr className="text-slate-400 border-b border-slate-100">
            <th className="text-left py-1 px-1">Pozo</th>
            <th className="text-right py-1 px-1">Actual (Mbd)</th>
            <th className="text-right py-1 px-1">Decl. anual</th>
            <th className="text-center py-1 px-1">Tendencia</th>
            <th className="text-right py-1 px-1">% vs pico</th>
            <th className="text-left py-1 px-1">Estado</th>
            <th className="text-right py-1 px-1">Años</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.tabla.map(row => (
            <tr key={row.pozo} className="border-b border-slate-50">
              <td className="py-1 px-1 font-semibold text-slate-700">{row.pozo}</td>
              <td className="py-1 px-1 text-right tabular-nums">{row.produccion_actual_mbd ?? "—"}</td>
              <td className="py-1 px-1 text-right tabular-nums">{row.tasa_declinacion_anual != null ? `${row.tasa_declinacion_anual}%` : "—"}</td>
              <td className="py-1 px-1 text-center">{row.tendencia}</td>
              <td className="py-1 px-1 text-right tabular-nums">{row.pct_vs_pico != null ? `${row.pct_vs_pico}%` : "—"}</td>
              <td className="py-1 px-1 text-slate-500">{row.estado_operativo ?? "—"}</td>
              <td className="py-1 px-1 text-right tabular-nums">{row.anos_en_produccion ?? "—"}</td>
              <td className="py-1 px-1 text-right">
                <button onClick={() => onQuitar(row.pozo)} className="text-rose-400 hover:text-rose-600 text-[11px]">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
