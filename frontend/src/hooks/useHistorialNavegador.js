import { useCallback, useEffect, useRef } from "react";
import { useFicha } from "../components/Fichas/FichaContext";
import { useExplorer } from "../store/useExplorer";

// Deshace un salto entre temas de los que dispara una ficha ("Ver producción
// completa… en el Explorador"). Lo usan el botón flotante "Volver a …" y el
// botón Atrás del navegador, así que vive aquí y no dentro del componente.
export function useVolverNav() {
  const {
    navHistory, quitarUltimaNav,
    setSeccion, setTema, setPendingProdFiltros, setPerfFiltros,
  } = useExplorer();

  const volverNav = useCallback(() => {
    const destino = navHistory[navHistory.length - 1];
    if (!destino) return;
    // setSeccion pone tema en null, así que va primero y setTema después.
    if (destino.seccion) setSeccion(destino.seccion);
    if (destino.tema) setTema(destino.tema);
    // Los filtros de Cuenca/Ambiente se restauran por el mismo canal dirigido
    // que usa la navegación: TopBar los limpia al cambiar de tema y aplicarlos
    // aquí directamente no sobreviviría.
    if (destino.tema?.json_arg) {
      setPendingProdFiltros({ tema: destino.tema.json_arg, filtros: destino.prodFiltros });
    }
    if (destino.perfFiltros) setPerfFiltros(destino.perfFiltros);
    quitarUltimaNav();
  }, [navHistory, quitarUltimaNav, setSeccion, setTema, setPendingProdFiltros, setPerfFiltros]);

  return { navHistory, volverNav };
}

// Conecta el botón Atrás del navegador con los niveles "deshacibles" de la app.
//
// El tablero es una sola pantalla sin router, así que nunca dejaba entradas en
// el historial: estando dentro de una ficha, Atrás sacaba del sitio. Aquí se
// empuja una entrada por cada nivel que se abre (cada ficha de la pila, cada
// salto de tema) y Atrás deshace ese nivel en vez de salir. Cuando ya no queda
// nada que deshacer, Atrás vuelve a hacer lo de siempre y sale del sitio.
export default function useHistorialNavegador() {
  const { stack, volver: volverFicha } = useFicha();
  const { navHistory, volverNav } = useVolverNav();

  const niveles = stack.length + navHistory.length;

  // Refs para que el listener de popstate (registrado una sola vez) siempre
  // vea el estado actual sin volver a suscribirse en cada cambio.
  const accionesRef = useRef({ stack, volverFicha, navHistory, volverNav });
  accionesRef.current = { stack, volverFicha, navHistory, volverNav };

  const nivelesRef = useRef(0);
  // Entradas que ya consumimos nosotros con history.go(): su popstate llega
  // igual y hay que ignorarlo, o desharía un segundo nivel.
  const ignorarRef = useRef(0);
  // El cambio de nivel lo provocó el Atrás del navegador: el historial ya se
  // movió solo, no hay que tocarlo.
  const desdeAtrasRef = useRef(false);

  useEffect(() => {
    const anterior = nivelesRef.current;
    if (niveles === anterior) return;
    nivelesRef.current = niveles;

    if (desdeAtrasRef.current) { desdeAtrasRef.current = false; return; }

    if (niveles > anterior) {
      for (let i = anterior; i < niveles; i++) window.history.pushState({ tihNivel: i + 1 }, "");
    } else {
      // Se cerró desde la interfaz (la ✕ de la ficha, el botón "Volver a …"):
      // se consumen las entradas que esos niveles habían dejado, para que el
      // siguiente Atrás no se gaste en no hacer nada.
      const diferencia = anterior - niveles;
      ignorarRef.current += diferencia;
      window.history.go(-diferencia);
    }
  }, [niveles]);

  useEffect(() => {
    const alVolverAtras = () => {
      if (ignorarRef.current > 0) { ignorarRef.current -= 1; return; }
      const { stack: fichas, volverFicha: cerrarUna, navHistory: navs, volverNav: deshacerSalto } = accionesRef.current;
      // Primero la ficha de encima (es lo que el usuario tiene delante), y
      // solo cuando ya no hay fichas, el salto de tema.
      if (fichas.length) { desdeAtrasRef.current = true; cerrarUna(); }
      else if (navs.length) { desdeAtrasRef.current = true; deshacerSalto(); }
      // Sin niveles pendientes no se hace nada: el navegador ya salió del sitio.
    };
    window.addEventListener("popstate", alVolverAtras);
    return () => window.removeEventListener("popstate", alVolverAtras);
  }, []);
}
