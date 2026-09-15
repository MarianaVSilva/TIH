import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const VERDE_OSCURO = [16, 49, 43];
const GRIS_TEXTO = [100, 116, 139];

function pintarFondoSiAplica(doc) {
  if (!doc.__fondo) return;
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setFillColor(...doc.__fondo);
  doc.rect(0, 0, w, h, "F");
}

async function cargarArchivoBase64(url) {
  const resp = await fetch(url);
  const blob = await resp.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Logo a color: desde que el encabezado es claro (sin la banda verde), la
// versión en blanco quedaría invisible.
async function cargarLogoBase64() {
  return cargarArchivoBase64("/SENER_LOGO2.png");
}

// Noto Sans (pedido explícito del usuario — es la fuente que usó en el
// diseño de Canva que el reporte del home debe calcar) — jsPDF solo trae
// Helvetica/Times/Courier por default, hay que incrustarla. Se registra bajo
// la familia "NotoSans" con dos variantes ("normal"/"bold"), igual que
// "helvetica" ya se usa en el resto del archivo, para poder reusar el mismo
// código de dibujo cambiando nada más el nombre de familia (ver FUENTE()).
async function registrarNotoSans(doc) {
  if (doc.__notoSansListo) return;
  const [regularB64, boldB64] = await Promise.all([
    cargarArchivoBase64("/fonts/NotoSans-Regular.ttf"),
    cargarArchivoBase64("/fonts/NotoSans-Bold.ttf"),
  ]);
  doc.addFileToVFS("NotoSans-Regular.ttf", regularB64.split(",")[1]);
  doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
  doc.addFileToVFS("NotoSans-Bold.ttf", boldB64.split(",")[1]);
  doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");
  doc.__notoSansListo = true;
}

// Todo el sitio usa Noto Sans, también los descargables. Se degrada a
// Helvetica solo si la fuente no se pudo incrustar (el .ttf no cargó).
function FUENTE(doc) {
  return doc.__noto ? "NotoSans" : "helvetica";
}

// Encabezado plano (pedido explícito, como el descargable de la CNH): sin la
// banda verde, solo el logo, el nombre de la dependencia y una línea.
function dibujarBanner(doc, pageWidth, logoBase64) {
  if (logoBase64) {
    // El PNG del logo es la versión en blanco (era para el banner oscuro):
    // sobre fondo claro hay que usar el de color.
    try { doc.addImage(logoBase64, "PNG", 14, 10, 57, 32); } catch { /* logo opcional */ }
  }
  doc.setTextColor(30, 41, 59);
  doc.setFont(FUENTE(doc), "bold");
  doc.setFontSize(12);
  doc.text("SECRETARÍA DE ENERGÍA", 80, 26);
  doc.setFont(FUENTE(doc), "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIS_TEXTO);
  doc.text("Tablero de Información de Hidrocarburos", 80, 37);
  doc.setDrawColor(190, 190, 190);
  doc.setLineWidth(0.75);
  doc.line(14, 48, pageWidth - 14, 48);
}

// Header "claro" (fondo crema, sin banner oscuro) — estilo del reporte de
// referencia que hizo el usuario en Canva para el export del home: logo a
// color + línea divisoria + título/subtítulo a la izquierda, chip
// "• Datos a [periodo]" a la derecha.
function dibujarHeaderClaro(doc, pageWidth, periodoNota, logoBase64) {
  // Medidas calcadas del PDF de referencia (measured con pymupdf): el logo
  // real ocupa ~24pt de alto (no toda la banda del header) — a la relación
  // de aspecto real de SENER_LOGO2.png (3.87:1) eso da ~93pt de ancho, que
  // es lo que deja al título empezar en x≈123 (igual que en el original).
  let tituloX = 14;
  if (logoBase64) {
    try {
      const logoH = 28;
      const logoW = logoH * (2820 / 727);
      doc.addImage(logoBase64, "PNG", 14, 16, logoW, logoH);
      tituloX = 14 + logoW + 16;
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.75);
      doc.line(tituloX - 8, 12, tituloX - 8, 46);
    } catch { /* logo opcional */ }
  }
  const GRIS_TITULO = [115, 115, 115];
  doc.setFont(FUENTE(doc), "bold");
  doc.setFontSize(17);
  doc.setTextColor(...GRIS_TITULO);
  doc.text("Tablero de Información de Hidrocarburos", tituloX, 36);
  if (periodoNota) {
    doc.setFont(FUENTE(doc), "normal");
    doc.setFontSize(9);
    doc.setTextColor(105, 28, 50);
    const texto = `• ${periodoNota}`;
    const w = doc.getTextWidth(texto);
    doc.text(texto, pageWidth - 14 - w, 33);
  }
}

/**
 * Genera y descarga un PDF con el mismo banner del sitio, armado a partir de
 * "bloques" que el usuario eligió y ordenó en el constructor de reportes
 * (ReportBuilderModal). Cada bloque es independiente — se dibujan en el
 * orden recibido, cada uno maneja su propia paginación via startY.
 *
 * @param {object} p
 * @param {string} p.titulo
 * @param {string} [p.subtitulo]
 * @param {string} [p.periodoNota]
 * @param {Array<{tipo: "tabla"|"filtros"|"imagen"|"kpis", ...}>} p.bloques
 * @param {string} [p.nombreArchivo]
 * @param {"landscape"|"portrait"} [p.orientation] - "landscape" (default, reportes por tema con tablas anchas) o "portrait" (p. ej. Panorama general, tarjetas apiladas verticalmente).
 * @param {"banner"|"claro"} [p.headerStyle] - "banner" (default, banner verde oscuro con logo) o "claro" (fondo crema, título simple + chip de periodo — reporte del home).
 * @param {[number,number,number]} [p.fondo] - color de fondo de página (RGB). Sin esto, fondo blanco (default de jsPDF).
 */
export async function exportarReportePdf(p) {
  const { titulo, subtitulo, periodoNota, bloques, nombreArchivo = "TIH_reporte.pdf", orientation = "landscape", headerStyle = "banner", fondo } = p;

  const doc = new jsPDF({ orientation, unit: "pt", format: "a4" });
  if (fondo) doc.__fondo = fondo;
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;

  pintarFondoSiAplica(doc);

  // Se incrusta antes de dibujar nada, para que TODO el PDF salga en Noto.
  try { await registrarNotoSans(doc); doc.__noto = true; } catch { /* sin la fuente, degrada a Helvetica */ }

  if (headerStyle === "claro") {
    let logoColorBase64 = null;
    try { logoColorBase64 = await cargarArchivoBase64("/SENER_LOGO2.png"); } catch { /* sin logo si falla */ }
    dibujarHeaderClaro(doc, pageWidth, periodoNota, logoColorBase64);
  } else {
    let logoBase64 = null;
    try { logoBase64 = await cargarLogoBase64(); } catch { /* si falla, banner sin logo */ }
    dibujarBanner(doc, pageWidth, logoBase64);
  }

  let y = headerStyle === "claro" ? 63 : 64;
  // Sin `titulo` (pedido explícito: nada de "Panorama general" ni ningún
  // otro nombre genérico) no se reserva espacio de más — el banner de
  // arriba ya identifica el sitio, no hace falta repetir un título vacío.
  if (titulo) {
    doc.setTextColor(30, 41, 59);
    doc.setFont(FUENTE(doc), "bold");
    doc.setFontSize(14);
    doc.text(titulo, marginX, y);
    y += 16;
  }

  if (subtitulo) {
    doc.setFont(FUENTE(doc), "normal");
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    const lineas = doc.splitTextToSize(subtitulo, pageWidth - marginX * 2);
    doc.text(lineas, marginX, y);
    y += lineas.length * 11 + 4;
  }
  if (headerStyle !== "claro") {
    if (periodoNota) {
      doc.setFontSize(8);
      doc.setTextColor(...GRIS_TEXTO);
      doc.text(periodoNota, marginX, y);
      y += 10;
    }
    doc.setFontSize(7.5);
    doc.setTextColor(...GRIS_TEXTO);
    doc.text(`Generado el ${new Date().toLocaleString("es-MX")}`, marginX, y);
    y += 14;
  }

  for (const bloque of bloques) {
    // Salto de página si no queda espacio razonable para empezar un bloque nuevo.
    if (y > doc.internal.pageSize.getHeight() - 60) {
      doc.addPage();
      pintarFondoSiAplica(doc);
      y = 20;
    }

    if (bloque.tipo === "columnas") {
      // Dos columnas lado a lado (estilo CNH: "Hidrocarburos líquidos" |
      // "Gas natural"), cada una con su propia pila de bloques. Cada
      // columna pagina de forma independiente (sus sub-bloques tienen su
      // propio addPage) — si no cupieran completas, izquierda y derecha
      // podrían terminar partidas en páginas distintas. Para evitarlo, si
      // no queda un margen razonable se fuerza AQUÍ un salto de página
      // para el bloque completo antes de dibujar ninguna columna, así las
      // dos casi siempre entran juntas en lo que quede de la página nueva.
      if (y > doc.internal.pageSize.getHeight() - (bloque.minAlto ?? 260)) {
        doc.addPage();
        pintarFondoSiAplica(doc);
        y = 20;
      }
      const gapCol = 16;
      const colWidth = (pageWidth - marginX * 2 - gapCol) / 2;
      let yIzq = y, yDer = y;
      for (const b of bloque.izquierda ?? []) yIzq = dibujarBloque(doc, b, { x: marginX, y: yIzq, width: colWidth });
      for (const b of bloque.derecha ?? []) yDer = dibujarBloque(doc, b, { x: marginX + colWidth + gapCol, y: yDer, width: colWidth });
      y = Math.max(yIzq, yDer) + 10;
      continue;
    }

    y = dibujarBloque(doc, bloque, { x: marginX, y, width: pageWidth - marginX * 2 });
  }

  doc.save(nombreArchivo);
}

// Dibuja un bloque individual en (x, y) con el ancho dado y devuelve la
// nueva y. Se usa tanto para bloques de ancho completo como para cada
// columna de un bloque "columnas".
function dibujarBloque(doc, bloque, { x, y, width }) {
    if (bloque.tipo === "titulo") {
      doc.setFont(FUENTE(doc), "bold");
      doc.setFontSize(11);
      doc.setTextColor(30, 41, 59);
      doc.text(bloque.texto, x, y);
      return y + 14;
    }

    if (bloque.tipo === "seccion") {
      // Sub-header dentro de una tarjeta (p. ej. "Líquidos (Mbd)", "PEMEX"):
      // solo texto en negrita/color, sin píldora ni barra — el estilo CNH
      // "grande" vive en "cardHeader", este es el chico.
      const color = bloque.color ?? VERDE_OSCURO;
      doc.setFont(FUENTE(doc), "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...color);
      doc.text(bloque.texto.toUpperCase(), x, y);
      return y + 13;
    }

    if (bloque.tipo === "cardHeader") {
      // Header de tarjeta calcado del PDF de referencia (medido con
      // pymupdf sobre el PDF real que el usuario hizo en Canva): píldora
      // borde 3pt del color de la sección + texto SIEMPRE gris #737373
      // (no del color de la sección — solo el borde lleva color), 14pt
      // bold; título descriptivo también gris #737373, 18pt regular.
      // `y` es el TOPE del bloque (igual que "kpis"/"imagen"/"ranking" —
      // nunca una línea de base), así que la píldora se dibuja empezando
      // justo en `y`, sin restarle nada (antes restaba 20, lo que la hacía
      // dibujarse encima del bloque anterior cuando "cardHeader" no era el
      // primero de la página).
      const color = bloque.color ?? VERDE_OSCURO;
      const GRIS_BADGE = [115, 115, 115];
      doc.setFont(FUENTE(doc), "bold");
      doc.setFontSize(14);
      const padX = 16;
      const badgeW = doc.getTextWidth(bloque.badge) + padX * 2;
      const badgeH = 28;
      const topY = y;
      doc.setDrawColor(...color);
      doc.setLineWidth(3);
      doc.roundedRect(x, topY, badgeW, badgeH, badgeH / 2, badgeH / 2, "S");
      doc.setTextColor(...GRIS_BADGE);
      doc.text(bloque.badge, x + badgeW / 2, topY + badgeH / 2 + 5, { align: "center" });
      doc.setFont(FUENTE(doc), "normal");
      doc.setFontSize(18);
      // El título envuelve a 1-2 líneas cuando la columna es angosta (p.
      // ej. "Producción" e "Indicadores económicos" lado a lado) — igual
      // que el PDF de referencia, que envuelve "Top 5 Reservas por campo".
      const tituloX = x + badgeW + 14;
      const lineas = doc.splitTextToSize(bloque.texto, Math.max(40, width - badgeW - 14));
      if (lineas.length > 1) {
        doc.text(lineas, tituloX, topY + badgeH / 2 - 3);
        return topY + badgeH + 12 + (lineas.length - 1) * 15;
      }
      doc.text(lineas, tituloX, topY + badgeH / 2 + 6);
      return topY + badgeH + 12;
    }

    if (bloque.tipo === "ranking") {
      // Lista rankeada nativa (número + nombre + barra de progreso + valor)
      // — calcada del PDF de Canva: SIN ejes ni cuadrícula (a diferencia de
      // la gráfica de ECharts que se usaba antes), track gris claro +
      // relleno de color, valor sin unidad (la unidad ya la dice el
      // "seccion" de arriba, p. ej. "LÍQUIDOS (MBD)").
      const color = bloque.color ?? VERDE_OSCURO;
      const items = bloque.items ?? [];
      const max = Math.max(...items.map(it => it.valor), 1);
      const rankW = bloque.mostrarRank ? 16 : 0;
      const nameW = bloque.nameW ?? 74;
      const valW = 44;
      const barX = x + rankW + nameW;
      const barW = Math.max(20, width - rankW - nameW - valW);
      const rowH = 21;
      for (const it of items) {
        if (y + rowH > doc.internal.pageSize.getHeight() - 20) { doc.addPage(); pintarFondoSiAplica(doc); y = 20; }
        const baseline = y + rowH * 0.6;
        if (bloque.mostrarRank) {
          doc.setFont(FUENTE(doc), "normal");
          doc.setFontSize(9.5);
          doc.setTextColor(170, 170, 168);
          doc.text(`${items.indexOf(it) + 1}.`, x, baseline);
        }
        doc.setFont(FUENTE(doc), "bold");
        doc.setFontSize(9.5);
        doc.setTextColor(40, 40, 38);
        doc.text(doc.splitTextToSize(it.nombre, nameW - 4)[0], x + rankW, baseline);
        const barY = y + rowH / 2 - 3;
        doc.setFillColor(235, 236, 231);
        doc.roundedRect(barX, barY, barW, 6, 3, 3, "F");
        const fillW = Math.max(6, (it.valor / max) * barW);
        doc.setFillColor(...color);
        doc.roundedRect(barX, barY, fillW, 6, 3, 3, "F");
        doc.setFont(FUENTE(doc), "bold");
        doc.setFontSize(9.5);
        doc.setTextColor(40, 40, 38);
        doc.text(Number(it.valor).toLocaleString("es-MX"), x + width, baseline, { align: "right" });
        y += rowH;
      }
      return y + 6;
    }

    if (bloque.tipo === "filtros") {
      doc.setFont(FUENTE(doc), "bold");
      doc.setFontSize(10);
      doc.setTextColor(30, 41, 59);
      doc.text("Filtros aplicados", x, y);
      y += 12;
      doc.setFont(FUENTE(doc), "normal");
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);
      for (const linea of bloque.lineas) {
        doc.text(`• ${linea}`, x, y);
        y += 12;
      }
      return y + 6;
    }

    if (bloque.tipo === "kpis") {
      // Tarjeta de número grande, medidas calcadas del PDF de referencia:
      // etiqueta SIEMPRE gris #737373 8pt (nunca del color de la tarjeta),
      // valor 31pt bold del color de acento, línea de cambio también gris
      // #737373 (ni verde ni naranja — el signo lo da únicamente el
      // triángulo). 2-3 por fila; si no caben todas se reparten en filas.
      const GRIS_KPI = [115, 115, 115];
      const items = bloque.items ?? [];
      const porFila = Math.min(3, items.length) || 1;
      const gap = 10;
      const boxW = (width - gap * (porFila - 1)) / porFila;
      const subLineas = (it) => !it.sub ? [] : Array.isArray(it.sub) ? it.sub : [{ text: it.sub }];
      // La etiqueta puede envolver a 2 líneas cuando la tarjeta va en una
      // columna angosta (p. ej. "Precio del petróleo (Brent) · USD/barril"
      // al lado de "Indicadores económicos") — el resto se corre hacia
      // abajo para no encimarse.
      doc.setFont(FUENTE(doc), "normal");
      doc.setFontSize(8);
      const labelLineas = (it) => doc.splitTextToSize(it.label, boxW - 12);
      const extraLabel = (it) => Math.max(0, labelLineas(it).length - 1) * 9;
      const boxH = Math.max(78, ...items.map(it => 62 + extraLabel(it) + subLineas(it).length * 12));
      for (let fila = 0; fila < Math.ceil(items.length / porFila); fila++) {
        if (y + boxH > doc.internal.pageSize.getHeight() - 20) { doc.addPage(); pintarFondoSiAplica(doc); y = 20; }
        const filaItems = items.slice(fila * porFila, fila * porFila + porFila);
        filaItems.forEach((it, i) => {
          const bx = x + i * (boxW + gap);
          doc.setFillColor(...(it.bg ?? [240, 240, 240]));
          doc.roundedRect(bx, y, boxW, boxH, 5, 5, "F");
          doc.setTextColor(...GRIS_KPI);
          doc.setFont(FUENTE(doc), "normal");
          doc.setFontSize(8);
          const label = labelLineas(it);
          doc.text(label, bx + boxW / 2, y + 16, { align: "center" });
          const yValor = y + 46 + extraLabel(it);
          const valorTxt = `${it.prefix ?? ""}${Number(it.valor).toLocaleString("es-MX")}${it.unidad ? " " + it.unidad : ""}`;
          doc.setFont(FUENTE(doc), "bold");
          doc.setFontSize(31);
          doc.setTextColor(...(it.color ?? [30, 41, 59]));
          doc.text(valorTxt, bx + boxW / 2, yValor, { align: "center" });
          const lineas = subLineas(it);
          doc.setFont(FUENTE(doc), "normal");
          doc.setFontSize(8);
          doc.setTextColor(...GRIS_KPI);
          lineas.forEach((linea, li) => {
            const ly = y + 60 + extraLabel(it) + li * 12;
            // Triángulo vectorial en vez de "↑"/"↓" de texto: la fuente
            // Noto Sans incrustada no trae ese glifo (vive en Noto Sans
            // Symbols, una fuente aparte) y el carácter salía invisible.
            if (linea.dir === "up" || linea.dir === "down") {
              const tw = doc.getTextWidth(linea.text);
              const triW = 5.5, gapTri = 4;
              const startX = bx + boxW / 2 - (triW + gapTri + tw) / 2;
              doc.setFillColor(...GRIS_KPI);
              if (linea.dir === "up") doc.triangle(startX, ly - 1, startX + triW, ly - 1, startX + triW / 2, ly - 6, "F");
              else doc.triangle(startX, ly - 6, startX + triW, ly - 6, startX + triW / 2, ly - 1, "F");
              doc.text(linea.text, startX + triW + gapTri, ly, { align: "left" });
            } else {
              doc.text(linea.text, bx + boxW / 2, ly, { align: "center" });
            }
          });
        });
        y += boxH + 8;
      }
      return y + 8;
    }

    if (bloque.tipo === "imagen") {
      const w = Math.min(width, bloque.width ?? width);
      const h = w * (bloque.height / bloque.width);
      if (y + h > doc.internal.pageSize.getHeight() - 20) { doc.addPage(); pintarFondoSiAplica(doc); y = 20; }
      doc.addImage(bloque.dataUrl, "PNG", x, y, w, h);
      return y + h + 14;
    }

    if (bloque.tipo === "tabla") {
      autoTable(doc, {
        startY: y,
        margin: { left: x, right: doc.internal.pageSize.getWidth() - x - width },
        tableWidth: width,
        head: [bloque.columnas],
        body: bloque.filas,
        // Tabla plana (pedido explícito, como el descargable de la CNH):
        // sin relleno de color en el encabezado ni filas cebra — solo una
        // línea bajo los títulos para separarlos de los datos.
        theme: "plain",
        headStyles: { textColor: [30, 41, 59], fontSize: 8, halign: "center", fontStyle: "bold",
          lineWidth: { bottom: 0.75 }, lineColor: [150, 150, 150] },
        bodyStyles: { fontSize: 7.5, textColor: [30, 41, 59] },
        styles: { cellPadding: 3, overflow: "linebreak", font: FUENTE(doc) },
        // Solo repinta el fondo en páginas NUEVAS que autoTable agrega a
        // media tabla — la página en la que ya estábamos (data.pageNumber
        // === 1) ya tiene el fondo pintado por pintarFondoSiAplica de más
        // arriba, y repintar encima borraría lo que ya se dibujó antes de
        // esta tabla (p. ej. un cardHeader).
        didDrawPage: (data) => { if (data.pageNumber > 1) pintarFondoSiAplica(doc); },
        didParseCell: (data) => {
          const negrita = bloque.filasNegritas?.has(data.row.index);
          if (negrita && data.section === "body") {
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.fillColor = [240, 253, 250];
          }
        },
      });
      return doc.lastAutoTable.finalY + 16;
    }

    return y;
}
