import pandas as pd
from sqlalchemy import text as sqlalchemy_text
from sqlalchemy.engine import Engine
from app.config import settings
from app.services.cache_utils import cached
from app.services import contratos_service, estado_service

SCHEMA = settings.db_schema + "."


def _date_range(start_year: int, start_month: int, end_year: int, end_month: int):
    return f"{start_year}-{start_month:02d}-01", f"{end_year}-{end_month:02d}-01"


def _where_fecha(start_year: int, start_month: int, end_year: int, end_month: int, period: str, years: str = ""):
    """Cláusula WHERE de fecha: rango continuo por defecto, o años específicos
    no necesariamente consecutivos cuando se pide comparar años (p. ej. "2018|2025").
    Devuelve (where_clause, period_efectivo) — comparar años fuerza anual."""
    years_list = [int(y.strip()) for y in years.split("|") if y.strip()] if years else []
    if years_list:
        años_sql = ", ".join(str(y) for y in years_list)
        return f"YEAR(FECHA) IN ({años_sql})", "annually"
    init, end = _date_range(start_year, start_month, end_year, end_month)
    return f"FECHA BETWEEN '{init}' AND '{end}'", period


def _rollup_periodo(df, entity_cols, value_cols):
    """Colapsa filas mensuales en 'periodo'. Mbd/MMpcd son TASAS diarias, no
    volúmenes acumulados: sumar los 12 meses de un año infla el resultado ~12x.
    Se suma solo entre entidades del MISMO mes (campos/contratos/operadores en
    paralelo sí se suman), y se PROMEDIA entre meses cuando 'periodo' abarca
    más de uno (vista anual); en vista mensual el promedio es un no-op."""
    mensual = df.groupby(["periodo", "fecha"] + entity_cols, as_index=False)[value_cols].sum()
    return mensual.groupby(["periodo"] + entity_cols, as_index=False)[value_cols].mean()


# Jerarquía Cuenca → Producto (subtotal) → Ubicación (hoja), replicando el SIH
# original: dentro de cada cuenca se listan los 8 productos, y cada producto se
# desglosa por ambiente (Aguas someras / Terrestre / etc.).
PRODUCTOS = [
    ("liquidos_mbd",    "Hidrocarburos líquidos (Mbd)"),
    ("petroleo_mbd",    "Petróleo (Mbd)"),
    ("condensado_mbd",  "Condensado (Mbd)"),
    ("gas_mmpcd",       "Gas (MMpcd)"),
    ("gas_asoc_mmpcd",  "Gas asociado (MMpcd)"),
    ("gas_nasoc_mmpcd", "Gas no asociado (MMpcd)"),
    ("n2_mmpcd",        "Nitrógeno (MMpcd)"),
    ("agua_mbd",        "Agua (Mbd)"),
]
NUMERIC_COLS_CUENCA = [c for c, _ in PRODUCTOS]


@cached()
def get_produccion_filtros(engine: Engine) -> dict:
    sql = f"SELECT DISTINCT CUENCA, UBICACION FROM {SCHEMA}PRODUCCION_CAMPOS"
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)
    df.columns = df.columns.str.lower()
    return {
        "cuencas": sorted(df["cuenca"].dropna().unique().tolist()),
        # "NACIONAL" no es un ambiente real, es un artefacto de la fuente — se
        # excluye de las opciones de filtro (los datos que traiga se siguen
        # incluyendo en los agregados, solo no se ofrece como filtro).
        "ubicaciones": sorted(u for u in df["ubicacion"].dropna().unique().tolist() if u.upper() != "NACIONAL"),
        "productos": [label for _, label in PRODUCTOS],
    }


def _filas_agregadas_por_producto(sub_df, productos_activos, categories):
    """Vista sin ambiente fijo: cada producto (subtotal) desglosado por sus
    ambientes reales (hojas) — usada en la fila 'Nacional' de cada cuenca."""
    rows = []
    for col, label in productos_activos:
        rows.append(_make_row(label, "subtotal", categories, sub_df.groupby("periodo")[col].sum()))
        pivot = sub_df.groupby(["ubicacion", "periodo"])[col].sum().unstack(fill_value=0)
        for ubic in sorted(pivot.index):
            rows.append(_make_row(ubic, "operator", categories, pivot.loc[ubic]))
    return rows


def _filas_detalle_por_producto(sub_df, productos_activos, categories):
    """Vista ya acotada a una cuenca+ambiente real: el producto es la hoja
    directa, sin repetir el ambiente (que ya es el contexto)."""
    rows = [_make_row("Producción", "subtotal", categories, sub_df.groupby("periodo")["liquidos_mbd"].sum())]
    for col, label in productos_activos:
        rows.append(_make_row(label, "operator", categories, sub_df.groupby("periodo")[col].sum()))
    return rows


@cached()
def get_produccion_cuenca(
    engine: Engine,
    start_year: int,
    end_year: int,
    start_month: int,
    end_month: int,
    period: str,
    cuencas: str = "",
    ubicaciones: str = "",
    productos: str = "",
    years: str = "",
) -> dict:
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)

    sql = f"""
        SELECT CUENCA, UBICACION, FECHA, DIAS_PRODUCCION,
               SUM(ISNULL(PETROLEO_MBD,0)+ISNULL(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD,
               SUM(PETROLEO_MBD)      AS PETROLEO_MBD,
               SUM(CONDENSADO_MBD)    AS CONDENSADO_MBD,
               SUM(GAS_MMPCD)         AS GAS_MMPCD,
               SUM(GAS_ASOC_MMPCD)    AS GAS_ASOC_MMPCD,
               SUM(GAS_NASOC_MMPCD)   AS GAS_NASOC_MMPCD,
               SUM(AGUA_MBD)          AS AGUA_MBD,
               SUM(N2_MMPCD)          AS N2_MMPCD
        FROM {SCHEMA}PRODUCCION_CAMPOS
        WHERE ID <> 1
          AND {where_fecha}
        GROUP BY CUENCA, UBICACION, FECHA, DIAS_PRODUCCION
    """

    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    df[NUMERIC_COLS_CUENCA] = df[NUMERIC_COLS_CUENCA].fillna(0)
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly"
        else df["fecha"].dt.strftime("%Y")
    )

    def _parse(s):
        return [x.strip() for x in s.split("|") if x.strip()]

    if cuencas:
        lst = _parse(cuencas)
        if lst: df = df[df["cuenca"].isin(lst)]
    if ubicaciones:
        lst = _parse(ubicaciones)
        if lst: df = df[df["ubicacion"].isin(lst)]
    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

    productos_activos = PRODUCTOS
    if productos:
        lst = _parse(productos)
        if lst: productos_activos = [p for p in PRODUCTOS if p[1] in lst]

    df = _rollup_periodo(df, ["cuenca", "ubicacion"], NUMERIC_COLS_CUENCA)
    categories = sorted(df["periodo"].unique().tolist())

    subgrupo_nacional = [{"ubicacion": "Nacional", "rows": _filas_agregadas_por_producto(df, productos_activos, categories)}]
    groups = [{"cuenca": "Nacional", "subgroups": subgrupo_nacional}]

    for cuenca in sorted(df["cuenca"].dropna().unique().tolist()):
        sub_c = df[df["cuenca"] == cuenca]
        c_subgroups = [
            {"ubicacion": ubic, "rows": _filas_detalle_por_producto(sub_c[sub_c["ubicacion"] == ubic], productos_activos, categories)}
            for ubic in sorted(sub_c["ubicacion"].dropna().unique().tolist())
        ]
        groups.append({"cuenca": cuenca, "subgroups": c_subgroups})

    series = [
        {"name": g["cuenca"], "data": g["subgroups"][0]["rows"][0]["data"] if g["subgroups"] else [], "type": "line"}
        for g in groups
    ]

    total = float(df[df["periodo"] == categories[-1]]["liquidos_mbd"].sum())
    kpis = {
        "total": round(total),
        "anio_top": int(df.groupby(df["periodo"].str[:4])["liquidos_mbd"].sum().idxmax()),
        "cuenca_top": df.groupby("cuenca")["liquidos_mbd"].sum().idxmax(),
        "ubicacion_top": df.groupby("ubicacion")["liquidos_mbd"].sum().idxmax(),
    }
    return {"type": "hierarchical", "categories": categories, "groups": groups, "series": series, "kpis": kpis}


@cached()
def get_resumen_nacional(engine: Engine) -> dict:
    """Último mes disponible de producción nacional (líquidos y gas natural) vs.
    el promedio mensual del año calendario anterior, para el Panorama general."""
    # Solo se necesitan ~2 años (último mes + promedio del año calendario previo);
    # sin este filtro la query agregaba el histórico completo de la tabla.
    sql = f"""
        SELECT FECHA,
               SUM(ISNULL(PETROLEO_MBD,0)+ISNULL(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD,
               SUM(ISNULL(GAS_MMPCD,0)) AS GAS_MMPCD
        FROM {SCHEMA}PRODUCCION_CAMPOS
        WHERE ID <> 1
          AND TIPO = 'ASIGNACION'
          AND FECHA >= DATEADD(year, -2, GETDATE())
        GROUP BY FECHA
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    df = df.sort_values("fecha")

    last = df.iloc[-1]
    anio_ref = last["fecha"].year - 1
    ref = df[df["fecha"].dt.year == anio_ref]
    if ref.empty:
        ref = df[df["fecha"].dt.year == last["fecha"].year]

    liquidos_prom = float(ref["liquidos_mbd"].mean()) if not ref.empty else None
    gas_prom = float(ref["gas_mmpcd"].mean()) if not ref.empty else None

    return {
        "periodo": last["fecha"].strftime("%Y-%m"),
        "liquidos": {
            "valor": round(float(last["liquidos_mbd"])),
            "promedio": round(liquidos_prom) if liquidos_prom else None,
            "anio_promedio": anio_ref,
        },
        "gas": {
            "valor": round(float(last["gas_mmpcd"])),
            "promedio": round(gas_prom) if gas_prom else None,
            "anio_promedio": anio_ref,
        },
    }


@cached()
def get_top_campos(engine: Engine, top_n: int = 8) -> dict:
    """Top campos productores del último mes registrado, por Asignación —
    líquidos (Mbd) y gas (MMpcd)."""
    # Solo se necesita el último mes registrado; filtrar por fecha reciente evita
    # agregar el histórico completo antes de descartarlo en pandas.
    sql = f"""
        SELECT CAMPO_PORTAL, FECHA,
               SUM(ISNULL(PETROLEO_MBD,0)+ISNULL(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD,
               SUM(ISNULL(GAS_MMPCD,0)) AS GAS_MMPCD
        FROM {SCHEMA}PRODUCCION_CAMPOS
        WHERE ID <> 1
          AND TIPO = 'ASIGNACION'
          AND FECHA >= DATEADD(month, -12, GETDATE())
        GROUP BY CAMPO_PORTAL, FECHA
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"periodo": None, "liquidos": [], "gas": []}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])

    ultimo_mes = df["fecha"].max()
    df = df[df["fecha"] == ultimo_mes]

    def _top(col):
        serie = (
            df.groupby("campo_portal")[col].sum()
            .sort_values(ascending=False)
            .head(top_n)
        )
        return [{"nombre": str(nombre), "valor": round(float(v))} for nombre, v in serie.items()]

    return {
        "periodo": ultimo_mes.strftime("%Y-%m"),
        "liquidos": _top("liquidos_mbd"),
        "gas": _top("gas_mmpcd"),
    }


def _grupo_contrato(asig_cont) -> str:
    s = str(asig_cont or "").upper()
    if s.startswith("CNH-M"):
        return "Migraciones"
    if s.startswith("CNH-A"):
        return "Farmouts"
    if s.startswith("CNH-R"):
        return "Rondas"
    return "Asignaciones"


@cached()
def get_produccion_por_operador(engine: Engine) -> dict:
    """Último mes: producción (líquidos y gas) de PEMEX E&P vs. otros operadores,
    desglosada por tipo de contrato dentro de cada grupo."""
    # Solo se necesita el último mes registrado.
    sql = f"""
        SELECT FECHA, OPERADOR, ASIG_CONT,
               SUM(ISNULL(PETROLEO_MBD,0)+ISNULL(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD,
               SUM(ISNULL(GAS_MMPCD,0)) AS GAS_MMPCD
        FROM {SCHEMA}PRODUCCION_CAMPOS
        WHERE ID <> 1
          AND FECHA >= DATEADD(month, -12, GETDATE())
        GROUP BY FECHA, OPERADOR, ASIG_CONT
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    ultimo_mes = df["fecha"].max()
    df = df[df["fecha"] == ultimo_mes].copy()

    df["operador_grupo"] = df["operador"].astype(str).str.upper().str.startswith("PEMEX").map(
        {True: "PEMEX E&P", False: "Otros operadores"}
    )
    df["contrato_grupo"] = df["asig_cont"].apply(_grupo_contrato)

    def _bloque(fuel_col):
        total = float(df[fuel_col].sum())
        pemex = df[df["operador_grupo"] == "PEMEX E&P"]
        otros = df[df["operador_grupo"] == "Otros operadores"]
        pemex_total = float(pemex[fuel_col].sum())
        otros_total = float(otros[fuel_col].sum())

        def _contratos(sub):
            g = sub.groupby("contrato_grupo")[fuel_col].sum()
            g = g[g > 0].sort_values(ascending=False)
            return [{"nombre": k, "valor": round(float(v))} for k, v in g.items()]

        return {
            "pemex_total": round(pemex_total),
            "otros_total": round(otros_total),
            "pemex_pct": round(pemex_total / total * 100) if total else None,
            "pemex_contratos": _contratos(pemex),
            "otros_contratos": _contratos(otros),
        }

    return {
        "periodo": ultimo_mes.strftime("%Y-%m"),
        "liquidos": _bloque("liquidos_mbd"),
        "gas": _bloque("gas_mmpcd"),
    }


@cached()
def get_pozos_operando(engine: Engine) -> dict:
    """Último mes: pozos en operación a nivel nacional, POZOS_ACEITE (petróleo y
    gas asociado) vs. POZOS_GAS (gas no asociado y condensado)."""
    sql = f"""
        SELECT FECHA,
               SUM(ISNULL(POZOS_ACEITE,0)) AS POZOS_ACEITE,
               SUM(ISNULL(POZOS_GAS,0))    AS POZOS_GAS
        FROM {SCHEMA}PRODUCCION_CAMPOS_POZOS
        WHERE UBICACION IS NOT NULL
          AND FECHA >= DATEADD(month, -12, GETDATE())
        GROUP BY FECHA
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    last = df.sort_values("fecha").iloc[-1]

    aceite = float(last["pozos_aceite"])
    gas = float(last["pozos_gas"])
    total = aceite + gas

    return {
        "periodo": last["fecha"].strftime("%Y-%m"),
        "total": round(total),
        "pozos_aceite": round(aceite),
        "pozos_gas": round(gas),
        "pct_aceite": round(aceite / total * 100, 1) if total else None,
        "pct_gas": round(gas / total * 100, 1) if total else None,
    }


@cached()
def get_produccion_detalle(
    engine: Engine,
    start_year: int,
    end_year: int,
    start_month: int,
    end_month: int,
    period: str,
    variable: str = "liquidos_mbd",
) -> dict:
    init, end = _date_range(start_year, start_month, end_year, end_month)

    numeric_cols = [
        "liquidos_mbd", "petroleo_mbd", "condensado_mbd",
        "gas_mmpcd", "gas_asoc_mmpcd", "gas_nasoc_mmpcd", "agua_mbd", "n2_mmpcd",
    ]
    var = variable.lower() if variable.lower() in numeric_cols else "liquidos_mbd"

    sql = f"""
        SELECT CUENCA, CAMPO_PORTAL, UBICACION, FECHA,
               SUM(ISNULL(PETROLEO_MBD,0)+ISNULL(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD,
               SUM(PETROLEO_MBD)      AS PETROLEO_MBD,
               SUM(CONDENSADO_MBD)    AS CONDENSADO_MBD,
               SUM(GAS_MMPCD)         AS GAS_MMPCD,
               SUM(GAS_ASOC_MMPCD)    AS GAS_ASOC_MMPCD,
               SUM(GAS_NASOC_MMPCD)   AS GAS_NASOC_MMPCD,
               SUM(AGUA_MBD)          AS AGUA_MBD,
               SUM(N2_MMPCD)          AS N2_MMPCD
        FROM {SCHEMA}PRODUCCION_CAMPOS
        WHERE ID <> 1
          AND FECHA BETWEEN '{init}' AND '{end}'
        GROUP BY CUENCA, CAMPO_PORTAL, UBICACION, FECHA
    """

    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"series": [], "categories": []}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    df[numeric_cols] = df[numeric_cols].fillna(0)

    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly"
        else df["fecha"].dt.strftime("%Y")
    )

    grouped = df.groupby(["periodo", "cuenca"])[var].sum().reset_index()
    categories = sorted(grouped["periodo"].unique().tolist())
    cuencas = sorted(grouped["cuenca"].unique().tolist())
    pivot = grouped.pivot(index="cuenca", columns="periodo", values=var).reindex(columns=categories, fill_value=0)

    series = [
        {"name": cuenca, "data": [round(float(v), 2) for v in pivot.loc[cuenca]], "type": "bar"}
        for cuenca in cuencas
    ]
    return {"categories": categories, "series": series, "variable": var}


def _make_row(label, row_type, categories, series_by_periodo, decimals=2):
    data = []
    for p in categories:
        val = float(series_by_periodo.loc[p]) if p in series_by_periodo.index else 0.0
        data.append(round(val, decimals))
    return {"label": label, "type": row_type, "data": data}


def get_produccion_operadores(
    engine: Engine, start_year: int, end_year: int, start_month: int, end_month: int,
    period: str, factor_col: str = "FACTOR_O", years: str = "",
) -> dict:
    """Producción ponderada por FACTOR_O (operador) o FACTOR_IP (interés de
    participación) — misma tabla y patrón, solo cambia la columna de peso.
    Top 10 empresas por PCE (petróleo crudo equivalente = líquidos + gas/5)."""
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    sql = f"""
        SELECT FECHA, EMPRESA,
               SUM(ISNULL(PETROLEO_MBD,0)*{factor_col}+ISNULL(CONDENSADO_MBD,0)*{factor_col}) AS LIQUIDOS_MBD,
               SUM(ISNULL(GAS_MMPCD,0)*{factor_col}) AS GAS_MMPCD
        FROM {SCHEMA}PRODUCCION_OPERADOR_IP
        WHERE {where_fecha}
        GROUP BY FECHA, EMPRESA
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"series": [], "categories": []}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    df[["liquidos_mbd", "gas_mmpcd"]] = df[["liquidos_mbd", "gas_mmpcd"]].fillna(0)
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly"
        else df["fecha"].dt.strftime("%Y")
    )

    grouped = _rollup_periodo(df, ["empresa"], ["liquidos_mbd", "gas_mmpcd"])
    categories = sorted(grouped["periodo"].unique().tolist())

    pce_por_empresa = (
        (grouped["liquidos_mbd"] + grouped["gas_mmpcd"] / 5).groupby(grouped["empresa"]).sum()
    )
    top = pce_por_empresa.nlargest(10).index.tolist()
    grouped = grouped[grouped["empresa"].isin(top)]

    pivot = grouped.pivot(index="empresa", columns="periodo", values="liquidos_mbd").reindex(columns=categories, fill_value=0)
    series = [
        {"name": empresa, "data": [round(float(v), 2) for v in pivot.loc[empresa]], "type": "bar"}
        for empresa in top
    ]
    return {"categories": categories, "series": series}


@cached()
def get_produccion_asignaciones(
    engine: Engine, start_year: int, end_year: int, start_month: int, end_month: int, period: str, years: str = "",
) -> dict:
    """Igual patrón que 'Cuenca' pero filtrado a TIPO='ASIGNACION'."""
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    sql = f"""
        SELECT CUENCA, FECHA,
               SUM(ISNULL(PETROLEO_MBD,0)+ISNULL(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD
        FROM {SCHEMA}PRODUCCION_CAMPOS
        WHERE ID <> 1 AND TIPO = 'ASIGNACION'
          AND {where_fecha}
        GROUP BY CUENCA, FECHA
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"series": [], "categories": []}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    df["liquidos_mbd"] = df["liquidos_mbd"].fillna(0)
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly"
        else df["fecha"].dt.strftime("%Y")
    )

    grouped = _rollup_periodo(df, ["cuenca"], ["liquidos_mbd"])
    nacional = grouped.groupby("periodo")["liquidos_mbd"].sum().reset_index()
    nacional["cuenca"] = "Nacional"
    grouped = pd.concat([grouped, nacional], ignore_index=True)

    categories = sorted(grouped["periodo"].unique().tolist())
    cuencas = sorted(grouped["cuenca"].unique().tolist())
    pivot = grouped.pivot(index="cuenca", columns="periodo", values="liquidos_mbd").reindex(columns=categories, fill_value=0)

    series = [
        {"name": cuenca, "data": [round(float(v), 2) for v in pivot.loc[cuenca]], "type": "line"}
        for cuenca in cuencas
    ]
    return {"categories": categories, "series": series}


def _hierarchia_cuenca_ubicacion(df, campo_col, categories):
    """Construye 'groups' Cuenca→Ubicación→[Total, filas de campo_col] a partir
    de un df con columnas periodo/cuenca/ubicacion/[campo_col]/liquidos_mbd ya
    agregado. Mismo patrón que _get_pozos_campos de perforacion_service.py."""
    groups = []
    cuencas_order = ["Nacional"] + sorted(df["cuenca"].dropna().unique().tolist())

    for cuenca in cuencas_order:
        if cuenca == "Nacional":
            ubicaciones_list = ["Nacional"] + sorted(df["ubicacion"].dropna().unique().tolist())
        else:
            sub_cuenca = df[df["cuenca"] == cuenca]
            if sub_cuenca.empty:
                continue
            ubicaciones_list = sorted(sub_cuenca["ubicacion"].dropna().unique().tolist())

        cuenca_rows = []
        for ubicacion in ubicaciones_list:
            if cuenca == "Nacional":
                sub_ub = df if ubicacion == "Nacional" else df[df["ubicacion"] == ubicacion]
            else:
                sub_ub = df[(df["cuenca"] == cuenca) & (df["ubicacion"] == ubicacion)]

            if sub_ub.empty:
                continue

            total_row = _make_row("Total", "total", categories, sub_ub.groupby("periodo")["liquidos_mbd"].sum())
            todos_row = {"label": "Todos los operadores", "type": "operator", "data": total_row["data"]}
            subtotal_rows = [total_row, todos_row]

            pivot = sub_ub.groupby([campo_col, "periodo"])["liquidos_mbd"].sum().unstack(fill_value=0)
            for etiqueta in sorted(pivot.index):
                subtotal_rows.append(_make_row(etiqueta, "operator", categories, pivot.loc[etiqueta]))

            cuenca_rows.append({"ubicacion": ubicacion, "rows": subtotal_rows})

        groups.append({"cuenca": cuenca, "subgroups": cuenca_rows})

    return groups


def _kpis_hierarquicos(df, categories, campo_col):
    total = float(df[df["periodo"] == categories[-1]]["liquidos_mbd"].sum())
    return {
        "total": round(total),
        "anio_top": int(df.groupby(df["periodo"].str[:4])["liquidos_mbd"].sum().idxmax()),
        "cuenca_top": df.groupby("cuenca")["liquidos_mbd"].sum().idxmax(),
        "operador_top": df.groupby(campo_col)["liquidos_mbd"].sum().idxmax(),
        "ubicacion_top": df.groupby("ubicacion")["liquidos_mbd"].sum().idxmax(),
    }


def _parse_lista(s):
    return [x.strip() for x in s.split("|") if x.strip()]


@cached()
def get_produccion_campos(
    engine: Engine, start_year: int, end_year: int, start_month: int, end_month: int, period: str,
    cuencas: str = "", ubicaciones: str = "", years: str = "",
) -> dict:
    """Jerárquico Cuenca→Ubicación→Campo, líquidos (Mbd)."""
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    sql = f"""
        SELECT FECHA, CUENCA, UBICACION, CAMPO_PORTAL,
               SUM(ISNULL(PETROLEO_MBD,0)+ISNULL(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD
        FROM {SCHEMA}PRODUCCION_CAMPOS
        WHERE ID <> 1
          AND {where_fecha}
        GROUP BY FECHA, CUENCA, UBICACION, CAMPO_PORTAL
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    df["liquidos_mbd"] = df["liquidos_mbd"].fillna(0)
    if cuencas:
        lst = _parse_lista(cuencas)
        if lst: df = df[df["cuenca"].isin(lst)]
    if ubicaciones:
        lst = _parse_lista(ubicaciones)
        if lst: df = df[df["ubicacion"].isin(lst)]
    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly"
        else df["fecha"].dt.strftime("%Y")
    )
    df = _rollup_periodo(df, ["cuenca", "ubicacion", "campo_portal"], ["liquidos_mbd"])

    categories = sorted(df["periodo"].unique().tolist())
    groups = _hierarchia_cuenca_ubicacion(df, "campo_portal", categories)
    series = [
        {"name": g["cuenca"], "data": g["subgroups"][0]["rows"][0]["data"] if g["subgroups"] else [], "type": "bar"}
        for g in groups
    ]

    return {
        "type": "hierarchical", "categories": categories, "groups": groups, "series": series,
        "kpis": _kpis_hierarquicos(df, categories, "campo_portal"),
    }


_API_ORDEN = {
    "Súper-ligero": "1) Súper-ligero", "Ligero": "2) Ligero", "Mediano": "3) Mediano",
    "Pesado": "4) Pesado", "Extra-pesado": "5) Extra-pesado",
}


@cached()
def get_produccion_api(
    engine: Engine, start_year: int, end_year: int, start_month: int, end_month: int, period: str,
    cuencas: str = "", ubicaciones: str = "", years: str = "",
) -> dict:
    """Jerárquico Cuenca→Ubicación→Clase API, líquidos (Mbd)."""
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    sql = f"""
        SELECT FECHA, CUENCA, UBICACION, PETROLEO_API,
               SUM(ISNULL(PETROLEO_MBD,0)+ISNULL(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD
        FROM {SCHEMA}PRODUCCION_CAMPOS
        WHERE ID <> 1
          AND {where_fecha}
        GROUP BY FECHA, CUENCA, UBICACION, PETROLEO_API
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    df["liquidos_mbd"] = df["liquidos_mbd"].fillna(0)
    if cuencas:
        lst = _parse_lista(cuencas)
        if lst: df = df[df["cuenca"].isin(lst)]
    if ubicaciones:
        lst = _parse_lista(ubicaciones)
        if lst: df = df[df["ubicacion"].isin(lst)]
    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}
    df["clase_api"] = df["petroleo_api"].map(_API_ORDEN).fillna("6) Sin clasificar")
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly"
        else df["fecha"].dt.strftime("%Y")
    )
    df = _rollup_periodo(df, ["cuenca", "ubicacion", "clase_api"], ["liquidos_mbd"])

    categories = sorted(df["periodo"].unique().tolist())
    groups = _hierarchia_cuenca_ubicacion(df, "clase_api", categories)
    series = [
        {"name": g["cuenca"], "data": g["subgroups"][0]["rows"][0]["data"] if g["subgroups"] else [], "type": "bar"}
        for g in groups
    ]

    return {
        "type": "hierarchical", "categories": categories, "groups": groups, "series": series,
        "kpis": _kpis_hierarquicos(df, categories, "clase_api"),
    }


_GCOMPO_COLS = {
    "gas_mmpcd": "Gas total", "c1_mmpcd": "Metano (C1)", "c2_mmpcd": "Etano (C2)",
    "c3_mmpcd": "Propano (C3)", "ic4_mmpcd": "Isobutano (iC4)", "c4_mmpcd": "Butano (C4)",
    "c5_plus_mmpcd": "Pentanos+ (C5+)", "n2_mmpcd": "Nitrógeno (N2)", "co2_mmpcd": "CO2",
    "h2s_mmpcd": "H2S", "h2o_mmpcd": "Agua (vapor)",
}


@cached()
def get_produccion_gcompo(
    engine: Engine, start_year: int, end_year: int, start_month: int, end_month: int, period: str, years: str = "",
) -> dict:
    """Composición del gas producido a nivel nacional: un componente por serie."""
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    cols_sql = ",\n               ".join(f"SUM(ISNULL({c.upper()},0)) AS {c.upper()}" for c in _GCOMPO_COLS)
    sql = f"""
        SELECT FECHA,
               {cols_sql}
        FROM {SCHEMA}PRODUCCION_CAMPOS
        WHERE ID <> 1
          AND {where_fecha}
        GROUP BY FECHA
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"series": [], "categories": []}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    cols = list(_GCOMPO_COLS)
    df[cols] = df[cols].fillna(0)
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly"
        else df["fecha"].dt.strftime("%Y")
    )

    grouped = _rollup_periodo(df, [], cols).set_index("periodo")
    categories = sorted(grouped.index.tolist())
    grouped = grouped.reindex(categories, fill_value=0)

    series = [
        {"name": label, "data": [round(float(v), 2) for v in grouped[col]], "type": "line"}
        for col, label in _GCOMPO_COLS.items()
    ]
    return {"categories": categories, "series": series}


@cached()
def get_produccion(
    engine: Engine, topic: str, start_year: int, end_year: int, start_month: int, end_month: int, period: str,
    cuencas: str = "", ubicaciones: str = "", productos: str = "", years: str = "", campos: str = "",
) -> dict:
    if topic == "Operadores":
        return get_produccion_operadores(engine, start_year, end_year, start_month, end_month, period, "FACTOR_O", years)
    if topic == "InteresPart":
        return get_produccion_operadores(engine, start_year, end_year, start_month, end_month, period, "FACTOR_IP", years)
    if topic == "Contratos":
        return contratos_service.get_contratos(engine, start_year, end_year, start_month, end_month, period, "CONTRATO", years)
    if topic == "Asignaciones":
        return get_produccion_asignaciones(engine, start_year, end_year, start_month, end_month, period, years)
    if topic == "Campos":
        return get_produccion_campos(engine, start_year, end_year, start_month, end_month, period, cuencas, ubicaciones, years)
    if topic == "Estado":
        return estado_service.get_por_estado(engine, start_year, end_year, start_month, end_month, period, years)
    if topic == "API":
        return get_produccion_api(engine, start_year, end_year, start_month, end_month, period, cuencas, ubicaciones, years)
    if topic == "Gcompo":
        return get_produccion_gcompo(engine, start_year, end_year, start_month, end_month, period, years)
    return get_produccion_cuenca(engine, start_year, end_year, start_month, end_month, period, cuencas, ubicaciones, productos, years)
