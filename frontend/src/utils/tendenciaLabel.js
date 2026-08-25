// Etiqueta legible para los valores crudos de "tendencia" que manda el
// backend (pozos_service.py) — todos son una sola palabra en mayúsculas
// salvo SIN_PRODUCCION, que necesita espacio/acento para verse bien.
export function tendenciaLabel(tendencia) {
  return tendencia === "SIN_PRODUCCION" ? "Sin producción" : tendencia;
}
