import pandas as pd
from sqlalchemy.engine import Engine
from app.config import settings
from app.services.cache_utils import cached

SCHEMA = settings.db_schema + "."
_PG = settings.db_engine == "postgres"
_TABLA_PRODUCCION_ESTADO = "api.v_produccion_estado" if _PG else f"{SCHEMA}PRODUCCION_ESTADO"
_YEAR_FECHA = "EXTRACT(YEAR FROM FECHA)" if _PG else "YEAR(FECHA)"
_ISNULL = "COALESCE" if _PG else "ISNULL"


def _where_fecha(start_year, start_month, end_year, end_month, period, years=""):
    years_list = [int(y.strip()) for y in years.split("|") if y.strip()] if years else []
    if years_list:
        años_sql = ", ".join(str(y) for y in years_list)
        return f"{_YEAR_FECHA} IN ({años_sql})", "annually"
    init = f"{start_year}-{start_month:02d}-01"
    end = f"{end_year}-{end_month:02d}-01"
    return f"FECHA BETWEEN '{init}' AND '{end}'", period


def _rollup_periodo(df, entity_cols, value_cols):
    """Ver produccion_service._rollup_periodo: Mbd/MMpcd son tasas diarias —
    se suman entidades dentro del mismo mes, se PROMEDIA entre meses cuando
    'periodo' abarca varios (vista anual), no se suma (bug: infla ~12x)."""
    mensual = df.groupby(["periodo", "fecha"] + entity_cols, as_index=False)[value_cols].sum()
    return mensual.groupby(["periodo"] + entity_cols, as_index=False)[value_cols].mean()


@cached()
def get_por_estado(engine: Engine, start_year: int, end_year: int, start_month: int = 1, end_month: int = 12, period: str = "monthly", years: str = "") -> dict:
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    sql = f"""
        SELECT NOM_ENT, FECHA, UBICACION,
               SUM({_ISNULL}(PETROLEO_MBD,0)+{_ISNULL}(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD,
               SUM(PETROLEO_MBD)  AS PETROLEO_MBD,
               SUM(CONDENSADO_MBD) AS CONDENSADO_MBD,
               SUM(GAS_MMPCD)     AS GAS_MMPCD
        FROM {_TABLA_PRODUCCION_ESTADO}
        WHERE {where_fecha}
        GROUP BY NOM_ENT, FECHA, UBICACION
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"series": [], "categories": []}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly"
        else df["fecha"].dt.strftime("%Y")
    )
    df[["liquidos_mbd", "petroleo_mbd", "condensado_mbd", "gas_mmpcd"]] = (
        df[["liquidos_mbd", "petroleo_mbd", "condensado_mbd", "gas_mmpcd"]].fillna(0)
    )

    grouped = _rollup_periodo(df, ["nom_ent"], ["liquidos_mbd"])
    categories = sorted(grouped["periodo"].unique().tolist())
    estados = sorted(grouped["nom_ent"].unique().tolist())
    pivot = grouped.pivot(index="nom_ent", columns="periodo", values="liquidos_mbd").reindex(columns=categories, fill_value=0)

    series = [
        {"name": estado, "data": [round(float(v), 2) for v in pivot.loc[estado]], "type": "bar"}
        for estado in estados
    ]
    return {"categories": categories, "series": series}
