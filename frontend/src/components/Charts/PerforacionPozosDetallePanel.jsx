import { useEffect, useState } from "react";
import { fetchPerforacionPozosDetalle } from "../../api/client";
import LoadingSpinner from "../UI/LoadingSpinner";
import { useExplorer } from "../../store/useExplorer";

const INK = "#1f2430";
const MUTED = "#767b87";

function fechaLegible(iso) {
  if (!iso) return null;
  const [anio, mes, dia] = iso.split("-");
  const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  return mes ? `${parseInt(dia, 10)} de ${MESES[parseInt(mes, 10) - 1]} ${anio}` : iso;
}

function periodoLegible(periodo) {
  if (!periodo) return "";
  if (periodo.length === 4) return periodo;
  const [anio, mes] = periodo.split("-");
  const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  return `${MESES[parseInt(mes, 10) - 1]} ${anio}`;
}

export default function PerforacionPozosDetallePanel({ topic, periodo, cuenca, ubicacion, operador, categoriaPozo, cifraEsperada, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const { temas, setSeccion, setTema, setPendingPozoSelection } = useExplorer();

  function irAPozo(pozo, campo) {
    const temaPozos = temas.find(t => t.json_arg === "Pozos");
    if (!temaPozos) return;
    setSeccion(temaPozos.seccion);
    setTema(temaPozos);
    // Sin campo (ASIG_CONT): el pozo aún no tiene producción registrada —
    // PozosExplorer lo detecta y muestra "Pozo sin producción" en vez de
    // intentar una consulta que no traería nada.
    setPendingPozoSelection({ campo: campo ?? null, pozo });
    onClose();
  }

  useEffect(() => {
    setData(null);
    setError(null);
    fetchPerforacionPozosDetalle({ topic, periodo, cuenca, ubicacion, operador, categoria_pozo: categoriaPozo })
      .then(setData)
      .catch(e => setError(e?.response?.data?.detail ?? e.message));
  }, [topic, periodo, cuenca, ubicacion, operador, categoriaPozo]);

  const titulo = topic === "PozTerm" ? "Pozos terminados" : "Pozos perforados";
  const contexto = [cuenca, ubicacion, categoriaPozo, operador].filter(Boolean).join(" · ") || "Nacional";
  const noCoincide = data && cifraEsperada != null && data.total !== cifraEsperada;

  return (
    <>
      <div role="presentation" onClick={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[1200]" />
      <div className="fixed inset-0 z-[1201] flex items-center justify-center p-4 pointer-events-none">
        <div
          role="dialog" aria-modal="true"
          onClick={e => e.stopPropagation()}
          className="pointer-events-auto w-full sm:w-[480px] max-h-[80vh] bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.35)] flex flex-col overflow-hidden animate-[fadeIn_0.15s_ease-out]"
        >
          <div className="flex items-center justify-between px-6 py-5 shrink-0 relative" style={{ background: "linear-gradient(90deg,#10312B,#1a4a3a)" }}>
            <div className="min-w-0 pr-8">
              <p className="text-white text-[16px] font-bold truncate">{titulo}</p>
              <p className="text-teal-200/80 text-[11px] mt-0.5 truncate">{contexto} · {periodoLegible(periodo)}</p>
            </div>
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors text-lg leading-none shrink-0"
            >
              ×
            </button>
          </div>

          <div className="p-6 flex flex-col gap-4 flex-1 overflow-y-auto">
            {error && <div className="text-sm text-rose-500">No se pudo cargar el desglose: {error}</div>}
            {!data && !error && (
              <div className="flex items-center justify-center h-40">
                <LoadingSpinner message="Consultando pozos…" />
              </div>
            )}
            {data && data.total === 0 && (
              <div className="text-sm text-slate-400">No se encontraron pozos para este filtro.</div>
            )}
            {data && data.total > 0 && (
              <>
                <p className="text-[13px] text-slate-500">
                  <span className="font-bold text-[16px]" style={{ color: INK }}>{data.total}</span> pozo{data.total === 1 ? "" : "s"}
                </p>
                {noCoincide && (
                  <div className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    La cifra de la tabla era {cifraEsperada} — esta lista puede incluir pozos de otras categorías/cuencas agrupadas en esa celda.
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  {data.pozos.map(p => {
                    const enProduccion = !!p.campo;
                    return (
                      <button
                        key={p.pozo}
                        onClick={() => irAPozo(p.pozo, p.campo)}
                        title="Ver producción de este pozo"
                        className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 w-full text-left transition-colors cursor-pointer hover:bg-teal-100/80 hover:border-teal-200"
                      >
                        <span className="text-[13px] font-semibold truncate text-teal-700 underline decoration-teal-300 decoration-2 underline-offset-2">
                          {p.pozo}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          {!enProduccion && (
                            <span className="text-[9.5px] font-semibold text-slate-400 bg-slate-200/70 px-1.5 py-0.5 rounded-full whitespace-nowrap">Sin producción</span>
                          )}
                          {p.operador && <span className="text-[10.5px] text-slate-400 truncate max-w-[120px]" title={p.operador}>{p.operador}</span>}
                          {p.fecha && <span className="text-[10.5px] text-slate-400 whitespace-nowrap">{fechaLegible(p.fecha)}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
