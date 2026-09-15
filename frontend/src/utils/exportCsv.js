import { lineasEncabezado } from "./encabezadoDescargable";

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Descarga un CSV con el mismo encabezado institucional que el .xlsx de
 * Pozos (título + subtítulo + nota de período + fecha de exportación),
 * seguido de la tabla que se está viendo — respeta lo que el usuario tenga
 * filtrado/buscado/oculto en pantalla, no el dataset completo sin filtrar.
 *
 * @param {object} p
 * @param {string} p.titulo
 * @param {string} [p.subtitulo]
 * @param {string} [p.periodoNota]
 * @param {string[]} p.columnas
 * @param {(string|number)[][]} p.filas
 * @param {string} [p.nombreArchivo]
 */
export function descargarCsvConHeader({ titulo, subtitulo, periodoNota, columnas, filas, nombreArchivo }) {
  const encabezado = lineasEncabezado({ titulo, subtitulo, periodoNota }).map(l => [l]);
  const allLines = [...encabezado, columnas, ...filas];
  // BOM al inicio: sin esto Excel interpreta el CSV como Latin-1 y los
  // acentos/ñ salen como caracteres corruptos (mojibake).
  const csv = "﻿" + allLines.map(line => line.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: (nombreArchivo ?? `TIH_${titulo}.csv`).replace(/[^\w.\-]+/g, "_"),
  });
  a.click();
  URL.revokeObjectURL(url);
}
