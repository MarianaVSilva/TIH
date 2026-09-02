// Estilo compartido del agua en las gráficas de Mbd.
//
// El agua se produce junto con los hidrocarburos y el usuario la quiere ver
// SIEMPRE, pero suele ser de dos o tres órdenes de magnitud distinta (0.014 vs
// 3.29 Mbd en Ayatsil-11DES): compartiendo eje queda pegada al cero y no se ve
// nada. Va en un eje propio a la derecha, con un área azul muy tenue al fondo
// para que se lea como contexto y no como una serie que compite con la
// producción. Ojo al leerla: al tener su propia escala, la altura del agua NO
// es comparable con la del hidrocarburo, solo su forma en el tiempo.
export const AGUA_COLOR = "#38bdf8";
export const AGUA_AREA = "rgba(56,189,248,0.16)";
// Punteada: refuerza que es otra escala y otra cosa, sin depender del color.
export const AGUA_LINEA = { width: 1.8, color: AGUA_COLOR, type: "dashed" };

export function esAgua(nombre) {
  const n = String(nombre ?? "");
  // "Agua (MMpcd)" en "Producción de gas por componentes" es vapor de agua en
  // la corriente de gas, un componente más medido en MMpcd — no el agua
  // producida en Mbd, así que no le toca ni el eje aparte ni el área tenue.
  if (n.includes("MMpcd")) return false;
  return /^agua\b/i.test(n.split(" (")[0].trim());
}

// Relleno de rayas diagonales tenues para el hidrocarburo, para cuando su área
// se dibuja ENCIMA de la del agua (ficha de pozo): un relleno sólido taparía el
// agua, el rayado la deja ver. ECharts acepta un canvas como color de relleno.
const _patrones = new Map();
export function rayasHidrocarburo(color) {
  if (_patrones.has(color)) return _patrones.get(color);
  const c = document.createElement("canvas");
  c.width = c.height = 8;
  const ctx = c.getContext("2d");
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, 8); ctx.lineTo(8, 0);
  ctx.moveTo(-1, 1); ctx.lineTo(1, -1);
  ctx.moveTo(7, 9); ctx.lineTo(9, 7);
  ctx.stroke();
  const patron = { image: c, repeat: "repeat" };
  _patrones.set(color, patron);
  return patron;
}

// Config del eje derecho del agua, compartida por las gráficas.
export function ejeAgua(unidad = "Mbd") {
  return {
    type: "value",
    name: `Agua (${unidad})`,
    position: "right",
    nameGap: 14,
    nameTextStyle: { fontSize: 9, color: AGUA_COLOR, align: "right" },
    axisLabel: { fontSize: 10, color: AGUA_COLOR },
    splitLine: { show: false },
  };
}
