import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Engine
from app.config import settings
from app.services.cache_utils import cached

SCHEMA = settings.db_schema + "."

# JSON_ARG heredado de CUBOS para los temas "Reservas por campo de X":
# selecciona el hidrocarburo, no la categoría (esa siempre es PROBADAS = 1P,
# no hay selector de categoría en el explorador).
TIPO_COLUMNA = {
    "ReservasP":   "rr_aceite_mmb",
    "ReservasG":   "rr_gas_mmmpc",
    "ReservasPCE": "rr_pce_mmbpce",
}


@cached()
def get_reservas_por_campo(engine: Engine, start_year: int, end_year: int, tipo: str = "ReservasP") -> dict:
    columna = TIPO_COLUMNA.get(tipo)
    if not columna:
        # Temas aún no soportados (asignación-contrato, recursos prospectivos, etc.):
        # vacío honesto en vez de caer por defecto en datos de "por campo de petróleo".
        return {"categories": [], "series": []}
    sql = text(f"""
        SELECT YEAR(fecha) AS anio, cuenca, SUM({columna}) AS valor
        FROM {SCHEMA}RESERVAS_CAMPOS
        WHERE YEAR(fecha) BETWEEN :start_year AND :end_year AND categoria = 'PROBADAS'
        GROUP BY YEAR(fecha), cuenca
        ORDER BY YEAR(fecha), cuenca
    """)
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn, params={"start_year": start_year, "end_year": end_year})

    if df.empty:
        return {"categories": [], "series": []}

    df.columns = df.columns.str.lower()
    anios = sorted(df["anio"].unique().tolist())
    cuencas = sorted(df["cuenca"].unique().tolist())

    pivot = df.groupby(["cuenca", "anio"])["valor"].sum().unstack(fill_value=0).reindex(columns=anios, fill_value=0)
    series = [
        {"name": cuenca, "data": [round(float(v), 2) for v in pivot.loc[cuenca]], "type": "bar"}
        for cuenca in cuencas
    ]
    return {"categories": [str(a) for a in anios], "series": series}


@cached()
def get_reservas(engine: Engine, start_year: int, end_year: int, tipo: str = "1P") -> dict:
    sql = text(f"""
        SELECT
            YEAR(fecha)            AS anio,
            cuenca,
            ubicacion,
            categoria,
            SUM(rr_aceite_mmb)          AS aceite_mmb,
            SUM(rr_gas_mmmpc)           AS gas_mmmpc,
            SUM(rr_condensado_mmb)      AS condensado_mmb,
            SUM(rr_liquidos_planta_mmb) AS liquidos_planta_mmb,
            SUM(vo_aceite_mmb)          AS vo_aceite_mmb,
            SUM(vo_gas_mmmpc)           AS vo_gas_mmmpc
        FROM {SCHEMA}RESERVAS_CAMPOS
        WHERE YEAR(fecha) BETWEEN :start_year AND :end_year
          AND categoria = :tipo
        GROUP BY YEAR(fecha), cuenca, ubicacion, categoria
        ORDER BY YEAR(fecha), cuenca
    """)
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn, params={"start_year": start_year, "end_year": end_year, "tipo": tipo})

    if df.empty:
        return {"series_aceite": [], "series_gas": [], "categories": [], "tipo": tipo}

    df.columns = df.columns.str.lower()
    numeric = ["aceite_mmb", "gas_mmmpc", "condensado_mmb", "liquidos_planta_mmb"]
    df[numeric] = df[numeric].fillna(0)

    anios = sorted(df["anio"].unique().tolist())
    cuencas = sorted(df["cuenca"].unique().tolist())

    grouped = df.groupby(["cuenca", "anio"])[["aceite_mmb", "gas_mmmpc"]].sum()
    pivot_aceite = grouped["aceite_mmb"].unstack(fill_value=0).reindex(columns=anios, fill_value=0)
    pivot_gas = grouped["gas_mmmpc"].unstack(fill_value=0).reindex(columns=anios, fill_value=0)

    series_aceite = [
        {"name": cuenca, "data": [round(float(v), 2) for v in pivot_aceite.loc[cuenca]], "type": "bar"}
        for cuenca in cuencas
    ]
    series_gas = [
        {"name": cuenca, "data": [round(float(v), 2) for v in pivot_gas.loc[cuenca]], "type": "bar"}
        for cuenca in cuencas
    ]

    return {
        "categories": [str(a) for a in anios],
        "series_aceite": series_aceite,
        "series_gas": series_gas,
        "tipo": tipo,
    }


@cached()
def get_categorias_disponibles(engine: Engine) -> list[str]:
    sql = f"SELECT DISTINCT categoria FROM {SCHEMA}RESERVAS_CAMPOS WHERE categoria IS NOT NULL ORDER BY categoria"
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)
    return df["categoria"].tolist()


@cached()
def _ultima_fecha(engine: Engine) -> str | None:
    sql = text(f"SELECT MAX(fecha) AS fecha FROM {SCHEMA}RESERVAS_CAMPOS")
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)
    if df.empty or pd.isna(df.loc[0, "fecha"]):
        return None
    return str(df.loc[0, "fecha"])[:10]


def _top_n(df: pd.DataFrame, columna: str, n: int) -> list[dict]:
    top = df[["campo_nombre", columna]].sort_values(columna, ascending=False).head(n)
    return [{"nombre": r.campo_nombre, "valor": round(float(getattr(r, columna)), 0)} for r in top.itertuples()]


@cached()
def get_top5_reservas_por_campo(engine: Engine, n: int = 5) -> dict:
    """Top N campos por reservas acumuladas 1P/2P/3P, al dato más reciente —
    para el mini-tablero 'Top 5: Reservas por campo' del Panorama general.
    1P = Probada, 2P = Probada+Probable, 3P = Probada+Probable+Posible."""
    fecha = _ultima_fecha(engine)
    if not fecha:
        return {}

    sql = text(f"""
        SELECT campo_nombre, categoria, SUM(rr_aceite_mmb) AS aceite_mmb, SUM(rr_gas_mmmpc) AS gas_mmmpc
        FROM {SCHEMA}RESERVAS_CAMPOS
        WHERE fecha = :fecha AND campo_nombre IS NOT NULL
        GROUP BY campo_nombre, categoria
    """)
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn, params={"fecha": fecha})
    if df.empty:
        return {}

    df.columns = df.columns.str.lower()
    pivot_aceite = df.pivot_table(index="campo_nombre", columns="categoria", values="aceite_mmb", aggfunc="sum", fill_value=0)
    pivot_gas = df.pivot_table(index="campo_nombre", columns="categoria", values="gas_mmmpc", aggfunc="sum", fill_value=0)
    for cat in ["PROBADAS", "PROBABLES", "POSIBLES"]:
        if cat not in pivot_aceite.columns:
            pivot_aceite[cat] = 0
        if cat not in pivot_gas.columns:
            pivot_gas[cat] = 0

    acumulados = {}
    for nivel, cats in [("1P", ["PROBADAS"]), ("2P", ["PROBADAS", "PROBABLES"]), ("3P", ["PROBADAS", "PROBABLES", "POSIBLES"])]:
        acum_aceite = pivot_aceite[cats].sum(axis=1).reset_index(name="aceite_mmb")
        acum_gas = pivot_gas[cats].sum(axis=1).reset_index(name="gas_mmmpc")
        acumulados[nivel] = {
            "aceite": _top_n(acum_aceite, "aceite_mmb", n),
            "gas": _top_n(acum_gas, "gas_mmmpc", n),
        }

    return {"fecha": fecha, **acumulados}


@cached()
def get_reservas_1p2p3p(engine: Engine) -> dict:
    """Reservas nacionales acumuladas 1P/2P/3P (Probada / +Probable / +Posible),
    al dato más reciente — para la gráfica de cascada del Panorama general."""
    fecha = _ultima_fecha(engine)
    if not fecha:
        return {}

    sql = text(f"""
        SELECT categoria, SUM(rr_aceite_mmb) AS aceite_mmb, SUM(rr_gas_mmmpc) AS gas_mmmpc
        FROM {SCHEMA}RESERVAS_CAMPOS
        WHERE fecha = :fecha
        GROUP BY categoria
    """)
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn, params={"fecha": fecha})
    if df.empty:
        return {}

    df.columns = df.columns.str.lower()
    totales = df.set_index("categoria")[["aceite_mmb", "gas_mmmpc"]].to_dict("index")
    probada = totales.get("PROBADAS", {"aceite_mmb": 0, "gas_mmmpc": 0})
    probable = totales.get("PROBABLES", {"aceite_mmb": 0, "gas_mmmpc": 0})
    posible = totales.get("POSIBLES", {"aceite_mmb": 0, "gas_mmmpc": 0})

    def _bloque(campo):
        p = round(float(probada.get(campo) or 0), 0)
        pb = round(float(probable.get(campo) or 0), 0)
        ps = round(float(posible.get(campo) or 0), 0)
        return {
            "probada": p, "probable": pb, "posible": ps,
            "un_p": p, "dos_p": p + pb, "tres_p": p + pb + ps,
        }

    return {"fecha": fecha, "aceite": _bloque("aceite_mmb"), "gas": _bloque("gas_mmmpc")}
