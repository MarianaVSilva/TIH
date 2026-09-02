import { useEffect, useState } from "react";
import { fetchCampoDetalle } from "../../api/client";
import LoadingSpinner from "../UI/LoadingSpinner";
import { useExplorer } from "../../store/useExplorer";
import { useExplorerNav } from "../../hooks/useExplorerNav";
import { nombreCampoDisplay } from "../../utils/nombreCampo";
import { useAbrirFicha, useFicha } from "./FichaContext";
import FichaShell, { Dato, SeccionTitulo } from "./FichaShell";
import BloqueProduccion, { BloqueReservas } from "./BloqueProduccion";

const INK = "#1f2430";

export default function FichaCampo({ campo }) {
  const { period, start_year, end_year, start_month, end_month } = useExplorer();
  const { cerrarFichas } = useFicha();
  const { abrirAsignacion, abrirOperador } = useAbrirFicha();
  const { irACampo } = useExplorerNav();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    setError(null);
    fetchCampoDetalle({ campo, period, start_year, end_year, start_month, end_month })
      .then(setData)
      .catch(e => setError(e?.response?.data?.detail ?? e.message));
  }, [campo, period, start_year, end_year, start_month, end_month]);

  const atributo = data?.atributos?.[0];

  return (
    <FichaShell titulo={nombreCampoDisplay(campo)} tipo="campo">
      {error && <div className="text-sm text-rose-500">No se pudo cargar el detalle: {error}</div>}
      {!data && !error && (
        <div className="flex items-center justify-center h-40">
          <LoadingSpinner message="Consultando campo…" />
        </div>
      )}
      {data && !data.disponible && (
        <div className="text-sm text-slate-400">Sin datos de producción para este campo en el rango seleccionado.</div>
      )}
      {data?.disponible && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Dato label="Bloque" valor={atributo?.bloque ?? (data.asignaciones[0]?.block_name ?? data.asignaciones[0]?.asignacion)} />
            <Dato label="Pozo descubridor" valor={atributo?.pozo_descubridor} />
            <Dato
              label="Profundidad"
              valor={atributo?.profundidad_promedio_m != null ? `${atributo.profundidad_promedio_m.toLocaleString("es-MX")} m` : null}
            />
            <Dato label="Año de descubrimiento" valor={atributo?.anio_descubrimiento} />
          </div>

          <button
            onClick={() => { irACampo(campo); cerrarFichas(); }}
            className="text-[13px] font-semibold text-teal-700 underline decoration-teal-300 decoration-2 underline-offset-2 hover:text-teal-800 hover:decoration-teal-500 transition-colors text-left w-fit"
          >
            Ver producción completa del campo en el Explorador →
          </button>

          <div>
            <SeccionTitulo nota="clic para ver su ficha">Asignaciones en este campo</SeccionTitulo>
            {data.asignaciones?.length ? (
              <div className="flex flex-col gap-1">
                {data.asignaciones.map(a => (
                  <div
                    key={a.asignacion}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50"
                  >
                    <button
                      onClick={() => abrirAsignacion(a.asignacion, a.block_name ?? a.asignacion)}
                      className="text-[12.5px] font-medium truncate text-left hover:text-teal-700 hover:underline decoration-teal-300 underline-offset-2 transition-colors"
                      style={{ color: INK }}
                      title="Ver ficha de la asignación"
                    >
                      {a.block_name ?? a.asignacion}
                    </button>
                    <button
                      onClick={() => abrirOperador(a.operador)}
                      className="text-[11px] text-teal-700 whitespace-nowrap hover:underline decoration-teal-300 underline-offset-2 shrink-0"
                      title="Ver ficha del operador"
                    >
                      {a.operador}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13.5px] font-medium" style={{ color: INK }}>—</p>
            )}
          </div>

          <BloqueReservas reservas={data.reservas} />

          <BloqueProduccion
            titulo="Producción del campo"
            categories={data.categories}
            series={data.series}
            period={period}
          />
        </>
      )}
    </FichaShell>
  );
}
