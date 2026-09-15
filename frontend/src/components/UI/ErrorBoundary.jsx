import { Component } from "react";

// Frontera de error de React. Sin una, cualquier excepción al renderizar
// desmonta TODO el árbol y la pantalla queda en negro (pasó al abrir la ficha
// de un contrato: un helper fuera de alcance tiraba la app entera).
//
// `fallback` puede ser un nodo o una función que recibe { error, reintentar },
// para que cada punto de montaje dibuje el error con su propio marco (la ficha
// lo pinta dentro del modal, para no perder el botón de cerrar).
//
// Para reiniciarla al cambiar de contenido, pásale una `key` distinta: React
// la remonta y el estado de error se limpia solo.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // El error ya no llega a la consola por sí solo al ser capturado aquí.
    console.error("[ErrorBoundary]", this.props.nombre ?? "", error, info?.componentStack);
  }

  reintentar = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { fallback } = this.props;
    if (typeof fallback === "function") return fallback({ error, reintentar: this.reintentar });
    if (fallback) return fallback;

    return <PanelError error={error} onReintentar={this.reintentar} compacto={this.props.compacto} />;
  }
}

// Fallback por defecto, con el detalle técnico escondido tras un <details>
// para no asustar a quien solo quiere el tablero. `compacto` lo deja del alto
// de su contenedor, para montarlo dentro del área de contenido en vez de a
// pantalla completa.
function PanelError({ error, onReintentar, compacto }) {
  return (
    <div className={`${compacto ? "py-10" : "min-h-screen"} bg-slate-50 flex items-center justify-center p-6`}>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm max-w-lg w-full overflow-hidden">
        <div className="px-6 py-4" style={{ background: "linear-gradient(90deg,#10312B,#1a4a3a)" }}>
          <p className="text-white font-bold text-[15px]">Ocurrió un error inesperado</p>
        </div>
        <div className="px-6 py-5">
          <p className="text-[13px] text-slate-600 leading-relaxed">
            No se pudo mostrar esta sección del tablero. Puedes reintentar; si el
            problema sigue, recarga la página.
          </p>
          <div className="flex gap-2 mt-4">
            <button
              onClick={onReintentar}
              className="px-3.5 py-1.5 rounded-lg text-[12.5px] font-semibold text-white"
              style={{ background: "#0d7a4a" }}
            >
              Reintentar
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-3.5 py-1.5 rounded-lg text-[12.5px] font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50"
            >
              Recargar la página
            </button>
          </div>
          <DetalleTecnico error={error} />
        </div>
      </div>
    </div>
  );
}

export function DetalleTecnico({ error }) {
  return (
    <details className="mt-4">
      <summary className="text-[11.5px] text-slate-400 cursor-pointer select-none">Detalle técnico</summary>
      <pre className="mt-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap">
        {String(error?.message ?? error)}
      </pre>
    </details>
  );
}
