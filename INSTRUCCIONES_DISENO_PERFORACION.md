# Instrucciones: Rediseño visual de filtros y KPIs — Perforación

## Problema

La implementación actual de filtros de perforación quedó muy saturada:
- Los checkboxes de Categoría, Ubicación y el radio de Operador están todos en línea
  en la barra superior junto con los demás filtros → demasiado apretado
- Las 5 KPI cards con bordes blancos compiten visualmente con la tabla de abajo
- La barra de filtros ocupa demasiado espacio vertical y deja poco área útil de datos

## Cambio 1 — Filtros de perforación: de barra a drawer lateral

### Objetivo
Reemplazar los controles de Cuenca, Categoría, Ubicación y Operador que están inline
en `TopBar.jsx` por un botón "Filtros" que abre un panel lateral deslizable (drawer).

### En `TopBar.jsx`

Donde actualmente se renderizan los filtros de perforación (el bloque `{isPerf && perfOpciones && ...}`),
reemplázalo por un único botón:

```jsx
{isPerf && (
  <div className="tih-filterbar__group">
    <button
      className="tih-filterbar__select--light"
      style={{
        display: "flex", alignItems: "center", gap: 6,
        cursor: "pointer", paddingLeft: 12, paddingRight: 12,
        background: hayFiltrosActivos ? "#0d9488" : undefined,
        color: hayFiltrosActivos ? "#fff" : undefined,
        borderColor: hayFiltrosActivos ? "#0d9488" : undefined,
      }}
      onClick={() => setDrawerOpen(true)}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="2" y1="4" x2="14" y2="4"/>
        <line x1="4" y1="8" x2="12" y2="8"/>
        <line x1="6" y1="12" x2="10" y2="12"/>
      </svg>
      Filtros
      {hayFiltrosActivos && (
        <span style={{
          background: "#fff", color: "#0d9488", borderRadius: 99,
          fontSize: 10, fontWeight: 700, padding: "0 5px", minWidth: 16, textAlign: "center",
        }}>
          {contadorFiltros}
        </span>
      )}
    </button>
  </div>
)}
```

Donde `hayFiltrosActivos` y `contadorFiltros` se calculan así (agrégalos como variables locales):

```js
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
```

Agrega estado local para el drawer:

```js
const [drawerOpen, setDrawerOpen] = useState(false);
```

### Nuevo componente `PerfDrawer`

Crea el componente dentro del mismo `TopBar.jsx` (antes del `export default`).
El drawer se renderiza fuera del header, como overlay lateral derecho:

```jsx
function PerfDrawer({ open, onClose, perfOpciones, perfFiltros, setPerfFiltros }) {
  if (!perfOpciones) return null;

  const limpiarTodo = () => setPerfFiltros({
    cuencas: [], categorias: [], ubicaciones: [], operadores: [],
  });

  return (
    <>
      {/* Overlay semitransparente */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)",
            zIndex: 1000,
          }}
        />
      )}

      {/* Panel lateral */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0,
        width: 320,
        background: "#fff",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
        zIndex: 1001,
        transform: open ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.25s ease",
        display: "flex", flexDirection: "column",
        overflowY: "auto",
      }}>

        {/* Header del drawer */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid #e2e8f0",
        }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
            Filtros de perforación
          </span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={limpiarTodo}
              style={{ fontSize: 11, color: "#0d9488", background: "none", border: "none",
                       cursor: "pointer", padding: 0 }}
            >
              Limpiar todo
            </button>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", cursor: "pointer",
                       color: "#64748b", fontSize: 18, lineHeight: 1, padding: "0 4px" }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Secciones de filtros */}
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 24 }}>

          {/* Cuenca */}
          <DrawerSection
            titulo="Cuenca"
            opciones={perfOpciones.cuencas}
            seleccionados={perfFiltros.cuencas}
            onChange={(vals) => setPerfFiltros({ cuencas: vals })}
          />

          {/* Categoría */}
          <DrawerSection
            titulo="Categoría"
            opciones={perfOpciones.categorias}
            seleccionados={perfFiltros.categorias}
            onChange={(vals) => setPerfFiltros({ categorias: vals })}
          />

          {/* Ubicación */}
          <DrawerSection
            titulo="Ubicación"
            opciones={perfOpciones.ubicaciones}
            seleccionados={perfFiltros.ubicaciones}
            onChange={(vals) => setPerfFiltros({ ubicaciones: vals })}
          />

          {/* Operador */}
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, color: "#64748b",
                        textTransform: "uppercase", letterSpacing: "0.06em",
                        marginBottom: 10 }}>
              Operador
            </p>
            {/* Accesos rápidos: Todos / Pemex / Privados */}
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
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
                    style={{
                      padding: "4px 12px", borderRadius: 99, fontSize: 12, cursor: "pointer",
                      border: `1px solid ${activo ? "#0d9488" : "#e2e8f0"}`,
                      background: activo ? "#0d9488" : "#fff",
                      color: activo ? "#fff" : "#64748b",
                      fontWeight: activo ? 600 : 400,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {/* Lista completa de operadores con búsqueda */}
            <DrawerSection
              opciones={perfOpciones.operadores}
              seleccionados={perfFiltros.operadores}
              onChange={(vals) => setPerfFiltros({ operadores: vals })}
              conBusqueda
            />
          </div>
        </div>

        {/* Footer con botón Aplicar */}
        <div style={{
          marginTop: "auto", padding: "16px 20px",
          borderTop: "1px solid #e2e8f0",
        }}>
          <button
            onClick={onClose}
            style={{
              width: "100%", padding: "10px", borderRadius: 8,
              background: "#10312B", color: "#fff", fontSize: 13,
              fontWeight: 600, border: "none", cursor: "pointer",
            }}
          >
            Aplicar y cerrar
          </button>
        </div>
      </div>
    </>
  );
}
```

### Componente auxiliar `DrawerSection`

```jsx
function DrawerSection({ titulo, opciones, seleccionados, onChange, conBusqueda = false }) {
  const [busqueda, setBusqueda] = useState("");

  const toggle = (op) => {
    const next = seleccionados.includes(op)
      ? seleccionados.filter(s => s !== op)
      : [...seleccionados, op];
    onChange(next);
  };

  const visibles = conBusqueda && busqueda
    ? opciones.filter(o => o.toLowerCase().includes(busqueda.toLowerCase()))
    : opciones;

  return (
    <div>
      {titulo && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: "#64748b",
                      textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {titulo}
          </p>
          {seleccionados.length > 0 && (
            <button
              onClick={() => onChange([])}
              style={{ fontSize: 11, color: "#0d9488", background: "none",
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
          }}
        />
      )}

      <div style={{
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
```

### Renderiza el drawer en `TopBar.jsx`

Justo antes del `</header>` de cierre, agrega:

```jsx
<PerfDrawer
  open={drawerOpen}
  onClose={() => setDrawerOpen(false)}
  perfOpciones={perfOpciones}
  perfFiltros={perfFiltros}
  setPerfFiltros={setPerfFiltros}
/>
```

---

## Cambio 2 — KPI cards: reemplazar tarjetas por banda de métricas

### Objetivo
Las 5 tarjetas con bordes blancos se ven pesadas junto a la tabla.
Reemplazarlas por una banda discreta de una sola línea.

### En `ChartArea.jsx`

Reemplaza el bloque de KPI cards (el que renderiza los 5 `div` con bordes) por esto:

```jsx
{resultado.kpis && (() => {
  const k = resultado.kpis;
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: "6px 20px",
      padding: "10px 14px",
      background: "#f8fafc",
      borderRadius: 8,
      border: "1px solid #e2e8f0",
      marginBottom: 14,
      alignItems: "center",
    }}>
      {[
        { label: "Total pozos",       value: k.total?.toLocaleString("es-MX") },
        { label: "Año más activo",    value: k.anio_top },
        { label: "Cuenca más activa", value: k.cuenca_top },
        { label: "Operador más activo", value: k.operador_top },
        { label: "% Offshore",        value: `${k.pct_offshore}%` },
      ].map(({ label, value }, i, arr) => (
        <div key={label} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap" }}>
            {label}
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap" }}>
            {value ?? "—"}
          </span>
          {i < arr.length - 1 && (
            <span style={{ color: "#e2e8f0", marginLeft: 8, fontSize: 14 }}>·</span>
          )}
        </div>
      ))}
    </div>
  );
})()}
```

---

## Resultado esperado

- La barra superior queda igual que en las demás secciones (solo tema, periodicidad,
  inicio, fin) más un pequeño botón "Filtros" al final que muestra un badge con el
  número de filtros activos
- Al hacer clic en "Filtros" se abre un drawer limpio desde la derecha con todos
  los controles organizados verticalmente, con suficiente espacio y legibilidad
- Las KPIs aparecen como una línea de texto compacta con separadores · en lugar
  de 5 tarjetas con bordes
- El área de datos (tabla / gráfica) recibe mucho más espacio vertical
