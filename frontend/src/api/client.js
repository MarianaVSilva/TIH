import axios from "axios";

const api = axios.create({ baseURL: "/api/v1", timeout: 30000 });

export const fetchTemas          = ()       => api.get("/temas/").then(r => r.data);
export const fetchBuscar         = (q)      => api.get("/buscar/", { params: { q } }).then(r => r.data);

export const fetchProduccionCuenca  = (p) => api.get("/produccion/cuenca",  { params: p }).then(r => r.data);
export const fetchProduccionDetalle = (p) => api.get("/produccion/detalle", { params: p }).then(r => r.data);

export const fetchReservas          = (p) => api.get("/reservas/",          { params: p }).then(r => r.data);
export const fetchCategorias        = ()  => api.get("/reservas/categorias").then(r => r.data);

export const fetchContratos         = (p) => api.get("/contratos/",         { params: p }).then(r => r.data);
export const fetchOperadores        = (p) => api.get("/contratos/operadores",{ params: p }).then(r => r.data);

export const fetchPrecios           = (p) => api.get("/precios/",           { params: p }).then(r => r.data);
export const fetchInversiones       = (p) => api.get("/inversiones/",       { params: p }).then(r => r.data);
export const fetchEstado            = (p) => api.get("/estado/",            { params: p }).then(r => r.data);

export const fetchPerforacionFiltros = (topic) =>
  api.get("/perforacion/filtros", { params: { topic } }).then(r => r.data);
export const fetchPerforacionPozosDetalle = (p) =>
  api.get("/perforacion/pozos-detalle", { params: p }).then(r => r.data);
export const fetchPozosCampoDetalle = (p) =>
  api.get("/perforacion/pozos-campo-detalle", { params: p }).then(r => r.data);
export const fetchContratosAdjudicadosDetalle = (empresa, columna) =>
  api.get("/contratos/adjudicados/detalle", { params: { empresa, columna } }).then(r => r.data);
export const fetchPozosComprometidosDetalle = (contrato) =>
  api.get("/contratos/pozos-comprometidos/detalle", { params: { contrato } }).then(r => r.data);
export const fetchPerforacionHistorico = (topic) =>
  api.get("/perforacion/historico", { params: { topic }, timeout: 60000 }).then(r => r.data);

export const fetchProduccionFiltros = () => api.get("/produccion/filtros").then(r => r.data);
export const fetchProduccionHistorico = (topic) =>
  api.get("/produccion/historico", { params: { topic }, timeout: 60000 }).then(r => r.data);
export const fetchProduccionPozosArbol = () => api.get("/produccion/pozos/arbol").then(r => r.data);
export const fetchProduccionPozoDetalle = (p) => api.get("/produccion/pozos/detalle", { params: p }).then(r => r.data);
export const fetchProduccionPozosResumen = (p) => api.get("/produccion/pozos/resumen", { params: p }).then(r => r.data);

export const fetchPozoAnalisis      = (p) => api.get("/produccion/pozos/analisis", { params: p }).then(r => r.data);
export const fetchPozoTendenciaDesglose = (p) => api.get("/produccion/pozos/tendencia-desglose", { params: p }).then(r => r.data);
export const fetchPozosRanking      = (p) => api.get("/produccion/pozos/ranking",  { params: p }).then(r => r.data);
export const fetchPozosComparar     = (p) => api.get("/produccion/pozos/comparar", { params: p }).then(r => r.data);
// Consulta nacional (todos los pozos del rango, sin acotar a cuenca/campo) —
// más pesada que el resto de endpoints de pozos, necesita más margen que
// el timeout global de 30s.
export const fetchPozosFiltrados    = (p) => api.get("/produccion/pozos/filtrados",{ params: p, timeout: 90000 }).then(r => r.data);
export const exportarPozosCsvUrl    = (p) => {
  const limpio = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null));
  return `${api.defaults.baseURL}/produccion/pozos/exportar?${new URLSearchParams(limpio).toString()}`;
};

export const fetchPozosCacheStatus  = () => api.get("/produccion/pozos/cache-status").then(r => r.data);

export const fetchAsignacionesRanking = (p) => api.get("/produccion/asignaciones/ranking", { params: p }).then(r => r.data);
export const fetchAsignacionDetalle   = (p) => api.get("/produccion/asignaciones/detalle",  { params: p }).then(r => r.data);
export const fetchCampoDetalle        = (p) => api.get("/produccion/campos/detalle",  { params: p }).then(r => r.data);
export const fetchOperadorDetalle     = (p) => api.get("/produccion/operadores/detalle", { params: p }).then(r => r.data);

export const fetchResumen = () => api.get("/resumen/").then(r => r.data);

export default api;
