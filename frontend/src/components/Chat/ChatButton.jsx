export default function ChatButton({ open, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label={open ? "Cerrar asistente" : "Abrir asistente"}
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: "#9CAF88",
        color: "#26313D",
        border: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1002,
        boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
      }}
    >
      {open ? (
        <span style={{ fontSize: 22, lineHeight: 1, color: "#fff" }}>×</span>
      ) : (
        <img src="/golurk.png" alt="" width={40} height={40} style={{ objectFit: "contain" }} />
      )}
    </button>
  );
}
