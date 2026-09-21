import { useEffect, useState } from "react";
import { fetchAsignacionDetalle } from "../../api/client";
import LoadingSpinner from "../UI/LoadingSpinner";
import { useExplorer } from "../../store/useExplorer";
import { nombreCampoDisplay } from "../../utils/nombreCampo";
import { useAbrirFicha, useFicha } from "./FichaContext";
import { useExplorerNav } from "../../hooks/useExplorerNav";
import FichaShell, { Dato, SeccionTitulo, EnlaceFicha } from "./FichaShell";
import BloqueProduccion from "./BloqueProduccion";

const INK = "#1f2430";
const MUTED = "#767b87";

function fechaLegible(iso) {
  if (!iso) return null;
  const [anio, mes, dia] = iso.split("-");
  const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  return mes ? `${parseInt(dia, 10)} de ${MESES[parseInt(mes, 10) - 1]} ${anio}` : iso;
}

export default function FichaAsignacion({ asignacion }) {
  const { period, start_year, end_year, start_month, end_month } = useExplorer();
  const { abrirCampo, abrirPozo, abrirOperador } = useAbrirFicha();
  const { cerrarFichas } = useFicha();
  const { irAAsignacion } = useExplorerNav();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [mostrarPozos, setMostrarPozos] = useState(false);

  useEffect(() => { setMostrarPozos(false); }, [asignacion]);

  useEffect(() => {
    setData(null);
    setError(null);
    fetchAsignacionDetalle({ asignacion, period, start_year, end_year, start_month, end_month })
      .then(setData)
      .catch(e => setError(e?.response?.data?.detail ?? e.message));
  }, [asignacion, period, start_year, end_year, start_month, end_month]);

  return (
    <FichaShell
      titulo={data?.block_name ?? asignacion}
      subtitulo={data?.block_name ? asignacion : "Asignación / Contrato"}
      tipo="asignacion"
    >
      {error && <div className="text-sm text-rose-500">No se pudo cargar el detalle: {error}</div>}
      {!data && !error && (
        <div className="flex items-center justify-center h-40">
          <LoadingSpinner message="Consultando asignación…" />
        </div>
      )}
      {data && !data.disponible && (
        <div className="text-sm text-slate-400">No se encontró información de esta asignación o contrato.</div>
      )}
      {data?.disponible && (
        <>
          {data.periodo_fuera_rango != null && (
            <div className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Sin producción en el periodo seleccionado. Se muestra su último año con
              datos: <b>{data.periodo_fuera_rango}</b>.
            </div>
          )}
          {data.sin_produccion && (
            <div className="text-[11.5px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              {data.tipo === "CONTRATO" ? "Este contrato" : "Esta asignación"} aún no registra producción.
              Se muestran sus datos de bloque y operador.
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Operador</p>
              {data.operador ? (
                <EnlaceFicha onClick={() => abrirOperador(data.operador)} title="Ver ficha del operador">
                  {data.operador}
                </EnlaceFicha>
              ) : (
                <p className="text-[13.5px] font-medium" style={{ color: INK }}>—</p>
              )}
            </div>
            <Dato label="Fecha de construcción" valor={fechaLegible(data.fecha_construccion)} />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Pozos asociados</p>
              {data.num_pozos > 0 ? (
                <EnlaceFicha onClick={() => setMostrarPozos(v => !v)}>{data.num_pozos}</EnlaceFicha>
              ) : (
                <p className="text-[13.5px] font-medium" style={{ color: INK }}>—</p>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Campos</p>
              {data.campos?.length ? (
                <div className="flex flex-wrap gap-x-1.5 gap-y-0.5">
                  {data.campos.map(c => (
                    <EnlaceFicha key={c} onClick={() => abrirCampo(c)} title="Ver ficha del campo">
                      {nombreCampoDisplay(c)}
                    </EnlaceFicha>
                  ))}
                </div>
              ) : (
                <p className="text-[13.5px] font-medium" style={{ color: INK }}>—</p>
              )}
            </div>
            {data.plan && <Dato label="Plan" valor={data.plan} />}
            {data.activity && <Dato label="Actividad" valor={data.activity} />}
          </div>

          <button
            onClick={() => {
              irAAsignacion(asignacion, data.tipo, {
                nombre: data.block_name, cuencas: data.cuencas, ubicaciones: data.ubicaciones,
              });
              cerrarFichas();
            }}
            className="text-[13px] font-semibold text-teal-700 underline decoration-teal-300 decoration-2 underline-offset-2 hover:text-teal-800 hover:decoration-teal-500 transition-colors text-left w-fit"
          >
            Ver producción completa {data.tipo === "CONTRATO" ? "del contrato" : "de la asignación"} en el Explorador →
          </button>

          {mostrarPozos && data.pozos_asociados?.length > 0 && (
            <div>
              <SeccionTitulo nota="clic para ver su ficha">Lista de pozos</SeccionTitulo>
              <div className="flex flex-wrap gap-1.5">
                {data.pozos_asociados.map(p => (
                  <button
                    key={p.pozo}
                    onClick={() => abrirPozo(p.pozo, p.campo)}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 hover:bg-teal-100 hover:text-teal-800 transition-colors"
                  >
                    {p.pozo}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Sin producción no se dibuja el bloque: una tabla/gráfica vacía
              no aporta nada y hace ver la ficha como si algo hubiera fallado. */}
          {data.series?.length > 0 && (
            <BloqueProduccion
              titulo="Producción de la asignación"
              categories={data.categories}
              series={data.series}
              period={period}
            />
          )}
        </>
      )}
    </FichaShell>
  );
}
