import { useState } from "react";
import TopBar from "./components/Header/TopBar";
import ChartArea from "./components/Charts/ChartArea";
import ChatButton from "./components/Chat/ChatButton";
import ChatPanel from "./components/Chat/ChatPanel";

export default function App() {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div className="bg-slate-50 font-sans" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <TopBar />
      <main
        style={{
          flex: 1,
          minHeight: 0,
          padding: "24px",
          overflow: "clip",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <ChartArea />
      </main>
      <ChatButton open={chatOpen} onClick={() => setChatOpen(o => !o)} />
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
