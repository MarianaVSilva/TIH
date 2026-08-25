import { useState } from "react";

// Selector de qué tarjetas del Panorama general incluir en el PDF — pedido
// explícito del usuario ("exportar el homepage en una tarjeta [PDF] con los
// cuadros que elija"). Mismo estilo que ReportBuilderModal, pero las
// opciones son las tarjetas reales del dashboard (capturadas como imagen,
// ver handleExportHome en HomeDashboard.jsx) en vez de tabla/gráfica/filtros.
//
// `tarjetas`: {key, id, label, slide?, nivel?}[] — más de una entrada puede
// compartir `id` (misma tarjeta física, ej. el carrusel Campos/Operador o
// las 3 pestañas de Reservas), cada una con el estado (slide/nivel) que
// handleExportHome debe fijar antes de capturarla — por eso la selección se
// trackea por `key`, no por `id`.
export default function HomeExportModal({ tarjetas, onClose, onGenerar }) {
  const [seleccion, setSeleccion] = useState(new Set(tarjetas.map(t => t.key)));
  const [generando, setGenerando] = useState(false);

  function toggle(key) {
    setSeleccion(s => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  async function handleGenerar() {
    setGenerando(true);
    try { await onGenerar(tarjetas.filter(t => seleccion.has(t.key))); onClose(); }
    finally { setGenerando(false); }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center" role="presentation">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-5" style={{ maxHeight: "85vh", overflowY: "auto" }}>
        <div className="flex items-center justify-between mb-1">
          <h3 style={{ fontFamily: "'Patria', Georgia, serif", fontSize: 17, fontWeight: 700, color: "#10312B" }}>
            Exportar Panorama general
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none px-1">✕</button>
        </div>
        <p className="text-[12px] text-slate-500 mb-4">
          Elige qué tarjetas incluir — se genera un PDF con el mismo estilo del sitio, tal como se ven ahora en pantalla.
        </p>

        <div className="flex flex-col gap-1.5 mb-3">
          {tarjetas.map(t => (
            <label key={t.key} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 cursor-pointer hover:bg-slate-50 has-[:checked]:border-teal-200 has-[:checked]:bg-teal-50/60">
              <input type="checkbox" checked={seleccion.has(t.key)} className="accent-teal-600" onChange={() => toggle(t.key)} />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-slate-800">{t.label}</p>
              </div>
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-[13px] text-slate-600 rounded-lg hover:bg-slate-100">
            Cancelar
          </button>
          <button
            onClick={handleGenerar} disabled={generando || seleccion.size === 0}
            className="px-4 py-1.5 text-[13px] font-medium text-white rounded-lg disabled:opacity-50"
            style={{ background: "#10312B" }}
          >
            {generando ? "Generando…" : "Generar PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
