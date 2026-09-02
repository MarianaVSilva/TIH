import { useState } from "react";
import TopBar from "./components/Header/TopBar";
import ChartArea from "./components/Charts/ChartArea";
import ChatButton from "./components/Chat/ChatButton";
import ChatPanel from "./components/Chat/ChatPanel";
import { FichaProvider } from "./components/Fichas/FichaContext";
import FichaModal from "./components/Fichas/FichaModal";
import BotonVolver from "./components/UI/BotonVolver";

export default function App() {
  const [chatOpen, setChatOpen] = useState(false);

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
