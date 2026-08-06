import { useEffect, useState } from "react";
import ReactECharts from "echarts-for-react";
import { fetchAsignacionDetalle } from "../../api/client";
import LoadingSpinner from "../UI/LoadingSpinner";
import { useExplorer } from "../../store/useExplorer";

const INK = "#1f2430";
const MUTED = "#767b87";
const BORDER = "#e7e5e0";
const SERIE_COLORS = ["#0d9488", "#d97706", "#059669", "#1d6fa5", "#7c3aed", "#dc2626", "#0891b2", "#65a30d"];

function Dato({ label, valor }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
      <p className="text-[13.5px] font-medium" style={{ color: INK }}>{valor ?? "—"}</p>
    </div>
  );
}

function fechaLegible(iso) {
  if (!iso) return null;
  const [anio, mes, dia] = iso.split("-");
  const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  return mes ? `${parseInt(dia, 10)} de ${MESES[parseInt(mes, 10) - 1]} ${anio}` : iso;
}

export default function AsignacionDetallePanel({ asignacion, period, start_year, end_year, start_month, end_month, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [mostrarPozos, setMostrarPozos] = useState(false);
  const [vistaProduccion, setVistaProduccion] = useState("tabla");
  const { temas, setSeccion, setTema, setPendingPozoSelection, setPendingBusqueda } = useExplorer();

  useEffect(() => { setMostrarPozos(false); }, [asignacion]);

  function irAPozo(pozo, campo) {
    const temaPozos = temas.find(t => t.json_arg === "Pozos");
    if (!temaPozos) return;
    setSeccion(temaPozos.seccion);
    setTema(temaPozos);
    setPendingPozoSelection({ campo, pozo });
    onClose();
  }

  function irACampo(campo) {
    const temaCampos = temas.find(t => t.json_arg === "Campos");
    if (!temaCampos) return;
    setSeccion(temaCampos.seccion);
    setTema(temaCampos);
    setPendingBusqueda(campo);
    onClose();
  }

  // La gráfica se ve muy amontonada en mensual (demasiados puntos) — se
  // fuerza la vista de tabla y se deshabilita el switch en ese caso.
  useEffect(() => {
    if (period === "monthly" && vistaProduccion === "grafico") setVistaProduccion("tabla");
  }, [period, vistaProduccion]);

  useEffect(() => {
    setData(null);
    setError(null);
    fetchAsignacionDetalle({ asignacion, period, start_year, end_year, start_month, end_month })
      .then(setData)
      .catch(e => setError(e?.response?.data?.detail ?? e.message));
  }, [asignacion, period, start_year, end_year, start_month, end_month]);

  const option = data?.disponible ? {
    backgroundColor: "#fff",
    tooltip: { trigger: "axis", backgroundColor: "#fff", borderColor: BORDER, textStyle: { color: INK, fontSize: 11 } },
    legend: { type: "plain", bottom: 0, textStyle: { color: MUTED, fontSize: 10 } },
    grid: { top: 24, right: 16, bottom: 40, left: 16, containLabel: true },
    xAxis: { type: "category", data: data.categories, axisLabel: { color: MUTED, fontSize: 10 }, axisLine: { lineStyle: { color: BORDER } } },
    yAxis: { type: "value", axisLabel: { color: MUTED, fontSize: 10 }, splitLine: { show: false } },
    series: data.series.map((s, i) => ({
      name: s.label, type: "line", data: s.data, smooth: true, symbol: "none", lineStyle: { width: 2 },
      color: SERIE_COLORS[i % SERIE_COLORS.length],
    })),
  } : null;

  return (
    <>
      <div role="presentation" onClick={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[1200]" />
      <div className="fixed inset-0 z-[1201] flex items-center justify-center p-4 pointer-events-none">
        <div
          role="dialog" aria-modal="true"
          onClick={e => e.stopPropagation()}
          className="pointer-events-auto w-full sm:w-[520px] max-h-[88vh] bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.35)] flex flex-col overflow-hidden animate-[fadeIn_0.15s_ease-out]"
        >
        <div className="flex items-center justify-between px-6 py-5 shrink-0 relative" style={{ background: "linear-gradient(90deg,#10312B,#1a4a3a)" }}>
          <div className="min-w-0 pr-8">
            <p className="text-white text-[16px] font-bold truncate">{data?.block_name ?? asignacion}</p>
            {data?.block_name && <p className="text-teal-200/80 text-[11px] mt-0.5">{asignacion}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors text-lg leading-none shrink-0"
          >
            ×
          </button>
        </div>

        <div className="p-6 flex flex-col gap-5 flex-1 overflow-y-auto rounded-b-2xl">
          {error && <div className="text-sm text-rose-500">No se pudo cargar el detalle: {error}</div>}
          {!data && !error && (
            <div className="flex items-center justify-center h-40">
              <LoadingSpinner message="Consultando asignación…" />
            </div>
          )}
          {data && !data.disponible && (
            <div className="text-sm text-slate-400">Sin datos de producción para esta asignación en el rango seleccionado.</div>
          )}
          {data?.disponible && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Dato label="Operador" valor={data.operador} />
                <Dato label="Fecha de construcción" valor={fechaLegible(data.fecha_construccion)} />
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Pozos asociados</p>
                  {data.num_pozos > 0 ? (
                    <button
                      onClick={() => setMostrarPozos(v => !v)}
                      className="text-[13.5px] font-semibold text-teal-700 underline decoration-teal-300 decoration-2 underline-offset-2 hover:text-teal-800 hover:decoration-teal-500 transition-colors"
                    >
                      {data.num_pozos}
                    </button>
                  ) : (
                    <p className="text-[13.5px] font-medium" style={{ color: INK }}>—</p>
                  )}
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Campos</p>
                  {data.campos?.length ? (
                    <div className="flex flex-wrap gap-x-1.5 gap-y-0.5">
                      {data.campos.map(c => (
                        <button
                          key={c}
                          onClick={() => irACampo(c)}
                          title="Ver producción por campo"
                          className="text-[13.5px] font-semibold text-teal-700 underline decoration-teal-300 decoration-2 underline-offset-2 hover:text-teal-800 hover:decoration-teal-500 transition-colors"
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[13.5px] font-medium" style={{ color: INK }}>—</p>
                  )}
                </div>
                {data.plan && <Dato label="Plan" valor={data.plan} />}
                {data.activity && <Dato label="Actividad" valor={data.activity} />}
              </div>

              {mostrarPozos && data.pozos_asociados?.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: MUTED }}>
                    Lista de pozos <span className="normal-case font-normal">— clic para ver su producción</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.pozos_asociados.map(p => (
                      <button
                        key={p.pozo}
                        onClick={() => irAPozo(p.pozo, p.campo)}
                        className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 hover:bg-teal-100 hover:text-teal-800 transition-colors"
                      >
                        {p.pozo}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Producción de la asignación</p>
                  <div className="inline-flex items-center p-0.5 rounded-full bg-slate-100 border border-slate-200">
                    {[{ id: "tabla", label: "Tabla" }, { id: "grafico", label: "Gráfico", disabled: period === "monthly" }].map(o => (
                      <button
                        key={o.id}
                        onClick={() => !o.disabled && setVistaProduccion(o.id)}
                        disabled={o.disabled}
                        title={o.disabled ? "No disponible en vista mensual — cambia a periodicidad anual" : undefined}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                          o.disabled ? "text-slate-300 cursor-not-allowed"
                            : vistaProduccion === o.id ? "bg-tih-dark text-white shadow-sm cursor-pointer" : "text-slate-500 hover:text-slate-700 cursor-pointer"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                {vistaProduccion === "tabla" ? (
                  <div className="rounded-xl border border-slate-200 overflow-auto max-h-60">
                    <table className="w-full border-collapse">
                      <thead style={{ position: "sticky", top: 0 }}>
                        <tr style={{ background: "linear-gradient(90deg,#10312B,#1a4a3a)" }}>
                          <th className="text-center px-3 py-2 text-[10.5px] font-bold text-white/90 uppercase tracking-wide whitespace-nowrap">Período</th>
                          {data.series.map(s => (
                            <th key={s.label} className="text-center px-3 py-2 text-[10.5px] font-bold text-white/80 whitespace-nowrap">{s.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.categories.map((cat, i) => (
                          <tr key={cat} className={`hover:bg-teal-50 transition-colors ${i % 2 ? "bg-slate-50/60" : "bg-white"}`}>
                            <td className="px-3 py-1.5 text-[12px] font-semibold text-slate-600 whitespace-nowrap text-center">{cat}</td>
                            {data.series.map(s => (
                              <td key={s.label} className="px-3 py-1.5 text-[12px] text-center tabular-nums text-slate-700">
                                {s.data[i]?.toLocaleString("es-MX") ?? "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : data.categories?.length > 1 ? (
                  option && <ReactECharts option={option} style={{ height: 240 }} notMerge />
                ) : (
                  <div className="flex items-center justify-center h-40 text-[12.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg text-center px-4">
                    Seleccione un rango mayor a un año
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        </div>
      </div>
    </>
  );
}
