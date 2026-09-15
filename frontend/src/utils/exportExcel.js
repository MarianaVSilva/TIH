import ExcelJS from "exceljs";
import { lineasEncabezado } from "./encabezadoDescargable";

// Descargable plano, igual al archivo de referencia de la CNH: unas líneas de
// encabezado en texto suelto, la fila de títulos de columna y los datos. Sin
// logo, sin banner, sin colores, sin negritas, sin celdas combinadas y sin
// gráficas — es un archivo de datos, no un documento de diseño.

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
 * Genera y descarga un .xlsx plano con el encabezado institucional, la nota de
 * período y los filtros vigentes, y la tabla que se está viendo (ya filtrada).
 *
 * @param {object} p
 * @param {string} p.titulo - Nombre del pozo/campo/cuenca.
 * @param {string} [p.subtitulo] - Contexto (campo del pozo, filtros activos…).
 * @param {string} [p.periodoNota] - Texto de qué período representan los datos.
 * @param {{columnas: string[], filas: {label: string, valores: (number|string)[]}[]}} [p.tabla] - formato jerárquico (indentado, 1 columna de valor por período).
 * @param {{columnasIdentidad: string[], columnasValor: string[], filas: {identidad: (string|number)[], valores: (number|string)[]}[]}} [p.tablaPivot] - formato plano/pivote: 1 fila por combinación hoja, 1 columna por producto/serie. Tiene prioridad sobre `tabla` cuando ambos vienen.
 * @param {{columnas: string[], filas: (string|number)[][]}} [p.tablaSecundaria] - p. ej. ranking de pozos.
 * @param {string} [p.tituloTablaSecundaria]
 * @param {string} [p.nombreArchivo]
 */
export async function exportarProduccionExcel(p) {
  const {
    titulo, subtitulo, periodoNota,
    tabla, tablaPivot, tablaHistorica, tablaSecundaria, tituloTablaSecundaria,
    etiquetaFilaTabla = "Producto",
    nombreArchivo = `TIH_${titulo}.xlsx`.replace(/[^\w.\-]+/g, "_"),
  } = p;

  const wb = new ExcelJS.Workbook();
  wb.creator = "TIH — Tablero de Información de Hidrocarburos";
  wb.created = new Date();
  const ws = wb.addWorksheet("Datos");

  const numColsPivot = tablaPivot ? (tablaPivot.columnasIdentidad.length + tablaPivot.columnasValor.length) : 0;
  const numCols = Math.max((tabla?.columnas?.length ?? 0) + 1, (tablaSecundaria?.columnas?.length ?? 0), numColsPivot, tablaHistorica?.columnas?.length ?? 0, 6);

  let fila = 1;
  for (const linea of lineasEncabezado({ titulo, subtitulo, periodoNota })) {
    if (linea) ws.getCell(`A${fila}`).value = linea;
    fila++;
  }

  const escribirTitulos = (titulos) => {
    const row = ws.getRow(fila);
    titulos.forEach((c, i) => { row.getCell(i + 1).value = c; });
    fila++;
  };

  // ── Tabla histórica ("Descargar todo"): consulta directa sin filtrar, puede
  // traer decenas de miles de filas — se usa addRows en bloque (no celda por
  // celda) para que la generación no se vuelva lenta.
  if (tablaHistorica?.columnas?.length) {
    escribirTitulos(tablaHistorica.columnas);
    ws.addRows(tablaHistorica.filas);
    fila += tablaHistorica.filas.length;
    for (let i = 1; i <= numCols; i++) ws.getColumn(i).width = 20;
    ws.getColumn(1).width = 14;
    fila += 1;
  } else if (tablaPivot?.columnasValor?.length) {
    const { columnasIdentidad, columnasValor, filas: filasPivot } = tablaPivot;
    escribirTitulos([...columnasIdentidad, ...columnasValor]);

    filasPivot.forEach((f) => {
      const row = ws.getRow(fila);
      columnasIdentidad.forEach((_, i) => { row.getCell(i + 1).value = f.identidad[i] ?? ""; });
      columnasValor.forEach((_, i) => {
        const cell = row.getCell(columnasIdentidad.length + i + 1);
        const v = f.valores[i];
        cell.value = (v === 0 || v == null) ? 0 : v;
        cell.numFmt = "#,##0.00";
      });
      fila++;
    });

    for (let i = 1; i <= numCols; i++) ws.getColumn(i).width = 20;
    for (let i = 0; i < columnasIdentidad.length; i++) ws.getColumn(i + 1).width = 22;
    fila += 1;
  } else if (tabla?.columnas?.length) {
    escribirTitulos([etiquetaFilaTabla, ...tabla.columnas]);

    tabla.filas.forEach((f) => {
      const row = ws.getRow(fila);
      row.getCell(1).value = f.label;
      f.valores.forEach((v, i) => {
        const cell = row.getCell(i + 2);
        cell.value = (v === 0 || v == null) ? null : v;
        cell.numFmt = "#,##0.00";
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
      ws.getCell(`A${fila}`).value = tituloTablaSecundaria;
      fila++;
    }
    escribirTitulos(tablaSecundaria.columnas);

    tablaSecundaria.filas.forEach((f) => {
      const row = ws.getRow(fila);
      f.forEach((v, i) => { row.getCell(i + 1).value = v; });
      fila++;
    });
    fila += 1;
  }

  const buffer = await wb.xlsx.writeBuffer();
  descargarBuffer(buffer, nombreArchivo);
}
