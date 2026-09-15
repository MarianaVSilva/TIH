import { useState, useEffect } from "react";
import TopBar from "./components/Header/TopBar";
import ChartArea from "./components/Charts/ChartArea";
import ChatButton from "./components/Chat/ChatButton";
import ChatPanel from "./components/Chat/ChatPanel";
import { FichaProvider } from "./components/Fichas/FichaContext";
import FichaModal from "./components/Fichas/FichaModal";
import BotonVolver from "./components/UI/BotonVolver";
import PanelAdmin from "./components/Admin/PanelAdmin";
import ErrorBoundary from "./components/UI/ErrorBoundary";
import { registrarVista, registrarSeccion, iniciarPulsos } from "./utils/telemetria";
import { useExplorer } from "./store/useExplorer";

export default function App() {
  const [chatOpen, setChatOpen] = useState(false);
  // El panel de administrador vive en #admin. No hay router en la app (es una
  // sola pantalla con secciones), así que basta con mirar el hash.
  const [esAdmin, setEsAdmin] = useState(() => window.location.hash === "#admin");
  useEffect(() => {
    const alCambiar = () => setEsAdmin(window.location.hash === "#admin");
    window.addEventListener("hashchange", alCambiar);
    return () => window.removeEventListener("hashchange", alCambiar);
  }, []);

  // Registro de uso. No se cuenta la visita al panel de administrador: quien
  // lo abre viene a mirar las métricas, no a consultar el tablero.
  useEffect(() => {
    if (esAdmin) return;
    registrarVista();
    iniciarPulsos();
  }, [esAdmin]);

  // La sección activa se lee del store, que es justo lo que cambian las pills
  // del encabezado — así se registra el clic en la pill aunque el usuario no
  // llegue a elegir un tema.
  const seccion = useExplorer(e => e.seccion);
  useEffect(() => {
    if (!esAdmin) registrarSeccion(seccion);
  }, [seccion, esAdmin]);

  if (esAdmin) return <PanelAdmin />;

  return (
    // FichaProvider envuelve toda la app para que cualquier vista (Explorador,
    // Panorama general, rankings…) pueda abrir la ficha de una entidad; el
    // modal se monta una sola vez, aquí.
    //
    // Las fronteras de error van anidadas a propósito: la de adentro acota un
    // fallo del área de contenido (una gráfica, una tabla) a esa zona, dejando
    // usables el encabezado y los filtros para cambiar de tema; la de afuera es
    // la red de seguridad para todo lo demás. La del modal de fichas vive en
    // FichaModal. Sin ellas, cualquier excepción al renderizar deja la
    // pantalla en negro.
    <ErrorBoundary nombre="app">
      <FichaProvider>
        <div className="bg-slate-50 font-sans flex flex-col min-h-screen lg:h-screen">
          <TopBar />
          <main className="flex-1 min-h-0 min-w-0 p-6 flex flex-col overflow-y-auto overflow-x-hidden">
            <ErrorBoundary nombre="contenido" key={seccion} compacto>
              <ChartArea />
            </ErrorBoundary>
          </main>
          <BotonVolver />
          <ChatButton open={chatOpen} onClick={() => setChatOpen(o => !o)} />
          <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
          <FichaModal />
        </div>
      </FichaProvider>
    </ErrorBoundary>
  );
}
