import { useEffect, useState } from "react";
import { fetchAsignacionesRanking } from "../../api/client";
import LoadingSpinner from "../UI/LoadingSpinner";

const INK = "#1f2430";
const MUTED = "#767b87";
const TOP_N = 15;

const MEDALLA = {
  1: { accent: "#f59e0b", badgeBg: "#fef3c7", badgeColor: "#92400e" },
  2: { accent: "#94a3b8", badgeBg: "#f1f5f9", badgeColor: "#475569" },
  3: { accent: "#c2703d", badgeBg: "#fed7aa", badgeColor: "#9a3412" },
};

function VigenciaBadge({ vigente, endDate }) {
  if (vigente == null) return <span className="text-slate-300">—</span>;
  const color = vigente ? "#059669" : "#dc2626";
  const bg = vigente ? "#ecfdf5" : "#fef2f2";
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold whitespace-nowrap"
      style={{ color, background: bg }}
      title={endDate ? `Vence ${endDate}` : undefined}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
      {vigente ? "Vigente" : "Vencida"}
    </span>
  );
}

// Switch de dos posiciones Mbd/MMpcd — controla tanto el orden del ranking
// como la unidad que se muestra en el podio y la tabla.
function MetricaSwitch({ value, onChange }) {
  const opciones = [
    { id: "liquidos", label: "Mbd" },
    { id: "gas", label: "MMpcd" },
  ];
  return (
    <div className="inline-flex items-center p-0.5 rounded-full bg-slate-100 border border-slate-200">
      {opciones.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-3 py-1 rounded-full text-[11.5px] font-semibold transition-colors cursor-pointer ${
            value === o.id ? "bg-tih-dark text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Chip({ children }) {
  return (
    <span className="text-[10.5px] font-medium px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 whitespace-nowrap">
      {children}
    </span>
  );
}

// Card de podio (top 3) — el 1er lugar va al centro, más grande y elevado;
// 2do a la izquierda y 3ro a la derecha, mismo patrón visual de un podio.
function PodioCard({ a, rank, unidad }) {
  const m = MEDALLA[rank];
  const esPrimero = rank === 1;
  return (
    <div
      className={`relative bg-white rounded-2xl border-t-4 shadow-sm flex flex-col p-4 ${esPrimero ? "shadow-md" : ""}`}
      style={{ borderTopColor: m.accent }}
    >
      <div className="flex items-start justify-between mb-3">
        <span
          className="flex items-center justify-center rounded-full font-bold shrink-0"
          style={{ background: m.badgeBg, color: m.badgeColor, width: esPrimero ? 44 : 36, height: esPrimero ? 44 : 36, fontSize: esPrimero ? 20 : 15 }}
        >
          {rank}
        </span>
        <VigenciaBadge vigente={a.vigente} endDate={a.end_date} />
      </div>

      <p className="text-[14px] font-bold leading-snug mb-2" style={{ color: INK }} title={a.block_name ? a.asignacion : undefined}>
        {a.block_name ?? a.asignacion}
      </p>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {a.cuenca && <Chip>{a.cuenca}</Chip>}
        {a.ubicacion && <Chip>{a.ubicacion}</Chip>}
      </div>

      <div className="flex items-end justify-between mt-auto pt-2">
        <div>
          <p className="text-[22px] font-bold leading-none tabular-nums" style={{ color: INK }}>
            {a.valor != null ? a.valor.toLocaleString("es-MX") : "—"}
          </p>
          <p className="text-[10.5px] text-slate-400 mt-0.5">{unidad}</p>
        </div>
        {a.productividad_mbd_km2 != null && (
          <div className="text-right">
            <p className="text-[13px] font-bold tabular-nums" style={{ color: "#d97706" }}>
              {a.productividad_mbd_km2.toLocaleString("es-MX")}
            </p>
            <p className="text-[9.5px] text-slate-400">Mbd/km²</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AsignacionesRanking({ period, start_year, end_year, start_month, end_month }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [soloVigentes, setSoloVigentes] = useState(false);
  const [metrica, setMetrica] = useState("liquidos");

  useEffect(() => {
    setData(null);
    setError(null);
    fetchAsignacionesRanking({ period, start_year, end_year, start_month, end_month })
      .then(setData)
      .catch(e => setError(e?.response?.data?.detail ?? e.message));
  }, [period, start_year, end_year, start_month, end_month]);

  if (error) return <div className="text-sm text-rose-500 p-4">No se pudo cargar la analítica de asignaciones: {error}</div>;
  if (!data) return (
    <div className="flex items-center justify-center h-64">
      <LoadingSpinner message="Consultando asignaciones…" />
    </div>
  );
  if (!data.asignaciones?.length) return <div className="text-sm text-slate-400 p-4">Sin datos de producción por asignación en este rango.</div>;

  const campoValor = metrica === "gas" ? "gas_mmpcd" : "liquidos_mbd";
  const unidadValor = metrica === "gas" ? "MMpcd" : "Mbd";

  const q = busqueda.trim().toLowerCase();
  const filas = data.asignaciones
    .filter(a => {
      if (soloVigentes && a.vigente === false) return false;
      if (!q) return true;
      return [a.asignacion, a.cuenca, a.ubicacion, a.plan, a.activity, a.basin]
        .some(v => v && String(v).toLowerCase().includes(q));
    })
    .filter(a => a[campoValor] != null)
    .sort((a, b) => (b[campoValor] ?? 0) - (a[campoValor] ?? 0))
    .slice(0, TOP_N)
    .map(a => ({ ...a, valor: a[campoValor] }));

  const podio = filas.slice(0, 3);
  const resto = filas.slice(3);
  const sinMetadata = data.asignaciones.every(a => a.plan == null && a.area_km2 == null);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex flex-col justify-center mr-2 min-w-0">
          <span style={{ fontFamily: "'Patria', Georgia, serif", color: "#10312B", fontSize: 17, fontWeight: 700, lineHeight: 1.1 }}>
            Top {TOP_N} asignaciones
          </span>
          <span style={{ fontFamily: "'Noto Sans', sans-serif", fontSize: 10, color: MUTED, letterSpacing: "0.03em" }}>
            {data.periodo ? `Datos a ${data.periodo}` : ""} · ordenado por {unidadValor}
          </span>
        </div>
        <div className="flex-1" />
        <MetricaSwitch value={metrica} onChange={setMetrica} />
        <label className="flex items-center gap-1.5 text-[12px] text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={soloVigentes} onChange={e => setSoloVigentes(e.target.checked)} className="accent-teal-600" />
          Solo vigentes
        </label>
        <input
          className="pl-3 pr-3 py-1.5 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-400 bg-white min-w-[180px]"
          style={{ color: "#1f2937" }}
          placeholder="Buscar asignación, cuenca, plan…"
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
        />
      </div>

      {sinMetadata && (
        <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          No se pudieron traer los atributos del bloque (plan, actividad, vigencia, área) — el catálogo de asignaciones no está disponible desde este entorno. La producción sí es real.
        </div>
      )}

      <div className="overflow-y-auto flex-1 min-h-0">
        {filas.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-16">Sin resultados para este filtro.</p>
        ) : (
          <>
            {podio.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6 pt-2">
                {/* Orden visual 2-1-3, con el 1er lugar al centro */}
                {podio.map((a, i) => (
                  <PodioCard key={a.asignacion} a={a} rank={i + 1} unidad={unidadValor} />
                ))}
              </div>
            )}

            {resto.length > 0 && (
              <div
                className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
                style={{ background: "linear-gradient(135deg, rgba(13,148,136,0.09) 0%, rgba(13,148,136,0.03) 35%, rgba(255,255,255,1) 75%)" }}
              >
                <table className="w-full border-collapse">
                  <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                    <tr className="border-b-2 border-slate-200" style={{ background: "linear-gradient(135deg, rgba(13,148,136,0.14), rgba(13,148,136,0.05))" }}>
                      {[
                        ["#", "left"], ["Asignación", "left"], ["Cuenca / Ambiente", "left"],
                        ["Vigencia", "left"], [unidadValor, "right"], ["Productividad", "right"],
                      ].map(([label, align]) => (
                        <th key={label} className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 whitespace-nowrap text-${align}`}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resto.map((a, i) => (
                      <tr key={a.asignacion} className="border-b border-slate-100/70 hover:bg-teal-100/50 transition-colors">
                        <td className="px-4 py-3 text-[12px] text-slate-400 tabular-nums">{i + 4}</td>
                        <td className="px-4 py-3 text-[13px] font-semibold" style={{ color: INK }} title={a.block_name ? a.asignacion : undefined}>
                          {a.block_name ?? a.asignacion}
                        </td>
                        <td className="px-4 py-3 text-[12px] text-slate-500 whitespace-nowrap">
                          {[a.cuenca, a.ubicacion].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td className="px-4 py-3"><VigenciaBadge vigente={a.vigente} endDate={a.end_date} /></td>
                        <td className="px-4 py-3 text-[13px] font-bold text-right tabular-nums" style={{ color: INK }}>
                          {a.valor != null ? a.valor.toLocaleString("es-MX") : "—"} <span className="font-normal text-slate-400 text-[11px]">{unidadValor}</span>
                        </td>
                        <td className="px-4 py-3 text-[12px] font-medium text-right tabular-nums" style={{ color: "#d97706" }}>
                          {a.productividad_mbd_km2 != null ? a.productividad_mbd_km2.toLocaleString("es-MX") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
