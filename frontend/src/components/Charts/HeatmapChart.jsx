import ReactECharts from "echarts-for-react";

// "items" es la misma lista {name, data} que ya arma buildHierSeries() para las
// demás gráficas (línea/barras/pastel), así que el mapa de calor respeta el
// groupBy activo (cuenca/ambiente/categoría/operador) en vez de leer siempre cuencas.
export default function HeatmapChart({ items = [], categories = [], height = 400, visibleSeries = {} }) {
  const rowsItems = items.filter(it => visibleSeries[it.name] !== false);
  if (!rowsItems.length || !categories.length) return null;

  const isMonthly = /^\d{4}-\d{2}$/.test(categories[0]);
  const years = isMonthly ? [...new Set(categories.map(c => c.slice(0, 4)))].sort() : categories;

  const names = rowsItems.map(it => it.name);

  const data = [];
  rowsItems.forEach((it, yi) => {
    if (isMonthly) {
      const perYear = {};
      categories.forEach((cat, i) => {
        const yr = cat.slice(0, 4);
        perYear[yr] = (perYear[yr] ?? 0) + (it.data[i] ?? 0);
      });
      years.forEach((yr, xi) => data.push([xi, yi, perYear[yr] ?? 0]));
    } else {
      categories.forEach((cat, xi) => data.push([xi, yi, it.data[xi] ?? 0]));
    }
  });

  const maxVal = Math.max(...data.map(d => d[2]), 1);

  const option = {
    backgroundColor: "transparent",
    tooltip: {
      formatter: (p) =>
        `${names[p.data[1]]}<br/>${years[p.data[0]]}: <b>${p.data[2].toLocaleString("es-MX")}</b>`,
    },
    grid: { top: 20, right: 120, bottom: 60, left: 180 },
    xAxis: {
      type: "category",
      data: years,
      axisLabel: { color: "#64748b", fontSize: 10, rotate: years.length > 15 ? 45 : 0 },
      axisLine: { lineStyle: { color: "#e2e8f0" } },
      splitArea: { show: true },
    },
    yAxis: {
      type: "category",
      data: names,
      axisLabel: { color: "#64748b", fontSize: 11 },
      axisLine: { lineStyle: { color: "#e2e8f0" } },
      splitArea: { show: true },
    },
    visualMap: {
      min: 0,
      max: maxVal,
      calculable: true,
      orient: "vertical",
      right: 10,
      top: "center",
      inRange: { color: ["#f0fdfa", "#0d7377"] },
      textStyle: { color: "#64748b", fontSize: 10 },
    },
    series: [{
      type: "heatmap",
      data,
      label: {
        show: true,
        formatter: (p) => p.data[2] > 0 ? p.data[2].toLocaleString("es-MX") : "",
        fontSize: 10,
        color: "#374151",
      },
      emphasis: { itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,0.2)" } },
    }],
  };

  return <ReactECharts option={option} style={{ height }} notMerge />;
}
