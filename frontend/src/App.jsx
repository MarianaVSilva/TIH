import { useState, useEffect } from "react";
import TopBar from "./components/Header/TopBar";
import ChartArea from "./components/Charts/ChartArea";
import ChatButton from "./components/Chat/ChatButton";
import ChatPanel from "./components/Chat/ChatPanel";
import { FichaProvider } from "./components/Fichas/FichaContext";
import FichaModal from "./components/Fichas/FichaModal";
import BotonVolver from "./components/UI/BotonVolver";
import PanelAdmin from "./components/Admin/PanelAdmin";
import { registrarVista, iniciarPulsos } from "./utils/telemetria";

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

  if (esAdmin) return <PanelAdmin />;

  return (
    // FichaProvider envuelve toda la app para que cualquier vista (Explorador,
    // Panorama general, rankings…) pueda abrir la ficha de una entidad; el
    // modal se monta una sola vez, aquí.
    <FichaProvider>
      <div className="bg-slate-50 font-sans flex flex-col min-h-screen lg:h-screen">
        <TopBar />
        <main className="flex-1 min-h-0 min-w-0 p-6 flex flex-col overflow-y-auto overflow-x-hidden">
          <ChartArea />
        </main>
        <BotonVolver />
        <ChatButton open={chatOpen} onClick={() => setChatOpen(o => !o)} />
        <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
        <FichaModal />
      </div>
    </FichaProvider>
  );
}
