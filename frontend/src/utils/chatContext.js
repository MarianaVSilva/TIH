import { useExplorer } from "../store/useExplorer";

const MAX_JSON_CHARS = 2500;

export function buildChatContext() {
  const { tema, period, start_year, end_year, start_month, end_month, resultado } = useExplorer.getState();
  if (!tema) return null;

  const rango = period === "monthly"
    ? `${start_month}/${start_year} – ${end_month}/${end_year}`
    : `${start_year} – ${end_year}`;

  const lines = [
    `Sección: ${tema.seccion}`,
    `Tema: ${tema.tema}`,
    `Periodicidad: ${period === "monthly" ? "Mensual" : "Anual"}`,
    `Rango: ${rango}`,
  ];

  if (resultado) {
    const json = JSON.stringify(resultado);
    lines.push("Datos actualmente en la tabla (JSON, puede estar truncado):");
    lines.push(json.length > MAX_JSON_CHARS ? json.slice(0, MAX_JSON_CHARS) + "…" : json);
  }

  return lines.join("\n");
}
