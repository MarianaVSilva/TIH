import { useState } from "react";

const TENDENCIAS = ["CRECIENDO", "ESTABLE", "DECLINANDO", "CRITICO"];
const ESTADOS = ["Productor", "Inactivo", "Cerrado", "Abandono permanente", "Abandono temporal", "En inyección"];

function toggleSet(set, setter, v) {
  const next = new Set(set);
  next.has(v) ? next.delete(v) : next.add(v);
  setter(next);
}

// Filtro nacional (viable gracias al caché local indexado): rango de
// producción, tendencia, estado operativo real. Al aplicar, reemplaza el
// árbol por una lista plana de resultados (mismo patrón de selección).
export default function PozosFiltrosPanel({ onAplicar, onLimpiar, activo }) {
  const [open, setOpen] = useState(false);
  const [prodMin, setProdMin] = useState("");
  const [prodMax, setProdMax] = useState("");
  const [tendencias, setTendencias] = useState(new Set());
  const [estados, setEstados] = useState(new Set());

  function aplicar() {
    onAplicar({
      produccion_min: prodMin === "" ? undefined : Number(prodMin),
      produccion_max: prodMax === "" ? undefined : Number(prodMax),
      tendencias: [...tendencias].join("|"),
      estados: [...estados].join("|"),
    });
  }

  function limpiar() {
    setProdMin(""); setProdMax(""); setTendencias(new Set()); setEstados(new Set());
    onLimpiar();
  }

  return (
    <div className="border-b border-slate-100">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left px-3 py-2 text-[11.5px] font-semibold text-slate-500 hover:bg-slate-50 flex items-center justify-between"
      >
        <span>Filtros {activo && <span className="text-teal-600">(activo)</span>}</span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex gap-2">
            <input
              type="number" placeholder="Mín Mbd" value={prodMin}
              onChange={e => setProdMin(e.target.value)}
              className="w-1/2 px-2 py-1 text-[11px] text-slate-700 placeholder:text-slate-400 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
            <input
              type="number" placeholder="Máx Mbd" value={prodMax}
              onChange={e => setProdMax(e.target.value)}
              className="w-1/2 px-2 py-1 text-[11px] text-slate-700 placeholder:text-slate-400 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {TENDENCIAS.map(t => (
              <button key={t} onClick={() => toggleSet(tendencias, setTendencias, t)}
                className={`px-2 py-0.5 rounded-full text-[10px] border ${
                  tendencias.has(t) ? "bg-tih-dark text-white border-tih-dark" : "border-slate-200 text-slate-500"
                }`}>
                {t}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {ESTADOS.map(e => (
              <button key={e} onClick={() => toggleSet(estados, setEstados, e)}
                className={`px-2 py-0.5 rounded-full text-[10px] border ${
                  estados.has(e) ? "bg-teal-600 text-white border-teal-600" : "border-slate-200 text-slate-500"
                }`}>
                {e}
              </button>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={aplicar} className="flex-1 bg-tih-dark text-white text-[11px] font-semibold py-1.5 rounded">Aplicar</button>
            <button onClick={limpiar} className="px-3 text-[11px] text-slate-500 hover:text-slate-700">Limpiar</button>
          </div>
        </div>
      )}
    </div>
  );
}
