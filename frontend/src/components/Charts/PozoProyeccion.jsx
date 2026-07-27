// Proyección de vida útil: estimado simple por decaimiento exponencial sobre
// la tasa de declinación anual vigente, hasta que la producción caiga a ~10%
// de la actual. No es un forecast de ingeniería de yacimientos — se etiqueta
// explícitamente como estimado.
export default function PozoProyeccion({ analisis }) {
  if (!analisis?.vida_remanente_meses_estimado) return null;
  const meses = analisis.vida_remanente_meses_estimado;
  const anios = Math.floor(meses / 12);
  const mesesRestantes = meses % 12;
  const texto = [
    anios > 0 ? `${anios} año${anios === 1 ? "" : "s"}` : null,
    mesesRestantes > 0 ? `${mesesRestantes} mes${mesesRestantes === 1 ? "" : "es"}` : null,
  ].filter(Boolean).join(" ") || "menos de un mes";

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-3">
      <p className="text-[11.5px] font-semibold text-amber-800">
        Proyección estimada de vida útil: ~{texto} (hasta ~10% de la producción actual)
      </p>
      <p className="text-[10px] text-amber-600 mt-1">
        Estimado simplificado con decaimiento exponencial sobre la tasa de declinación anual vigente ({analisis.tasa_declinacion_anual}%) — no es un forecast de ingeniería de yacimientos.
      </p>
    </div>
  );
}
