import { create } from "zustand";

const year = new Date().getFullYear();

// ── visibleSeries por dimensión (null = sin filtro) ───────────────────────────
function buildVisible(resultado, groupBy) {
  if (!groupBy || !resultado?.groups) return {};
  const items = new Set();
  for (const g of resultado.groups) {
    if (groupBy === "cuenca") {
      if (g.cuenca !== "Nacional") items.add(g.cuenca);
    } else {
      for (const sg of g.subgroups) {
        if (groupBy === "ubicacion") {
          if (sg.ubicacion !== "Nacional") items.add(sg.ubicacion);
        } else {
          for (const row of sg.rows) {
            if (groupBy === "plan"     && row.type === "subtotal") items.add(row.label);
            if (groupBy === "operador" && row.type === "operator") items.add(row.label);
          }
        }
      }
    }
  }
  const v = {};
  items.forEach(n => { v[n] = true; });
  return v;
}

// ── Default de series para "Producción por ubicación" (topic Cuenca): al
// cargar, solo Petróleo/Condensado/Gas quedan prendidas (el resto de los 8
// productos —líquidos, gas asociado/no asociado, nitrógeno, agua— arrancan
// apagados, el usuario los prende si los necesita).
const PROD_CUENCA_DEFAULT_ON = new Set(["Petróleo", "Condensado", "Gas"]);
function buildProdCuencaVisible(resultado) {
  const nac = resultado.groups?.find(g => g.cuenca === "Nacional");
  const sg = nac?.subgroups?.find(s => s.ubicacion === "Nacional");
  const v = {};
  (sg?.rows ?? []).forEach(row => {
    if (row.type !== "subtotal") return;
    const base = row.label.split(" (")[0].trim();
    v[row.label] = PROD_CUENCA_DEFAULT_ON.has(base);
  });
  return v;
}

export const useExplorer = create((set, get) => ({
  temas: [],
  setTemas: (temas) => set({ temas }),

  seccion: "",
  tema: null,
  setSeccion: (seccion) => set({ seccion, tema: null, resultado: null }),
  setTema: (tema) => set({ tema, resultado: null }),

  period: "annually",
  start_year: year - 1,
  end_year: year - 1,
  start_month: 1,
  end_month: 12,
  setPeriod: (period) => set({ period }),
  setFiltro: (patch) => set(patch),

  perfFiltros: { cuencas: [], categorias: [], ubicaciones: [], operadores: [] },
  setPerfFiltros: (patch) =>
    set(state => ({ perfFiltros: { ...state.perfFiltros, ...patch } })),

  // Filtros de "Producción por ubicación" (topic Cuenca): cuenca y ubicación
  // (el producto se elige en las chips de series, no como filtro aparte)
  prodFiltros: { cuencas: [], ubicaciones: [] },
  setProdFiltros: (patch) =>
    set(state => ({ prodFiltros: { ...state.prodFiltros, ...patch } })),

  // Universo de opciones de "Producción por ubicación" (para saber si una
  // selección de filtros equivale a "todas", p. ej. para el subtítulo del gráfico).
  prodOpciones: null,
  setProdOpciones: (prodOpciones) => set({ prodOpciones }),

  // Comparar dos años específicos (no necesariamente consecutivos) — solo perforación
  compareMode: false,
  compareYearA: year - 2,
  compareYearB: year - 1,
  setCompareMode: (compareMode) => set({ compareMode, resultado: null }),
  setCompareYears: (patch) => set(patch),

  // null = sin tab seleccionado (vista general)
  groupBy: null,
  setGroupBy: (groupBy) => set(state => ({
    groupBy,
    visibleSeries: state.resultado?.type === "hierarchical"
      ? buildVisible(state.resultado, groupBy)
      : state.visibleSeries,
  })),

  resultado: null,
  loading: false,
  error: null,
  setResultado: (resultado) => set(state => {
    if (resultado?.type === "hierarchical") {
      return {
        resultado,
        loading: false,
        error: null,
        visibleSeries: state.tema?.json_arg === "Cuenca" && !state.groupBy
          ? buildProdCuencaVisible(resultado)
          : buildVisible(resultado, state.groupBy ?? null),
      };
    }
    const allSeries = resultado?.tabs
      ? resultado.tabs.flatMap(t => t.series)
      : (resultado?.series ?? []);
    const visible = {};
    allSeries.forEach(s => { visible[s.name] = s.name === "Nacional"; });
    const hasNacional = allSeries.some(s => s.name === "Nacional");
    if (!hasNacional) allSeries.forEach(s => { visible[s.name] = true; });
    return { resultado, loading: false, error: null, visibleSeries: visible };
  }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),

  visibleSeries: {},
  toggleSerie: (name) => set(state => ({
    visibleSeries: { ...state.visibleSeries, [name]: !state.visibleSeries[name] },
  })),
  setAllVisible: (names, val) => set(state => {
    const next = { ...state.visibleSeries };
    names.forEach(n => { next[n] = val; });
    return { visibleSeries: next };
  }),
}));

// Helper exportado: lista ordenada de items para la dimensión activa
export function getItemsForGroupBy(resultado, groupBy) {
  if (!groupBy || !resultado?.groups) return [];
  const items = new Set();
  for (const g of resultado.groups) {
    if (groupBy === "cuenca") {
      if (g.cuenca !== "Nacional") items.add(g.cuenca);
    } else {
      for (const sg of g.subgroups) {
        if (groupBy === "ubicacion") {
          if (sg.ubicacion !== "Nacional") items.add(sg.ubicacion);
        } else {
          for (const row of sg.rows) {
            if (groupBy === "plan"     && row.type === "subtotal") items.add(row.label);
            if (groupBy === "operador" && row.type === "operator") items.add(row.label);
          }
        }
      }
    }
  }
  return [...items].sort();
}
