import re
import time
import datetime
from concurrent.futures import ThreadPoolExecutor
import httpx
import pandas as pd
from sqlalchemy import text as sqlalchemy_text
from sqlalchemy.engine import Engine
from app.config import settings
from app.services.cache_utils import cached

SCHEMA = settings.db_schema + "."

# Tabla propia para guardar el precio diario de la Mezcla Mexicana tal como
# lo reporta el RSS de Pemex. La tabla PRECIOS de la BD la llena un proceso
# aparte que puede quedarse días atrás (ver _get_mme_anterior); guardando lo
# que el RSS reportó cada día, el "sube/baja" siempre usa datos actualizados.
_PRECIOS_AUTOM_DDL = f"""
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PRECIOS_AUTOM' AND xtype='U')
    CREATE TABLE {SCHEMA}PRECIOS_AUTOM (
        FECHA DATE NOT NULL,
        PRODUCTO VARCHAR(20) NOT NULL,
        VALOR DECIMAL(10,4) NOT NULL,
        FUENTE VARCHAR(50) NULL,
        ACTUALIZADO_EN DATETIME NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_PRECIOS_AUTOM PRIMARY KEY (FECHA, PRODUCTO)
    )
"""
_precios_autom_lista = False


def _asegurar_tabla_precios_autom(engine: Engine) -> None:
    global _precios_autom_lista
    if _precios_autom_lista:
        return
    if settings.db_engine == "postgres":
        # core.fact_precios_autom ya existe (creada por postgres_migration/sql/02_core_schema.sql,
        # con la misma PK (fecha, producto)) -- no hay DDL condicional que correr aqui.
        _precios_autom_lista = True
        return
    with engine.begin() as conn:
        conn.execute(sqlalchemy_text(_PRECIOS_AUTOM_DDL))
    _precios_autom_lista = True


def _guardar_precio_autom(engine: Engine, producto: str, fecha: str, valor: float, fuente: str) -> None:
    _asegurar_tabla_precios_autom(engine)
    if settings.db_engine == "postgres":
        sql = """
            INSERT INTO core.fact_precios_autom (fecha, producto, valor, fuente, actualizado_en)
            VALUES (:fecha, :producto, :valor, :fuente, now())
            ON CONFLICT (fecha, producto) DO UPDATE SET
                valor = EXCLUDED.valor, fuente = EXCLUDED.fuente, actualizado_en = now()
        """
    else:
        sql = f"""
            MERGE {SCHEMA}PRECIOS_AUTOM AS destino
            USING (SELECT :fecha AS FECHA, :producto AS PRODUCTO) AS origen
            ON destino.FECHA = origen.FECHA AND destino.PRODUCTO = origen.PRODUCTO
            WHEN MATCHED THEN UPDATE SET VALOR = :valor, FUENTE = :fuente, ACTUALIZADO_EN = GETDATE()
            WHEN NOT MATCHED THEN INSERT (FECHA, PRODUCTO, VALOR, FUENTE) VALUES (:fecha, :producto, :valor, :fuente);
        """
    with engine.begin() as conn:
        conn.execute(sqlalchemy_text(sql), {"fecha": fecha, "producto": producto, "valor": valor, "fuente": fuente})


def _get_precio_autom_anterior(engine: Engine, producto: str, fecha_actual: str) -> float | None:
    _asegurar_tabla_precios_autom(engine)
    if settings.db_engine == "postgres":
        sql = """
            SELECT valor FROM core.fact_precios_autom
            WHERE producto = :producto AND fecha < :fecha ORDER BY fecha DESC LIMIT 1
        """
    else:
        sql = f"""
            SELECT TOP 1 VALOR FROM {SCHEMA}PRECIOS_AUTOM
            WHERE PRODUCTO = :producto AND FECHA < :fecha ORDER BY FECHA DESC
        """
    with engine.connect() as conn:
        df = pd.read_sql(sqlalchemy_text(sql), conn, params={"producto": producto, "fecha": fecha_actual})
    col = "valor" if settings.db_engine == "postgres" else "VALOR"
    return round(float(df[col].iloc[0]), 2) if not df.empty else None

# ── Indicadores económicos en vivo (Brent y Mezcla Mexicana) ─────────────────
# Ninguno de los dos vive en la base de datos: se piden directo a fuentes
# públicas y se cachean en memoria para no golpear la fuente externa en cada
# carga del Panorama general (500 usuarios concurrentes). Si la fuente falla,
# se sirve el último valor bueno conocido en vez de romper el dashboard.
_CACHE_TTL_SEG = 30 * 60  # 30 minutos: Brent es intradía, no conviene cachear tanto tiempo
_cache_indicadores = {"data": None, "ts": 0}

# FRED (EIA) publica Brent con varios días de rezago (serie administrativa, no
# tiempo real) — se usa el endpoint no oficial de Yahoo Finance, que sí refleja
# el precio del día.
YAHOO_BRENT_URL = "https://query1.finance.yahoo.com/v8/finance/chart/BZ=F?interval=1d&range=5d"
PEMEX_MEZCLA_RSS_URL = (
    "https://www.pemex.com/_layouts/15/listfeed.aspx"
    "?List=%7BA434EE21-9E96-4253-B965-9904CA37E431%7D"
)


def _get_brent_actual() -> dict | None:
    """Último precio de Brent (USD/barril) y cierre previo, Yahoo Finance (ticker BZ=F).

    OJO: meta.chartPreviousClose NO es "el cierre de ayer" — es el cierre del
    PRIMER día de la ventana `range` pedida (con range=5d, el cierre de hace
    ~5 días hábiles), lo que infla artificialmente el % de cambio. El cierre
    de ayer real se toma del penúltimo punto de la serie diaria
    `indicators.quote[0].close` (el último punto es el día de hoy, aún intradía)."""
    resp = httpx.get(YAHOO_BRENT_URL, timeout=8.0, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    result = resp.json()["chart"]["result"][0]
    meta = result["meta"]
    precio = meta.get("regularMarketPrice")
    ts = meta.get("regularMarketTime")
    if precio is None or ts is None:
        return None
    fecha = datetime.datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")

    previo = None
    try:
        closes = result["indicators"]["quote"][0]["close"]
        cierres_validos = [c for c in closes if c is not None]
        # El último cierre valido es el de hoy (intradía) si coincide con la
        # fecha de regularMarketTime; el anterior a ese es el cierre de ayer.
        if len(cierres_validos) >= 2:
            previo = cierres_validos[-2]
    except (KeyError, IndexError, TypeError):
        pass
    if previo is None:
        previo = meta.get("chartPreviousClose") or meta.get("previousClose")

    return {"fecha": fecha, "valor": round(float(precio), 2), "anterior": round(float(previo), 2) if previo is not None else None}


def _get_mezcla_mexicana() -> dict | None:
    """Último dato disponible de la Mezcla Mexicana de Exportación (USD/barril),
    del feed RSS oficial de Pemex (lista de SharePoint 'mezclaMexicana')."""
    resp = httpx.get(PEMEX_MEZCLA_RSS_URL, timeout=8.0, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    fecha_m = re.search(r"<b>fecha:</b>\s*([\d/]+)", resp.text)
    precio_m = re.search(r"<b>precio:</b>\s*([\d.]+)", resp.text)
    if not fecha_m or not precio_m:
        return None
    dia, mes, anio = fecha_m.group(1).split("/")
    return {"fecha": f"{anio}-{mes}-{dia}", "valor": round(float(precio_m.group(1)), 2)}


def _get_mme_anterior(engine: Engine, fecha_actual: str) -> float | None:
    """Cierre anterior de la Mezcla Mexicana para comparar contra el dato del
    día del RSS de Pemex y saber si sube o baja. Primero se busca en nuestra
    tabla provisional PRECIOS_AUTOM (ver _guardar_precio_autom, alimentada por
    este mismo RSS día a día); si no hay nada ahí (primer arranque) se cae a
    la tabla PRECIOS de la BD como respaldo — esa tabla la llena un proceso
    aparte que puede quedarse atrás varios días, así que si el registro
    disponible tiene más de 5 días de brecha se descarta (mejor no mostrar %
    que mostrar uno inflado por comparar contra un dato viejo)."""
    propio = _get_precio_autom_anterior(engine, "MME", fecha_actual)
    if propio is not None:
        return propio

    if settings.db_engine == "postgres":
        sql = """
            SELECT fecha, mme FROM api.v_precios
            WHERE mme IS NOT NULL AND fecha < :fecha ORDER BY fecha DESC LIMIT 1
        """
    else:
        sql = f"""
            SELECT TOP 1 FECHA, MME FROM {SCHEMA}PRECIOS
            WHERE MME IS NOT NULL AND FECHA < :fecha ORDER BY FECHA DESC
        """
    with engine.connect() as conn:
        df = pd.read_sql(sqlalchemy_text(sql), conn, params={"fecha": fecha_actual})
    df.columns = df.columns.str.lower()
    if df.empty:
        return None
    fecha_anterior = pd.to_datetime(df["fecha"].iloc[0])
    brecha_dias = (pd.to_datetime(fecha_actual) - fecha_anterior).days
    if brecha_dias > 5:
        return None
    return round(float(df["mme"].iloc[0]), 2)


def get_indicadores_economicos(engine: Engine | None = None) -> dict:
    ahora = time.time()
    if _cache_indicadores["data"] and (ahora - _cache_indicadores["ts"] < _CACHE_TTL_SEG):
        return _cache_indicadores["data"]

    anterior = _cache_indicadores["data"] or {}
    with ThreadPoolExecutor(max_workers=2) as pool:
        f_brent = pool.submit(_get_brent_actual)
        f_mezcla = pool.submit(_get_mezcla_mexicana)
        try:
            brent = f_brent.result()
        except Exception:
            brent = anterior.get("brent")
        try:
            mezcla = f_mezcla.result()
        except Exception:
            mezcla = anterior.get("mezcla_mexicana")

    if mezcla and engine is not None:
        try:
            mezcla["anterior"] = _get_mme_anterior(engine, mezcla["fecha"])
        except Exception:
            mezcla["anterior"] = None

    # PRECIOS_AUTOM: registro propio del precio del día del dashboard inicial
    # (Brent y Mezcla Mexicana), sin tocar el cálculo de sube/baja de arriba.
    if engine is not None:
        if mezcla and mezcla.get("valor") is not None:
            try:
                _guardar_precio_autom(engine, "MME", mezcla["fecha"], mezcla["valor"], "RSS Pemex")
            except Exception:
                pass  # el registro es un "nice to have" — no debe tumbar el dashboard
        if brent and brent.get("valor") is not None:
            try:
                _guardar_precio_autom(engine, "BRENT", brent["fecha"], brent["valor"], "Yahoo Finance")
            except Exception:
                pass

    data = {"brent": brent, "mezcla_mexicana": mezcla}
    _cache_indicadores["data"] = data
    _cache_indicadores["ts"] = ahora
    return data


@cached()
def get_precios(engine: Engine, start_year: int, end_year: int, start_month: int = 1, end_month: int = 12, period: str = "monthly",
                 start_date: str | None = None, end_date: str | None = None) -> dict:
    # "Diario" con calendario: rango exacto de días, sin pasar por año/mes.
    init = start_date or f"{start_year}-{start_month:02d}-01"
    end = end_date or f"{end_year}-{end_month:02d}-01"
    if settings.db_engine == "postgres":
        sql = f"""
            SELECT fecha, brent, wti, mme, henry_hub
            FROM api.v_precios
            WHERE fecha BETWEEN '{init}' AND '{end}'
            ORDER BY fecha
        """
    else:
        sql = f"""
            SELECT FECHA, BRENT, WTI, MME, HENRY_HUB
            FROM {SCHEMA}PRECIOS
            WHERE FECHA BETWEEN '{init}' AND '{end}'
            ORDER BY FECHA
        """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"series": [], "categories": [], "extremos": {}}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    cols = ["brent", "wti", "mme", "henry_hub"]
    # PRECIOS trae un registro por día — sin agregar, "Anual"/"Mensual" no
    # cambiaba nada y la tabla mostraba decenas de filas repetidas con la
    # misma etiqueta de mes. 0 se trata como "sin dato" (no se suma como si
    # el precio hubiera sido cero) antes de agrupar. "Diario" no agrega nada,
    # una fila por día tal cual está en la BD (pedido explícito).
    df[cols] = df[cols].replace(0, pd.NA)
    if period == "annually":
        df["periodo"] = df["fecha"].dt.strftime("%Y")
    elif period == "daily":
        df["periodo"] = df["fecha"].dt.strftime("%Y-%m-%d")
    else:
        df["periodo"] = df["fecha"].dt.strftime("%Y-%m")

    if period == "daily":
        # Un solo dato por día — el promedio/mín/máx del "periodo" son el
        # mismo valor, no hay nada que agregar.
        agg = df[["periodo", *cols]].sort_values("periodo")
        agg_min = agg.copy()
        agg_max = agg.copy()
    else:
        agg = df.groupby("periodo", as_index=False)[cols].mean()
        agg_min = df.groupby("periodo", as_index=False)[cols].min()
        agg_max = df.groupby("periodo", as_index=False)[cols].max()
    # Sin dato (0 en origen, o mes/año sin registros) se manda como null, no
    # como 0 — antes fillna(0) rellenaba los huecos y el gráfico/tabla mostraba
    # un precio de $0 falso. null se grafica como hueco (sin línea) y en tabla
    # como "—".
    def a_lista(serie):
        return [None if pd.isna(v) else round(float(v), 2) for v in serie]

    categories = agg["periodo"].tolist()
    nombres = {
        "brent": "Brent (USD/bbl)", "wti": "WTI (USD/bbl)",
        "mme": "MME (USD/bbl)", "henry_hub": "Henry Hub (USD/MMBtu)",
    }
    series = [
        {
            "name": nombres[c], "type": "line",
            "data": a_lista(agg[c]),
            "min": a_lista(agg_min[c]),
            "max": a_lista(agg_max[c]),
        }
        for c in cols
    ]

    # Extremos de TODO el rango seleccionado (no solo el último año/mes) — el
    # día exacto (dato diario crudo) en que cada referencia tocó su precio
    # más bajo/alto. Antes solo miraba el último periodo mostrado, así que
    # con un rango de varios años/meses un extremo real (p. ej. el WTI
    # negativo del 20/abr/2020) quedaba fuera si no caía en el último tramo
    # del rango — el mín/máx de las tarjetas ya se anuncia como "del periodo
    # mostrado" (todo lo que trae el filtro), así que debe cubrirlo entero.
    extremos = {}
    for c in cols:
        serie_valida = df[["fecha", c]].dropna(subset=[c])
        if serie_valida.empty:
            extremos[c] = {"min": None, "max": None}
            continue
        fila_min = serie_valida.loc[serie_valida[c].idxmin()]
        fila_max = serie_valida.loc[serie_valida[c].idxmax()]
        extremos[c] = {
            "min": {"valor": round(float(fila_min[c]), 2), "fecha": fila_min["fecha"].strftime("%Y-%m-%d")},
            "max": {"valor": round(float(fila_max[c]), 2), "fecha": fila_max["fecha"].strftime("%Y-%m-%d")},
        }

    return {"categories": categories, "series": series, "extremos": extremos}
