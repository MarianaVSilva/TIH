import ExcelJS from "exceljs";

// Formato "plano", calcado del descargable de referencia de la CNH
// (POZOS_TERMINADOS.csv): unas pocas líneas de encabezado en texto suelto, una
// fila de títulos de columna y los datos. Sin banners de color, sin celdas
// combinadas y sin filas cebra — además de verse sobrio, así el archivo se
// puede ordenar, filtrar y leer con pandas sin pelearse con el formato.
const TEXTO = "FF1E293B";
const GRIS_TEXTO = "FF64748B";
const FUENTE = "Noto Sans";

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

// Fila de títulos de columna: negritas y una línea abajo. Es el único adorno
// que se conserva, para separar el encabezado de los datos.
function escribirEncabezado(ws, fila, titulos) {
  const row = ws.getRow(fila);
  titulos.forEach((c, i) => {
    const cell = row.getCell(i + 1);
    cell.value = c;
    cell.font = { bold: true, size: 11, color: { argb: TEXTO }, name: FUENTE };
    cell.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: "FFBFBFBF" } } };
  });
}

/**
 * Genera y descarga un .xlsx plano con el encabezado institucional, los
 * metadatos del nivel/rango/filtros vigentes y la tabla que se está viendo
 * (ya filtrada), y opcionalmente la gráfica como imagen.
 *
 * @param {object} p
 * @param {string} p.titulo - Nombre del pozo/campo/cuenca.
 * @param {string} [p.subtitulo] - Contexto (campo del pozo, filtros activos…).
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
    tabla, tablaPivot, tablaHistorica, tablaSecundaria, tituloTablaSecundaria,
    etiquetaFilaTabla = "Producto",
    chartImageBase64, chartTitulo,
    nombreArchivo = `TIH_${titulo}.xlsx`.replace(/[^\w.\-]+/g, "_"),
  } = p;

  const wb = new ExcelJS.Workbook();
  wb.creator = "TIH — Tablero de Información de Hidrocarburos";
  wb.created = new Date();
  const ws = wb.addWorksheet("Producción", { views: [{ showGridLines: false }] });

  const numColsPivot = tablaPivot ? (tablaPivot.columnasIdentidad.length + tablaPivot.columnasValor.length) : 0;
  const numCols = Math.max((tabla?.columnas?.length ?? 0) + 1, (tablaSecundaria?.columnas?.length ?? 0), numColsPivot, tablaHistorica?.columnas?.length ?? 0, 6);

  // ── Encabezado ─────────────────────────────────────────────────────────
  // El logo va flotando sobre las primeras filas y el texto arranca debajo,
  // siempre en la columna A y sin combinar celdas.
  try {
    const logoBuffer = await cargarLogo();
    const logoId = wb.addImage({ buffer: logoBuffer, extension: "png" });
    // El PNG original es 1920x1080 (16:9) con el sello a la izquierda y texto
    // a la derecha — se respeta esa proporción para que no se vea aplastado.
    ws.addImage(logoId, { tl: { col: 0.15, row: 0.15 }, ext: { width: 130, height: 73 } });
  } catch {
    // si no carga el logo, el encabezado de texto se queda solo — no bloquea la exportación
  }
  ws.getRow(1).height = 60;

  const lineas = [
    { texto: "SECRETARÍA DE ENERGÍA", font: { bold: true, size: 11, color: { argb: TEXTO }, name: FUENTE } },
    { texto: titulo, font: { bold: true, size: 13, color: { argb: TEXTO }, name: FUENTE } },
    { texto: "" },
  ];
  if (periodoNota) lineas.push({ texto: periodoNota, font: { size: 10, color: { argb: TEXTO }, name: FUENTE } });
  // Los filtros activos viajan en el subtítulo: es lo que hace que el archivo
  // se corresponda con lo que el usuario tiene en pantalla.
  if (subtitulo) lineas.push({ texto: String(subtitulo).replace(/\n/g, " · "), font: { size: 10, color: { argb: GRIS_TEXTO }, name: FUENTE } });
  lineas.push({ texto: `Exportado el ${new Date().toLocaleString("es-MX")}`, font: { size: 9, color: { argb: GRIS_TEXTO }, name: FUENTE } });
  lineas.push({ texto: "" });

  let fila = 3;
  for (const linea of lineas) {
    if (linea.texto) {
      const cell = ws.getCell(`A${fila}`);
      cell.value = linea.texto;
      cell.font = linea.font;
      cell.alignment = { horizontal: "left", vertical: "middle" };
    }
    fila++;
  }

  // ── Tabla histórica ("Descargar todo"): consulta directa sin filtrar, puede
  // traer decenas de miles de filas — se usa addRows en bloque (no celda por
  // celda) para que la generación no se vuelva lenta.
  if (tablaHistorica?.columnas?.length) {
    escribirEncabezado(ws, fila, tablaHistorica.columnas);
    fila++;

    ws.addRows(tablaHistorica.filas);
    fila += tablaHistorica.filas.length;

    for (let i = 1; i <= numCols; i++) ws.getColumn(i).width = 20;
    ws.getColumn(1).width = 14;
    fila += 1;
  } else if (tablaPivot?.columnasValor?.length) {
    const { columnasIdentidad, columnasValor, filas: filasPivot } = tablaPivot;
    escribirEncabezado(ws, fila, [...columnasIdentidad, ...columnasValor]);
    fila++;

    filasPivot.forEach((f) => {
      const row = ws.getRow(fila);
      columnasIdentidad.forEach((_, i) => {
        const cell = row.getCell(i + 1);
        cell.value = f.identidad[i] ?? "";
        cell.font = { size: 11, name: FUENTE };
      });
      columnasValor.forEach((_, i) => {
        const cell = row.getCell(columnasIdentidad.length + i + 1);
        const v = f.valores[i];
        cell.value = (v === 0 || v == null) ? 0 : v;
        cell.numFmt = "#,##0.00";
        cell.alignment = { horizontal: "right" };
        cell.font = { size: 11, name: FUENTE };
      });
      fila++;
    });

    for (let i = 1; i <= numCols; i++) ws.getColumn(i).width = 20;
    for (let i = 0; i < columnasIdentidad.length; i++) ws.getColumn(i + 1).width = 22;
    fila += 1;
  } else if (tabla?.columnas?.length) {
    escribirEncabezado(ws, fila, [etiquetaFilaTabla, ...tabla.columnas]);
    fila++;

    tabla.filas.forEach((f) => {
      const row = ws.getRow(fila);
      row.getCell(1).value = f.label;
      row.getCell(1).font = { size: 11, color: { argb: TEXTO }, name: FUENTE };
      f.valores.forEach((v, i) => {
        const cell = row.getCell(i + 2);
        cell.value = (v === 0 || v == null) ? null : v;
        cell.numFmt = "#,##0.00";
        cell.alignment = { horizontal: "right" };
        cell.font = { size: 11, name: FUENTE };
      });
      fila++;
    });
    ws.getColumn(1).width = 30;
    for (let i = 2; i <= numCols; i++) ws.getColumn(i).width = 14;
    fila += 1;
  }

  // ── Tabla secundaria (ranking) ──────────────────────────────────────────
  if (tablaSecundaria?.columnas?.length) {
    if (tituloTablaSecundaria) {
      const th = ws.getCell(`A${fila}`);
      th.value = tituloTablaSecundaria;
      th.font = { bold: true, size: 11, color: { argb: TEXTO }, name: FUENTE };
      fila++;
    }
    escribirEncabezado(ws, fila, tablaSecundaria.columnas);
    fila++;

    tablaSecundaria.filas.forEach((f) => {
      const row = ws.getRow(fila);
      f.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        cell.value = v;
        cell.alignment = { horizontal: i === 0 ? "left" : "right" };
        cell.font = { size: 11, name: FUENTE };
      });
      fila++;
    });
    fila += 1;
  }

  // ── Gráfica de tendencia (imagen) ────────────────────────────────────────
  if (chartImageBase64) {
    if (chartTitulo) {
      const ch = ws.getCell(`A${fila}`);
      ch.value = chartTitulo;
      ch.font = { bold: true, size: 11, color: { argb: TEXTO }, name: FUENTE };
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
