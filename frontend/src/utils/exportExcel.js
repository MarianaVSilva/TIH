import ExcelJS from "exceljs";

const VERDE_OSCURO = "FF10312B";
const VERDE_CLARO = "FF1A4A3A";
const BLANCO = "FFFFFFFF";
const GRIS_TEXTO = "FF64748B";

async function cargarLogo() {
  const resp = await fetch("/logosener-blanco.png");
  const buffer = await resp.arrayBuffer();
  return buffer;
}

function descargarBuffer(buffer, nombreArchivo) {
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Genera y descarga un .xlsx con el mismo banner del sitio (logo + título),
 * los metadatos del nivel/rango/filtros vigentes, la tabla que se está
 * viendo, y opcionalmente la gráfica de tendencia como imagen embebida.
 *
 * @param {object} p
 * @param {string} p.titulo - Nombre del pozo/campo/cuenca.
 * @param {string} [p.subtitulo] - Contexto (campo del pozo, etc).
 * @param {string} [p.periodoNota] - Texto de qué período representan los datos.
 * @param {{columnas: string[], filas: {label: string, valores: (number|string)[]}[]}} [p.tabla] - formato jerárquico (indentado, 1 columna de valor por período).
 * @param {{columnasIdentidad: string[], columnasValor: string[], filas: {identidad: (string|number)[], valores: (number|string)[]}[]}} [p.tablaPivot] - formato plano/pivote: 1 fila por combinación hoja, 1 columna por producto/serie. Tiene prioridad sobre `tabla` cuando ambos vienen.
 * @param {{columnas: string[], filas: (string|number)[][]}} [p.tablaSecundaria] - p. ej. ranking de pozos.
 * @param {string} [p.tituloTablaSecundaria]
 * @param {string} [p.chartImageBase64] - PNG en base64 (con o sin prefijo data:).
 * @param {string} [p.chartTitulo]
 * @param {string} [p.nombreArchivo]
 */
export async function exportarProduccionExcel(p) {
  const {
    titulo, subtitulo, periodoNota,
    tabla, tablaPivot, tablaSecundaria, tituloTablaSecundaria,
    etiquetaFilaTabla = "Producto",
    chartImageBase64, chartTitulo,
    nombreArchivo = `TIH_${titulo}.xlsx`.replace(/[^\w.\-]+/g, "_"),
  } = p;

  const wb = new ExcelJS.Workbook();
  wb.creator = "TIH — Tablero de Información de Hidrocarburos";
  wb.created = new Date();
  const ws = wb.addWorksheet("Producción", { views: [{ showGridLines: false }] });

  const numColsPivot = tablaPivot ? (tablaPivot.columnasIdentidad.length + tablaPivot.columnasValor.length) : 0;
  const numCols = Math.max((tabla?.columnas?.length ?? 0) + 1, (tablaSecundaria?.columnas?.length ?? 0), numColsPivot, 6);
  const lastColLetter = ws.getColumn(numCols).letter;

  // ── Banner (igual al header del sitio) ────────────────────────────────
  // No se mergea el rectángulo completo A1:F3 porque luego se mergean
  // sub-rangos (título/subtítulo) dentro de él — ExcelJS no permite merges
  // solapados. En su lugar se pinta el fill celda por celda.
  for (let r = 1; r <= 3; r++) {
    for (let c = 1; c <= numCols; c++) {
      ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE_OSCURO } };
    }
  }
  ws.getRow(1).height = 10;
  ws.getRow(2).height = 40;
  ws.getRow(3).height = 10;

  try {
    const logoBuffer = await cargarLogo();
    const logoId = wb.addImage({ buffer: logoBuffer, extension: "png" });
    // El PNG original es 1920x1080 (16:9) con el sello a la izquierda y
    // texto a la derecha, sobre fondo transparente — se respeta esa
    // proporción al insertarlo para que no se vea aplastado.
    ws.addImage(logoId, { tl: { col: 0.15, row: 0.15 }, ext: { width: 110, height: 62 } });
  } catch {
    // si no carga el logo, el banner de color se queda solo — no bloquea la exportación
  }

  ws.mergeCells("C1:" + lastColLetter + "2");
  const tituloBanner = ws.getCell("C1");
  tituloBanner.value = "TIH — Tablero de Información de Hidrocarburos";
  tituloBanner.font = { bold: true, color: { argb: BLANCO }, size: 14, name: "Calibri" };
  tituloBanner.alignment = { vertical: "middle", horizontal: "left" };

  ws.mergeCells("C3:" + lastColLetter + "3");
  const subBanner = ws.getCell("C3");
  subBanner.value = "Secretaría de Energía";
  subBanner.font = { color: { argb: "FFB7D9CD" }, size: 9, italic: true };
  subBanner.alignment = { vertical: "middle", horizontal: "left" };

  // ── Título / metadatos ─────────────────────────────────────────────────
  let fila = 5;
  ws.mergeCells(`A${fila}:${lastColLetter}${fila}`);
  const tCell = ws.getCell(`A${fila}`);
  tCell.value = titulo;
  tCell.font = { bold: true, size: 13, color: { argb: "FF1E293B" } };
  fila++;

  if (subtitulo) {
    const esMultilinea = subtitulo.includes("\n");
    const filaFin = esMultilinea ? fila + 1 : fila;
    ws.mergeCells(`A${fila}:${lastColLetter}${filaFin}`);
    const sCell = ws.getCell(`A${fila}`);
    sCell.value = subtitulo;
    sCell.font = { size: esMultilinea ? 8 : 10, color: { argb: "FF1E293B" } };
    sCell.alignment = esMultilinea
      ? { horizontal: "center", vertical: "middle", wrapText: true }
      : { horizontal: "left" };
    fila = filaFin + 1;
  }
  if (periodoNota) {
    ws.mergeCells(`A${fila}:${lastColLetter}${fila}`);
    const pCell = ws.getCell(`A${fila}`);
    pCell.value = periodoNota;
    pCell.font = { size: 9, color: { argb: GRIS_TEXTO } };
    fila++;
  }
  ws.mergeCells(`A${fila}:${lastColLetter}${fila}`);
  const fechaCell = ws.getCell(`A${fila}`);
  fechaCell.value = `Exportado el ${new Date().toLocaleString("es-MX")}`;
  fechaCell.font = { size: 8, color: { argb: GRIS_TEXTO } };
  fila += 2;

  // ── Tabla pivote (plana: 1 fila por combinación hoja, 1 columna por serie) ──
  if (tablaPivot?.columnasValor?.length) {
    const { columnasIdentidad, columnasValor, filas: filasPivot } = tablaPivot;
    const headerRow = ws.getRow(fila);
    [...columnasIdentidad, ...columnasValor].forEach((c, i) => { headerRow.getCell(i + 1).value = c; });
    headerRow.eachCell({ includeEmpty: false }, cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE_OSCURO } };
      cell.font = { bold: true, color: { argb: BLANCO }, size: 11 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = { bottom: { style: "thin", color: { argb: VERDE_CLARO } } };
    });
    fila++;

    filasPivot.forEach((f) => {
      const row = ws.getRow(fila);
      columnasIdentidad.forEach((_, i) => {
        const cell = row.getCell(i + 1);
        cell.value = f.identidad[i] ?? "";
        cell.font = { size: 11 };
        cell.alignment = { horizontal: "center" };
      });
      columnasValor.forEach((_, i) => {
        const cell = row.getCell(columnasIdentidad.length + i + 1);
        const v = f.valores[i];
        cell.value = (v === 0 || v == null) ? 0 : v;
        cell.numFmt = "#,##0.00";
        cell.alignment = { horizontal: "center" };
        cell.font = { size: 11 };
      });
      fila++;
    });

    ws.getColumn(1).width = 26;
    for (let i = 2; i <= numCols; i++) ws.getColumn(i).width = 20;
    for (let i = 0; i < columnasIdentidad.length; i++) ws.getColumn(i + 1).width = 18;
    fila += 1;
  } else if (tabla?.columnas?.length) {
    const headerRow = ws.getRow(fila);
    headerRow.getCell(1).value = etiquetaFilaTabla;
    tabla.columnas.forEach((c, i) => { headerRow.getCell(i + 2).value = c; });
    headerRow.eachCell({ includeEmpty: false }, cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE_OSCURO } };
      cell.font = { bold: true, color: { argb: BLANCO }, size: 10 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = { bottom: { style: "thin", color: { argb: VERDE_CLARO } } };
    });
    headerRow.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
    fila++;

    tabla.filas.forEach((f, ri) => {
      const row = ws.getRow(fila);
      row.getCell(1).value = f.label;
      row.getCell(1).font = { bold: true, size: 10, color: { argb: "FF334155" } };
      f.valores.forEach((v, i) => {
        const cell = row.getCell(i + 2);
        cell.value = (v === 0 || v == null) ? null : v;
        cell.numFmt = "#,##0.00";
        cell.alignment = { horizontal: "center" };
        cell.font = { size: 10 };
      });
      row.eachCell({ includeEmpty: false }, cell => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ri % 2 ? "FFF8FAFC" : "FFFFFFFF" } };
      });
      fila++;
    });
    ws.getColumn(1).width = 26;
    for (let i = 2; i <= numCols; i++) ws.getColumn(i).width = 12;
    fila += 1;
  }

  // ── Tabla secundaria (ranking) ──────────────────────────────────────────
  if (tablaSecundaria?.columnas?.length) {
    if (tituloTablaSecundaria) {
      ws.mergeCells(`A${fila}:${lastColLetter}${fila}`);
      const th = ws.getCell(`A${fila}`);
      th.value = tituloTablaSecundaria;
      th.font = { bold: true, size: 11, color: { argb: "FF1E293B" } };
      fila++;
    }
    const headerRow = ws.getRow(fila);
    tablaSecundaria.columnas.forEach((c, i) => { headerRow.getCell(i + 1).value = c; });
    headerRow.eachCell({ includeEmpty: false }, cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE_OSCURO } };
      cell.font = { bold: true, color: { argb: BLANCO }, size: 10 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    fila++;

    tablaSecundaria.filas.forEach((f, ri) => {
      const row = ws.getRow(fila);
      f.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        cell.value = v;
        cell.alignment = { horizontal: i === 0 ? "left" : "center" };
        cell.font = { size: 10 };
      });
      row.eachCell({ includeEmpty: false }, cell => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ri % 2 ? "FFF8FAFC" : "FFFFFFFF" } };
      });
      fila++;
    });
    fila += 1;
  }

  // ── Gráfica de tendencia (imagen) ────────────────────────────────────────
  if (chartImageBase64) {
    if (chartTitulo) {
      ws.mergeCells(`A${fila}:${lastColLetter}${fila}`);
      const ch = ws.getCell(`A${fila}`);
      ch.value = chartTitulo;
      ch.font = { bold: true, size: 11, color: { argb: "FF1E293B" } };
      fila++;
    }
    const base64 = chartImageBase64.replace(/^data:image\/\w+;base64,/, "");
    const imgId = wb.addImage({ base64, extension: "png" });
    ws.addImage(imgId, { tl: { col: 0, row: fila - 1 }, ext: { width: 760, height: 320 } });
    fila += 17;
  }

  const buffer = await wb.xlsx.writeBuffer();
  descargarBuffer(buffer, nombreArchivo);
}
