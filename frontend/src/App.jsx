import { useState } from "react";
import TopBar from "./components/Header/TopBar";
import ChartArea from "./components/Charts/ChartArea";
import ChatButton from "./components/Chat/ChatButton";
import ChatPanel from "./components/Chat/ChatPanel";

export default function App() {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div className="bg-slate-50 font-sans flex flex-col min-h-screen lg:h-screen">
      <TopBar />
      <main className="flex-1 min-h-0 min-w-0 p-6 flex flex-col overflow-y-auto overflow-x-hidden">
        <ChartArea />
      </main>
      <ChatButton open={chatOpen} onClick={() => setChatOpen(o => !o)} />
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
