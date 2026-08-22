import pandas as pd
from sqlalchemy.engine import Engine
from app.config import settings
from app.services.cache_utils import cached

SCHEMA = settings.db_schema + "."
_PG = settings.db_engine == "postgres"
_YEAR_FECHA = "EXTRACT(YEAR FROM FECHA)" if _PG else "YEAR(FECHA)"
_ISNULL = "COALESCE" if _PG else "ISNULL"
# SUBSTRING(x,1,2) es sintaxis SQL Server; en Postgres es SUBSTRING(x FROM 1 FOR 2)
_SUBSTR2 = (lambda col: f"SUBSTRING({col} FROM 1 FOR 2)") if _PG else (lambda col: f"SUBSTRING({col},1,2)")
_TABLA_PRODUCCION_CAMPOS = "api.v_produccion_campos" if _PG else f"{SCHEMA}PRODUCCION_CAMPOS"
_TABLA_PRODUCCION_OPERADOR_IP = "api.v_produccion_operador_ip" if _PG else f"{SCHEMA}PRODUCCION_OPERADOR_IP"
# api.v_produccion_operador_ip ya expone la columna como "operador" (no "empresa" como en dbo.PRODUCCION_OPERADOR_IP)
_COL_EMPRESA = "operador" if _PG else "EMPRESA"
_TABLA_POZOS_COMPROMETIDOS = "api.v_pozos_comprometidos" if _PG else "rdmx.T_21_PozosComprometidos"
_TABLA_INVERSIONES = "api.v_inversiones_aprobadas" if _PG else f"{SCHEMA}INVERSIONES_APROBADAS"
_TABLA_LICITACIONES_OFERTAS = "api.v_licitaciones_ofertas" if _PG else "licitaciones_bloques_ofertas"
# ID<>1 (fila de totales/placeholder) ya se descarto al cargar core.fact_produccion_campo
# -- ver postgres_migration/00_PLAN.md regla #6 -- no hace falta filtrarlo de nuevo.
_FILTRO_ID = "" if _PG else "AND ID <> 1"


def _date_range(start_year, start_month, end_year, end_month):
    return f"{start_year}-{start_month:02d}-01", f"{end_year}-{end_month:02d}-01"


def _where_fecha(start_year, start_month, end_year, end_month, period, years=""):
    years_list = [int(y.strip()) for y in years.split("|") if y.strip()] if years else []
    if years_list:
        años_sql = ", ".join(str(y) for y in years_list)
        return f"{_YEAR_FECHA} IN ({años_sql})", "annually"
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
            SUM({_ISNULL}(PETROLEO_MBD,0)+{_ISNULL}(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD,
            SUM(PETROLEO_MBD)    AS PETROLEO_MBD,
            SUM(CONDENSADO_MBD)  AS CONDENSADO_MBD,
            SUM(GAS_MMPCD)       AS GAS_MMPCD,
            SUM(GAS_ASOC_MMPCD)  AS GAS_ASOC_MMPCD,
            SUM(GAS_NASOC_MMPCD) AS GAS_NASOC_MMPCD,
            SUM(N2_MMPCD)        AS N2_MMPCD,
            SUM(AGUA_MBD)        AS AGUA_MBD
        FROM {_TABLA_PRODUCCION_CAMPOS}
        WHERE 1=1 {_FILTRO_ID}
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
            CASE WHEN {_SUBSTR2("ASIG_CONT")} IN ('A-','AE','AR') THEN 'Asignaciones'
                 ELSE ASIG_CONT END AS ASIG_CONT,
            {_COL_EMPRESA} AS OPERADOR,
            CASE WHEN {_SUBSTR2("ASIG_CONT")} = 'A-' THEN 'ASIGNACION'
                 ELSE 'Contratos' END AS TIPO,
            SUM({_ISNULL}(PETROLEO_MBD,0)*FACTOR_O+{_ISNULL}(CONDENSADO_MBD,0)*FACTOR_O) AS LIQUIDOS_MBD,
            SUM(PETROLEO_MBD*FACTOR_O)    AS PETROLEO_MBD,
            SUM(GAS_MMPCD*FACTOR_O)       AS GAS_MMPCD,
            SUM(AGUA_MBD*FACTOR_O)        AS AGUA_MBD
        FROM {_TABLA_PRODUCCION_OPERADOR_IP}
        WHERE FECHA BETWEEN '{init}' AND '{end}'
        GROUP BY DIAS_PRODUCCION, FECHA, ASIG_CONT, {_COL_EMPRESA}
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


# ---------------------------------------------------------------------------
# Pozos comprometidos (Licitaciones y Contratos)
# ---------------------------------------------------------------------------
AMBIENTES_ORDEN = ["Aguas profundas", "Aguas someras", "Terrestre"]


def _label_grupo_pozos(ronda: str, licitacion: str) -> str:
    if ronda == "Asociaciones":
        return "Asociaciones Pemex"
    if ronda == "Migraciones":
        return "Migraciones Pemex"
    # "R01"/"L03" -> "Ronda 1 Licitación 3"
    return f"Ronda {ronda[1:].lstrip('0') or '0'} Licitación {licitacion[1:].lstrip('0') or '0'}"


@cached()
def get_pozos_comprometidos(engine: Engine) -> dict:
    # T_21_PozosComprometidos (schema rdmx) es un corte vigente, no una serie
    # temporal, con un renglón por contrato — sin MODALIDAD/UBICACION propias,
    # se toman de INVERSIONES_APROBADAS (mismo CONTRATO) para poder armar la
    # jerarquía Modalidad → Ronda/Licitación → Contrato con desglose por
    # Ambiente que pide el tema.
    pozos_planes_col = "pozos_planes" if _PG else "pozosPlanes"
    sql = f"""
        SELECT p.contrato, p.ronda, p.licitacion, p.{pozos_planes_col} AS pozosPlanes,
               i.MODALIDAD, i.UBICACION
        FROM {_TABLA_POZOS_COMPROMETIDOS} p
        LEFT JOIN (SELECT DISTINCT CONTRATO, MODALIDAD, UBICACION FROM {_TABLA_INVERSIONES}) i
          ON i.CONTRATO = p.contrato
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

    df.columns = df.columns.str.lower()
    df["pozosplanes"] = pd.to_numeric(df["pozosplanes"], errors="coerce").fillna(0)
    df["modalidad"] = df["modalidad"].fillna("Sin clasificar")
    df["ubicacion"] = df["ubicacion"].fillna("Sin clasificar")
    df["grupo"] = df.apply(lambda r: _label_grupo_pozos(r["ronda"], r["licitacion"]), axis=1)

    categories = AMBIENTES_ORDEN + sorted(set(df["ubicacion"]) - set(AMBIENTES_ORDEN))

    def serie_por_ambiente(sub: pd.DataFrame) -> list:
        por_amb = sub.groupby("ubicacion")["pozosplanes"].sum()
        return [round(float(por_amb.get(a, 0)), 2) for a in categories]

    total_general_rows = [
        {"type": "operator", "label": "Todos los operadores", "data": serie_por_ambiente(df)},
        *[{"type": "operator", "label": amb, "data": serie_por_ambiente(sub)} for amb, sub in df.groupby("ubicacion")],
    ]
    groups = [
        {"cuenca": "Total general", "data": serie_por_ambiente(df), "subgroups": [{"ubicacion": "Nacional", "rows": total_general_rows}]},
    ]

    for modalidad, sub_mod in df.groupby("modalidad"):
        if modalidad == "Sin clasificar":
            continue
        rows = []
        for grupo, sub_grupo in sub_mod.groupby("grupo"):
            rows.append({"type": "subtotal", "label": grupo, "data": serie_por_ambiente(sub_grupo)})
            for _, fila in sub_grupo.sort_values("contrato").iterrows():
                rows.append({"type": "operator", "label": fila["contrato"], "data": serie_por_ambiente(sub_grupo[sub_grupo["contrato"] == fila["contrato"]])})
        groups.append({"cuenca": modalidad, "data": serie_por_ambiente(sub_mod), "subgroups": [{"ubicacion": "Nacional", "rows": rows}]})

    return {"type": "hierarchical", "categories": categories, "groups": groups}


# ---------------------------------------------------------------------------
# Ofertas de pago en efectivo (Licitaciones y Contratos)
# ---------------------------------------------------------------------------
def _label_grupo_oferta(ronda: str, licitacion: str) -> str:
    if ronda == "PEMEX":
        return "Asociaciones Pemex"
    return f"Ronda {ronda} Licitación {licitacion}"


@cached()
def get_ofertas_efectivo(engine: Engine) -> dict:
    # licitaciones_bloques_ofertas trae una fila por CADA oferta presentada
    # (ganadoras y no ganadoras) — id_licitante = id_licitante_adj filtra a
    # las ganadoras; un contrato con consorcio gana varias filas (una por
    # socio, cada una con su parte del bono), se suman. "contrato" es en
    # realidad la Modalidad (Licencia/Producción compartida) y
    # "contrato_nombre" el identificador real del contrato — mismo patrón que
    # Pozos comprometidos.
    sql = f"""
        SELECT ronda, licitacion, contrato AS modalidad, contrato_nombre AS contrato,
               ubicacion, bono
        FROM {_TABLA_LICITACIONES_OFERTAS}
        WHERE bono IS NOT NULL AND contrato_nombre IS NOT NULL AND id_licitante = id_licitante_adj
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

    df.columns = df.columns.str.lower()
    df["bono"] = pd.to_numeric(df["bono"], errors="coerce").fillna(0)
    df["modalidad"] = df["modalidad"].fillna("Sin clasificar")
    df["ubicacion"] = df["ubicacion"].str.capitalize().fillna("Sin clasificar")
    df["grupo"] = df.apply(lambda r: _label_grupo_oferta(r["ronda"], r["licitacion"]), axis=1)

    categories = AMBIENTES_ORDEN + sorted(set(df["ubicacion"]) - set(AMBIENTES_ORDEN))

    def serie_por_ambiente(sub: pd.DataFrame) -> list:
        por_amb = sub.groupby("ubicacion")["bono"].sum()
        return [round(float(por_amb.get(a, 0)), 2) for a in categories]

    total_general_rows = [
        {"type": "operator", "label": "Todos los operadores", "data": serie_por_ambiente(df)},
        *[{"type": "operator", "label": amb, "data": serie_por_ambiente(sub)} for amb, sub in df.groupby("ubicacion")],
    ]
    groups = [
        {"cuenca": "Total general", "data": serie_por_ambiente(df), "subgroups": [{"ubicacion": "Nacional", "rows": total_general_rows}]},
    ]

    for modalidad, sub_mod in df.groupby("modalidad"):
        rows = []
        for grupo, sub_grupo in sub_mod.groupby("grupo"):
            rows.append({"type": "subtotal", "label": grupo, "data": serie_por_ambiente(sub_grupo)})
            for contrato, sub_contrato in sub_grupo.groupby("contrato"):
                rows.append({"type": "operator", "label": contrato, "data": serie_por_ambiente(sub_contrato)})
        groups.append({"cuenca": modalidad, "data": serie_por_ambiente(sub_mod), "subgroups": [{"ubicacion": "Nacional", "rows": rows}]})

    return {"type": "hierarchical", "categories": categories, "groups": groups}


# ---------------------------------------------------------------------------
# Inversión comprometida (Licitaciones y Contratos)
# ---------------------------------------------------------------------------
def _label_ronda_simple(ronda: str) -> str:
    return "Asociaciones Pemex" if ronda == "PEMEX" else f"Ronda {ronda}"


@cached()
def get_inversion_comprometida(engine: Engine) -> dict:
    # inv_usd (PMT comprometido) viene REPETIDO en licitaciones_bloques_ofertas
    # — un valor por contrato, no por socio del consorcio (a diferencia de
    # "bono", que sí se reparte) — de ahí el groupby...first() en vez de sum().
    # Cifras en millones de USD (mismo criterio que el sitio de origen).
    sql = f"""
        SELECT ronda, licitacion, contrato AS modalidad, contrato_nombre AS contrato,
               ubicacion, inv_usd
        FROM {_TABLA_LICITACIONES_OFERTAS}
        WHERE inv_usd IS NOT NULL AND contrato_nombre IS NOT NULL AND id_licitante = id_licitante_adj
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

    df.columns = df.columns.str.lower()
    df = df.groupby(["ronda", "licitacion", "modalidad", "contrato", "ubicacion"], as_index=False)["inv_usd"].first()
    df["inv_mm"] = pd.to_numeric(df["inv_usd"], errors="coerce").fillna(0) / 1_000_000
    df["modalidad"] = df["modalidad"].fillna("Sin clasificar")
    df["ubicacion"] = df["ubicacion"].str.capitalize().fillna("Sin clasificar")
    df["grupo"] = df.apply(lambda r: _label_grupo_oferta(r["ronda"], r["licitacion"]), axis=1)
    df["grupo_simple"] = df["ronda"].map(_label_ronda_simple)

    categories = AMBIENTES_ORDEN + sorted(set(df["ubicacion"]) - set(AMBIENTES_ORDEN))

    def serie_por_ambiente(sub: pd.DataFrame) -> list:
        por_amb = sub.groupby("ubicacion")["inv_mm"].sum()
        return [round(float(por_amb.get(a, 0)), 2) for a in categories]

    # Total general: desglose simple por Asociaciones Pemex / Ronda 1 / 2 / 3
    # (sin combinar licitación) — el detalle por Ronda-Licitación va dentro de
    # cada Modalidad.
    total_general_rows = [
        {"type": "operator", "label": "Todos los operadores", "data": serie_por_ambiente(df)},
        *[
            {"type": "operator", "label": grupo, "data": serie_por_ambiente(sub)}
            for grupo, sub in df.groupby("grupo_simple")
        ],
    ]
    groups = [
        {"cuenca": "Total general", "data": serie_por_ambiente(df), "subgroups": [{"ubicacion": "Nacional", "rows": total_general_rows}]},
    ]

    for modalidad, sub_mod in df.groupby("modalidad"):
        rows = []
        for grupo, sub_grupo in sub_mod.groupby("grupo"):
            rows.append({"type": "subtotal", "label": grupo, "data": serie_por_ambiente(sub_grupo)})
            for contrato, sub_contrato in sub_grupo.groupby("contrato"):
                rows.append({"type": "operator", "label": contrato, "data": serie_por_ambiente(sub_contrato)})
        groups.append({"cuenca": modalidad, "data": serie_por_ambiente(sub_mod), "subgroups": [{"ubicacion": "Nacional", "rows": rows}]})

    return {"type": "hierarchical", "categories": categories, "groups": groups}


# ---------------------------------------------------------------------------
# Contratos adjudicados (Licitaciones y Contratos) — País de origen → Empresa,
# columnas = bloque/licitación (conteo de contratos).
# ---------------------------------------------------------------------------
def _col_contrato(ronda: str, licitacion: str, contrato: str) -> str:
    if ronda == "PEMEX":
        if "TRION" in contrato: return "Trion"
        if "OGARRIO" in contrato: return "Ogarrio"
        if "MORA" in contrato: return "C. Mora"
        return contrato
    return f"R0{ronda}-L0{licitacion}"



@cached()
def get_contratos_adjudicados(engine: Engine) -> dict:
    sql = f"""
        SELECT ronda, licitacion, contrato_nombre, pais, empresa
        FROM {_TABLA_LICITACIONES_OFERTAS}
        WHERE contrato_nombre IS NOT NULL AND id_licitante = id_licitante_adj
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)
    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

    df.columns = df.columns.str.lower()
    df["pais"] = df["pais"].fillna("Sin clasificar")
    df["empresa"] = df["empresa"].fillna("Sin clasificar")
    df["columna"] = df.apply(lambda r: _col_contrato(r["ronda"], r["licitacion"], r["contrato_nombre"]), axis=1)

    categories = sorted(df["columna"].unique())

    def serie(sub: pd.DataFrame) -> list:
        conteo = sub.groupby("columna")["contrato_nombre"].nunique()
        return [int(conteo.get(c, 0)) for c in categories]

    # El país se mantiene como grupo real (habilita el filtro por país en
    # Filtros/TopBar y la búsqueda de texto por país) pero el front ya no lo
    # muestra como encabezado — las empresas van sueltas y ordenadas
    # alfabéticamente, con la bandera del país (ícono, no emoji — Windows no
    # renderiza casi ninguna bandera de emoji Unicode) al frente del nombre.
    groups = []
    for pais, sub_pais in sorted(df.groupby("pais")):
        rows = [
            {"type": "operator", "label": empresa, "pais": pais, "data": serie(sub_emp)}
            for empresa, sub_emp in sorted(sub_pais.groupby("empresa"))
        ]
        groups.append({"cuenca": pais, "data": serie(sub_pais), "subgroups": [{"ubicacion": "Nacional", "rows": rows}]})

    return {"type": "hierarchical", "categories": categories, "groups": groups}
