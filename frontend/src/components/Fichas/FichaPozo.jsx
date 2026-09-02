import { useEffect, useState } from "react";
import { fetchProduccionPozoDetalle, fetchPozoAnalisis } from "../../api/client";
import LoadingSpinner from "../UI/LoadingSpinner";
import { useExplorer } from "../../store/useExplorer";
import { useExplorerNav } from "../../hooks/useExplorerNav";
import { tendenciaLabel } from "../../utils/tendenciaLabel";
import { useAbrirFicha, useFicha } from "./FichaContext";
import FichaShell, { Dato, SeccionTitulo, EnlaceFicha } from "./FichaShell";
import BloqueProduccion from "./BloqueProduccion";

const INK = "#1f2430";
const MUTED = "#767b87";

const ESTADO_COLOR = {
  "Productor": "#059669", "En inyección": "#0ea5e9",
  "Inactivo": "#6b7280", "Cerrado": "#6b7280",
};
function estadoColor(estado) {
  if (ESTADO_COLOR[estado]) return ESTADO_COLOR[estado];
  if (estado?.startsWith("Abandono") || estado?.startsWith("Taponamiento")) return "#dc2626";
  return "#94a3b8";
}
const TENDENCIA_COLOR = { CRECIENDO: "#059669", ESTABLE: "#64748b", DECLINANDO: "#d97706", CRITICO: "#dc2626", SIN_PRODUCCION: "#94a3b8" };
// Pozo sin producción actual: la tendencia no tiene sentido, se omite.
const ESTADOS_SIN_TENDENCIA = ["Cerrado", "Inactivo", "Abandono permanente", "Abandono temporal"];

function fechaLegible(iso) {
  if (!iso) return null;
  const [anio, mes, dia] = iso.split("-");
  const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  return mes ? `${parseInt(dia, 10)} de ${MESES[parseInt(mes, 10) - 1]} ${anio}` : iso;
}

// Código que espera la ficha de asignación a partir del ASIG_CONT del pozo.
// Se escribe distinto según el tipo:
//   - Asignaciones: "A-0003-2M - Campo Agave" → el código es el prefijo
//     "A-0003" (misma regla que get_asignacion_detalle en el backend).
//   - Contratos: "CNH-R01-L02-A1/2015" ya ES el código exacto, se usa tal
//     cual (no empata el patrón de arriba porque tras "CNH-" no vienen
//     dígitos).
function codigoAsignacion(asigCont) {
  if (!asigCont) return null;
  const m = /^([A-Za-z]+-\d+)-/.exec(asigCont);
  return m ? m[1] : asigCont;
}

export default function FichaPozo({ pozo, campo }) {
  const { period, start_year, end_year, start_month, end_month } = useExplorer();
  const { cerrarFichas } = useFicha();
  const { abrirAsignacion, abrirOperador } = useAbrirFicha();
  const { irAPozo } = useExplorerNav();
  const [detalle, setDetalle] = useState(null);
  const [analisis, setAnalisis] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDetalle(null);
    setAnalisis(null);
    setError(null);
    if (!campo) return;
    let vigente = true;
    fetchProduccionPozoDetalle({ campo, pozo, period, start_year, end_year, start_month, end_month })
      .then(d => { if (vigente) setDetalle(d); })
      .catch(e => { if (vigente) setError(e?.response?.data?.detail ?? e.message); });
    fetchPozoAnalisis({ campo, pozo, metrica: "auto" })
      .then(d => { if (vigente) setAnalisis(d); })
      .catch(() => { if (vigente) setAnalisis(null); });
    return () => { vigente = false; };
  }, [pozo, campo, period, start_year, end_year, start_month, end_month]);

  const codAsig = codigoAsignacion(campo);
  const series = detalle?.rows?.filter(r => r.data?.some(v => v)) ?? [];
  const mostrarTendencia =
    analisis?.tendencia && analisis.tendencia !== "SIN_DATOS" &&
    !ESTADOS_SIN_TENDENCIA.includes(analisis.estado_operativo);

  return (
    <FichaShell titulo={pozo} subtitulo={campo || "Pozo"} tipo="pozo">
      {!campo && (
        <div className="text-sm text-slate-400">Este pozo no tiene producción registrada, no hay detalle que mostrar.</div>
      )}
      {error && <div className="text-sm text-rose-500">No se pudo cargar el detalle: {error}</div>}
      {campo && !detalle && !error && (
        <div className="flex items-center justify-center h-40">
          <LoadingSpinner message="Consultando pozo…" />
        </div>
      )}
      {campo && detalle && (
        <>
          {(analisis?.estado_operativo || mostrarTendencia) && (
            <div className="flex items-center gap-2 flex-wrap">
              {analisis?.estado_operativo && (
                <span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold text-white" style={{ background: estadoColor(analisis.estado_operativo) }}>
                  {analisis.estado_operativo}
                </span>
              )}
              {mostrarTendencia && (
                <span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold text-white" style={{ background: TENDENCIA_COLOR[analisis.tendencia] ?? "#94a3b8" }}>
                  {tendenciaLabel(analisis.tendencia)}
                </span>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Operador</p>
              {analisis?.operador ? (
                <EnlaceFicha onClick={() => abrirOperador(analisis.operador)} title="Ver ficha del operador">
                  {analisis.operador}
                </EnlaceFicha>
              ) : (
                <p className="text-[13.5px] font-medium" style={{ color: INK }}>—</p>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Asignación / Contrato</p>
              {codAsig ? (
                <EnlaceFicha onClick={() => abrirAsignacion(codAsig, campo)} title="Ver ficha de la asignación">
                  {campo}
                </EnlaceFicha>
              ) : (
                <p className="text-[13.5px] font-medium break-words" style={{ color: INK }}>{campo ?? "—"}</p>
              )}
            </div>
            <Dato label="Perforado el" valor={fechaLegible(analisis?.fecha_perforacion)} />
            <Dato label="Años en producción" valor={analisis?.anos_en_produccion} />
            <Dato
              label="Profundidad"
              valor={analisis?.profundidad_md != null ? `${analisis.profundidad_md.toLocaleString("es-MX")} m` : null}
            />
            <Dato label="Categoría" valor={analisis?.categoria} />
            <Dato
              label={`Producción actual${analisis?.unidad ? ` (${analisis.unidad})` : ""}`}
              valor={analisis?.produccion_actual_mbd?.toLocaleString("es-MX")}
            />
            <Dato
              label="Pico histórico"
              valor={analisis?.pico_historico_mbd != null
                ? `${analisis.pico_historico_mbd.toLocaleString("es-MX")}${analisis.pico_historico_periodo ? ` · ${analisis.pico_historico_periodo}` : ""}`
                : null}
            />
          </div>

          {analisis?.alerta && (
            <div
              className="rounded-lg px-3 py-2 text-[11.5px] font-medium"
              style={{
                background: analisis.alerta.nivel === "CRITICA" ? "#fef2f2" : "#fffbeb",
                color: analisis.alerta.nivel === "CRITICA" ? "#991b1b" : "#92400e",
                border: `1px solid ${analisis.alerta.nivel === "CRITICA" ? "#fecaca" : "#fde68a"}`,
              }}
            >
              ⚠ {analisis.alerta.mensaje}
            </div>
          )}

          <button
            onClick={() => { irAPozo(pozo, campo); cerrarFichas(); }}
            className="text-[13px] font-semibold text-teal-700 underline decoration-teal-300 decoration-2 underline-offset-2 hover:text-teal-800 hover:decoration-teal-500 transition-colors text-left w-fit"
          >
            Ver análisis completo en el Explorador de pozos →
          </button>

          {series.length ? (
            <BloqueProduccion
              titulo="Producción del pozo"
              categories={detalle.categories}
              series={series}
              period={period}
            />
          ) : (
            <div>
              <SeccionTitulo>Producción del pozo</SeccionTitulo>
              <p className="text-sm text-slate-400">Sin datos de producción en el rango seleccionado.</p>
            </div>
          )}
        </>
      )}
    </FichaShell>
  );
}
