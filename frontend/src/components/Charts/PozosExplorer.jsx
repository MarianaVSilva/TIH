import { useState, useEffect, useMemo, useRef } from "react";
import {
  fetchProduccionPozosArbol, fetchProduccionPozoDetalle, fetchProduccionPozosResumen,
  fetchPozoAnalisis, fetchPozosRanking, fetchPozosFiltrados,
  fetchPozosCacheStatus, exportarPozosCsvUrl,
} from "../../api/client";
import { useExplorer } from "../../store/useExplorer";
import LoadingSpinner from "../UI/LoadingSpinner";
import LoadingBar from "../UI/LoadingBar";
import PozoTrendChart from "./PozoTrendChart";
import PozoRankingCard from "./PozoRankingCard";
import TendenciaDesgloseModal from "./TendenciaDesgloseModal";
import PozoProyeccion from "./PozoProyeccion";
import PozosFiltrosPanel from "./PozosFiltrosPanel";
import PozosComparar from "./PozosComparar";

// Croma-key en vivo del video "pozo sin producción" — el archivo trae un
// fondo gris claro sólido (rgb 242,242,242) horneado en los píxeles; en vez
// de tapar ese gris con una caja del mismo color (se nota el borde contra el
// blanco de la card), se pinta cada frame en un canvas oculto y se vuelve
// transparente todo píxel cercano a ese gris, dejando ver el fondo real.
function VideoSinFondo({ src, className }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let raf;
    const UMBRAL = 18; // distancia máxima a (242,242,242) para volverse transparente

    function pintar() {
      raf = requestAnimationFrame(pintar);
      if (video.videoWidth === 0) return;
      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      ctx.drawImage(video, 0, 0);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = frame.data;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - 242) < UMBRAL && Math.abs(d[i + 1] - 242) < UMBRAL && Math.abs(d[i + 2] - 242) < UMBRAL) {
          d[i + 3] = 0;
        }
      }
      ctx.putImageData(frame, 0, 0);
    }
    video.play().catch(() => {});
    raf = requestAnimationFrame(pintar);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      <video ref={videoRef} src={src} loop muted playsInline style={{ display: "none" }} />
      <canvas ref={canvasRef} className={className} />
    </>
  );
}

// Diseño de dos pasos: el árbol Cuenca→Campo→Pozo se trae una sola vez sin
// cifras; la serie de un pozo puntual se pide solo al seleccionarlo. El caché
// local indexado (pozos_cache.py) acelera esto a milisegundos una vez sincronizado.
function toggle(set, setter, key) {
  setter(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
}

// Líquidos en verde, gas en azul (mismos tonos que el resto del tablero).
// Agua no es hidrocarburo, se deja en azul más claro para no confundirla con gas.
function kpiIconColor(label) {
  if (/agua/i.test(label)) return "#38bdf8";
  if (/gas/i.test(label)) return "#1d6fa5";
  return "#0d7a4a";
}

const ESTADO_COLOR = {
  "Productor": "#059669", "En inyección": "#0ea5e9",
  "Inactivo": "#6b7280", "Cerrado": "#6b7280",
};
function estadoColor(estado) {
  if (ESTADO_COLOR[estado]) return ESTADO_COLOR[estado];
  if (estado?.startsWith("Abandono") || estado?.startsWith("Taponamiento")) return "#dc2626";
  return "#94a3b8";
}

const TENDENCIA_COLOR = { CRECIENDO: "#059669", ESTABLE: "#64748b", DECLINANDO: "#d97706", CRITICO: "#dc2626" };
// Pozo sin producción actual: la tendencia no tiene sentido, se omite.
const ESTADOS_SIN_TENDENCIA = ["Cerrado", "Inactivo", "Abandono permanente", "Abandono temporal"];

function KpiRow({ title, subtitle, kpis, numPozos, periodoNota, onExport, exportando }) {
  const items = kpis.filter(k => k.valor);
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 shadow-sm bg-white p-3 mb-3">
      <div className="flex items-baseline justify-between mb-1 px-1">
        <div>
          <span className="text-[12.5px] font-bold text-slate-700">{title}</span>
          {subtitle && <span className="text-[11px] text-slate-400 ml-1.5">{subtitle}</span>}
        </div>
        <div className="flex items-center gap-3">
          {numPozos != null && (
            <span className="text-[11px] text-slate-400">{numPozos} pozo{numPozos === 1 ? "" : "s"} activo{numPozos === 1 ? "" : "s"}</span>
          )}
          {onExport && (
            <button
              onClick={onExport}
              disabled={exportando}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white bg-tih-dark hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {exportando ? "Exportando…" : "Exportar Excel"}
            </button>
          )}
        </div>
      </div>
      {periodoNota && (
        <p className="text-[10.5px] text-slate-400 px-1 mb-2">
          Datos de <span className="font-semibold text-slate-500">{periodoNota}</span> — el último periodo dentro del rango seleccionado arriba, no un promedio del rango completo.
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {items.map(k => {
          const color = kpiIconColor(k.label);
          return (
            <div key={k.label} className="rounded-xl px-4 py-3.5 flex flex-col gap-2 bg-white border border-slate-200 shadow-sm">
              <div className="flex items-center gap-1.5 text-slate-400">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-[10px] font-semibold uppercase tracking-wider leading-tight">
                  {k.label}
                </span>
              </div>
              <p className="text-slate-800 text-lg font-bold leading-tight truncate">
                {k.valor.toLocaleString("es-MX", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// El refresco del caché es automático (pozos_cache.maybe_auto_refresh, al
// arrancar el backend); este banner solo avisa mientras está corriendo.
function CacheBanner({ status }) {
  if (status?.status !== "sincronizando") return null;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 mb-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-500">
      <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
      Actualizando datos de pozos en segundo plano — las consultas pueden tardar un poco más por ahora.
    </div>
  );
}

export default function PozosExplorer() {
  const { period, start_year, end_year, start_month, end_month, pendingPozoSelection, setPendingPozoSelection } = useExplorer();
  const [arbol, setArbol] = useState(null);
  const [openCuencas, setOpenCuencas] = useState(new Set());
  const [openCampos, setOpenCampos] = useState(new Set());
  const [selectedCuenca, setSelectedCuenca] = useState(null);
  const [selectedCampo, setSelectedCampo] = useState(null);
  const [selected, setSelected] = useState(null); // { campo, pozo }
  const [verDesgloseTendencia, setVerDesgloseTendencia] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [loadingDetalle, setLoadingDetalle] = useState(false);
  const [resumen, setResumen] = useState(null);
  const [loadingResumen, setLoadingResumen] = useState(false);
  const [search, setSearch] = useState("");

  const [analisis, setAnalisis] = useState(null);
  const [ranking, setRanking] = useState(null);
  // Qué serie grafica la tendencia si el pozo produce ambos (líquidos y gas);
  // "auto" sigue el criterio del backend (analisis.unidad).
  const [chartMetric, setChartMetric] = useState("auto");

  const [cacheStatus, setCacheStatus] = useState(null);
  const pollRef = useRef(null);
  const trendChartRef = useRef(null);
  const [exportando, setExportando] = useState(false);

  const [modoComparar, setModoComparar] = useState(false);
  const [seleccionadosComparar, setSeleccionadosComparar] = useState([]);

  const [filtrosActivos, setFiltrosActivos] = useState(null);
  const [filtrados, setFiltrados] = useState(null);
  const [loadingFiltrados, setLoadingFiltrados] = useState(false);

  // El backend dispara el refresco solo si hace falta; aquí solo se consulta
  // el estado, y si está corriendo se sigue consultando cada pocos segundos
  // hasta que termine.
  useEffect(() => {
    fetchProduccionPozosArbol().then(d => setArbol(d.tree ?? [])).catch(() => setArbol([]));
    fetchPozosCacheStatus().then(st => {
      setCacheStatus(st);
      if (st.status === "sincronizando") {
        pollRef.current = setInterval(() => {
          fetchPozosCacheStatus().then(s2 => {
            setCacheStatus(s2);
            if (s2.status !== "sincronizando") clearInterval(pollRef.current);
          });
        }, 3000);
      }
    }).catch(() => {});
    return () => clearInterval(pollRef.current);
  }, []);

  useEffect(() => { setChartMetric("auto"); }, [selected]);

  // Selección de pozo llegada desde otro tema (panel de detalle de
  // Asignaciones) — se consume una sola vez y se limpia del store.
  useEffect(() => {
    if (!pendingPozoSelection) return;
    setSelected({ campo: pendingPozoSelection.campo, pozo: pendingPozoSelection.pozo });
    setModoComparar(false);
    setPendingPozoSelection(null);
  }, [pendingPozoSelection, setPendingPozoSelection]);

  useEffect(() => {
    // Pozo perforado pero que aún no reporta producción (llegó sin "campo"
    // desde el panel de Perforación) — no hay nada que consultar.
    if (!selected || !selected.campo) { setDetalle(null); setAnalisis(null); return; }
    setLoadingDetalle(true);
    let vigente = true;
    fetchProduccionPozoDetalle({
      campo: selected.campo, pozo: selected.pozo,
      period, start_year, end_year, start_month, end_month,
    }).then(d => { if (vigente) setDetalle(d); }).finally(() => { if (vigente) setLoadingDetalle(false); });
    fetchPozoAnalisis({ campo: selected.campo, pozo: selected.pozo, metrica: chartMetric }).then(d => { if (vigente) setAnalisis(d); }).catch(() => { if (vigente) setAnalisis(null); });
    return () => { vigente = false; };
  }, [selected, period, start_year, end_year, start_month, end_month, chartMetric]);

  useEffect(() => {
    if (selected || (!selectedCampo && !selectedCuenca)) { setResumen(null); setRanking(null); return; }
    setLoadingResumen(true);
    const params = {
      cuenca: selectedCampo ? "" : selectedCuenca ?? "",
      campo: selectedCampo ?? "",
      period, start_year, end_year, start_month, end_month,
    };
    // Evita que una respuesta lenta llegue después y pise el resultado de una
    // selección más reciente.
    let vigente = true;
    fetchProduccionPozosResumen(params).then(d => { if (vigente) setResumen(d); }).finally(() => { if (vigente) setLoadingResumen(false); });
    fetchPozosRanking(params).then(d => { if (vigente) setRanking(d); }).catch(() => { if (vigente) setRanking(null); });
    return () => { vigente = false; };
  }, [selected, selectedCampo, selectedCuenca, period, start_year, end_year, start_month, end_month]);

  function aplicarFiltros(filtros) {
    setFiltrosActivos(filtros);
    setLoadingFiltrados(true);
    fetchPozosFiltrados({ period, start_year, end_year, start_month, end_month, tam_pagina: 200, ...filtros })
      .then(setFiltrados)
      .finally(() => setLoadingFiltrados(false));
  }
  function limpiarFiltros() {
    setFiltrosActivos(null);
    setFiltrados(null);
  }

  function elegirPozo(campo, pozo) {
    if (modoComparar) {
      setSeleccionadosComparar(prev => {
        const existe = prev.some(s => s.campo === campo && s.pozo === pozo);
        if (existe) return prev.filter(s => !(s.campo === campo && s.pozo === pozo));
        if (prev.length >= 4) return prev;
        return [...prev, { campo, pozo }];
      });
    } else {
      setSelected({ campo, pozo });
    }
  }

  function quitarDeComparar(pozo) {
    setSeleccionadosComparar(prev => prev.filter(s => s.pozo !== pozo));
  }

  const q = search.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const filteredTree = useMemo(() => {
    if (!arbol) return [];
    if (!q) return arbol;
    return arbol
      .map(c => ({
        ...c,
        campos: c.campos
          .map(cm => ({ ...cm, pozos: cm.pozos.filter(p => p.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(q)) }))
          .filter(cm => cm.pozos.length > 0 || cm.campo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(q)),
      }))
      .filter(c => c.campos.length > 0 || c.cuenca.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(q));
  }, [arbol, q]);

  if (!arbol) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner message="Cargando árbol de pozos…" />
      </div>
    );
  }

  const visibleRows = detalle?.rows?.filter(r => r.data.some(v => v)) ?? [];
  const liquidosRow = detalle?.rows?.find(r => /líquidos/i.test(r.label));
  const gasRow = detalle?.rows?.find(r => r.label === "Gas (MMpcd)");
  const tieneLiquidos = liquidosRow?.data.some(v => v) ?? false;
  const tieneGas = gasRow?.data.some(v => v) ?? false;
  // Pozos de gas seco (líquidos en 0 todo el histórico) usan la fila de Gas
  // para la tendencia por defecto, si no la gráfica sale vacía (mismo criterio
  // que get_pozo_analisis en el backend). Pozos con ambos productos muestran
  // un switch para elegir.
  const tendenciaEsGas = analisis?.unidad === "MMpcd";
  const tendenciaRow = tendenciaEsGas ? gasRow : liquidosRow;

  let kpiBlock = null;
  if (selected && detalle?.categories?.length) {
    const lastIdx = detalle.categories.length - 1;
    kpiBlock = {
      title: selected.pozo, subtitle: selected.campo, numPozos: null,
      periodoNota: detalle.categories[lastIdx],
      kpis: detalle.rows.map(r => ({ label: r.label, valor: r.data[lastIdx] ?? 0 })),
    };
  } else if ((selectedCampo || selectedCuenca) && resumen?.kpis?.length) {
    kpiBlock = {
      title: selectedCampo ?? selectedCuenca,
      subtitle: null,
      numPozos: resumen.num_pozos,
      periodoNota: resumen.periodo,
      kpis: resumen.kpis,
    };
  }

  // Del ranking de un campo se puede volver al ranking/resumen de su cuenca;
  // el de una cuenca (nivel más alto del árbol) no tiene a dónde volver.
  const volverACuenca = selectedCampo ? () => setSelectedCampo(null) : null;

  const listaPozos = filtrosActivos ? (filtrados?.pozos ?? []) : null;

  // Exporta exactamente lo que se está viendo: tabla mensual + gráfica de
  // tendencia a nivel pozo, o el resumen + ranking completo a nivel campo/cuenca.
  async function handleExport() {
    if (!kpiBlock) return;
    setExportando(true);
    try {
      const { exportarProduccionExcel } = await import("../../utils/exportExcel");
      if (selected && detalle?.categories?.length) {
        const chartImageBase64 = trendChartRef.current?.getImage() ?? null;
        await exportarProduccionExcel({
          titulo: selected.pozo,
          subtitulo: selected.campo,
          periodoNota: `Rango: ${detalle.categories[0]} – ${detalle.categories[detalle.categories.length - 1]}`,
          tabla: {
            columnas: detalle.categories,
            filas: visibleRows.map(r => ({ label: r.label, valores: r.data })),
          },
          chartImageBase64,
          chartTitulo: tendenciaRow
            ? `Producción observada (${tendenciaEsGas ? "gas" : "líquidos"}, ${tendenciaEsGas ? "MMpcd" : "Mbd"})`
            : null,
        });
      } else {
        const unidadRanking = ranking?.unidad ?? "Mbd";
        await exportarProduccionExcel({
          titulo: kpiBlock.title,
          subtitulo: selectedCampo ? `Cuenca: ${selectedCuenca}` : null,
          periodoNota: kpiBlock.periodoNota ? `Datos de ${kpiBlock.periodoNota}` : null,
          tabla: {
            columnas: ["Valor"],
            filas: kpiBlock.kpis.map(k => ({ label: k.label, valores: [k.valor] })),
          },
          tituloTablaSecundaria: "Ranking de pozos",
          tablaSecundaria: ranking?.pozos?.length ? {
            columnas: ["#", "Pozo", unidadRanking, "Tendencia", "Estado"],
            filas: ranking.pozos.map(p => [p.ranking, p.pozo, p.produccion_mbd, p.tendencia ?? "—", p.estado_operativo ?? "—"]),
          } : null,
        });
      }
    } finally {
      setExportando(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <CacheBanner status={cacheStatus} />

      {!modoComparar && (loadingResumen || kpiBlock) && (
        loadingResumen ? (
          <div className="rounded-xl border border-slate-200 shadow-sm bg-white p-4 mb-3 flex items-center gap-2">
            <LoadingSpinner message="Calculando resumen…" />
          </div>
        ) : (
          <KpiRow title={kpiBlock.title} subtitle={kpiBlock.subtitle} kpis={kpiBlock.kpis} numPozos={kpiBlock.numPozos} periodoNota={kpiBlock.periodoNota} onExport={handleExport} exportando={exportando} />
        )
      )}
      {!modoComparar && !loadingResumen && !kpiBlock && !selected && (
        <p className="text-[11px] text-slate-400 px-1 mb-2">Selecciona una cuenca, campo o pozo para ver el resumen de producción.</p>
      )}

      <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0 }}>
        <div className="rounded-xl border border-slate-200 shadow-sm bg-white flex flex-col" style={{ width: 320, flexShrink: 0 }}>
          <div className="p-2 border-b border-slate-100 space-y-1.5">
            <input
              className="w-full px-3 py-1.5 text-[13px] text-slate-700 placeholder:text-slate-400 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-400"
              placeholder="Buscar Campo"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <label className="flex items-center gap-1.5 text-[11px] text-slate-500 px-1 cursor-pointer">
              <input type="checkbox" checked={modoComparar} onChange={e => { setModoComparar(e.target.checked); setSeleccionadosComparar([]); }} />
              Modo comparar (2-4 pozos)
            </label>
          </div>

          <PozosFiltrosPanel onAplicar={aplicarFiltros} onLimpiar={limpiarFiltros} activo={!!filtrosActivos} />

          <div className="overflow-y-auto flex-1 py-1">
            {filtrosActivos ? (
              loadingFiltrados ? (
                <div className="flex justify-center py-6"><LoadingSpinner message="Filtrando…" /></div>
              ) : (
                <>
                  <p className="text-[10.5px] text-slate-400 px-3 py-1">
                    {filtrados?.total ?? 0} pozos {filtrados?.total > (listaPozos?.length ?? 0) ? `(mostrando ${listaPozos.length})` : ""}
                  </p>
                  {(listaPozos ?? []).map(p => {
                    const isSel = modoComparar
                      ? seleccionadosComparar.some(s => s.campo === p.campo && s.pozo === p.pozo)
                      : selected?.campo === p.campo && selected?.pozo === p.pozo;
                    return (
                      <button
                        key={`${p.campo}-${p.pozo}`}
                        onClick={() => elegirPozo(p.campo, p.pozo)}
                        className={`w-full text-left px-3 py-1.5 text-[12px] border-b border-slate-50 hover:bg-slate-50 flex items-center justify-between ${
                          isSel ? "bg-teal-100 text-teal-800 font-semibold" : "text-slate-600"
                        }`}
                      >
                        <span className="truncate">{p.pozo}</span>
                        <span className="text-[10px] text-slate-400 ml-1 shrink-0">{p.produccion_mbd} Mbd</span>
                      </button>
                    );
                  })}
                  {listaPozos?.length === 0 && <p className="text-[12px] text-slate-400 text-center py-6">Sin resultados.</p>}
                </>
              )
            ) : (
              <>
                {filteredTree.map(c => {
                  const cuencaOpen = q ? true : openCuencas.has(c.cuenca);
                  return (
                    <div key={c.cuenca}>
                      <button
                        onClick={() => { toggle(openCuencas, setOpenCuencas, c.cuenca); setSelectedCuenca(c.cuenca); setSelectedCampo(null); setSelected(null); }}
                        className={`w-full text-left px-3 py-1.5 text-[12.5px] font-bold text-white uppercase tracking-wide ${selectedCuenca === c.cuenca && !selectedCampo ? "ring-2 ring-inset ring-teal-300" : ""}`}
                        style={{ background: "linear-gradient(90deg,#10312B,#1a4a3a)" }}
                      >
                        {cuencaOpen ? "− " : "+ "}{c.cuenca}
                      </button>
                      {cuencaOpen && c.campos.map(cm => {
                        const campoOpen = q ? true : openCampos.has(cm.campo);
                        return (
                          <div key={cm.campo}>
                            <button
                              onClick={() => { toggle(openCampos, setOpenCampos, cm.campo); setSelectedCampo(cm.campo); setSelectedCuenca(c.cuenca); setSelected(null); }}
                              className={`w-full text-left pl-5 pr-3 py-1 text-[12px] font-semibold text-teal-700 bg-teal-50/60 hover:bg-teal-50 border-b border-slate-100 ${selectedCampo === cm.campo ? "!bg-teal-100" : ""}`}
                            >
                              {campoOpen ? "− " : "+ "}{cm.campo}
                            </button>
                            {campoOpen && cm.pozos.map(p => {
                              const isSel = modoComparar
                                ? seleccionadosComparar.some(s => s.campo === cm.campo && s.pozo === p)
                                : selected?.campo === cm.campo && selected?.pozo === p;
                              return (
                                <button
                                  key={p}
                                  onClick={() => elegirPozo(cm.campo, p)}
                                  className={`w-full text-left pl-9 pr-3 py-1 text-[12px] border-b border-slate-50 hover:bg-slate-50 flex items-center gap-1.5 ${
                                    isSel ? "bg-teal-100 text-teal-800 font-semibold" : "text-slate-600"
                                  }`}
                                >
                                  {modoComparar && <input type="checkbox" checked={isSel} readOnly className="pointer-events-none" />}
                                  {p}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {filteredTree.length === 0 && (
                  <p className="text-[12px] text-slate-400 text-center py-6">Sin resultados.</p>
                )}
              </>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 shadow-sm bg-white flex-1 overflow-auto" style={{ minWidth: 0 }}>
          {modoComparar ? (
            <PozosComparar seleccionados={seleccionadosComparar} onQuitar={quitarDeComparar} period={period} start_year={start_year} end_year={end_year} start_month={start_month} end_month={end_month} />
          ) : !selected ? (
            (selectedCampo || selectedCuenca) ? (
              loadingResumen && !ranking?.pozos?.length ? (
                <div className="flex items-center justify-center h-64">
                  <LoadingBar message="Calculando ranking de pozos…" />
                </div>
              ) : (
                <div className="p-3">
                  <PozoRankingCard ranking={ranking} campo={selectedCampo} onSelectPozo={(pozo, campoPozo) => elegirPozo(selectedCampo || campoPozo || "", pozo)} onClose={volverACuenca} />
                </div>
              )
            ) : (
              <p className="text-sm text-slate-400 text-center py-16">Selecciona un pozo del árbol para ver su producción.</p>
            )
          ) : !selected.campo ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 py-6">
              <p className="text-[13px] font-bold uppercase tracking-wide text-slate-600">{selected.pozo}</p>
              <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold text-white bg-slate-400 mt-1">Pozo sin producción registrada</span>
              {/* "?v=" fuerza a descargar de nuevo si el archivo cambia — sin
                  esto el navegador puede seguir sirviendo una versión vieja
                  del video desde caché para esta misma URL. Súbele el
                  número cada vez que se reemplace pozo-sin-produccion.mp4. */}
              <VideoSinFondo src="/pozo-sin-produccion.mp4?v=3" className="w-full max-w-xs mt-1" />
            </div>
          ) : loadingDetalle ? (
            <div className="flex items-center justify-center h-64">
              <LoadingSpinner message="Consultando pozo…" />
            </div>
          ) : detalle && (
            <>
              <div style={{ background: "linear-gradient(90deg,#10312B,#1a4a3a)" }} className="px-4 py-3 text-white flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-[13px] font-bold uppercase tracking-wide">{selected.pozo}</p>
                  <p className="text-[11px] text-teal-200">
                    {selected.campo}
                    {analisis?.fecha_perforacion && (
                      <> · Perforado el {new Date(analisis.fecha_perforacion).toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })}</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {analisis?.disponible && (
                    <>
                      {analisis.estado_operativo && (
                        <span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold text-white" style={{ background: estadoColor(analisis.estado_operativo) }}>
                          {analisis.estado_operativo}
                        </span>
                      )}
                      {analisis.tendencia && analisis.tendencia !== "SIN_DATOS" && !ESTADOS_SIN_TENDENCIA.includes(analisis.estado_operativo) && (
                        <span className="inline-flex items-center gap-1">
                          <span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold text-white" style={{ background: TENDENCIA_COLOR[analisis.tendencia] ?? "#94a3b8" }}>
                            {analisis.tendencia}
                          </span>
                          <button
                            type="button"
                            title="Ver cómo se calculó"
                            onClick={() => setVerDesgloseTendencia(true)}
                            className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white/70 border border-white/40 hover:text-white hover:border-white hover:bg-white/15 shrink-0"
                          >
                            i
                          </button>
                        </span>
                      )}
                      {verDesgloseTendencia && (
                        <TendenciaDesgloseModal campo={selected.campo} pozo={selected.pozo} onClose={() => setVerDesgloseTendencia(false)} />
                      )}
                    </>
                  )}
                  <button
                    onClick={() => setSelected(null)}
                    title="Volver al resumen"
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/15 transition-colors"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="p-3">
                {analisis?.alerta && (
                  <div
                    className="rounded-lg px-3 py-2 mb-3 text-[11.5px] font-medium"
                    style={{
                      background: analisis.alerta.nivel === "CRITICA" ? "#fef2f2" : "#fffbeb",
                      color: analisis.alerta.nivel === "CRITICA" ? "#991b1b" : "#92400e",
                      border: `1px solid ${analisis.alerta.nivel === "CRITICA" ? "#fecaca" : "#fde68a"}`,
                    }}
                  >
                    ⚠ {analisis.alerta.mensaje}
                  </div>
                )}

                {visibleRows.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-16">Sin datos de producción en el rango seleccionado.</p>
                ) : (
                  <div className="rounded-xl border border-slate-200 overflow-auto mb-3 shadow-sm">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr style={{ background: "linear-gradient(90deg,#10312B,#1a4a3a)" }}>
                          <th className="text-left px-4 py-2 text-[11px] font-bold text-white/90 uppercase tracking-wide sticky left-0" style={{ background: "#10312B" }}>Producto</th>
                          {detalle.categories.map(c => (
                            <th key={c} className="text-center px-3 py-2 text-[11px] font-bold text-white/80 whitespace-nowrap">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map((r, ri) => {
                          const color = kpiIconColor(r.label);
                          const valores = r.data.filter(v => v);
                          const max = Math.max(...valores, 0.0001);
                          const min = Math.min(...valores, max);
                          return (
                            <tr key={r.label} className={ri % 2 ? "bg-slate-50/60" : "bg-white"}>
                              <td
                                className="px-4 py-2 text-[12.5px] font-semibold sticky left-0 whitespace-nowrap"
                                style={{ background: ri % 2 ? "#f8fafc" : "#fff", borderLeft: `3px solid ${color}`, color: "#334155" }}
                              >
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                                  {r.label}
                                </span>
                              </td>
                              {r.data.map((v, i) => {
                                // Intensidad tipo "heatmap" relativa al rango de la propia fila —
                                // permite ubicar de un vistazo los meses altos/bajos de cada producto.
                                const intensidad = v ? 0.08 + 0.34 * ((v - min) / Math.max(max - min, 0.0001)) : 0;
                                return (
                                  <td
                                    key={i}
                                    className="text-center px-3 py-2 text-[12.5px] font-medium tabular-nums whitespace-nowrap"
                                    style={{ background: v ? `${color}${Math.round(intensidad * 255).toString(16).padStart(2, "0")}` : "transparent", color: v ? "#1e293b" : "#cbd5e1" }}
                                  >
                                    {v === 0 ? "—" : v.toLocaleString("es-MX", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {tendenciaRow && (
                  <PozoTrendChart
                    ref={trendChartRef}
                    categories={detalle.categories}
                    data={tendenciaRow.data}
                    unidad={tendenciaEsGas ? "MMpcd" : "Mbd"}
                    analisis={analisis}
                    metricSwitch={tieneLiquidos && tieneGas ? {
                      value: tendenciaEsGas ? "gas" : "liquidos",
                      onChange: setChartMetric,
                    } : null}
                  />
                )}

                <PozoProyeccion analisis={analisis} />
              </div>
            </>
          )}
        </div>
      </div>

      {filtrosActivos && (
        <a
          href={exportarPozosCsvUrl({ period, start_year, end_year, start_month, end_month, ...filtrosActivos })}
          className="text-[11px] text-teal-700 hover:underline self-end mt-2"
        >
          Exportar resultados filtrados (CSV)
        </a>
      )}
    </div>
  );
}
