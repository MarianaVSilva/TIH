export default function LoadingSpinner({ message = "Cargando…" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <div style={{
        width: 36, height: 36,
        border: "3px solid #e2e8f0",
        borderTopColor: "#C9A84C",
        borderRadius: "50%",
        animation: "tih-spin 0.7s linear infinite",
      }} />
      <p style={{ fontSize: 12, color: "#94a3b8", fontFamily: "'Noto Sans', sans-serif" }}>{message}</p>
      <style>{`@keyframes tih-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
