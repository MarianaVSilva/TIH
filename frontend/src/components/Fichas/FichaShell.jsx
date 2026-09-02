import { useFicha } from "./FichaContext";

const INK = "#1f2430";
const MUTED = "#767b87";

// Etiqueta corta del tipo, para el subtítulo del encabezado.
const TIPO_LABEL = {
  campo: "Campo",
  asignacion: "Asignación / Contrato",
  pozo: "Pozo",
  operador: "Operador",
};

// Armazón común de todas las fichas: overlay, tarjeta, encabezado verde,
// migas de pan de la pila y botón de cerrar. Antes este marcado estaba
// duplicado en cada panel de detalle.
export default function FichaShell({ titulo, subtitulo, tipo, children }) {
  const { stack, volver, irAIndice, cerrarFichas } = useFicha();
  const puedeVolver = stack.length > 1;

  return (
    <>
      <div role="presentation" onClick={cerrarFichas} className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[1200]" />
      <div className="fixed inset-0 z-[1201] flex items-center justify-center p-4 pointer-events-none">
        <div
          role="dialog" aria-modal="true"
          onClick={e => e.stopPropagation()}
          className="pointer-events-auto w-full sm:w-[560px] max-h-[88vh] bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.35)] flex flex-col overflow-hidden animate-[fadeIn_0.15s_ease-out]"
        >
          <div className="px-6 py-5 shrink-0 relative" style={{ background: "linear-gradient(90deg,#10312B,#1a4a3a)" }}>
            {/* Migas de pan: solo aparecen al encadenar fichas. Cada nivel
                previo es clicable para regresar directo a ese punto. */}
            {puedeVolver && (
              <div className="flex items-center gap-1 mb-2 pr-8 flex-wrap">
                <button
                  onClick={volver}
                  className="text-teal-200/90 hover:text-white text-[11px] font-semibold mr-1 shrink-0 transition-colors"
                  title="Regresar"
                >
                  ← Atrás
                </button>
                {stack.slice(0, -1).map((e, i) => (
                  <span key={`${e.tipo}-${e.id}-${i}`} className="flex items-center gap-1 min-w-0">
                    <span className="text-teal-200/40 text-[11px]">/</span>
                    <button
                      onClick={() => irAIndice(i)}
                      className="text-teal-200/70 hover:text-white text-[11px] truncate max-w-[130px] transition-colors"
                      title={e.label}
                    >
                      {e.label}
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="min-w-0 pr-8">
              <p className="text-white text-[16px] font-bold truncate">{titulo}</p>
              <p className="text-teal-200/80 text-[11px] mt-0.5 truncate">{subtitulo ?? TIPO_LABEL[tipo] ?? ""}</p>
            </div>
            <button
              onClick={cerrarFichas}
              aria-label="Cerrar"
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors text-lg leading-none shrink-0"
            >
              ×
            </button>
          </div>

          <div className="p-6 flex flex-col gap-5 flex-1 overflow-y-auto rounded-b-2xl">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

// Par etiqueta/valor, reusado por todas las fichas.
export function Dato({ label, valor }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
      <p className="text-[13.5px] font-medium break-words" style={{ color: INK }}>{valor ?? "—"}</p>
    </div>
  );
}

// Título de sección dentro de una ficha.
export function SeccionTitulo({ children, nota }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: MUTED }}>
      {children}
      {nota && <span className="normal-case font-normal"> — {nota}</span>}
    </p>
  );
}

// Enlace a otra ficha (empuja en la pila). Mismo look que los enlaces
// subrayados que ya usaban los paneles.
export function EnlaceFicha({ onClick, children, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="text-[13.5px] font-semibold text-teal-700 underline decoration-teal-300 decoration-2 underline-offset-2 hover:text-teal-800 hover:decoration-teal-500 transition-colors text-left"
    >
      {children}
    </button>
  );
}
