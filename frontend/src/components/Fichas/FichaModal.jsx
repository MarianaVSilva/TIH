import { useFicha } from "./FichaContext";
import FichaCampo from "./FichaCampo";
import FichaAsignacion from "./FichaAsignacion";
import FichaPozo from "./FichaPozo";
import FichaOperador from "./FichaOperador";
import FichaShell from "./FichaShell";
import ErrorBoundary, { DetalleTecnico } from "../UI/ErrorBoundary";

// Renderiza la ficha que está en el tope de la pila. Vive una sola vez en la
// app (App.jsx) para que cualquier vista pueda abrir fichas sin montar su
// propio modal.
export default function FichaModal() {
  const { stack } = useFicha();
  if (!stack.length) return null;

  const top = stack[stack.length - 1];
  // La `key` fuerza el remontaje al cambiar de entidad — si no, al apilar dos
  // fichas del mismo tipo React reusaría el componente y se vería un instante
  // con los datos de la anterior.
  const key = `${top.tipo}|${top.id}|${stack.length}`;

  const ficha = (() => {
    switch (top.tipo) {
      case "campo":
        return <FichaCampo campo={top.id} />;
      case "asignacion":
        return <FichaAsignacion asignacion={top.id} />;
      case "pozo":
        return <FichaPozo pozo={top.id} campo={top.extra?.campo} />;
      case "operador":
        return <FichaOperador operador={top.id} />;
      default:
        return null;
    }
  })();

  // La misma `key` reinicia la frontera de error al cambiar de entidad: una
  // ficha rota no deja marcadas a las siguientes. El fallback se dibuja dentro
  // de FichaShell para conservar el encabezado, las migas y el botón de cerrar.
  return (
    <ErrorBoundary
      key={key}
      nombre={`ficha:${top.tipo}`}
      fallback={({ error, reintentar }) => (
        <FichaShell titulo={String(top.id)} subtitulo="No se pudo cargar la ficha" tipo={top.tipo}>
          <div className="px-6 py-5">
            <p className="text-[13px] text-slate-600 leading-relaxed">
              Hubo un error al mostrar esta ficha. El resto del tablero sigue
              funcionando: puedes cerrarla y continuar.
            </p>
            <button
              onClick={reintentar}
              className="mt-4 px-3.5 py-1.5 rounded-lg text-[12.5px] font-semibold text-white"
              style={{ background: "#0d7a4a" }}
            >
              Reintentar
            </button>
            <DetalleTecnico error={error} />
          </div>
        </FichaShell>
      )}
    >
      {ficha}
    </ErrorBoundary>
  );
}
