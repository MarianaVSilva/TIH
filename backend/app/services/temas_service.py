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


# ── Rango real de años con datos, por tema ──────────────────────────────────
# El selector de Periodo del encabezado ofrecía SIEMPRE 1960–hoy para
# cualquier tema, sin importar si esa tabla tiene datos ahí. Y CUBOS.INIT_YEAR/
# END_YEAR (usados en otras partes del frontend para la "sonda" inicial) no
# son de fiar: Reservas dice init_year=2001 pero RESERVAS_CAMPOS arranca en
# 2010 de verdad, e InvCuenca/InvCont dicen end_year=2048 (un placeholder, no
# el dato real — que además SÍ llega hasta 2054, porque el Programa Mínimo de
# Trabajo compromete inversión a futuro). Por eso esto consulta el MIN/MAX
# real de la tabla de origen de cada tema, no la metadata de CUBOS.
_PG = settings.db_engine == "postgres"
_FILTRO_ID_WHERE = "1=1" if _PG else "ID <> 1"

# json_arg -> (tabla, columna, filtro, es_columna_de_año)
# Los 4 temas de "corte vigente" (PozosLic/EfectivoLic/InvLic/EmpresasG) no
# están aquí a propósito: ni siquiera muestran el selector de Periodo.
_RANGO_FUENTES: dict[str, tuple[str, str, str, bool]] = {
    tema: (
        "api.v_produccion_campos" if _PG else f"{SCHEMA}PRODUCCION_CAMPOS",
        "fecha" if _PG else "FECHA", _FILTRO_ID_WHERE, False,
    )
    for tema in ("Cuenca", "Campos", "Asignaciones", "Contratos", "Operadores", "API", "Gcompo")
}
_RANGO_FUENTES["Estado"] = (
    "api.v_produccion_estado" if _PG else f"{SCHEMA}PRODUCCION_ESTADO", "fecha" if _PG else "FECHA", "1=1", False,
)
for _tema in ("ReservasP", "ReservasG", "ReservasPCE"):
    _RANGO_FUENTES[_tema] = (
        "api.v_reservas_campos" if _PG else f"{SCHEMA}RESERVAS_CAMPOS", "fecha" if _PG else "FECHA", "1=1", False,
    )
for _tema in ("ReservasAsigP", "ReservasAsigG", "ReservasAsigPCE"):
    _RANGO_FUENTES[_tema] = (
        "api.v_reservas_asig_cont" if _PG else "dbo.reservas_asig_cont", "fecha" if _PG else "FECHA", "1=1", False,
    )
_RANGO_FUENTES["Precios"] = (
    "api.v_precios" if _PG else f"{SCHEMA}PRECIOS", "fecha" if _PG else "FECHA", "1=1", False,
)
_RANGO_FUENTES["PozPerf"] = (
    "api.v_perforacion_pozos_perf" if _PG else f"{SCHEMA}PERFORACION_POZOS_PERF", "fecha" if _PG else "FECHA", "1=1", False,
)
_RANGO_FUENTES["PozTerm"] = (
    "api.v_perforacion_pozos_term" if _PG else f"{SCHEMA}PERFORACION_POZOS_TERM", "fecha" if _PG else "FECHA", "1=1", False,
)
# INVERSIONES_APROBADAS no tiene columna de fecha, es un entero (ANIO) —
# incluye años futuros comprometidos (PMT), que sí son un dato real a mostrar.
for _tema in ("InvCuenca", "InvCont"):
    _RANGO_FUENTES[_tema] = (
        "api.v_inversiones_aprobadas" if _PG else f"{SCHEMA}INVERSIONES_APROBADAS", "anio" if _PG else "ANIO", "1=1", True,
    )
# PozosCampos/Pozos leen de la produccion por pozo, cuya tabla de origen es
# dinamica (cache local si esta sincronizado, la vista original si no) — se
# resuelve en tiempo de consulta, no aqui.
_TEMAS_POZOS_DINAMICOS = ("PozosCampos", "Pozos")


def _rango_de_tabla(engine: Engine, tabla: str, columna: str, filtro: str, es_anio: bool) -> tuple[int | None, int | None]:
    try:
        with engine.connect() as conn:
            df = pd.read_sql(f"SELECT MIN({columna}) AS mn, MAX({columna}) AS mx FROM {tabla} WHERE {filtro}", conn)
    except Exception:
        # Una fuente que no responda no debe tumbar el selector: se degrada a
        # "sin rango conocido" y el frontend cae a su comportamiento anterior.
        return None, None
    if df.empty or pd.isna(df.iloc[0]["mn"]):
        return None, None
    mn, mx = df.iloc[0]["mn"], df.iloc[0]["mx"]
    if es_anio:
        return int(mn), int(mx)
    return pd.Timestamp(mn).year, pd.Timestamp(mx).year


@cached(ttl_seconds=3600)
def get_rango_anios(engine: Engine, topic: str) -> dict:
    """{min_year, max_year} con datos REALES para este tema, o ambos None si
    el tema no está mapeado (los 4 de corte vigente, o uno nuevo que aún no
    se agregue aquí) — el frontend cae a su rango genérico en ese caso."""
    if topic in _TEMAS_POZOS_DINAMICOS:
        from app.services.pozos_service import _source_table
        mn, mx = _rango_de_tabla(engine, _source_table(), "FECHA", "1=1", False)
        return {"min_year": mn, "max_year": mx}
    fuente = _RANGO_FUENTES.get(topic)
    if not fuente:
        return {"min_year": None, "max_year": None}
    mn, mx = _rango_de_tabla(engine, *fuente)
    return {"min_year": mn, "max_year": mx}
