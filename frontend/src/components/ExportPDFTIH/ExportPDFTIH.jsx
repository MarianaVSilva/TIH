import React, { useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

/**
 * COMPONENTE: Exportar PDF del TIH (Tablero de Información de Hidrocarburos)
 *
 * Props requeridas:
 * - data: objeto con todos los datos del dashboard (buildExportPDFData en HomeDashboard.jsx)
 * - onClose: función para cerrar el modal
 * - isOpen: booleano para mostrar/ocultar modal
 */

const ExportPDFTIH = ({ data, onClose, isOpen }) => {
  const [selectedSections, setSelectedSections] = useState({
    produccion: true,
    indicadores: true,
    campos: true,
    operador: true,
    reservas: true,
    pozos: true,
  });

  const [isGenerating, setIsGenerating] = useState(false);

  const handleCheckboxChange = (section) => {
    setSelectedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const generatePDF = async () => {
    setIsGenerating(true);

    try {
      const htmlContent = generateDashboardHTML(data, selectedSections);

      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlContent;
      tempDiv.style.position = 'absolute';
      tempDiv.style.left = '-9999px';
      tempDiv.style.top = '0';
      tempDiv.style.width = '800px'; // ancho fijo tipo A4 portrait a escala
      document.body.appendChild(tempDiv);

      const canvas = await html2canvas(tempDiv, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      });

      // Página dimensionada al alto real del contenido (lienzo continuo en
      // vez de tamaño de papel fijo) — con 'a4' fijo se recortaba todo lo que
      // pasaba de una hoja. Ancho A4 portrait (210mm) con margen de 10mm.
      const imgData = canvas.toDataURL('image/png');
      const pageWidthMm = 210;
      const marginMm = 10;
      const contentWidthMm = pageWidthMm - marginMm * 2;
      const imgHeightMm = (canvas.height * contentWidthMm) / canvas.width;
      const pageHeightMm = imgHeightMm + marginMm * 2;

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [pageWidthMm, pageHeightMm],
      });

      pdf.addImage(imgData, 'PNG', marginMm, marginMm, contentWidthMm, imgHeightMm);
      pdf.save('TIH-Dashboard.pdf');

      document.body.removeChild(tempDiv);
      onClose();
    } catch (error) {
      console.error('Error generando PDF:', error);
      alert('Error al generar el PDF');
    } finally {
      setIsGenerating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Exportar Panorama general</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <p className="modal-description">
          Elige qué tarjetas incluir — se genera un PDF con el mismo estilo del sitio, tal como se ven ahora en pantalla.
        </p>

        <div className="sections-list">
          {[
            { id: 'produccion', label: 'Producción mensual' },
            { id: 'indicadores', label: 'Indicadores económicos' },
            { id: 'campos', label: 'Top 8: Campos productores' },
            { id: 'operador', label: 'Producción por Operador' },
            { id: 'reservas', label: 'Top 5: Reservas por campo' },
            { id: 'pozos', label: 'Pozos operando' },
          ].map(section => (
            <label key={section.id} className="checkbox-label">
              <input
                type="checkbox"
                checked={selectedSections[section.id]}
                onChange={() => handleCheckboxChange(section.id)}
              />
              <span>{section.label}</span>
            </label>
          ))}
        </div>

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>Cancelar</button>
          <button
            className="btn-generate"
            onClick={generatePDF}
            disabled={isGenerating}
          >
            {isGenerating ? 'Generando...' : 'Generar PDF'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Paleta y tipografía copiadas 1:1 de HomeDashboard.jsx — así el PDF se ve
// como el dashboard real, no como una reinterpretación.
const INK = '#1f2430';
const MUTED = '#767b87';
const BORDER = '#e7e5e0';
const ORANGE = '#c2661a';
const VERDE = '#0d7a4a';
const VERDE_BG = '#daf0df';
const AZUL = '#1d6fa5';
const AZUL_BG = '#dbeafb';
const ROJO = '#8a2c17';
const ROJO_BG = '#fbe3d8';

function pct(valor, base) {
  if (valor == null || !base) return null;
  return Math.round(((valor - base) / base) * 1000) / 10;
}

function bigStatHTML({ label, unidad, valor, promedio, anioPromedio, color, bg }) {
  if (valor == null) return '';
  const cambio = pct(valor, promedio);
  const up = cambio > 0;
  return `
    <div style="flex:1; min-width:0; text-align:center; background:${bg}; padding:16px 18px; border-radius:8px;">
      <div style="font-size:13px; color:${INK}; line-height:1.4;">${label} · ${unidad}</div>
      <div style="font-family:Georgia, serif; color:${color}; font-size:32px; font-weight:700; line-height:1.3; margin-top:2px;">
        ${valor.toLocaleString('es-MX')}
      </div>
      ${cambio != null ? `
        <div style="font-size:12px; font-weight:600; margin-top:2px; line-height:1.45; color:${up ? '#059669' : ORANGE};">
          ${up ? '↑' : '↓'} ${Math.abs(cambio)}%
          <span style="font-weight:400; color:${MUTED};"> vs ${promedio.toLocaleString('es-MX')} promedio${anioPromedio ? ' ' + anioPromedio : ''}</span>
        </div>
      ` : ''}
    </div>
  `;
}

function indicadorHTML({ label, valor, anterior, color, bg }) {
  if (valor == null) return '';
  const cambio = pct(valor, anterior);
  const subiendo = cambio > 0;
  const bajando = cambio < 0;
  return `
    <div style="flex:1; min-width:0; text-align:center; background:${bg}; padding:16px 18px; border-radius:8px;">
      <div style="font-size:13px; color:${INK}; line-height:1.4;">${label} · USD/barril</div>
      <div style="font-family:Georgia, serif; color:${color}; font-size:32px; font-weight:700; line-height:1.3; margin-top:2px;">
        $${valor.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
      </div>
      ${cambio != null ? `
        <div style="font-size:12px; font-weight:600; margin-top:2px; line-height:1.45; color:${subiendo ? '#059669' : bajando ? ORANGE : MUTED};">
          ${subiendo ? '↑' : bajando ? '↓' : '→'} ${Math.abs(cambio)}%
          <span style="font-weight:400; color:${MUTED};"> vs cierre anterior</span>
        </div>
      ` : ''}
    </div>
  `;
}

// Medidor de texto reutilizable (canvas fuera de pantalla) para dimensionar
// la pill exactamente al ancho de su texto.
let _ctxMedir = null;
function anchoTexto(texto, font) {
  if (!_ctxMedir) _ctxMedir = document.createElement('canvas').getContext('2d');
  _ctxMedir.font = font;
  return _ctxMedir.measureText(texto).width;
}

const CHIP_FS = 10.5;
const CHIP_H = 20;
const CHIP_PAD_X = 11;
const CHIP_LS = 0.4; // letter-spacing en px
const CHIP_FAM = "'Open Sans', Arial, sans-serif";

// La pill se dibuja como SVG en línea, NO como <span> con background.
// Motivo: html2canvas coloca mal la línea base del texto HTML (lo baja ~5.8px
// respecto al centro de su caja, medido), y en un óvalo de 20px eso se nota
// muchísimo — el texto quedaba pegado al borde inferior. Da igual el
// line-height o el padding: el sesgo es del motor de texto de html2canvas.
// Con SVG, html2canvas serializa y deja que el navegador lo pinte nativamente,
// así que text-anchor/dominant-baseline centran de verdad (es la misma razón
// por la que el "92%" de las donas sí sale centrado).
function chipHTML(texto, color, bg) {
  const t = String(texto).toUpperCase();
  const font = `700 ${CHIP_FS}px ${CHIP_FAM}`;
  // measureText no considera letter-spacing; lo sumo aparte.
  const anchoTxt = anchoTexto(t, font) + CHIP_LS * Math.max(t.length - 1, 0);
  const w = Math.ceil(anchoTxt + CHIP_PAD_X * 2);
  return `<svg width="${w}" height="${CHIP_H}" viewBox="0 0 ${w} ${CHIP_H}" style="display:inline-block; vertical-align:middle;">
    <rect x="0" y="0" width="${w}" height="${CHIP_H}" rx="${CHIP_H / 2}" ry="${CHIP_H / 2}" fill="${bg}"/>
    <text x="${w / 2}" y="${CHIP_H / 2}" text-anchor="middle" dominant-baseline="central"
      font-family="${CHIP_FAM}" font-size="${CHIP_FS}" font-weight="700"
      letter-spacing="${CHIP_LS}" fill="${color}"
      >${t}</text>
  </svg>`;
}

function cardTitleHTML(chip, chipColor, chipBg, titulo) {
  return `
    <div style="margin-bottom:14px;">
      ${chipHTML(chip, chipColor, chipBg)}
      ${titulo ? `<span style="display:inline-block; vertical-align:middle; margin-left:9px; font-size:13.5px; font-weight:700; line-height:normal; text-transform:uppercase; letter-spacing:0.02em; color:${INK};">${titulo}</span>` : ''}
    </div>
  `;
}

// Algunos nombres vienen pegados desde la base (mismo arreglo que aplica el
// dashboard en pantalla).
const NOMBRE_FIXES = {
  TUPILCOPROFUNDO: 'TUPILCO PROFUNDO',
};

function nombreDisplay(nombre) {
  return NOMBRE_FIXES[nombre] ?? nombre;
}

// Nombre y cifra en una línea, barra completa debajo — igual que ContratoBar
// del dashboard. Antes el nombre vivía en una columna fija de 98px con
// overflow:hidden, y html2canvas recortaba el texto a media altura además de
// truncar los nombres largos ("TUPILCOPROFU…"). Dándole el ancho completo de
// la columna ya no hace falta recortar nada.
function barListHTML(items, color, maxValor) {
  return items.map((item, i) => `
    <div style="margin-bottom:12px;">
      <div style="display:flex; align-items:baseline; justify-content:space-between; gap:10px; line-height:1.4;">
        <span style="font-size:11.5px; font-weight:600; color:${INK}; min-width:0;">
          <span style="color:${MUTED}; font-weight:400;">${i + 1}.</span>
          ${nombreDisplay(item.nombre ?? 'Campo ' + (i + 1))}
        </span>
        <span style="font-size:12.5px; font-weight:700; color:${INK}; white-space:nowrap;">
          ${(item.valor ?? 0).toLocaleString('es-MX')}
        </span>
      </div>
      <div style="height:6px; background:#eef0ec; border-radius:999px; margin-top:6px;">
        <div style="height:100%; width:${Math.min(((item.valor ?? 0) / maxValor) * 100, 100)}%; background:${color}; border-radius:999px;"></div>
      </div>
    </div>
  `).join('');
}

function donutSvg(pctVal, color) {
  const r = 34, cx = 42, cy = 42, circ = 2 * Math.PI * r;
  const dash = (pctVal / 100) * circ;
  return `
    <svg width="90" height="90" viewBox="0 0 84 84">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e7e5e0" stroke-width="11"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="11"
        stroke-dasharray="${dash} ${circ - dash}" stroke-linecap="round"
        transform="rotate(-90 ${cx} ${cy})"/>
      <text x="${cx}" y="${cy + 7}" text-anchor="middle" font-family="Georgia, serif" font-size="19" font-weight="700" fill="${INK}">${pctVal}%</text>
    </svg>
  `;
}

function tablaOperadorHTML({ pemexAsig, pemexMig, privRondas, privMig }) {
  return `
    <table style="width:100%; font-size:11.5px; border-collapse:collapse; margin-top:4px;">
      <tr><td style="padding:4px 0; color:${MUTED}; font-weight:600; text-transform:uppercase; font-size:10px;" colspan="2">PEMEX</td></tr>
      <tr><td style="padding:3px 0; color:${INK};">Asignaciones</td><td style="padding:3px 0; text-align:right; font-weight:700; color:${INK};">${(pemexAsig ?? 0).toLocaleString('es-MX')}</td></tr>
      <tr><td style="padding:3px 0; color:${INK};">Migraciones</td><td style="padding:3px 0; text-align:right; font-weight:700; color:${INK};">${(pemexMig ?? 0).toLocaleString('es-MX')}</td></tr>
      <tr><td style="padding:4px 0 3px; color:${MUTED}; font-weight:600; text-transform:uppercase; font-size:10px; border-top:1px solid ${BORDER};" colspan="2">PRIVADOS</td></tr>
      <tr><td style="padding:3px 0; color:${INK};">Rondas</td><td style="padding:3px 0; text-align:right; font-weight:700; color:${INK};">${(privRondas ?? 0).toLocaleString('es-MX')}</td></tr>
      <tr><td style="padding:3px 0; color:${INK};">Migraciones</td><td style="padding:3px 0; text-align:right; font-weight:700; color:${INK};">${(privMig ?? 0).toLocaleString('es-MX')}</td></tr>
    </table>
  `;
}

/**
 * Genera el HTML del dashboard para captura con html2canvas, replicando
 * colores/tipografía/estructura de HomeDashboard.jsx (portrait, una columna).
 */
const generateDashboardHTML = (data, selectedSections) => {
  // Periodo real de los datos (mismo texto del encabezado en pantalla); si
  // por alguna razón no viene, cae a la fecha de hoy.
  const fecha = (data.periodoLabel || new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long' })).toUpperCase();
  const logoUrl = `${window.location.origin}/SENER_LOGO2.png`;

  const camposLiq = (data.campos?.liquidos || []).slice(0, 8);
  const camposGas = (data.campos?.gas || []).slice(0, 8);
  const maxCamposLiq = Math.max(...camposLiq.map(c => c.valor ?? 0), 1);
  const maxCamposGas = Math.max(...camposGas.map(c => c.valor ?? 0), 1);

  const resAceite = (data.reservas?.aceite || []).slice(0, 5);
  const resGas = (data.reservas?.gas || []).slice(0, 5);
  const maxResAceite = Math.max(...resAceite.map(c => c.valor ?? 0), 1);
  const maxResGas = Math.max(...resGas.map(c => c.valor ?? 0), 1);

  return `
    <style>
      /* Escopado bajo .pdf-export-root: un <style> siempre aplica global sin
         importar en qué nodo del DOM quede colgado, así que estas reglas no
         deben depender de nada fuera de esta clase. */
      .pdf-export-root, .pdf-export-root * { margin:0; padding:0; box-sizing:border-box; }
      .pdf-export-root {
        font-family: 'Open Sans', Arial, sans-serif;
        background: #fff;
        color: ${INK};
        width: 800px;
        padding: 36px;
        /* line-height explícito: sin él html2canvas calcula cajas de texto
           un poco más cortas que el glifo y recorta las letras a media
           altura (era lo que cortaba los nombres de campo). */
        line-height: 1.45;
        /* Dígitos de ancho fijo: sin esto las cifras de cada ranking no
           alinean entre sí al estar alineadas a la derecha. */
        font-variant-numeric: tabular-nums;
      }
      .pdf-export-root .section-card {
        background: #fff;
        border: 1px solid ${BORDER};
        border-radius: 12px;
        padding: 22px;
        margin-bottom: 16px;
      }
      .pdf-export-root .section-card:last-child { margin-bottom: 0; }
      /* El preflight de Tailwind del sitio aplica "svg { display:block }" y
         alcanza al div temporal (vive en el documento real), lo que tiraba la
         pill a su propio renglón, separada de su título. */
      .pdf-export-root svg { display: inline-block; vertical-align: middle; }
      .pdf-export-root img { display: inline-block; vertical-align: middle; max-width: none; }
    </style>
    <div class="pdf-export-root">
      <!-- Logo y título alineados con inline-block + vertical-align:middle, no
           con flex: html2canvas ignora align-items:center y el bloque de texto
           quedaba desnivelado respecto al logo. font-size:0 en el contenedor
           elimina el espacio en blanco entre los dos elementos en línea, para
           que la separación la fije solo el margin-left.
           El top:-5px del bloque de texto compensa el sesgo de línea base de
           html2canvas: baja el texto ~5-6px dentro de su caja, pero al logo
           (imagen) lo coloca bien, así que sin esto el título quedaba 5px por
           debajo del centro de "Energía" (medido sobre el PDF). -->
      <div style="border-bottom:1px solid ${BORDER}; padding-bottom:16px; margin-bottom:22px; font-size:0;">
        <img src="${logoUrl}" style="display:inline-block; vertical-align:middle; height:42px; width:auto;" crossorigin="anonymous" />
        <div style="display:inline-block; vertical-align:middle; margin-left:16px; position:relative; top:-5px;">
          <div style="font-size:19px; font-weight:700; line-height:1.25; color:${INK};">Tablero de Información de Hidrocarburos</div>
          <div style="font-size:11px; font-weight:700; line-height:1.35; letter-spacing:0.02em; margin-top:3px; color:${ORANGE};">DATOS A ${fecha}</div>
        </div>
      </div>

      ${selectedSections.produccion && (data.produccion?.liquidos != null || data.produccion?.gas != null) ? `
      <div class="section-card">
        ${cardTitleHTML('Producción', VERDE, VERDE_BG, 'Mensual')}
        <div style="display:flex; gap:14px;">
          ${bigStatHTML({ label: 'Hidrocarburos líquidos', unidad: 'Mbd', valor: data.produccion?.liquidos, promedio: data.produccion?.liquidosPromedio, anioPromedio: data.produccion?.liquidosAnioPromedio, color: VERDE, bg: VERDE_BG })}
          ${bigStatHTML({ label: 'Gas natural', unidad: 'MMpcd', valor: data.produccion?.gas, promedio: data.produccion?.gasPromedio, anioPromedio: data.produccion?.gasAnioPromedio, color: AZUL, bg: AZUL_BG })}
        </div>
      </div>
      ` : ''}

      ${selectedSections.indicadores && (data.mercado?.brent != null || data.mercado?.mezcla != null) ? `
      <div class="section-card">
        ${cardTitleHTML('Mercado', ROJO, ROJO_BG, 'Indicadores Económicos')}
        <div style="display:flex; gap:14px;">
          ${indicadorHTML({ label: 'Precio del petróleo (Brent)', valor: data.mercado?.brent, anterior: data.mercado?.brentAnterior, color: ROJO, bg: ROJO_BG })}
          ${indicadorHTML({ label: 'Mezcla Mexicana de Exportación', valor: data.mercado?.mezcla, anterior: data.mercado?.mezclaAnterior, color: VERDE, bg: VERDE_BG })}
        </div>
      </div>
      ` : ''}

      ${selectedSections.campos && (camposLiq.length || camposGas.length) ? `
      <div class="section-card">
        ${cardTitleHTML('Campos', VERDE, VERDE_BG, 'Top 8 Productores')}
        <div style="display:flex; gap:20px;">
          <div style="flex:1; min-width:0;">
            <div style="font-size:11px; font-style:italic; color:${MUTED}; margin-bottom:6px;">Mbd</div>
            ${barListHTML(camposLiq, VERDE, maxCamposLiq)}
          </div>
          <div style="flex:1; min-width:0;">
            <div style="font-size:11px; font-style:italic; color:${MUTED}; margin-bottom:6px;">MMpcd</div>
            ${barListHTML(camposGas, AZUL, maxCamposGas)}
          </div>
        </div>
      </div>
      ` : ''}

      ${selectedSections.reservas && (resAceite.length || resGas.length) ? `
      <div class="section-card">
        ${cardTitleHTML('Reservas', ORANGE, '#fbe6d3', 'Top 5: Reservas por campo')}
        <div style="display:flex; gap:20px;">
          <div style="flex:1; min-width:0;">
            <div style="font-size:12px; font-weight:600; color:${VERDE}; margin-bottom:4px;">Reservas de aceite</div>
            <div style="font-size:11px; font-style:italic; color:${MUTED}; margin-bottom:6px;">MMb</div>
            ${barListHTML(resAceite, VERDE, maxResAceite)}
          </div>
          <div style="flex:1; min-width:0;">
            <div style="font-size:12px; font-weight:600; color:${AZUL}; margin-bottom:4px;">Reservas de gas natural</div>
            <div style="font-size:11px; font-style:italic; color:${MUTED}; margin-bottom:6px;">MMMpc</div>
            ${barListHTML(resGas, AZUL, maxResGas)}
          </div>
        </div>
      </div>
      ` : ''}

      ${selectedSections.operador && (data.operador?.liquidosPemexPorcentaje != null || data.operador?.gasPemexPorcentaje != null) ? `
      <div class="section-card">
        ${cardTitleHTML('Operador', AZUL, AZUL_BG, 'Producción por Operador')}
        <div style="display:flex; gap:20px;">
          <div style="flex:1; min-width:0; display:flex; gap:12px;">
            <div style="flex-shrink:0; width:96px; text-align:center;">
              ${donutSvg(data.operador?.liquidosPemexPorcentaje ?? 0, VERDE)}
              <div style="text-align:center; font-size:11px; line-height:1.45; margin-top:4px; color:${INK};">
                <strong>PEMEX</strong><br/>${(data.operador?.liquidosPemex ?? 0).toLocaleString('es-MX')} Mbd
              </div>
            </div>
            <div style="flex:1; min-width:0;">
              ${tablaOperadorHTML({ pemexAsig: data.operador?.pemexAsignacionesLiq, pemexMig: data.operador?.pemexMigracionesLiq, privRondas: data.operador?.privadosRondasLiq, privMig: data.operador?.privadosMigracionesLiq })}
            </div>
          </div>
          <div style="flex:1; min-width:0; display:flex; gap:12px;">
            <div style="flex-shrink:0; width:96px; text-align:center;">
              ${donutSvg(data.operador?.gasPemexPorcentaje ?? 0, AZUL)}
              <div style="text-align:center; font-size:11px; line-height:1.45; margin-top:4px; color:${INK};">
                <strong>PEMEX</strong><br/>${(data.operador?.gasPemex ?? 0).toLocaleString('es-MX')} MMpcd
              </div>
            </div>
            <div style="flex:1; min-width:0;">
              ${tablaOperadorHTML({ pemexAsig: data.operador?.pemexAsignacionesGas, pemexMig: data.operador?.pemexMigracionesGas, privRondas: data.operador?.privadosRondasGas, privMig: data.operador?.privadosMigracionesGas })}
            </div>
          </div>
        </div>
      </div>
      ` : ''}

      ${selectedSections.pozos && data.pozos?.total != null ? `
      <div class="section-card">
        ${cardTitleHTML('Pozos Operando', ROJO, ROJO_BG, '')}
        <div style="display:flex; gap:14px; align-items:stretch;">
          <div style="flex:1; text-align:center; background:${ROJO_BG}; border-radius:8px; padding:14px 12px;">
            <div style="font-family:Georgia, serif; font-size:26px; font-weight:700; line-height:1.35; min-height:35px; color:${ROJO};">${data.pozos.total.toLocaleString('es-MX')}</div>
            <div style="font-size:10.5px; line-height:1.4; margin-top:4px; min-height:29px; color:${ROJO}; opacity:0.85;">pozos productores en operación${data.periodoPozosLabel ? ' durante ' + data.periodoPozosLabel : ''}</div>
          </div>
          <div style="flex:1; text-align:center; background:${VERDE_BG}; border-radius:8px; padding:14px 12px;">
            <div style="font-family:Georgia, serif; font-size:26px; font-weight:700; line-height:1.35; min-height:35px; color:${VERDE};">
              ${(data.pozos.asociado ?? 0).toLocaleString('es-MX')} <span style="font-size:13px;">· ${data.pozos.asociadoPorcentaje ?? ''}</span>
            </div>
            <div style="font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:0.02em; line-height:1.4; margin-top:4px; min-height:29px; color:${VERDE};">Petróleo y gas asociado</div>
          </div>
          <div style="flex:1; text-align:center; background:${AZUL_BG}; border-radius:8px; padding:14px 12px;">
            <div style="font-family:Georgia, serif; font-size:26px; font-weight:700; line-height:1.35; min-height:35px; color:${AZUL};">
              ${(data.pozos.noAsociado ?? 0).toLocaleString('es-MX')} <span style="font-size:13px;">· ${data.pozos.noAsociadoPorcentaje ?? ''}</span>
            </div>
            <div style="font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:0.02em; line-height:1.4; margin-top:4px; min-height:29px; color:${AZUL};">Gas no asociado y condensado</div>
          </div>
        </div>
      </div>
      ` : ''}
    </div>
  `;
};

export default ExportPDFTIH;
