import { useEffect, useState } from "react";
import { fetchOperadorDetalle } from "../../api/client";
import LoadingSpinner from "../UI/LoadingSpinner";
import { useExplorer } from "../../store/useExplorer";
import { useExplorerNav } from "../../hooks/useExplorerNav";
import { nombreCampoDisplay } from "../../utils/nombreCampo";
import { useAbrirFicha, useFicha } from "./FichaContext";
import FichaShell, { SeccionTitulo } from "./FichaShell";
import BloqueProduccion from "./BloqueProduccion";

const MUTED = "#767b87";

// Lista larga (un operador grande opera cientos de asignaciones/campos) —
// se colapsa detrás del conteo y se abre en un contenedor con scroll, para
// no volver la ficha inmanejable.
function ListaColapsable({ titulo, items, vacio, onItemClick, etiqueta = x => x }) {
  const [abierta, setAbierta] = useState(false);
  if (!items?.length) {
    return (
      <div>
        <SeccionTitulo>{titulo}</SeccionTitulo>
        <p className="text-[13.5px] font-medium" style={{ color: MUTED }}>{vacio}</p>
      </div>
    );
  }
  return (
    <div>
      <button
        onClick={() => setAbierta(v => !v)}
        className="flex items-center gap-1.5 mb-1.5 group"
      >
        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>
          {titulo} <span className="text-teal-700">({items.length})</span>
        </p>
        <span className="text-[10px] text-teal-700 group-hover:text-teal-900 transition-colors">
          {abierta ? "▲ ocultar" : "▼ ver"}
        </span>
      </button>
      {abierta && (
        <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto rounded-lg border border-slate-200 p-2">
          {items.map(it => (
            <button
              key={it.key}
              onClick={() => onItemClick(it)}
              className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 hover:bg-teal-100 hover:text-teal-800 transition-colors"
            >
              {etiqueta(it.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FichaOperador({ operador }) {
  const { period, start_year, end_year, start_month, end_month } = useExplorer();
  const { cerrarFichas } = useFicha();
  const { abrirCampo, abrirAsignacion } = useAbrirFicha();
  const { irAOperador } = useExplorerNav();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    setError(null);
    fetchOperadorDetalle({ operador, period, start_year, end_year, start_month, end_month })
      .then(setData)
      .catch(e => setError(e?.response?.data?.detail ?? e.message));
  }, [operador, period, start_year, end_year, start_month, end_month]);

  return (
    <FichaShell titulo={data?.operador ?? operador} tipo="operador">
      {error && <div className="text-sm text-rose-500">No se pudo cargar el detalle: {error}</div>}
      {!data && !error && (
        <div className="flex items-center justify-center h-40">
          <LoadingSpinner message="Consultando operador…" />
        </div>
      )}
      {data && !data.disponible && (
        <div className="text-sm text-slate-400">Sin datos de producción para este operador en el rango seleccionado.</div>
      )}
      {data?.disponible && (
        <>
          <button
            onClick={() => { irAOperador(data.operador ?? operador); cerrarFichas(); }}
            className="text-[13px] font-semibold text-teal-700 underline decoration-teal-300 decoration-2 underline-offset-2 hover:text-teal-800 hover:decoration-teal-500 transition-colors text-left w-fit"
          >
            Ver producción por operador en el Explorador →
          </button>

          <ListaColapsable
            titulo="Asignaciones y contratos"
            vacio="Sin asignaciones en el rango."
            items={(data.asignaciones ?? []).map(a => ({
              key: a.asignacion,
              label: a.block_name ?? a.asignacion,
              codigo: a.asignacion,
            }))}
            onItemClick={it => abrirAsignacion(it.codigo, it.label)}
          />

          <ListaColapsable
            titulo="Campos"
            vacio="Sin campos en el rango."
            items={(data.campos ?? []).map(c => ({ key: c, label: c }))}
            etiqueta={nombreCampoDisplay}
            onItemClick={it => abrirCampo(it.label)}
          />

          <BloqueProduccion
            titulo="Producción del operador"
            categories={data.categories}
            series={data.series}
            period={period}
          />
        </>
      )}
    </FichaShell>
  );
}
