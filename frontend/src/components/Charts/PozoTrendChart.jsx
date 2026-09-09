import { forwardRef, useImperativeHandle, useRef } from "react";
import ReactECharts from "echarts-for-react";
import { AGUA_COLOR } from "../../utils/estiloAgua";
import { fmt2 } from "../../utils/formato";
import { sinCerosIniciales } from "../../utils/seriesUtils";

const AREA_COLOR = { CRITICO: "rgba(220,38,38,0.12)", DECLINANDO: "rgba(245,158,11,0.12)" };

// Mismos colores que las tarjetas del Panorama general: líquidos verde, gas azul.
const METRIC_COLOR = { Mbd: "#0d7a4a", MMpcd: "#1d6fa5" };

// Línea de producción con marcas de pico histórico / promedio 12m, y una
// franja sombreada sobre los últimos 3 meses si el pozo está declinando.
// El rango graficado es el del filtro de Período de la barra superior
// (categories/data ya vienen acotados desde el fetch), sin selector propio.
// forwardRef expone getImage() para capturar la gráfica como PNG al exportar a Excel.
// El agua se grafica SIEMPRE que el pozo tenga, en el MISMO eje que el
// hidrocarburo (pedido explícito) y como línea continua sin relleno — solo se
// distingue por su color. Su escala real suele ser dos o tres órdenes de
// magnitud menor (0.014 vs 3.29 Mbd en Ayatsil-11DES), así que al compartir
// eje su línea se ve pegada al fondo cuando el hidrocarburo es grande; es la
// lectura que se pidió, no un defecto de la gráfica.
const PozoTrendChart = forwardRef(function PozoTrendChart({ categories, data, unidad = "Mbd", analisis, metricSwitch, agua }, ref) {
  const echartsRef = useRef(null);
  useImperativeHandle(ref, () => ({
    getImage: () => echartsRef.current?.getEchartsInstance().getDataURL({ pixelRatio: 2, backgroundColor: "#fff" }) ?? null,
  }));

  if (!categories?.length) return null;
  const cats = categories;
  const vals = sinCerosIniciales(data);

  const markLineData = [];
  if (analisis?.pico_historico_mbd) {
    markLineData.push({ yAxis: analisis.pico_historico_mbd, name: "Pico histórico" });
  }
  if (analisis?.promedio_12m) {
    markLineData.push({ yAxis: analisis.promedio_12m, name: "Prom. 12m" });
  }

  const metricColor = METRIC_COLOR[unidad] ?? METRIC_COLOR.Mbd;
  const areaColor = AREA_COLOR[analisis?.tendencia];
  const markAreaData = areaColor && cats.length >= 2
    ? [[{ xAxis: cats[Math.max(0, cats.length - 3)] }, { xAxis: cats[cats.length - 1] }]]
    : [];

  const hayAgua = agua?.data?.some(v => v);
  const nombreProducto = unidad === "MMpcd" ? "Gas" : "Líquidos";

  const option = {
    backgroundColor: "#fff",
    tooltip: { trigger: "axis", textStyle: { fontSize: 11 }, valueFormatter: v => (v == null ? "—" : fmt2(v)) },
    // Con agua hay una serie más — se muestra la leyenda para saber cuál es
    // cuál, ahora que las dos comparten el mismo eje y color no basta para
    // distinguirlas de un vistazo si alguien no conoce la paleta.
    legend: hayAgua ? {
      top: 0, left: 0, itemWidth: 14, itemHeight: 8,
      textStyle: { fontSize: 10, color: "#64748b" },
      data: [nombreProducto, "Agua"],
    } : undefined,
    grid: { top: hayAgua ? 40 : 30, right: 24, bottom: 30, left: 50, containLabel: true },
    xAxis: {
      type: "category", data: cats,
      axisLabel: { fontSize: 10, color: "#767b87", rotate: cats.length > 18 ? 45 : 0 },
      axisLine: { lineStyle: { color: "#e7e5e0" } },
    },
    yAxis: { type: "value", axisLabel: { fontSize: 10, color: "#767b87", formatter: v => fmt2(v) }, splitLine: { show: false } },
    series: [
      {
        name: nombreProducto,
        type: "line", data: vals, smooth: true, symbol: "none", z: 3,
        lineStyle: { width: 2, color: metricColor },
        itemStyle: { color: metricColor },
        areaStyle: { color: metricColor + "14" },
        markLine: markLineData.length ? {
          silent: true, symbol: "none",
          lineStyle: { type: "dashed", color: "#94a3b8" },
          label: { fontSize: 9, color: "#64748b", formatter: "{b}", position: "end" },
          data: markLineData,
        } : undefined,
        markArea: markAreaData.length ? { itemStyle: { color: areaColor }, data: markAreaData } : undefined,
      },
      ...(hayAgua ? [{
        name: "Agua",
        type: "line", data: sinCerosIniciales(agua.data), smooth: true, symbol: "none", z: 2,
        lineStyle: { width: 2, color: AGUA_COLOR },
        itemStyle: { color: AGUA_COLOR },
      }] : []),
    ],
  };

  return (
    <div className="rounded-xl border border-slate-200 shadow-sm bg-white p-3 mb-3">
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-[12px] font-bold text-slate-700">
          Producción observada ({unidad === "MMpcd" ? "gas" : "líquidos"}, {unidad})
        </span>
        {metricSwitch && (
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
            {[["liquidos", "Mbd"], ["gas", "MMpcd"]].map(([id, label]) => (
              <button key={id} onClick={() => metricSwitch.onChange(id)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                  metricSwitch.value === id ? "bg-tih-dark text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {cats.length < 2 ? (
        <p className="text-sm text-slate-400 text-center py-16">
          Selecciona un rango de 2 o más años (o vista mensual) para ver la tendencia.
        </p>
      ) : (
        <ReactECharts ref={echartsRef} option={option} style={{ height: 260 }} notMerge />
      )}
    </div>
  );
});

export default PozoTrendChart;
