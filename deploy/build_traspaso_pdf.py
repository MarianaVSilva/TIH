# -*- coding: utf-8 -*-
"""Genera TRASPASO.pdf a partir de TRASPASO.md.

No es un conversor generico de markdown: entiende exactamente las estructuras
que usa ese documento (titulos, tablas, bloques de codigo, citas, avisos) y las
compone con Platypus para que el PDF quede navegable e imprimible.
"""
import io, os, re, sys
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, NextPageTemplate,
                                PageBreak, PageTemplate, Paragraph, Spacer, Table,
                                TableStyle)
from reportlab.platypus.tableofcontents import TableOfContents

RAIZ = r"C:\Users\Mariana Vasquez\Desktop\MARIANA PROYECTOS\TIH"
ORIGEN = os.path.join(RAIZ, "TRASPASO.md")
DESTINO = os.path.join(RAIZ, "TRASPASO.pdf")

# ── Fuentes ───────────────────────────────────────────────────────────────────
# Arial y Consolas traen acentos y simbolos; las Helvetica/Courier internas de
# ReportLab usan WinAnsi y se comen varios caracteres del documento.
F = "Arial"
FB = "Arial-B"
FM = "Mono"
pdfmetrics.registerFont(TTFont(F, r"C:\Windows\Fonts\arial.ttf"))
pdfmetrics.registerFont(TTFont(FB, r"C:\Windows\Fonts\arialbd.ttf"))
pdfmetrics.registerFont(TTFont("Arial-I", r"C:\Windows\Fonts\ariali.ttf"))
pdfmetrics.registerFont(TTFont(FM, r"C:\Windows\Fonts\consola.ttf"))
pdfmetrics.registerFont(TTFont("Mono-B", r"C:\Windows\Fonts\consolab.ttf"))
pdfmetrics.registerFontFamily(F, normal=F, bold=FB, italic="Arial-I")

VERDE = colors.HexColor("#10312B")
VERDE2 = colors.HexColor("#1a4a3a")
TEAL = colors.HexColor("#0f766e")
AMBAR = colors.HexColor("#92400e")
AMBAR_BG = colors.HexColor("#fef3c7")
GRIS = colors.HexColor("#475569")
GRIS_CL = colors.HexColor("#f1f5f9")
TINTA = colors.HexColor("#1f2430")

ss = getSampleStyleSheet()
def E(n, **kw):
    kw.setdefault("fontName", F); kw.setdefault("textColor", TINTA)
    return ParagraphStyle(n, **kw)

S = {
    "h1": E("h1", fontName=FB, fontSize=17, leading=21, spaceBefore=2, spaceAfter=9, textColor=VERDE),
    "h2": E("h2", fontName=FB, fontSize=13, leading=17, spaceBefore=13, spaceAfter=6, textColor=VERDE2),
    "h3": E("h3", fontName=FB, fontSize=11, leading=14, spaceBefore=10, spaceAfter=4, textColor=TEAL),
    "p":  E("p", fontSize=9.4, leading=13.6, spaceAfter=6, alignment=TA_LEFT),
    "li": E("li", fontSize=9.4, leading=13.4, spaceAfter=3, leftIndent=12, bulletIndent=3),
    "cita": E("cita", fontSize=9, leading=13, textColor=GRIS, leftIndent=9, spaceAfter=6),
    "aviso": E("aviso", fontSize=9.2, leading=13.4, textColor=AMBAR),
    "code": E("code", fontName=FM, fontSize=8.1, leading=11.4, textColor=colors.HexColor("#0b3a30")),
    "th": E("th", fontName=FB, fontSize=8.5, leading=11.5, textColor=colors.white),
    "td": E("td", fontSize=8.5, leading=11.5),
    "cover_t": E("cover_t", fontName=FB, fontSize=30, leading=35, alignment=TA_CENTER, textColor=VERDE),
    "cover_s": E("cover_s", fontSize=13, leading=18, alignment=TA_CENTER, textColor=GRIS),
    "cover_m": E("cover_m", fontSize=9.5, leading=15, alignment=TA_CENTER, textColor=GRIS),
    "pie": E("pie", fontSize=7.6, textColor=colors.HexColor("#94a3b8")),
}

# ── Markdown en linea -> marcado de ReportLab ─────────────────────────────────
def inline(t):
    t = t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    t = re.sub(r"`([^`]+)`", r'<font face="Mono" size="8.4" color="#0b3a30">\1</font>', t)
    # Admite cursiva DENTRO de la negrita ("**texto *asi* fin**"). El cierre
    # exige no llevar otro asterisco detras: si no, en "...*que*** —" cerraba
    # con los dos primeros de los tres y dejaba un asterisco suelto a la vista.
    t = re.sub(r"\*\*(.+?)\*\*(?!\*)", r"<b>\1</b>", t)
    t = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?![\w*])", r"<i>\1</i>", t)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", t)          # enlaces: solo el texto
    t = t.replace("⚠️", "").replace("✅", "").replace("→", "-&gt;")
    return t.strip()

def celda(t, est):
    return Paragraph(inline(t), est)

# ── Lectura y troceado ────────────────────────────────────────────────────────
md = io.open(ORIGEN, encoding="utf-8").read().splitlines()

# El encabezado del documento (titulo + cita inicial) se reemplaza por portada.
i = 0
while i < len(md) and not md[i].startswith("## "):
    i += 1
cuerpo = md[i:]

hist = []
cap_n = 0

def sangria_tabla(filas):
    """Tabla con encabezado verde y filas alternadas."""
    if not filas:
        return None
    ncol = max(len(f) for f in filas)
    filas = [f + [""] * (ncol - len(f)) for f in filas]
    datos = [[celda(c, S["th"]) for c in filas[0]]]
    for f in filas[1:]:
        datos.append([celda(c, S["td"]) for c in f])
    ancho = 175 * mm
    # primera columna mas estrecha si es un indice corto
    prim = min(len(str(f[0])) for f in filas[1:]) if len(filas) > 1 else 5
    if prim <= 3:
        w = [12 * mm] + [(ancho - 12 * mm) / (ncol - 1)] * (ncol - 1)
    else:
        w = [ancho / ncol] * ncol
    t = Table(datos, colWidths=w, repeatRows=1, hAlign="LEFT")
    est = [
        ("BACKGROUND", (0, 0), (-1, 0), VERDE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, colors.HexColor("#e2e8f0")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
    ]
    for r in range(1, len(datos)):
        if r % 2 == 0:
            est.append(("BACKGROUND", (0, r), (-1, r), colors.HexColor("#f8fafc")))
    t.setStyle(TableStyle(est))
    return t

def bloque_codigo(lineas):
    txt = "<br/>".join(
        l.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace(" ", "&nbsp;")
        for l in lineas)
    p = Paragraph(txt, S["code"])
    t = Table([[p]], colWidths=[175 * mm], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f6f8f7")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("LINEBEFORE", (0, 0), (0, -1), 2.2, TEAL),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
    ]))
    return t

def bloque_aviso(parrafos):
    t = Table([[p] for p in parrafos], colWidths=[175 * mm], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), AMBAR_BG),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#fbbf24")),
        ("LINEBEFORE", (0, 0), (0, -1), 2.6, colors.HexColor("#d97706")),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t

story = []
n = 0
while n < len(cuerpo):
    ln = cuerpo[n]

    if ln.startswith("```"):
        buf = []
        n += 1
        while n < len(cuerpo) and not cuerpo[n].startswith("```"):
            buf.append(cuerpo[n]); n += 1
        n += 1
        story.append(Spacer(1, 2)); story.append(bloque_codigo(buf)); story.append(Spacer(1, 7))
        continue

    if ln.startswith("|"):
        filas = []
        while n < len(cuerpo) and cuerpo[n].startswith("|"):
            fila = [c.strip() for c in cuerpo[n].strip().strip("|").split("|")]
            if not all(re.fullmatch(r":?-{2,}:?", c or "-") for c in fila):
                filas.append(fila)
            n += 1
        t = sangria_tabla(filas)
        if t:
            story.append(Spacer(1, 2)); story.append(t); story.append(Spacer(1, 9))
        continue

    if ln.startswith("> "):
        buf = []
        while n < len(cuerpo) and (cuerpo[n].startswith(">") or
                                   (buf and cuerpo[n].strip() and not cuerpo[n].startswith(("#", "|", "```", "-")))):
            buf.append(re.sub(r"^>\s?", "", cuerpo[n])); n += 1
        txt = " ".join(x.strip() for x in buf if x.strip())
        es_aviso = "⚠" in txt or txt.lower().startswith(("ojo", "importante"))
        p = Paragraph(inline(txt), S["aviso"] if es_aviso else S["cita"])
        if es_aviso:
            story.append(bloque_aviso([p])); story.append(Spacer(1, 8))
        else:
            t = Table([[p]], colWidths=[175 * mm], hAlign="LEFT")
            t.setStyle(TableStyle([
                ("LINEBEFORE", (0, 0), (0, -1), 2.2, colors.HexColor("#cbd5e1")),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]))
            story.append(t); story.append(Spacer(1, 8))
        continue

    if ln.startswith("### "):
        txt = inline(ln[4:])
        story.append(Paragraph(txt, S["h3"])); n += 1; continue

    if ln.startswith("## "):
        cap_n += 1
        txt = inline(ln[3:])
        if cap_n > 1:
            story.append(PageBreak())
        p = Paragraph(txt, S["h2"])
        p._toc = ("s", re.sub("<[^>]+>", "", txt))
        story.append(p)
        story.append(Table([[""]], colWidths=[175 * mm], rowHeights=[1.6],
                           style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), TEAL)]), hAlign="LEFT"))
        story.append(Spacer(1, 7))
        hist.append(re.sub("<[^>]+>", "", txt))
        n += 1; continue

    if ln.strip() == "---":
        n += 1; continue

    # Una vinieta puede ocupar varias lineas del markdown. Hay que juntarlas
    # ANTES de convertir: si no, un **negrita** partido entre dos lineas se
    # queda sin cerrar y sale el asterisco literal, y la continuacion se
    # dibuja fuera de la vinieta.
    def continuacion(j):
        return (j < len(cuerpo) and cuerpo[j].strip()
                and not re.match(r"^\s*[-*] |^\d+\. |^#{1,6} |^\||^```|^>|^---\s*$", cuerpo[j]))

    m = re.match(r"^(\s*)[-*] (.+)", ln)
    if m:
        prof = len(m.group(1)) // 2
        buf = [m.group(2)]
        n += 1
        while continuacion(n):
            buf.append(cuerpo[n].strip()); n += 1
        est = ParagraphStyle("li%d" % prof, parent=S["li"],
                             leftIndent=12 + prof * 12, bulletIndent=3 + prof * 12)
        story.append(Paragraph(inline(" ".join(buf)), est,
                               bulletText="\u2022" if prof == 0 else "\u25e6"))
        continue

    m = re.match(r"^(\d+)\. (.+)", ln)
    if m:
        num, buf = m.group(1), [m.group(2)]
        n += 1
        while continuacion(n):
            buf.append(cuerpo[n].strip()); n += 1
        story.append(Paragraph(inline(" ".join(buf)), S["li"], bulletText=num + "."))
        continue

    if ln.strip():
        buf = [ln]
        n += 1
        while n < len(cuerpo) and cuerpo[n].strip() and not cuerpo[n].startswith(("#", "|", "```", ">", "-", "*")) \
                and not re.match(r"^\d+\. ", cuerpo[n]):
            buf.append(cuerpo[n]); n += 1
        story.append(Paragraph(inline(" ".join(x.strip() for x in buf)), S["p"]))
        continue

    n += 1

# ── Documento: portada + indice + cuerpo ──────────────────────────────────────
class Doc(BaseDocTemplate):
    def afterFlowable(self, flow):
        if hasattr(flow, "_toc"):
            self.notify("TOCEntry", (0, flow._toc[1], self.page))

def pie(canv, doc):
    canv.saveState()
    canv.setStrokeColor(colors.HexColor("#e2e8f0")); canv.setLineWidth(0.5)
    canv.line(18 * mm, 15 * mm, 196 * mm, 15 * mm)
    canv.setFont(F, 7.6); canv.setFillColor(colors.HexColor("#94a3b8"))
    canv.drawString(18 * mm, 10.5 * mm, "TIH \u2014 Documento de traspaso")
    canv.drawRightString(196 * mm, 10.5 * mm, "Pag. %d" % canv.getPageNumber())
    canv.restoreState()

def portada(canv, doc):
    canv.saveState()
    canv.setFillColor(VERDE); canv.rect(0, 232 * mm, 216 * mm, 47 * mm, stroke=0, fill=1)
    canv.setFillColor(TEAL); canv.rect(0, 229.6 * mm, 216 * mm, 2.4 * mm, stroke=0, fill=1)
    canv.setFillColor(colors.white); canv.setFont(FB, 26)
    canv.drawString(18 * mm, 252 * mm, "TIH")
    canv.setFont(F, 11.5); canv.setFillColor(colors.HexColor("#a7f3d0"))
    canv.drawString(18 * mm, 244 * mm, "Tablero de Informaci\u00f3n de Hidrocarburos")
    canv.restoreState()

doc = Doc(DESTINO, pagesize=LETTER,
          leftMargin=18 * mm, rightMargin=20 * mm, topMargin=20 * mm, bottomMargin=20 * mm,
          title="TIH - Documento de traspaso", author="Mariana Vazquez",
          subject="Traspaso del proyecto TIH")
marco = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="n")
marco_p = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height - 52 * mm, id="p")
doc.addPageTemplates([
    PageTemplate(id="portada", frames=[marco_p], onPage=portada),
    PageTemplate(id="normal", frames=[marco], onPage=pie),
])

toc = TableOfContents()
toc.levelStyles = [ParagraphStyle("toc", fontName=F, fontSize=10, leading=19,
                                  textColor=TINTA, leftIndent=0, firstLineIndent=0)]

port = [
    Spacer(1, 38 * mm),
    Paragraph("Documento de traspaso", S["cover_t"]),
    Spacer(1, 7 * mm),
    Paragraph("Todo lo necesario para recibir y mantener el proyecto", S["cover_s"]),
    Spacer(1, 26 * mm),
]
port.append(Table(
    [[celda("**Proyecto**", S["td"]), celda("TIH \u2014 Tablero de Informaci\u00f3n de Hidrocarburos", S["td"])],
     [celda("**En producci\u00f3n**", S["td"]), celda("`http://172.16.83.21:8091`", S["td"])],
     [celda("**Repositorio**", S["td"]), celda("`172.16.196.12/mvazquez/tih.git`", S["td"])],
     [celda("**Entrega**", S["td"]), celda("Mariana V\u00e1zquez (`mvazquez`)", S["td"])],
     [celda("**Fecha**", S["td"]), celda("Septiembre de 2026", S["td"])]],
    colWidths=[38 * mm, 110 * mm], hAlign="CENTER",
    style=TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, colors.HexColor("#e2e8f0")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("BACKGROUND", (0, 0), (0, -1), GRIS_CL),
    ])))
port.append(Spacer(1, 16 * mm))
port.append(bloque_aviso([Paragraph(
    "<b>Este documento no contiene contrase\u00f1as ni llaves.</b> La secci\u00f3n 3 indica qu\u00e9 "
    "credenciales existen, d\u00f3nde viven y por qu\u00e9 canal solicitarlas.", S["aviso"])]))

port += [NextPageTemplate("normal"), PageBreak(),
         Paragraph("Contenido", S["h1"]),
         Table([[""]], colWidths=[175 * mm], rowHeights=[1.6],
               style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), TEAL)]), hAlign="LEFT"),
         Spacer(1, 8), toc, PageBreak()]

doc.multiBuild(port + story)
print("OK ->", DESTINO)
print("secciones:", len(hist))
