import { useEffect, useState } from "react";
import ReactECharts from "echarts-for-react";
import { fetchResumen } from "../../api/client";
import ExportPDFTIH from "../ExportPDFTIH/ExportPDFTIH";
import "../ExportPDFTIH/ExportPDFTIH.css";
import { useExplorerNav } from "../../hooks/useExplorerNav";
import { nombreCampoDisplay } from "../../utils/nombreCampo";
import { fmt2 } from "../../utils/formato";
import { useAbrirFicha } from "../Fichas/FichaContext";

// Cada mini-sección vive en su propia card blanca con borde/sombra sutil,
// con tamaños compactos para que todo el Panorama general quepa sin scroll.
const INK      = "#1f2430";
const MUTED    = "#767b87";
const BORDER   = "#e7e5e0";
const ORANGE   = "#c2661a";

function Card({ children, style, ...rest }) {
  return (
    <div
      className="rounded-xl min-w-0 dash-card"
      style={{ background: "#fff", border: `1px solid ${BORDER}`, padding: 26, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}

function UnidadesNota({ style, texto = "* Mbd: miles de barriles diarios · MMpcd: millones de pies cúbicos diarios" }) {
  return (
    <p
      className="text-[10px] leading-tight"
      style={{ color: MUTED, marginTop: 8, ...style }}
      title={texto}
    >
      {texto}
    </p>
  );
}

function Chip({ children, color, bg }) {
  return (
    <span
      className="text-[10.5px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 mr-2"
      style={{ color, background: bg }}
    >
      {children}
    </span>
  );
}

function CardTitle({ children, chip, chipColor, chipBg, right }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
      <span className="text-[13.5px] font-bold uppercase tracking-wide flex items-center" style={{ color: INK }}>
        {chip && <Chip color={chipColor} bg={chipBg}>{chip}</Chip>}
        {children}
      </span>
      {right}
    </div>
  );
}

function FuelToggle({ fuel, setFuel }) {
  return (
    <div className="flex rounded-full p-0.5" style={{ background: "#f0f1ed" }}>
      {[["liquidos", "Líquidos"], ["gas", "Gas"]].map(([id, label]) => (
        <button
          key={id}
          onClick={() => setFuel(id)}
          className="px-3.5 py-1 rounded-full text-[13px] font-medium transition-colors"
          style={fuel === id ? { background: "#fff", color: INK, boxShadow: "0 1px 2px rgba(0,0,0,0.08)" } : { color: MUTED }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function BigStat({ label, valor, unidad, promedio, anioPromedio, color, bg }) {
  if (valor == null) return null;
  const cambio = promedio ? Math.round(((valor - promedio) / promedio) * 1000) / 10 : null;
  const up = cambio > 0;
  return (
    <div className="flex-1 min-w-0 text-center flex flex-col justify-center" style={{ background: bg, padding: "4px 20px" }}>
      <span className="text-[13px]" style={{ color: INK }}>{label} · {unidad}</span>
      <span style={{ fontFamily: "'Patria', Georgia, serif", color, fontSize: 33, fontWeight: 700, lineHeight: 1.15, marginTop: 3, textShadow: `0 0 18px ${color}33` }}>
        {fmt2(valor)}
      </span>
      {cambio != null && (
        <p className="text-[13px] font-semibold mt-0.5" style={{ color: up ? "#059669" : ORANGE }}>
          {up ? "↑" : "↓"} {Math.abs(cambio)}%{" "}
          <span className="font-normal" style={{ color: MUTED }}>
            vs {fmt2(promedio)} promedio {anioPromedio}
          </span>
        </p>
      )}
    </div>
  );
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function periodoLabelDe(periodo) {
  const [anio, mes] = (periodo ?? "").split("-");
  return mes ? `${MESES[parseInt(mes, 10) - 1]} ${anio}` : "";
}

function fechaLabelDe(fechaIso) {
  const [anio, mes, dia] = (fechaIso ?? "").split("-");
  return mes ? `${parseInt(dia, 10)} de ${MESES[parseInt(mes, 10) - 1]} ${anio}` : "";
}

function CifrasNacionales({ nacional }) {
  if (!nacional?.liquidos && !nacional?.gas) return null;
  return (
    <div className="rounded-xl min-w-0 overflow-hidden flex flex-col dash-card" style={{ background: "#fff", border: `1px solid ${BORDER}`, height: "100%" }}>
      <div style={{ padding: "10px 26px 4px" }}>
        <CardTitle>Producción mensual</CardTitle>
      </div>
      <div className="flex items-stretch flex-wrap flex-none" style={{ height: 126 }}>
        <BigStat
          label="Hidrocarburos líquidos" unidad="Mbd"
          valor={nacional.liquidos?.valor} promedio={nacional.liquidos?.promedio}
          anioPromedio={nacional.liquidos?.anio_promedio} color="#0d7a4a" bg="#daf0df"
        />
        <BigStat
          label="Gas natural" unidad="MMpcd"
          valor={nacional.gas?.valor} promedio={nacional.gas?.promedio}
          anioPromedio={nacional.gas?.anio_promedio} color="#1d6fa5" bg="#dbeafb"
        />
      </div>
      <div style={{ padding: "4px 26px 0" }}>
        <UnidadesNota style={{ marginTop: 0 }} />
        <p className="text-[10px]" style={{ color: MUTED, marginTop: 2 }}>
          * Hidrocarburos líquidos: se refiere a la suma de petróleo y condensado.
        </p>
      </div>
    </div>
  );
}

function IndicadorEconomico({ label, valor, fecha, anterior, color, bg, unidad = "USD/barril" }) {
  if (valor == null) return null;
  const cambio = anterior ? Math.round(((valor - anterior) / anterior) * 1000) / 10 : null;
  const subiendo = cambio > 0;
  const bajando = cambio < 0;
  return (
    <div className="flex-1 min-w-0 text-center flex flex-col justify-center" style={{ background: bg, padding: "4px 20px" }}>
      <span className="text-[13px] block" style={{ color: INK }}>{label} · {unidad}</span>
      <span style={{ fontFamily: "'Patria', Georgia, serif", color, fontSize: 33, fontWeight: 700, lineHeight: 1.15, marginTop: 3, display: "block", textShadow: `0 0 18px ${color}33` }}>
        ${fmt2(valor)}
      </span>
      {cambio != null && (
        <p className="text-[13px] font-semibold" style={{ color: subiendo ? "#059669" : bajando ? ORANGE : MUTED }}>
          {subiendo ? "↑" : bajando ? "↓" : "→"} {Math.abs(cambio)}%{" "}
          <span className="font-normal" style={{ color: MUTED }}>vs cierre anterior</span>
        </p>
      )}
      {fecha && <p className="text-[12px]" style={{ color: MUTED }}>{fechaLabelDe(fecha)}</p>}
    </div>
  );
}

function IndicadoresEconomicos({ indicadores }) {
  if (!indicadores?.brent && !indicadores?.mezcla_mexicana && !indicadores?.henry_hub) return null;
  return (
    <div className="rounded-xl min-w-0 overflow-hidden flex flex-col dash-card" style={{ background: "#fff", border: `1px solid ${BORDER}` }}>
      <div style={{ padding: "10px 26px 4px" }}>
        <CardTitle>Precios de referencia</CardTitle>
      </div>
      <div className="flex items-stretch flex-wrap flex-none" style={{ height: 126 }}>
        <IndicadorEconomico
          label="Henry Hub" unidad="USD/MMBtu"
          valor={indicadores.henry_hub?.valor} fecha={indicadores.henry_hub?.fecha}
          anterior={indicadores.henry_hub?.anterior}
          color="#1d6fa5" bg="#dbeafb"
        />
        <IndicadorEconomico
          label="Brent" valor={indicadores.brent?.valor} fecha={indicadores.brent?.fecha}
          anterior={indicadores.brent?.anterior}
          color="#8a2c17" bg="#fbe3d8"
        />
        <IndicadorEconomico
          label="Mezcla Mexicana de Exportación" valor={indicadores.mezcla_mexicana?.valor} fecha={indicadores.mezcla_mexicana?.fecha}
          anterior={indicadores.mezcla_mexicana?.anterior}
          color="#0d7a4a" bg="#daf0df"
        />
      </div>
      <p className="text-[10px] truncate" style={{ color: MUTED, padding: "4px 26px" }} title="Precios de referencia tomados de la tabla de precios de la base de datos, sujetos a variación. Cada indicador muestra su último dato disponible.">
        * Precios de referencia, sujetos a variación · último dato disponible de cada indicador
      </p>
    </div>
  );
}

// Verde institucional graduado por rango (1er lugar más oscuro → 8vo más claro).
const RANK_SHADES = [
  "#0a5c38", "#0d7a4a", "#159260", "#2aa374",
  "#4bb389", "#71c29e", "#9ad4b8", "#c3e5d2",
];
const RANK_SHADES_GAS = [
  "#0c4a6e", "#1d6fa5", "#2b86c0", "#4499cc",
  "#66aed8", "#8cc4e3", "#b3d9ee", "#d6ecf7",
];

function Barrel({ color, empty, size = 18 }) {
  const body = empty ? "#fff" : color;
  const stroke = empty ? "#c7c9c3" : "#1f2430";
  const shade = empty ? "#f0f0ec" : "#00000022";
  return (
    <svg viewBox="0 0 20 24" width={size} height={size * 1.2}>
      <path d="M4 4 C4 6 16 6 16 4 L16 20 C16 22 4 22 4 20 Z" fill={body} stroke={stroke} strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M4 20 C4 22 16 22 16 20" fill={shade} stroke={stroke} strokeWidth="1.1" />
      <line x1="4.2" y1="9.3" x2="15.8" y2="9.3" stroke={stroke} strokeWidth="0.9" opacity="0.5" />
      <line x1="4.2" y1="14.7" x2="15.8" y2="14.7" stroke={stroke} strokeWidth="0.9" opacity="0.5" />
      <ellipse cx="10" cy="4" rx="6" ry="1.9" fill={empty ? "#fff" : color} stroke={stroke} strokeWidth="1.1" />
      {!empty && <ellipse cx="10" cy="4" rx="6" ry="1.9" fill="#fff" opacity="0.18" />}
    </svg>
  );
}

// Barril con relleno parcial: fraction 0–1 recorta horizontalmente el barril
// de color sobre el gris de fondo, indicador visual entre el nombre y la cifra.
function BarrelPartial({ fraction, color, size = 18 }) {
  return (
    <span style={{ position: "relative", width: size, height: size, display: "inline-block" }}>
      <Barrel empty size={size} />
      {fraction > 0 && (
        <span style={{ position: "absolute", inset: 0, overflow: "hidden", width: `${Math.min(fraction, 1) * 100}%` }}>
          <Barrel color={color} size={size} />
        </span>
      )}
    </span>
  );
}

// Adapta `data` (el mismo JSON de /resumen que pinta el Panorama general) a
// la forma plana que espera <ExportPDFTIH> (components/ExportPDFTIH) —
// reemplazo del export nativo anterior, pedido explícito del usuario.
function pct(valor, base) {
  if (valor == null || !base) return null;
  return Math.round(((valor - base) / base) * 1000) / 10;
}
function fmtPct(p) {
  return p == null ? null : `${Math.abs(p)}%`;
}
function buscarValor(arr, nombre) {
  return arr?.find(x => x.nombre === nombre)?.valor;
}

function buildExportPDFData(data) {
  const n = data?.nacional;
  const ind = data?.indicadores_economicos;
  const tc = data?.top_campos;
  const r1p = data?.top5_reservas?.["1P"];
  const po = data?.por_operador;
  const p = data?.pozos_operando;

  return {
    // Etiqueta de periodo real de los datos (la misma que muestra el
    // encabezado en pantalla), no la fecha de hoy.
    periodoLabel: periodoLabelDe(n?.periodo),
    periodoPozosLabel: periodoLabelDe(p?.periodo),
    produccion: {
      liquidos: n?.liquidos?.valor,
      liquidosCambio: fmtPct(pct(n?.liquidos?.valor, n?.liquidos?.promedio)),
      liquidosPromedio: n?.liquidos?.promedio,
      liquidosAnioPromedio: n?.liquidos?.anio_promedio,
      gas: n?.gas?.valor,
      gasCambio: fmtPct(pct(n?.gas?.valor, n?.gas?.promedio)),
      gasPromedio: n?.gas?.promedio,
      gasAnioPromedio: n?.gas?.anio_promedio,
    },
    mercado: {
      henryHub: ind?.henry_hub?.valor,
      henryHubAnterior: ind?.henry_hub?.anterior,
      brent: ind?.brent?.valor,
      brentAnterior: ind?.brent?.anterior,
      brentCambio: fmtPct(pct(ind?.brent?.valor, ind?.brent?.anterior)),
      mezcla: ind?.mezcla_mexicana?.valor,
      mezclaAnterior: ind?.mezcla_mexicana?.anterior,
      mezclaCambio: fmtPct(pct(ind?.mezcla_mexicana?.valor, ind?.mezcla_mexicana?.anterior)),
    },
    campos: {
      liquidos: tc?.liquidos ?? [],
      gas: tc?.gas ?? [],
    },
    reservas: {
      aceite: r1p?.aceite ?? [],
      gas: r1p?.gas ?? [],
    },
    operador: {
      liquidosPemexPorcentaje: po?.liquidos?.pemex_pct,
      liquidosPemex: po?.liquidos?.pemex_total,
      pemexAsignacionesLiq: buscarValor(po?.liquidos?.pemex_contratos, "Asignaciones"),
      pemexMigracionesLiq: buscarValor(po?.liquidos?.pemex_contratos, "Migraciones"),
      privadosRondasLiq: buscarValor(po?.liquidos?.otros_contratos, "Rondas"),
      privadosMigracionesLiq: buscarValor(po?.liquidos?.otros_contratos, "Migraciones"),
      gasPemexPorcentaje: po?.gas?.pemex_pct,
      gasPemex: po?.gas?.pemex_total,
      pemexAsignacionesGas: buscarValor(po?.gas?.pemex_contratos, "Asignaciones"),
      pemexMigracionesGas: buscarValor(po?.gas?.pemex_contratos, "Migraciones"),
      privadosRondasGas: buscarValor(po?.gas?.otros_contratos, "Rondas"),
      privadosMigracionesGas: buscarValor(po?.gas?.otros_contratos, "Migraciones"),
    },
    pozos: {
      total: p?.total,
      asociado: p?.pozos_aceite,
      asociadoPorcentaje: p?.pct_aceite != null ? `${p.pct_aceite}%` : null,
      noAsociado: p?.pozos_gas,
      noAsociadoPorcentaje: p?.pct_gas != null ? `${p.pct_gas}%` : null,
    },
  };
}

// Fila de un ranking (campos o reservas): nombre + valor en una línea y una
// BARRA horizontal proporcional debajo. Antes eran "barrilitos" diminutos que
// se veían perdidos en el espacio grande de la card; la barra llena el ancho y
// se lee como un ranking de verdad.
function CampoRow({ rank, nombre, valor, ratio, color }) {
  const nombreMostrado = nombreCampoDisplay(nombre);
  const { abrirCampo } = useAbrirFicha();
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] shrink-0" style={{ color: MUTED, width: 18 }}>{rank}.</span>
        <button
          // Se abre la ficha con el nombre CRUDO (identificador real), no con
          // el nombre "bonito" que se muestra.
          onClick={() => abrirCampo(nombre)}
          title="Ver ficha del campo"
          className="flex-1 min-w-0 text-[13px] font-medium leading-tight text-left hover:underline decoration-teal-400 underline-offset-2"
          style={{ color: INK, overflowWrap: "anywhere" }}
        >
          {nombreMostrado}
        </button>
        <span className="text-[13.5px] font-semibold tabular-nums shrink-0" style={{ color: INK }}>
          {fmt2(valor)}
        </span>
      </div>
      <div className="rounded-full mt-1.5" style={{ height: 8, background: "#eef0ec" }}>
        {/* mínimo 3% para que un valor chico igual muestre un trozo visible. */}
        <div className="rounded-full h-full" style={{ width: `${Math.max((ratio || 0) * 100, 3)}%`, background: color }} />
      </div>
    </div>
  );
}

// Etiqueta de unidad alineada a la derecha, sobre la columna de cifras.
function UnidadHeader({ unidad }) {
  return (
    <div className="text-right text-[11px] italic pb-1" style={{ color: MUTED }}>{unidad}</div>
  );
}

function CamposColumn({ campos, offset, maxValor, shades, unidad }) {
  return (
    <div className="flex-1 min-w-0 flex flex-col h-full">
      <UnidadHeader unidad={unidad} />
      <div className="flex-1 flex flex-col justify-between">
        {campos.map((c, i) => (
          <CampoRow
            key={c.nombre}
            rank={offset + i + 1}
            nombre={c.nombre}
            valor={c.valor}
            ratio={c.valor / maxValor}
            color={shades[offset + i]}
          />
        ))}
      </div>
    </div>
  );
}

// Avanza el carrusel solo cada `intervalMs`; se detiene mientras `paused` es true
// (el caller lo activa con onMouseEnter/onMouseLeave sobre la card).
function useAutoSlide(count, paused, intervalMs = 10000) {
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    if (count < 2 || paused) return;
    const id = setInterval(() => setSlide(s => (s + 1) % count), intervalMs);
    return () => clearInterval(id);
  }, [count, paused, intervalMs]);
  return [slide, setSlide];
}

function CarouselNav({ index, count, onPrev, onNext }) {
  if (count < 2) return null;
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={onPrev} aria-label="Anterior"
        className="rounded-full w-5 h-5 flex items-center justify-center text-[13px] leading-none hover:bg-black/5"
        style={{ color: MUTED }}
      >
        ‹
      </button>
      <div className="flex gap-1">
        {Array.from({ length: count }).map((_, i) => (
          <span
            key={i}
            className="rounded-full"
            style={{ width: 5, height: 5, background: i === index ? INK : "#d8d6d0" }}
          />
        ))}
      </div>
      <button
        onClick={onNext} aria-label="Siguiente"
        className="rounded-full w-5 h-5 flex items-center justify-center text-[13px] leading-none hover:bg-black/5"
        style={{ color: MUTED }}
      >
        ›
      </button>
    </div>
  );
}

function TopCamposContent({ topCampos, fuel, setFuel }) {
  const campos = topCampos?.[fuel] ?? [];
  const mitad = Math.ceil(campos.length / 2);
  const maxValor = Math.max(...campos.map(c => c.valor), 1);
  const shades = fuel === "liquidos" ? RANK_SHADES : RANK_SHADES_GAS;
  const unidad = fuel === "liquidos" ? "Mbd" : "MMpcd";

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-6 flex-1">
        <CamposColumn campos={campos.slice(0, mitad)} offset={0} maxValor={maxValor} shades={shades} unidad={unidad} />
        <CamposColumn campos={campos.slice(mitad)} offset={mitad} maxValor={maxValor} shades={shades} unidad={unidad} />
      </div>
    </div>
  );
}

function NivelToggle({ nivel, setNivel }) {
  return (
    <div className="flex rounded-full p-0.5" style={{ background: "#f0f1ed" }}>
      {["1P", "2P", "3P"].map(n => (
        <button
          key={n} onClick={() => setNivel(n)}
          className="px-3 py-1 rounded-full text-[13px] font-medium transition-colors"
          style={n === nivel ? { background: "#fff", color: INK, boxShadow: "0 1px 2px rgba(0,0,0,0.08)" } : { color: MUTED }}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function ReservasColumn({ label, unidad, color, rows, shades }) {
  if (!rows?.length) return null;
  const maxValor = Math.max(...rows.map(r => r.valor), 1);
  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <span className="text-[12px] font-semibold mb-1" style={{ color }}>{label}</span>
      <UnidadHeader unidad={unidad} />
      <div className="flex-1 flex flex-col justify-between">
        {rows.map((r, i) => (
          <CampoRow key={r.nombre} rank={i + 1} nombre={r.nombre} valor={r.valor} ratio={r.valor / maxValor} color={shades[i]} />
        ))}
      </div>
    </div>
  );
}

function Top5ReservasContent({ top5Reservas, nivel }) {
  const bloque = top5Reservas?.[nivel];
  if (!bloque?.aceite?.length && !bloque?.gas?.length) return null;

  return (
    <div className="flex-1 min-h-0 flex flex-col sm:flex-row gap-3 sm:gap-6">
      <ReservasColumn label="Reservas de aceite" unidad="MMb" color="#0d7a4a" rows={bloque.aceite} shades={RANK_SHADES} />
      <ReservasColumn label="Reservas de gas natural" unidad="MMMpc" color="#1d6fa5" rows={bloque.gas} shades={RANK_SHADES_GAS} />
    </div>
  );
}

const CAROUSEL_TITULOS = ["Top 10 Campos Productores", "Producción por Operador", "Pozos operando"];

function CamposCarousel({ topCampos, porOperador, pozosOperando, slide, setSlide, count, onPause, onResume }) {
  const [fuel, setFuel] = useState("liquidos");
  const [fuelOperador, setFuelOperador] = useState("liquidos");
  if (!topCampos?.liquidos?.length && !topCampos?.gas?.length) return null;

  return (
    <Card
      style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}
      onMouseEnter={onPause} onMouseLeave={onResume}
    >
      <CardTitle
        right={
          <div className="flex items-center gap-3">
            {/* El selector Líquidos/Gas solo aplica a Campos y Operador; en
                Pozos operando no hay nada que alternar. */}
            {slide === 0 && <FuelToggle fuel={fuel} setFuel={setFuel} />}
            {slide === 1 && <FuelToggle fuel={fuelOperador} setFuel={setFuelOperador} />}
            <CarouselNav
              index={slide} count={count}
              onPrev={() => setSlide(s => (s - 1 + count) % count)}
              onNext={() => setSlide(s => (s + 1) % count)}
            />
          </div>
        }
      >
        {CAROUSEL_TITULOS[slide]}
      </CardTitle>
      <div key={slide} className="carousel-slide flex-1 min-h-0 flex flex-col justify-center">
        {slide === 2
          ? <PozosOperandoContent pozosOperando={pozosOperando} />
          : slide === 0
          ? <TopCamposContent topCampos={topCampos} fuel={fuel} setFuel={setFuel} />
          : <ProduccionPorOperadorContent porOperador={porOperador} fuel={fuelOperador} />}
      </div>
      <UnidadesNota />
    </Card>
  );
}

function ContratoBar({ nombre, valor, maxValor, color }) {
  const { irAOperador } = useExplorerNav();
  return (
    <div className="mb-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <button
          onClick={() => irAOperador(nombre)}
          title="Ver producción del operador"
          className="text-[13px] text-left hover:underline decoration-teal-400 underline-offset-2"
          style={{ color: INK, overflowWrap: "anywhere" }}
        >
          {nombreCampoDisplay(nombre)}
        </button>
        <span className="text-[13px] font-semibold tabular-nums whitespace-nowrap" style={{ color: INK }}>
          {fmt2(valor)}
        </span>
      </div>
      <div className="rounded-full mt-1" style={{ height: 5, background: "#eef0ec" }}>
        <div className="rounded-full h-full" style={{ width: `${(valor / maxValor) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function OperadorDonut({ pct, color, unidad, pemexTotal, otrosTotal }) {
  const option = {
    tooltip: {
      trigger: "item",
      formatter: (p) => `${p.name}: <b>${fmt2(p.value)} ${unidad}</b> (${p.percent}%)`,
    },
    series: [
      {
        type: "pie",
        radius: ["68%", "94%"],
        avoidLabelOverlap: false,
        label: { show: false },
        emphasis: { scaleSize: 6 },
        labelLine: { show: false },
        data: [
          { name: "PEMEX", value: pemexTotal, itemStyle: { color } },
          { name: "PRIVADOS", value: otrosTotal, itemStyle: { color: "#c7c9c3" } },
        ],
      },
    ],
  };
  return (
    <div className="relative shrink-0" style={{ width: 150, height: 150 }}>
      <ReactECharts option={option} style={{ width: 150, height: 150 }} opts={{ renderer: "svg" }} />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span style={{ fontFamily: "'Patria', Georgia, serif", color: INK, fontSize: 28, fontWeight: 700 }}>
          {pct}%
        </span>
      </div>
    </div>
  );
}

function ProduccionPorOperadorContent({ porOperador, fuel }) {
  const bloque = porOperador[fuel];
  if (!bloque) return null;

  const color = fuel === "liquidos" ? "#0d7a4a" : "#1d6fa5";
  const unidad = fuel === "liquidos" ? "Mbd" : "MMpcd";
  const pct = bloque.pemex_pct ?? 0;
  const maxPemex = Math.max(...bloque.pemex_contratos.map(c => c.valor), 1);
  const maxOtros = Math.max(...bloque.otros_contratos.map(c => c.valor), 1);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-7">
      <div className="flex flex-col items-center justify-center gap-5">
        <OperadorDonut
          pct={pct} color={color} unidad={unidad}
          pemexTotal={bloque.pemex_total} otrosTotal={bloque.otros_total}
        />
        <div className="flex flex-col gap-1.5 min-w-0 w-full">
          <div className="flex items-center gap-2 text-[13.5px]" style={{ color: INK }}>
            <span className="rounded-full shrink-0" style={{ width: 7, height: 7, background: color }} />
            <span className="truncate">PEMEX</span>
            <span className="font-semibold whitespace-nowrap ml-auto">
              {fmt2(bloque.pemex_total)} {unidad}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[13.5px]" style={{ color: INK }}>
            <span className="rounded-full shrink-0" style={{ width: 7, height: 7, background: "#c7c9c3" }} />
            <span className="truncate">PRIVADOS</span>
            <span className="font-semibold whitespace-nowrap ml-auto">
              {fmt2(bloque.otros_total)} {unidad}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:pl-7 pt-4 sm:pt-0 border-t sm:border-t-0 sm:border-l" style={{ borderColor: BORDER }}>
        <div>
          <span className="text-[12px] font-semibold uppercase tracking-wide block mb-2" style={{ color: MUTED }}>
            PEMEX
          </span>
          {bloque.pemex_contratos.map(c => (
            <ContratoBar key={c.nombre} nombre={c.nombre} valor={c.valor} maxValor={maxPemex} color={color} />
          ))}
        </div>
        <div>
          <span className="text-[12px] font-semibold uppercase tracking-wide block mb-2" style={{ color: MUTED }}>
            PRIVADOS
          </span>
          {bloque.otros_contratos.map(c => (
            <ContratoBar key={c.nombre} nombre={c.nombre} valor={c.valor} maxValor={maxOtros} color="#9a9d96" />
          ))}
        </div>
      </div>
    </div>
  );
}

function Top5ReservasCard({ top5Reservas, nivel, setNivel }) {
  const tieneDatos = ["1P", "2P", "3P"].some(n => top5Reservas?.[n]?.aceite?.length || top5Reservas?.[n]?.gas?.length);
  if (!tieneDatos) return null;

  return (
    <Card style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <CardTitle right={<NivelToggle nivel={nivel} setNivel={setNivel} />}>
        Top 5 Reservas por campo
      </CardTitle>
      <div className="flex-1 min-h-0 flex flex-col">
        <Top5ReservasContent top5Reservas={top5Reservas} nivel={nivel} />
      </div>
      <UnidadesNota texto="MMb: millones de barriles · MMMpc: miles de millones de pies cúbicos" />
    </Card>
  );
}

function PozoOperandoStat({ label, valor, pct, color, bg }) {
  if (valor == null) return null;
  return (
    <div className="rounded-lg flex flex-col items-center justify-center text-center px-5 py-2.5 flex-1 min-w-0" style={{ background: bg }}>
      <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color }}>{label}</span>
      <span style={{ fontFamily: "'Patria', Georgia, serif", color, fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}>
        {valor.toLocaleString("es-MX")}{" "}
        <span className="text-[14px] font-semibold" style={{ opacity: 0.7 }}>· {pct}%</span>
      </span>
    </div>
  );
}

// Contenido de "Pozos operando" para vivir como slide del carrusel (sin la
// Card propia: el carrusel ya la aporta). El total grande al centro y los dos
// desgloses debajo.
function PozosOperandoContent({ pozosOperando }) {
  if (!pozosOperando?.total) return null;
  const { total, pozos_aceite, pozos_gas, pct_aceite, pct_gas, periodo } = pozosOperando;
  const [anio, mes] = (periodo ?? "").split("-");
  const mesLabel = mes ? MESES[parseInt(mes, 10) - 1] : "";
  return (
    <div className="flex flex-col items-center justify-center text-center gap-4 h-full">
      <div>
        <span style={{ fontFamily: "'Patria', Georgia, serif", color: "#8a2c17", fontSize: 44, fontWeight: 700, lineHeight: 1 }}>
          {total.toLocaleString("es-MX")}
        </span>
        <p className="text-[13px] mt-1" style={{ color: MUTED }}>
          pozos productores en operación durante {mesLabel} de {anio}.
        </p>
      </div>
      <div className="flex gap-4 flex-wrap justify-center w-full">
        <PozoOperandoStat label="Petróleo y gas asociado" valor={pozos_aceite} pct={pct_aceite} color="#0d7a4a" bg="#daf0df" />
        <PozoOperandoStat label="Gas no asociado y condensado" valor={pozos_gas} pct={pct_gas} color="#1d6fa5" bg="#dbeafb" />
      </div>
    </div>
  );
}

export default function HomeDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [reservasNivel, setReservasNivel] = useState("1P");

  // Slide del carrusel de Campos (Top campos <-> Producción por Operador).
  const tieneOperador = !!(data?.por_operador?.liquidos || data?.por_operador?.gas);
  const tieneReservas = !!(data?.top5_reservas?.["1P"]?.aceite?.length || data?.top5_reservas?.["1P"]?.gas?.length);
  const tienePozos = !!data?.pozos_operando?.total;
  // Slides del carrusel: Campos (siempre) + Operador + Pozos operando, los dos
  // últimos solo si hay datos.
  const carouselCount = 1 + (tieneOperador ? 1 : 0) + (tienePozos ? 1 : 0);
  const [carouselPaused, setCarouselPaused] = useState(false);
  const [carouselSlide, setCarouselSlide] = useAutoSlide(carouselCount, carouselPaused);

  useEffect(() => {
    const cargar = () => fetchResumen().then(setData).catch(e => setError(e?.response?.data?.detail ?? e.message));
    cargar();

    // Refresco automático una vez al día, a la hora del cierre de mercado
    // (18:00 hora local — la Mezcla Mexicana la publica Pemex antes de las
    // 6:00 p.m.). Si la pestaña se queda abierta todo el día, el precio no
    // se queda pegado al valor de la mañana sin tener que recargar a mano.
    const HORA_CIERRE = 18;
    function msHastaProximoCierre() {
      const ahora = new Date();
      const proximo = new Date(ahora);
      proximo.setHours(HORA_CIERRE, 0, 0, 0);
      if (proximo <= ahora) proximo.setDate(proximo.getDate() + 1);
      return proximo - ahora;
    }
    let intervalId;
    const timeoutId = setTimeout(function tick() {
      cargar();
      intervalId = setInterval(cargar, 24 * 60 * 60 * 1000);
    }, msHastaProximoCierre());

    return () => { clearTimeout(timeoutId); clearInterval(intervalId); };
  }, []);

  if (error) {
    return <div className="text-sm text-rose-500 p-4">No se pudo cargar el panorama general: {error}</div>;
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Cargando panorama general…
      </div>
    );
  }

  const periodoGeneral = periodoLabelDe(data.nacional?.periodo);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <span
          className="text-[13px] font-semibold uppercase tracking-wider"
          style={{ color: ORANGE }}
          title="Último mes con datos de producción disponibles en la base."
        >
          ● {periodoGeneral ? `Datos a ${periodoGeneral.replace(" ", " de ")}` : "Panorama general"}
        </span>
        <button
          onClick={() => setExportModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 2v10M4 8l4 4 4-4"/><path d="M2 14h12"/>
          </svg>
          Exportar
        </button>
      </div>

      {/* El dashboard llena el alto disponible: la primera fila toma su altura
          natural y la segunda (carrusel + reservas) crece para ocupar el resto.
          Así la fila del carrusel tiene una altura FIJA por layout y no cambia
          al rotar de slide — antes cada slide (10 campos vs. donut vs. total)
          imponía su propia altura y la card "brincaba". min-h evita que los 10
          campos se recorten en viewports bajos. */}
      <div className="flex-1 min-h-0 flex flex-col gap-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 shrink-0">
          <CifrasNacionales nacional={data.nacional} />
          <IndicadoresEconomicos indicadores={data.indicadores_economicos} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0" style={{ minHeight: 380 }}>
          <CamposCarousel
            topCampos={data.top_campos} porOperador={data.por_operador} pozosOperando={data.pozos_operando}
            slide={carouselSlide} setSlide={setCarouselSlide} count={carouselCount}
            onPause={() => setCarouselPaused(true)} onResume={() => setCarouselPaused(false)}
          />
          <Top5ReservasCard top5Reservas={data.top5_reservas} nivel={reservasNivel} setNivel={setReservasNivel} />
        </div>
      </div>

      <ExportPDFTIH
        data={buildExportPDFData(data)}
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
      />
    </div>
  );
}
