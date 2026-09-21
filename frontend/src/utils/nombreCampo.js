// Normalización de nombres de entidades (campos, operadores, etc.) para
// MOSTRAR en pantalla. El identificador interno NUNCA cambia: sigue siendo
// "TUPILCOPROFUNDO"/"QUESQUI" en URLs, props, comparaciones y llamadas a la
// API. Esto solo afecta el texto que ve el usuario.
//
// La base trae los nombres en formatos mezclados —unos en MAYÚSCULAS
// ("QUESQUI"), otros en minúsculas, otros pegados sin espacio— y eso se veía
// inconsistente. Se normaliza todo a "primera letra de cada palabra en
// mayúscula, el resto en minúscula": QUESQUI → Quesqui, TUPILCO PROFUNDO →
// Tupilco Profundo.

// Nombres que vienen PEGADOS en el identificador interno pero llevan espacio
// en el nombre real. El identificador no cambia; aquí se separa solo para
// mostrar.
// La llave se compara en MAYÚSCULAS: la misma entidad viaja con distinta
// caja según la tabla de origen ("AKALNW" en producción, "Akalnw" en
// RESERVAS_CAMPOS).
const NOMBRE_FIXES = {
  TUPILCOPROFUNDO: "Tupilco Profundo",
  AKALNW: "Akal NW",
};

// Palabras/tokens que deben conservar su forma tal cual (siglas, números
// romanos que se usan como sufijo). Se comparan en mayúsculas. Incluye los
// puntos cardinales que sufijan nombres de campo (AKAL NW, XANAB SE,
// POKCHE NE): sin esto quedaban como "Nw", "Se", "Ne".
const CONSERVAR = new Set(["API", "PCE", "GNL", "SNL", "IP", "II", "III", "IV", "NW", "NE", "SW", "SE"]);

// Codigos de CONTRATO ("CNH-R01-L02-A2/2015", "CNH-A3.CARDENAS-MORA/2018") y
// de ASIGNACION ("A-0203-4M", "AE-0032-6M"). Son identificadores, no nombres:
// van siempre en MAYUSCULAS. El title-case los dejaba como
// "Cnh-R01-L02-A2/2015", que ademas no coincide con el codigo que muestra la
// ficha ni con el que se busca.
//
// Se comprueba por TOKEN y no sobre la etiqueta entera para que tambien
// funcione en las compuestas ("A-0203-4M - Campo Maloob"): el codigo queda en
// mayusculas y el resto se sigue capitalizando normal.
//
// El patron es deliberadamente estrecho —CNH seguido de "-"/"." o A/AE
// seguido de guion y un digito— para no atrapar nombres de campo que tambien
// llevan digitos y guiones, como "Joachin-02".
const RE_CODIGO = /^(?:CNH[-.]\S*|AE?-\d\S*)$/i;

function capitalizarToken(token) {
  if (!token) return token;
  if (RE_CODIGO.test(token)) return token.toUpperCase();
  if (CONSERVAR.has(token.toUpperCase())) return token.toUpperCase();
  // Un token puede llevar guiones o puntos ("agua-fria", "a.c."): se
  // capitaliza cada segmento.
  return token.replace(/[^\s.\-/]+/g, (palabra) =>
    palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase()
  );
}

// Conectores que en español van en minúscula dentro de un título (salvo si son
// la primera palabra): "Pemex Exploración y Producción", "Agua del Rey".
const MINUSCULA = new Set(["y", "e", "o", "u", "de", "del", "la", "las", "los", "el", "a"]);

// Título legible a partir de cualquier variante de mayúsculas/minúsculas.
export function tituloCampo(nombre) {
  if (nombre == null) return nombre;
  const s = String(nombre).trim();
  if (!s) return s;
  return s.split(/\s+/).map((token, i) => {
    if (i > 0 && MINUSCULA.has(token.toLowerCase())) return token.toLowerCase();
    return capitalizarToken(token);
  }).join(" ");
}

export function nombreCampoDisplay(nombre) {
  if (nombre == null) return nombre;
  const fijo = NOMBRE_FIXES[String(nombre).trim().toUpperCase()];
  return fijo ?? tituloCampo(nombre);
}

// Normaliza SOLO si la etiqueta viene toda en mayúsculas (QUESQUI, MALOOB,
// PEMEX EXPLORACIÓN Y PRODUCCIÓN). Las etiquetas ya en mayúscula/minúscula
// mezclada —"Total Mbd", "Gas asociado (MMpcd)", "Cuencas del Sureste"— se
// dejan tal cual: title-casearlas las estropearía ("Total Mmpcd"). Sirve para
// aplicar la normalización de forma segura en tablas y listas donde conviven
// nombres de entidad con etiquetas de producto/unidad.
export function normalizarSiMayusculas(label) {
  if (label == null) return label;
  const s = String(label);
  // Los nombres de NOMBRE_FIXES se corrigen siempre, venga como venga la caja
  // ("Akalnw" llega así desde RESERVAS_CAMPOS y se quedaría sin arreglar).
  // Son coincidencias exactas de una lista corta, así que no hay riesgo de
  // estropear etiquetas de producto/unidad.
  const fijo = NOMBRE_FIXES[s.trim().toUpperCase()];
  if (fijo) return fijo;
  const tieneMinuscula = /\p{Ll}/u.test(s);
  const tieneLetra = /\p{L}/u.test(s);
  if (tieneLetra && !tieneMinuscula) return nombreCampoDisplay(s);
  return label;
}
