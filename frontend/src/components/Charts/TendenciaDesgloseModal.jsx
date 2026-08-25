import { useEffect, useState } from "react";
import { fetchPozoTendenciaDesglose } from "../../api/client";
import LoadingSpinner from "../UI/LoadingSpinner";
import { tendenciaLabel } from "../../utils/tendenciaLabel";

const TENDENCIA_COLOR = { CRECIENDO: "#059669", ESTABLE: "#64748b", DECLINANDO: "#d97706", CRITICO: "#dc2626", SIN_PRODUCCION: "#94a3b8" };

function fmt(n, dec = 3) {
  return n == null ? "—" : n.toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtPct(n) {
  return n == null ? "—" : `${n > 0 ? "+" : ""}${fmt(n)}%`;
}

function Formula({ children }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2 my-1.5 font-mono text-[11.5px] text-slate-600 overflow-x-auto whitespace-pre">
      {children}
    </div>
  );
}

function Seccion({ n, titulo, children }) {
  return (
    <div className="mb-5">
      <p className="text-[12.5px] font-bold text-teal-700 uppercase tracking-wide mb-1.5">
        {n}. {titulo}
      </p>
      <div className="text-[12.5px] text-slate-700 leading-relaxed">{children}</div>
    </div>
  );
}

export default function TendenciaDesgloseModal({ campo, pozo, metrica = "auto", onClose }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let vigente = true;
    setDatos(null);
    setError(false);
    fetchPozoTendenciaDesglose({ campo, pozo, metrica })
      .then(d => { if (vigente) setDatos(d); })
      .catch(() => { if (vigente) setError(true); });
    return () => { vigente = false; };
  }, [campo, pozo, metrica]);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center" role="presentation">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4" style={{ maxHeight: "88vh", display: "flex", flexDirection: "column" }}>
        <div style={{ background: "linear-gradient(90deg,#10312B,#1a4a3a)" }} className="px-5 py-4 rounded-t-xl flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <p className="text-white text-[14px] font-bold">Cómo se calculó la Tendencia y la Vida Remanente</p>
            <p className="text-teal-200/90 text-[11.5px] truncate">
              Pozo {pozo} · Campo {campo}
              {datos?.disponible && ` · Producto: ${datos.producto}`}
            </p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white hover:bg-white/15 rounded-full w-7 h-7 flex items-center justify-center shrink-0 text-lg leading-none">✕</button>
        </div>

        <div className="p-5 overflow-y-auto">
          {error && <p className="text-sm text-red-500">No se pudo cargar el desglose de este pozo.</p>}
          {!error && !datos && (
            <div className="flex justify-center py-10"><LoadingSpinner message="Calculando…" /></div>
          )}
          {datos && !datos.disponible && (
            <p className="text-sm text-slate-400">Este pozo no tiene histórico suficiente para el análisis.</p>
          )}
          {datos?.disponible && (
            <>
              <Seccion n={0} titulo="Datos base">
                <p>
                  El pozo tiene <b>{datos.n_meses} meses</b> de histórico ({datos.rango}).
                  {datos.es_gas_seco && (
                    <> Es un pozo de gas seco: líquidos = 0 en todo el histórico, por eso el análisis usa <b>Gas (MMpcd)</b> en vez de Mbd (mismo criterio automático que aplica el sistema para toda la cuenca).</>
                  )}
                </p>
              </Seccion>

              <Seccion n={1} titulo="Tasa mensual (mes a mes)">
                <p>Se calcula el % de cambio de cada mes contra el anterior:</p>
                <Formula>{"tasa_mes(i) = (valor(i) - valor(i-1)) / valor(i-1) × 100"}</Formula>
                <p className="mb-1">Últimos {datos.pasos_6m.length} meses con dato:</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11.5px] border-collapse">
                    <thead>
                      <tr className="text-slate-400 text-left">
                        <th className="py-1 pr-3 font-semibold">Mes</th>
                        <th className="py-1 pr-3 font-semibold text-right">Anterior</th>
                        <th className="py-1 pr-3 font-semibold text-right">Actual</th>
                        <th className="py-1 font-semibold text-right">Tasa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.pasos_6m.map(p => (
                        <tr key={p.fecha} className="border-t border-slate-100">
                          <td className="py-1 pr-3 text-slate-600">{p.fecha}</td>
                          <td className="py-1 pr-3 text-right tabular-nums text-slate-500">{fmt(p.valor_anterior)}</td>
                          <td className="py-1 pr-3 text-right tabular-nums text-slate-500">{fmt(p.valor_actual)}</td>
                          <td className="py-1 text-right tabular-nums font-semibold text-slate-700">{fmtPct(p.tasa)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1.5">
                  <b>suma_6m</b> = suma de esas tasas = <b>{fmtPct(datos.suma_6m)}</b>
                </p>
              </Seccion>

              {datos.sin_produccion ? (
                <Seccion n={2} titulo="Sin producción">
                  <p>
                    El pozo no tuvo producción (mayor a cero) en ninguno de los últimos <b>6 meses calendario</b> —
                    se clasifica directo como <b style={{ color: TENDENCIA_COLOR.SIN_PRODUCCION }}>Sin producción</b>,
                    sin importar lo que digan las tasas de abajo (son informativas, con el último dato real que tuvo el pozo).
                  </p>
                </Seccion>
              ) : (
                <Seccion n={2} titulo="Clasificación (umbrales fijos, iguales para todos los pozos)">
                  <p>Se compara suma_6m contra los mismos umbrales para todos los pozos:</p>
                  <Formula>{`suma_6m < ${datos.umbral_critico}%  →  CRÍTICO\n${datos.umbral_critico}% a ${datos.umbral_declinando}%  →  DECLINANDO\n${datos.umbral_declinando}% a +${datos.umbral_creciendo}%  →  ESTABLE\nsuma_6m > +${datos.umbral_creciendo}%  →  CRECIENDO`}</Formula>
                  <p>
                    suma_6m = {fmtPct(datos.suma_6m)}
                    {" → "}<b style={{ color: TENDENCIA_COLOR[datos.tendencia_final] }}>TENDENCIA = {tendenciaLabel(datos.tendencia_final)}</b>
                  </p>
                </Seccion>
              )}

              {datos.anual != null && (
                <Seccion n={3} titulo="Tasa anual real (12 meses vs 12 meses previos) — informativa">
                  <p>No clasifica la tendencia (eso lo hace suma_6m, arriba) — se muestra como referencia y es la base de la proyección de vida remanente:</p>
                  <Formula>{"anual = (promedio_actual_12m - promedio_previo_12m) / promedio_previo_12m × 100"}</Formula>
                  <p>
                    promedio_actual_12m = <b>{fmt(datos.prom_actual_12m)} {datos.unidad}</b><br />
                    promedio_previo_12m = <b>{fmt(datos.prom_previo_12m)} {datos.unidad}</b><br />
                    <b>anual</b> = {fmtPct(datos.anual)}
                  </p>
                </Seccion>
              )}

              {datos.vida_remanente ? (
                <Seccion n={4} titulo="Proyección estimada de vida útil (vida remanente)">
                  <p>Solo se calcula si la tasa anual es negativa y la producción actual es mayor a cero. Modelo de declinación exponencial simple hasta llegar al 10% de la producción actual:</p>
                  <Formula>{"k = |anual| / 100\nlímite = producción_actual × 0.10\nt_años = ln(producción_actual / límite) / k\nvida_remanente_meses = round(t_años × 12)"}</Formula>
                  <p>
                    k = {fmt(datos.vida_remanente.k)} · límite = {fmt(datos.vida_remanente.limite)} {datos.unidad} · t_años = {fmt(datos.vida_remanente.t_anios)}
                  </p>
                  <p className="mt-1.5 text-[13px]">
                    <b>Proyección: ~{Math.floor(datos.vida_remanente.meses / 12)} años {datos.vida_remanente.meses % 12} meses</b> hasta llegar a ~10% de la producción actual.
                  </p>
                </Seccion>
              ) : (
                datos.anual != null && datos.anual >= 0 && (
                  <Seccion n={4} titulo="Proyección estimada de vida útil (vida remanente)">
                    <p>No aplica: la tasa anual no es negativa, así que no hay una declinación que proyectar.</p>
                  </Seccion>
                )
              )}

              <Seccion n={5} titulo="Nota sobre consistencia">
                <p>
                  Este cálculo siempre usa el histórico completo del pozo ({datos.n_meses} meses), sin importar el rango de años
                  seleccionado en el filtro de Periodo del tablero — así la Tendencia que ves aquí, en el detalle del pozo y en el
                  Ranking del campo/cuenca son siempre coherentes entre sí.
                </p>
              </Seccion>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
