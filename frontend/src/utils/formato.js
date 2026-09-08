// Formato numérico único para todo el sitio.
//
// Regla: los DATOS cuantitativos (producción en Mbd/MMpcd, reservas, precios,
// composición del gas) se muestran SIEMPRE con 2 decimales — pedido explícito,
// para que no convivan cifras con 0, 1 y 2 decimales. Los CONTEOS (número de
// pozos, sesiones del panel de admin) siguen siendo enteros: "6,395.00 pozos"
// se vería mal.

export function fmtNum(v, decimales = 2) {
  if (v == null || v === "" || Number.isNaN(Number(v))) return "";
  return Number(v).toLocaleString("es-MX", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

// Atajo para el caso normal (2 decimales).
export const fmt2 = (v) => fmtNum(v, 2);

// Entero con separador de miles, para conteos.
export const fmtEntero = (v) => fmtNum(v, 0);
