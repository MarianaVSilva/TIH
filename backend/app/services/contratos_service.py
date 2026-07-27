import pandas as pd
from sqlalchemy.engine import Engine
from app.config import settings
from app.services.cache_utils import cached

SCHEMA = settings.db_schema + "."


def _date_range(start_year, start_month, end_year, end_month):
    return f"{start_year}-{start_month:02d}-01", f"{end_year}-{end_month:02d}-01"


def _where_fecha(start_year, start_month, end_year, end_month, period, years=""):
    years_list = [int(y.strip()) for y in years.split("|") if y.strip()] if years else []
    if years_list:
        años_sql = ", ".join(str(y) for y in years_list)
        return f"YEAR(FECHA) IN ({años_sql})", "annually"
    init, end = _date_range(start_year, start_month, end_year, end_month)
    return f"FECHA BETWEEN '{init}' AND '{end}'", period


def _periodo(df, period):
    df["fecha"] = pd.to_datetime(df["fecha"])
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly"
        else df["fecha"].dt.strftime("%Y")
    )
    return df


def _rollup_periodo(df, entity_cols, value_cols):
    """Ver produccion_service._rollup_periodo: Mbd/MMpcd son tasas diarias —
    se suman entidades dentro del mismo mes, se PROMEDIA entre meses cuando
    'periodo' abarca varios (vista anual), no se suma (bug: infla ~12x)."""
    mensual = df.groupby(["periodo", "fecha"] + entity_cols, as_index=False)[value_cols].sum()
    return mensual.groupby(["periodo"] + entity_cols, as_index=False)[value_cols].mean()


def _series_agrupadas(df, group_col, value_col, anios_o_meses):
    grupos = sorted(df[group_col].unique().tolist())
    pivot = df.pivot(index=group_col, columns="periodo", values=value_col).reindex(columns=anios_o_meses, fill_value=0)
    return [
        {"name": g, "data": [round(float(v), 2) for v in pivot.loc[g]], "type": "bar"}
        for g in grupos
    ]


# ---------------------------------------------------------------------------
# Contratos / Asignaciones por cuenca
# ---------------------------------------------------------------------------
TIPOS_VALIDOS = {"CONTRATO", "ASIGNACION"}


@cached()
def get_contratos(engine: Engine, start_year, end_year, start_month, end_month, period, tipo="CONTRATO", years=""):
    if tipo not in TIPOS_VALIDOS:
        tipo = "CONTRATO"
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    sql = f"""
        SELECT
            DIAS_PRODUCCION, FECHA, ASIG_CONT, TIPO, OPERADOR,
            SUM(ISNULL(PETROLEO_MBD,0)+ISNULL(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD,
            SUM(PETROLEO_MBD)    AS PETROLEO_MBD,
            SUM(CONDENSADO_MBD)  AS CONDENSADO_MBD,
            SUM(GAS_MMPCD)       AS GAS_MMPCD,
            SUM(GAS_ASOC_MMPCD)  AS GAS_ASOC_MMPCD,
            SUM(GAS_NASOC_MMPCD) AS GAS_NASOC_MMPCD,
            SUM(N2_MMPCD)        AS N2_MMPCD,
            SUM(AGUA_MBD)        AS AGUA_MBD
        FROM {SCHEMA}PRODUCCION_CAMPOS
        WHERE ID <> 1
          AND {where_fecha}
          AND TIPO = '{tipo}'
        GROUP BY DIAS_PRODUCCION, FECHA, ASIG_CONT, TIPO, OPERADOR
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"series": [], "categories": [], "tipo": tipo}

    df.columns = df.columns.str.lower()
    df = _periodo(df, period)

    numeric = ["liquidos_mbd", "petroleo_mbd", "condensado_mbd",
               "gas_mmpcd", "gas_asoc_mmpcd", "gas_nasoc_mmpcd", "n2_mmpcd", "agua_mbd"]
    df[numeric] = df[numeric].fillna(0)

    # Clasifica asig_cont para contratos
    if tipo == "CONTRATO":
        df.loc[df["asig_cont"].str.startswith("CNH-M", na=False), "grupo"] = "Migraciones"
        df.loc[df["asig_cont"].str.startswith("CNH-A", na=False), "grupo"] = "Asociaciones"
        df.loc[df["asig_cont"].str.startswith("CNH-R", na=False), "grupo"] = "Rondas"
        df["grupo"] = df.get("grupo", df["asig_cont"]).fillna(df["asig_cont"])
    else:
        df["grupo"] = df["asig_cont"]

    grouped = _rollup_periodo(df, ["grupo"], ["liquidos_mbd"])
    categories = sorted(grouped["periodo"].unique().tolist())

    return {
        "categories": categories,
        "series": _series_agrupadas(grouped, "grupo", "liquidos_mbd", categories),
        "tipo": tipo,
    }


# ---------------------------------------------------------------------------
# Operadores (FACTOR_O)
# ---------------------------------------------------------------------------
@cached()
def get_operadores(engine: Engine, start_year, end_year, start_month, end_month, period):
    init, end = _date_range(start_year, start_month, end_year, end_month)
    sql = f"""
        SELECT
            DIAS_PRODUCCION, FECHA,
            CASE WHEN SUBSTRING(ASIG_CONT,1,2) IN ('A-','AE','AR') THEN 'Asignaciones'
                 ELSE ASIG_CONT END AS ASIG_CONT,
            EMPRESA AS OPERADOR,
            CASE WHEN SUBSTRING(ASIG_CONT,1,2) = 'A-' THEN 'ASIGNACION'
                 ELSE 'Contratos' END AS TIPO,
            SUM(ISNULL(PETROLEO_MBD,0)*FACTOR_O+ISNULL(CONDENSADO_MBD,0)*FACTOR_O) AS LIQUIDOS_MBD,
            SUM(PETROLEO_MBD*FACTOR_O)    AS PETROLEO_MBD,
            SUM(GAS_MMPCD*FACTOR_O)       AS GAS_MMPCD,
            SUM(AGUA_MBD*FACTOR_O)        AS AGUA_MBD
        FROM {SCHEMA}PRODUCCION_OPERADOR_IP
        WHERE FECHA BETWEEN '{init}' AND '{end}'
        GROUP BY DIAS_PRODUCCION, FECHA, ASIG_CONT, EMPRESA
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"series": [], "categories": []}

    df.columns = df.columns.str.lower()
    df = _periodo(df, period)
    df[["liquidos_mbd", "petroleo_mbd", "gas_mmpcd", "agua_mbd"]] = (
        df[["liquidos_mbd", "petroleo_mbd", "gas_mmpcd", "agua_mbd"]].fillna(0)
    )

    grouped = _rollup_periodo(df, ["operador"], ["liquidos_mbd"])
    categories = sorted(grouped["periodo"].unique().tolist())

    # top 10 operadores por volumen total para no saturar la gráfica
    top = (
        grouped.groupby("operador")["liquidos_mbd"].sum()
        .nlargest(10).index.tolist()
    )
    grouped = grouped[grouped["operador"].isin(top)]

    return {
        "categories": categories,
        "series": _series_agrupadas(grouped, "operador", "liquidos_mbd", categories),
    }
