import { createContext, useCallback, useContext, useMemo, useState } from "react";

// Pila de fichas de entidad (campo, asignación, pozo, operador…).
//
// Antes cada panel de detalle era un modal aislado y sus enlaces internos
// CERRABAN el modal para saltar de tema en el Explorador — se perdía el
// contexto de dónde venías. Aquí las fichas se apilan: abrir una relacionada
// empuja una entrada nueva y "atrás"/las migas de pan te regresan.
//
// La pila vive en un contexto (no en el estado de ChartArea) para que
// cualquier componente del árbol pueda abrir una ficha sin prop-drilling —
// igual que useExplorerNav para la navegación entre temas.
const FichaContext = createContext(null);

export function FichaProvider({ children }) {
  const [stack, setStack] = useState([]);

  // Empuja una ficha. Si la entidad que se pide ya es la que está arriba de
  // la pila, no hace nada (evita duplicados al hacer doble clic).
  const abrirFicha = useCallback((entrada) => {
    setStack(prev => {
      const tope = prev[prev.length - 1];
      if (tope && tope.tipo === entrada.tipo && tope.id === entrada.id) return prev;
      return [...prev, entrada];
    });
  }, []);

  const volver = useCallback(() => setStack(prev => prev.slice(0, -1)), []);

  // Trunca la pila hasta el índice dado — para las migas de pan.
  const irAIndice = useCallback((i) => setStack(prev => prev.slice(0, i + 1)), []);

  const cerrarFichas = useCallback(() => setStack([]), []);

  const value = useMemo(
    () => ({ stack, abrirFicha, volver, irAIndice, cerrarFichas }),
    [stack, abrirFicha, volver, irAIndice, cerrarFichas],
  );

  return <FichaContext.Provider value={value}>{children}</FichaContext.Provider>;
}

export function useFicha() {
  const ctx = useContext(FichaContext);
  if (!ctx) throw new Error("useFicha debe usarse dentro de <FichaProvider>");
  return ctx;
}

// Atajos por tipo de entidad — mantienen consistentes los `tipo`/`label` que
// espera FichaModal, para no repetir strings sueltos por todo el código.
export function useAbrirFicha() {
  const { abrirFicha } = useFicha();
  return useMemo(() => ({
    abrirCampo: (campo) => abrirFicha({ tipo: "campo", id: campo, label: campo }),
    abrirAsignacion: (asignacion, label) => abrirFicha({ tipo: "asignacion", id: asignacion, label: label ?? asignacion }),
    abrirPozo: (pozo, campo) => abrirFicha({ tipo: "pozo", id: pozo, label: pozo, extra: { campo } }),
    abrirOperador: (operador) => abrirFicha({ tipo: "operador", id: operador, label: operador }),
  }), [abrirFicha]);
}
