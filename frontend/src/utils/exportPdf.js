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
 * @param {Array<{tipo: "tabla"|"filtros"|"imagen", ...}>} p.bloques
 * @param {string} [p.nombreArchivo]
 */
export async function exportarReportePdf(p) {
  const { titulo, subtitulo, periodoNota, bloques, nombreArchivo = "TIH_reporte.pdf" } = p;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;

  let logoBase64 = null;
  try { logoBase64 = await cargarLogoBase64(); } catch { /* si falla, banner sin logo */ }

  dibujarBanner(doc, pageWidth, logoBase64);

  let y = 58;
  doc.setTextColor(30, 41, 59);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(titulo, marginX, y);
  y += 16;

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
