import pandas as pd
from sqlalchemy.engine import Engine
from app.config import settings
from app.services.cache_utils import cached

SCHEMA = settings.db_schema + "."


@cached()
def get_inversiones(engine: Engine, start_year: int, end_year: int, subtopic: str = "estado") -> dict:
    if subtopic == "contrato":
        sql = f"""
            SELECT ANIO, RONDA, LICITACION, CONTRATO, ACT_PETROLERA, MONTO_USD
            FROM {SCHEMA}INVERSIONES_APROBADAS
            WHERE RONDA IS NOT NULL AND ANIO BETWEEN {start_year} AND {end_year}
        """
        group_col = "contrato"
    elif subtopic == "asignacion":
        sql = f"""
            SELECT ANIO, TIPO_PLAN, LICITACION, CONTRATO, ACT_PETROLERA, MONTO_USD
            FROM {SCHEMA}INVERSIONES_APROBADAS
            WHERE RONDA IS NULL AND ANIO BETWEEN {start_year} AND {end_year}
        """
        group_col = "act_petrolera"
    else:
        sql = f"""
            SELECT ANIO, ACT_PETROLERA, TAREA, ESTADO, UBICACION, MONTO_USD
            FROM {SCHEMA}INVERSIONES_APROBADAS
            WHERE ANIO BETWEEN {start_year} AND {end_year}
        """
        group_col = "act_petrolera"

    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"series": [], "categories": []}

    df.columns = df.columns.str.lower()
    df["monto_usd"] = pd.to_numeric(df["monto_usd"], errors="coerce").fillna(0)

    anios = sorted(df["anio"].unique().tolist())
    grupos = sorted(df[group_col].dropna().unique().tolist())

    grupos = grupos[:15]  # límite para no saturar
    pivot = (
        df[df[group_col].isin(grupos)].groupby([group_col, "anio"])["monto_usd"].sum()
        .unstack(fill_value=0).reindex(columns=anios, fill_value=0)
    )
    series = [
        {"name": str(g), "data": [round(float(v), 2) for v in pivot.loc[g]], "type": "bar"}
        for g in grupos
    ]

    return {"categories": [str(a) for a in anios], "series": series}
