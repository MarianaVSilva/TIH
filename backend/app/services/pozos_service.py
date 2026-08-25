import numpy as np
import pandas as pd
from sqlalchemy import text as sqlalchemy_text
from sqlalchemy.engine import Engine
from app.config import settings
from app.services.cache_utils import cached
from app.services.produccion_service import _where_fecha, _rollup_periodo
from app.services import pozos_cache

BD_POZOS = "cmde_raw.dbo.bd_pozos"
_PG = settings.db_engine == "postgres"


def _source_table() -> str:
    """Tabla/vista de la que se lee la producción por pozo: el caché local
    materializado e indexado (TIH_pozos_cache) si ya se sincronizó, o la vista
    original (más lenta, pero siempre disponible) si no. En Postgres no aplica
    el caché SQL-Server-especifico (particiones + BRIN ya resuelven el
    rendimiento) -- se usa api.v_produccion_pozos siempre."""
    if _PG:
        return "api.v_produccion_pozos"
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
    fecha_corte = "(CURRENT_DATE - INTERVAL '2 years')" if _PG else "DATEADD(year, -2, GETDATE())"
    sql = f"""
        SELECT DISTINCT CUENCA, ASIG_CONT, WELL_NAME
        FROM {_source_table()}
        WHERE CUENCA IS NOT NULL AND ASIG_CONT IS NOT NULL AND WELL_NAME IS NOT NULL
          AND FECHA >= {fecha_corte}
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
        {"label": label, "data": [round(float(v), 3) for v in df[col]]}
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
        {"label": label, "valor": round(float(rollup.loc[ultimo, col]), 3)}
        for col, label in POZO_PRODUCTOS
    ]
    return {"periodo": ultimo, "num_pozos": num_pozos, "kpis": kpis}


# ── Analítica avanzada ──────────────────────────────────────────────────────

# Umbrales FIJOS y uniformes para todos los pozos (pedido explícito del
# usuario: antes cada pozo se comparaba contra su propia tasa anual —
# ej. ÁRABE-10 terminaba con un umbral distinto al de otros pozos — lo que
# hacía que "Crítico"/"Declinando"/etc. no significara lo mismo de un pozo a
# otro). Se aplican directo sobre suma_6m (suma de tasas mensuales de los
# últimos 6 meses):
#   Crítico:    < -10%
#   Declinando: -10% a -1%
#   Estable:    -1% a +3%
#   Creciendo:  > +3%
_UMBRAL_CRITICO_6M = -10.0
_UMBRAL_DECLINANDO_6M = -1.0
_UMBRAL_CRECIENDO_6M = 3.0


def _clasificar_declinacion(valor: float, u_critico: float, u_declinando: float, u_creciendo: float) -> str:
    if valor < u_critico: return "CRITICO"
    if valor < u_declinando: return "DECLINANDO"
    if valor <= u_creciendo: return "ESTABLE"
    return "CRECIENDO"


def _tendencia(suma_6m: float) -> str:
    """Clasificación por umbrales fijos (mismos para todos los pozos, ver
    arriba) sobre suma_6m — la suma de tasas mensuales de los últimos 6
    meses. La tasa anual (12m vs 12m previos) sigue calculándose y
    mostrándose como dato informativo y para la proyección de vida
    remanente, pero ya NO afecta esta clasificación."""
    return _clasificar_declinacion(suma_6m, _UMBRAL_CRITICO_6M, _UMBRAL_DECLINANDO_6M, _UMBRAL_CRECIENDO_6M)


def _cutoff_6m_calendario() -> "pd.Timestamp":
    """Primer día del mes de hace 6 meses calendario (respecto a HOY, no al
    último dato del pozo) — usado para detectar pozos "Sin producción"."""
    return pd.Timestamp.now().normalize().replace(day=1) - pd.DateOffset(months=6)


def _tasas_mensuales(valores: list[float]) -> list[float | None]:
    return [((valores[i] - valores[i-1]) / valores[i-1] * 100) if valores[i-1] else None for i in range(1, len(valores))]


def _tendencia_por_pozo(mensual: pd.DataFrame, group_cols: list[str], metric_col: str = "liquidos_mbd") -> pd.DataFrame:
    """mensual: filas well_id/well_name/[...group_cols]/fecha/<metric_col> —
    puede haber más de una fila por pozo-mes (se suma). Devuelve un registro
    por pozo con su producción del último mes y tendencia (la más severa entre
    la señal de 6 meses y la tasa anual real 12m-vs-12m, ver _tendencia).
    Vectorizado con pandas (groupby + shift/rolling) en vez de iterar pozo por
    pozo en Python — con miles de pozos a escala nacional, el for-loop
    original tardaba ~6.5s por sí solo. metric_col por defecto son líquidos,
    pero se puede pasar gas_mmpcd para cuencas de gas seco donde los líquidos
    son cero para todos los pozos (Burgos, p. ej.) y no sirven para rankear."""
    if mensual.empty:
        return pd.DataFrame(columns=group_cols + ["produccion_mbd", "tendencia", "tasa_6m"])

    g = mensual.groupby(group_cols + ["fecha"], as_index=False)[metric_col].sum()
    g = g.sort_values(group_cols + ["fecha"])
    prev = g.groupby(group_cols)[metric_col].shift(1)
    prev_safe = prev.replace(0, np.nan).astype("float64")
    g["_tasa"] = ((g[metric_col] - prev) / prev_safe * 100).astype("float64")
    g["_suma6"] = g.groupby(group_cols)["_tasa"].transform(lambda s: s.rolling(6, min_periods=1).sum())

    ultimo = g.groupby(group_cols, as_index=False).tail(1).copy()
    ultimo["tendencia"] = ultimo["_suma6"].apply(lambda v: _tendencia(v) if pd.notna(v) else "SIN_DATOS")

    # "Sin producción": pozo sin producción (>0) en ninguno de los últimos 6
    # meses CALENDARIO (respecto a hoy, no al último dato disponible del pozo)
    # — pedido explícito, distinto de SIN_DATOS (que es falta de histórico
    # suficiente para calcular una tasa). Nota: `mensual` puede venir acotado
    # al rango de años de la UI (igual que el resto de esta función); si ese
    # rango no llega hasta el mes actual, esta detección es aproximada — el
    # mismo trade-off ya documentado para la tendencia period-scoped.
    cutoff = _cutoff_6m_calendario()
    prod_reciente = g[g["fecha"] >= cutoff].groupby(group_cols)[metric_col].sum()
    ultimo = ultimo.set_index(group_cols)
    ultimo["_prod_reciente"] = prod_reciente.reindex(ultimo.index).fillna(0)
    ultimo = ultimo.reset_index()
    ultimo.loc[ultimo["_prod_reciente"] <= 0, "tendencia"] = "SIN_PRODUCCION"

    ultimo = ultimo.rename(columns={metric_col: "produccion_mbd", "_suma6": "tasa_6m"})
    ultimo["produccion_mbd"] = ultimo["produccion_mbd"].round(3)
    ultimo["tasa_6m"] = ultimo["tasa_6m"].round(3)
    if "well_id" in ultimo.columns:
        ultimo["well_id"] = ultimo["well_id"].astype("Int64")
    return ultimo[group_cols + ["produccion_mbd", "tendencia", "tasa_6m"]].reset_index(drop=True)


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
    # api.v_pozos_meta ya viene de core.dim_pozo (una fila por well_id, la mas
    # reciente por update_date -- ver postgres_migration/sql/04_transform_staging_to_core.sql)
    # a diferencia de cmde_raw.dbo.bd_pozos que puede tener varias filas por
    # WELL_ID (sidetracks/reentradas); se alian las columnas a los mismos
    # nombres que espera el resto de esta funcion (CURRENT_CONDITION/OPERATOR/
    # CATEGORY) para no duplicar la logica de renombrado de abajo.
    if _PG:
        sql = f"""
            SELECT well_id AS "WELL_ID", current_condition AS "CURRENT_CONDITION",
                   drilling_start_date AS "DRILLING_START_DATE", operador AS "OPERATOR",
                   depth_md AS "DEPTH_MD", categoria AS "CATEGORY"
            FROM api.v_pozos_meta WHERE well_id IN ({ids_sql})
        """
    else:
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
    ultimos_6 = [t for t in tasas[-6:] if t is not None]
    suma_6m = sum(ultimos_6) if ultimos_6 else None

    def _promedio(k):
        vals = valores[-k:]
        return round(sum(vals) / len(vals), 3) if vals else None

    anual = None
    if n >= 24:
        prom_actual = sum(valores[-12:]) / 12
        prom_previo = sum(valores[-24:-12]) / 12
        anual = round((prom_actual - prom_previo) / prom_previo * 100, 3) if prom_previo else None

    tendencia = _tendencia(suma_6m) if suma_6m is not None else "SIN_DATOS"

    # "Sin producción": nada (>0) en los últimos 6 meses CALENDARIO respecto a
    # hoy — distinto de SIN_DATOS (histórico insuficiente). Pisa la
    # clasificación por tasa: un pozo cerrado no tiene una "tendencia"
    # significativa, solo el hecho de que dejó de producir.
    cutoff = _cutoff_6m_calendario()
    sin_produccion = sum(v for f, v in zip(fechas, valores) if f >= cutoff) <= 0
    if sin_produccion:
        tendencia = "SIN_PRODUCCION"

    vida_remanente_meses = None
    if anual is not None and anual < 0 and actual > 0:
        k = abs(anual) / 100
        limite = actual * 0.1  # estimado: 10% de la producción actual
        if k > 0:
            import math
            t_anios = math.log(actual / limite) / k
            vida_remanente_meses = max(0, round(t_anios * 12))

    # La clasificación se basa en suma_6m (ver _tendencia) -- el mensaje cita
    # esa misma cifra para ser consistente con lo que realmente se evaluó.
    alerta = None
    if tendencia == "CRITICO":
        alerta = {"nivel": "CRITICA", "mensaje": f"Declinación acelerada: {abs(suma_6m):.1f}% en los últimos 6 meses."}
    elif tendencia == "DECLINANDO":
        alerta = {"nivel": "MEDIA", "mensaje": f"Declinación moderada: {abs(suma_6m):.1f}% en los últimos 6 meses."}

    resultado = {
        "disponible": True,
        "unidad": unidad,
        "periodo_actual": fechas[-1].strftime("%Y-%m"),
        "produccion_actual_mbd": round(float(actual), 3),
        "pico_historico_mbd": round(float(pico), 3),
        "pico_historico_periodo": fechas[pico_idx].strftime("%Y-%m"),
        "pct_vs_pico": round(actual / pico * 100, 1) if pico else None,
        "tasa_declinacion_mensual": round(tasas[-1], 3) if tasas and tasas[-1] is not None else None,
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


def get_pozo_tendencia_desglose(engine: Engine, campo: str, pozo: str, metrica: str = "auto") -> dict:
    """Desglose paso a paso de cómo se calculó la Tendencia (y la Vida
    Remanente si aplica) de un pozo — mismos números y fórmulas que
    get_pozo_analisis/_tendencia, pero exponiendo los pasos intermedios
    (tasas mensuales, promedios 12m, equivalente semestral, delta, ajuste)
    para explicarlo en un modal, no solo el resultado final."""
    serie, well_id, unidad = _serie_mensual_pozo(engine, campo, pozo, metrica)
    if serie.empty:
        return {"disponible": False}

    fechas = serie["fecha"].tolist()
    valores = serie["valor"].tolist()
    n = len(valores)

    es_gas = unidad == "MMpcd"
    producto = "Gas (MMpcd)" if es_gas else "Hidrocarburos líquidos (Mbd)"

    ultimos_13 = [
        {"fecha": f.strftime("%Y-%m"), "valor": round(float(v), 4)}
        for f, v in zip(fechas[-13:], valores[-13:])
    ]

    tasas = _tasas_mensuales(valores)
    ultimos_6_idx = list(range(max(0, len(tasas) - 6), len(tasas)))
    pasos_6m = [
        {
            "fecha": fechas[i + 1].strftime("%Y-%m"),
            "valor_anterior": round(float(valores[i]), 4),
            "valor_actual": round(float(valores[i + 1]), 4),
            "tasa": round(tasas[i], 3) if tasas[i] is not None else None,
        }
        for i in ultimos_6_idx
    ]
    validas_6m = [p["tasa"] for p in pasos_6m if p["tasa"] is not None]
    suma_6m = round(sum(validas_6m), 3) if validas_6m else None

    # Tasa anual (12m vs 12m previos): ya NO clasifica la tendencia (ver
    # _tendencia) -- se muestra como dato informativo y sigue siendo la base
    # de la proyección de vida remanente.
    anual = None
    prom_actual_12m = prom_previo_12m = None
    if n >= 24:
        prom_actual_12m = round(sum(valores[-12:]) / 12, 4)
        prom_previo_12m = round(sum(valores[-24:-12]) / 12, 4)
        anual = round((prom_actual_12m - prom_previo_12m) / prom_previo_12m * 100, 3) if prom_previo_12m else None

    cutoff = _cutoff_6m_calendario()
    sin_produccion = sum(v for f, v in zip(fechas, valores) if f >= cutoff) <= 0
    tendencia_final = "SIN_PRODUCCION" if sin_produccion else (_tendencia(suma_6m) if suma_6m is not None else "SIN_DATOS")

    actual = valores[-1]
    vida = None
    if anual is not None and anual < 0 and actual > 0:
        k = abs(anual) / 100
        limite = round(actual * 0.1, 6)
        if k > 0:
            import math
            t_anios = math.log(actual / limite) / k
            vida = {
                "k": round(k, 5), "limite": limite,
                "t_anios": round(t_anios, 3),
                "meses": max(0, round(t_anios * 12)),
            }

    return {
        "disponible": True,
        "campo": campo, "pozo": pozo, "unidad": unidad, "producto": producto, "es_gas_seco": es_gas,
        "n_meses": n,
        "rango": f"{fechas[0].strftime('%Y-%m')} a {fechas[-1].strftime('%Y-%m')}",
        "ultimos_13": ultimos_13,
        "pasos_6m": pasos_6m, "suma_6m": suma_6m,
        "umbral_critico": _UMBRAL_CRITICO_6M, "umbral_declinando": _UMBRAL_DECLINANDO_6M, "umbral_creciendo": _UMBRAL_CRECIENDO_6M,
        "sin_produccion": sin_produccion,
        "tendencia_final": tendencia_final,
        "prom_actual_12m": prom_actual_12m, "prom_previo_12m": prom_previo_12m, "anual": anual,
        "produccion_actual": round(float(actual), 4),
        "vida_remanente": vida,
    }


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
        SELECT FECHA, WELL_ID, WELL_NAME, ASIG_CONT, PETROLEO_MBD, CONDENSADO_MBD, GAS_MMPCD
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

    # La producción mostrada debe coincidir con la que ve el usuario al entrar
    # al detalle del pozo: en vista anual esa columna es el PROMEDIO de los
    # meses del año (_rollup_periodo, igual que el resto del tablero), no el
    # último mes crudo — antes el ranking tomaba directo la última fila
    # mensual, lo que no coincidía con la cifra del detalle (p. ej. 6.89 en
    # el ranking vs 6.85 en el detalle para el mismo pozo/año).
    df["periodo"] = df["fecha"].dt.strftime("%Y-%m") if period == "monthly" else df["fecha"].dt.strftime("%Y")
    # dropna=False: un pozo sin WELL_ID (groupby excluye NaN por default) se
    # quedaba sin match en el merge de abajo -> produccion_mbd salía null y
    # tronaba toda la tarjeta (el resto de las columnas sí toleran null).
    por_periodo = df.groupby(["well_id", "well_name", "periodo"], as_index=False, dropna=False)[metric_col].mean()
    ultimo_periodo = por_periodo["periodo"].max()
    prod_ultimo_periodo = (
        por_periodo[por_periodo["periodo"] == ultimo_periodo]
        [["well_id", "well_name", metric_col]]
        .rename(columns={metric_col: "produccion_mbd"})
    )
    ranking = ranking.drop(columns=["produccion_mbd"]).merge(
        prod_ultimo_periodo, on=["well_id", "well_name"], how="left"
    )
    # Salvaguarda: si por lo que sea algún pozo sigue sin match, 0 en vez de
    # null — un valor raro en pantalla es mejor que tumbar todo el ranking.
    ranking["produccion_mbd"] = ranking["produccion_mbd"].fillna(0).round(3)

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

    # Campo (ASIG_CONT) de cada pozo — necesario para poder seleccionar un
    # pozo desde un ranking a nivel CUENCA (varios campos mezclados) y que el
    # detalle sepa a qué campo pedirle la serie; antes el frontend asumía el
    # campo ya elegido en el árbol, así que un pozo de otro campo dentro de
    # la misma cuenca salía como "sin producción registrada".
    campo_por_pozo = df.drop_duplicates(subset=["well_id", "well_name"])[["well_id", "well_name", "asig_cont"]]
    ranking = ranking.merge(campo_por_pozo, on=["well_id", "well_name"], how="left")
    ranking = ranking.rename(columns={"asig_cont": "campo"})

    ranking = ranking.sort_values("produccion_mbd", ascending=False).reset_index(drop=True)
    ranking.insert(0, "ranking", ranking.index + 1)
    ranking = ranking.rename(columns={"well_name": "pozo"})

    ultimo = df["fecha"].max().strftime("%Y-%m") if period == "monthly" else str(df["fecha"].max().year)
    promedio = round(float(ranking["produccion_mbd"].mean()), 3) if not ranking.empty else None
    return {
        "periodo": ultimo, "promedio_mbd": promedio, "num_pozos": len(ranking), "unidad": unidad,
        "pozos": ranking[["ranking", "well_id", "pozo", "campo", "produccion_mbd", "tendencia", "estado_operativo"]].to_dict("records"),
    }


def get_pozos_comparar(engine: Engine, especificaciones: list[tuple[str, str]], start_year: int = 2019, end_year: int = 2023, start_month: int = 1, end_month: int = 12, period: str = "monthly", years: str = "") -> dict:
    """Series superpuestas + tabla comparativa de 2-4 pozos, filtradas por período."""
    _, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    series, tabla = [], []
    for campo, pozo in especificaciones:
        serie, _, unidad = _serie_mensual_pozo(engine, campo, pozo)
        if serie.empty:
            continue
        serie_filtrada = serie[(serie["fecha"].dt.year >= start_year) & (serie["fecha"].dt.year <= end_year)]
        if start_month > 1 or end_month < 12:
            serie_filtrada = serie_filtrada[
                ((serie_filtrada["fecha"].dt.year > start_year) | (serie_filtrada["fecha"].dt.month >= start_month)) &
                ((serie_filtrada["fecha"].dt.year < end_year) | (serie_filtrada["fecha"].dt.month <= end_month))
            ]
        # Mbd/MMpcd son tasas diarias: en vista anual se promedian los meses
        # del año (no se suman), igual que el resto del tablero (_rollup_periodo).
        serie_filtrada = serie_filtrada.copy()
        serie_filtrada["periodo"] = (
            serie_filtrada["fecha"].dt.strftime("%Y-%m") if period == "monthly"
            else serie_filtrada["fecha"].dt.strftime("%Y")
        )
        rollup = serie_filtrada.groupby("periodo", as_index=False)["valor"].mean().sort_values("periodo")
        analisis = get_pozo_analisis(engine, campo, pozo)
        series.append({
            "name": pozo,
            "unidad": unidad,
            "categories": rollup["periodo"].tolist(),
            "data": [round(float(v), 3) for v in rollup["valor"]],
        })
        tabla.append({
            "pozo": pozo, "campo": campo,
            "unidad": analisis.get("unidad"),
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
