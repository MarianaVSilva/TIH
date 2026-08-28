import * as echarts from "echarts";

// Renderiza un option de ECharts en un contenedor invisible (fuera de
// pantalla, nunca se pinta al usuario) y lo captura como PNG — usado para
// meter gráficas reales (no capturas de las tarjetas del dashboard, que se
// ven mal impresas) en el PDF del Panorama general. `width`/`height` son
// las dimensiones lógicas (CSS px); pixelRatio 2 da una imagen nítida sin
// cambiar la relación de aspecto que usa exportarReportePdf para escalar.
export async function renderChartImage(option, { width = 480, height = 260 } = {}) {
  const div = document.createElement("div");
  div.style.cssText = `position:fixed; left:-9999px; top:0; width:${width}px; height:${height}px;`;
  document.body.appendChild(div);
  const chart = echarts.init(div, null, { width, height, renderer: "canvas" });
  // Sin esto, getDataURL() se dispara antes de que termine la animación de
  // entrada (barras creciendo desde 0) y la imagen capturada sale vacía —
  // fuera de pantalla nadie ve la animación, no tiene caso pagar la carrera.
  chart.setOption({ ...option, animation: false });
  const dataUrl = chart.getDataURL({ pixelRatio: 2, backgroundColor: "#fff" });
  chart.dispose();
  document.body.removeChild(div);
  return { tipo: "imagen", dataUrl, width, height };
}

// Dona simple de 2 valores (p. ej. PEMEX vs Privados, Aceite vs Gas).
// Dona lisa (sin líneas guía ni % por rebanada, estilo del sitio) con el %
// del primer par grande al centro y una leyenda simple abajo (• nombre  valor).
export function donutOption(pares, { unidad = "", centerColor } = {}) {
  const total = pares.reduce((s, p) => s + (p.value || 0), 0);
  const pct = total ? Math.round((pares[0].value / total) * 100) : 0;
  return {
    legend: {
      bottom: 0, itemWidth: 9, itemHeight: 9, textStyle: { fontSize: 10, color: "#334155" },
      formatter: (name) => {
        const p = pares.find(x => x.name === name);
        return `${name}   ${p.value.toLocaleString("es-MX")}${unidad ? " " + unidad : ""}`;
      },
    },
    graphic: {
      elements: [{
        type: "text", left: "center", top: "42%",
        style: { text: `${pct}%`, fontSize: 26, fontWeight: 700, fill: centerColor ?? pares[0].color },
      }],
    },
    series: [{
      type: "pie", radius: ["58%", "78%"], center: ["50%", "44%"], avoidLabelOverlap: false,
      label: { show: false }, labelLine: { show: false },
      data: pares.map(p => ({ name: p.name, value: p.value, itemStyle: { color: p.color } })),
    }],
  };
}
