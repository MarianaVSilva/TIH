import numpy as np
import pandas as pd
from sqlalchemy import text as sqlalchemy_text
from sqlalchemy.engine import Engine
from app.config import settings
from app.services.cache_utils import cached
from app.services.produccion_service import _where_fecha, _rollup_periodo
from app.services import pozos_cache

BD_POZOS = "cmde_raw.dbo.bd_pozos"


def _source_table() -> str:
    """Tabla/vista de la que se lee la producción por pozo: el caché local
    materializado e indexado (TIH_pozos_cache) si ya se sincronizó, o la vista
    original (más lenta, pero siempre disponible) si no."""
    return "TIH_pozos_cache.dbo.produccion_pozos" if pozos_cache.is_cache_available() else f"{settings.db_name}.{settings.db_schema}.PRODUCCION_POZOS"


POZO_PRODUCTOS = [
    ("liquidos_mbd",    "Hidrocarburos líquidos (Mbd)"),
    ("petroleo_mbd",    "Petróleo (Mbd)"),
    ("condensado_mbd",  "Condensado (Mbd)"),
    ("gas_mmpcd",       "Gas (MMpcd)"),
    ("gas_asoc_mmpcd",  "Gas asociado (MMpcd)"),
    ("gas_nasoc_mmpcd", "Gas no asociado (MMpcd)"),
    ("agua_mbd",        "Agua (Mbd)"),
]


# ── Árbol / detalle / resumen ────────────────────────────────────────────

@cached()
def get_produccion_pozos_arbol(engine: Engine) -> dict:
    """Árbol Cuenca→Campo (Asig_Cont)→Pozo, SIN cifras — filtrado a actividad
    de los últimos 2 años (evita listar pozos cerrados desde hace décadas)."""
    sql = f"""
        SELECT DISTINCT CUENCA, ASIG_CONT, WELL_NAME
        FROM {_source_table()}
        WHERE CUENCA IS NOT NULL AND ASIG_CONT IS NOT NULL AND WELL_NAME IS NOT NULL
          AND FECHA >= DATEADD(year, -2, GETDATE())
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"tree": []}

    df.columns = df.columns.str.lower()
    df["cuenca"] = df["cuenca"].str.title()

    tree = []
    for cuenca in sorted(df["cuenca"].dropna().unique().tolist()):
        sub_c = df[df["cuenca"] == cuenca]
        campos = []
        for campo in sorted(sub_c["asig_cont"].dropna().unique().tolist()):
            pozos = sorted(sub_c[sub_c["asig_cont"] == campo]["well_name"].dropna().unique().tolist())
            campos.append({"campo": campo, "pozos": pozos})
        tree.append({"cuenca": cuenca, "campos": campos})
    return {"tree": tree}


@cached()
def get_produccion_pozo_detalle(
    engine: Engine, campo: str, pozo: str, start_year: int, end_year: int,
    start_month: int, end_month: int, period: str, years: str = "",
) -> dict:
    """Serie de un pozo puntual (ASIG_CONT+WELL_NAME)."""
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    sql = """
        SELECT FECHA,
               PETROLEO_MBD, CONDENSADO_MBD, GAS_MMPCD, GAS_ASOC_MMPCD, GAS_NASOC_MMPCD, AGUA_MBD
        FROM {source}
        WHERE ASIG_CONT = :campo AND WELL_NAME = :pozo AND {where_fecha}
    """.format(source=_source_table(), where_fecha=where_fecha)
    with engine.connect() as conn:
        df = pd.read_sql(sqlalchemy_text(sql), conn, params={"campo": campo, "pozo": pozo})

    if df.empty:
        return {"categories": [], "rows": []}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    numeric_cols = [c for c, _ in POZO_PRODUCTOS if c != "liquidos_mbd"]
    df[numeric_cols] = df[numeric_cols].fillna(0)
    df["liquidos_mbd"] = df["petroleo_mbd"] + df["condensado_mbd"]
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly"
        else df["fecha"].dt.strftime("%Y")
    )
    df = _rollup_periodo(df, [], [c for c, _ in POZO_PRODUCTOS]).set_index("periodo")
    categories = sorted(df.index.tolist())
    df = df.reindex(categories, fill_value=0)

    rows = [
        {"label": label, "data": [round(float(v), 2) for v in df[col]]}
        for col, label in POZO_PRODUCTOS
    ]
    return {"categories": categories, "rows": rows}


@cached()
def get_produccion_pozos_resumen(
    engine: Engine, cuenca: str, campo: str, start_year: int, end_year: int,
    start_month: int, end_month: int, period: str, years: str = "",
) -> dict:
    """KPIs de producción para el nivel seleccionado en el árbol (cuenca o
    campo): total por producto en el último período del rango, y cuántos
    pozos activos hay debajo."""
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    where_extra = ""
    params = {}
    if cuenca:
        where_extra += " AND UPPER(CUENCA) = :cuenca"
        params["cuenca"] = cuenca.upper()
    if campo:
        where_extra += " AND ASIG_CONT = :campo"
        params["campo"] = campo
    sql = f"""
        SELECT FECHA, WELL_NAME,
               PETROLEO_MBD, CONDENSADO_MBD, GAS_MMPCD, GAS_ASOC_MMPCD, GAS_NASOC_MMPCD, AGUA_MBD
        FROM {_source_table()}
        WHERE {where_fecha}{where_extra}
    """
    with engine.connect() as conn:
        df = pd.read_sql(sqlalchemy_text(sql), conn, params=params)

    if df.empty:
        return {"periodo": None, "num_pozos": 0, "kpis": []}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    numeric_cols = [c for c, _ in POZO_PRODUCTOS if c != "liquidos_mbd"]
    df[numeric_cols] = df[numeric_cols].fillna(0)
    df["liquidos_mbd"] = df["petroleo_mbd"] + df["condensado_mbd"]
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly"
        else df["fecha"].dt.strftime("%Y")
    )
    cols = [c for c, _ in POZO_PRODUCTOS]
    rollup = _rollup_periodo(df, [], cols).set_index("periodo")
    ultimo = sorted(rollup.index.tolist())[-1]

    num_pozos = int(df[df["periodo"] == ultimo]["well_name"].nunique())
    kpis = [
        {"label": label, "valor": round(float(rollup.loc[ultimo, col]), 2)}
        for col, label in POZO_PRODUCTOS
    ]
    return {"periodo": ultimo, "num_pozos": num_pozos, "kpis": kpis}


# ── Analítica avanzada ──────────────────────────────────────────────────────

_ORDEN_SEVERIDAD = ["CRITICO", "DECLINANDO", "ESTABLE", "CRECIENDO"]  # peor -> mejor
_UMBRAL_MOMENTUM = 3.1453  # mismo umbral crítico trimestral (sourced) usado como "desviación significativa"


def _clasificar_declinacion(valor: float, u_critico: float, u_declinando: float, u_creciendo: float) -> str:
    if valor < u_critico: return "CRITICO"
    if valor < u_declinando: return "DECLINANDO"
    if valor <= u_creciendo: return "ESTABLE"
    return "CRECIENDO"


def _tendencia(suma_3m: float, anual: float | None = None) -> str:
    """Clasificación BASE = la tasa de declinación anual propia del pozo (12m
    vs 12m previos, Sección 4 — ventana estable) contra rangos de industria
    con fuente real: convencional general 5-10%/año, terminal percentil 20-80
    = 2.9-9.4%/año (Payne Institute), Mar del Norte 8-12%/año (IEA) →
    -12%/-5%/+5% anual.

    Luego se compara suma_3m (los últimos 3 meses) contra el EQUIVALENTE
    TRIMESTRAL de esa MISMA tasa anual propia — no contra un umbral genérico
    — usando interés compuesto: (1+anual/100)^0.25 - 1. Si el trimestre
    reciente se desvía de ese equivalente por más de ~3.1 puntos (el mismo
    umbral crítico sourced), se sube o baja un nivel de severidad respecto a
    la base: así una buena racha de 3 meses atenúa (pero no borra) una
    declinación estructural real, y viceversa.

    Sin `anual` (pozo con <24 meses de histórico), se usa solo suma_3m contra
    los umbrales trimestrales fijos (-3.1%/-1.3%/+1.2%, mismo origen)."""
    if anual is None:
        return _clasificar_declinacion(suma_3m, -3.1453, -1.2741, 1.2272)

    base = _clasificar_declinacion(anual, -12, -5, 5)
    equivalente_propio = ((1 + anual / 100) ** 0.25 - 1) * 100
    delta = suma_3m - equivalente_propio

    idx = _ORDEN_SEVERIDAD.index(base)
    if delta < -_UMBRAL_MOMENTUM and idx > 0:
        idx -= 1  # el trimestre reciente empeora respecto a su propia tendencia
    elif delta > _UMBRAL_MOMENTUM and idx < len(_ORDEN_SEVERIDAD) - 1:
        idx += 1  # el trimestre reciente mejora respecto a su propia tendencia
    return _ORDEN_SEVERIDAD[idx]


def _tasas_mensuales(valores: list[float]) -> list[float | None]:
    return [((valores[i] - valores[i-1]) / valores[i-1] * 100) if valores[i-1] else None for i in range(1, len(valores))]


def _tendencia_por_pozo(mensual: pd.DataFrame, group_cols: list[str], metric_col: str = "liquidos_mbd") -> pd.DataFrame:
    """mensual: filas well_id/well_name/[...group_cols]/fecha/<metric_col> —
    puede haber más de una fila por pozo-mes (se suma). Devuelve un registro
    por pozo con su producción del último mes y tendencia (la más severa entre
    la señal de 3 meses y la tasa anual real 12m-vs-12m, ver _tendencia).
    Vectorizado con pandas (groupby + shift/rolling) en vez de iterar pozo por
    pozo en Python — con miles de pozos a escala nacional, el for-loop
    original tardaba ~6.5s por sí solo. metric_col por defecto son líquidos,
    pero se puede pasar gas_mmpcd para cuencas de gas seco donde los líquidos
    son cero para todos los pozos (Burgos, p. ej.) y no sirven para rankear."""
    if mensual.empty:
        return pd.DataFrame(columns=group_cols + ["produccion_mbd", "tendencia", "tasa_3m"])

    g = mensual.groupby(group_cols + ["fecha"], as_index=False)[metric_col].sum()
    g = g.sort_values(group_cols + ["fecha"])
    prev = g.groupby(group_cols)[metric_col].shift(1)
    prev_safe = prev.replace(0, np.nan).astype("float64")
    g["_tasa"] = ((g[metric_col] - prev) / prev_safe * 100).astype("float64")
    g["_suma3"] = g.groupby(group_cols)["_tasa"].transform(lambda s: s.rolling(3, min_periods=1).sum())

    # Tasa anual real: promedio móvil de 12 meses, comparado contra el mismo
    # promedio de hace 12 meses (shift del propio rolling), igual que en
    # get_pozo_analisis — solo se obtiene donde hay >=24 meses de histórico.
    g["_roll12"] = g.groupby(group_cols)[metric_col].transform(lambda s: s.rolling(12, min_periods=12).mean())
    g["_roll12_prev"] = g.groupby(group_cols)["_roll12"].shift(12)
    g["_anual"] = ((g["_roll12"] - g["_roll12_prev"]) / g["_roll12_prev"].replace(0, np.nan) * 100).astype("float64")

    ultimo = g.groupby(group_cols, as_index=False).tail(1).copy()
    ultimo["tendencia"] = ultimo.apply(
        lambda r: _tendencia(r["_suma3"], r["_anual"] if pd.notna(r["_anual"]) else None) if pd.notna(r["_suma3"]) else "SIN_DATOS",
        axis=1,
    )
    ultimo = ultimo.rename(columns={metric_col: "produccion_mbd", "_suma3": "tasa_3m"})
    ultimo["produccion_mbd"] = ultimo["produccion_mbd"].round(2)
    ultimo["tasa_3m"] = ultimo["tasa_3m"].round(2)
    if "well_id" in ultimo.columns:
        ultimo["well_id"] = ultimo["well_id"].astype("Int64")
    return ultimo[group_cols + ["produccion_mbd", "tendencia", "tasa_3m"]].reset_index(drop=True)


def _serie_mensual_pozo(engine: Engine, campo: str, pozo: str, metrica: str = "auto") -> tuple[pd.DataFrame, int | None, str]:
    """Serie mensual completa (todo el histórico disponible) de un pozo —
    para el análisis de tendencia/declinación no importa qué rango tenga
    seleccionado el usuario en la UI, siempre se evalúa contra el histórico.
    Devuelve la serie con una columna genérica "valor". Con metrica="auto"
    (default) se usan líquidos (Mbd) salvo que el pozo no tenga líquidos en
    todo su histórico (pozos de gas seco, p. ej. en Burgos), en cuyo caso se
    usa gas (MMpcd) — junto con la unidad elegida, para que el análisis no
    salga vacío. metrica="liquidos"/"gas" fuerza una u otra (usado cuando el
    pozo produce ambos y el usuario eligió cuál ver en el frontend)."""
    sql = f"""
        SELECT FECHA, WELL_ID, PETROLEO_MBD, CONDENSADO_MBD, GAS_MMPCD
        FROM {_source_table()}
        WHERE ASIG_CONT = :campo AND WELL_NAME = :pozo
    """
    with engine.connect() as conn:
        df = pd.read_sql(sqlalchemy_text(sql), conn, params={"campo": campo, "pozo": pozo})
    if df.empty:
        return df, None, "Mbd"
    df.columns = df.columns.str.lower()
    well_id = int(df["well_id"].dropna().iloc[0]) if df["well_id"].notna().any() else None
    df["fecha"] = pd.to_datetime(df["fecha"])
    df["liquidos_mbd"] = df[["petroleo_mbd", "condensado_mbd"]].fillna(0).sum(axis=1)
    df["gas_mmpcd"] = df["gas_mmpcd"].fillna(0)

    if metrica == "gas":
        usa_gas = True
    elif metrica == "liquidos":
        usa_gas = False
    else:
        usa_gas = df["liquidos_mbd"].sum() == 0 and df["gas_mmpcd"].sum() > 0
    metric_col = "gas_mmpcd" if usa_gas else "liquidos_mbd"
    unidad = "MMpcd" if usa_gas else "Mbd"

    serie = df.groupby("fecha", as_index=False)[metric_col].sum().sort_values("fecha").reset_index(drop=True)
    serie = serie.rename(columns={metric_col: "valor"})
    return serie, well_id, unidad


def _meta_bd_pozos(engine: Engine, well_ids: list[int]) -> pd.DataFrame:
    """Metadata real por pozo (estado operativo, fecha de perforación,
    operador, etc.) desde cmde_raw.dbo.bd_pozos vía WELL_ID. Un WELL_ID puede
    tener más de una fila en bd_pozos (sidetracks/reentradas comparten
    WELL_ID, ej. Maloob-429D / Maloob-429DREE) — sin deduplicar, el merge
    aguas abajo multiplicaría cada pozo por cada fila que le corresponda."""
    if not well_ids:
        return pd.DataFrame()
    ids_sql = ",".join(str(int(w)) for w in well_ids)
    sql = f"""
        SELECT WELL_ID, CURRENT_CONDITION, DRILLING_START_DATE, OPERATOR, DEPTH_MD, CATEGORY
        FROM {BD_POZOS} WHERE WELL_ID IN ({ids_sql})
    """
    with engine.connect() as conn:
        meta = pd.read_sql(sql, conn)
    meta.columns = meta.columns.str.lower()
    meta = (
        meta.assign(_tiene_estado=meta["current_condition"].notna())
        .sort_values("_tiene_estado", ascending=False)
        .drop_duplicates(subset="well_id", keep="first")
        .drop(columns="_tiene_estado")
    )
    meta["anos_en_produccion"] = meta["drilling_start_date"].apply(
        lambda d: round((pd.Timestamp.now() - pd.Timestamp(d)).days / 365.25, 1) if pd.notna(d) else None
    )
    return meta.rename(columns={"current_condition": "estado_operativo", "drilling_start_date": "fecha_perforacion",
                                 "operator": "operador", "depth_md": "profundidad_md", "category": "categoria"})


def get_pozo_analisis(engine: Engine, campo: str, pozo: str, metrica: str = "auto") -> dict:
    """Declinación, tendencia, proyección de vida útil (estimado) y contexto
    real del pozo (estado operativo, fecha de perforación, operador) vía
    join a bd_pozos. Siempre evalúa el histórico completo del pozo, no el
    rango de fechas que tenga seleccionado la UI. `metrica` ("auto"/
    "liquidos"/"gas") permite forzar el análisis a la métrica que el usuario
    esté viendo en el frontend, para pozos que producen ambos."""
    serie, well_id, unidad = _serie_mensual_pozo(engine, campo, pozo, metrica)
    if serie.empty:
        return {"disponible": False}

    valores = serie["valor"].tolist()
    fechas = serie["fecha"].tolist()
    n = len(valores)
    actual = valores[-1]
    pico = max(valores)
    pico_idx = valores.index(pico)

    tasas = _tasas_mensuales(valores)
    ultimos_3 = [t for t in tasas[-3:] if t is not None]
    suma_3m = sum(ultimos_3) if ultimos_3 else None

    def _promedio(k):
        vals = valores[-k:]
        return round(sum(vals) / len(vals), 2) if vals else None

    anual = None
    if n >= 24:
        prom_actual = sum(valores[-12:]) / 12
        prom_previo = sum(valores[-24:-12]) / 12
        anual = round((prom_actual - prom_previo) / prom_previo * 100, 2) if prom_previo else None

    tendencia = _tendencia(suma_3m, anual) if suma_3m is not None else "SIN_DATOS"

    vida_remanente_meses = None
    if anual is not None and anual < 0 and actual > 0:
        k = abs(anual) / 100
        limite = actual * 0.1  # estimado: 10% de la producción actual
        if k > 0:
            import math
            t_anios = math.log(actual / limite) / k
            vida_remanente_meses = max(0, round(t_anios * 12))

    # La base de la clasificación es la tasa anual (cuando está disponible);
    # el mensaje cita esa cifra, ya que es la más estable y representativa.
    alerta = None
    if tendencia == "CRITICO":
        alerta = {"nivel": "CRITICA", "mensaje": (
            f"Declinación acelerada: {abs(anual):.1f}% en el último año." if anual is not None
            else f"Declinación acelerada: {abs(suma_3m):.1f}% en los últimos 3 meses."
        )}
    elif tendencia == "DECLINANDO":
        alerta = {"nivel": "MEDIA", "mensaje": (
            f"Declinación moderada: {abs(anual):.1f}% en el último año." if anual is not None
            else f"Declinación moderada: {abs(suma_3m):.1f}% en los últimos 3 meses."
        )}

    resultado = {
        "disponible": True,
        "unidad": unidad,
        "periodo_actual": fechas[-1].strftime("%Y-%m"),
        "produccion_actual_mbd": round(float(actual), 2),
        "pico_historico_mbd": round(float(pico), 2),
        "pico_historico_periodo": fechas[pico_idx].strftime("%Y-%m"),
        "pct_vs_pico": round(actual / pico * 100, 1) if pico else None,
        "tasa_declinacion_mensual": round(tasas[-1], 2) if tasas and tasas[-1] is not None else None,
        "tasa_declinacion_anual": anual,
        "tendencia": tendencia,
        "promedio_3m": _promedio(3), "promedio_6m": _promedio(6), "promedio_12m": _promedio(12),
        "vida_remanente_meses_estimado": vida_remanente_meses,
        "alerta": alerta,
        "estado_operativo": None, "fecha_perforacion": None, "anos_en_produccion": None,
        "operador": None, "profundidad_md": None, "categoria": None,
    }

    if well_id is not None:
        meta = _meta_bd_pozos(engine, [well_id])
        if not meta.empty:
            r = meta.iloc[0]
            resultado.update(
                estado_operativo=r["estado_operativo"],
                fecha_perforacion=r["fecha_perforacion"].isoformat() if pd.notna(r["fecha_perforacion"]) else None,
                anos_en_produccion=r["anos_en_produccion"],
                operador=r["operador"], profundidad_md=r["profundidad_md"], categoria=r["categoria"],
            )
    return resultado


def get_pozos_ranking(
    engine: Engine, cuenca: str, campo: str, start_year: int, end_year: int,
    start_month: int, end_month: int, period: str, years: str = "",
) -> dict:
    """Todos los pozos del nivel seleccionado (cuenca o campo): producción del
    último mes del rango + tendencia + estado operativo real, ordenados."""
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    where_extra, params = "", {}
    if cuenca:
        where_extra += " AND UPPER(CUENCA) = :cuenca"
        params["cuenca"] = cuenca.upper()
    if campo:
        where_extra += " AND ASIG_CONT = :campo"
        params["campo"] = campo
    sql = f"""
        SELECT FECHA, WELL_ID, WELL_NAME, PETROLEO_MBD, CONDENSADO_MBD, GAS_MMPCD
        FROM {_source_table()}
        WHERE {where_fecha}{where_extra}
    """
    with engine.connect() as conn:
        df = pd.read_sql(sqlalchemy_text(sql), conn, params=params)
    if df.empty:
        return {"periodo": None, "promedio_mbd": None, "num_pozos": 0, "pozos": [], "unidad": "Mbd"}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    df["liquidos_mbd"] = df[["petroleo_mbd", "condensado_mbd"]].fillna(0).sum(axis=1)
    df["gas_mmpcd"] = df["gas_mmpcd"].fillna(0)

    # Cuencas de gas seco (p. ej. Burgos) no producen líquidos — rankear por
    # Mbd ahí dejaría todos los pozos empatados en 0 y sin información útil.
    # Si el campo/cuenca seleccionado no tiene líquidos en el rango, se rankea
    # por gas (MMpcd) en su lugar.
    usa_gas = df["liquidos_mbd"].sum() == 0 and df["gas_mmpcd"].sum() > 0
    metric_col = "gas_mmpcd" if usa_gas else "liquidos_mbd"
    unidad = "MMpcd" if usa_gas else "Mbd"

    ranking = _tendencia_por_pozo(df, ["well_id", "well_name"], metric_col=metric_col)
    if ranking.empty:
        return {"periodo": None, "promedio_mbd": None, "num_pozos": 0, "pozos": [], "unidad": unidad}

    # La tendencia de arriba se calculó solo con el rango de la UI, lo que
    # puede contradecir get_pozo_analisis (que evalúa el histórico completo).
    # Se recalcula aquí con el histórico completo para que ambas coincidan;
    # el valor de producción del período seleccionado se conserva tal cual.
    # Solo vale la pena a nivel campo: a nivel cuenca (miles de pozos) la
    # consulta es tan pesada que el request se cuelga, así que ahí se deja
    # la tendencia period-scoped (aproximada, pero responde).
    well_ids_sql = ",".join(str(int(w)) for w in ranking["well_id"].dropna().tolist())
    if well_ids_sql and len(ranking) <= 300:
        sql_full = f"""
            SELECT FECHA, WELL_ID, WELL_NAME, PETROLEO_MBD, CONDENSADO_MBD, GAS_MMPCD
            FROM {_source_table()}
            WHERE WELL_ID IN ({well_ids_sql})
        """
        with engine.connect() as conn:
            df_full = pd.read_sql(sqlalchemy_text(sql_full), conn)
        df_full.columns = df_full.columns.str.lower()
        df_full["fecha"] = pd.to_datetime(df_full["fecha"])
        df_full["liquidos_mbd"] = df_full[["petroleo_mbd", "condensado_mbd"]].fillna(0).sum(axis=1)
        df_full["gas_mmpcd"] = df_full["gas_mmpcd"].fillna(0)
        tendencia_full = _tendencia_por_pozo(df_full, ["well_id", "well_name"], metric_col=metric_col)
        # Un mismo WELL_ID puede repetirse en varias filas de well_name
        # (sidetracks/reentradas) — mergear también por well_name evita que
        # ese cruce duplique filas del ranking.
        ranking = ranking.drop(columns=["tendencia"]).merge(
            tendencia_full[["well_id", "well_name", "tendencia"]], on=["well_id", "well_name"], how="left"
        )

    meta = _meta_bd_pozos(engine, [w for w in ranking["well_id"].tolist() if pd.notna(w)])
    if not meta.empty:
        ranking = ranking.merge(meta[["well_id", "estado_operativo"]], on="well_id", how="left")
    else:
        ranking["estado_operativo"] = None

    ranking = ranking.sort_values("produccion_mbd", ascending=False).reset_index(drop=True)
    ranking.insert(0, "ranking", ranking.index + 1)
    ranking = ranking.rename(columns={"well_name": "pozo"})

    ultimo = df["fecha"].max().strftime("%Y-%m") if period == "monthly" else str(df["fecha"].max().year)
    promedio = round(float(ranking["produccion_mbd"].mean()), 2) if not ranking.empty else None
    return {
        "periodo": ultimo, "promedio_mbd": promedio, "num_pozos": len(ranking), "unidad": unidad,
        "pozos": ranking[["ranking", "well_id", "pozo", "produccion_mbd", "tendencia", "estado_operativo"]].to_dict("records"),
    }


def get_pozos_comparar(engine: Engine, especificaciones: list[tuple[str, str]], start_year: int = 2019, end_year: int = 2023, start_month: int = 1, end_month: int = 12, period: str = "monthly", years: str = "") -> dict:
    """Series superpuestas + tabla comparativa de 2-4 pozos, filtradas por período."""
    where_fecha, _ = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    series, tabla = [], []
    for campo, pozo in especificaciones:
        serie, _ = _serie_mensual_pozo(engine, campo, pozo)
        if serie.empty:
            continue
        # Filtrar serie por período
        serie_filtrada = serie[(serie["fecha"].dt.year >= start_year) & (serie["fecha"].dt.year <= end_year)]
        if start_month > 1 or end_month < 12:
            serie_filtrada = serie_filtrada[
                ((serie_filtrada["fecha"].dt.year > start_year) | (serie_filtrada["fecha"].dt.month >= start_month)) &
                ((serie_filtrada["fecha"].dt.year < end_year) | (serie_filtrada["fecha"].dt.month <= end_month))
            ]
        analisis = get_pozo_analisis(engine, campo, pozo)
        series.append({
            "name": pozo,
            "categories": serie_filtrada["fecha"].dt.strftime("%Y-%m").tolist(),
            "data": [round(float(v), 2) for v in serie_filtrada["liquidos_mbd"]],
        })
        tabla.append({
            "pozo": pozo, "campo": campo,
            "produccion_actual_mbd": analisis.get("produccion_actual_mbd"),
            "tasa_declinacion_anual": analisis.get("tasa_declinacion_anual"),
            "tendencia": analisis.get("tendencia"),
            "pct_vs_pico": analisis.get("pct_vs_pico"),
            "estado_operativo": analisis.get("estado_operativo"),
            "anos_en_produccion": analisis.get("anos_en_produccion"),
        })

    all_cats = sorted({c for s in series for c in s["categories"]})
    aligned = []
    for s in series:
        idx = dict(zip(s["categories"], s["data"]))
        aligned.append({"name": s["name"], "data": [idx.get(c, 0) for c in all_cats]})
    return {"categories": all_cats, "series": aligned, "tabla": tabla}


def get_pozos_filtrados(
    engine: Engine, start_year: int, end_year: int, start_month: int, end_month: int, period: str,
    produccion_min: float | None = None, produccion_max: float | None = None,
    tendencias: str = "", estados: str = "", edad_min: float | None = None, edad_max: float | None = None,
    pagina: int = 1, tam_pagina: int = 50, years: str = "",
) -> dict:
    """Filtro nacional (ahora viable por el índice del caché local): rango de
    producción, tendencia, estado operativo real, edad del pozo."""
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    sql = f"""
        SELECT FECHA, WELL_ID, WELL_NAME, ASIG_CONT, CUENCA, PETROLEO_MBD, CONDENSADO_MBD
        FROM {_source_table()}
        WHERE {where_fecha}
    """
    with engine.connect() as conn:
        df = pd.read_sql(sqlalchemy_text(sql), conn)
    if df.empty:
        return {"total": 0, "pagina": pagina, "tam_pagina": tam_pagina, "pozos": []}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    df["liquidos_mbd"] = df[["petroleo_mbd", "condensado_mbd"]].fillna(0).sum(axis=1)

    resultado = _tendencia_por_pozo(df, ["well_id", "well_name", "asig_cont", "cuenca"])
    if resultado.empty:
        return {"total": 0, "pagina": pagina, "tam_pagina": tam_pagina, "pozos": []}
    resultado = resultado.rename(columns={"well_name": "pozo", "asig_cont": "campo"})

    meta = _meta_bd_pozos(engine, [w for w in resultado["well_id"].tolist() if pd.notna(w)])
    if not meta.empty:
        resultado = resultado.merge(meta[["well_id", "estado_operativo", "anos_en_produccion"]], on="well_id", how="left")
    else:
        resultado["estado_operativo"] = None
        resultado["anos_en_produccion"] = None

    if produccion_min is not None:
        resultado = resultado[resultado["produccion_mbd"] >= produccion_min]
    if produccion_max is not None:
        resultado = resultado[resultado["produccion_mbd"] <= produccion_max]
    if tendencias:
        lst = [t.strip() for t in tendencias.split("|") if t.strip()]
        if lst: resultado = resultado[resultado["tendencia"].isin(lst)]
    if estados:
        lst = [e.strip() for e in estados.split("|") if e.strip()]
        if lst: resultado = resultado[resultado["estado_operativo"].isin(lst)]
    if edad_min is not None:
        resultado = resultado[resultado["anos_en_produccion"] >= edad_min]
    if edad_max is not None:
        resultado = resultado[resultado["anos_en_produccion"] <= edad_max]

    resultado = resultado.sort_values("produccion_mbd", ascending=False)
    total = len(resultado)
    inicio = (pagina - 1) * tam_pagina
    pagina_df = resultado.iloc[inicio:inicio + tam_pagina]
    cols = ["well_id", "pozo", "campo", "cuenca", "produccion_mbd", "tendencia", "estado_operativo", "anos_en_produccion"]
    return {"total": total, "pagina": pagina, "tam_pagina": tam_pagina, "pozos": pagina_df[cols].to_dict("records")}


def pozos_a_csv(pozos: list[dict]) -> str:
    return pd.DataFrame(pozos).to_csv(index=False)
