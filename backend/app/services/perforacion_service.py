import pandas as pd
from sqlalchemy.engine import Engine
from app.config import settings
from app.services.cache_utils import cached

SCHEMA = settings.db_schema + "."

TOPIC_MAP = {
    "PozPerf": ("PERFORACION_POZOS_PERF", "POZOS_PERFORADOS"),
    "PozTerm": ("PERFORACION_POZOS_TERM", "POZOS_TERMINADOS"),
    "EqPerf":  ("PERFORACION_EQUIPOS",    "PROM_EQ_PERFORACION"),
}

CAT_MAP = {
    "DELIMITADOR": "Exploración",
    "EXPLORACION": "Exploración",
}


@cached()
def get_perforacion_filtros(engine: Engine, topic: str = "PozPerf") -> dict:
    if topic == "PozosCampos":
        # Esta tabla no tiene categoria_pozo ni operador — "campo" ocupa el
        # lugar de "operador" en el drawer de filtros, y no hay categorías.
        sql = f"SELECT DISTINCT CUENCA, UBICACION, CAMPO_PORTAL AS CAMPO FROM {SCHEMA}PRODUCCION_CAMPOS_POZOS"
        with engine.connect() as conn:
            df = pd.read_sql(sql, conn)
        df.columns = df.columns.str.lower()
        return {
            "cuencas":     sorted(df["cuenca"].dropna().unique().tolist()),
            "categorias":  [label for label, _ in _POZOS_CAMPOS_TIPOS],
            "ubicaciones": sorted(df["ubicacion"].dropna().unique().tolist()),
            "operadores":  sorted(df["campo"].dropna().unique().tolist()),
        }

    tabla = TOPIC_MAP["PozPerf"][0]
    sql = f"""
        SELECT DISTINCT CUENCA, CATEGORIA_POZO, UBICACION, OPERADOR
        FROM {SCHEMA}{tabla}
        WHERE POZOS_PERFORADOS > 0
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)
    df.columns = df.columns.str.lower()
    df["categoria_pozo"] = df["categoria_pozo"].replace(CAT_MAP).str.title().fillna("Otro")
    return {
        "cuencas":     sorted(df["cuenca"].dropna().unique().tolist()),
        "categorias":  sorted(df["categoria_pozo"].dropna().unique().tolist()),
        "ubicaciones": sorted(df["ubicacion"].dropna().unique().tolist()),
        "operadores":  sorted(df["operador"].dropna().unique().tolist()),
    }


@cached()
def get_perforacion(
    engine: Engine,
    topic: str,
    start_year: int,
    end_year: int,
    start_month: int,
    end_month: int,
    period: str,
    cuencas: str = "",
    categorias: str = "",
    ubicaciones: str = "",
    operadores: str = "",
    years: str = "",
) -> dict:
    if topic == "PozosCampos":
        return _get_pozos_campos(
            engine, start_year, end_year, start_month, end_month, period,
            cuencas, ubicaciones, operadores, years, categorias,
        )

    if topic not in TOPIC_MAP:
        return {"type": "hierarchical", "categories": [], "groups": []}

    tabla, var = TOPIC_MAP[topic]
    suffix = " " if topic != "EqPerf" else " (Eq Perf)"

    # "years" (ej. "2018|2025"): comparar años específicos y no necesariamente
    # consecutivos, en vez del rango continuo start_year–end_year.
    years_list = [int(y.strip()) for y in years.split("|") if y.strip()] if years else []

    if years_list:
        años_sql = ", ".join(str(y) for y in years_list)
        where_fecha = f"YEAR(FECHA) IN ({años_sql})"
        period = "annually"
    else:
        init = f"{start_year}-{start_month:02d}-01"
        end  = f"{end_year}-{end_month:02d}-01"
        where_fecha = f"FECHA BETWEEN '{init}' AND '{end}'"

    sql = f"""
        SELECT FECHA, CUENCA, CATEGORIA_POZO, UBICACION, OPERADOR, {var}
        FROM {SCHEMA}{tabla}
        WHERE {where_fecha}
          AND {var} > 0
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

    df.columns = df.columns.str.lower()
    vc = var.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    df[vc] = pd.to_numeric(df[vc], errors="coerce").fillna(0)
    df["categoria_pozo"] = (
        df["categoria_pozo"].replace(CAT_MAP).str.title().fillna("Otro")
    )

    def _parse(s):
        # Separador "|" (no ","): los nombres de operadores contienen comas.
        return [x.strip() for x in s.split("|") if x.strip()]

    if cuencas:
        lst = _parse(cuencas)
        if lst: df = df[df["cuenca"].isin(lst)]
    if categorias:
        lst = _parse(categorias)
        if lst: df = df[df["categoria_pozo"].isin(lst)]
    if ubicaciones:
        lst = _parse(ubicaciones)
        if lst: df = df[df["ubicacion"].isin(lst)]
    if operadores:
        lst = _parse(operadores)
        if lst: df = df[df["operador"].isin(lst)]

    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

    df["periodo"] = (
        df["fecha"].dt.strftime("%Y-%m") if period == "monthly"
        else df["fecha"].dt.strftime("%Y")
    )

    categories = sorted(df["periodo"].unique().tolist())

    groups = []
    cuencas_order = ["Nacional"] + sorted(df["cuenca"].dropna().unique().tolist())

    for cuenca in cuencas_order:
        if cuenca == "Nacional":
            ubs_reales = sorted(df["ubicacion"].dropna().unique().tolist())
            ubicaciones_nac = ["Nacional"] + ubs_reales
        else:
            sub_cuenca = df[df["cuenca"] == cuenca]
            if sub_cuenca.empty:
                continue
            ubicaciones_nac = None

        cuenca_rows = []

        ubicaciones_list = ubicaciones_nac if cuenca == "Nacional" else sorted(
            df[df["cuenca"] == cuenca]["ubicacion"].dropna().unique().tolist()
        )

        for ubicacion in ubicaciones_list:
            if cuenca == "Nacional":
                sub_ub = df if ubicacion == "Nacional" else df[df["ubicacion"] == ubicacion]
            else:
                sub_ub = df[(df["cuenca"] == cuenca) & (df["ubicacion"] == ubicacion)]

            if sub_ub.empty:
                continue

            total_by_periodo = sub_ub.groupby("periodo")[vc].sum()
            total_row = _make_row(
                f"Total{suffix}", "total",
                categories, total_by_periodo, vc, topic
            )

            todos_row = {
                "label": "Todos los operadores",
                "type": "operator",
                "data": total_row["data"],
            }

            subtotal_rows = [total_row, todos_row]

            cats = sorted(sub_ub["categoria_pozo"].unique().tolist())
            for cat in cats:
                sub_cat = sub_ub[sub_ub["categoria_pozo"] == cat]
                cat_totals = sub_cat.groupby("periodo")[vc].sum()
                cat_row = _make_row(
                    cat, "subtotal",
                    categories, cat_totals, vc, topic
                )
                subtotal_rows.append(cat_row)

                ops = sorted(sub_cat["operador"].dropna().unique().tolist())
                for op in ops:
                    op_data = sub_cat[sub_cat["operador"] == op].groupby("periodo")[vc].sum()
                    op_row = _make_row(op, "operator", categories, op_data, vc, topic)
                    subtotal_rows.append(op_row)

            cuenca_rows.append({
                "ubicacion": ubicacion,
                "rows": subtotal_rows,
            })

        groups.append({
            "cuenca": cuenca,
            "subgroups": cuenca_rows,
        })

    series = []
    for g in groups:
        total_data = g["subgroups"][0]["rows"][0]["data"] if g["subgroups"] else []
        series.append({"name": g["cuenca"], "data": total_data, "type": "bar"})

    kpis = _compute_kpis(df, vc)

    return {
        "type": "hierarchical",
        "categories": categories,
        "groups": groups,
        "series": series,
        "kpis": kpis,
    }


def _make_row(label, row_type, categories, series_by_periodo, vc, topic):
    is_int = topic != "EqPerf"
    data = []
    for p in categories:
        val = float(series_by_periodo.loc[p]) if p in series_by_periodo.index else 0.0
        data.append(int(round(val)) if is_int else round(val, 2))
    return {"label": label, "type": row_type, "data": data}


def _compute_kpis(df: pd.DataFrame, vc: str) -> dict:
    if df.empty:
        return {}
    total = int(df[vc].sum())
    anio_top = int(df.groupby(df["fecha"].dt.year)[vc].sum().idxmax())
    cuenca_top = df.groupby("cuenca")[vc].sum().idxmax()
    operador_top = df.groupby("operador")[vc].sum().idxmax()
    ubicacion_top = df.groupby("ubicacion")[vc].sum().idxmax()
    return {
        "total": total,
        "anio_top": anio_top,
        "cuenca_top": cuenca_top,
        "operador_top": operador_top,
        "ubicacion_top": ubicacion_top,
    }


# "Pozos operando por campo" vive en PRODUCCION_CAMPOS_POZOS: no tiene
# categoria_pozo ni operador, sino cuenca/ubicacion/campo_portal y dos
# métricas separadas (pozos_aceite, pozos_gas) tratadas como dos "Tipo".
# El periodo anual se promedia (no se suma): es una foto de pozos activos.
_POZOS_CAMPOS_TIPOS = [
    ("Pozos de petróleo y gas asociado", "pozos_aceite"),
    ("Pozos de gas no asociado", "pozos_gas"),
]


def _get_pozos_campos(
    engine: Engine, start_year: int, end_year: int, start_month: int, end_month: int,
    period: str, cuencas: str = "", ubicaciones: str = "", campos: str = "", years: str = "",
    tipos: str = "",
) -> dict:
    years_list = [int(y.strip()) for y in years.split("|") if y.strip()] if years else []
    if years_list:
        años_sql = ", ".join(str(y) for y in years_list)
        where_fecha = f"YEAR(FECHA) IN ({años_sql})"
        period = "annually"
    else:
        init = f"{start_year}-{start_month:02d}-01"
        end  = f"{end_year}-{end_month:02d}-01"
        where_fecha = f"FECHA BETWEEN '{init}' AND '{end}'"

    sql = f"""
        SELECT FECHA, CUENCA, CAMPO_PORTAL AS CAMPO, UBICACION, POZOS_ACEITE, POZOS_GAS
        FROM {SCHEMA}PRODUCCION_CAMPOS_POZOS
        WHERE {where_fecha}
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    df[["pozos_aceite", "pozos_gas"]] = df[["pozos_aceite", "pozos_gas"]].apply(
        pd.to_numeric, errors="coerce"
    ).fillna(0)

    def _parse(s):
        return [x.strip() for x in s.split("|") if x.strip()]

    if cuencas:
        lst = _parse(cuencas)
        if lst: df = df[df["cuenca"].isin(lst)]
    if ubicaciones:
        lst = _parse(ubicaciones)
        if lst: df = df[df["ubicacion"].isin(lst)]
    if campos:
        lst = _parse(campos)
        if lst: df = df[df["campo"].isin(lst)]

    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

    tipos_activos = _POZOS_CAMPOS_TIPOS
    if tipos:
        lst = _parse(tipos)
        if lst:
            tipos_activos = [t for t in _POZOS_CAMPOS_TIPOS if t[0] in lst]

    # Anual: promedio de los meses del año (foto de pozos activos, no acumulado).
    # Mensual: cada mes ya es único por cuenca/ubicacion/campo, sum() es solo dedupe.
    if period == "monthly":
        df["periodo"] = df["fecha"].dt.strftime("%Y-%m")
        agg = "sum"
    else:
        df["periodo"] = df["fecha"].dt.strftime("%Y")
        agg = "mean"

    df = df.groupby(["periodo", "cuenca", "ubicacion", "campo"], as_index=False).agg(
        {"pozos_aceite": agg, "pozos_gas": agg}
    )

    categories = sorted(df["periodo"].unique().tolist())

    groups = []
    cuencas_order = ["Nacional"] + sorted(df["cuenca"].dropna().unique().tolist())

    for cuenca in cuencas_order:
        if cuenca == "Nacional":
            ubs_reales = sorted(df["ubicacion"].dropna().unique().tolist())
            ubicaciones_list = ["Nacional"] + ubs_reales
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

            cols_activas = [col for _, col in tipos_activos]
            total_by_periodo = (
                sub_ub.groupby("periodo")[cols_activas].sum().sum(axis=1)
            )
            total_row = _make_row("Total", "total", categories, total_by_periodo, "pozos", "PozosCampos")
            # DynamicTable.jsx detecta la fila de total por esta etiqueta exacta
            # ("Todos los operadores") y la reemplaza en pantalla por "Total".
            todos_row = {"label": "Todos los operadores", "type": "operator", "data": total_row["data"]}
            subtotal_rows = [total_row, todos_row]

            for tipo_label, col in tipos_activos:
                tipo_totals = sub_ub.groupby("periodo")[col].sum()
                subtotal_rows.append(_make_row(tipo_label, "subtotal", categories, tipo_totals, col, "PozosCampos"))

                # Un solo groupby+unstack para todos los campos de esta ubicación,
                # en vez de filtrar el DataFrame por cada uno de los ~374 campos
                # (evita un patrón O(cuenca × ubicacion × tipo × campo)).
                pivot = sub_ub.groupby(["campo", "periodo"])[col].sum().unstack(fill_value=0)
                for campo in sorted(pivot.index):
                    subtotal_rows.append(_make_row(campo, "operator", categories, pivot.loc[campo], col, "PozosCampos"))

            cuenca_rows.append({"ubicacion": ubicacion, "rows": subtotal_rows})

        groups.append({"cuenca": cuenca, "subgroups": cuenca_rows})

    series = []
    for g in groups:
        total_data = g["subgroups"][0]["rows"][0]["data"] if g["subgroups"] else []
        series.append({"name": g["cuenca"], "data": total_data, "type": "bar"})

    df["pozos"] = df[[col for _, col in tipos_activos]].sum(axis=1)
    # "Total" = pozos operando en el período más reciente (foto), no la suma de
    # todos los períodos del rango (que sumaría promedios anuales entre sí).
    total = int(df[df["periodo"] == categories[-1]]["pozos"].sum())
    anio_top = int(df.groupby(df["periodo"].str[:4])["pozos"].sum().idxmax())
    cuenca_top = df.groupby("cuenca")["pozos"].sum().idxmax()
    campo_top = df.groupby("campo")["pozos"].sum().idxmax()
    ambiente_top = df.groupby("ubicacion")["pozos"].sum().idxmax()

    return {
        "type": "hierarchical",
        "categories": categories,
        "groups": groups,
        "series": series,
        "kpis": {
            "total": total, "anio_top": anio_top,
            "cuenca_top": cuenca_top, "operador_top": campo_top, "ubicacion_top": ambiente_top,
        },
    }
