import datetime
from concurrent.futures import ThreadPoolExecutor
from sqlalchemy.engine import Engine
from app.services import (
    perforacion_service, precios_service, produccion_service,
    reservas_service, contratos_service, inversiones_service,
)
from app.services.cache_utils import cached


def _safe(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except Exception:
        return None


def _cambio_pct(data):
    """% de cambio del último valor real vs el penúltimo valor real de la serie."""
    vals = [v for v in data if v is not None]
    if len(vals) < 2 or not vals[-2]:
        return None
    return round((vals[-1] - vals[-2]) / vals[-2] * 100, 1)


@cached()
def get_resumen(engine: Engine) -> dict:
    """Un dato destacado por sección: KPI + tendencia + nota, para el panorama inicial."""
    cur_year = datetime.date.today().year
    end_year = cur_year - 1
    start_year = end_year - 4

    highlights = []

    # Consultas independientes entre sí (distintas tablas/fuentes externas):
    # se disparan en paralelo para que el panorama tarde el máximo de las
    # latencias en vez de la suma de todas.
    with ThreadPoolExecutor(max_workers=13) as pool:
        f_nacional = pool.submit(_safe, produccion_service.get_resumen_nacional, engine)
        f_top_campos = pool.submit(_safe, produccion_service.get_top_campos, engine, 10)
        f_por_operador = pool.submit(_safe, produccion_service.get_produccion_por_operador, engine)
        f_pozos_operando = pool.submit(_safe, produccion_service.get_pozos_operando, engine)
        f_indicadores_economicos = pool.submit(_safe, precios_service.get_indicadores_desde_precios, engine)
        f_perf = pool.submit(
            _safe, perforacion_service.get_perforacion, engine, topic="PozPerf",
            start_year=start_year, end_year=end_year, start_month=1, end_month=12, period="annually",
        )
        f_precios = pool.submit(_safe, precios_service.get_precios, engine, start_year, end_year)
        f_prod = pool.submit(_safe, produccion_service.get_produccion_cuenca, engine, start_year, end_year, 1, 12, "annually")
        f_res = pool.submit(_safe, reservas_service.get_reservas, engine, start_year, end_year, "PROBADAS")
        f_contr = pool.submit(_safe, contratos_service.get_contratos, engine, start_year, end_year, 1, 12, "annually", "CONTRATO")
        f_inv = pool.submit(_safe, inversiones_service.get_inversiones, engine, start_year, end_year, "estado")
        f_top5_reservas = pool.submit(_safe, reservas_service.get_top5_reservas_por_campo, engine, 5)
        f_reservas_1p2p3p = pool.submit(_safe, reservas_service.get_reservas_1p2p3p, engine)

        nacional = f_nacional.result() or {}
        top_campos = f_top_campos.result() or {}
        por_operador = f_por_operador.result() or {}
        pozos_operando = f_pozos_operando.result() or {}
        indicadores_economicos = f_indicadores_economicos.result() or {}
        perf = f_perf.result()
        precios = f_precios.result()
        prod = f_prod.result()
        res = f_res.result()
        contr = f_contr.result()
        inv = f_inv.result()
        top5_reservas = f_top5_reservas.result() or {}
        reservas_1p2p3p = f_reservas_1p2p3p.result() or {}

    # ── Actividad petrolera: Pozos Perforados ─────────────────────────────
    if perf and perf.get("groups"):
        kpis = perf.get("kpis", {})
        chart = None
        nac = next((g for g in perf["groups"] if g["cuenca"] == "Nacional"), None)
        if nac:
            sg = next((s for s in nac["subgroups"] if s["ubicacion"] == "Nacional"), None)
            total_row = next((r for r in (sg["rows"] if sg else []) if r["type"] == "total"), None)
            if total_row:
                chart = {"categories": perf["categories"], "data": total_row["data"]}
        highlights.append({
            "seccion": "Actividad petrolera",
            "titulo": "Pozos perforados",
            "kpi_value": f"{kpis.get('total', 0):,}",
            "kpi_label": f"pozos entre {start_year}-{end_year}",
            "chart": chart,
            "cambio": _cambio_pct(chart["data"]) if chart else None,
            "color": "#0d9488",
            "nota": (
                f"El operador con más pozos perforados fue {kpis.get('operador_top', '—')}, "
                f"en la cuenca {kpis.get('cuenca_top', '—')}, durante {kpis.get('anio_top', '—')}."
            ) if kpis else "",
        })

    # ── Indicadores Económicos: Precios ───────────────────────────────────
    if precios and precios.get("series"):
        brent = next((s for s in precios["series"] if s["name"].startswith("Brent")), None)
        if brent:
            vals = [v for v in brent["data"] if v]
            last = vals[-1] if vals else None
            maxv = max(vals) if vals else None
            # Promedio anual (el dato diario es demasiado denso para una mini-gráfica)
            anual = {}
            for periodo, v in zip(precios["categories"], brent["data"]):
                if not v:
                    continue
                anio = periodo[:4]
                anual.setdefault(anio, []).append(v)
            anios_ordenados = sorted(anual.keys())
            chart_cats = anios_ordenados
            chart_data = [round(sum(anual[a]) / len(anual[a]), 2) for a in anios_ordenados]
            highlights.append({
                "seccion": "Indicadores Económicos",
                "titulo": "Precio del petróleo (Brent)",
                "kpi_value": f"${last:,.2f}" if last is not None else "—",
                "kpi_label": "USD/barril, último dato",
                "chart": {"categories": chart_cats, "data": chart_data},
                "cambio": _cambio_pct(chart_data),
                "color": "#d97706",
                "nota": f"El precio máximo del Brent en el periodo fue de ${maxv:,.2f} USD/barril." if maxv else "",
            })

    # ── Producción ─────────────────────────────────────────────────────────
    if prod and prod.get("series"):
        nac = next((s for s in prod["series"] if s["name"] == "Nacional"), None)
        top_cuenca = max(
            (s for s in prod["series"] if s["name"] != "Nacional"),
            key=lambda s: sum(v or 0 for v in s["data"]), default=None,
        )
        if nac:
            last_val = next((v for v in reversed(nac["data"]) if v), None)
            highlights.append({
                "seccion": "Producción",
                "titulo": "Producción nacional de líquidos",
                "kpi_value": f"{last_val:,.0f}" if last_val is not None else "—",
                "kpi_label": "miles de barriles diarios, último año",
                "chart": {"categories": prod["categories"], "data": nac["data"]},
                "cambio": _cambio_pct(nac["data"]),
                "color": "#4f46e5",
                "nota": f"La cuenca con mayor producción en el periodo fue {top_cuenca['name']}." if top_cuenca else "",
            })

    # ── Recursos y Reservas ────────────────────────────────────────────────
    if res and res.get("series_aceite"):
        categories = res["categories"]
        total_by_year = [
            sum((s["data"][i] or 0) for s in res["series_aceite"]) for i in range(len(categories))
        ]
        top_cuenca = max(res["series_aceite"], key=lambda s: sum(v or 0 for v in s["data"]), default=None)
        highlights.append({
            "seccion": "Recursos y Reservas",
            "titulo": "Reservas probadas de aceite",
            "kpi_value": f"{total_by_year[-1]:,.1f}" if total_by_year else "—",
            "kpi_label": "millones de barriles, último año",
            "chart": {"categories": categories, "data": total_by_year},
            "cambio": _cambio_pct(total_by_year),
            "color": "#059669",
            "nota": f"La cuenca con mayores reservas probadas de aceite es {top_cuenca['name']}." if top_cuenca else "",
        })

    # ── Licitaciones y Contratos ───────────────────────────────────────────
    if contr and contr.get("series"):
        top_grupo = max(contr["series"], key=lambda s: sum(v or 0 for v in s["data"]), default=None)
        total_by_year = [
            sum((s["data"][i] or 0) for s in contr["series"]) for i in range(len(contr["categories"]))
        ]
        highlights.append({
            "seccion": "Licitaciones y Contratos",
            "titulo": "Producción por contratos",
            "kpi_value": f"{total_by_year[-1]:,.0f}" if total_by_year else "—",
            "kpi_label": "mbd de líquidos, último año",
            "chart": {"categories": contr["categories"], "data": total_by_year},
            "cambio": _cambio_pct(total_by_year),
            "color": "#e11d48",
            "nota": f"El grupo con mayor producción por contratos fue {top_grupo['name']}." if top_grupo else "",
        })

    # ── Inversión ──────────────────────────────────────────────────────────
    if inv and inv.get("series"):
        total_by_year = [
            sum((s["data"][i] or 0) for s in inv["series"]) for i in range(len(inv["categories"]))
        ]
        top_actividad = max(inv["series"], key=lambda s: sum(v or 0 for v in s["data"]), default=None)
        highlights.append({
            "seccion": "Inversión",
            "titulo": "Inversión aprobada",
            "kpi_value": f"${total_by_year[-1]:,.0f}" if total_by_year else "—",
            "kpi_label": "USD aprobados, último año",
            "chart": {"categories": inv["categories"], "data": total_by_year},
            "cambio": _cambio_pct(total_by_year),
            "color": "#7c3aed",
            "nota": f"La actividad petrolera con mayor inversión aprobada fue {top_actividad['name']}." if top_actividad else "",
        })

    return {
        "highlights": highlights, "start_year": start_year, "end_year": end_year,
        "nacional": nacional, "top_campos": top_campos, "por_operador": por_operador,
        "pozos_operando": pozos_operando, "indicadores_economicos": indicadores_economicos,
        "top5_reservas": top5_reservas, "reservas_1p2p3p": reservas_1p2p3p,
    }
