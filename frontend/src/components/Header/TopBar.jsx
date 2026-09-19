import { useState, useEffect, useRef } from "react";
import { useExplorer } from "../../store/useExplorer";
import { useChartData } from "../../hooks/useChartData";
import { fetchTemas, fetchPerforacionFiltros, fetchProduccionFiltros, fetchRangoAnios } from "../../api/client";
import { acentuarTema } from "../../utils/acentuarTema";
import BuscadorGlobal from "./BuscadorGlobal";
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

// Nombres vienen tal cual de la BD, sin acentos (y a veces en minúsculas) —
// se corrigen solo en pantalla, sin tocar la BD.
// ── Selector de rango de años ─────────────────────────────────────────────────
function YearRangeSelector({ startYear, endYear, onChangeStart, onChangeEnd, years }) {
  // `years`: rango real con datos para el tema activo (ver rango-anios en
  // TopBar). Sin eso (cargando, o tema sin mapear en el backend) se usa la
  // lista genérica 1960–hoy de siempre, para no dejar el selector vacío.
  const lista = years ?? YEARS;
  const startOptions = lista.filter(y => endYear == null || y <= endYear).map(y => ({ value: y, label: String(y) }));
  const endOptions   = lista.filter(y => startYear == null || y >= startYear).map(y => ({ value: y, label: String(y) }));

  return (
    <div className="flex items-center gap-1.5">
      <CustomSelect small value={startYear} onChange={v => onChangeStart(v == null ? null : +v)} options={startOptions} placeholder="–" minWidth={76} />
      <span className="text-slate-400 text-xs font-medium select-none">—</span>
      <CustomSelect small value={endYear}   onChange={v => onChangeEnd(v == null ? null : +v)}   options={endOptions}   placeholder="–" minWidth={76} />
    </div>
  );
}

// ── Selector de rango de fechas (calendario) ─────────────────────────────────
const DAY_LABELS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
const MONTH_LABELS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const pad2 = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fromISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const fmtDMY = (s) => { if (!s) return ""; const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };

// dd/mm/aaaa escrito a mano -> ISO, o null si no es una fecha válida (se
// valida contra el calendario real, no solo el formato, para no aceptar
// "31/02/2026").
function parseDMY(text) {
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m.map(Number);
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return toISO(date);
}

// Campo de fecha "dd/mm/aaaa" editable a mano (además del calendario) — con
// rangos largos, navegar mes a mes con el picker para llegar a una fecha
// lejana es lento; escribirla directo es más rápido. Solo confirma el
// cambio si el texto es una fecha válida; si no, vuelve al valor anterior.
function DateTextInput({ iso, onCommit, onFocus, placeholder }) {
  const [text, setText] = useState(fmtDMY(iso));
  useEffect(() => { setText(fmtDMY(iso)); }, [iso]);

  const commit = () => {
    if (!text.trim()) return;
    const parsed = parseDMY(text);
    if (parsed) onCommit(parsed);
    else setText(fmtDMY(iso)); // inválido: revierte
  };

  return (
    <input
      type="text"
      value={text}
      placeholder={placeholder}
      onFocus={onFocus}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
      className="tih-filterbar__select--light px-2.5 py-1 text-[11.5px] min-w-[76px] text-left"
    />
  );
}

function DateRangeSelector({ startDate, endDate, onChange }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState("start"); // qué extremo define el próximo clic
  const today = new Date();
  const [viewMonth, setViewMonth] = useState(() => {
    const base = endDate ? fromISO(endDate) : today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const firstOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7; // lunes = 0
  const cells = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const pickDay = (day) => {
    const picked = toISO(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day));
    if (phase === "start" || !startDate) {
      onChange({ start: picked, end: null });
      setPhase("end");
    } else {
      if (picked < startDate) onChange({ start: picked, end: startDate });
      else onChange({ start: startDate, end: picked });
      setPhase("start");
      setOpen(false);
    }
  };

  const isInRange = (iso) => startDate && endDate && iso >= startDate && iso <= endDate;

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-1.5">
        <DateTextInput iso={startDate} placeholder="dd/mm/aaaa"
          onFocus={() => { setPhase("start"); setOpen(true); }}
          onCommit={(iso) => onChange(endDate && iso > endDate ? { start: iso, end: iso } : { start: iso, end: endDate })} />
        <span className="text-slate-400 text-xs font-medium select-none">—</span>
        <DateTextInput iso={endDate} placeholder="dd/mm/aaaa"
          onFocus={() => { setPhase("end"); setOpen(true); }}
          onCommit={(iso) => onChange(startDate && iso < startDate ? { start: iso, end: iso } : { start: startDate, end: iso })} />
        <button type="button" onClick={() => setOpen(o => !o)}
          title="Elegir en calendario"
          className="w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 shrink-0">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="4" width="14" height="13" rx="1.5" />
            <path d="M3 8h14M7 2v4M13 2v4" />
          </svg>
        </button>
      </div>
      {open && (
        <div className="absolute top-[calc(100%+6px)] left-0 z-[1002] bg-white rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.18)] border border-slate-200 p-3" style={{ width: 260 }}>
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              className="w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100">‹</button>
            <span className="text-[12.5px] font-semibold text-slate-700">
              {MONTH_LABELS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
            </span>
            <button type="button" onClick={() => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              className="w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100">›</button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {DAY_LABELS.map(d => (
              <span key={d} className="text-[10px] font-semibold text-slate-400 text-center py-1">{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) => {
              if (day == null) return <span key={i} />;
              const iso = toISO(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day));
              const isToday = iso === toISO(today);
              const isEdge = iso === startDate || iso === endDate;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => pickDay(day)}
                  className={`text-[11.5px] py-1.5 rounded transition-colors ${
                    isEdge ? "bg-tih-dark text-white font-semibold"
                      : isInRange(iso) ? "bg-teal-50 text-teal-800"
                      : isToday ? "bg-amber-100 text-slate-800 font-semibold"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
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
    ? opciones.filter(o => o.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(busqueda.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()))
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

// ── InvDrawer: filtro por cuenca (InvCuenca) o por Ronda/Farmouts/Migraciones
// (InvCont) — checklist de los grupos de primer nivel, wireado a
// visibleSeries/setAllVisible (mismo mecanismo que ya usan los chips de
// series en ChartArea, así que colapsar un grupo aquí lo colapsa ahí también).
function InvDrawer({ open, onClose, items, titulo }) {
  const { visibleSeries, setAllVisible } = useExplorer();
  if (!items?.length) return null;
  const seleccionados = items.filter(n => visibleSeries[n] !== false);

  return (
    <>
      {open && (
        <div role="presentation" onClick={onClose} className="fixed inset-0 bg-black/25 z-[1000]" />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Filtros"
        className={`fixed top-0 right-0 bottom-0 w-80 bg-white shadow-[-4px_0_24px_rgba(0,0,0,0.12)] z-[1001] flex flex-col overflow-y-auto transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <span className="font-bold text-sm text-slate-900">Filtros</span>
          <button
            onClick={onClose}
            aria-label="Cerrar filtros"
            className="text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer text-lg leading-none px-1"
          >
            ×
          </button>
        </div>
        <div className="p-5 flex flex-col gap-6">
          <DrawerSection
            titulo={titulo}
            opciones={items}
            seleccionados={seleccionados}
            onChange={(vals) => { setAllVisible(items, false); setAllVisible(vals, true); }}
          />
        </div>
        <div className="mt-auto px-5 py-4 border-t border-slate-200">
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
    start_date, end_date,
    setFiltro,
    pendingPeriodo, setPendingPeriodo,
    setResultado,
    perfFiltros, setPerfFiltros,
    perfOpciones, setPerfOpciones,
    prodFiltros, setProdFiltros, pendingProdFiltros, setPendingProdFiltros,
    prodOpciones, setProdOpciones,
    setGroupBy,
    compareMode, setCompareMode, compareYearA, compareYearB, setCompareYears,
    resultado, visibleSeries,
    reservasTipo, setReservasTipo,
    entidadesVisibles, setEntidadesVisibles,
  } = useExplorer();

  const { consultar } = useChartData();

  // true si CUBOS.PERIODICIDAD para este tema no incluye "Mensual" (p. ej.
  // Inversiones/Licitaciones — INVERSIONES_APROBADAS solo tiene ANIO, no mes).
  let soloAnual = false;
  try {
    const periodos = tema?.periodicidad ? JSON.parse(tema.periodicidad) : null;
    soloAnual = !!periodos && !("Mensual" in periodos);
  } catch { /* periodicidad mal formada: se asume que sí hay mensual */ }

  // Mensual sobre un rango largo pide una columna por mes (>60 columnas) y hace
  // que el backend agregue millones de registros: la consulta se vuelve
  // impracticable y muere por timeout. Se ofrece solo hasta 5 años.
  const MAX_ANIOS_MENSUAL = 5;
  const aniosSeleccionados =
    start_year != null && end_year != null ? end_year - start_year + 1 : 1;
  // Excepcion al tope: si la busqueda/filtros dejaron UNA sola entidad a la
  // vista, el motivo del tope desaparece —la consulta pesada era N entidades
  // por 60+ meses, y con N=1 no hay tal— asi que Mensual se ofrece completo.
  // Si el usuario limpia la busqueda estando en Mensual con rango largo, el
  // conteo vuelve a subir y el efecto de mas abajo lo regresa a Anual solo.
  //
  // El conteo lo publica la tabla y SOBREVIVE a que esta se desmonte mientras
  // se consulta: si se borrara al desmontar, elegir Mensual abriria un hueco
  // con el conteo en null en el que el tope se rearmaba solo, deshabilitando
  // el radio recien elegido y devolviendo el periodo a Anual antes de que
  // llegaran los datos. Se limpia al cambiar de tema (efecto mas abajo), que
  // es cuando de verdad deja de aplicar.
  const unaSolaEntidad = entidadesVisibles === 1;
  const rangoLargo = aniosSeleccionados > MAX_ANIOS_MENSUAL && !unaSolaEntidad;

  const isPerf = PERFORACION_TOPICS.has(tema?.json_arg);
  const isProd = PRODUCCION_SECCIONES.has(tema?.seccion);
  const isProdHier = PRODUCCION_HIER_TOPICS.has(tema?.json_arg);
  const isInv = ["InvCuenca", "InvCont", "PozosLic", "EfectivoLic", "InvLic", "EmpresasG", "ReservasP", "ReservasG", "ReservasPCE", "ReservasAsigP", "ReservasAsigG", "ReservasAsigPCE"].includes(tema?.json_arg);
  // Corte vigente, sin dimensión de año — a diferencia de InvCuenca/InvCont
  // (esos sí son series por año), el filtro de Periodo no les aplica.
  const esSnapshot = ["PozosLic", "EfectivoLic", "InvLic", "EmpresasG"].includes(tema?.json_arg);

  // Rango real de años CON DATOS para el tema activo (ver GET
  // /temas/rango-anios) — antes el selector de Periodo ofrecía siempre
  // 1960–hoy sin importar el tema; Reservas, por ejemplo, solo tiene datos
  // 2010–2024 y dejaba elegir años vacíos. null mientras carga o si el tema
  // no está mapeado en el backend: en ese caso YearRangeSelector cae a la
  // lista genérica de siempre (ver su propio fallback).
  const [rangoAnios, setRangoAnios] = useState(null);
  useEffect(() => {
    setRangoAnios(null);
    if (!tema?.json_arg || esSnapshot) return;
    let vigente = true;
    fetchRangoAnios(tema.json_arg).then(r => {
      if (vigente && r?.min_year != null && r?.max_year != null) setRangoAnios(r);
    }).catch(() => {});
    return () => { vigente = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tema?.json_arg]);
  const aniosDisponibles = rangoAnios
    ? Array.from({ length: rangoAnios.max_year - rangoAnios.min_year + 1 }, (_, i) => rangoAnios.max_year - i)
    : null; // null = usar la lista genérica (YEARS) dentro de YearRangeSelector

  const [invDrawerOpen, setInvDrawerOpen] = useState(false);
  // Nombres de los grupos de primer nivel (cuenca, o Ronda/Farmouts/
  // Migraciones) — vienen ya resueltos en resultado.groups, sin pedirle al
  // backend un catálogo aparte.
  const nombresGrupoInv = isInv
    ? (resultado?.groups ?? []).filter(g => g.cuenca !== "Total general").map(g => g.cuenca)
    : [];
  const contadorFiltrosInv = nombresGrupoInv.filter(n => visibleSeries[n] === false).length;
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
    if (soloAnual && period !== "annually") setPeriod("annually");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soloAnual, tema?.json_arg]);

  // El conteo de entidades es de la tabla del tema anterior: al cambiar de
  // tema deja de aplicar y se limpia, para que el tope no quede levantado por
  // una busqueda que ya no existe.
  useEffect(() => {
    setEntidadesVisibles(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tema?.json_arg]);

  // Si el rango se amplía a más de MAX_ANIOS_MENSUAL estando en Mensual, se
  // vuelve a Anual solo: deshabilitar el radio no basta, porque el rango puede
  // crecer desde los selectores de año (o al cambiar de tema) con Mensual ya
  // seleccionado, y se dispararía igual la consulta que queremos evitar.
  useEffect(() => {
    if (rangoLargo && period === "monthly") setPeriod("annually");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangoLargo, period]);

  // "Precios de petróleo y gas": al entrar al tema arranca en "Diario" con
  // los últimos 7 días (la semana), en vez de heredar Mensual/Anual de otro
  // tema — es el filtro que de verdad se usa para ver el precio del día.
  useEffect(() => {
    if (tema?.json_arg !== "Precios") return;
    const hoy = new Date();
    const hace7 = new Date(hoy);
    hace7.setDate(hoy.getDate() - 6);
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setPeriod("daily");
    setFiltro({ start_date: iso(hace7), end_date: iso(hoy) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tema?.json_arg]);

  // Reservas por campo y Reservas por asignación-contrato comparten las
  // pestañas Aceite/Gas/PCE (mismo estado global reservasTipo) — al entrar a
  // cualquiera de las dos arranca en Aceite, para no heredar la pestaña de
  // la otra familia si el usuario venía de ahí.
  useEffect(() => {
    if (["ReservasP", "ReservasG", "ReservasPCE"].includes(tema?.json_arg)) setReservasTipo("ReservasP");
    else if (["ReservasAsigP", "ReservasAsigG", "ReservasAsigPCE"].includes(tema?.json_arg)) setReservasTipo("ReservasAsigP");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tema?.json_arg]);

  // El año en curso casi nunca tiene dato todavía, y CUBOS.END_YEAR viene NULL
  // en varios temas (Reservas por campo entre ellos), así que no se puede saber
  // de antemano cuál es el último año con datos: hay que sondearlo pidiendo un
  // rango y quedándose con el último año que devuelva.
  //
  // La sonda son los últimos SONDA_ANIOS años, NO todo el histórico. Antes se
  // pedía desde init_year (1960 en Campos, 2005 en Pozos operando) hasta hoy,
  // y esa consulta —la más cara del tema, y desechada enseguida— se ejecutaba
  // completa cada vez que se entraba al tema. Si la sonda corta no encuentra
  // nada (tema cuyos datos terminaron hace años), se amplía al histórico
  // completo una sola vez, abajo.
  const SONDA_ANIOS = 3;
  // Tema cuyos filtros de Cuenca/Ambiente llegaron dirigidos desde una ficha
  // (no deben limpiarse mientras se siga en él).
  const prodFiltrosDirigidosRef = useRef(null);
  const anioAjustadoRef = useRef(null);
  const sondaAmpliadaRef = useRef(null);
  useEffect(() => {
    anioAjustadoRef.current = null;
    sondaAmpliadaRef.current = null;
    if (!tema) return;
    const anioActual = new Date().getFullYear();
    const initYear = tema.init_year ? Number(tema.init_year) : 2000;
    setFiltro({
      start_year: Math.max(initYear, anioActual - (SONDA_ANIOS - 1)),
      end_year: anioActual,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tema?.json_arg]);

  // Periodo dirigido (buscador global → una entidad que dejó de producir hace
  // años): manda sobre la sonda de arriba, y marca el año como ya ajustado
  // para que el efecto de abajo tampoco lo mueva al último año del TEMA.
  //
  // Va en su PROPIO efecto a propósito. Metido en el de arriba, limpiar la
  // bandera volvía a dispararlo —la bandera es una de sus dependencias— y esa
  // segunda pasada reponía el rango de la sonda, borrando el año dirigido.
  // Aquí se declara después, así que en el mismo commit corre al final y su
  // valor es el que queda.
  useEffect(() => {
    if (!tema || !pendingPeriodo || pendingPeriodo.tema !== tema.json_arg) return;
    anioAjustadoRef.current = tema.json_arg;
    sondaAmpliadaRef.current = tema.json_arg;
    setFiltro({ start_year: pendingPeriodo.anio, end_year: pendingPeriodo.anio });
    setPendingPeriodo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tema?.json_arg, pendingPeriodo]);

  useEffect(() => {
    if (period !== "annually" || !tema || anioAjustadoRef.current === tema.json_arg) return;
    const cats = resultado?.categories;
    if (!cats?.length) {
      // Llegó respuesta pero vacía: la sonda corta se quedó corta para este
      // tema. Se reintenta con todo el histórico, una sola vez por tema, para
      // no dejarlo en blanco.
      const initYear = tema.init_year ? Number(tema.init_year) : 2000;
      const anioActual = new Date().getFullYear();
      if (resultado && sondaAmpliadaRef.current !== tema.json_arg && start_year > initYear) {
        sondaAmpliadaRef.current = tema.json_arg;
        setFiltro({ start_year: initYear, end_year: anioActual });
      }
      return;
    }
    const maxCat = Number(cats[cats.length - 1]);
    if (!Number.isNaN(maxCat)) {
      anioAjustadoRef.current = tema.json_arg;
      setFiltro({ start_year: maxCat, end_year: maxCat });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultado, period, tema?.json_arg]);

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
    // Excepción: filtros traídos a propósito para ESTE tema al llegar desde una
    // ficha ("Ver producción completa…"). Sin esto la limpieza de abajo los
    // borraba en cuanto cambiaba el tema y la tabla volvía al agregado.
    // Se comprueba que exista: sin tema seleccionado, `null?.tema` y
    // `tema?.json_arg` son ambos undefined y la comparación daría verdadera.
    if (pendingProdFiltros && tema?.json_arg && pendingProdFiltros.tema === tema.json_arg) {
      prodFiltrosDirigidosRef.current = tema.json_arg;
      setProdFiltros(pendingProdFiltros.filtros);
      setPendingProdFiltros(null);
      return;
    }
    // Al vaciar la pendiente el efecto se vuelve a ejecutar; sin esta marca
    // caía en la limpieza de abajo y borraba los filtros recién puestos.
    if (prodFiltrosDirigidosRef.current === tema?.json_arg) return;
    if (tema?.json_arg === "Cuenca") return;
    if (prodFiltros.cuencas.length || prodFiltros.ubicaciones.length) {
      setProdFiltros({ cuencas: [], ubicaciones: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tema?.json_arg, pendingProdFiltros]);

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
  }, [tema, period, start_year, end_year, start_month, end_month, start_date, end_date, perfFiltros, prodFiltros, reservasTipo]);

  // Al entrar a "Diario", si aún no hay rango elegido se arranca con el mes en curso.
  useEffect(() => {
    if (period === "daily" && !start_date && !end_date) {
      const hoy = new Date();
      const inicioMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`;
      const hoyIso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
      setFiltro({ start_date: inicioMes, end_date: hoyIso });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

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

  // Orden fijo de las pills (pedido explícito), no alfabético. Los nombres de
  // la BD vienen sin acento ("Produccion", "Indicadores Economicos"); se
  // ordena por ese valor crudo y el acento se pone al pintar (acentuarTema).
  const ORDEN_SECCIONES = [
    "Produccion", "Producción",
    "Recursos y reservas",
    "Actividad petrolera",
    "Licitaciones y Contratos",
    "Indicadores Economicos", "Indicadores Económicos",
  ];
  const secciones = [...new Set(temas.map(t => t.seccion))].sort((a, b) => {
    const ia = ORDEN_SECCIONES.indexOf(a), ib = ORDEN_SECCIONES.indexOf(b);
    // Cualquier sección no listada cae al final, en orden alfabético.
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  // "Reservas por campo de gas/pce" quedan fuera del menú: son el mismo dato
  // que "Reservas por campo" (json_arg ReservasP), solo que con las pestañas
  // Aceite/Gas/PCE ahora se elige la columna sin necesitar 3 temas separados.
  const temasFiltrados = temas.filter(t => t.seccion === seccion && !["ReservasG", "ReservasPCE", "ReservasAsigG", "ReservasAsigPCE"].includes(t.json_arg));

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
              {s === "Indicadores Economicos" ? "Indicadores Económicos" : acentuarTema(s)}
            </button>
          ))}
          <BuscadorGlobal />
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
                // El nombre del tema viene tal cual de la BD (columna TEMA en
                // CUBOS), sin acentos — "petroleo" es el único typo real
                // reportado ahí, se corrige solo en pantalla sin tocar la BD.
                options={temasFiltrados.map(t => ({ value: t.tema, label: acentuarTema(t.tema) }))}
                onChange={v => setTema(v ? temasFiltrados.find(t => t.tema === v) ?? null : null)}
                minWidth={210}
              />
            </div>

            <div className="tih-filterbar__sep--dark" />

            {/* Periodicidad / Periodo: no aplican a los temas de corte vigente
                 (Pozos/Ofertas/Inversión comprometida — sin dimensión de año,
                 el filtro no cambiaba nada y confundía). */}
            {esSnapshot ? (
              <div className="tih-filterbar__group">
                <span className="tih-filterbar__label--dark">Periodo</span>
                <span className="text-xs text-white/70 font-medium">Corte vigente</span>
              </div>
            ) : (
              <>
                {/* Periodicidad */}
                <div className="tih-filterbar__group">
                  <span className="tih-filterbar__label--dark">Periodicidad</span>
                  <div className="tih-filterbar__radios--dark">
                    {[
                      ["annually", "Anual"],
                      // CUBOS.PERIODICIDAD trae qué periodos tiene sentido pedirle
                      // a cada tema (p. ej. Inversiones/Licitaciones solo Anual —
                      // ANIO es lo único que hay en INVERSIONES_APROBADAS, no hay
                      // mes) — si el tema no declara "Mensual" ahí, no se ofrece.
                      ...(soloAnual ? [] : [["monthly", "Mensual"]]),
                      // "Diario": solo tiene sentido en Precios (única fuente con
                      // un registro por día) — en el resto de los temas no hay
                      // datos a ese nivel de detalle.
                      ...(tema?.json_arg === "Precios" ? [["daily", "Diario"]] : []),
                    ].map(([val, lbl]) => {
                      // Mensual se deshabilita (no se oculta) en rangos largos:
                      // así se ve que la opción existe y por qué no está
                      // disponible, en vez de desaparecer sin explicación.
                      const deshabilitado = val === "monthly" && rangoLargo;
                      return (
                      <label
                        key={val}
                        className="tih-filterbar__radio-label--dark"
                        title={deshabilitado
                          ? `Disponible solo para rangos de hasta ${MAX_ANIOS_MENSUAL} años. Reduce el periodo, o busca un solo elemento en la tabla para verlo por mes sin límite.`
                          : undefined}
                        style={deshabilitado ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
                      >
                        <input
                          type="radio"
                          name="period"
                          value={val}
                          checked={period === val}
                          disabled={deshabilitado}
                          onChange={() => setPeriod(val)}
                        />
                        {lbl}
                      </label>
                      );
                    })}
                  </div>
                </div>

                <div className="tih-filterbar__sep--dark" />

                {/* Periodo */}
                {period === "daily" ? (
                  <div className="tih-filterbar__group">
                    <span className="tih-filterbar__label--dark">Fecha</span>
                    <DateRangeSelector
                      startDate={start_date}
                      endDate={end_date}
                      onChange={({ start, end }) => setFiltro({ start_date: start, end_date: end })}
                    />
                  </div>
                ) : (
                <div className="tih-filterbar__group">
                  <span className="tih-filterbar__label--dark">Periodo</span>
                  <div className="flex items-center gap-1">
                    <YearRangeSelector
                      startYear={start_year}
                      endYear={end_year}
                      years={aniosDisponibles}
                      onChangeStart={v => setFiltro(end_year == null ? { start_year: v, end_year: v } : { start_year: v })}
                      onChangeEnd={v => setFiltro(start_year == null ? { start_year: v, end_year: v } : { end_year: v })}
                    />
                    {period !== "monthly" && start_year !== end_year && (
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
                )}
              </>
            )}

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
                  <div className="flex items-center gap-1">
                    <CustomSelect small
                      value={end_month}
                      options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))}
                      onChange={v => setFiltro({ end_month: +v })}
                      minWidth={82}
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

            {/* ── Filtros para Inversiones por cuenca / por contrato ── */}
            {isInv && (
              <div className="tih-filterbar__group">
                <button
                  className={`tih-filterbar__select--light flex items-center justify-center gap-1.5 cursor-pointer px-3 ${
                    contadorFiltrosInv ? "!bg-tih-teal !text-white !border-tih-teal" : ""
                  }`}
                  onClick={() => setInvDrawerOpen(true)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                  </svg>
                  Filtros
                  {contadorFiltrosInv > 0 && (
                    <span className="bg-white text-tih-teal rounded-full text-[10px] font-bold px-1.5 min-w-[16px] text-center">
                      {contadorFiltrosInv}
                    </span>
                  )}
                </button>
              </div>
            )}

            {/* Slot al que ChartArea porta (React Portal) el switch "Ver como
                tablas/gráficos" y sus controles — ver .tih-filterbar__viewbar-slot. */}
            <div id="tih-viewbar-slot" className="tih-filterbar__viewbar-slot" />

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
      <InvDrawer
        open={invDrawerOpen}
        onClose={() => setInvDrawerOpen(false)}
        items={nombresGrupoInv}
        titulo={tema?.json_arg === "InvCuenca" ? "Cuenca"
          : tema?.json_arg === "EmpresasG" ? "País de origen"
          : ["PozosLic", "EfectivoLic", "InvLic"].includes(tema?.json_arg) ? "Modalidad" : "Ronda / Asociaciones / Migraciones"}
      />
    </header>
  );
}
