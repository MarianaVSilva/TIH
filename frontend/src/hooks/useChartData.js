import api from "../api/client";
import { useExplorer } from "../store/useExplorer";

// Secuencia de peticiones: evita que una respuesta lenta (de un filtro anterior)
// sobrescriba a la respuesta más reciente cuando el usuario cambia filtros rápido.
let reqSeq = 0;

const PERFORACION_TOPICS = new Set(["PozPerf", "PozTerm", "EqPerf", "PozosCampos"]);
const PRODUCCION_SECCIONES = new Set(["Producción", "Produccion"]);
const RESERVAS_SECCIONES   = new Set(["Recursos y reservas", "Reservas"]);
const CONTRATOS_SECCIONES  = new Set(["Licitaciones y Contratos", "Contratos"]);
const PRECIOS_SECCIONES    = new Set(["Indicadores Económicos", "Indicadores Economicos", "Precios"]);
const INVERSIONES_SECCIONES= new Set(["Inversión", "Inversion", "Inversiones"]);
const ESTADO_SECCIONES     = new Set(["Estado de Pozos", "Estado"]);

export function useChartData() {
  const {
    tema, period,
    start_year, end_year, start_month, end_month,
    perfFiltros,
    setResultado, setLoading, setError,
  } = useExplorer.getState
    ? useExplorer.getState()  // llamada directa (fuera de componente)
    : useExplorer();           // dentro de componente (no debería pasar)

  function consultar() {
    const state = useExplorer.getState();
    const {
      tema, period,
      start_year, end_year, start_month, end_month,
      perfFiltros, prodFiltros,
      compareMode, compareYearA, compareYearB,
      setResultado, setLoading, setError,
    } = state;

    if (!tema) return;
    // "Producción por pozo" maneja su propio fetch (árbol + detalle bajo
    // demanda) en PozosExplorer — no pasa por el flujo genérico de resultado.
    if (tema.json_arg === "Pozos") { setResultado(null); setLoading(false); return; }

    const myReq = ++reqSeq;
    setLoading(true);

    const base = { period, start_year, end_year, start_month, end_month };
    const json_arg = tema.json_arg;
    const seccion  = tema.seccion ?? "";

    let promise;

    if (PERFORACION_TOPICS.has(json_arg)) {
      promise = api.get("/perforacion/", {
        params: {
          ...base,
          topic:      json_arg,
          // Separador "|" (no ","): los nombres de operadores contienen comas.
          cuencas:    (perfFiltros.cuencas    ?? []).join("|"),
          categorias: (perfFiltros.categorias ?? []).join("|"),
          ubicaciones:(perfFiltros.ubicaciones?? []).join("|"),
          operadores: (perfFiltros.operadores ?? []).join("|"),
          // Comparar dos años específicos en vez del rango continuo
          years: compareMode && compareYearA != null && compareYearB != null
            ? `${compareYearA}|${compareYearB}` : "",
        },
      });
    } else if (PRODUCCION_SECCIONES.has(seccion)) {
      const esProdHier = json_arg === "Cuenca" || json_arg === "Campos" || json_arg === "API";
      promise = api.get("/produccion/", {
        params: {
          ...base,
          topic: json_arg,
          ...(esProdHier ? {
            cuencas: (prodFiltros.cuencas ?? []).join("|"),
            ubicaciones: (prodFiltros.ubicaciones ?? []).join("|"),
          } : {}),
          years: compareMode && compareYearA != null && compareYearB != null
            ? `${compareYearA}|${compareYearB}` : "",
        },
      });
    } else if (RESERVAS_SECCIONES.has(seccion)) {
      promise = api.get("/reservas/", { params: { start_year, end_year, tipo: json_arg } });
    } else if (CONTRATOS_SECCIONES.has(seccion)) {
      promise = api.get("/contratos/", { params: base });
    } else if (PRECIOS_SECCIONES.has(seccion)) {
      promise = api.get("/precios/", { params: base });
    } else if (INVERSIONES_SECCIONES.has(seccion)) {
      promise = api.get("/inversiones/", { params: { start_year, end_year, subtopic: json_arg } });
    } else if (ESTADO_SECCIONES.has(seccion)) {
      promise = api.get("/estado/", { params: base });
    } else {
      setError(`Sección no reconocida: "${seccion}"`);
      return;
    }

    promise
      .then(r => { if (myReq === reqSeq) setResultado(r.data); })
      .catch(e => { if (myReq === reqSeq) setError(e?.response?.data?.detail ?? e.message); });
  }

  return { consultar };
}
