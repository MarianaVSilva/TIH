// Registro de uso del tablero: cuántas visitas, cuánto tiempo y qué temas se
// consultan. Alimenta el panel de administrador.
//
// Reglas que se respetan aquí:
//  - NUNCA estorba. Todo va en try/catch y con `keepalive`; si el endpoint
//    falla o tarda, el usuario no se entera y la navegación sigue igual.
//  - No identifica a nadie. El id de sesión es aleatorio, vive en
//    sessionStorage (muere al cerrar la pestaña) y no se cruza con nada.
//  - El tiempo se mide con pulsos cada 30 s SOLO mientras la pestaña está
//    visible. Una pestaña olvidada en segundo plano no cuenta como consulta,
//    y no dependemos del evento de cierre, que el navegador descarta a menudo.

const CLAVE_SESION = "tih_sesion";
// Tiene que coincidir con SEGUNDOS_POR_PULSO del backend.
const PULSO_MS = 30_000;

function idSesion() {
  try {
    let id = sessionStorage.getItem(CLAVE_SESION);
    if (!id) {
      id = (crypto.randomUUID?.() ?? String(Math.random()).slice(2) + Date.now()).slice(0, 40);
      sessionStorage.setItem(CLAVE_SESION, id);
    }
    return id;
  } catch {
    // Navegador con almacenamiento bloqueado: se pierde la continuidad de la
    // sesión pero el evento se sigue registrando.
    return "anon-" + Date.now();
  }
}

function enviar(cuerpo) {
  try {
    fetch("/api/v1/uso/evento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sesion: idSesion(), ...cuerpo }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* la telemetría jamás debe romper la app */ }
}

// Sección que se está viendo ahora, para que los pulsos sepan a qué imputar
// el tiempo.
//
// La unidad que se mide es la SECCIÓN —las pills del encabezado— y no el tema
// concreto (pedido explícito): interesa saber qué área del tablero se usa, no
// cada consulta dentro de ella.
let actual = { seccion: null };

export function registrarVista() {
  enviar({ tipo: "vista" });
}

export function registrarSeccion(seccion) {
  // Sin sección es el Panorama general, que también es una pill (la casita).
  const nombre = seccion || "Panorama general";
  // Evita duplicar cuando el componente se remonta sin cambiar de sección.
  if (actual.seccion === nombre) return;
  actual = { seccion: nombre };
  enviar({ tipo: "seccion", seccion: nombre });
}

export function registrarBusqueda(texto) {
  const t = String(texto ?? "").trim();
  if (t.length < 3) return;
  enviar({ tipo: "busqueda", detalle: t.slice(0, 200) });
}

let cronometro = null;

export function iniciarPulsos() {
  if (cronometro) return;
  cronometro = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    enviar({ tipo: "pulso", seccion: actual.seccion });
  }, PULSO_MS);
}
