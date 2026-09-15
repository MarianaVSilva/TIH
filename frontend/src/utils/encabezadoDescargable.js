// Encabezado común de los descargables, calcado del formato de la CNH que pidió
// el usuario como referencia (POZOS_TERMINADOS.csv):
//
//   COMISIÓN NACIONAL DE HIDROCARBUROS
//   POZOS TERMINADOS
//   (línea en blanco)
//   Datos a diciembre - 2024.
//   (línea en blanco)
//   FECHA,CUENCA,…            ← títulos de columna
//   …datos…
//
// Sin logo, sin colores, sin negritas y sin celdas combinadas: el archivo es
// para trabajarlo (ordenar, filtrar, leer con pandas), no para verse bonito.
export function lineasEncabezado({ titulo, subtitulo, periodoNota }) {
  const lineas = ["SECRETARÍA DE ENERGÍA"];
  if (titulo) lineas.push(titulo);
  lineas.push("");
  if (periodoNota) lineas.push(periodoNota);
  // Los filtros activos viajan aquí: es lo que hace que el archivo
  // corresponda con lo que el usuario tiene en pantalla.
  if (subtitulo) lineas.push(String(subtitulo).replace(/\n/g, " · "));
  lineas.push("");
  return lineas;
}
