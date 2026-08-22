from datetime import datetime

import pandas as pd
from sqlalchemy.engine import Engine
from app.config import settings
from app.services.cache_utils import cached

SCHEMA = settings.db_schema + "."

# Filtros de negocio (identicos en ambos motores, ver postgres_migration/sql/03_api_schema.sql
# api.v_temas -- esa vista solo aplica el filtro JSON_ARG NOT IN ('', 'BalanceGas', 'InvAsig');
# el resto de la lista y el filtro por TEMA se aplican aqui para no tener que
# alterar la vista cada vez que cambia una regla de presentacion del frontend).
_JSON_ARG_EXCLUIDOS = ("InteresPart", "EqPerf", "InvTipo", "InvEst", "AreaLic", "ReservasRelProd", "RecursosPros")
_TEMA_EXCLUIDOS = ("Produccion por contrato (reportada al FMP)",)


@cached()
def get_temas(engine: Engine) -> list[dict]:
    if settings.db_engine == "postgres":
        return _get_temas_postgres(engine)
    return _get_temas_mssql(engine)


def _get_temas_mssql(engine: Engine) -> list[dict]:
    sql = f"""
        SELECT SECCION, TEMA, JSON_ARG, INIT_YEAR, PERIODICIDAD,
               METODOLOGIA, TITULO, END_YEAR,
               IIF(DOWNLOADABLE IS NULL OR DOWNLOADABLE = '', NULL,
                   CONCAT(DOWNLOADABLE, '?_=', FORMAT(GETDATE(), 'yyyyMMddhhmmss'))
               ) AS DOWNLOADABLE
        FROM {SCHEMA}CUBOS
        WHERE JSON_ARG NOT IN ('', 'BalanceGas', 'InvAsig', 'InteresPart', 'EqPerf', 'InvTipo', 'InvEst', 'AreaLic', 'ReservasRelProd', 'RecursosPros')
          AND TEMA NOT IN ('Produccion por contrato (reportada al FMP)')
        ORDER BY SECCION, TEMA DESC
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)
    df.columns = df.columns.str.lower()
    return _postprocess(df)


def _get_temas_postgres(engine: Engine) -> list[dict]:
    # api.v_temas ya aplica JSON_ARG NOT IN ('', 'BalanceGas', 'InvAsig');
    # el resto de exclusiones se aplica aqui en Python (mas simple que un
    # WHERE IN con placeholders dinamicos via SQLAlchemy).
    sql = "SELECT seccion, tema, json_arg, init_year, periodicidad, metodologia, titulo, end_year, downloadable FROM api.v_temas"
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)
    df = df[~df["json_arg"].isin(_JSON_ARG_EXCLUIDOS)]
    df = df[~df["tema"].isin(_TEMA_EXCLUIDOS)]
    # El cache-buster (?_=timestamp) lo agregaba SQL Server con GETDATE() en
    # cada consulta -- se replica aqui para no cambiar el contrato del frontend.
    sufijo = "?_=" + datetime.now().strftime("%Y%m%d%H%M%S")
    df["downloadable"] = df["downloadable"].apply(lambda v: (v + sufijo) if v else None)
    return _postprocess(df)


def _postprocess(df: pd.DataFrame) -> list[dict]:
    df["seccion"] = df["seccion"].str.replace(r"^\d?\) ", "", regex=True).str.strip()
    df.sort_values(["seccion", "tema"], ascending=[True, False], inplace=True)
    return df.to_dict(orient="records")
