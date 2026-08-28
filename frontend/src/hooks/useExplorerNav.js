import { useExplorer } from "../store/useExplorer";

// Navegación cruzada al Explorador desde cualquier parte del sitio (mismo
// patrón que ya usaba AsignacionDetallePanel/PerforacionPozosDetallePanel
// para "ir a pozo"/"ir a campo" — generalizado para reusarse en Home,
// PozosComparar, rankings, etc.). Busca el tema por `json_arg`, cambia de
// sección/tema y deja una selección pendiente que el tema destino consume
// (pendingPozoSelection en PozosExplorer, pendingBusqueda en DynamicTable).
export function useExplorerNav() {
  const { temas, setSeccion, setTema, setPendingPozoSelection, setPendingBusqueda } = useExplorer();

  function irATema(jsonArg, { pozo, campo, busqueda } = {}) {
    const tema = temas.find(t => t.json_arg === jsonArg);
    if (!tema) return false;
    setSeccion(tema.seccion);
    setTema(tema);
    if (pozo) setPendingPozoSelection({ campo, pozo });
    if (busqueda) setPendingBusqueda(busqueda);
    return true;
  }

  return {
    irACampo: (nombre) => irATema("Campos", { busqueda: nombre }),
    irAPozo: (pozo, campo) => irATema("Pozos", { pozo, campo }),
    irAOperador: (nombre) => irATema("Operadores", { busqueda: nombre }),
    irATema,
  };
}
