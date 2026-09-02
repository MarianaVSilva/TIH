import re
import unicodedata
import pandas as pd
from sqlalchemy import text as sqlalchemy_text
from sqlalchemy.engine import Engine
from app.config import settings
from app.services.cache_utils import cached

SCHEMA = settings.db_schema + "."
_PG = settings.db_engine == "postgres"
_YEAR_FECHA = "EXTRACT(YEAR FROM FECHA)" if _PG else "YEAR(FECHA)"
_ISNULL = "COALESCE" if _PG else "ISNULL"
_TABLA_PRODUCCION_CAMPOS = "api.v_produccion_campos" if _PG else f"{SCHEMA}PRODUCCION_CAMPOS"
_TABLA_PRODUCCION_ESTADO = "api.v_produccion_estado" if _PG else f"{SCHEMA}PRODUCCION_ESTADO"
_TABLA_PRODUCCION_OPERADOR_IP = "api.v_produccion_operador_ip" if _PG else f"{SCHEMA}PRODUCCION_OPERADOR_IP"
_TABLA_PRODUCCION_CAMPOS_POZOS = "api.v_produccion_campos_pozos" if _PG else f"{SCHEMA}PRODUCCION_CAMPOS_POZOS"
# api.v_produccion_operador_ip expone "operador" (no "empresa" como en dbo.PRODUCCION_OPERADOR_IP)
_COL_EMPRESA = "operador" if _PG else "EMPRESA"
# ID<>1 (fila de totales/placeholder) ya se descarto al cargar core.fact_produccion_campo (regla #6, 00_PLAN.md)
_FILTRO_ID = "" if _PG else "ID <> 1 AND "
_FILTRO_ID_WHERE = "1=1" if _PG else "ID <> 1"
# DATEADD(unit,-n,GETDATE()) es sintaxis SQL Server (unit en singular: year/month);
# equivalente en Postgres: CURRENT_DATE - INTERVAL 'n unit' (unit en plural).
def _dateadd_ago(n: int, unit_singular: str) -> str:
    return f"(CURRENT_DATE - INTERVAL '{n} {unit_singular}s')" if _PG else f"DATEADD({unit_singular}, -{n}, GETDATE())"


def _date_range(start_year: int, start_month: int, end_year: int, end_month: int):
    return f"{start_year}-{start_month:02d}-01", f"{end_year}-{end_month:02d}-01"


def _where_fecha(start_year: int, start_month: int, end_year: int, end_month: int, period: str, years: str = ""):
    """Cláusula WHERE de fecha: rango continuo por defecto, o años específicos
    no necesariamente consecutivos cuando se pide comparar años (p. ej. "2018|2025").
    Devuelve (where_clause, period_efectivo) — comparar años fuerza anual."""
    years_list = [int(y.strip()) for y in years.split("|") if y.strip()] if years else []
    if years_list:
        años_sql = ", ".join(str(y) for y in years_list)
        return f"{_YEAR_FECHA} IN ({años_sql})", "annually"
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
    sql = f"SELECT DISTINCT CUENCA, UBICACION FROM {_TABLA_PRODUCCION_CAMPOS}"
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)
        empresas_df = pd.read_sql(f"SELECT DISTINCT {_COL_EMPRESA} AS EMPRESA FROM {_TABLA_PRODUCCION_OPERADOR_IP}", conn)
    df.columns = df.columns.str.lower()
    empresas_df.columns = empresas_df.columns.str.lower()
    return {
        "cuencas": sorted(df["cuenca"].dropna().unique().tolist()),
        # "NACIONAL" no es un ambiente real, es un artefacto de la fuente — se
        # excluye de las opciones de filtro (los datos que traiga se siguen
        # incluyendo en los agregados, solo no se ofrece como filtro).
        "ubicaciones": sorted(u for u in df["ubicacion"].dropna().unique().tolist() if u.upper() != "NACIONAL"),
        "productos": [label for _, label in PRODUCTOS],
        # Empresas de "Producción por operador" — lista plana usada por el
        # checkbox de selección individual en el filtro (independiente de
        # cuencas/ubicaciones, que son de PRODUCCION_CAMPOS).
        "empresas": sorted(empresas_df["empresa"].dropna().unique().tolist()),
    }


# "Producción por operador" reusa el mismo patrón visual que "Producción por
# ubicación" (get_produccion_cuenca): Grupo (Pemex Exploración y Producción /
# Privadas) hace las veces de "cuenca" y Empresa la de "ambiente" — a
# diferencia de PRODUCCION_CAMPOS, PRODUCCION_OPERADOR_IP no tiene columnas de
# cuenca/ubicación, pero sí el mismo desglose completo de productos, ponderado
# por FACTOR_O.
GRUPO_PEMEX = "Pemex Exploración y Producción"
GRUPO_PRIVADAS = "Privadas"

PRODUCTOS_EMPRESA = [
    ("liquidos_mbd",    "Hidrocarburos líquidos (Mbd)"),
    ("petroleo_mbd",    "Petróleo (Mbd)"),
    ("condensado_mbd",  "Condensado (Mbd)"),
    ("gas_mmpcd",       "Gas (MMpcd)"),
    ("gas_asoc_mmpcd",  "Gas asociado (MMpcd)"),
    ("gas_nasoc_mmpcd", "Gas no asociado (MMpcd)"),
    ("n2_mmpcd",        "Nitrógeno (MMpcd)"),
    ("agua_mbd",        "Agua (Mbd)"),
]
_COLS_PRODUCTOS_EMPRESA = [c for c, _ in PRODUCTOS_EMPRESA if c != "liquidos_mbd"]


def _filas_nacional_por_producto(df, categories):
    """Nivel Nacional (sin un solo grupo filtrado): cada producto, incluido el
    agregado de Hidrocarburos líquidos, como subtotal, desglosado por grupo
    (Pemex/Privadas) — mismo patrón que _filas_agregadas_por_producto en
    'Producción por ubicación', con Grupo en el rol de ambiente."""
    rows = []
    for col, label in PRODUCTOS_EMPRESA:
        if df[col].sum() == 0:
            continue  # producto sin producción en el rango: no aporta mostrarlo
        rows.append(_make_row(label, "subtotal", categories, df.groupby("periodo")[col].sum()))
        pivot = df.groupby(["cuenca", "periodo"])[col].sum().unstack(fill_value=0)
        for grupo in [GRUPO_PEMEX, GRUPO_PRIVADAS]:
            if grupo in pivot.index:
                rows.append(_make_row(grupo, "operator", categories, pivot.loc[grupo]))
    return rows


def _remap_contrato(asig_cont) -> str:
    """Los contratos propios de Pemex (ASIG_CONT empieza con 'A-'/'AE'/'AR')
    se agrupan en una sola fila 'Asignaciones' — mismo criterio que
    get_operadores() en contratos_service.py. El resto (contratos CNH de
    terceros) se muestra tal cual, uno por fila."""
    s = str(asig_cont or "")
    return "Asignaciones" if s[:2] in ("A-", "AE", "AR") else s


def _filas_empresa_por_contrato(sub_df, categories):
    """Una empresa ya acotada: cada Contrato/Asignación como subtotal,
    desglosado por producto (hoja) — pedido explícito: antes era Producto →
    Contrato, lo que repetía el nombre del contrato una vez por cada
    producto que produce (7-8 veces seguidas para un mismo contrato).
    No lleva subtotales aparte de "Hidrocarburos líquidos (Mbd)"/"Gas
    (MMpcd)" (serían un duplicado del banner Total Mbd/Total MMpcd que ya
    arma el frontend sumando los operator homónimos bajo cada contrato —
    ver totalesPorUnidad en DynamicTable.jsx)."""
    rows = []
    for contrato in sorted(sub_df["contrato"].dropna().unique()):
        sub_c = sub_df[sub_df["contrato"] == contrato]
        productos_activos = [(col, label) for col, label in PRODUCTOS_EMPRESA if sub_c[col].sum() != 0]
        if not productos_activos:
            continue
        # Sin cifra en el encabezado del contrato: mezclar Mbd y MMpcd en un
        # solo número (antes PCE = líquidos + gas/5) confundía más de lo que
        # aportaba — mejor sin dato ahí, el detalle real está en las filas
        # de producto de abajo.
        rows.append({"label": contrato, "type": "subtotal", "data": [None for _ in categories]})
        for col, label in productos_activos:
            rows.append(_make_row(label, "operator", categories, sub_c.groupby("periodo")[col].sum()))
    return rows


def _empresas_series_por_producto(df, categories):
    """Una entrada por empresa con su serie de cada producto (sin desglose por
    contrato) — alimenta el selector de 'Gráfica personalizada' en el
    frontend, para graficar toda la producción de una sola empresa junta."""
    out = []
    for empresa, sub in df.groupby("empresa"):
        series = []
        for col, label in PRODUCTOS_EMPRESA:
            if sub[col].sum() == 0:
                continue
            data = [round(float(v), 2) for v in sub.groupby("periodo")[col].sum().reindex(categories, fill_value=0)]
            series.append({"name": label, "data": data})
        if series:
            out.append({"empresa": empresa, "series": series})
    out.sort(key=lambda e: -sum(sum(s["data"]) for s in e["series"]))
    return out


def _entidades_series_por_producto(df, entidad_col, categories):
    """Generaliza _empresas_series_por_producto sobre cualquier columna de
    entidad — alimenta el selector de 'Gráfica personalizada' cuando la hoja
    no es una empresa (p. ej. un contrato en 'Producción por contrato')."""
    out = []
    for entidad, sub in df.groupby(entidad_col):
        series = []
        for col, label in PRODUCTOS_EMPRESA:
            if sub[col].sum() == 0:
                continue
            data = [round(float(v), 2) for v in sub.groupby("periodo")[col].sum().reindex(categories, fill_value=0)]
            series.append({"name": label, "data": data})
        if series:
            out.append({"nombre": entidad, "series": series})
    out.sort(key=lambda e: -sum(sum(s["data"]) for s in e["series"]))
    return out


def _filas_por_producto_entidad(df, entidad_col, categories):
    """Nacional → Producto (subtotal) → entidad (hoja) — mismo patrón que
    _filas_empresa_por_producto, generalizado sobre la columna que hace de
    hoja (contrato, campo, cuenca o entidad federativa). Usado por 'Producción
    por contrato/campo/asignación/Entidad Federativa': las series siempre son
    los productos, la entidad del tema es la hoja bajo cada uno."""
    rows = []
    for col, label in PRODUCTOS_EMPRESA:
        if df[col].sum() == 0:
            continue
        rows.append(_make_row(label, "subtotal", categories, df.groupby("periodo")[col].sum()))
        pivot = df.groupby([entidad_col, "periodo"])[col].sum().unstack(fill_value=0)
        for ent in sorted(pivot.index):
            rows.append(_make_row(ent, "operator", categories, pivot.loc[ent]))
    return rows


def _series_por_producto(df, categories):
    return [
        {
            "name": label,
            "data": [round(float(v), 2) for v in df.groupby("periodo")[col].sum().reindex(categories, fill_value=0)],
            "type": "bar",
        }
        for col, label in PRODUCTOS_EMPRESA
        if df[col].sum() != 0
    ]


def _kpis_producto_entidad(df, categories, entidad_col):
    total = float(df[df["periodo"] == categories[-1]]["liquidos_mbd"].sum())
    return {
        "total": round(total),
        "anio_top": int(df.groupby(df["periodo"].str[:4])["liquidos_mbd"].sum().idxmax()),
        "operador_top": df.groupby(entidad_col)["liquidos_mbd"].sum().idxmax(),
        "unidad": "Mbd",
    }


def _cargar_df_producto_entidad(engine, tabla, entidad_col_sql, where_fecha, extra_where=""):
    tabla_sql = _TABLA_PRODUCCION_CAMPOS if tabla == "PRODUCCION_CAMPOS" else f"{SCHEMA}{tabla}"
    """SQL genérica para las tablas con las 8 columnas de producto (PRODUCCION_CAMPOS
    y PRODUCCION_ESTADO comparten el mismo patrón de columnas)."""
    sql = f"""
        SELECT FECHA, {entidad_col_sql},
               SUM({_ISNULL}(PETROLEO_MBD,0)+{_ISNULL}(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD,
               SUM(PETROLEO_MBD)      AS PETROLEO_MBD,
               SUM(CONDENSADO_MBD)    AS CONDENSADO_MBD,
               SUM(GAS_MMPCD)         AS GAS_MMPCD,
               SUM(GAS_ASOC_MMPCD)    AS GAS_ASOC_MMPCD,
               SUM(GAS_NASOC_MMPCD)   AS GAS_NASOC_MMPCD,
               SUM(N2_MMPCD)          AS N2_MMPCD,
               SUM(AGUA_MBD)          AS AGUA_MBD
        FROM {tabla_sql}
        WHERE {extra_where}{where_fecha}
        GROUP BY FECHA, {entidad_col_sql}
    """
    with engine.connect() as conn:
        return pd.read_sql(sql, conn)


def _preparar_df_producto_entidad(df, entidad_col, period):
    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    df[_COLS_PRODUCTOS_EMPRESA] = df[_COLS_PRODUCTOS_EMPRESA].fillna(0)
    df["liquidos_mbd"] = df["petroleo_mbd"] + df["condensado_mbd"]
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly" else df["fecha"].dt.strftime("%Y")
    )
    numeric_cols = ["liquidos_mbd"] + _COLS_PRODUCTOS_EMPRESA
    return _rollup_periodo(df, [entidad_col], numeric_cols)


def _cargar_df_producto_entidad_multi(engine, tabla, cols_sql, where_fecha, extra_where=""):
    tabla_sql = _TABLA_PRODUCCION_CAMPOS if tabla == "PRODUCCION_CAMPOS" else f"{SCHEMA}{tabla}"
    """Como _cargar_df_producto_entidad pero agrupando por varias columnas de
    entidad a la vez (p. ej. CUENCA, UBICACION y la hoja final) — usado para
    el drill-down Ambiente → Cuenca → Producto → hoja de Campo/Asignación."""
    cols_list = ", ".join(cols_sql)
    sql = f"""
        SELECT FECHA, {cols_list},
               SUM({_ISNULL}(PETROLEO_MBD,0)+{_ISNULL}(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD,
               SUM(PETROLEO_MBD)      AS PETROLEO_MBD,
               SUM(CONDENSADO_MBD)    AS CONDENSADO_MBD,
               SUM(GAS_MMPCD)         AS GAS_MMPCD,
               SUM(GAS_ASOC_MMPCD)    AS GAS_ASOC_MMPCD,
               SUM(GAS_NASOC_MMPCD)   AS GAS_NASOC_MMPCD,
               SUM(N2_MMPCD)          AS N2_MMPCD,
               SUM(AGUA_MBD)          AS AGUA_MBD
        FROM {tabla_sql}
        WHERE {extra_where}{where_fecha}
        GROUP BY FECHA, {cols_list}
    """
    with engine.connect() as conn:
        return pd.read_sql(sql, conn)


def _filas_producto_hoja(sub_df, hoja_col, categories, nombre_map=None):
    """Cuenca+Ambiente ya acotados: cada producto (subtotal) desglosado por la
    columna que hace de hoja (campo, asignación, etc.) — mismo patrón que
    _filas_agregadas_por_producto, generalizado sobre la hoja. `nombre_map`
    (opcional, p. ej. ASIG_CONT→BLOCK_NAME) sustituye el código crudo por un
    nombre legible en el label, conservando el código original en "code"."""
    rows = []
    for col, label in PRODUCTOS_EMPRESA:
        if sub_df[col].sum() == 0:
            continue
        rows.append(_make_row(label, "subtotal", categories, sub_df.groupby("periodo")[col].sum()))
        pivot = sub_df.groupby([hoja_col, "periodo"])[col].sum().unstack(fill_value=0)
        for hoja in sorted(pivot.index):
            nombre = nombre_map.get(hoja, hoja) if nombre_map else hoja
            rows.append(_make_row(nombre, "operator", categories, pivot.loc[hoja], code=hoja if nombre_map else None))
    return rows


def _filas_hoja_producto(sub_df, hoja_col, categories, nombre_map=None):
    """Inverso de _filas_producto_hoja: cada hoja (asignación) es el subtotal y
    dentro van sus componentes (Petróleo, Gas, Agua…).

    Es la jerarquía que pidió el usuario para "Producción por asignación"
    (Ubicación → Cuenca → Asignación → componente): al ver una asignación
    concreta interesa su desglose por producto, no repetir la asignación
    debajo de cada producto.

    El código real (ASIG_CONT) viaja en "code" del subtotal para que la tabla
    pueda abrir su ficha, ya que aquí la asignación dejó de ser fila hoja.
    """
    rows = []
    for hoja in sorted(sub_df[hoja_col].dropna().unique().tolist()):
        sub_h = sub_df[sub_df[hoja_col] == hoja]
        # Productos con datos en esta asignación; si no hay ninguno se omite
        # entera en vez de dejar un encabezado vacío.
        cols_con_dato = [(col, label) for col, label in PRODUCTOS_EMPRESA if sub_h[col].sum() != 0]
        if not cols_con_dato:
            continue
        nombre = nombre_map.get(hoja, hoja) if nombre_map else hoja
        # Sin cifra propia: sus hijos son productos en unidades distintas
        # (Mbd y MMpcd) y sumarlos no significa nada — misma razón por la que
        # el frontend usa forceDivisions para ocultar ese total en otros temas.
        fila = _make_row(nombre, "subtotal", categories, pd.Series(dtype="float64"), code=hoja if nombre_map else None)
        fila["data"] = [None] * len(categories)
        rows.append(fila)
        for col, label in cols_con_dato:
            rows.append(_make_row(label, "operator", categories, sub_h.groupby("periodo")[col].sum()))
    return rows


def _drilldown_ambiente_cuenca_producto(df, hoja_col, period, cuencas, ubicaciones, nombre_map=None,
                                        hoja_primero=False):
    """Ambiente → Cuenca → Producto (subtotal) → hoja, a partir de un df con
    columnas fecha/cuenca/ubicacion/[hoja_col]/8 productos ya cargado (sin
    procesar). Usado por 'Producción por campo/asignación' al filtrar."""
    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    df[_COLS_PRODUCTOS_EMPRESA] = df[_COLS_PRODUCTOS_EMPRESA].fillna(0)
    df["liquidos_mbd"] = df["petroleo_mbd"] + df["condensado_mbd"]
    if cuencas:
        lst = _parse_lista(cuencas)
        if lst: df = df[df["cuenca"].isin(lst)]
    if ubicaciones:
        lst = _parse_lista(ubicaciones)
        if lst: df = df[df["ubicacion"].isin(lst)]
    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly" else df["fecha"].dt.strftime("%Y")
    )
    numeric_cols = ["liquidos_mbd"] + _COLS_PRODUCTOS_EMPRESA
    df = _rollup_periodo(df, ["cuenca", "ubicacion", hoja_col], numeric_cols)
    categories = sorted(df["periodo"].unique().tolist())

    construir_filas = _filas_hoja_producto if hoja_primero else _filas_producto_hoja
    groups = [{"cuenca": "Nacional", "subgroups": []}]
    for cuenca in sorted(df["cuenca"].dropna().unique().tolist()):
        sub_c = df[df["cuenca"] == cuenca]
        c_subgroups = [
            {"ubicacion": ubic, "rows": construir_filas(sub_c[sub_c["ubicacion"] == ubic], hoja_col, categories, nombre_map)}
            for ubic in sorted(sub_c["ubicacion"].dropna().unique().tolist())
        ]
        groups.append({"cuenca": cuenca, "subgroups": c_subgroups})

    series = _series_por_producto(df, categories)
    kpis = _kpis_producto_entidad(df, categories, hoja_col)
    return {"type": "hierarchical", "categories": categories, "groups": groups, "series": series, "kpis": kpis}


def _respuesta_producto_entidad(df, entidad_col, categories):
    groups = [{"cuenca": "Nacional", "subgroups": [{"ubicacion": "Nacional", "rows": _filas_por_producto_entidad(df, entidad_col, categories)}]}]
    return {
        "type": "hierarchical", "categories": categories, "groups": groups,
        "series": _series_por_producto(df, categories),
        "kpis": _kpis_producto_entidad(df, categories, entidad_col),
    }


@cached()
def get_produccion_contratos(
    engine: Engine, start_year: int, end_year: int, start_month: int, end_month: int, period: str, years: str = "",
) -> dict:
    """Nacional → CONTRATO (subtotal) → componente, TIPO='CONTRATO' (solo
    terceros, sin asignaciones de Pemex).

    Misma desagregación que 'Producción por asignación' (pedido explícito):
    antes era Producto → Contrato, con el contrato repetido debajo de cada
    producto; ahora el contrato es el grupo y dentro va su desglose por
    componente. Se conserva la FORMA plana de la respuesta (Nacional único, sin
    niveles de cuenca/ambiente): este tema no tiene cajón de filtros y el
    frontend lo dibuja con el camino plano — devolver la estructura con niveles
    de cuenca dejaba la tabla vacía."""
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    df = _cargar_df_producto_entidad(engine, "PRODUCCION_CAMPOS", "ASIG_CONT", where_fecha, extra_where=f"{_FILTRO_ID}TIPO = 'CONTRATO' AND ")
    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}
    df = _preparar_df_producto_entidad(df, "asig_cont", period)
    categories = sorted(df["periodo"].unique().tolist())
    groups = [{"cuenca": "Nacional", "subgroups": [
        {"ubicacion": "Nacional", "rows": _filas_hoja_producto(df, "asig_cont", categories)},
    ]}]
    resp = {
        "type": "hierarchical", "categories": categories, "groups": groups,
        "series": _series_por_producto(df, categories),
        "kpis": _kpis_producto_entidad(df, categories, "asig_cont"),
    }
    resp["contratos"] = _entidades_series_por_producto(df, "asig_cont", categories)
    return resp


def _filas_producto_ambiente(sub_df, categories):
    """Una entidad federativa ya acotada: cada producto (subtotal) desglosado
    por ambiente (hoja) — mismo patrón que _filas_empresa_por_producto, con
    Ambiente en el rol de contrato."""
    rows = []
    for col, label in PRODUCTOS_EMPRESA:
        if sub_df[col].sum() == 0:
            continue
        rows.append(_make_row(label, "subtotal", categories, sub_df.groupby("periodo")[col].sum()))
        pivot = sub_df.groupby(["ubicacion", "periodo"])[col].sum().unstack(fill_value=0)
        for ubic in sorted(pivot.index):
            rows.append(_make_row(ubic, "operator", categories, pivot.loc[ubic]))
    return rows


def _hierarchia_entidad_producto(df, categories):
    """Entidad Federativa (todas) → Producto (subtotal) → Ambiente (hoja).
    Ordenadas de mayor a menor producción (PCE), mismo patrón que
    _hierarchia_empresa_operador con la entidad en el rol de empresa."""
    pce = (df["liquidos_mbd"] + df["gas_mmpcd"] / 5).groupby(df["nom_ent"]).sum()
    orden = pce.sort_values(ascending=False).index.tolist()
    groups = []
    for ent in orden:
        sub = df[df["nom_ent"] == ent]
        if sub.empty:
            continue
        groups.append({"cuenca": ent, "subgroups": [{"ubicacion": "Nacional", "rows": _filas_producto_ambiente(sub, categories)}]})
    return groups


@cached()
def get_produccion_estado(
    engine: Engine, start_year: int, end_year: int, start_month: int, end_month: int, period: str, years: str = "",
) -> dict:
    """Entidad Federativa (grupo) → Producto (subtotal) → Ambiente (hoja)."""
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    sql = f"""
        SELECT FECHA, NOM_ENT, UBICACION,
               SUM({_ISNULL}(PETROLEO_MBD,0)+{_ISNULL}(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD,
               SUM(PETROLEO_MBD)      AS PETROLEO_MBD,
               SUM(CONDENSADO_MBD)    AS CONDENSADO_MBD,
               SUM(GAS_MMPCD)         AS GAS_MMPCD,
               SUM(GAS_ASOC_MMPCD)    AS GAS_ASOC_MMPCD,
               SUM(GAS_NASOC_MMPCD)   AS GAS_NASOC_MMPCD,
               SUM(N2_MMPCD)          AS N2_MMPCD,
               SUM(AGUA_MBD)          AS AGUA_MBD
        FROM {_TABLA_PRODUCCION_ESTADO}
        WHERE {where_fecha}
        GROUP BY FECHA, NOM_ENT, UBICACION
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)
    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    df[_COLS_PRODUCTOS_EMPRESA] = df[_COLS_PRODUCTOS_EMPRESA].fillna(0)
    df["liquidos_mbd"] = df["petroleo_mbd"] + df["condensado_mbd"]
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly" else df["fecha"].dt.strftime("%Y")
    )
    numeric_cols = ["liquidos_mbd"] + _COLS_PRODUCTOS_EMPRESA
    df = _rollup_periodo(df, ["nom_ent", "ubicacion"], numeric_cols)
    categories = sorted(df["periodo"].unique().tolist())

    # Grupo "Nacional" al frente (Producto → Ambiente, agregando todas las
    # entidades) — mismo patrón que Contratos/Asignaciones, para que la tabla
    # abra con el total nacional antes del desglose por entidad.
    groups = [{"cuenca": "Nacional", "subgroups": [{"ubicacion": "Nacional", "rows": _filas_producto_ambiente(df, categories)}]}]
    groups += _hierarchia_entidad_producto(df, categories)
    series = _series_por_producto(df, categories)
    kpis = _kpis_producto_entidad(df, categories, "nom_ent")
    return {
        "type": "hierarchical", "categories": categories, "groups": groups,
        "series": series, "kpis": kpis,
        # "Grafica individual": elegir UNA entidad federativa y ver todos sus
        # productos. El df ya viene agrupado por nom_ent, sin consulta extra.
        "entidades": _entidades_series_por_producto(df, "nom_ent", categories),
    }


def _hierarchia_empresa_operador(df, categories):
    """Empresa (todas, o las del grupo filtrado) → Producto (subtotal) →
    Contrato (hoja). Ordenadas de mayor a menor producción (PCE = líquidos +
    gas/5) para que las empresas grandes —Pemex primero— encabecen la lista."""
    pce_por_empresa = (df["liquidos_mbd"] + df["gas_mmpcd"] / 5).groupby(df["empresa"]).sum()
    orden = pce_por_empresa.sort_values(ascending=False).index.tolist()
    groups = []
    for empresa in orden:
        sub = df[df["empresa"] == empresa]
        if sub.empty:
            continue
        groups.append({"cuenca": empresa, "subgroups": [{"ubicacion": "Nacional", "rows": _filas_empresa_por_contrato(sub, categories)}]})
    return groups


@cached()
def get_produccion_empresas(
    engine: Engine, start_year: int, end_year: int, start_month: int, end_month: int, period: str,
    grupos: str = "", empresas: str = "", years: str = "",
) -> dict:
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    sql = f"""
        SELECT FECHA, {_COL_EMPRESA} AS EMPRESA, ASIG_CONT,
               SUM(PETROLEO_MBD*FACTOR_O)    AS PETROLEO_MBD,
               SUM(CONDENSADO_MBD*FACTOR_O)  AS CONDENSADO_MBD,
               SUM(GAS_MMPCD*FACTOR_O)       AS GAS_MMPCD,
               SUM(GAS_ASOC_MMPCD*FACTOR_O)  AS GAS_ASOC_MMPCD,
               SUM(GAS_NASOC_MMPCD*FACTOR_O) AS GAS_NASOC_MMPCD,
               SUM(N2_MMPCD*FACTOR_O)        AS N2_MMPCD,
               SUM(AGUA_MBD*FACTOR_O)        AS AGUA_MBD
        FROM {_TABLA_PRODUCCION_OPERADOR_IP}
        WHERE {where_fecha}
        GROUP BY FECHA, {_COL_EMPRESA}, ASIG_CONT
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    df[_COLS_PRODUCTOS_EMPRESA] = df[_COLS_PRODUCTOS_EMPRESA].fillna(0)
    df["liquidos_mbd"] = df["petroleo_mbd"] + df["condensado_mbd"]
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly"
        else df["fecha"].dt.strftime("%Y")
    )
    df["cuenca"] = df["empresa"].apply(lambda e: GRUPO_PEMEX if str(e).lower().startswith("pemex") else GRUPO_PRIVADAS)
    df["contrato"] = df["asig_cont"].apply(_remap_contrato)

    grupos_sel = [g.strip() for g in grupos.split("|") if g.strip()] if grupos else []
    empresas_sel = [e.strip() for e in empresas.split("|") if e.strip()] if empresas else []
    # Unión, no intersección: un grupo (Pemex/Privadas) MÁS empresas puntuales
    # de fuera de ese grupo (p. ej. Pemex + ENI México) deben sumarse, no
    # filtrarse entre sí (si fuera AND, esa combinación no traería nada).
    if grupos_sel or empresas_sel:
        mask = pd.Series(False, index=df.index)
        if grupos_sel:
            mask |= df["cuenca"].isin(grupos_sel)
        if empresas_sel:
            mask |= df["empresa"].isin(empresas_sel)
        df = df[mask]
    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": [], "kpis": {"unidad": "Mbd"}}

    numeric_cols = ["liquidos_mbd"] + _COLS_PRODUCTOS_EMPRESA
    df = _rollup_periodo(df, ["cuenca", "empresa", "contrato"], numeric_cols)
    categories = sorted(df["periodo"].unique().tolist())

    # Un solo grupo filtrado, o una selección explícita de empresas → lista de
    # empresas (Producto → Contrato dentro de cada una); ninguno de los dos →
    # vista Nacional agregada por producto → grupo, como al entrar sin filtro.
    grupo_unico = len(grupos_sel) == 1 or len(empresas_sel) > 0
    groups = _hierarchia_empresa_operador(df, categories) if grupo_unico else (
        [{"cuenca": "Nacional", "subgroups": [{"ubicacion": "Nacional", "rows": _filas_nacional_por_producto(df, categories)}]}]
    )
    # Serie de cabecera (chips/gráfica): un producto por serie, igual que
    # "Producción por ubicación" — así el usuario elige qué producto ver desde
    # las chips en vez de un filtro aparte.
    series = [
        {
            "name": label,
            "data": [round(float(v), 2) for v in df.groupby("periodo")[col].sum().reindex(categories, fill_value=0)],
            "type": "bar",
        }
        for col, label in PRODUCTOS_EMPRESA
        if df[col].sum() != 0
    ]
    total = float(df[df["periodo"] == categories[-1]]["liquidos_mbd"].sum())
    kpis = {
        "total": round(total),
        "anio_top": int(df.groupby(df["periodo"].str[:4])["liquidos_mbd"].sum().idxmax()),
        "operador_top": df.groupby("empresa")["liquidos_mbd"].sum().idxmax(),
        "unidad": "Mbd",
    }
    empresas = _empresas_series_por_producto(df, categories)
    return {"type": "hierarchical", "categories": categories, "groups": groups, "series": series, "kpis": kpis, "empresas": empresas}


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
               SUM({_ISNULL}(PETROLEO_MBD,0)+{_ISNULL}(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD,
               SUM(PETROLEO_MBD)      AS PETROLEO_MBD,
               SUM(CONDENSADO_MBD)    AS CONDENSADO_MBD,
               SUM(GAS_MMPCD)         AS GAS_MMPCD,
               SUM(GAS_ASOC_MMPCD)    AS GAS_ASOC_MMPCD,
               SUM(GAS_NASOC_MMPCD)   AS GAS_NASOC_MMPCD,
               SUM(AGUA_MBD)          AS AGUA_MBD,
               SUM(N2_MMPCD)          AS N2_MMPCD
        FROM {_TABLA_PRODUCCION_CAMPOS}
        WHERE {_FILTRO_ID_WHERE}
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
    """Último mes disponible de producción nacional total (líquidos y gas
    natural) vs. el promedio mensual del año calendario anterior, para el
    Panorama general. Incluye TIPO='ASIGNACION' (PEMEX) y TIPO='CONTRATO'
    (privados) — sin filtrar por TIPO se cuenta toda la producción nacional,
    no solo la de PEMEX."""
    # Solo se necesitan ~2 años (último mes + promedio del año calendario previo);
    # sin este filtro la query agregaba el histórico completo de la tabla.
    sql = f"""
        SELECT FECHA,
               SUM({_ISNULL}(PETROLEO_MBD,0)+{_ISNULL}(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD,
               SUM({_ISNULL}(GAS_MMPCD,0)) AS GAS_MMPCD
        FROM {_TABLA_PRODUCCION_CAMPOS}
        WHERE {_FILTRO_ID_WHERE}
          AND FECHA >= {_dateadd_ago(2, "year")}
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

    # Serie mensual (ene-dic) del año en curso y del año de referencia, para
    # la gráfica de línea "año actual vs año anterior" del reporte PDF del
    # home (estilo CNH). None en los meses sin dato.
    def _serie_mensual(anio: int, columna: str) -> list:
        sub = df[df["fecha"].dt.year == anio].set_index(df[df["fecha"].dt.year == anio]["fecha"].dt.month)[columna]
        return [round(float(sub[m])) if m in sub.index else None for m in range(1, 13)]

    return {
        "periodo": last["fecha"].strftime("%Y-%m"),
        "liquidos": {
            "valor": round(float(last["liquidos_mbd"])),
            "promedio": round(liquidos_prom) if liquidos_prom else None,
            "anio_promedio": anio_ref,
            "serie_actual": _serie_mensual(last["fecha"].year, "liquidos_mbd"),
            "serie_anterior": _serie_mensual(anio_ref, "liquidos_mbd"),
            "anio_actual": int(last["fecha"].year),
        },
        "gas": {
            "valor": round(float(last["gas_mmpcd"])),
            "promedio": round(gas_prom) if gas_prom else None,
            "anio_promedio": anio_ref,
            "serie_actual": _serie_mensual(last["fecha"].year, "gas_mmpcd"),
            "serie_anterior": _serie_mensual(anio_ref, "gas_mmpcd"),
            "anio_actual": int(last["fecha"].year),
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
               SUM({_ISNULL}(PETROLEO_MBD,0)+{_ISNULL}(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD,
               SUM({_ISNULL}(GAS_MMPCD,0)) AS GAS_MMPCD
        FROM {_TABLA_PRODUCCION_CAMPOS}
        WHERE {_FILTRO_ID_WHERE}
          AND TIPO = 'ASIGNACION'
          AND FECHA >= {_dateadd_ago(12, "month")}
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
        return "Asociaciones"
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
               SUM({_ISNULL}(PETROLEO_MBD,0)+{_ISNULL}(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD,
               SUM({_ISNULL}(GAS_MMPCD,0)) AS GAS_MMPCD
        FROM {_TABLA_PRODUCCION_CAMPOS}
        WHERE {_FILTRO_ID_WHERE}
          AND FECHA >= {_dateadd_ago(12, "month")}
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
               SUM({_ISNULL}(POZOS_ACEITE,0)) AS POZOS_ACEITE,
               SUM({_ISNULL}(POZOS_GAS,0))    AS POZOS_GAS
        FROM {_TABLA_PRODUCCION_CAMPOS_POZOS}
        WHERE UBICACION IS NOT NULL
          AND FECHA >= {_dateadd_ago(12, "month")}
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
               SUM({_ISNULL}(PETROLEO_MBD,0)+{_ISNULL}(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD,
               SUM(PETROLEO_MBD)      AS PETROLEO_MBD,
               SUM(CONDENSADO_MBD)    AS CONDENSADO_MBD,
               SUM(GAS_MMPCD)         AS GAS_MMPCD,
               SUM(GAS_ASOC_MMPCD)    AS GAS_ASOC_MMPCD,
               SUM(GAS_NASOC_MMPCD)   AS GAS_NASOC_MMPCD,
               SUM(AGUA_MBD)          AS AGUA_MBD,
               SUM(N2_MMPCD)          AS N2_MMPCD
        FROM {_TABLA_PRODUCCION_CAMPOS}
        WHERE {_FILTRO_ID_WHERE}
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


def _make_row(label, row_type, categories, series_by_periodo, decimals=2, code=None):
    data = []
    for p in categories:
        val = float(series_by_periodo.loc[p]) if p in series_by_periodo.index else 0.0
        data.append(round(val, decimals))
    row = {"label": label, "type": row_type, "data": data}
    # "code" solo se manda cuando el label mostrado NO es el identificador real
    # (p. ej. Asignaciones: label = BLOCK_NAME, code = ASIG_CONT) — el
    # frontend lo necesita para pedir el detalle de esa fila al hacer clic.
    if code is not None and code != label:
        row["code"] = code
    return row


def get_produccion_operadores(
    engine: Engine, start_year: int, end_year: int, start_month: int, end_month: int,
    period: str, factor_col: str = "FACTOR_O", years: str = "",
) -> dict:
    """Producción ponderada por FACTOR_O (operador) o FACTOR_IP (interés de
    participación) — misma tabla y patrón, solo cambia la columna de peso.
    Top 10 empresas por PCE (petróleo crudo equivalente = líquidos + gas/5)."""
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    sql = f"""
        SELECT FECHA, {_COL_EMPRESA} AS EMPRESA,
               SUM({_ISNULL}(PETROLEO_MBD,0)*{factor_col}+{_ISNULL}(CONDENSADO_MBD,0)*{factor_col}) AS LIQUIDOS_MBD,
               SUM({_ISNULL}(GAS_MMPCD,0)*{factor_col}) AS GAS_MMPCD
        FROM {_TABLA_PRODUCCION_OPERADOR_IP}
        WHERE {where_fecha}
        GROUP BY FECHA, {_COL_EMPRESA}
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
    engine: Engine, start_year: int, end_year: int, start_month: int, end_month: int, period: str,
    cuencas: str = "", ubicaciones: str = "", years: str = "",
) -> dict:
    """Sin filtro: Nacional → Producto (subtotal) → Cuenca (hoja), TIPO='ASIGNACION'.
    Filtrado por Ambiente/Cuenca: drill-down Ambiente → Cuenca → Producto → Asignación."""
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    if not cuencas and not ubicaciones:
        df = _cargar_df_producto_entidad(engine, "PRODUCCION_CAMPOS", "CUENCA", where_fecha, extra_where=f"{_FILTRO_ID}TIPO = 'ASIGNACION' AND ")
        if df.empty:
            return {"type": "hierarchical", "categories": [], "groups": []}
        df = _preparar_df_producto_entidad(df, "cuenca", period)
        categories = sorted(df["periodo"].unique().tolist())
        resp = _respuesta_producto_entidad(df, "cuenca", categories)
        resp["asignaciones"] = _asignaciones_series(engine, where_fecha, period, categories)
        return resp

    df = _cargar_df_producto_entidad_multi(engine, "PRODUCCION_CAMPOS", ["CUENCA", "UBICACION", "ASIG_CONT"], where_fecha, extra_where=f"{_FILTRO_ID}TIPO = 'ASIGNACION' AND ")
    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}
    nombre_map = _mapa_asig_a_block_name(engine)
    # hoja_primero: Ubicación → Cuenca → ASIGNACIÓN → componente (pedido
    # explícito). El resto de los temas conserva Producto → hoja.
    resp = _drilldown_ambiente_cuenca_producto(df, "asig_cont", period, cuencas, ubicaciones, nombre_map,
                                               hoja_primero=True)
    resp["asignaciones"] = _asignaciones_series(engine, where_fecha, period, resp.get("categories") or [], nombre_map)
    return resp


def _series_por_entidad_extra(engine: Engine, entidad_sql: str, entidad_col: str, where_fecha: str,
                              period: str, categories: list, extra_where: str) -> list:
    """Series por producto de CADA entidad, en su propia consulta — para los
    temas cuya jerarquia se agrupa por otra cosa (cuenca, ambiente) y cuyo df
    de tabla ya no conserva la columna de la entidad. Misma tabla y mismo
    rango que la consulta principal, asi que el cache la absorbe."""
    if not categories:
        return []
    df = _cargar_df_producto_entidad(engine, "PRODUCCION_CAMPOS", entidad_sql, where_fecha, extra_where=extra_where)
    if df.empty:
        return []
    df = _preparar_df_producto_entidad(df, entidad_col, period)
    return _entidades_series_por_producto(df, entidad_col, categories)


def _asignaciones_series(engine: Engine, where_fecha: str, period: str, categories: list, nombre_map: dict | None = None) -> list:
    """Series por producto de CADA asignación — alimenta la "Gráfica individual"
    de "Producción por asignación" (elegir UNA asignación y ver todos sus
    productos), igual que resultado.contratos en "Producción por contrato".

    Va en su propia consulta porque la jerarquía del tema se agrupa por CUENCA
    (o por el drill-down de Ambiente→Cuenca), no por asignación: el df que arma
    la tabla ya no tiene la columna. La consulta es la misma tabla y el mismo
    rango, así que el caché la absorbe.
    """
    entidades = _series_por_entidad_extra(
        engine, "ASIG_CONT", "asig_cont", where_fecha, period, categories,
        extra_where=f"{_FILTRO_ID}TIPO = 'ASIGNACION' AND ",
    )
    if not entidades:
        return []
    # La tabla muestra el nombre del bloque, no el código: el selector tiene
    # que decir lo mismo.
    mapa = nombre_map if nombre_map is not None else _mapa_asig_a_block_name(engine)
    for e in entidades:
        e["nombre"] = mapa.get(e["nombre"], e["nombre"])
    return entidades


# Códigos que aparecen en PRODUCCION_CAMPOS con TIPO='ASIGNACION' pero no son
# bloques reales — placeholders/registros administrativos nuevos que aún no
# se han integrado al catálogo de entitlements (confirmado con el usuario:
# ADM-E-*, la fila literal "asignaciones" y ASIG_CONT nulo). Se excluyen del
# ranking analítico para no ensuciarlo con filas sin sentido de negocio.
_ASIGNACION_CODIGOS_RUIDO_PREFIJO = "ADM-E-"
_ASIGNACION_CODIGOS_RUIDO_EXACTO = {"asignaciones"}


def _mapa_asig_a_block_name(engine: Engine) -> dict:
    """ASIG_CONT (código, p. ej. 'A-0001') → BLOCK_NAME (nombre real del
    bloque) desde entitlements.v_general_info — para mostrar el nombre en vez
    del código en la tabla de Producción por Asignación. Best-effort: si la
    vista no está disponible (falta el linked server, p. ej. en desarrollo
    local), regresa un mapa vacío y el código original se sigue mostrando."""
    # En Postgres, entitlements.v_general_info depende de un linked server
    # externo (UATAC_SISEAA) sin resolver todavia (ver postgres_migration/00_PLAN.md,
    # "Plan para el linked server") -- se usa api.v_bloques como fuente
    # provisional (solo BLOCK_NAME, sin los atributos de SISEAA) en vez de
    # degradar siempre a mapa vacio.
    sql = (
        "SELECT block_id, block_name FROM api.v_bloques"
        if _PG else
        "SELECT BLOCK_ID, BLOCK_NAME FROM [cmde_public].[entitlements].[v_general_info]"
    )
    try:
        with engine.connect() as conn:
            meta = pd.read_sql(sqlalchemy_text(sql), conn)
        meta.columns = meta.columns.str.lower()
        mapa = dict(zip(meta["block_id"], meta["block_name"]))
    except Exception:
        mapa = {}
    # El BLOCK_ID del catalogo no siempre es el ASIG_CONT que usa produccion:
    # las asignaciones administrativas estan catalogadas como "ADM-002" pero
    # produccion las reporta como "ADM-E-002", asi que no cruzaban y salian
    # como codigo pelado. El propio BLOCK_NAME empieza con el codigo bueno
    # ("ADM-E-002 - Cuervito-Fronterizo-Topo"), asi que se indexa tambien por
    # ese prefijo. Es general: sirve para cualquier codigo que el catalogo
    # escriba distinto, no solo las ADM.
    for nombre in list(mapa.values()):
        cod, sep, _ = str(nombre or "").partition(" - ")
        if sep and cod and cod not in mapa:
            mapa[cod] = nombre
    # Ultimo recurso para lo que no este en el catalogo de ninguna forma.
    mapa.update(_nombres_asig_sin_catalogo(engine, ya_nombrados=set(mapa)))
    return mapa


def _nombres_asig_sin_catalogo(engine: Engine, ya_nombrados: set) -> dict:
    """Nombre de emergencia para los codigos que NO estan en el catalogo.

    Se etiquetan con su campo de mayor produccion ("A-9999 - AGUA FRIA"), que
    es como los identifica quien los opera. Un codigo pelado no le dice nada a
    nadie; con el campo principal al menos se ubica.

    Es el ultimo recurso: si el catalogo tiene el nombre oficial, ese gana
    siempre (ver _mapa_asig_a_block_name).
    """
    sql = f"""
        SELECT ASIG_CONT AS codigo, CAMPO_PORTAL AS campo,
               SUM({_ISNULL}(PETROLEO_MBD,0) + {_ISNULL}(CONDENSADO_MBD,0)
                   + {_ISNULL}(GAS_MMPCD,0) / 5.0) AS pce
        FROM {_TABLA_PRODUCCION_CAMPOS}
        WHERE {_FILTRO_ID_WHERE} AND ASIG_CONT IS NOT NULL AND CAMPO_PORTAL IS NOT NULL
        GROUP BY ASIG_CONT, CAMPO_PORTAL
    """
    try:
        with engine.connect() as conn:
            df = pd.read_sql(sql, conn)
    except Exception:
        return {}
    if df.empty:
        return {}
    df.columns = df.columns.str.lower()
    df = df[~df["codigo"].isin(ya_nombrados)]
    if df.empty:
        return {}
    principal = df.sort_values("pce", ascending=False).groupby("codigo").first()
    return {cod: f"{cod} - {fila['campo']}" for cod, fila in principal.iterrows()}


@cached()
def get_asignaciones_ranking(
    engine: Engine, start_year: int, end_year: int, start_month: int, end_month: int, period: str,
    years: str = "",
) -> dict:
    """Ranking analítico de asignaciones: producción del último período del
    rango + atributos reales del bloque (plan, actividad, ambiente, cuenca,
    vigencia, área) desde [cmde_public].[entitlements].[v_general_info],
    unido por ASIG_CONT = BLOCK_ID — mismo patrón que get_pozos_ranking, pero
    a nivel asignación/bloque en vez de pozo individual (no hay aquí el
    histórico denso que permite estimar declinación como en Pozos)."""
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    sql = f"""
        SELECT FECHA, ASIG_CONT, CUENCA, UBICACION,
               SUM({_ISNULL}(PETROLEO_MBD,0)+{_ISNULL}(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD,
               SUM(GAS_MMPCD) AS GAS_MMPCD
        FROM {_TABLA_PRODUCCION_CAMPOS}
        WHERE {_FILTRO_ID_WHERE} AND TIPO = 'ASIGNACION' AND ASIG_CONT IS NOT NULL
          AND ASIG_CONT NOT LIKE '{_ASIGNACION_CODIGOS_RUIDO_PREFIJO}%'
          AND {where_fecha}
        GROUP BY FECHA, ASIG_CONT, CUENCA, UBICACION
    """
    with engine.connect() as conn:
        df = pd.read_sql(sqlalchemy_text(sql), conn)
    if df.empty:
        return {"periodo": None, "unidad": "Mbd", "asignaciones": []}

    df.columns = df.columns.str.lower()
    df = df[~df["asig_cont"].str.lower().isin(_ASIGNACION_CODIGOS_RUIDO_EXACTO)]
    if df.empty:
        return {"periodo": None, "unidad": "Mbd", "asignaciones": []}

    df["fecha"] = pd.to_datetime(df["fecha"])
    df["gas_mmpcd"] = df["gas_mmpcd"].fillna(0)
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly" else df["fecha"].dt.strftime("%Y")
    )
    rollup = _rollup_periodo(df, ["asig_cont", "cuenca", "ubicacion"], ["liquidos_mbd", "gas_mmpcd"])
    ultimo = sorted(rollup["periodo"].unique().tolist())[-1]
    actual = rollup[rollup["periodo"] == ultimo].copy()

    # Atributos del bloque — la vista vive detrás de un linked server que solo
    # existe en el servidor real; si no está disponible (p. ej. en desarrollo
    # local) se degrada con esas columnas vacías en vez de tronar el endpoint.
    meta_cols = ["block_name", "plan", "activity", "environment", "basin",
                 "validity", "start_date", "end_date", "area_km2"]
    # ACTIVITY/ENVIRONMENT/BASIN/AREA_KM2 dependen del linked server SISEAA,
    # sin resolver en Postgres todavia (ver nota en _mapa_asig_a_block_name) --
    # api.v_bloques solo trae BLOCK_NAME/PLAN/VALIDITY/START_DATE/END_DATE.
    sql_meta = (
        "SELECT block_id, block_name, plan, validity, start_date, end_date FROM api.v_bloques"
        if _PG else
        """
                SELECT BLOCK_ID, BLOCK_NAME, [PLAN], ACTIVITY, ENVIRONMENT, BASIN,
                       VALIDITY, START_DATE, END_DATE, AREA_KM2
                FROM [cmde_public].[entitlements].[v_general_info]
            """
    )
    try:
        with engine.connect() as conn:
            meta = pd.read_sql(sqlalchemy_text(sql_meta), conn)
        meta.columns = meta.columns.str.lower()
        for c in meta_cols:
            if c not in meta.columns:
                meta[c] = None
        actual = actual.merge(meta, left_on="asig_cont", right_on="block_id", how="left")
    except Exception:
        for c in meta_cols:
            actual[c] = None

    hoy = pd.Timestamp.now()
    actual["vigente"] = actual["end_date"].apply(lambda d: bool(pd.isna(d) or pd.Timestamp(d) >= hoy))
    actual["productividad_mbd_km2"] = actual.apply(
        lambda r: round(r["liquidos_mbd"] / r["area_km2"], 4) if r.get("area_km2") and r["area_km2"] > 0 else None,
        axis=1,
    )
    actual["start_date"] = actual["start_date"].apply(lambda d: d.isoformat() if pd.notna(d) else None)
    actual["end_date"] = actual["end_date"].apply(lambda d: d.isoformat() if pd.notna(d) else None)
    actual["liquidos_mbd"] = actual["liquidos_mbd"].round(2)
    actual["gas_mmpcd"] = actual["gas_mmpcd"].round(2)

    actual = actual.sort_values("liquidos_mbd", ascending=False).reset_index(drop=True)
    actual.insert(0, "ranking", actual.index + 1)

    cols = ["ranking", "asig_cont", "cuenca", "ubicacion", "liquidos_mbd", "gas_mmpcd",
            "block_name", "plan", "activity", "environment", "basin", "validity",
            "start_date", "end_date", "area_km2", "productividad_mbd_km2", "vigente"]
    for c in cols:
        if c not in actual.columns:
            actual[c] = None
    actual = actual.rename(columns={"asig_cont": "asignacion"})
    cols = ["asignacion" if c == "asig_cont" else c for c in cols]

    return {"periodo": ultimo, "unidad": "Mbd", "asignaciones": actual[cols].to_dict("records")}


def _norm_codigo_asig(s: str) -> str:
    """Normaliza un ASIG_CONT para comparar entre tablas: mayúsculas, sin
    acentos, solo alfanuméricos, y sin ceros a la izquierda en los grupos que
    siguen a una letra ("A06" y "A6" son el mismo contrato).

    El recorte de ceros se ancla a una letra a propósito: sin el ancla, "A105"
    se convertiría en "A15" y chocaría con el contrato "A15" real. Verificado
    sobre los 574 códigos de PRODUCCION_CAMPOS + bd_pozos: 0 colisiones.
    """
    s = unicodedata.normalize("NFKD", str(s).upper())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^A-Z0-9]", "", s)
    return re.sub(r"(?<=[A-Z])0+(\d)", r"\1", s)


@cached()
def _catalogo_asig_cont(engine: Engine) -> dict:
    """{código normalizado: código real} de todas las asignaciones y contratos
    conocidos. Los temas de Licitaciones/Inversiones escriben el código con
    otra grafía (acentos, punto vs guion, ceros a la izquierda), así que la
    ficha lo traduce primero al código canónico en vez de intentar empatarlo
    con SQL a fuerza de REPLACE."""
    sql_prod = f"SELECT DISTINCT ASIG_CONT AS C FROM {_TABLA_PRODUCCION_CAMPOS} WHERE ASIG_CONT IS NOT NULL"
    codigos = []
    with engine.connect() as conn:
        codigos += pd.read_sql(sql_prod, conn)["C"].dropna().tolist()
        # bd_pozos aporta los bloques que aún no producen (Trión y demás).
        try:
            from app.services.perforacion_service import _TABLA_BD_POZOS_CAMPO
            sql_cat = f"""
                SELECT DISTINCT BLOCK_ID_CURRENT AS C FROM {_TABLA_BD_POZOS_CAMPO} WHERE BLOCK_ID_CURRENT IS NOT NULL
                UNION SELECT DISTINCT BLOCK_ID_DRILLING FROM {_TABLA_BD_POZOS_CAMPO} WHERE BLOCK_ID_DRILLING IS NOT NULL
            """
            codigos += pd.read_sql(sql_cat, conn)["C"].dropna().tolist()
        except Exception:
            pass
    mapa = {}
    for c in sorted(set(codigos)):
        mapa.setdefault(_norm_codigo_asig(c), c)
    return mapa


def _resolver_asig_cont(engine: Engine, asignacion: str) -> str:
    """Devuelve el código canónico equivalente, o el original si no se
    reconoce (así la ficha sigue intentando y falla de forma visible)."""
    try:
        return _catalogo_asig_cont(engine).get(_norm_codigo_asig(asignacion), asignacion)
    except Exception:
        return asignacion


@cached()
def get_asignacion_detalle(
    engine: Engine, asignacion: str, start_year: int, end_year: int, start_month: int, end_month: int, period: str,
    years: str = "",
) -> dict:
    """Detalle de una asignación o contrato puntual para su ficha: operador,
    campos, pozos asociados, fecha de construcción (perforación más antigua
    entre sus pozos) y su serie propia de producción. `asignacion` es el
    código real (ASIG_CONT), no el BLOCK_NAME mostrado en pantalla.

    No se filtra por TIPO: ASIG_CONT identifica por sí solo a la entidad
    (verificado: ningún ASIG_CONT aparece con más de un TIPO), y acotar a
    'ASIGNACION' dejaba fuera a los contratos (CNH-…), que necesitan la misma
    ficha desde el tema "Producción por contrato".

    Si no hay datos en el rango elegido se cae al ÚLTIMO año con producción de
    esa asignación, marcándolo en "periodo_fuera_rango". Los temas de
    Licitaciones listan contratos independientemente de si producen hoy, así
    que abrir su ficha con el rango del tablero (2026) dejaba en blanco a 18
    contratos que sí tienen historia — es más útil enseñar su último dato que
    un "sin datos". Cuando de plano nunca ha producido (Trión y demás
    contratos en exploración) se devuelve sin_produccion para poder decirlo
    con precisión en vez de culpar al rango."""
    # Traduce el código a su grafía canónica: los temas de Licitaciones lo
    # escriben distinto (acentos, punto vs guion, "A06" vs "A6") y sin esto la
    # ficha salía vacía para contratos que sí tienen datos.
    asignacion = _resolver_asig_cont(engine, asignacion)
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    sql_base = f"""
        SELECT FECHA, CAMPO_PORTAL, OPERADOR, TIPO, CUENCA, UBICACION,
               PETROLEO_MBD, CONDENSADO_MBD, GAS_MMPCD, GAS_ASOC_MMPCD, GAS_NASOC_MMPCD, AGUA_MBD, N2_MMPCD
        FROM {_TABLA_PRODUCCION_CAMPOS}
        WHERE {_FILTRO_ID_WHERE}
          AND {_norm_texto_sql('ASIG_CONT')} = {_norm_texto_sql(':asig')}
    """
    with engine.connect() as conn:
        df = pd.read_sql(sqlalchemy_text(f"{sql_base} AND {where_fecha}"), conn, params={"asig": asignacion})

        periodo_fuera_rango = None
        if df.empty:
            ultimo = pd.read_sql(
                sqlalchemy_text(f"SELECT MAX({_YEAR_FECHA}) AS ANIO FROM ({sql_base}) t"),
                conn, params={"asig": asignacion},
            )
            anio = ultimo["ANIO"][0] if not ultimo.empty else None
            # anio nulo = nunca produjo: se sigue de largo con el df vacío y
            # abajo se arma la ficha sin bloque de producción.
            if anio is not None and not pd.isna(anio):
                periodo_fuera_rango = int(anio)
                period = "annually"
                df = pd.read_sql(
                    sqlalchemy_text(f"{sql_base} AND {_YEAR_FECHA} = :anio"),
                    conn, params={"asig": asignacion, "anio": periodo_fuera_rango},
                )

    # Sin producción NUNCA (contratos en exploración como Trión): no se corta
    # aquí. El resto de la ficha —bloque, plan, actividad, operador, campos—
    # no sale de PRODUCCION_CAMPOS, así que se puede armar igual; solo se queda
    # sin serie de producción y la pantalla omite ese bloque.
    sin_produccion = df.empty

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    cols_prod = ["petroleo_mbd", "condensado_mbd", "gas_mmpcd", "gas_asoc_mmpcd", "gas_nasoc_mmpcd", "agua_mbd", "n2_mmpcd"]
    df[cols_prod] = df[cols_prod].fillna(0)
    df["liquidos_mbd"] = df["petroleo_mbd"] + df["condensado_mbd"]
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly" else df["fecha"].dt.strftime("%Y")
    )

    campos = sorted(df["campo_portal"].dropna().unique().tolist())
    operadores = df["operador"].dropna().value_counts()
    operador = operadores.index[0] if not operadores.empty else None
    tipos = df["tipo"].dropna().unique().tolist()
    tipo = tipos[0] if tipos else None
    # Cuenca(s)/ambiente(s) donde produce: la ficha los usa para abrir el
    # Explorador ya filtrado, que es lo que hace que la tabla muestre el
    # desglose por asignación en vez del agregado por cuenca.
    cuencas_asig = sorted(df["cuenca"].dropna().unique().tolist())
    ubicaciones_asig = sorted(df["ubicacion"].dropna().unique().tolist())

    if sin_produccion:
        # Operador, campos y tipo salen del catálogo de pozos, que sí conoce
        # los bloques sin producción (guarda el contrato en BLOCK_ID_*).
        # Best-effort: si falla, la ficha se queda con los datos del bloque.
        try:
            from app.services.perforacion_service import _TABLA_BD_POZOS_CAMPO
            sql_cat = f"""
                SELECT DISTINCT OPERATOR, FIELD, ENVIRONMENT, PETROLEUM_PROVINCE
                FROM {_TABLA_BD_POZOS_CAMPO}
                WHERE BLOCK_ID_DRILLING = :asig OR BLOCK_ID_COMPLETION = :asig
                   OR BLOCK_ID_CURRENT = :asig
            """
            with engine.connect() as conn:
                cat = pd.read_sql(sqlalchemy_text(sql_cat), conn, params={"asig": asignacion})
            if not cat.empty:
                cat.columns = cat.columns.str.lower()
                campos = sorted(cat["field"].dropna().unique().tolist())
                ops = cat["operator"].dropna().value_counts()
                operador = ops.index[0] if not ops.empty else None
                cuencas_asig = sorted(cat["petroleum_province"].dropna().unique().tolist())
                ubicaciones_asig = sorted(cat["environment"].dropna().unique().tolist())
        except Exception:
            pass
        # TIPO vive en PRODUCCION_CAMPOS, que aquí no tiene filas: se deduce
        # del código (los contratos son los "CNH-…"), solo para saber a qué
        # tema del Explorador mandar.
        if tipo is None:
            tipo = "CONTRATO" if str(asignacion).upper().startswith("CNH-") else "ASIGNACION"

    cols_serie = ["liquidos_mbd", "petroleo_mbd", "condensado_mbd", "gas_mmpcd", "gas_asoc_mmpcd", "gas_nasoc_mmpcd", "agua_mbd", "n2_mmpcd"]
    rollup = _rollup_periodo(df, [], cols_serie).sort_values("periodo")
    categories = rollup["periodo"].tolist()
    etiquetas = {
        "liquidos_mbd": "Hidrocarburos líquidos (Mbd)", "petroleo_mbd": "Petróleo (Mbd)",
        "condensado_mbd": "Condensado (Mbd)", "gas_mmpcd": "Gas (MMpcd)",
        "gas_asoc_mmpcd": "Gas asociado (MMpcd)", "gas_nasoc_mmpcd": "Gas no asociado (MMpcd)",
        "agua_mbd": "Agua (Mbd)", "n2_mmpcd": "Nitrógeno (MMpcd)",
    }
    serie = [
        {"label": etiquetas[col], "data": [round(float(v), 2) for v in rollup[col]]}
        for col in cols_serie if rollup[col].any()
    ]

    # Pozos asociados + fecha de construcción (perforación más antigua) vía
    # PRODUCCION_POZOS/BD_POZOS — import local para evitar import circular
    # (pozos_service ya importa de este módulo).
    pozos, fecha_construccion = [], None
    try:
        from app.services import pozos_service
        source = pozos_service._source_table()
        # PRODUCCION_POZOS.ASIG_CONT se escribe distinto según el tipo:
        #   - Asignaciones: no es el código puro ("A-0001") sino
        #     "A-0001-5M - CAMPO ABKATUN" (código+sufijo+nombre de campo) — el
        #     código es su prefijo exacto seguido de un guion, de ahí el LIKE.
        #   - Contratos: "CNH-R01-L02-A1/2015" tal cual, idéntico al de
        #     PRODUCCION_CAMPOS — con solo el LIKE salían 0 pozos.
        # Se aceptan las dos formas.
        #   - Y la tercera forma, normalizada: el mismo contrato se escribe con
        #     y sin acento entre tablas ("CNH-A3.CARDENAS-MORA/2018" en
        #     PRODUCCION_POZOS vs "CNH-A3.CÁRDENAS-MORA/2018" en
        #     PRODUCCION_CAMPOS), y comparando exacto salían 0 pozos. Se suma
        #     como OR para no alterar lo que ya empataba.
        sql_pozos = (
            f"SELECT DISTINCT ASIG_CONT, WELL_ID, WELL_NAME FROM {source} "
            "WHERE ASIG_CONT = :asig OR ASIG_CONT LIKE :asig_prefix "
            f"OR {_norm_texto_sql('ASIG_CONT')} = {_norm_texto_sql(':asig')}"
        )
        with engine.connect() as conn:
            df_pozos = pd.read_sql(
                sqlalchemy_text(sql_pozos), conn,
                params={"asig": asignacion, "asig_prefix": f"{asignacion}-%"},
            )
        df_pozos.columns = df_pozos.columns.str.lower()
        df_pozos = df_pozos.dropna(subset=["well_name"]).drop_duplicates("well_name").sort_values("well_name")
        pozos = [
            {"pozo": r["well_name"], "campo": r["asig_cont"]}
            for r in df_pozos[["well_name", "asig_cont"]].to_dict("records")
        ]
        well_ids = [int(w) for w in df_pozos["well_id"].dropna().unique().tolist()]
        if well_ids:
            meta = pozos_service._meta_bd_pozos(engine, well_ids)
            if not meta.empty and meta["fecha_perforacion"].notna().any():
                minimo = meta["fecha_perforacion"].min()
                fecha_construccion = minimo.isoformat() if pd.notna(minimo) else None
    except Exception:
        pass

    # PRODUCCION_POZOS solo conoce pozos que YA produjeron: un bloque en
    # exploración (Trión) sale con 0 aunque tenga pozos perforados. El catálogo
    # sí los tiene, ligados al contrato por BLOCK_ID_*, junto con su fecha de
    # perforación — de ahí salen los pozos asociados y la fecha de construcción
    # cuando la vía normal viene vacía.
    if not pozos:
        try:
            from app.services.perforacion_service import _TABLA_BD_POZOS_CAMPO
            sql_cat_pozos = f"""
                SELECT WELL_NAME, DRILLING_START_DATE
                FROM {_TABLA_BD_POZOS_CAMPO}
                WHERE BLOCK_ID_DRILLING = :asig OR BLOCK_ID_COMPLETION = :asig
                   OR BLOCK_ID_CURRENT = :asig
            """
            with engine.connect() as conn:
                cat_pozos = pd.read_sql(sqlalchemy_text(sql_cat_pozos), conn, params={"asig": asignacion})
            if not cat_pozos.empty:
                cat_pozos.columns = cat_pozos.columns.str.lower()
                cat_pozos = (
                    cat_pozos.dropna(subset=["well_name"])
                             .drop_duplicates("well_name").sort_values("well_name")
                )
                pozos = [{"pozo": r["well_name"], "campo": asignacion} for r in cat_pozos.to_dict("records")]
                if fecha_construccion is None:
                    fechas = pd.to_datetime(cat_pozos["drilling_start_date"], errors="coerce").dropna()
                    if not fechas.empty:
                        fecha_construccion = fechas.min().isoformat()
        except Exception:
            pass

    # Atributos del bloque (plan/actividad/ambiente/cuenca) — mismo
    # best-effort que el ranking, degrada sin tronar si no hay linked server.
    block_name = plan = activity = None
    # ACTIVITY depende del linked server SISEAA (ver nota en _mapa_asig_a_block_name)
    sql_meta_bloque = (
        "SELECT block_name, plan FROM api.v_bloques WHERE block_id = :asig"
        if _PG else
        """
                SELECT BLOCK_NAME, [PLAN], ACTIVITY
                FROM [cmde_public].[entitlements].[v_general_info]
                WHERE BLOCK_ID = :asig
            """
    )
    try:
        with engine.connect() as conn:
            meta_bloque = pd.read_sql(sqlalchemy_text(sql_meta_bloque), conn, params={"asig": asignacion})
        meta_bloque.columns = meta_bloque.columns.str.lower()
        if not meta_bloque.empty:
            r = meta_bloque.iloc[0]
            block_name, plan = r["block_name"], r["plan"]
            activity = r["activity"] if "activity" in meta_bloque.columns else None
    except Exception:
        pass

    return {
        "disponible": True,
        "asignacion": asignacion,
        # Año al que corresponden los datos cuando el rango elegido venía vacío
        # (None si los datos sí son del rango pedido) — la ficha lo advierte.
        "periodo_fuera_rango": periodo_fuera_rango,
        # True cuando la asignación/contrato no tiene producción en ningún año:
        # la ficha se muestra igual, solo sin el bloque de producción.
        "sin_produccion": sin_produccion,
        # ASIGNACION | CONTRATO: la ficha lo usa para mandar al tema correcto
        # del Explorador ("Producción por asignacion" vs "por contrato").
        "tipo": tipo,
        "cuencas": cuencas_asig,
        "ubicaciones": ubicaciones_asig,
        "block_name": block_name,
        "plan": plan,
        "activity": activity,
        "operador": operador,
        "campos": campos,
        "pozos_asociados": pozos,
        "num_pozos": len(pozos),
        "fecha_construccion": fecha_construccion,
        "categories": categories,
        "series": serie,
    }


def get_campo_detalle(
    engine: Engine, campo: str, start_year: int, end_year: int, start_month: int, end_month: int, period: str,
    years: str = "",
) -> dict:
    """Detalle de un campo para el panel flotante de la tabla de "Pozos
    operando por campo"/"Campos": atributos geológicos/de yacimiento
    ([cmde_public].[entitlements].[fields] — solo SQL Server, no espejada a
    Postgres, degrada a lista vacía si no está disponible), asignaciones que
    operan el campo y su propia serie de producción. Mismo patrón que
    get_asignacion_detalle."""
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    sql = f"""
        SELECT FECHA, ASIG_CONT, OPERADOR,
               PETROLEO_MBD, CONDENSADO_MBD, GAS_MMPCD, GAS_ASOC_MMPCD, GAS_NASOC_MMPCD, AGUA_MBD, N2_MMPCD
        FROM {_TABLA_PRODUCCION_CAMPOS}
        WHERE {_FILTRO_ID_WHERE}
          AND {_norm_texto_sql('CAMPO_PORTAL')} = {_norm_texto_sql(':campo')}
          AND {where_fecha}
    """
    with engine.connect() as conn:
        df = pd.read_sql(sqlalchemy_text(sql), conn, params={"campo": campo})
    if df.empty:
        return {"disponible": False}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    cols_prod = ["petroleo_mbd", "condensado_mbd", "gas_mmpcd", "gas_asoc_mmpcd", "gas_nasoc_mmpcd", "agua_mbd", "n2_mmpcd"]
    df[cols_prod] = df[cols_prod].fillna(0)
    df["liquidos_mbd"] = df["petroleo_mbd"] + df["condensado_mbd"]
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly" else df["fecha"].dt.strftime("%Y")
    )

    cols_serie = ["liquidos_mbd", "petroleo_mbd", "condensado_mbd", "gas_mmpcd", "gas_asoc_mmpcd", "gas_nasoc_mmpcd", "agua_mbd", "n2_mmpcd"]
    rollup = _rollup_periodo(df, [], cols_serie).sort_values("periodo")
    categories = rollup["periodo"].tolist()
    etiquetas = {
        "liquidos_mbd": "Hidrocarburos líquidos (Mbd)", "petroleo_mbd": "Petróleo (Mbd)",
        "condensado_mbd": "Condensado (Mbd)", "gas_mmpcd": "Gas (MMpcd)",
        "gas_asoc_mmpcd": "Gas asociado (MMpcd)", "gas_nasoc_mmpcd": "Gas no asociado (MMpcd)",
        "agua_mbd": "Agua (Mbd)", "n2_mmpcd": "Nitrógeno (MMpcd)",
    }
    serie = [
        {"label": etiquetas[col], "data": [round(float(v), 2) for v in rollup[col]]}
        for col in cols_serie if rollup[col].any()
    ]

    # Asignaciones que operan el campo (código + operador + nombre real del
    # bloque, reusando el mapa de _mapa_asig_a_block_name).
    asignaciones_df = df[df["asig_cont"].notna()][["asig_cont", "operador"]].drop_duplicates().sort_values("asig_cont")
    mapa_block_name = _mapa_asig_a_block_name(engine)
    asignaciones = [
        {"asignacion": r["asig_cont"], "block_name": mapa_block_name.get(r["asig_cont"]), "operador": r["operador"]}
        for r in asignaciones_df.to_dict("records")
    ]

    # Atributos geológicos/de yacimiento (play, año de descubrimiento,
    # profundidad). Viven SOLO en [cmde_public].[entitlements].[fields] de SQL
    # Server: no están replicados a Postgres (core.dim_campo únicamente tiene
    # región/lat/long), así que se consultan siempre contra SQL Server aunque
    # el motor principal sea Postgres — ver get_engine_catalogo_sqlserver.
    # Best-effort: si no hay ruta al SQL Server se degrada a lista vacía y la
    # ficha muestra "—", en vez de tumbar todo el detalle del campo.
    #
    # FIELD guarda el nombre "bonito" del campo (mayúsculas/minúsculas y
    # acentos, p.ej. "Abkatún"), mientras que CAMPO_PORTAL (de donde viene
    # `campo` aquí) es mayúsculas sin acentos ("ABKATUN") — un match exacto
    # nunca empataba y esto salía vacío. COLLATE Latin1_General_CI_AI ignora
    # mayúsculas/acentos, y REPLACE(..., ' ', '') los espacios, que es lo que
    # distingue "TUPILCOPROFUNDO" de "Tupilco Profundo".
    atributos = []
    try:
        from app.database import get_engine_catalogo_sqlserver
        sql_fields = f"""
            SELECT BLOCK_ID, DISCOVERY_YEAR, AVERAGE_DEPTH_M, WATER_DEPTH_M, PLAY, TYPE,
                   WELL_NAME, HYDROCARBON
            FROM [cmde_public].[entitlements].[fields]
            WHERE {_norm_texto_sql('FIELD')} = {_norm_texto_sql(':campo')}
        """
        with get_engine_catalogo_sqlserver().connect() as conn:
            fields_df = pd.read_sql(sqlalchemy_text(sql_fields), conn, params={"campo": campo})
        fields_df.columns = fields_df.columns.str.lower()
        # Un mismo campo puede tener VARIAS filas, una por bloque (Arcabuz está
        # en A-0022 y en CNH-M3-MISIÓN/2018). La carga de 2022 del catálogo dejó
        # las columnas geológicas vacías en casi todas sus filas, así que la fila
        # que llega primero (la query no tiene ORDER BY) puede venir sin año de
        # descubrimiento ni profundidad aunque otra fila del MISMO campo sí los
        # traiga — y la ficha, que muestra atributos[0], los enseñaba vacíos.
        # Como esos atributos son del CAMPO y no del bloque, se combinan: la fila
        # más completa va primero y sus huecos se rellenan con lo que sí traigan
        # las demás. BLOCK_ID no se toca, ese sí es propio de cada fila.
        _ATRIB_CAMPO = [
            "discovery_year", "average_depth_m", "water_depth_m",
            "play", "type", "well_name", "hydrocarbon",
        ]
        if len(fields_df) > 1:
            orden = fields_df[_ATRIB_CAMPO].notna().sum(axis=1).sort_values(ascending=False).index
            fields_df = fields_df.loc[orden]
            for _c in _ATRIB_CAMPO:
                _no_nulos = fields_df[_c].dropna()
                if not _no_nulos.empty:
                    fields_df[_c] = fields_df[_c].fillna(_no_nulos.iloc[0])
        atributos = [
            {
                "bloque": r["block_id"],
                "anio_descubrimiento": int(r["discovery_year"]) if pd.notna(r["discovery_year"]) else None,
                "profundidad_promedio_m": round(float(r["average_depth_m"]), 1) if pd.notna(r["average_depth_m"]) else None,
                "profundidad_agua_m": round(float(r["water_depth_m"]), 1) if pd.notna(r["water_depth_m"]) else None,
                "play": r["play"],
                "tipo": r["type"],
                # WELL_NAME en entitlements.fields es el POZO DESCUBRIDOR del
                # campo (viene poblado justo cuando hay DISCOVERY_YEAR:
                # Samaria-1/1957, Amoca-1/2003), no la lista de pozos del campo.
                "pozo_descubridor": r["well_name"],
                "hidrocarburo": r["hydrocarbon"],
            }
            for r in fields_df.to_dict("records")
        ]
    except Exception:
        atributos = []

    # Reservas 1P/2P/3P del campo — best-effort: si la consulta falla (o el
    # campo no está en RESERVAS_CAMPOS) la ficha simplemente no pinta el
    # bloque, en vez de tumbar todo el detalle.
    try:
        from app.services.reservas_service import get_reservas_de_campo
        reservas = get_reservas_de_campo(engine, campo, start_year, end_year)
    except Exception:
        reservas = None

    return {
        "disponible": True,
        "campo": campo,
        "atributos": atributos,
        "asignaciones": asignaciones,
        "reservas": reservas,
        "categories": categories,
        "series": serie,
    }


def _norm_texto_sql(expr: str) -> str:
    """Compara nombres ignorando mayúsculas, acentos, espacios y guiones.

    El mismo nombre llega escrito distinto según de qué tabla venga:
      - Operador: "PEMEX EXPLORACIÓN Y PRODUCCIÓN" en PRODUCCION_CAMPOS vs
        "Pemex Exploración y Producción" en BD_POZOS (get_pozo_analisis).
      - Campo: "AYATSIL"/"TUPILCOPROFUNDO" en PRODUCCION_CAMPOS.CAMPO_PORTAL
        vs "Ayatsil"/"Tupilco Profundo" en RESERVAS_CAMPOS.
      - Campo compuesto: "TAMAULIPAS CONSTITUCIONES" en CAMPO_PORTAL vs
        "Tamaulipas-Constituciones" en bd_pozos.FIELD (idem "Cuichapa-Poniente",
        "Jujo-Tecominoacán"…).
      - Contrato: "CNH-A3.CÁRDENAS-MORA/2018" en PRODUCCION_CAMPOS vs
        "CNH-A3-CÁRDENAS-MORA/2018" (guion en vez de punto) en las tablas de
        licitaciones, y "CNH-M1-Ek-Balam/2017" vs "CNH-M1-EK-BALAM/2017".
    Sin normalizar, abrir la ficha desde una vista que use la otra grafía no
    encuentra nada. Se quitan también espacios y guiones porque es justo lo que
    distingue a "TUPILCOPROFUNDO" de "Tupilco Profundo" y a "TAMAULIPAS
    CONSTITUCIONES" de "Tamaulipas-Constituciones" (quitarlos en AMBOS lados
    mantiene la comparación válida).
    Debe mantenerse equivalente a _norm_py() en perforacion_service.py, que
    hace la misma normalización del lado de pandas.
    En SQL Server los acentos/mayúsculas los resuelve la collation CI_AI; en
    Postgres se hace con TRANSLATE (unaccent es una extensión que puede no
    estar instalada).
    """
    limpio = f"REPLACE(REPLACE(REPLACE({expr}, ' ', ''), '-', ''), '.', '')"
    if _PG:
        return f"UPPER(TRANSLATE({limpio}, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'))"
    return f"{limpio} COLLATE Latin1_General_CI_AI"


def _sin_razon_social(operador: str) -> str:
    """Quita el sufijo de razón social del nombre de un operador.

    PRODUCCION_CAMPOS.OPERADOR usa el nombre corto ("ENI MÉXICO", "DS SERVICIOS
    PETROLEROS"), mientras que las tablas de perforación (bd_pozos.OPERATOR, vía
    PERFORACION_POZOS_TERM/PERF) traen la razón social completa ("Eni México, S.
    de R.L. de C.V."). Abrir la ficha de un operador desde Pozos terminados no
    encontraba nada por esa diferencia.

    El sufijo siempre va tras la primera coma (", S.A. de C.V.", ", S. de R.L.
    de C.V.", ", S.A.P.I. de C.V."), y ningún nombre corto de PRODUCCION_CAMPOS
    contiene comas — verificado sobre los 31 operadores de la tabla — así que
    cortar en la primera coma es seguro y no rompe los que ya empataban.
    """
    return operador.split(",")[0].strip() if operador else operador


def get_operador_detalle(
    engine: Engine, operador: str, start_year: int, end_year: int, start_month: int, end_month: int,
    period: str, years: str = "",
) -> dict:
    """Detalle de un operador para su ficha: asignaciones/contratos que opera,
    campos en los que produce y su serie de producción agregada. Mismo patrón
    que get_campo_detalle / get_asignacion_detalle."""
    operador = _sin_razon_social(operador)
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    sql = f"""
        SELECT FECHA, ASIG_CONT, CAMPO_PORTAL, OPERADOR,
               PETROLEO_MBD, CONDENSADO_MBD, GAS_MMPCD, GAS_ASOC_MMPCD, GAS_NASOC_MMPCD, AGUA_MBD, N2_MMPCD
        FROM {_TABLA_PRODUCCION_CAMPOS}
        WHERE {_FILTRO_ID_WHERE}
          AND {_norm_texto_sql('OPERADOR')} = {_norm_texto_sql(':operador')}
          AND {where_fecha}
    """
    with engine.connect() as conn:
        df = pd.read_sql(sqlalchemy_text(sql), conn, params={"operador": operador})
    if df.empty:
        return {"disponible": False}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    cols_prod = ["petroleo_mbd", "condensado_mbd", "gas_mmpcd", "gas_asoc_mmpcd", "gas_nasoc_mmpcd", "agua_mbd", "n2_mmpcd"]
    df[cols_prod] = df[cols_prod].fillna(0)
    df["liquidos_mbd"] = df["petroleo_mbd"] + df["condensado_mbd"]
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly" else df["fecha"].dt.strftime("%Y")
    )

    cols_serie = ["liquidos_mbd", "petroleo_mbd", "condensado_mbd", "gas_mmpcd", "gas_asoc_mmpcd", "gas_nasoc_mmpcd", "agua_mbd", "n2_mmpcd"]
    rollup = _rollup_periodo(df, [], cols_serie).sort_values("periodo")
    categories = rollup["periodo"].tolist()
    etiquetas = {
        "liquidos_mbd": "Hidrocarburos líquidos (Mbd)", "petroleo_mbd": "Petróleo (Mbd)",
        "condensado_mbd": "Condensado (Mbd)", "gas_mmpcd": "Gas (MMpcd)",
        "gas_asoc_mmpcd": "Gas asociado (MMpcd)", "gas_nasoc_mmpcd": "Gas no asociado (MMpcd)",
        "agua_mbd": "Agua (Mbd)", "n2_mmpcd": "Nitrógeno (MMpcd)",
    }
    serie = [
        {"label": etiquetas[col], "data": [round(float(v), 2) for v in rollup[col]]}
        for col in cols_serie if rollup[col].any()
    ]

    # Nombre canónico tal como está en la base (el que llega por parámetro
    # puede venir con otra capitalización desde BD_POZOS).
    nombre = df["operador"].dropna().iloc[0] if df["operador"].notna().any() else operador

    mapa_block_name = _mapa_asig_a_block_name(engine)
    asignaciones = [
        {"asignacion": a, "block_name": mapa_block_name.get(a)}
        for a in sorted(df["asig_cont"].dropna().unique().tolist())
    ]
    campos = sorted(df["campo_portal"].dropna().unique().tolist())

    return {
        "disponible": True,
        "operador": nombre,
        "asignaciones": asignaciones,
        "campos": campos,
        "categories": categories,
        "series": serie,
    }


def _hierarchia_cuenca_ubicacion(df, campo_col, categories, orden=None, subtotal_label=None):
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
            # Igual que en Gcompo: con filtros la tabla usa el constructor
            # multinivel, que solo conserva las hojas que cuelgan de un
            # "subtotal". Sin esta fila la tabla salía vacía al filtrar.
            if subtotal_label:
                subtotal_rows.append(dict(total_row, label=subtotal_label, type="subtotal"))

            pivot = sub_ub.groupby([campo_col, "periodo"])["liquidos_mbd"].sum().unstack(fill_value=0)
            # `orden` permite un orden con significado (las clases API van de
            # más ligera a más pesada, no alfabéticas). Antes se forzaba
            # numerando las etiquetas ("1) Súper-ligero"), y esos prefijos se
            # veían en pantalla. Lo que no esté en la lista va al final, en
            # orden alfabético.
            etiquetas = (
                [e for e in orden if e in pivot.index] + sorted(set(pivot.index) - set(orden))
                if orden else sorted(pivot.index)
            )
            for etiqueta in etiquetas:
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


_HISTORICO_MESES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

# "Descargar todo": misma idea que get_perforacion_historico — consulta
# directa a PRODUCCION_CAMPOS, sin filtros ni agregación, una fila por
# registro real (Campo x Fecha). Cubre los temas que se alimentan de esa
# tabla (Producción por ubicación/Cuenca y Producción por campo); no aplica a
# Operadores/Contratos/Asignaciones/Estado/API/Gcompo, que vienen de otras
# fuentes.
def get_produccion_historico(engine: Engine, topic: str) -> dict:
    if topic not in ("Cuenca", "Campos"):
        return {"columnas": [], "filas": [], "periodo_nota": ""}

    # "Producción por campo" no lleva columna Campo en su descarga completa
    # (pedido explícito) — solo "Producción por ubicación" (Cuenca) la trae.
    incluir_campo = topic == "Cuenca"

    sql = f"""
        SELECT FECHA, CAMPO_PORTAL, CUENCA, UBICACION,
               PETROLEO_MBD, CONDENSADO_MBD, GAS_MMPCD, GAS_ASOC_MMPCD,
               GAS_NASOC_MMPCD, N2_MMPCD, AGUA_MBD
        FROM {_TABLA_PRODUCCION_CAMPOS}
        WHERE {_FILTRO_ID_WHERE}
    """
    columnas = [
        "Fecha", *(["Campo"] if incluir_campo else []), "Cuenca", "Ambiente",
        "Petróleo (Mbd)", "Condensado (Mbd)", "Gas (MMpcd)", "Gas asociado (MMpcd)",
        "Gas no asociado (MMpcd)", "Nitrógeno (MMpcd)", "Agua (Mbd)",
    ]
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"columnas": columnas, "filas": [], "periodo_nota": ""}

    df.sort_values(["FECHA", "CUENCA", "CAMPO_PORTAL"], inplace=True)
    if not incluir_campo:
        df.drop(columns=["CAMPO_PORTAL"], inplace=True)
    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    ultima = df["fecha"].max()
    periodo_nota = f"Datos a {_HISTORICO_MESES[ultima.month - 1]} de {ultima.year}."

    df["fecha"] = df["fecha"].dt.strftime("%d/%m/%Y")
    for c in df.columns:
        if c != "fecha" and pd.api.types.is_numeric_dtype(df[c]):
            df[c] = df[c].fillna(0)
        elif c != "fecha":
            df[c] = df[c].fillna("")
    filas = df.values.tolist()

    return {"columnas": columnas, "filas": filas, "periodo_nota": periodo_nota}


def _parse_lista(s):
    return [x.strip() for x in s.split("|") if x.strip()]


@cached()
def get_produccion_campos(
    engine: Engine, start_year: int, end_year: int, start_month: int, end_month: int, period: str,
    cuencas: str = "", ubicaciones: str = "", years: str = "",
) -> dict:
    """Sin filtro: Nacional → CAMPO (subtotal) → componente. Filtrado por
    Ambiente/Cuenca: drill-down Ambiente → Cuenca → CAMPO → componente.

    Misma desagregación que "Producción por asignación" y "por contrato"
    (pedido explícito): antes era Producto → Campo, con el campo repetido
    debajo de cada producto; ahora el campo es el grupo y dentro va su
    desglose por componente, que es lo que interesa al mirar un campo
    concreto. La ficha del campo se abre con clic derecho sobre su fila,
    porque las filas hoja pasaron a ser productos (ver ChartArea)."""
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    if not cuencas and not ubicaciones:
        df = _cargar_df_producto_entidad(engine, "PRODUCCION_CAMPOS", "CAMPO_PORTAL", where_fecha, extra_where=f"{_FILTRO_ID}")
        if df.empty:
            return {"type": "hierarchical", "categories": [], "groups": []}
        df = _preparar_df_producto_entidad(df, "campo_portal", period)
        categories = sorted(df["periodo"].unique().tolist())
        groups = [{"cuenca": "Nacional", "subgroups": [
            {"ubicacion": "Nacional", "rows": _filas_hoja_producto(df, "campo_portal", categories)},
        ]}]
        resp = {
            "type": "hierarchical", "categories": categories, "groups": groups,
            "series": _series_por_producto(df, categories),
            "kpis": _kpis_producto_entidad(df, categories, "campo_portal"),
        }
        # El df ya viene agrupado por campo: la "Grafica individual" (elegir UN
        # campo y ver todos sus productos) sale de aqui sin consulta extra.
        resp["campos"] = _entidades_series_por_producto(df, "campo_portal", categories)
        return resp

    df = _cargar_df_producto_entidad_multi(engine, "PRODUCCION_CAMPOS", ["CUENCA", "UBICACION", "CAMPO_PORTAL"], where_fecha, extra_where=f"{_FILTRO_ID}")
    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}
    resp = _drilldown_ambiente_cuenca_producto(df, "campo_portal", period, cuencas, ubicaciones,
                                               hoja_primero=True)
    resp["campos"] = _series_por_entidad_extra(
        engine, "CAMPO_PORTAL", "campo_portal", where_fecha, period,
        resp.get("categories") or [], extra_where=f"{_FILTRO_ID}",
    )
    return resp


# Orden de las clases API: de más ligera a más pesada, como en el SIH. Antes
# esto se lograba numerando la etiqueta ("1) Súper-ligero"), pero el prefijo
# terminaba visible en la tabla y en los KPIs; ahora el orden va aparte.
# Umbrales (Acuerdo DOF 16/02/2015): Súper ligero 39 < API; Ligero 31.1 < API
# ≤ 39; Mediano 22.3 < API ≤ 31.1; Pesado 10 < API ≤ 22.3; Extra-pesado API < 10.
_API_CLASES = ["Súper-ligero", "Ligero", "Mediano", "Pesado", "Extra-pesado"]
_API_SIN_CLASIFICAR = "Sin clasificar"


@cached()
def get_produccion_api(
    engine: Engine, start_year: int, end_year: int, start_month: int, end_month: int, period: str,
    cuencas: str = "", ubicaciones: str = "", years: str = "",
) -> dict:
    """Jerárquico Cuenca→Ubicación→Clase API, líquidos (Mbd)."""
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    sql = f"""
        SELECT FECHA, CUENCA, UBICACION, PETROLEO_API,
               SUM({_ISNULL}(PETROLEO_MBD,0)+{_ISNULL}(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD
        FROM {_TABLA_PRODUCCION_CAMPOS}
        WHERE {_FILTRO_ID_WHERE}
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
    df["clase_api"] = df["petroleo_api"].fillna(_API_SIN_CLASIFICAR)
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly"
        else df["fecha"].dt.strftime("%Y")
    )
    df = _rollup_periodo(df, ["cuenca", "ubicacion", "clase_api"], ["liquidos_mbd"])

    categories = sorted(df["periodo"].unique().tolist())
    # Cuencas sin una gota de líquido en el periodo (Sabinas es de gas) solo
    # agregaban un grupo vacío; el SIH tampoco las lista.
    con_produccion = df.groupby("cuenca")["liquidos_mbd"].sum()
    df = df[df["cuenca"].isin(con_produccion[con_produccion > 0].index)]
    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

    groups = _hierarchia_cuenca_ubicacion(
        df, "clase_api", categories, orden=_API_CLASES + [_API_SIN_CLASIFICAR],
        # Solo con filtro: ahi la tabla usa el constructor multinivel, que
        # unicamente conserva las hojas colgadas de una fila "subtotal". Sin
        # filtro la tabla se dibuja por cuenca con el camino plano, donde esta
        # fila repetiria el mismo numero que "Total".
        subtotal_label="Hidrocarburos líquidos (Mbd)" if (cuencas or ubicaciones) else None,
    )
    series = [
        {"name": g["cuenca"], "data": g["subgroups"][0]["rows"][0]["data"] if g["subgroups"] else [], "type": "bar"}
        for g in groups
    ]

    return {
        "type": "hierarchical", "categories": categories, "groups": groups, "series": series,
        "kpis": _kpis_hierarquicos(df, categories, "clase_api"),
        "cuencas_api": _api_series_por_cuenca(df, categories),
    }


def _api_series_por_cuenca(df, categories) -> list:
    """Series por clase API de CADA cuenca — alimenta la "Grafica individual"
    de "Produccion de petroleo por grados API". Se elige por cuenca, como en
    Gcompo: la unidad de analisis del tema es la cuenca, no un campo."""
    orden = _API_CLASES + [_API_SIN_CLASIFICAR]
    out = []
    for cuenca in sorted(df["cuenca"].dropna().unique().tolist()):
        sub = df[df["cuenca"] == cuenca]
        series = []
        for clase in orden:
            s_cl = sub[sub["clase_api"] == clase]
            if s_cl.empty or s_cl["liquidos_mbd"].sum() == 0:
                continue
            data = [round(float(v), 2) for v in s_cl.groupby("periodo")["liquidos_mbd"].sum().reindex(categories, fill_value=0)]
            series.append({"name": f"{clase} (Mbd)", "data": data})
        if series:
            out.append({"nombre": cuenca, "series": series})
    out.sort(key=lambda e: -sum(sum(s["data"]) for s in e["series"]))
    return out


# Componentes del gas en el orden del SIH: primero los hidrocarburos por número
# de carbonos (metano → pentanos+) y después los no hidrocarburos. NO es
# alfabético, y el orden importa para leer la composición.
# El gas total va aparte, como fila de total: antes estaba dentro de esta misma
# lista y salía repetido como si fuera un componente más.
_GCOMPO_TOTAL_COL = "gas_mmpcd"
_GCOMPO_TOTAL_LABEL = "Gas (MMpcd)"
_GCOMPO_COMPONENTES = [
    ("c1_mmpcd", "Metano"),
    ("c2_mmpcd", "Etano"),
    ("c3_mmpcd", "Propano"),
    ("c4_mmpcd", "Butano"),
    ("ic4_mmpcd", "Isobutano"),
    ("c5_plus_mmpcd", "Pentano +"),
    ("h2s_mmpcd", "Ácido sulfhídrico"),
    ("h2o_mmpcd", "Agua"),
    ("co2_mmpcd", "Dióxido de carbono"),
    ("n2_mmpcd", "Nitrógeno"),
]
# Todas las columnas que hay que traer de la BD (total + componentes).
_GCOMPO_COLS = {_GCOMPO_TOTAL_COL: _GCOMPO_TOTAL_LABEL, **dict(_GCOMPO_COMPONENTES)}


def _filas_gcompo_detalle(sub_df, categories, con_subtotal=False):
    """Cuenca+Ambiente ya acotados: el componente es la hoja directa bajo un
    subtotal 'Producción' (gas total) — mismo patrón que
    _filas_detalle_por_producto en 'Producción por ubicación'."""
    total = _make_row("Total", "total", categories,
                      sub_df.groupby("periodo")[_GCOMPO_TOTAL_COL].sum())
    # DynamicTable reemplaza esta etiqueta por "Total" al pintarla; se conserva
    # por la convención del resto de las tablas.
    todos = {"label": "Todos los operadores", "type": "operator", "data": total["data"]}
    # Con filtros de Cuenca/Ambiente la tabla se arma con el constructor
    # multinivel, que agrupa las hojas bajo el subtotal anterior y descarta las
    # que no tienen uno (ver extractLeaves en DynamicTable.jsx): sin esta fila
    # la tabla salía vacía al filtrar. Sin filtros no se agrega porque repetiría
    # la cifra del total.
    rows = [total, todos]
    if con_subtotal:
        rows.append(dict(total, label=_GCOMPO_TOTAL_LABEL, type="subtotal"))
    for col, label in _GCOMPO_COMPONENTES:
        rows.append(_make_row(label, "operator", categories, sub_df.groupby("periodo")[col].sum()))
    return rows


@cached()
def get_produccion_gcompo(
    engine: Engine, start_year: int, end_year: int, start_month: int, end_month: int, period: str,
    cuencas: str = "", ubicaciones: str = "", years: str = "",
) -> dict:
    """Composición del gas producido: Cuenca → Ambiente → componente, igual que
    el SIH. La fila de total es el gas (MMpcd) y debajo van los componentes en
    orden por número de carbonos.

    Antes, sin filtro de Cuenca/Ambiente, este tema devolvía una respuesta plana
    (una serie por componente, sin jerarquía) y solo al filtrar aparecía el
    desglose. El SIH siempre muestra la jerarquía, así que ahora es la única
    forma: los filtros acotan, no cambian la estructura."""
    where_fecha, period = _where_fecha(start_year, start_month, end_year, end_month, period, years)
    cols = list(_GCOMPO_COLS)
    cols_sql = ",\n               ".join(f"SUM({_ISNULL}({c.upper()},0)) AS {c.upper()}" for c in cols)

    sql = f"""
        SELECT FECHA, CUENCA, UBICACION,
               {cols_sql}
        FROM {_TABLA_PRODUCCION_CAMPOS}
        WHERE {_FILTRO_ID_WHERE}
          AND {where_fecha}
        GROUP BY FECHA, CUENCA, UBICACION
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)
    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    df[cols] = df[cols].fillna(0)
    if cuencas:
        lst = _parse_lista(cuencas)
        if lst: df = df[df["cuenca"].isin(lst)]
    if ubicaciones:
        lst = _parse_lista(ubicaciones)
        if lst: df = df[df["ubicacion"].isin(lst)]
    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}
    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly" else df["fecha"].dt.strftime("%Y")
    )
    df = _rollup_periodo(df, ["cuenca", "ubicacion"], cols)
    categories = sorted(df["periodo"].unique().tolist())

    # Con filtro activo el frontend usa el constructor multinivel, que necesita
    # la fila de subtotal para agrupar los componentes (ver _filas_gcompo_detalle).
    con_subtotal = bool(cuencas or ubicaciones)
    groups = [{"cuenca": "Nacional", "subgroups": [{"ubicacion": "Nacional", "rows": _filas_gcompo_detalle(df, categories, con_subtotal)}]}]
    for cuenca in sorted(df["cuenca"].dropna().unique().tolist()):
        sub_c = df[df["cuenca"] == cuenca]
        c_subgroups = [
            {"ubicacion": ubic, "rows": _filas_gcompo_detalle(sub_c[sub_c["ubicacion"] == ubic], categories, con_subtotal)}
            for ubic in sorted(sub_c["ubicacion"].dropna().unique().tolist())
        ]
        groups.append({"cuenca": cuenca, "subgroups": c_subgroups})

    # Las series/chips son los componentes, sin el gas total: mezclarlo dejaba
    # una serie que es la suma de las demás y aplastaba la escala.
    series = [
        {"name": label, "data": [round(float(v), 2) for v in df.groupby("periodo")[col].sum().reindex(categories, fill_value=0)], "type": "line"}
        for col, label in _GCOMPO_COMPONENTES
    ]
    total = float(df[df["periodo"] == categories[-1]]["gas_mmpcd"].sum())
    kpis = {
        "total": round(total),
        "anio_top": int(df.groupby(df["periodo"].str[:4])["gas_mmpcd"].sum().idxmax()),
        "cuenca_top": df.groupby("cuenca")["gas_mmpcd"].sum().idxmax(),
        "ubicacion_top": df.groupby("ubicacion")["gas_mmpcd"].sum().idxmax(),
    }
    return {
        "type": "hierarchical", "categories": categories, "groups": groups,
        "series": series, "kpis": kpis,
        "cuencas_gas": _gcompo_series_por_cuenca(df, categories),
    }


def _gcompo_series_por_cuenca(df, categories) -> list:
    """Series por componente de CADA cuenca — alimenta la "Grafica individual"
    de "Produccion de gas por componentes", que aqui se elige por cuenca y no
    por entidad (la unidad de analisis del tema es la cuenca, igual que en el
    SIH). Se omite el total de gas: es la suma de los componentes."""
    out = []
    for cuenca in sorted(df["cuenca"].dropna().unique().tolist()):
        sub = df[df["cuenca"] == cuenca]
        series = []
        for col, label in _GCOMPO_COMPONENTES:
            if sub[col].sum() == 0:
                continue
            data = [round(float(v), 2) for v in sub.groupby("periodo")[col].sum().reindex(categories, fill_value=0)]
            series.append({"name": f"{label} (MMpcd)", "data": data})
        if series:
            out.append({"nombre": cuenca, "series": series})
    out.sort(key=lambda e: -sum(sum(s["data"]) for s in e["series"]))
    return out


@cached()
def get_produccion(
    engine: Engine, topic: str, start_year: int, end_year: int, start_month: int, end_month: int, period: str,
    cuencas: str = "", ubicaciones: str = "", productos: str = "", years: str = "", campos: str = "",
) -> dict:
    if topic == "Operadores":
        # "ubicaciones" no aplica a Operadores (no tiene dimensión Ambiente) —
        # se reutiliza para la selección explícita de empresas individuales.
        return get_produccion_empresas(engine, start_year, end_year, start_month, end_month, period, grupos=cuencas, empresas=ubicaciones, years=years)
    if topic == "InteresPart":
        return get_produccion_operadores(engine, start_year, end_year, start_month, end_month, period, "FACTOR_IP", years)
    if topic == "Contratos":
        return get_produccion_contratos(engine, start_year, end_year, start_month, end_month, period, years)
    if topic == "Asignaciones":
        return get_produccion_asignaciones(engine, start_year, end_year, start_month, end_month, period, cuencas, ubicaciones, years)
    if topic == "Campos":
        return get_produccion_campos(engine, start_year, end_year, start_month, end_month, period, cuencas, ubicaciones, years)
    if topic == "Estado":
        return get_produccion_estado(engine, start_year, end_year, start_month, end_month, period, years)
    if topic == "API":
        return get_produccion_api(engine, start_year, end_year, start_month, end_month, period, cuencas, ubicaciones, years)
    if topic == "Gcompo":
        return get_produccion_gcompo(engine, start_year, end_year, start_month, end_month, period, cuencas, ubicaciones, years)
    return get_produccion_cuenca(engine, start_year, end_year, start_month, end_month, period, cuencas, ubicaciones, productos, years)
