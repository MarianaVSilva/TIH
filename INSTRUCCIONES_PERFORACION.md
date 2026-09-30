# Instrucciones: Filtros y visualizaciones de Perforación — TIH

## Contexto del proyecto

App TIH: React + Vite + ECharts en `frontend/`, FastAPI + SQLAlchemy en `backend/`.

La navegación funciona por secciones/temas desde una tabla `CUBOS` en BD. Los temas de perforación tienen `json_arg` = `PozPerf`, `PozTerm` o `EqPerf` y llaman a `/api/v1/perforacion/`. Los datos se manejan en `useExplorer` (Zustand), el fetch en `useChartData.js`. El resultado del endpoint es tipo `hierarchical` con estructura: `cuenca > subgroups (ubicacion) > rows (total, subtotal por categoría, operador)`.

---

## Cambio 1 — `backend/app/routers/perforacion.py`

Agrega un nuevo endpoint `/perforacion/filtros` **antes** del endpoint existente, y añade 4 query params al endpoint `/`:

```python
@router.get("/filtros")
def perforacion_filtros(engine: Engine = Depends(get_db_dep)):
    from app.services.perforacion_service import get_perforacion_filtros
    return get_perforacion_filtros(engine)

@router.get("/")
def perforacion(
    topic: str = Query("PozPerf"),
    start_year: int = Query(2019),
    end_year: int = Query(2023),
    start_month: int = Query(1),
    end_month: int = Query(12),
    period: str = Query("annually"),
    cuencas: str = Query(""),       # lista separada por comas, vacío = todas
    categorias: str = Query(""),
    ubicaciones: str = Query(""),
    operadores: str = Query(""),
    engine: Engine = Depends(get_db_dep),
):
    try:
        return get_perforacion(engine, topic, start_year, end_year, start_month, end_month,
                               period, cuencas, categorias, ubicaciones, operadores)
    except Exception as e:
        tb = traceback.format_exc()
        print(tb)
        return JSONResponse(status_code=500, content={"detail": str(e), "traceback": tb})
```

---

## Cambio 2 — `backend/app/services/perforacion_service.py`

### 2A. Nueva función `get_perforacion_filtros`

Agrégala antes de `get_perforacion`:

```python
def get_perforacion_filtros(engine: Engine) -> dict:
    tabla = TOPIC_MAP["PozPerf"][0]
    sql = f"""
        SELECT DISTINCT CUENCA, CATEGORIA_POZO, UBICACION, OPERADOR
        FROM {SCHEMA}{tabla}
        WHERE POZOS_PERFORADOS > 0
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)
    df.columns = df.columns.str.lower()
    df["categoria_pozo"] = df["categoria_pozo"].replace(CAT_MAP).str.title().fillna("Otro")
    return {
        "cuencas":     sorted(df["cuenca"].dropna().unique().tolist()),
        "categorias":  sorted(df["categoria_pozo"].dropna().unique().tolist()),
        "ubicaciones": sorted(df["ubicacion"].dropna().unique().tolist()),
        "operadores":  sorted(df["operador"].dropna().unique().tolist()),
    }
```

### 2B. Modifica la firma de `get_perforacion`

Añade los 4 parámetros nuevos con default `""`:

```python
def get_perforacion(
    engine, topic, start_year, end_year, start_month, end_month,
    period,
    cuencas="", categorias="", ubicaciones="", operadores=""
):
```

### 2C. Aplica los filtros en `get_perforacion`

Justo después de la línea que normaliza `categoria_pozo` (el `df["categoria_pozo"] = ...`), agrega:

```python
    def _parse(s):
        return [x.strip() for x in s.split(",") if x.strip()]

    if cuencas:
        lst = _parse(cuencas)
        if lst: df = df[df["cuenca"].isin(lst)]
    if categorias:
        lst = _parse(categorias)
        if lst: df = df[df["categoria_pozo"].isin(lst)]
    if ubicaciones:
        lst = _parse(ubicaciones)
        if lst: df = df[df["ubicacion"].isin(lst)]
    if operadores:
        lst = _parse(operadores)
        if lst: df = df[df["operador"].isin(lst)]
```

### 2D. Nueva función `_compute_kpis`

Agrégala al final del archivo:

```python
def _compute_kpis(df: pd.DataFrame, vc: str) -> dict:
    if df.empty:
        return {}
    total = int(df[vc].sum())
    anio_top = int(df.groupby(df["fecha"].dt.year)[vc].sum().idxmax())
    cuenca_top = df.groupby("cuenca")[vc].sum().idxmax()
    operador_top = df.groupby("operador")[vc].sum().idxmax()
    offshore = int(df[df["ubicacion"] != "Terrestre"][vc].sum())
    pct_offshore = round(offshore / total * 100, 1) if total else 0
    return {
        "total": total,
        "anio_top": anio_top,
        "cuenca_top": cuenca_top,
        "operador_top": operador_top,
        "pct_offshore": pct_offshore,
    }
```

### 2E. Llama a `_compute_kpis` e incluye en el return

Al final de `get_perforacion`, antes del `return`, agrega:

```python
    kpis = _compute_kpis(df, vc)
```

Y en el dict del `return`:

```python
    return {
        "type": "hierarchical",
        "categories": categories,
        "groups": groups,
        "series": series,
        "kpis": kpis,   # NUEVO
    }
```

---

## Cambio 3 — `frontend/src/api/client.js`

Agrega al final del archivo:

```js
export const fetchPerforacionFiltros = () =>
  api.get("/perforacion/filtros").then(r => r.data);
```

---

## Cambio 4 — `frontend/src/store/useExplorer.js`

Dentro del `create((set, get) => ({`, agrega este bloque junto a los demás estados:

```js
  perfFiltros: {
    cuencas: [],
    categorias: [],
    ubicaciones: [],
    operadores: [],
  },
  setPerfFiltros: (patch) =>
    set(state => ({ perfFiltros: { ...state.perfFiltros, ...patch } })),
```

---

## Cambio 5 — `frontend/src/hooks/useChartData.js`

### 5A. Importa `perfFiltros` del store

En la desestructuración de `useExplorer()`:

```js
const { tema, period, start_year, end_year, start_month, end_month,
        perfFiltros,   // NUEVO
        setLoading, setError, setResultado } = useExplorer();
```

### 5B. Pasa los filtros de perforación en los params

Reemplaza el bloque `PERFORACION_TOPICS.has(json_arg) ? { topic: json_arg } : {}` por:

```js
...(PERFORACION_TOPICS.has(json_arg) ? {
  topic: json_arg,
  ...(perfFiltros.cuencas.length     ? { cuencas:     perfFiltros.cuencas.join(",")     } : {}),
  ...(perfFiltros.categorias.length  ? { categorias:  perfFiltros.categorias.join(",")  } : {}),
  ...(perfFiltros.ubicaciones.length ? { ubicaciones: perfFiltros.ubicaciones.join(",") } : {}),
  ...(perfFiltros.operadores.length  ? { operadores:  perfFiltros.operadores.join(",")  } : {}),
} : {}),
```

---

## Cambio 6 — `frontend/src/components/Header/TopBar.jsx`

### 6A. Imports nuevos

```js
import { useState, useEffect } from "react";
import { fetchPerforacionFiltros } from "../../api/client";
```

(Reemplaza el `import { useEffect }` existente si ya está.)

### 6B. Estado local para opciones y filtros de perforación

Dentro del componente, agrega:

```js
const { setPerfFiltros, perfFiltros } = useExplorer();
const [perfOpciones, setPerfOpciones] = useState(null);
const isPerf = PERFORACION_TOPICS.has(tema?.json_arg);
const PERFORACION_TOPICS = new Set(["PozPerf", "PozTerm", "EqPerf"]);

useEffect(() => {
  if (isPerf && !perfOpciones) {
    fetchPerforacionFiltros().then(setPerfOpciones).catch(() => {});
  }
  if (!isPerf) {
    setPerfFiltros({ cuencas: [], categorias: [], ubicaciones: [], operadores: [] });
  }
}, [isPerf]);
```

### 6C. Agrega `perfFiltros` como dependencia del useEffect que llama a `consultar()`

```js
useEffect(() => {
  if (!tema) return;
  consultar();
}, [tema, period, start_year, end_year, start_month, end_month, perfFiltros]);
```

### 6D. Bloque de filtros de perforación en el JSX

Dentro de `tih-filterbar__filters-row`, al final (después del bloque "Fin"), agrega condicionalmente:

```jsx
{isPerf && perfOpciones && (
  <>
    <div className="tih-filterbar__sep--dark" />

    {/* Cuenca */}
    <div className="tih-filterbar__group">
      <span className="tih-filterbar__label--dark">Cuenca</span>
      <div style={{ position: "relative" }}>
        <MultiSelectDropdown
          opciones={perfOpciones.cuencas}
          seleccionados={perfFiltros.cuencas}
          onChange={(vals) => setPerfFiltros({ cuencas: vals })}
          placeholder="Todas"
        />
      </div>
    </div>

    {/* Categoría */}
    <div className="tih-filterbar__group">
      <span className="tih-filterbar__label--dark">Categoría</span>
      <div className="tih-filterbar__radios--dark" style={{ flexWrap: "wrap", gap: "6px" }}>
        {perfOpciones.categorias.map(cat => (
          <label key={cat} className="tih-filterbar__radio-label--dark">
            <input
              type="checkbox"
              checked={perfFiltros.categorias.includes(cat)}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...perfFiltros.categorias, cat]
                  : perfFiltros.categorias.filter(c => c !== cat);
                setPerfFiltros({ categorias: next });
              }}
            />
            {cat}
          </label>
        ))}
      </div>
    </div>

    {/* Ubicación */}
    <div className="tih-filterbar__group">
      <span className="tih-filterbar__label--dark">Ubicación</span>
      <div className="tih-filterbar__radios--dark" style={{ flexWrap: "wrap", gap: "6px" }}>
        {perfOpciones.ubicaciones.map(ub => (
          <label key={ub} className="tih-filterbar__radio-label--dark">
            <input
              type="checkbox"
              checked={perfFiltros.ubicaciones.includes(ub)}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...perfFiltros.ubicaciones, ub]
                  : perfFiltros.ubicaciones.filter(u => u !== ub);
                setPerfFiltros({ ubicaciones: next });
              }}
            />
            {ub}
          </label>
        ))}
      </div>
    </div>

    {/* Operador */}
    <div className="tih-filterbar__group">
      <span className="tih-filterbar__label--dark">Operador</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="tih-filterbar__radios--dark">
          {[["todos","Todos"],["pemex","Pemex"],["privados","Privados"]].map(([val, lbl]) => (
            <label key={val} className="tih-filterbar__radio-label--dark">
              <input
                type="radio"
                name="perf-operador-grupo"
                value={val}
                checked={
                  val === "todos"    ? perfFiltros.operadores.length === 0 :
                  val === "pemex"    ? (perfFiltros.operadores.length > 0 && perfFiltros.operadores.every(o => o.startsWith("Pemex"))) :
                  val === "privados" ? (perfFiltros.operadores.length > 0 && perfFiltros.operadores.every(o => !o.startsWith("Pemex"))) :
                  false
                }
                onChange={() => {
                  if (val === "todos") {
                    setPerfFiltros({ operadores: [] });
                  } else if (val === "pemex") {
                    setPerfFiltros({ operadores: perfOpciones.operadores.filter(o => o.startsWith("Pemex")) });
                  } else {
                    setPerfFiltros({ operadores: perfOpciones.operadores.filter(o => !o.startsWith("Pemex")) });
                  }
                }}
              />
              {lbl}
            </label>
          ))}
        </div>
      </div>
    </div>
  </>
)}
```

### 6E. Componente auxiliar `MultiSelectDropdown`

Crea este componente dentro del mismo archivo `TopBar.jsx` (antes del `export default`). Es un dropdown con checkboxes y un campo de búsqueda:

```jsx
function MultiSelectDropdown({ opciones, seleccionados, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const filtradas = opciones.filter(o => o.toLowerCase().includes(busqueda.toLowerCase()));

  const toggle = (op) => {
    const next = seleccionados.includes(op)
      ? seleccionados.filter(s => s !== op)
      : [...seleccionados, op];
    onChange(next);
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        className="tih-filterbar__select--light"
        style={{ minWidth: 140, textAlign: "left", cursor: "pointer" }}
        onClick={() => setOpen(o => !o)}
      >
        {seleccionados.length === 0
          ? placeholder
          : seleccionados.length === 1
            ? seleccionados[0]
            : `${seleccionados.length} seleccionadas`}
        {" ▾"}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, zIndex: 999,
          background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6,
          boxShadow: "0 4px 12px rgba(0,0,0,0.12)", minWidth: 220, maxHeight: 280,
          overflowY: "auto", padding: "8px 0",
        }}>
          <div style={{ padding: "0 8px 6px" }}>
            <input
              autoFocus
              placeholder="Buscar…"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              style={{
                width: "100%", border: "1px solid #e2e8f0", borderRadius: 4,
                padding: "4px 8px", fontSize: 12, outline: "none",
              }}
            />
          </div>
          <div
            style={{ padding: "2px 8px", fontSize: 11, color: "#10b981", cursor: "pointer" }}
            onClick={() => onChange([])}
          >
            Limpiar selección
          </div>
          {filtradas.map(op => (
            <label key={op} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "4px 12px",
              fontSize: 12, color: "#374151", cursor: "pointer",
            }}>
              <input
                type="checkbox"
                checked={seleccionados.includes(op)}
                onChange={() => toggle(op)}
              />
              {op}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## Cambio 7 — nuevo `frontend/src/components/Charts/HeatmapChart.jsx`

Crea este archivo nuevo:

```jsx
import ReactECharts from "echarts-for-react";

export default function HeatmapChart({ resultado, height = 400 }) {
  if (!resultado?.groups) return null;

  // Extrae cuencas reales (sin Nacional)
  const cuencas = resultado.groups
    .filter(g => g.cuenca !== "Nacional")
    .map(g => g.cuenca);

  // Extrae años únicos de categories
  const years = [...new Set(resultado.categories.map(c => c.slice(0, 4)))].sort();

  // Construye mapa cuenca → año → suma
  const dataMap = {};
  for (const g of resultado.groups) {
    if (g.cuenca === "Nacional") continue;
    const sg = g.subgroups?.find(s => s.ubicacion === "Nacional") ?? g.subgroups?.[0];
    if (!sg) continue;
    const totalRow = sg.rows?.find(r => r.type === "total");
    if (!totalRow) continue;

    dataMap[g.cuenca] = {};
    resultado.categories.forEach((cat, i) => {
      const yr = cat.slice(0, 4);
      dataMap[g.cuenca][yr] = (dataMap[g.cuenca][yr] ?? 0) + (totalRow.data[i] ?? 0);
    });
  }

  // Construye array de puntos [xIdx, yIdx, valor]
  const data = [];
  cuencas.forEach((cuenca, yi) => {
    years.forEach((yr, xi) => {
      data.push([xi, yi, dataMap[cuenca]?.[yr] ?? 0]);
    });
  });

  const maxVal = Math.max(...data.map(d => d[2]), 1);

  const option = {
    backgroundColor: "transparent",
    tooltip: {
      formatter: (p) => `${cuencas[p.data[1]]}<br/>${years[p.data[0]]}: <b>${p.data[2].toLocaleString("es-MX")}</b> pozos`,
    },
    grid: { top: 20, right: 120, bottom: 60, left: 180 },
    xAxis: {
      type: "category",
      data: years,
      axisLabel: { color: "#64748b", fontSize: 10, rotate: years.length > 15 ? 45 : 0 },
      axisLine: { lineStyle: { color: "#e2e8f0" } },
      splitArea: { show: true },
    },
    yAxis: {
      type: "category",
      data: cuencas,
      axisLabel: { color: "#64748b", fontSize: 11 },
      axisLine: { lineStyle: { color: "#e2e8f0" } },
      splitArea: { show: true },
    },
    visualMap: {
      min: 0,
      max: maxVal,
      calculable: true,
      orient: "vertical",
      right: 10,
      top: "center",
      inRange: { color: ["#f0fdfa", "#0d7377"] },
      textStyle: { color: "#64748b", fontSize: 10 },
    },
    series: [{
      type: "heatmap",
      data,
      label: {
        show: true,
        formatter: (p) => p.data[2] > 0 ? p.data[2].toLocaleString("es-MX") : "",
        fontSize: 10,
        color: "#374151",
      },
      emphasis: { itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,0.2)" } },
    }],
  };

  return <ReactECharts option={option} style={{ height }} notMerge />;
}
```

---

## Cambio 8 — `frontend/src/components/Charts/ChartArea.jsx`

### 8A. Import nuevo

```js
import HeatmapChart from "./HeatmapChart";
```

### 8B. Agrega heatmap a `CHART_TYPES`

```js
{
  id: "heatmap",
  label: "Mapa de calor",
  icon: (
    <svg viewBox="0 0 20 20" width="15" height="15" fill="currentColor">
      <rect x="1"  y="1"  width="8"  height="8"  rx="1" opacity="0.3"/>
      <rect x="11" y="1"  width="8"  height="8"  rx="1" opacity="0.7"/>
      <rect x="1"  y="11" width="8"  height="8"  rx="1" opacity="0.9"/>
      <rect x="11" y="11" width="8"  height="8"  rx="1" opacity="0.5"/>
    </svg>
  ),
},
```

### 8C. Cambia el label del tab "plan"

En `GROUP_TABS`, cambia:

```js
{ id: "plan", label: "Por plan" }
```

por:

```js
{ id: "plan", label: "Por categoría" }
```

### 8D. KPI cards

En el bloque `if (resultado.type === "hierarchical")`, agrega esto al inicio (antes de `<GroupByBar>`):

```jsx
{resultado.kpis && (() => {
  const k = resultado.kpis;
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
      {[
        { label: "Total pozos", value: k.total?.toLocaleString("es-MX") },
        { label: "Año más activo", value: k.anio_top },
        { label: "Cuenca más activa", value: k.cuenca_top },
        { label: "Operador más activo", value: k.operador_top, small: true },
        { label: "% Offshore", value: `${k.pct_offshore}%` },
      ].map(({ label, value, small }) => (
        <div key={label} style={{
          flex: "1 1 140px", background: "#fff", border: "1px solid #e2e8f0",
          borderRadius: 8, padding: "10px 14px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}>
          <p style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</p>
          <p style={{ fontSize: small ? 12 : 18, fontWeight: 700, color: "#0f172a", lineHeight: 1.2 }}>{value ?? "—"}</p>
        </div>
      ))}
    </div>
  );
})()}
```

### 8E. Heatmap en `viewMode === "graficos"`

En el bloque jerárquico, donde se renderiza `<SingleChart ... />` (modo gráfico), reemplaza por:

```jsx
chartType === "heatmap"
  ? <HeatmapChart resultado={resultado} height={420} />
  : <SingleChart title={tituloTema} categories={resultado.categories ?? []} series={hierSeries} chartType={chartType} />
```

### 8F. Marca "Reforma Energética" en `SingleChart`

Dentro de la función `option` de `SingleChart`, en el bloque `!isPie` (línea/barras), añade `markLine` al primer elemento de `series`:

```js
series: series.map((s, idx) => ({
  ...s,
  type: isBar ? "bar" : "line",
  smooth: true,
  lineStyle: { width: 2 },
  symbol: "none",
  barMaxWidth: 28,
  stack: isBar ? "total" : undefined,
  ...(idx === 0 && categories.some(c => c.startsWith("2014") || c === "2014") ? {
    markLine: {
      silent: true,
      lineStyle: { color: "#f59e0b", type: "dashed", width: 1.5 },
      label: {
        formatter: "Reforma\nEnergética",
        fontSize: 9,
        color: "#f59e0b",
        position: "insideEndTop",
      },
      data: [{ xAxis: categories.find(c => c.startsWith("2014") || c === "2014") }],
    },
  } : {}),
})),
```

### 8G. Pemex vs. Privados en `buildHierSeries`

En el bloque `if (groupBy === "operador")`, después de obtener los `ops`, agrega:

```js
const hasMix = ops.some(o => o.name.startsWith("Pemex")) && ops.some(o => !o.name.startsWith("Pemex"));
if (hasMix) {
  const sum = (arr) => arr.reduce((acc, r) => r.data.map((v, i) => (acc[i] ?? 0) + (v ?? 0)), []);
  const pemexOps = ops.filter(o => o.name.startsWith("Pemex"));
  const privOps  = ops.filter(o => !o.name.startsWith("Pemex"));
  return [
    { name: "Pemex",    data: sum(pemexOps), color: "#10b981" },
    { name: "Privados", data: sum(privOps),  color: "#6366f1" },
    ...ops
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map(({ name, data }) => ({ name, data })),
  ];
}
```

---

## Orden de implementación

1. `backend/app/services/perforacion_service.py` — funciones y filtros
2. `backend/app/routers/perforacion.py` — params y endpoint `/filtros`
3. `frontend/src/api/client.js` — `fetchPerforacionFiltros`
4. `frontend/src/store/useExplorer.js` — `perfFiltros` + `setPerfFiltros`
5. `frontend/src/hooks/useChartData.js` — pasar filtros en params
6. `frontend/src/components/Charts/HeatmapChart.jsx` — archivo nuevo
7. `frontend/src/components/Charts/ChartArea.jsx` — KPIs, heatmap, markLine, labels, Pemex/Privados
8. `frontend/src/components/Header/TopBar.jsx` — filtros de perforación

## Verificación

- `GET /api/v1/perforacion/filtros` debe retornar `{cuencas, categorias, ubicaciones, operadores}`
- `GET /api/v1/perforacion/?cuencas=Burgos&categorias=Desarrollo` debe retornar solo esos datos
- Los filtros del TopBar deben re-disparar la consulta automáticamente al cambiar
- El heatmap debe mostrarse en modo gráfico con el ícono de cuadrícula
- Las KPI cards deben aparecer siempre arriba, independientemente de la vista
