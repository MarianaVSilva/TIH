import { useState, useEffect, useRef } from "react";
import { fetchBuscar } from "../../api/client";
import { useExplorer } from "../../store/useExplorer";
import { useExplorerNav } from "../../hooks/useExplorerNav";
import { acentuarTema } from "../../utils/acentuarTema";

// Buscador global: el usuario escribe el nombre de lo que sea —un pozo, un
// campo, una asignación, un contrato, una empresa, una entidad federativa, una
// cuenca— y se le ofrecen los temas donde puede verlo. Dos pasos: primero
// elige la entidad, luego el tema.
//
// El mapeo entidad→temas vive aquí, junto a la navegación que lo usa
// (useExplorerNav), y no en el backend: el catálogo de temas ya está cargado
// en el store, así que agregar un tema no obliga a tocar la API.
//
// Cada entrada dice a qué tema saltar y CÓMO dejarlo listo: casi siempre una
// búsqueda pre-cargada en la tabla del tema destino; en asignaciones también
// los filtros de cuenca/ambiente, sin los cuales esa tabla no baja al nivel de
// la asignación (ver useExplorerNav).
// Año en que la entidad dejó de producir, si ya no produce. Los temas abren en
// el año en curso, así que sin esto un campo cerrado hace 25 años (GURUMAL,
// última producción en 2001) salía vacío y parecía que el buscador mentía.
const ANIO_ACTUAL = new Date().getFullYear();
function inactivaDesde(r) {
  return r.ultimo_anio && r.ultimo_anio < ANIO_ACTUAL ? r.ultimo_anio : null;
}

const TEMAS_POR_TIPO = {
  // "Reservas por campo" solo si el campo TIENE reservas remanentes: hay
  // campos que estan en la tabla de reservas con puros ceros (solo volumen
  // original, GURUMAL por ejemplo) y la tabla descarta los ceros, asi que
  // ofrecer el tema llevaba a una pantalla vacia. El backend lo marca.
  campo: (r) => [
    ["Campos", { busqueda: r.nombre, todasLasSeries: true, anio: inactivaDesde(r) }],
    ["PozosCampos", { busqueda: r.nombre, anio: inactivaDesde(r) }],
    ...(r.con_reservas ? [["ReservasP", { busqueda: r.nombre }]] : []),
  ],
  pozo: (r) => [
    ["Pozos", { pozo: r.nombre, campo: r.campo }],
  ],
  asignacion: (r) => [
    ["Asignaciones", {
      busqueda: r.nombre, todasLasSeries: true, anio: inactivaDesde(r),
      filtros: { cuencas: r.cuenca ? [r.cuenca] : [], ubicaciones: r.ubicacion ? [r.ubicacion] : [] },
    }],
    ...(r.con_reservas ? [["ReservasAsigP", { busqueda: r.nombre }]] : []),
  ],
  contrato: (r) => [
    ["Contratos", { busqueda: r.codigo ?? r.nombre, todasLasSeries: true, anio: inactivaDesde(r) }],
    ["InvCont", { busqueda: r.nombre }],
    ["PozosLic", { busqueda: r.nombre }],
    ["EfectivoLic", { busqueda: r.nombre }],
    ["InvLic", { busqueda: r.nombre }],
    ...(r.con_reservas ? [["ReservasAsigP", { busqueda: r.nombre }]] : []),
  ],
  operador: (r) => [
    ["Operadores", { busqueda: r.nombre, todasLasSeries: true }],
    ["PozPerf", { busqueda: r.nombre }],
    ["PozTerm", { busqueda: r.nombre }],
    ["EmpresasG", { busqueda: r.nombre }],
  ],
  entidad: (r) => [
    ["Estado", { busqueda: r.nombre }],
  ],
  cuenca: (r) => [
    ["Cuenca", { filtros: { cuencas: [r.nombre], ubicaciones: [] } }],
    ["API", { filtros: { cuencas: [r.nombre], ubicaciones: [] } }],
    ["Gcompo", { filtros: { cuencas: [r.nombre], ubicaciones: [] } }],
    ["InvCuenca", { busqueda: r.nombre }],
  ],
};

const ETIQUETA_TIPO = {
  campo: "Campo",
  pozo: "Pozo",
  asignacion: "Asignación",
  contrato: "Contrato",
  operador: "Empresa / operador",
  entidad: "Entidad federativa",
  cuenca: "Cuenca geológica",
};

const ORDEN_TIPOS = ["campo", "asignacion", "contrato", "operador", "entidad", "cuenca", "pozo"];

const COLOR_TIPO = {
  campo: "#0d7a4a",
  pozo: "#0369a1",
  asignacion: "#7c3aed",
  contrato: "#b45309",
  operador: "#be185d",
  entidad: "#0f766e",
  cuenca: "#475569",
};

function claveResultado(r) {
  return `${r.tipo}|${r.codigo ?? r.nombre}`;
}

export default function BuscadorGlobal() {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [expandido, setExpandido] = useState(null);
  const cajaRef = useRef(null);
  const { temas } = useExplorer();
  const { irATema } = useExplorerNav();

  // Se consulta con retraso: escribiendo "cantarell" serían 9 consultas a la
  // base si se disparara en cada tecla.
  useEffect(() => {
    const q = texto.trim();
    if (q.length < 3) { setResultados([]); setCargando(false); return; }
    setCargando(true);
    let vigente = true;
    const t = setTimeout(() => {
      fetchBuscar(q)
        .then(d => { if (vigente) { setResultados(d?.resultados ?? []); setAbierto(true); } })
        .catch(() => { if (vigente) setResultados([]); })
        .finally(() => { if (vigente) setCargando(false); });
    }, 300);
    return () => { vigente = false; clearTimeout(t); };
  }, [texto]);

  // Cerrar al hacer clic fuera.
  useEffect(() => {
    function fuera(e) {
      if (cajaRef.current && !cajaRef.current.contains(e.target)) setAbierto(false);
    }
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, []);

  // Solo se ofrecen los temas que existen en el catálogo cargado.
  function temasDe(r) {
    const construir = TEMAS_POR_TIPO[r.tipo];
    if (!construir) return [];
    return construir(r)
      .map(([jsonArg, nav]) => {
        const t = temas.find(x => x.json_arg === jsonArg);
        return t ? { jsonArg, nav, seccion: t.seccion, etiqueta: acentuarTema(t.tema) } : null;
      })
      .filter(Boolean);
  }

  function abrirTema(r, destino) {
    irATema(destino.jsonArg, destino.nav);
    setAbierto(false);
    setExpandido(null);
    setTexto("");
  }

  const porTipo = ORDEN_TIPOS
    .map(tipo => [tipo, resultados.filter(r => r.tipo === tipo)])
    .filter(([, rs]) => rs.length > 0);

  return (
    <div ref={cajaRef} style={{ position: "relative", marginLeft: "auto", minWidth: 260 }}>
      <div style={{ position: "relative" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.55)" }}>
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          value={texto}
          onChange={e => setTexto(e.target.value)}
          onFocus={() => { if (resultados.length) setAbierto(true); }}
          placeholder="Buscar pozo, campo, contrato, empresa…"
          aria-label="Buscador global"
          style={{
            width: "100%", padding: "7px 28px 7px 30px", borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.22)", background: "rgba(255,255,255,0.08)",
            color: "#fff", fontSize: 12, outline: "none",
          }}
        />
        {texto && (
          <button
            onClick={() => { setTexto(""); setResultados([]); setAbierto(false); }}
            aria-label="Limpiar búsqueda"
            style={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", color: "rgba(255,255,255,0.6)",
              cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 2,
            }}
          >×</button>
        )}
      </div>

      {abierto && texto.trim().length >= 3 && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, width: 380, maxHeight: 420,
          overflowY: "auto", background: "#fff", borderRadius: 12, zIndex: 60,
          border: "1px solid #e2e8f0", boxShadow: "0 12px 32px rgba(15,23,42,0.18)",
        }}>
          {cargando && (
            <p style={{ margin: 0, padding: "14px 16px", fontSize: 12, color: "#94a3b8" }}>Buscando…</p>
          )}
          {!cargando && porTipo.length === 0 && (
            <p style={{ margin: 0, padding: "14px 16px", fontSize: 12, color: "#94a3b8" }}>
              Sin coincidencias para “{texto.trim()}”.
            </p>
          )}
          {!cargando && porTipo.map(([tipo, rs]) => (
            <div key={tipo}>
              <div style={{
                padding: "7px 14px 4px", fontSize: 9, fontWeight: 700, letterSpacing: ".08em",
                textTransform: "uppercase", color: "#94a3b8", background: "#f8fafc",
                borderBottom: "1px solid #f1f5f9",
              }}>
                {ETIQUETA_TIPO[tipo]}
              </div>
              {rs.map(r => {
                const clave = claveResultado(r);
                const abiertoEste = expandido === clave;
                const destinos = temasDe(r);
                return (
                  <div key={clave} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <button
                      onClick={() => setExpandido(abiertoEste ? null : clave)}
                      style={{
                        width: "100%", textAlign: "left", padding: "8px 14px", background: abiertoEste ? "#f8fafc" : "none",
                        border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: COLOR_TIPO[tipo], flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1f2430" }}>{r.nombre}</span>
                        {inactivaDesde(r) && (
                          <span style={{ display: "block", fontSize: 10, color: "#b45309", marginTop: 1 }}>
                            Sin producción desde {inactivaDesde(r)} · se abre en ese año
                          </span>
                        )}
                        {(r.cuenca || r.campo || r.codigo) && (
                          <span style={{ display: "block", fontSize: 10, color: "#94a3b8", marginTop: 1 }}>
                            {[r.campo && `Campo ${r.campo}`, r.cuenca, r.ubicacion,
                              r.codigo && r.codigo !== r.nombre ? r.codigo : null]
                              .filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: 10, color: "#94a3b8", flexShrink: 0 }}>
                        {destinos.length} tema{destinos.length === 1 ? "" : "s"}
                      </span>
                    </button>
                    {abiertoEste && (
                      <div style={{ padding: "2px 0 8px" }}>
                        {destinos.length === 0 && (
                          <p style={{ margin: 0, padding: "4px 14px 4px 28px", fontSize: 11, color: "#94a3b8" }}>
                            Sin temas disponibles.
                          </p>
                        )}
                        {destinos.map(d => (
                          <button
                            key={d.jsonArg}
                            onClick={() => abrirTema(r, d)}
                            style={{
                              display: "block", width: "100%", textAlign: "left",
                              padding: "5px 14px 5px 28px", background: "none", border: "none",
                              cursor: "pointer", fontSize: 11.5, color: "#0f766e",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = "#f1f5f9"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
                          >
                            {d.etiqueta}
                            <span style={{ color: "#94a3b8", marginLeft: 6 }}>· {acentuarTema(d.seccion)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
