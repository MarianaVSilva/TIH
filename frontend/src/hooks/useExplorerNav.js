import { useExplorer } from "../store/useExplorer";

// Navegación cruzada al Explorador desde cualquier parte del sitio (mismo
// patrón que ya usaba AsignacionDetallePanel/PerforacionPozosDetallePanel
// para "ir a pozo"/"ir a campo" — generalizado para reusarse en Home,
// PozosComparar, rankings, etc.). Busca el tema por `json_arg`, cambia de
// sección/tema y deja una selección pendiente que el tema destino consume
// (pendingPozoSelection en PozosExplorer, pendingBusqueda en DynamicTable).
export function useExplorerNav() {
  const { temas, tema: temaActual, seccion: seccionActual, prodFiltros, perfFiltros,
          setSeccion, setTema, setPendingPozoSelection, setPendingBusqueda,
          setPendingProdFiltros, setForzarTodasLasSeries, setPendingPeriodo, pushNav } = useExplorer();

  function irATema(jsonArg, { pozo, campo, busqueda, vista, filtros, todasLasSeries, anio } = {}) {
    const tema = temas.find(t => t.json_arg === jsonArg);
    if (!tema) return false;
    // Se guarda de dónde venía para poder volver con el botón flotante: estos
    // saltos los dispara una ficha, no el selector de temas, así que sin esto
    // el usuario tendría que reconstruir a mano la vista que traía.
    if (temaActual) {
      pushNav({
        seccion: seccionActual,
        tema: temaActual,
        prodFiltros: { ...prodFiltros },
        perfFiltros: { ...perfFiltros },
      });
    }
    // Si YA estamos en ese tema no se re-selecciona: setSeccion/setTema ponen
    // `resultado: null`, y como el tema no cambia de referencia el efecto que
    // consulta los datos no se vuelve a disparar — la vista quedaba en blanco
    // ("Selecciona un tema para visualizar"). Pasa al abrir una ficha desde la
    // tabla de un tema y usar su enlace "Ver … en el Explorador", que es el
    // caso más común. Solo se aplica la búsqueda, que es lo que hace falta.
    if (temaActual?.json_arg !== jsonArg) {
      setSeccion(tema.seccion);
      setTema(tema);
    }
    if (pozo) setPendingPozoSelection({ campo, pozo });
    // La búsqueda va DIRIGIDA al tema destino: al cambiar de tema, la tabla del
    // tema anterior sigue montada un instante y consumía la búsqueda pendiente
    // (aplicándosela a sí misma y borrándola), así que la tabla destino nacía
    // sin filtro. Con el tema dentro, solo la tabla correcta la toma.
    // `vista` indica qué vista del tema debe consumir la búsqueda ("ranking");
    // sin ella la consume la tabla, que es el caso normal.
    if (busqueda) setPendingBusqueda({ tema: jsonArg, texto: busqueda, vista });
    // Filtros de Cuenca/Ambiente: en "Producción por asignación" son los que
    // hacen que la tabla baje al desglose por asignación — sin ellos el tema
    // solo muestra el agregado por cuenca y la asignación no aparece.
    if (filtros) setPendingProdFiltros({ tema: jsonArg, filtros });
    if (todasLasSeries) setForzarTodasLasSeries({ tema: jsonArg });
    // Entidades que dejaron de producir: se abre el tema en su ultimo anio con
    // datos, si no la vista sale vacia en el anio en curso sin explicacion.
    if (anio) setPendingPeriodo({ tema: jsonArg, anio });
    return true;
  }

  return {
    irACampo: (nombre) => irATema("Campos", { busqueda: nombre }),
    irAPozo: (pozo, campo) => irATema("Pozos", { pozo, campo }),
    irAOperador: (nombre) => irATema("Operadores", { busqueda: nombre }),
    // Asignaciones y contratos son temas distintos y no se navegan igual:
    //   - "Producción por contrato" tiene una fila por contrato etiquetada con
    //     su código (CNH-…): basta buscar ese código.
    //   - "Producción por asignacion" solo baja al desglose por asignación
    //     CUANDO hay filtro de cuenca/ambiente; sin filtros muestra el agregado
    //     por cuenca. Por eso se mandan también los filtros de la asignación, y
    //     se busca por BLOCK_NAME, que es la etiqueta que muestra esa tabla
    //     (el ASIG_CONT viaja aparte, en "code").
    irAAsignacion: (codigo, tipo, { nombre, cuencas, ubicaciones } = {}) =>
      tipo === "CONTRATO"
        ? irATema("Contratos", { busqueda: codigo, todasLasSeries: true })
        : irATema("Asignaciones", {
            busqueda: nombre ?? codigo,
            filtros: { cuencas: cuencas ?? [], ubicaciones: ubicaciones ?? [] },
            todasLasSeries: true,
          }),
    irATema,
  };
}
