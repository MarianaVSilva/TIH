import { useFicha } from "./FichaContext";
import FichaCampo from "./FichaCampo";
import FichaAsignacion from "./FichaAsignacion";
import FichaPozo from "./FichaPozo";
import FichaOperador from "./FichaOperador";

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

  switch (top.tipo) {
    case "campo":
      return <FichaCampo key={key} campo={top.id} />;
    case "asignacion":
      return <FichaAsignacion key={key} asignacion={top.id} />;
    case "pozo":
      return <FichaPozo key={key} pozo={top.id} campo={top.extra?.campo} />;
    case "operador":
      return <FichaOperador key={key} operador={top.id} />;
    default:
      return null;
  }
}
