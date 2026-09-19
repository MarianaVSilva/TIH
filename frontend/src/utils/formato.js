// Formato numérico único para todo el sitio.
//
// Regla: los DATOS cuantitativos (producción en Mbd/MMpcd, reservas, precios,
// composición del gas) se muestran con 2 decimales — pedido explícito, para
// que no convivan cifras con 0, 1 y 2 decimales.
//
// EXCEPCIÓN (pedido posterior): si la cifra es un ENTERO no se le cuelga el
// ".00". Muchos datos llegan redondeados desde la API —la producción nacional
// del Panorama es 1771, las reservas top son 938— y "1,771.00" se leía como si
// hubiera una precisión que el dato no tiene. Un valor con parte decimal SÍ
// muestra los 2 decimales completos, así que nunca aparece "1,234.5": o van 0
// decimales o van los 2. La mezcla que se quería evitar sigue evitada.
export function fmtNum(v, decimales = 2) {
  if (v == null || v === "" || Number.isNaN(Number(v))) return "";
  const n = Number(v);
  // Number.isInteger(2.00) es true y Number.isInteger(0.004) es false; para
  // decimales=2 un 0.004 se redondearía a "0.00", así que se compara contra el
  // valor YA redondeado a los decimales que se van a mostrar.
  const factor = 10 ** decimales;
  const esEntero = Math.round(n * factor) % factor === 0;
  const dec = esEntero ? 0 : decimales;
  return n.toLocaleString("es-MX", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

// Atajo para el caso normal (2 decimales).
export const fmt2 = (v) => fmtNum(v, 2);

// Tres decimales: producción por pozo, donde las cifras son muy chicas.
export const fmt3 = (v) => fmtNum(v, 3);

// Entero con separador de miles, para conteos.
export const fmtEntero = (v) => fmtNum(v, 0);
