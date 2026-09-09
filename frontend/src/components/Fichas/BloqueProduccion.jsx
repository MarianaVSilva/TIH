import { useEffect, useState } from "react";
import ReactECharts from "echarts-for-react";
import { SeccionTitulo } from "./FichaShell";
import { sinCerosIniciales } from "../../utils/seriesUtils";

const INK = "#1f2430";
const MUTED = "#767b87";
const BORDER = "#e7e5e0";
const SERIE_COLORS = ["#0d9488", "#d97706", "#059669", "#1d6fa5", "#7c3aed", "#dc2626", "#0891b2", "#65a30d"];

// Tabla/gráfico de una serie de producción — el mismo bloque que tenían
// duplicado AsignacionDetallePanel y CampoDetallePanel.
export default function BloqueProduccion({ titulo, categories = [], series = [], period }) {
  const [vista, setVista] = useState("tabla");

  // La gráfica se ve muy amontonada en mensual (demasiados puntos) — se
  // fuerza la tabla y se deshabilita el switch en ese caso.
  useEffect(() => {
    if (period === "monthly" && vista === "grafico") setVista("tabla");
  }, [period, vista]);

  if (!series.length) return null;

  const option = {
    backgroundColor: "#fff",
    tooltip: { trigger: "axis", backgroundColor: "#fff", borderColor: BORDER, textStyle: { color: INK, fontSize: 11 } },
    legend: { type: "plain", bottom: 0, textStyle: { color: MUTED, fontSize: 10 } },
    grid: { top: 24, right: 16, bottom: 40, left: 16, containLabel: true },
    xAxis: { type: "category", data: categories, axisLabel: { color: MUTED, fontSize: 10 }, axisLine: { lineStyle: { color: BORDER } } },
    yAxis: { type: "value", axisLabel: { color: MUTED, fontSize: 10 }, splitLine: { show: false } },
    series: series.map((s, i) => ({
      name: s.label, type: "line", data: sinCerosIniciales(s.data), smooth: true, symbol: categories.length <= 1 ? "circle" : "none",
      lineStyle: { width: 2 }, color: SERIE_COLORS[i % SERIE_COLORS.length],
    })),
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{titulo}</p>
        <div className="inline-flex items-center p-0.5 rounded-full bg-slate-100 border border-slate-200">
          {[{ id: "tabla", label: "Tabla" }, { id: "grafico", label: "Gráfico", disabled: period === "monthly" }].map(o => (
            <button
              key={o.id}
              onClick={() => !o.disabled && setVista(o.id)}
              disabled={o.disabled}
              title={o.disabled ? "No disponible en vista mensual — cambia a periodicidad anual" : undefined}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                o.disabled ? "text-slate-300 cursor-not-allowed"
                  : vista === o.id ? "bg-tih-dark text-white shadow-sm cursor-pointer" : "text-slate-500 hover:text-slate-700 cursor-pointer"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {vista === "tabla" ? (
        <div className="rounded-xl border border-slate-200 overflow-auto max-h-60">
          <table className="w-full border-collapse">
            <thead style={{ position: "sticky", top: 0 }}>
              <tr style={{ background: "linear-gradient(90deg,#10312B,#1a4a3a)" }}>
                <th className="text-center px-3 py-2 text-[10.5px] font-bold text-white/90 uppercase tracking-wide whitespace-nowrap">Periodo</th>
                {series.map(s => (
                  <th key={s.label} className="text-center px-3 py-2 text-[10.5px] font-bold text-white/80 whitespace-nowrap">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((cat, i) => (
                <tr key={cat} className={`hover:bg-teal-50 transition-colors ${i % 2 ? "bg-slate-50/60" : "bg-white"}`}>
                  <td className="px-3 py-1.5 text-[12px] font-semibold text-slate-600 whitespace-nowrap text-center">{cat}</td>
                  {series.map(s => (
                    <td key={s.label} className="px-3 py-1.5 text-[12px] text-center tabular-nums text-slate-700">
                      {s.data[i] != null ? fmt(s.data[i]) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : categories.length > 1 ? (
        <ReactECharts option={option} style={{ height: 240 }} notMerge />
      ) : (
        <div className="flex items-center justify-center h-40 text-[12.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg text-center px-4">
          Seleccione un rango mayor a un año
        </div>
      )}
    </div>
  );
}

// Bloque de reservas 1P/2P/3P por año — barras agrupadas, mismos colores que
// la gráfica de reservas del Explorador.
const RESERVAS_COLORS = { p1: "#9CCC65", p2: "#FBC02D", p3: "#FFA726" };

export function BloqueReservas({ reservas }) {
  const [tipo, setTipo] = useState("aceite");
  if (!reservas) return null;

  const disponibles = ["aceite", "gas", "pce"].filter(t => reservas[t]?.p3?.some(v => v > 0));
  if (!disponibles.length) return null;

  const activo = disponibles.includes(tipo) ? tipo : disponibles[0];
  const bloque = reservas[activo];
  const unidad = { aceite: "MMb", gas: "MMMpc", pce: "MMbpce" }[activo];
  const fmt = v => (v ?? 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const option = {
    backgroundColor: "#fff",
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: v => `${fmt(v)} ${unidad}` },
    legend: { data: ["1P", "2P", "3P"], top: 0, left: "center", itemGap: 20, icon: "circle", textStyle: { fontSize: 11, color: "#475569" } },
    grid: { left: 8, right: 12, top: 34, bottom: 24, containLabel: true },
    xAxis: {
      type: "category", data: reservas.categories ?? [],
      axisLabel: { fontSize: 10, fontWeight: 600, color: "#0f766e" },
      axisLine: { lineStyle: { color: BORDER } }, axisTick: { show: false },
    },
    yAxis: {
      type: "value", name: unidad, nameTextStyle: { fontSize: 10, color: "#334155", align: "left" },
      axisLabel: { fontSize: 10, color: MUTED }, splitLine: { lineStyle: { color: "#f1f5f9" } },
    },
    series: [
      { name: "1P", type: "bar", data: bloque.p1, itemStyle: { color: RESERVAS_COLORS.p1 }, barMaxWidth: 14 },
      { name: "2P", type: "bar", data: bloque.p2, itemStyle: { color: RESERVAS_COLORS.p2 }, barMaxWidth: 14 },
      { name: "3P", type: "bar", data: bloque.p3, itemStyle: { color: RESERVAS_COLORS.p3 }, barMaxWidth: 14 },
    ],
  };

  const LABEL = { aceite: "Aceite", gas: "Gas", pce: "PCE" };

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <SeccionTitulo>Reservas del campo</SeccionTitulo>
        {disponibles.length > 1 && (
          <div className="inline-flex items-center p-0.5 rounded-full bg-slate-100 border border-slate-200">
            {disponibles.map(t => (
              <button
                key={t}
                onClick={() => setTipo(t)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                  activo === t ? "bg-tih-dark text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {LABEL[t]}
              </button>
            ))}
          </div>
        )}
      </div>
      <ReactECharts option={option} style={{ height: 210 }} notMerge />
      <p className="text-[10px] mt-1" style={{ color: MUTED }}>
        1P = Probadas · 2P = + Probables · 3P = + Posibles
      </p>
    </div>
  );
}
