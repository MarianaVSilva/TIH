import { useEffect, useState } from "react";
import { fetchContratosAdjudicadosDetalle } from "../../api/client";
import LoadingSpinner from "../UI/LoadingSpinner";
import { useAbrirFicha } from "../Fichas/FichaContext";

const INK = "#1f2430";
const MUTED = "#767b87";

// Empresas participantes de cada contrato adjudicado. La celda de la tabla
// cruza empresa × ronda-licitación y su número son los contratos ganados ahí,
// así que aquí se listan esos contratos con quién participa en cada uno.
export default function ContratosAdjudicadosDetallePanel({ empresa, columna, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const { abrirAsignacion } = useAbrirFicha();

  useEffect(() => {
    setData(null);
    setError(null);
    fetchContratosAdjudicadosDetalle(empresa, columna)
      .then(setData)
      .catch(e => setError(e?.response?.data?.detail ?? e.message));
  }, [empresa, columna]);

  return (
    <>
      <div role="presentation" onClick={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[1200]" />
      <div className="fixed inset-0 z-[1201] flex items-center justify-center p-4 pointer-events-none">
        <div
          role="dialog" aria-modal="true"
          onClick={e => e.stopPropagation()}
          className="pointer-events-auto w-full sm:w-[560px] max-h-[82vh] bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.35)] flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between px-6 py-5 shrink-0 relative" style={{ background: "linear-gradient(90deg,#10312B,#1a4a3a)" }}>
            <div className="min-w-0 pr-8">
              <p className="text-white text-[16px] font-bold truncate">Empresas participantes</p>
              <p className="text-teal-200/80 text-[11px] mt-0.5 truncate">{empresa} · {columna}</p>
            </div>
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors text-lg leading-none shrink-0"
            >
              ×
            </button>
          </div>

          <div className="p-6 flex flex-col gap-6 flex-1 overflow-y-auto">
            {error && <div className="text-sm text-rose-500">No se pudo cargar el desglose: {error}</div>}
            {!data && !error && (
              <div className="flex items-center justify-center h-40">
                <LoadingSpinner message="Consultando contratos…" />
              </div>
            )}
            {data && data.contratos.length === 0 && (
              <div className="text-sm text-slate-400">No se encontraron contratos para esta celda.</div>
            )}

            {data?.contratos.map(c => (
              <div key={c.contrato} className="flex flex-col gap-2">
                <button
                  onClick={() => { onClose(); abrirAsignacion(c.codigo ?? c.contrato); }}
                  title="Ver ficha del contrato"
                  className="text-[13.5px] font-bold text-left text-teal-700 underline decoration-teal-300 decoration-2 underline-offset-2 hover:text-teal-800 w-fit"
                >
                  {c.contrato}
                </button>

                {c.participantes.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {/* Los títulos distinguen los tres papeles, que es justo lo
                        que confunde: quién ganó la licitación, quién es titular
                        del contrato y quién lo opera. */}
                    <p className="text-[9.5px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>
                      Titulares del contrato
                    </p>
                    {c.participantes.map(p => (
                      <div
                        key={p.empresa}
                        className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100"
                      >
                        <span className="text-[13px] font-semibold truncate" style={{ color: INK }}>{p.empresa}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                            style={p.operador
                              ? { background: "#d1fae5", color: "#065f46" }
                              : { background: "#e0e7ff", color: "#3730a3" }}
                          >
                            {p.operador ? "OPERADOR" : "SOCIO"}
                          </span>
                          {p.interes != null && (
                            <span className="text-[12px] font-bold tabular-nums" style={{ color: INK }}>
                              {p.interes}%
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  // Sin producción no hay interés de participación registrado:
                  // PRODUCCION_OPERADOR_IP solo cubre contratos que producen.
                  <p className="text-[11.5px] text-slate-400">
                    Sin interés de participación registrado (el contrato aún no produce).
                  </p>
                )}

                {c.licitantes.length > 0 && (
                  <div>
                    <p className="text-[9.5px] font-bold uppercase tracking-wide mb-1" style={{ color: MUTED }}>
                      Ganador de la licitación
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {c.licitantes.map(l => (
                        <span
                          key={l.empresa}
                          className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600"
                        >
                          {l.empresa}{l.pais ? ` · ${l.pais}` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {data?.contratos.length > 0 && (
              <p className="text-[11px] text-slate-400 leading-relaxed border-t border-slate-100 pt-3">
                La empresa que gana la licitación no siempre es la que firma el contrato: suele operar
                a través de una filial mexicana. En las rondas de Asociaciones (CNH-A…) Pemex conserva
                una participación porque licita un socio para un campo que ya tenía.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
