import { useEffect, useState } from "react";
import { fetchPozosComprometidosDetalle } from "../../api/client";
import LoadingSpinner from "../UI/LoadingSpinner";

const INK = "#1f2430";
const MUTED = "#767b87";

function Dato({ label, valor }) {
  if (!valor) return null;
  return (
    <div className="min-w-0">
      <p className="text-[9.5px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
      <p className="text-[13px] font-medium truncate" style={{ color: INK }}>{valor}</p>
    </div>
  );
}

function Cifra({ label, valor, destacado }) {
  if (valor == null) return null;
  return (
    <div>
      <p className="text-[9.5px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
      <p className={destacado ? "text-[19px] font-bold" : "text-[15px] font-semibold"} style={{ color: INK }}>
        {valor.toLocaleString("es-MX")}
      </p>
    </div>
  );
}

// Desglose detrás de una celda de "Pozos comprometidos": la cifra de la tabla
// es un CONTEO del plan de desarrollo (no hay lista de pozos detrás), así que
// se muestran por separado el desglose de ese conteo y los pozos que el
// catálogo sí tiene registrados para el contrato. Ver
// contratos_service.get_pozos_comprometidos_detalle.
export default function PozosComprometidosDetallePanel({ contrato, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    setError(null);
    fetchPozosComprometidosDetalle(contrato)
      .then(setData)
      .catch(e => setError(e?.response?.data?.detail ?? e.message));
  }, [contrato]);

  const r = data?.resumen ?? {};

  return (
    <>
      <div role="presentation" onClick={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[1200]" />
      <div className="fixed inset-0 z-[1201] flex items-center justify-center p-4 pointer-events-none">
        <div
          role="dialog" aria-modal="true"
          onClick={e => e.stopPropagation()}
          className="pointer-events-auto w-full sm:w-[480px] max-h-[82vh] bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.35)] flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between px-6 py-5 shrink-0 relative" style={{ background: "linear-gradient(90deg,#10312B,#1a4a3a)" }}>
            <div className="min-w-0 pr-8">
              <p className="text-white text-[16px] font-bold truncate">Pozos comprometidos</p>
              <p className="text-teal-200/80 text-[11px] mt-0.5 truncate">
                {contrato}{r.area ? ` · ${r.area}` : ""}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors text-lg leading-none shrink-0"
            >
              ×
            </button>
          </div>

          <div className="p-6 flex flex-col gap-5 flex-1 overflow-y-auto">
            {error && <div className="text-sm text-rose-500">No se pudo cargar el desglose: {error}</div>}
            {!data && !error && (
              <div className="flex items-center justify-center h-40">
                <LoadingSpinner message="Consultando contrato…" />
              </div>
            )}

            {data && (
              <>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: MUTED }}>
                    Compromiso y avance
                  </p>
                  <div className="grid grid-cols-4 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <Cifra label="Plan" valor={r.planes} destacado />
                    <Cifra label="Terminados" valor={r.terminados} />
                    <Cifra label="Perforando" valor={r.en_perforacion} />
                    <Cifra label="Por perforar" valor={r.por_perforar} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-2 px-3">
                    <Cifra label="Programa mínimo (PMT)" valor={r.pmt} />
                    <Cifra label="Descubrimientos" valor={r.descubrimientos} />
                  </div>
                </div>

                {(r.ronda || r.licitacion) && (
                  <div className="grid grid-cols-2 gap-3 px-3">
                    {r.ronda && <Dato label="Ronda / Modalidad" valor={r.ronda} />}
                    {r.licitacion && <Dato label="Licitación" valor={r.licitacion} />}
                  </div>
                )}

                <p className="text-[11.5px] text-slate-400 leading-relaxed">
                  Cifras del plan de desarrollo del contrato. La fuente registra el número de pozos
                  comprometidos y su avance, no la lista de pozos.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
