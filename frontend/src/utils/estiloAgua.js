// Estilo compartido del agua en las gráficas de Mbd.
//
// El agua se produce junto con los hidrocarburos y el usuario la quiere ver
// SIEMPRE. Se dibuja como línea continua sin relleno, en el MISMO eje que el
// hidrocarburo (pedido explícito) — antes tenía eje propio con área tenue,
// pero se simplificó a esto. Ojo al leerla: su escala real suele ser dos o
// tres órdenes de magnitud menor (0.014 vs 3.29 Mbd en Ayatsil-11DES), así
// que al compartir eje se ve pegada al fondo cuando el hidrocarburo es
// grande — es la lectura que se pidió, no un defecto de la gráfica.
export const AGUA_COLOR = "#38bdf8";

export function esAgua(nombre) {
  const n = String(nombre ?? "");
  // "Agua (MMpcd)" en "Producción de gas por componentes" es vapor de agua en
  // la corriente de gas, un componente más medido en MMpcd — no el agua
  // producida en Mbd, así que no le toca este estilo.
  if (n.includes("MMpcd")) return false;
  return /^agua\b/i.test(n.split(" (")[0].trim());
}
