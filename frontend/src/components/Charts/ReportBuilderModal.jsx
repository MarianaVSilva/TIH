import { useState } from "react";

// Bloques del reporte — siempre las mismas 3 opciones en cualquier vista
// (tabla o gráfica), para que el modal no cambie de forma según desde dónde
// se abrió (antes "Gráfica" simplemente no aparecía en la vista de tabla,
// sin explicación, y se veía como si la función no existiera). Cuando algo
// no está disponible en el momento (p. ej. "Gráfica" viendo la tabla, porque
// ahí no hay ninguna gráfica montada que capturar) se muestra atenuado con
// el motivo, en vez de desaparecer.
const TODOS_LOS_BLOQUES = [
  { id: "grafica", label: "Gráfica", descripcion: "La(s) gráfica(s) que se ven ahora mismo en pantalla, como imagen." },
  { id: "tabla", label: "Tabla de datos", descripcion: "La tabla/los datos tal como se ven en pantalla." },
  { id: "filtros", label: "Resumen de filtros", descripcion: "Cuenca, Ambiente, grupo y búsqueda activos al generar el reporte." },
];

export default function ReportBuilderModal({
  onClose, onGenerar,
  graficaDisponible = false,
  graficaMotivo = "Cambia a \"Ver como gráficos\" para poder incluirla.",
}) {
  const disponibles = TODOS_LOS_BLOQUES.filter(b => b.id !== "grafica" || graficaDisponible);
  const noDisponibles = TODOS_LOS_BLOQUES.filter(b => b.id === "grafica" && !graficaDisponible);

  const [seleccion, setSeleccion] = useState(disponibles.map(b => b.id));
  const [generando, setGenerando] = useState(false);

  function toggle(id) {
    setSeleccion(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }
  function mover(id, dir) {
    setSeleccion(s => {
      const i = s.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function handleGenerar() {
    setGenerando(true);
    try { await onGenerar(seleccion); onClose(); }
    finally { setGenerando(false); }
  }

  // Bloques activos primero (en el orden elegido), luego los disponibles pero apagados.
  const activos = seleccion.map(id => disponibles.find(b => b.id === id)).filter(Boolean);
  const inactivos = disponibles.filter(b => !seleccion.includes(b.id));

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center" role="presentation">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-5" style={{ maxHeight: "85vh", overflowY: "auto" }}>
        <div className="flex items-center justify-between mb-1">
          <h3 style={{ fontFamily: "'Patria', Georgia, serif", fontSize: 17, fontWeight: 700, color: "#10312B" }}>
            Generar reporte
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none px-1">✕</button>
        </div>
        <p className="text-[12px] text-slate-500 mb-4">
          Elige qué incluir y en qué orden — se genera un PDF con el mismo estilo del sitio.
        </p>

        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Incluidos (en este orden)</p>
        <div className="flex flex-col gap-1.5 mb-3">
          {activos.length === 0 && (
            <p className="text-[12px] text-slate-400 py-2">Ningún bloque seleccionado.</p>
          )}
          {activos.map((b, i) => (
            <div key={b.id} className="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2">
              <input type="checkbox" checked className="accent-teal-600" onChange={() => toggle(b.id)} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-slate-800">{b.label}</p>
                <p className="text-[11px] text-slate-500">{b.descripcion}</p>
              </div>
              <div className="flex flex-col shrink-0">
                <button
                  onClick={() => mover(b.id, -1)} disabled={i === 0}
                  className="text-slate-400 hover:text-teal-700 disabled:opacity-25 disabled:hover:text-slate-400 leading-none px-1"
                  title="Subir"
                >▲</button>
                <button
                  onClick={() => mover(b.id, 1)} disabled={i === activos.length - 1}
                  className="text-slate-400 hover:text-teal-700 disabled:opacity-25 disabled:hover:text-slate-400 leading-none px-1"
                  title="Bajar"
                >▼</button>
              </div>
            </div>
          ))}
        </div>

        {inactivos.length > 0 && (
          <>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Disponibles</p>
            <div className="flex flex-col gap-1.5 mb-3">
              {inactivos.map(b => (
                <label key={b.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 cursor-pointer hover:bg-slate-50">
                  <input type="checkbox" checked={false} className="accent-teal-600" onChange={() => toggle(b.id)} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-slate-700">{b.label}</p>
                    <p className="text-[11px] text-slate-500">{b.descripcion}</p>
                  </div>
                </label>
              ))}
            </div>
          </>
        )}

        {noDisponibles.length > 0 && (
          <>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">No disponible ahora</p>
            <div className="flex flex-col gap-1.5 mb-4">
              {noDisponibles.map(b => (
                <div key={b.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 opacity-60" title={graficaMotivo}>
                  <input type="checkbox" checked={false} disabled className="accent-slate-400" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-slate-500">{b.label}</p>
                    <p className="text-[11px] text-slate-400">{graficaMotivo}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 mt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-[13px] text-slate-600 rounded-lg hover:bg-slate-100">
            Cancelar
          </button>
          <button
            onClick={handleGenerar} disabled={generando || seleccion.length === 0}
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
