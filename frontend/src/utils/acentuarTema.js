// Los nombres de tema/sección/título vienen tal cual de la BD (columnas TEMA/
// TITULO/SECCION en CUBOS), sin acentos en varias palabras — se corrige solo
// en pantalla, sin tocar la BD. Compartido por TopBar (pills/dropdown) y
// ChartArea (título de la gráfica/tabla), para que la ortografía sea
// consistente en todo el sitio y no solo donde ya se había parchado a mano.
export function acentuarTema(s) {
  if (!s) return s;
  return s
    .replace(/reservas por campo de petr[oó]leo/gi, "Reservas por campo")
    .replace(/reservas por asignacion-contrato de petr[oó]leo\s*/gi, "Reservas por asignación-contrato")
    .replace(/petroleo/gi, "petróleo")
    .replace(/producci[oó]n/gi, "Producción")
    .replace(/ubicacion/gi, "ubicación");
}
