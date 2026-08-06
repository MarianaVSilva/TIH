const TENDENCIA_ICON  = { CRECIENDO: "↑", ESTABLE: "→", DECLINANDO: "↓", CRITICO: "⚠" };
const TENDENCIA_COLOR = { CRECIENDO: "#059669", ESTABLE: "#64748b", DECLINANDO: "#d97706", CRITICO: "#dc2626" };
const TENDENCIA_BG    = { CRECIENDO: "#ecfdf5", ESTABLE: "#f1f5f9", DECLINANDO: "#fffbeb", CRITICO: "#fef2f2" };
// Pozo sin producción actual: la tendencia no tiene sentido, se omite.
const ESTADOS_SIN_TENDENCIA = ["Cerrado", "Inactivo", "Abandono permanente", "Abandono temporal"];

function TendenciaBadge({ tendencia, estado }) {
  if (!tendencia || tendencia === "SIN_DATOS" || ESTADOS_SIN_TENDENCIA.includes(estado)) return <span className="text-slate-300">—</span>;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold whitespace-nowrap"
      style={{ color: TENDENCIA_COLOR[tendencia] ?? "#64748b", background: TENDENCIA_BG[tendencia] ?? "#f1f5f9" }}
    >
      {TENDENCIA_ICON[tendencia] ?? "–"} {tendencia}
    </span>
  );
}

function EstadoBadge({ estado }) {
  if (!estado) return <span className="text-slate-300">—</span>;
  const color = estado === "Productor" ? "#059669"
    : estado === "En inyección" ? "#0ea5e9"
    : (estado.startsWith("Abandono") || estado.startsWith("Taponamiento")) ? "#dc2626"
    : "#94a3b8";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600 whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
      {estado}
    </span>
  );
}

// Barras proporcionales solo dentro de su propio grupo (top o bottom) — mezclar
// el mejor y el peor pozo del campo en una sola escala lineal hace que uno
// domine visualmente al otro; separados, cada lista es legible por sí sola.
function MiniBarList({ title, accent, accentBg, items }) {
  const max = Math.max(...items.map(p => p.produccion_mbd), 0.01);
  return (
    <div className="flex-1 min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">{title}</p>
      <div className="space-y-2">
        {items.map(p => (
          <div key={p.well_id} className="flex items-center gap-2.5">
            <span className="text-[11.5px] text-slate-600 font-medium truncate" style={{ width: 92 }}>{p.pozo}</span>
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: accentBg }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${(p.produccion_mbd / max) * 100}%`, background: accent }} />
            </div>
            <span className="text-[11px] font-semibold text-slate-500 text-right tabular-nums shrink-0" style={{ width: 46 }}>
              {p.produccion_mbd.toLocaleString("es-MX")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PozoRankingCard({ ranking, onSelectPozo, onClose }) {
  if (!ranking || !ranking.pozos?.length) return null;
  const pozos = ranking.pozos;
  const unidad = ranking.unidad ?? "Mbd";
  const top5 = pozos.slice(0, 5);
  const bottom5 = [...pozos].slice(-5).reverse().filter(p => !top5.some(t => t.well_id === p.well_id));

  return (
    <div className="rounded-2xl border border-slate-200 shadow-sm bg-white overflow-hidden mb-4">
      <div className="px-4 py-3 flex items-center justify-between flex-wrap gap-1" style={{ background: "linear-gradient(90deg,#10312B,#1a4a3a)" }}>
        <span className="text-white text-[13px] font-bold tracking-wide">Ranking en el campo</span>
        <div className="flex items-center gap-2">
          <span className="text-teal-200/90 text-[11px]">
            {ranking.num_pozos} pozos · promedio {ranking.promedio_mbd?.toLocaleString("es-MX", { maximumFractionDigits: 2 })} {unidad}
          </span>
          {onClose && (
            <button
              onClick={onClose}
              title="Volver al resumen de la cuenca"
              className="w-5 h-5 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/15 transition-colors"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {(top5.length > 0 || bottom5.length > 0) && (
        <div className="p-4 flex flex-col sm:flex-row gap-x-8 gap-y-4 border-b border-slate-100">
          {top5.length > 0 && <MiniBarList title="Top productores" accent="#059669" accentBg="#ecfdf5" items={top5} />}
          {bottom5.length > 0 && <MiniBarList title="Menor producción" accent="#f59e0b" accentBg="#fffbeb" items={bottom5} />}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-wide">
              <th className="text-left py-2 px-3 font-semibold">#</th>
              <th className="text-left py-2 px-3 font-semibold">Pozo</th>
              <th className="text-right py-2 px-3 font-semibold">{unidad}</th>
              <th className="text-center py-2 px-3 font-semibold">Tendencia</th>
              <th className="text-left py-2 px-3 font-semibold">Estado</th>
            </tr>
          </thead>
          <tbody>
            {pozos.slice(0, 15).map((p, i) => (
              <tr
                key={p.well_id}
                onClick={() => onSelectPozo?.(p.pozo)}
                className={`group cursor-pointer border-l-[3px] border-transparent hover:border-teal-500 hover:bg-teal-100/80 transition-colors ${i % 2 ? "bg-slate-50/50" : "bg-white"}`}
              >
                <td className="py-2 px-3 text-slate-400">{p.ranking}</td>
                <td className="py-2 px-3 font-semibold text-slate-700 group-hover:text-teal-800">{p.pozo}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-600">{p.produccion_mbd.toLocaleString("es-MX")}</td>
                <td className="py-2 px-3"><div className="flex justify-center"><TendenciaBadge tendencia={p.tendencia} estado={p.estado_operativo} /></div></td>
                <td className="py-2 px-3"><EstadoBadge estado={p.estado_operativo} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
