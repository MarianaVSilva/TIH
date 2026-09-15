import { useVolverNav } from "../../hooks/useHistorialNavegador";

// Botón flotante para deshacer los saltos entre temas que dispara una ficha
// ("Ver producción completa… en el Explorador"). Sin él, después de encadenar
// Campo → Asignación → Producción por asignación no hay forma de volver a lo
// que se estaba viendo salvo reconstruirlo a mano en el selector.
//
// Solo aparece si hay algo a donde volver: la pila la llena useExplorerNav.
export default function BotonVolver() {
  // El mismo "volver" que usa el botón Atrás del navegador, ver el hook.
  const { navHistory, volverNav } = useVolverNav();

  if (!navHistory.length) return null;
  const destino = navHistory[navHistory.length - 1];
  const etiqueta = destino.tema?.titulo || destino.tema?.tema || destino.seccion || "atrás";

  return (
    <button
      onClick={volverNav}
      title={`Volver a ${etiqueta}`}
      className="fixed bottom-6 left-6 z-[1100] flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-[0_6px_20px_rgba(0,0,0,0.28)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-all hover:-translate-y-0.5"
      style={{ background: "linear-gradient(90deg,#10312B,#1a4a3a)" }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      </svg>
      <span className="max-w-[220px] truncate">Volver a {etiqueta}</span>
    </button>
  );
}
