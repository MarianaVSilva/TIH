import pandas as pd
from sqlalchemy.engine import Engine
from app.config import settings
from app.services.cache_utils import cached

SCHEMA = settings.db_schema + "."


@cached()
def get_temas(engine: Engine) -> list[dict]:
    sql = f"""
        SELECT SECCION, TEMA, JSON_ARG, INIT_YEAR, PERIODICIDAD,
               METODOLOGIA, TITULO, END_YEAR,
               IIF(DOWNLOADABLE IS NULL OR DOWNLOADABLE = '', NULL,
                   CONCAT(DOWNLOADABLE, '?_=', FORMAT(GETDATE(), 'yyyyMMddhhmmss'))
               ) AS DOWNLOADABLE
        FROM {SCHEMA}CUBOS
        WHERE JSON_ARG NOT IN ('', 'BalanceGas', 'InvAsig', 'InteresPart', 'EqPerf', 'InvTipo', 'InvEst', 'AreaLic')
          AND TEMA NOT IN ('Produccion por contrato (reportada al FMP)')
        ORDER BY SECCION, TEMA DESC
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)
    df.columns = df.columns.str.lower()
    df["seccion"] = df["seccion"].str.replace(r"^\d?\) ", "", regex=True).str.strip()
    df.sort_values(["seccion", "tema"], ascending=[True, False], inplace=True)
    return df.to_dict(orient="records")
