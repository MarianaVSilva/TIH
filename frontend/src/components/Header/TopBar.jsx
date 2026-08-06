import { useState, useEffect, useRef } from "react";
import { useExplorer } from "../../store/useExplorer";
import { useChartData } from "../../hooks/useChartData";
import { fetchTemas, fetchPerforacionFiltros, fetchProduccionFiltros } from "../../api/client";
import "../../styles/header.css";

// ── Custom Select ─────────────────────────────────────────────────────────────
function CustomSelect({ value, onChange, options, placeholder, minWidth = 140, small = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = options.find(o => (o.value ?? o) === value);
  const label = selected ? (selected.label ?? selected) : placeholder ?? "— seleccionar —";

  return (
    <div ref={ref} className="tih-cselect" style={{ minWidth }} data-small={small || undefined}>
      <button
        type="button"
        className={`tih-cselect__trigger${open ? " tih-cselect__trigger--open" : ""}${!selected ? " tih-cselect__trigger--placeholder" : ""}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="tih-cselect__value">{label}</span>
        <svg className="tih-cselect__chevron" viewBox="0 0 16 16" fill="none">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <ul className="tih-cselect__menu">
          {placeholder !== undefined && (
            <li className="tih-cselect__option tih-cselect__option--placeholder"
                onClick={() => { onChange(null); setOpen(false); }}>
              {placeholder}
            </li>
          )}
          {options.map((o, i) => {
            const val = o.value ?? o;
            const lbl = o.label ?? o;
            return (
              <li key={i}
                className={`tih-cselect__option${val === value ? " tih-cselect__option--active" : ""}`}
                onClick={() => { onChange(val); setOpen(false); }}>
                {val === value && <span className="tih-cselect__check">✓</span>}
                {lbl}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const year = new Date().getFullYear();
const YEARS = Array.from({ length: year - 1959 }, (_, i) => year - i);
const PERFORACION_TOPICS = new Set(["PozPerf", "PozTerm", "EqPerf", "PozosCampos"]);
// Temas de Producción con dimensión Cuenca/Ambiente real (comparten el mismo
// universo de filtros que "Cuenca" — API/Gcompo/Campos/Asignaciones solo
// agregan otra hoja bajo Producto). "Gcompo"/"Campos"/"Asignaciones" son
// Nacional sin clasificación por defecto; al elegir Ambiente/Cuenca se activa
// el drill-down Ambiente→Cuenca→Producto→hoja.
const PRODUCCION_HIER_TOPICS = new Set(["Cuenca", "API", "Operadores", "Gcompo", "Campos", "Asignaciones"]);
// Contrato: mismo diseño Nacional → Producto → hoja, pero sin dimensión
// Cuenca/Ambiente que filtrar — no lleva drawer de filtros, solo chips de producto.
const PRODUCTO_FLAT_TOPICS = new Set(["Contratos"]);
const PRODUCCION_SECCIONES = new Set(["Producción", "Produccion"]);

// ── Selector de rango de años ─────────────────────────────────────────────────
function YearRangeSelector({ startYear, endYear, onChangeStart, onChangeEnd }) {
  const startOptions = YEARS.filter(y => endYear == null || y <= endYear).map(y => ({ value: y, label: String(y) }));
  const endOptions   = YEARS.filter(y => startYear == null || y >= startYear).map(y => ({ value: y, label: String(y) }));

  return (
    <div className="flex items-center gap-1.5">
      <CustomSelect small value={startYear} onChange={v => onChangeStart(v == null ? null : +v)} options={startOptions} placeholder="–" minWidth={76} />
      <span className="text-slate-400 text-xs font-medium select-none">—</span>
      <CustomSelect small value={endYear}   onChange={v => onChangeEnd(v == null ? null : +v)}   options={endOptions}   placeholder="–" minWidth={76} />
    </div>
  );
}

// ── DrawerSection: lista de checkboxes con título y búsqueda opcional ────────
function DrawerSection({ titulo, opciones, seleccionados, onChange, conBusqueda = false, expandir = false }) {
  const [busqueda, setBusqueda] = useState("");
  const masterRef = useRef(null);

  const toggle = (op) => {
    const next = seleccionados.includes(op)
      ? seleccionados.filter(s => s !== op)
      : [...seleccionados, op];
    onChange(next);
  };

  const visibles = conBusqueda && busqueda
    ? opciones.filter(o => o.toLowerCase().includes(busqueda.toLowerCase()))
    : opciones;

  const allSelected  = opciones.length > 0 && opciones.every(o => seleccionados.includes(o));
  const someSelected = seleccionados.length > 0 && !allSelected;

  useEffect(() => {
    if (masterRef.current) masterRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleAll = () => onChange(allSelected ? [] : [...opciones]);

  return (
    <div style={expandir ? { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 } : undefined}>
      {titulo && (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 10, padding: "7px 12px", borderRadius: 6,
          background: "#1a4e40",
        }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              ref={masterRef}
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              style={{ accentColor: "#5eead4" }}
              title={allSelected ? "Deseleccionar todos" : "Seleccionar todos"}
            />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#fff",
                        textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {titulo}
            </span>
          </label>
          {seleccionados.length > 0 && (
            <button
              onClick={() => onChange([])}
              style={{ fontSize: 11, color: "#5eead4", background: "none",
                       border: "none", cursor: "pointer", padding: 0 }}
            >
              Limpiar
            </button>
          )}
        </div>
      )}
      {conBusqueda && (
        <input
          placeholder="Buscar…"
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          style={{
            width: "100%", border: "1px solid #e2e8f0", borderRadius: 6,
            padding: "6px 10px", fontSize: 12, marginBottom: 8,
            outline: "none", boxSizing: "border-box",
            color: "#1f2937", background: "#fff",
          }}
        />
      )}
      <div style={expandir
        ? { display: "flex", flexDirection: "column", gap: 2, flex: 1, minHeight: 0, overflowY: "auto" }
        : {
            display: "flex", flexDirection: "column", gap: 2,
            maxHeight: conBusqueda ? 180 : "none", overflowY: conBusqueda ? "auto" : "visible",
          }}>
        {visibles.map(op => {
          const checked = seleccionados.includes(op);
          return (
            <label key={op} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "5px 6px", borderRadius: 5, cursor: "pointer",
              background: checked ? "#f0fdfa" : "transparent",
              fontSize: 12.5, color: checked ? "#0f766e" : "#374151",
              fontWeight: checked ? 500 : 400,
            }}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(op)}
                style={{ accentColor: "#0d9488" }}
              />
              {op}
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ── PerfDrawer: panel lateral deslizable con todos los filtros ────────────────
function PerfDrawer({ open, onClose, perfOpciones, perfFiltros, setPerfFiltros, esPozosCampos }) {
  if (!perfOpciones) return null;
  const labelOperador = esPozosCampos ? "Campo" : "Operador";

  const limpiarTodo = () => setPerfFiltros({
    cuencas: [], categorias: [], ubicaciones: [], operadores: [],
  });

  return (
    <>
      {open && (
        <div
          role="presentation"
          onClick={onClose}
          className="fixed inset-0 bg-black/25 z-[1000]"
        />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Filtros de perforación"
        className={`fixed top-0 right-0 bottom-0 w-80 bg-white shadow-[-4px_0_24px_rgba(0,0,0,0.12)] z-[1001] flex flex-col overflow-y-auto transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <span className="font-bold text-sm text-slate-900">
            Filtros de perforación
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={limpiarTodo}
              className="text-[11px] text-tih-teal hover:underline bg-transparent border-none cursor-pointer p-0"
            >
              Limpiar todo
            </button>
            <button
              onClick={onClose}
              aria-label="Cerrar filtros"
              className="text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer text-lg leading-none px-1"
            >
              ×
            </button>
          </div>
        </div>

        {/* Secciones */}
        <div className="p-5 flex flex-col gap-6">
          <DrawerSection
            titulo="Cuenca Geológica"
            opciones={perfOpciones.cuencas}
            seleccionados={perfFiltros.cuencas}
            onChange={(vals) => setPerfFiltros({ cuencas: vals })}
          />
          <DrawerSection
            titulo={esPozosCampos ? "Tipo" : "Categoría"}
            opciones={perfOpciones.categorias}
            seleccionados={perfFiltros.categorias}
            onChange={(vals) => setPerfFiltros({ categorias: vals })}
          />
          <DrawerSection
            titulo="Ambiente"
            opciones={perfOpciones.ubicaciones}
            seleccionados={perfFiltros.ubicaciones}
            onChange={(vals) => setPerfFiltros({ ubicaciones: vals })}
          />

          {/* Operador / Campo */}
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.06em] mb-2.5">
              {labelOperador}
            </p>
            {!esPozosCampos && (
              <div className="flex gap-1.5 mb-2.5 flex-wrap">
                {[
                  { id: "todos",    label: "Todos" },
                  { id: "pemex",    label: "Pemex" },
                  { id: "privados", label: "Privados" },
                ].map(({ id, label }) => {
                  const activo =
                    id === "todos"    ? perfFiltros.operadores.length === 0 :
                    id === "pemex"    ? (perfFiltros.operadores.length > 0 &&
                                         perfFiltros.operadores.every(o => o.startsWith("Pemex"))) :
                    id === "privados" ? (perfFiltros.operadores.length > 0 &&
                                         perfFiltros.operadores.every(o => !o.startsWith("Pemex"))) :
                    false;
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        if (id === "todos") setPerfFiltros({ operadores: [] });
                        else if (id === "pemex")
                          setPerfFiltros({ operadores: perfOpciones.operadores.filter(o => o.startsWith("Pemex")) });
                        else
                          setPerfFiltros({ operadores: perfOpciones.operadores.filter(o => !o.startsWith("Pemex")) });
                      }}
                      className={`px-3 py-1 rounded-full text-xs cursor-pointer border transition-colors min-h-[36px] ${
                        activo
                          ? "border-tih-teal bg-tih-teal text-white font-semibold"
                          : "border-slate-200 bg-white text-slate-500 hover:border-tih-teal hover:text-tih-teal"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            <DrawerSection
              opciones={perfOpciones.operadores}
              seleccionados={perfFiltros.operadores}
              onChange={(vals) => setPerfFiltros({ operadores: vals })}
              conBusqueda
            />
          </div>
        </div>

        {/* Footer */}
        <div className="mt-auto px-5 py-4 border-t border-slate-200 shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg bg-tih-dark text-white text-sm font-semibold hover:bg-tih-mid transition-colors cursor-pointer border-none"
          >
            Aplicar y cerrar
          </button>
        </div>
      </div>
    </>
  );
}

// ── ProdDrawer: filtro de cuenca/ambiente para los temas de Producción con
// esa dimensión (Cuenca, Campos, API) — el producto ya se elige en las
// chips de series (Petróleo/Condensado/Gas/etc.), no aquí ─────────────────
function ProdDrawer({ open, onClose, prodOpciones, prodFiltros, setProdFiltros, esOperadores }) {
  return (
    <>
      {open && (
        <div role="presentation" onClick={onClose} className="fixed inset-0 bg-black/25 z-[1000]" />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Filtros de producción"
        className={`fixed top-0 right-0 bottom-0 w-80 bg-white shadow-[-4px_0_24px_rgba(0,0,0,0.12)] z-[1001] flex flex-col transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <span className="font-bold text-sm text-slate-900">Filtros de producción</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setProdFiltros({ cuencas: [], ubicaciones: [] })}
              className="text-[11px] text-tih-teal hover:underline bg-transparent border-none cursor-pointer p-0"
            >
              Limpiar todo
            </button>
            <button
              onClick={onClose}
              aria-label="Cerrar filtros"
              className="text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer text-lg leading-none px-1"
            >
              ×
            </button>
          </div>
        </div>
        <div className="p-5 flex flex-col gap-6 flex-1 min-h-0 overflow-y-auto">
          {esOperadores ? (
            <div className="flex-1 min-h-0 flex flex-col">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.06em] mb-2.5">Operador</p>
              <div className="flex gap-1.5 mb-2.5 flex-wrap">
                {[
                  { id: "todos",    label: "Todos" },
                  { id: "pemex",    label: "Pemex" },
                  { id: "privados", label: "Privados" },
                ].map(({ id, label }) => {
                  const activo =
                    id === "todos"    ? prodFiltros.cuencas.length === 0 :
                    id === "pemex"    ? prodFiltros.cuencas.length === 1 && prodFiltros.cuencas[0] === "Pemex Exploración y Producción" :
                    prodFiltros.cuencas.length === 1 && prodFiltros.cuencas[0] === "Privadas";
                  return (
                    <button
                      key={id}
                      onClick={() => setProdFiltros({
                        // El grupo se combina con las empresas puntuales elegidas
                        // abajo (p. ej. Pemex + ENI México), no las reemplaza.
                        cuencas: id === "todos" ? [] : id === "pemex" ? ["Pemex Exploración y Producción"] : ["Privadas"],
                      })}
                      className={`px-3 py-1 rounded-full text-xs cursor-pointer border transition-colors min-h-[36px] ${
                        activo
                          ? "border-tih-teal bg-tih-teal text-white font-semibold"
                          : "border-slate-200 bg-white text-slate-500 hover:border-tih-teal hover:text-tih-teal"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <DrawerSection
                opciones={prodOpciones?.empresas ?? []}
                seleccionados={prodFiltros.ubicaciones}
                onChange={(vals) => setProdFiltros({ ubicaciones: vals })}
                conBusqueda
                expandir
              />
            </div>
          ) : (
            <>
              <DrawerSection
                titulo="Cuenca Geológica"
                opciones={prodOpciones?.cuencas ?? []}
                seleccionados={prodFiltros.cuencas}
                onChange={(vals) => setProdFiltros({ cuencas: vals })}
              />
              <DrawerSection
                titulo="Ambiente"
                opciones={prodOpciones?.ubicaciones ?? []}
                seleccionados={prodFiltros.ubicaciones}
                onChange={(vals) => setProdFiltros({ ubicaciones: vals })}
              />
            </>
          )}
        </div>
        <div className="mt-auto px-5 py-4 border-t border-slate-200 shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg bg-tih-dark text-white text-sm font-semibold hover:bg-tih-mid transition-colors cursor-pointer border-none"
          >
            Aplicar y cerrar
          </button>
        </div>
      </div>
    </>
  );
}

// ── TopBar principal ──────────────────────────────────────────────────────────
export default function TopBar() {
  const {
    temas, setTemas,
    seccion, setSeccion,
    tema, setTema,
    period, setPeriod,
    start_year, end_year,
    start_month, end_month,
    setFiltro,
    setResultado,
    perfFiltros, setPerfFiltros,
    perfOpciones, setPerfOpciones,
    prodFiltros, setProdFiltros,
    prodOpciones, setProdOpciones,
    setGroupBy,
    compareMode, setCompareMode, compareYearA, compareYearB, setCompareYears,
  } = useExplorer();

  const { consultar } = useChartData();

  const isPerf = PERFORACION_TOPICS.has(tema?.json_arg);
  const isProd = PRODUCCION_SECCIONES.has(tema?.seccion);
  const isProdHier = PRODUCCION_HIER_TOPICS.has(tema?.json_arg);
  const [prodDrawerOpen, setProdDrawerOpen] = useState(false);
  const pendingTopicSync = useRef(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filtrosCleared, setFiltrosCleared] = useState(false);

  // Clic simple abre el drawer; doble clic limpia todos los filtros.
  // Se detecta con temporizador porque el drawer (y su overlay) se abriría en
  // el primer clic y bloquearía el segundo, impidiendo el onDoubleClick nativo.
  const filtrosClickTimer = useRef(null);
  const handleFiltrosClick = () => {
    if (filtrosClickTimer.current) {
      clearTimeout(filtrosClickTimer.current);
      filtrosClickTimer.current = null;
      setPerfFiltros({ cuencas: [], categorias: [], ubicaciones: [], operadores: [] });
      setDrawerOpen(false);
      setFiltrosCleared(true);
      setTimeout(() => setFiltrosCleared(false), 550);
    } else {
      filtrosClickTimer.current = setTimeout(() => {
        filtrosClickTimer.current = null;
        setDrawerOpen(true);
      }, 250);
    }
  };

  const hayFiltrosActivos = (
    perfFiltros.cuencas.length +
    perfFiltros.categorias.length +
    perfFiltros.ubicaciones.length +
    perfFiltros.operadores.length
  ) > 0;

  const contadorFiltros = (
    perfFiltros.cuencas.length +
    perfFiltros.categorias.length +
    perfFiltros.ubicaciones.length +
    (perfFiltros.operadores.length > 0 ? 1 : 0)
  );

  const contadorFiltrosProd = (
    prodFiltros.cuencas.length + prodFiltros.ubicaciones.length
  );

  useEffect(() => {
    fetchTemas().then(setTemas).catch(() => {});
  }, []);

  useEffect(() => {
    if (isProdHier && !prodOpciones) {
      fetchProduccionFiltros().then(setProdOpciones).catch(() => {});
    }
  }, [isProdHier, prodOpciones]);

  // "Producción por ubicación" (Cuenca): vista inicial con las dos categorías
  // de filtros (Cuenca Geológica y Ambiente) totalmente prendidas — arranca
  // ya en el drill-down completo, en vez de la vista Nacional sin clasificar.
  useEffect(() => {
    if (tema?.json_arg !== "Cuenca" || !prodOpciones) return;
    setProdFiltros({ cuencas: prodOpciones.cuencas, ubicaciones: prodOpciones.ubicaciones });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prodOpciones, tema?.json_arg === "Cuenca"]);

  // "cuencas"/"ubicaciones" en prodFiltros tiene un significado distinto por
  // tema (cuencas geológicas reales en Cuenca/Campos/Asignaciones/Gcompo,
  // pero Grupo Pemex/Privadas en Operadores) — al salir de "Cuenca" con su
  // default de todas prendidas, hay que limpiar para no contaminar el
  // siguiente tema con una selección que no le pertenece.
  useEffect(() => {
    if (tema?.json_arg === "Cuenca") return;
    if (prodFiltros.cuencas.length || prodFiltros.ubicaciones.length) {
      setProdFiltros({ cuencas: [], ubicaciones: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tema?.json_arg]);

  // groupBy para Producción (Campos/API), igual patrón que perforación pero en
  // base a prodFiltros. "Cuenca" arma su propia jerarquía producto-primero en
  // ChartArea (vía "filtros", no "groupBy"), por eso se fuerza a null.
  // "Operadores" sin un solo grupo elegido (ni empresas específicas) muestra
  // la vista Nacional (producto → Pemex/Privadas); al filtrar por exactamente
  // uno de los dos grupos, o por una o más empresas puntuales (reutiliza
  // "ubicaciones", sin uso propio en Operadores), pasa a "cuenca" para listar
  // esas empresas (Producto → Contrato dentro de cada una).
  useEffect(() => {
    if (!isProdHier) return;
    const target = tema?.json_arg === "Cuenca" ? null :
      tema?.json_arg === "Operadores" ? ((prodFiltros.cuencas.length === 1 || prodFiltros.ubicaciones.length > 0) ? "cuenca" : null) :
      prodFiltros.ubicaciones.length ? "ubicacion" :
      prodFiltros.cuencas.length     ? "cuenca"    :
      null;
    setGroupBy(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prodFiltros, isProdHier, tema?.json_arg]);

  // Contrato: sin dimensión Cuenca/Ambiente que filtrar, siempre vista
  // Nacional → Producto → hoja (groupBy null).
  useEffect(() => {
    if (PRODUCTO_FLAT_TOPICS.has(tema?.json_arg)) setGroupBy(null);
  }, [tema?.json_arg]);

  // "Producción por Entidad Federativa": jerarquía fija Entidad → Producto →
  // Ambiente (cada entidad es su propio grupo colapsable, sin filtro que
  // elegir) — mismo patrón que la vista "por empresa" de Operadores.
  useEffect(() => {
    if (tema?.json_arg === "Estado") setGroupBy("cuenca");
  }, [tema?.json_arg]);

  // Cada topic de perforación trae sus propias opciones de filtro, así que se
  // recarga por json_arg y no solo la primera vez.
  useEffect(() => {
    if (isPerf) {
      pendingTopicSync.current = true;
      setPerfOpciones(null);
      fetchPerforacionFiltros(tema.json_arg).then(setPerfOpciones).catch(() => {});
    } else if (perfFiltros.cuencas.length || perfFiltros.categorias.length || perfFiltros.ubicaciones.length || perfFiltros.operadores.length) {
      setPerfFiltros({ cuencas: [], categorias: [], ubicaciones: [], operadores: [] }); // referencia nueva solo si algo cambió: evita un fetch de más
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPerf, tema?.json_arg]);

  // Auto-fetch cuando cambia tema, filtros de fecha o filtros de perforación
  useEffect(() => {
    if (!tema) return;
    if (pendingTopicSync.current) return; // ubicaciones por defecto aún no sincronizadas: evita doble fetch
    if (start_year == null || end_year == null) {
      setResultado(null);
      return;
    }
    consultar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tema, period, start_year, end_year, start_month, end_month, perfFiltros, prodFiltros]);

  // groupBy = nivel más externo activo (jerarquía Ambiente > Cuenca > Categoría).
  // Alimenta los chips de series y las gráficas; la tabla anida multinivel por sí sola.
  useEffect(() => {
    if (!isPerf) return;
    const target =
      perfFiltros.ubicaciones.length ? "ubicacion" :
      perfFiltros.cuencas.length     ? "cuenca"    :
      perfFiltros.categorias.length  ? "plan"      :
      perfFiltros.operadores.length  ? "operador"  :
      null;
    setGroupBy(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfFiltros, isPerf]);

  // Vista inicial de perforación: pre-marcar todos los ambientes en el filtro
  // (la tabla arranca agrupada por ambiente; al desmarcarlos vuelve a Nacional).
  useEffect(() => {
    if (!isPerf || !perfOpciones) return;
    pendingTopicSync.current = false;
    setPerfFiltros({ cuencas: [], categorias: [], ubicaciones: perfOpciones.ubicaciones, operadores: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfOpciones, isPerf]); // sin "tema": debe esperar a que perfOpciones sea el de este topic

  const secciones = [...new Set(temas.map(t => t.seccion))].sort();
  const temasFiltrados = temas.filter(t => t.seccion === seccion);

  return (
    <header className="tih-header">

      {/* ── Banda de marca ── */}
      <div className="tih-header__brand">
        <div className="tih-header__logo">
          <img src="/logosener-blanco.png" alt="Secretaría de Energía" />
        </div>
        <div className="tih-header__divider" />
        <div className="tih-header__identity">
          <span className="tih-header__sigla">TIH</span>
          <span className="tih-header__subtitle">
            Tablero de Información de Hidrocarburos
          </span>
        </div>
        <div className="tih-header__spacer" />
      </div>

      {/* ── Sección: pills ── */}
      <div className="tih-filterbar">
        <div className="tih-filterbar__pills-row">
          <button
            className="tih-pill"
            title="Panorama general"
            aria-label="Ir a Panorama general"
            onClick={() => { setSeccion(""); setTema(null); }}
            style={{ paddingLeft: 14, paddingRight: 14 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
              <path d="M3 11l9-8 9 8" />
              <path d="M5 10v10a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-5h4v5a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V10" />
            </svg>
          </button>
          {secciones.map(s => (
            <button
              key={s}
              className={`tih-pill${seccion === s ? " tih-pill--active" : ""}`}
              onClick={() => setSeccion(seccion === s ? "" : s)}
            >
              {s}
            </button>
          ))}
        </div>

        {/* ── Fila de filtros ── */}
        {seccion && (
          <div className="tih-filterbar__filters-row">

            {/* Tema */}
            <div className="tih-filterbar__group">
              <span className="tih-filterbar__label--dark">Tema</span>
              <CustomSelect
                value={tema?.tema ?? null}
                placeholder="— seleccionar —"
                options={temasFiltrados.map(t => ({ value: t.tema, label: t.tema }))}
                onChange={v => setTema(v ? temasFiltrados.find(t => t.tema === v) ?? null : null)}
                minWidth={210}
              />
            </div>

            <div className="tih-filterbar__sep--dark" />

            {/* Periodicidad */}
            <div className="tih-filterbar__group">
              <span className="tih-filterbar__label--dark">Periodicidad</span>
              <div className="tih-filterbar__radios--dark">
                {[["annually", "Anual"], ["monthly", "Mensual"]].map(([val, lbl]) => (
                  <label key={val} className="tih-filterbar__radio-label--dark">
                    <input
                      type="radio"
                      name="period"
                      value={val}
                      checked={period === val}
                      onChange={() => setPeriod(val)}
                    />
                    {lbl}
                  </label>
                ))}
              </div>
            </div>

            <div className="tih-filterbar__sep--dark" />

            {/* Período */}
            <div className="tih-filterbar__group">
              <span className="tih-filterbar__label--dark">Período</span>
              <div className="flex items-center gap-1">
                <YearRangeSelector
                  startYear={start_year}
                  endYear={end_year}
                  onChangeStart={v => setFiltro(end_year == null ? { start_year: v, end_year: v } : { start_year: v })}
                  onChangeEnd={v => setFiltro(start_year == null ? { start_year: v, end_year: v } : { end_year: v })}
                />
                {start_year !== end_year && (
                  <button
                    type="button"
                    onClick={() => setFiltro({ start_year: null, end_year: null })}
                    title="Limpiar años"
                    aria-label="Limpiar rango de años"
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", color: "rgba(255,255,255,0.4)" }}
                    onMouseEnter={e => e.currentTarget.style.color = "#fff"}
                    onMouseLeave={e => e.currentTarget.style.color = "rgba(255,255,255,0.4)"}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/>
                      <line x1="10" y1="11" x2="10" y2="17"/>
                      <line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Meses (solo en modo mensual) */}
            {period === "monthly" && (
              <>
                <div className="tih-filterbar__group">
                  <span className="tih-filterbar__label--dark">Mes inicio</span>
                  <CustomSelect small
                    value={start_month}
                    options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))}
                    onChange={v => setFiltro({ start_month: +v })}
                    minWidth={82}
                  />
                </div>
                <div className="tih-filterbar__group">
                  <span className="tih-filterbar__label--dark">Mes fin</span>
                  <CustomSelect small
                    value={end_month}
                    options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))}
                    onChange={v => setFiltro({ end_month: +v })}
                    minWidth={82}
                  />
                </div>
              </>
            )}

            {/* ── Botón Filtros para temas de perforación ── */}
            {isPerf && (
              <div className="tih-filterbar__group">
                <button
                  className={`tih-filterbar__select--light flex items-center justify-center gap-1.5 cursor-pointer px-3 ${
                    hayFiltrosActivos ? "!bg-tih-teal !text-white !border-tih-teal" : ""
                  } ${filtrosCleared ? "tih-filtros-clear-anim" : ""}`}
                  title="Clic: abrir filtros · Doble clic: limpiar todos"
                  onClick={handleFiltrosClick}
                >
                  {filtrosCleared ? (
                    <svg key="check" className="tih-filtros-clear-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5eead4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                    </svg>
                  )}
                  {filtrosCleared ? "Limpio" : "Filtros"}
                  {hayFiltrosActivos && (
                    <span className="bg-white text-tih-teal rounded-full text-[10px] font-bold px-1.5 min-w-[16px] text-center">
                      {contadorFiltros}
                    </span>
                  )}
                </button>
              </div>
            )}

            {/* ── Filtros para temas de Producción con cuenca/ambiente (Cuenca, Campos, API) ──
                 "Operadores" lo usa para el filtro de Producto (Grupo Pemex/Privadas ya
                 se puede alternar desde las chips de Series). ── */}
            {isProdHier && (
              <div className="tih-filterbar__group">
                <button
                  className={`tih-filterbar__select--light flex items-center justify-center gap-1.5 cursor-pointer px-3 ${
                    contadorFiltrosProd ? "!bg-tih-teal !text-white !border-tih-teal" : ""
                  }`}
                  onClick={() => setProdDrawerOpen(true)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                  </svg>
                  Filtros
                  {contadorFiltrosProd > 0 && (
                    <span className="bg-white text-tih-teal rounded-full text-[10px] font-bold px-1.5 min-w-[16px] text-center">
                      {contadorFiltrosProd}
                    </span>
                  )}
                </button>
              </div>
            )}

          </div>
        )}
      </div>
      <PerfDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        perfOpciones={perfOpciones}
        perfFiltros={perfFiltros}
        setPerfFiltros={setPerfFiltros}
        esPozosCampos={tema?.json_arg === "PozosCampos"}
      />
      <ProdDrawer
        open={prodDrawerOpen}
        onClose={() => setProdDrawerOpen(false)}
        prodOpciones={prodOpciones}
        prodFiltros={prodFiltros}
        setProdFiltros={setProdFiltros}
        esOperadores={tema?.json_arg === "Operadores"}
      />
    </header>
  );
}
