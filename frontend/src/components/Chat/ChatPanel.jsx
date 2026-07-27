import { useEffect, useRef, useState } from "react";
import { buildChatContext } from "../../utils/chatContext";

async function streamChat({ message, history, context }, onToken) {
  const res = await fetch("/api/v1/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, context }),
  });
  if (!res.ok || !res.body) throw new Error(`Error ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onToken(decoder.decode(value, { stream: true }));
  }
}

function ChatBubble({ role, content }) {
  const isUser = role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div
        style={{
          maxWidth: "82%",
          padding: "8px 12px",
          borderRadius: 12,
          fontSize: 13,
          lineHeight: 1.45,
          whiteSpace: "pre-wrap",
          background: isUser ? "#0d9488" : "#f1f5f9",
          color: isUser ? "#fff" : "#1e293b",
          borderBottomRightRadius: isUser ? 2 : 12,
          borderBottomLeftRadius: isUser ? 12 : 2,
        }}
      >
        {content || (!isUser ? "…" : "")}
      </div>
    </div>
  );
}

export default function ChatPanel({ open, onClose }) {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hola, soy el asistente del TIH. Puedo ayudarte a interpretar los datos que tienes en pantalla. ¿Qué quieres saber?" },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    const history = messages.map(({ role, content }) => ({ role, content }));
    const nextMessages = [...messages, { role: "user", content: text }, { role: "assistant", content: "" }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);

    try {
      const context = buildChatContext();
      await streamChat({ message: text, history, context }, (delta) => {
        setMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { ...copy[copy.length - 1], content: copy[copy.length - 1].content + delta };
          return copy;
        });
      });
    } catch (e) {
      setMessages(prev => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: "No pude conectar con el asistente. Verifica que Ollama esté corriendo." };
        return copy;
      });
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Asistente TIH"
      style={{
        position: "fixed",
        bottom: 88,
        right: 24,
        width: 360,
        height: 500,
        maxHeight: "70vh",
        background: "#fff",
        borderRadius: 14,
        boxShadow: "0 12px 36px rgba(0,0,0,0.18)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 1002,
      }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", background: "#10312B", color: "#fff", flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13 }}>Asistente TIH</span>
        <button
          onClick={onClose}
          aria-label="Cerrar chat"
          style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}
        >
          ×
        </button>
      </div>

      <div
        ref={scrollRef}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}
      >
        {messages.map((m, i) => <ChatBubble key={i} role={m.role} content={m.content} />)}
      </div>

      <div style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid #e2e8f0", flexShrink: 0 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pregunta sobre los datos en pantalla…"
          rows={1}
          style={{
            flex: 1, resize: "none", border: "1px solid #e2e8f0", borderRadius: 8,
            padding: "8px 10px", fontSize: 13, outline: "none", fontFamily: "inherit",
            color: "#1e293b", background: "#fff", colorScheme: "light",
          }}
        />
        <button
          onClick={handleSend}
          disabled={sending || !input.trim()}
          style={{
            background: "#0d9488", color: "#fff", border: "none", borderRadius: 8,
            padding: "0 14px", fontSize: 13, fontWeight: 600,
            cursor: sending || !input.trim() ? "default" : "pointer",
            opacity: sending || !input.trim() ? 0.6 : 1,
          }}
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
