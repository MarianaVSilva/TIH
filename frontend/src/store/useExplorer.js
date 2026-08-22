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

// ── Default de series para "Producción por ubicación" (topic Cuenca) y
// "Producción por operador" (topic Operadores): al cargar, solo
// Petróleo/Condensado/Gas quedan prendidas (el resto de los productos
// —líquidos, gas asociado/no asociado, nitrógeno, agua— arrancan apagados,
// el usuario los prende si los necesita). Se basa en resultado.series (la
// serie de cabecera, un producto por item) en vez de "groups" para que
// funcione igual sin importar la forma de la jerarquía (Nacional o Empresa).
const PROD_CUENCA_DEFAULT_ON = new Set(["Petróleo", "Condensado", "Gas"]);
const PRODUCTO_DEFAULT_TOPICS = new Set(["Cuenca", "Operadores", "Contratos", "Campos", "Asignaciones", "Estado"]);
function buildProdCuencaVisible(resultado) {
  const v = {};
  (resultado.series ?? []).forEach(s => {
    const base = s.name.split(" (")[0].trim();
    v[s.name] = PROD_CUENCA_DEFAULT_ON.has(base);
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

  // "Reservas por campo" es un solo tema en el menú (json_arg ReservasP) pero
  // trae 3 pestañas internas (Aceite/Gas/PCE) que pisan qué columna consulta
  // el backend — independiente del tema elegido, así que vive aparte.
  reservasTipo: "ReservasP",
  setReservasTipo: (reservasTipo) => set({ reservasTipo }),
  // Búsqueda de la tabla de Reservas, fuera de DynamicTable (que la maneja
  // como estado local): al cambiar de pestaña Aceite/Gas/PCE, ChartArea
  // pasa brevemente por loading y DynamicTable se desmonta — un estado local
  // se perdería, este sobrevive para que la búsqueda (y la rama abierta que
  // dispara) siga igual en la pestaña nueva.
  reservasSearch: "",
  setReservasSearch: (reservasSearch) => set({ reservasSearch }),
  // Campo/asignación elegido en "Gráfica personalizada por campo" — mismo
  // motivo que reservasSearch: sobrevive el remount al cambiar de pestaña
  // Aceite/Gas/PCE (el nombre no cambia entre pestañas, solo sus valores).
  reservasCampoSel: "",
  setReservasCampoSel: (reservasCampoSel) => set({ reservasCampoSel }),

  period: "annually",
  start_year: year,
  end_year: year,
  start_month: 1,
  end_month: 12,
  // Rango exacto de días — solo se usa con period="daily" (selector de
  // calendario en Precios).
  start_date: null,
  end_date: null,
  setPeriod: (period) => set({ period }),
  setFiltro: (patch) => set(patch),

  perfFiltros: { cuencas: [], categorias: [], ubicaciones: [], operadores: [] },
  setPerfFiltros: (patch) =>
    set(state => ({ perfFiltros: { ...state.perfFiltros, ...patch } })),

  // Universo de opciones de Perforación del tema activo (para saber si una
  // selección de filtros equivale a "todas", p. ej. para el resumen de
  // filtros junto al título de la tabla).
  perfOpciones: null,
  setPerfOpciones: (perfOpciones) => set({ perfOpciones }),

  // Filtros de "Producción por ubicación" (topic Cuenca) y "Producción por
  // operador" (topic Operadores, donde "cuencas" guarda el grupo Pemex/Privadas
  // elegido) — el producto se elige en las chips de series, no como filtro aparte.
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
        visibleSeries: PRODUCTO_DEFAULT_TOPICS.has(state.tema?.json_arg) && !state.groupBy
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

  // Selección de pozo pendiente al saltar desde otro tema (p. ej. el panel de
  // detalle de Asignaciones) hacia "Producción por pozo" — PozosExplorer la
  // consume y limpia en cuanto monta la selección.
  pendingPozoSelection: null,
  setPendingPozoSelection: (pendingPozoSelection) => set({ pendingPozoSelection }),

  // Texto de búsqueda pendiente al saltar a otro tema (p. ej. Asignaciones →
  // Producción por campo, para dejar el campo ya filtrado) — DynamicTable la
  // consume y limpia en cuanto la aplica a su buscador local.
  pendingBusqueda: null,
  setPendingBusqueda: (pendingBusqueda) => set({ pendingBusqueda }),

  visibleSeries: {},
  toggleSerie: (name) => set(state => ({
    // visibleSeries[name] === undefined cuenta como visible (todo visible por
    // defecto, ver "!== false" en SeriesChips/filterSeries) — invertir el
    // valor crudo dejaba undefined -> true, que sigue leyéndose como visible,
    // así que el primer clic no ocultaba nada (hacía falta un segundo clic).
    visibleSeries: { ...state.visibleSeries, [name]: state.visibleSeries[name] === false },
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
