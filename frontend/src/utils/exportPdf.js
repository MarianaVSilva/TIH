import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const VERDE_OSCURO = [16, 49, 43];
const VERDE_CLARO = [26, 74, 58];
const GRIS_TEXTO = [100, 116, 139];
const BLANCO = [255, 255, 255];

async function cargarLogoBase64() {
  const resp = await fetch("/logosener-blanco.png");
  const blob = await resp.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function dibujarBanner(doc, pageWidth, logoBase64) {
  doc.setFillColor(...VERDE_OSCURO);
  doc.rect(0, 0, pageWidth, 42, "F");
  if (logoBase64) {
    try { doc.addImage(logoBase64, "PNG", 14, 8, 48, 27); } catch { /* logo opcional */ }
  }
  doc.setTextColor(...BLANCO);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("TIH — Tablero de Información de Hidrocarburos", 70, 20);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(183, 217, 205);
  doc.text("Secretaría de Energía", 70, 30);
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
 */
export async function exportarReportePdf(p) {
  const { titulo, subtitulo, periodoNota, bloques, nombreArchivo = "TIH_reporte.pdf", orientation = "landscape" } = p;

  const doc = new jsPDF({ orientation, unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;

  let logoBase64 = null;
  try { logoBase64 = await cargarLogoBase64(); } catch { /* si falla, banner sin logo */ }

  dibujarBanner(doc, pageWidth, logoBase64);

  let y = 58;
  // Sin `titulo` (pedido explícito: nada de "Panorama general" ni ningún
  // otro nombre genérico) no se reserva espacio de más — el banner de
  // arriba ya identifica el sitio, no hace falta repetir un título vacío.
  if (titulo) {
    doc.setTextColor(30, 41, 59);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(titulo, marginX, y);
    y += 16;
  }

  if (subtitulo) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    const lineas = doc.splitTextToSize(subtitulo, pageWidth - marginX * 2);
    doc.text(lineas, marginX, y);
    y += lineas.length * 11 + 4;
  }
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

  for (const bloque of bloques) {
    // Salto de página si no queda espacio razonable para empezar un bloque nuevo.
    if (y > doc.internal.pageSize.getHeight() - 60) {
      doc.addPage();
      y = 20;
    }

    if (bloque.tipo === "titulo") {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(30, 41, 59);
      doc.text(bloque.texto, marginX, y);
      y += 14;
      continue;
    }

    if (bloque.tipo === "filtros") {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(30, 41, 59);
      doc.text("Filtros aplicados", marginX, y);
      y += 12;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);
      for (const linea of bloque.lineas) {
        doc.text(`• ${linea}`, marginX, y);
        y += 12;
      }
      y += 6;
      continue;
    }

    if (bloque.tipo === "kpis") {
      // Fila de tarjetas de número grande (estilo BigStat del sitio, pero
      // dibujado nativo en vez de capturado como imagen — texto vectorial,
      // se ve nítido a cualquier zoom y no depende de que el DOM haya
      // terminado de renderizar). 2-3 por fila; si no caben todas en el
      // ancho de la página se reparten en filas de máximo 3.
      const items = bloque.items ?? [];
      const porFila = Math.min(3, items.length) || 1;
      const gap = 10;
      const boxW = (pageWidth - marginX * 2 - gap * (porFila - 1)) / porFila;
      const boxH = 56;
      for (let fila = 0; fila < Math.ceil(items.length / porFila); fila++) {
        if (y + boxH > doc.internal.pageSize.getHeight() - 20) { doc.addPage(); y = 20; }
        const filaItems = items.slice(fila * porFila, fila * porFila + porFila);
        filaItems.forEach((it, i) => {
          const x = marginX + i * (boxW + gap);
          doc.setFillColor(...(it.bg ?? [240, 240, 240]));
          doc.roundedRect(x, y, boxW, boxH, 5, 5, "F");
          doc.setTextColor(...(it.color ?? [30, 41, 59]));
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.5);
          const label = doc.splitTextToSize(it.label, boxW - 12);
          doc.text(label, x + boxW / 2, y + 13, { align: "center" });
          const valorTxt = `${it.prefix ?? ""}${Number(it.valor).toLocaleString("es-MX")}${it.unidad ? " " + it.unidad : ""}`;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(15);
          doc.text(valorTxt, x + boxW / 2, y + boxH / 2 + 8, { align: "center" });
          if (it.sub) {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(7.5);
            doc.text(String(it.sub), x + boxW / 2, y + boxH - 8, { align: "center" });
          }
        });
        y += boxH + 8;
      }
      y += 8;
      continue;
    }

    if (bloque.tipo === "imagen") {
      const maxW = pageWidth - marginX * 2;
      const w = Math.min(maxW, bloque.width ?? maxW);
      const h = w * (bloque.height / bloque.width);
      if (y + h > doc.internal.pageSize.getHeight() - 20) { doc.addPage(); y = 20; }
      doc.addImage(bloque.dataUrl, "PNG", marginX, y, w, h);
      y += h + 14;
      continue;
    }

    if (bloque.tipo === "tabla") {
      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        head: [bloque.columnas],
        body: bloque.filas,
        theme: "grid",
        headStyles: { fillColor: VERDE_OSCURO, textColor: 255, fontSize: 8, halign: "center" },
        bodyStyles: { fontSize: 7.5, textColor: [30, 41, 59] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        styles: { cellPadding: 3, overflow: "linebreak" },
        didParseCell: (data) => {
          const negrita = bloque.filasNegritas?.has(data.row.index);
          if (negrita && data.section === "body") {
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.fillColor = [240, 253, 250];
          }
        },
      });
      y = doc.lastAutoTable.finalY + 16;
      continue;
    }
  }

  doc.save(nombreArchivo);
}
