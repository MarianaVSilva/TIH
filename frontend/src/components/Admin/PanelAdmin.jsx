import { useState, useEffect, useCallback } from "react";
import ReactECharts from "echarts-for-react";
import { acentuarTema } from "../../utils/acentuarTema";

// Panel de administrador: estadísticas de uso del tablero.
//
// Se abre con #admin en la URL — no está en el menú a propósito, no porque eso
// lo proteja (no protege nada), sino para no ofrecerlo a quien no le toca. La
// protección real es la clave: sin ella el backend no devuelve nada.
//
// La clave se guarda en sessionStorage, así que se pide una vez por pestaña y
// se olvida al cerrarla. No se guarda en localStorage: quedaría escrita en el
// equipo de forma indefinida.
const CLAVE = "tih_admin_key";

async function pedir(ruta, clave, opciones = {}) {
  const res = await fetch(`/api/v1${ruta}`, {
    ...opciones,
    headers: { ...(opciones.headers ?? {}), "X-Admin-Key": clave },
  });
  if (!res.ok) {
    const cuerpo = await res.json().catch(() => ({}));
    throw new Error(cuerpo.detail ?? `Error ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// El panel se monta FUERA del contenedor de la app (App.jsx corta antes), así
// que trae su propio fondo claro: si no, hereda el oscuro del body y el texto
// se pierde.
function Marco({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", color: "#1f2430",
                  fontFamily: "'Noto Sans', system-ui, sans-serif" }}>
      {children}
    </div>
  );
}

function Tarjeta({ etiqueta, valor, nota }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#94a3b8" }}>
        {etiqueta}
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, color: "#10312B", marginTop: 4 }}>{valor}</div>
      {nota && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{nota}</div>}
    </div>
  );
}

function Login({ onEntrar }) {
  const [clave, setClave] = useState("");
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    if (!clave.trim()) { setError("Escribe la clave."); return; }
    setCargando(true); setError(null);
    try {
      await pedir("/uso/verificar", clave.trim());
      sessionStorage.setItem(CLAVE, clave.trim());
      onEntrar(clave.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <Marco>
    <form onSubmit={entrar} style={{ maxWidth: 340, margin: "0 auto", textAlign: "center", padding: "80px 16px" }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, color: "#10312B", marginBottom: 6 }}>Panel de administrador</h1>
      <p style={{ fontSize: 12, color: "#64748b", marginBottom: 18 }}>Estadísticas de uso del tablero</p>
      <input
        type="password" value={clave} onChange={e => setClave(e.target.value)}
        placeholder="Clave de administrador" aria-label="Clave de administrador"
        style={{
          width: "100%", padding: "9px 12px", borderRadius: 8, fontSize: 13,
          border: "1px solid #cbd5e1", outline: "none",
        }}
      />
      {error && <p style={{ color: "#b91c1c", fontSize: 12, marginTop: 8 }}>{error}</p>}
      <button type="submit" disabled={cargando}
        style={{
          marginTop: 12, width: "100%", padding: "9px 12px", borderRadius: 8, border: "none",
          background: "#10312B", color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer",
        }}>
        {cargando ? "Verificando…" : "Entrar"}
      </button>
      <a href="#" onClick={() => { window.location.hash = ""; window.location.reload(); }}
        style={{ display: "block", marginTop: 14, fontSize: 12, color: "#0f766e" }}>
        ← Volver al tablero
      </a>
    </form>
    </Marco>
  );
}

const RANGOS = [
  ["7 días", 7], ["30 días", 30], ["90 días", 90], ["1 año", 365],
];

export default function PanelAdmin() {
  const [clave, setClave] = useState(() => {
    try { return sessionStorage.getItem(CLAVE); } catch { return null; }
  });
  const [dias, setDias] = useState(30);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    if (!clave) return;
    setCargando(true); setError(null);
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - (dias - 1) * 86400000);
    const iso = d => d.toISOString().slice(0, 10);
    try {
      setDatos(await pedir(`/uso/metricas?desde=${iso(desde)}&hasta=${iso(hasta)}`, clave));
    } catch (err) {
      setError(err.message);
      // Clave revocada o cambiada: se olvida para volver a pedirla.
      if (String(err.message).includes("incorrecta")) {
        sessionStorage.removeItem(CLAVE); setClave(null);
      }
    } finally {
      setCargando(false);
    }
  }, [clave, dias]);

  useEffect(() => { cargar(); }, [cargar]);

  if (!clave) return <Login onEntrar={setClave} />;

  const r = datos?.resumen;
  const sinDatos = datos && r && r.sesiones === 0;

  const ejeDias = {
    backgroundColor: "#fff",
    tooltip: { trigger: "axis", textStyle: { fontSize: 11 } },
    grid: { top: 24, right: 16, bottom: 28, left: 44, containLabel: true },
    xAxis: {
      type: "category", data: (datos?.por_dia ?? []).map(d => d.dia),
      axisLabel: { fontSize: 10, color: "#767b87", rotate: (datos?.por_dia?.length ?? 0) > 20 ? 45 : 0 },
      axisLine: { lineStyle: { color: "#e7e5e0" } },
    },
    yAxis: { type: "value", axisLabel: { fontSize: 10, color: "#767b87" }, splitLine: { show: false } },
    series: [{
      name: "Sesiones", type: "line", smooth: true,
      // Con un solo día no hay segmento que dibujar: sin el punto la gráfica
      // saldría en blanco aunque el dato esté.
      symbol: (datos?.por_dia?.length ?? 0) <= 1 ? "circle" : "none", symbolSize: 8,
      data: (datos?.por_dia ?? []).map(d => d.sesiones),
      lineStyle: { width: 2, color: "#0d7a4a" },
      itemStyle: { color: "#0d7a4a" },
      areaStyle: { color: "#0d7a4a14" },
    }],
  };

  const ejeHoras = {
    backgroundColor: "#fff",
    tooltip: { trigger: "axis", textStyle: { fontSize: 11 } },
    grid: { top: 24, right: 16, bottom: 28, left: 44, containLabel: true },
    xAxis: {
      type: "category", data: (datos?.por_hora ?? []).map(h => `${h.hora}:00`),
      axisLabel: { fontSize: 10, color: "#767b87" },
      axisLine: { lineStyle: { color: "#e7e5e0" } },
    },
    yAxis: { type: "value", axisLabel: { fontSize: 10, color: "#767b87" }, splitLine: { show: false } },
    series: [{
      name: "Sesiones", type: "line", smooth: true,
      symbol: (datos?.por_hora?.length ?? 0) <= 1 ? "circle" : "none", symbolSize: 8,
      data: (datos?.por_hora ?? []).map(h => h.sesiones),
      lineStyle: { width: 2, color: "#0db4be" },
      itemStyle: { color: "#0db4be" },
      areaStyle: { color: "#0db4be14" },
    }],
  };

  return (
    <Marco>
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "#10312B", margin: 0 }}>Uso del tablero</h1>
          {datos && <p style={{ fontSize: 12, color: "#94a3b8", margin: "2px 0 0" }}>{datos.desde} al {datos.hasta}</p>}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {RANGOS.map(([etiqueta, d]) => (
            <button key={d} onClick={() => setDias(d)}
              style={{
                padding: "5px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer",
                border: "1px solid " + (dias === d ? "#10312B" : "#e2e8f0"),
                background: dias === d ? "#10312B" : "#fff",
                color: dias === d ? "#fff" : "#64748b",
              }}>
              {etiqueta}
            </button>
          ))}
          <a href="#" onClick={() => { window.location.hash = ""; window.location.reload(); }}
            style={{ fontSize: 12, color: "#0f766e", marginLeft: 10 }}>← Tablero</a>
        </div>
      </div>

      {error && (
        <p style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c",
                    padding: "10px 14px", borderRadius: 8, fontSize: 12 }}>{error}</p>
      )}
      {cargando && !datos && <p style={{ fontSize: 13, color: "#94a3b8" }}>Cargando…</p>}

      {sinDatos && (
        <p style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e",
                    padding: "10px 14px", borderRadius: 8, fontSize: 12 }}>
          Todavía no hay visitas registradas en este periodo. El registro empieza a
          acumular desde que se publica esta versión; los días anteriores estarán vacíos.
        </p>
      )}

      {datos && !sinDatos && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 20 }}>
            <Tarjeta etiqueta="Visitas" valor={r.sesiones.toLocaleString("es-MX")} nota="sesiones distintas" />
            <Tarjeta etiqueta="Equipos" valor={r.equipos.toLocaleString("es-MX")} nota="direcciones IP distintas" />
            <Tarjeta etiqueta="Tiempo total" valor={`${r.minutos.toLocaleString("es-MX")} min`} />
            <Tarjeta etiqueta="Por visita" valor={`${r.minutos_por_sesion} min`} nota="promedio" />
            <Tarjeta etiqueta="Secciones abiertas" valor={r.consultas_seccion.toLocaleString("es-MX")} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginBottom: 20 }}>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14 }}>
              <h2 style={{ fontSize: 12, fontWeight: 600, color: "#0f766e", margin: "0 0 6px" }}>Visitas por día</h2>
              <ReactECharts option={ejeDias} style={{ height: 240 }} notMerge />
            </div>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14 }}>
              <h2 style={{ fontSize: 12, fontWeight: 600, color: "#0f766e", margin: "0 0 6px" }}>Visitas por hora del día</h2>
              <ReactECharts option={ejeHoras} style={{ height: 240 }} notMerge />
            </div>
          </div>

          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, marginBottom: 20 }}>
            <h2 style={{ fontSize: 12, fontWeight: 600, color: "#0f766e", margin: "0 0 10px" }}>Secciones más consultadas</h2>
            {datos.secciones.length === 0
              ? <p style={{ fontSize: 12, color: "#94a3b8" }}>Sin consultas en el periodo.</p>
              : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "#94a3b8", fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em" }}>
                        <th style={{ padding: "6px 8px" }}>Sección</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Veces</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Visitas</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Minutos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.secciones.map(t => (
                        <tr key={t.seccion} style={{ borderTop: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "6px 8px", fontWeight: 500, color: "#1f2430" }}>
                            {t.seccion === "Indicadores Economicos" ? "Indicadores Económicos" : acentuarTema(t.seccion ?? "")}
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>{t.consultas.toLocaleString("es-MX")}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right", color: "#64748b" }}>{t.sesiones.toLocaleString("es-MX")}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right", color: "#64748b" }}>{t.minutos.toLocaleString("es-MX")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>

          {datos.busquedas.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14 }}>
              <h2 style={{ fontSize: 12, fontWeight: 600, color: "#0f766e", margin: "0 0 10px" }}>Lo más buscado</h2>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {datos.busquedas.map(b => (
                  <span key={b.texto} style={{
                    fontSize: 11, padding: "4px 10px", borderRadius: 999,
                    background: "#f1f5f9", color: "#475569",
                  }}>
                    {b.texto} <strong style={{ color: "#0f766e" }}>{b.veces}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
    </Marco>
  );
}
