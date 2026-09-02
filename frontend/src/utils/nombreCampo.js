// Algunos nombres de campo vienen pegados en CAMPO_PORTAL (la columna que se
// usa como identificador interno en todo el sistema: filtros, llamadas a la
// API, comparaciones), pero el nombre real del campo lleva espacio. El
// identificador interno NUNCA cambia (sigue siendo "TUPILCOPROFUNDO" en URLs,
// props, comparaciones) — este mapa solo afecta lo que se pinta en pantalla.
const NOMBRE_FIXES = {
  TUPILCOPROFUNDO: "Tupilco Profundo",
};

export function nombreCampoDisplay(nombre) {
  return NOMBRE_FIXES[nombre] ?? nombre;
}
