export default function LoadingBar({ message = "Cargando…" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 320 }}>
      <div style={{ height: 6, borderRadius: 999, background: "#e2e8f0", overflow: "hidden", position: "relative" }}>
        <div style={{
          position: "absolute", top: 0, bottom: 0, width: "40%",
          borderRadius: 999,
          background: "linear-gradient(90deg, #10312B, #C9A84C)",
          animation: "tih-loading-bar 1.1s ease-in-out infinite",
        }} />
      </div>
      <p style={{ fontSize: 12, color: "#94a3b8", fontFamily: "'Noto Sans', sans-serif", textAlign: "center" }}>{message}</p>
      <style>{`
        @keyframes tih-loading-bar {
          0%   { left: -40%; }
          100% { left: 100%; }
        }
      `}</style>
    </div>
  );
}
