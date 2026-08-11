import pandas as pd
from sqlalchemy import text as sqlalchemy_text
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

# "Pozos Terminados" y "Pozos Perforados": "Aguas ultra profundas" se agrupa
# con "Aguas profundas" (pedido explícito) — ambas son Ambiente (UBICACION),
# no dos categorías distintas para efectos del tablero.
UBICACION_MAP_MERGE_TOPICS = {"PozTerm", "PozPerf"}
UBICACION_MAP = {
    "Aguas ultra profundas": "Aguas profundas",
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
    if topic in UBICACION_MAP_MERGE_TOPICS:
        df["ubicacion"] = df["ubicacion"].replace(UBICACION_MAP)
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
    if topic in UBICACION_MAP_MERGE_TOPICS:
        df["ubicacion"] = df["ubicacion"].replace(UBICACION_MAP)

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


_HISTORICO_MESES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def get_perforacion_historico(engine: Engine, topic: str) -> dict:
    """"Descargar todo": consulta directa a la tabla de origen, SIN filtros ni
    agregación — el histórico completo, una fila por registro real (pedido
    explícito, referencia: export crudo de PRODUCCION_CAMPOS_POZOS que ya se
    bajaba por fuera del tablero). A diferencia de get_perforacion/
    _get_pozos_campos, aquí no se agrupa por periodo ni se corrige nada
    (ni CAT_MAP ni UBICACION_MAP) — es la tabla tal cual está en la BD."""
    # Sin ORDER BY: en SQL Server ordenar ~150k filas server-side es la parte
    # más lenta de la consulta — se trae sin ordenar y se ordena en pandas
    # (in-memory, prácticamente gratis) antes de devolver.
    if topic == "PozosCampos":
        sql = f"""
            SELECT FECHA, CAMPO_PORTAL AS CAMPO, CUENCA, UBICACION, POZOS_ACEITE, POZOS_GAS
            FROM {SCHEMA}PRODUCCION_CAMPOS_POZOS
        """
        orden = ["FECHA", "CUENCA", "CAMPO"]
        columnas = ["Fecha", "Campo", "Cuenca", "Ambiente", "Pozos de petróleo y gas asociado", "Pozos de gas no asociado"]
    elif topic in TOPIC_MAP:
        tabla, var = TOPIC_MAP[topic]
        sql = f"""
            SELECT FECHA, OPERADOR, CATEGORIA_POZO, CUENCA, UBICACION, {var}
            FROM {SCHEMA}{tabla}
        """
        orden = ["FECHA", "CUENCA", "OPERADOR"]
        columnas = ["Fecha", "Operador", "Categoría", "Cuenca", "Ambiente", var.replace("_", " ").title()]
    else:
        return {"columnas": [], "filas": [], "periodo_nota": ""}

    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"columnas": columnas, "filas": [], "periodo_nota": ""}

    df.sort_values(orden, inplace=True)
    df.columns = df.columns.str.lower()
    df["fecha"] = pd.to_datetime(df["fecha"])
    ultima = df["fecha"].max()
    periodo_nota = f"Datos a {_HISTORICO_MESES[ultima.month - 1]} de {ultima.year}."

    df["fecha"] = df["fecha"].dt.strftime("%d/%m/%Y")
    # Los conteos vienen de SQL Server como float (0.0, 154.0, …) — como int
    # el JSON pesa bastante menos (menos dígitos, sin ".0" repetido 150k
    # veces) y se comprime/transmite más rápido.
    for c in df.columns:
        if c != "fecha" and pd.api.types.is_numeric_dtype(df[c]):
            df[c] = df[c].fillna(0).round().astype(int)
        elif c != "fecha":
            df[c] = df[c].fillna("")
    filas = df.values.tolist()

    return {"columnas": columnas, "filas": filas, "periodo_nota": periodo_nota}


def get_perforacion_pozos_detalle(
    engine: Engine, topic: str, periodo: str,
    cuenca: str = "", ubicacion: str = "", operador: str = "", categoria_pozo: str = "",
) -> dict:
    """Desglose por nombre de pozo detrás de una celda de PozPerf/PozTerm —
    consulta cmde_valid.dbo.bd_pozos (la MISMA fuente de las vistas
    perforacion_pozos_perf/term, ver su definición con
    OBJECT_DEFINITION(OBJECT_ID('dbo.perforacion_pozos_perf'))), reconstruyendo
    en pandas la clasificación categoria_pozo desde TYPE en vez de depender de
    la redacción exacta del CASE de cada vista (evita duplicar SQL frágil).

    cuenca/ubicacion/operador/categoria_pozo son opcionales: la tabla en
    pantalla puede agrupar por distintas dimensiones según los filtros
    activos (a veces una fila mezcla varias cuencas o categorías bajo un
    mismo operador) — cuando una dimensión no está disponible en la fila
    clickeada, se omite ese filtro y se listan los pozos de esa dimensión
    completa (superset), nunca se inventa un valor.
    """
    if topic not in ("PozPerf", "PozTerm"):
        return {"pozos": [], "total": 0}

    campo_fecha = "DRILLING_FINISH_DATE" if topic == "PozPerf" else "COMPLETION_FINISH_DATE"

    params = {}
    where = [f"{campo_fecha} IS NOT NULL", "[YEAR] >= 1960", "PETROLEUM_PROVINCE IS NOT NULL", "[TYPE] IS NOT NULL"]
    if topic == "PozTerm":
        where.append("STATUS = 'CONCLUIDO'")
    if cuenca:
        where.append("PETROLEUM_PROVINCE = :cuenca")
        params["cuenca"] = cuenca
    if ubicacion:
        where.append("ENVIRONMENT = :ubicacion")
        params["ubicacion"] = ubicacion
    if operador:
        where.append("OPERATOR = :operador")
        params["operador"] = operador

    periodo = periodo.strip()
    if len(periodo) == 4:
        where.append(f"YEAR({campo_fecha}) = :anio")
        params["anio"] = int(periodo)
    else:
        anio, mes = periodo.split("-")
        where.append(f"YEAR({campo_fecha}) = :anio")
        where.append(f"MONTH({campo_fecha}) = :mes")
        params["anio"], params["mes"] = int(anio), int(mes)

    sql = f"""
        SELECT WELL_NAME, {campo_fecha} AS FECHA_EVENTO, [TYPE], OPERATOR
        FROM cmde_valid.dbo.bd_pozos
        WHERE {" AND ".join(where)}
    """
    with engine.connect() as conn:
        df = pd.read_sql(sqlalchemy_text(sql), conn, params=params)
    if df.empty:
        return {"pozos": [], "total": 0}

    df.columns = df.columns.str.lower()
    base = df["type"].str.upper().replace({"DELIMITADOR": "EXPLORACION", "EXPLORATORIO": "EXPLORACION", "INYECTOR": "DESARROLLO"})
    df["categoria_pozo"] = base.replace(CAT_MAP).str.title()
    if categoria_pozo:
        df = df[df["categoria_pozo"] == categoria_pozo]

    df = df.dropna(subset=["well_name"]).drop_duplicates("well_name").sort_values("well_name")
    if df.empty:
        return {"pozos": [], "total": 0}

    # "campo" (ASIG_CONT completo, ej. "A-0001-5M - CAMPO ABKATUN") para poder
    # saltar a Producción por pozo — se resuelve por nombre contra la MISMA
    # fuente que usa esa vista (PRODUCCION_POZOS/caché), no contra bd_pozos,
    # que no tiene esa columna. bd_pozos usa mayúsculas/minúsculas mixtas
    # ("Agua Nacida-134DES") y PRODUCCION_POZOS todo en mayúsculas
    # ("AGUA NACIDA-134DES") para el mismo pozo — se compara en mayúsculas.
    # No todos los pozos perforados ya tienen producción registrada, así que
    # puede no encontrarse (queda en None).
    campo_por_pozo = {}
    try:
        from app.services import pozos_service
        source = pozos_service._source_table()
        nombres = df["well_name"].str.upper().tolist()
        placeholders = ", ".join(f":n{i}" for i in range(len(nombres)))
        sql_campo = f"SELECT DISTINCT WELL_NAME, ASIG_CONT FROM {source} WHERE UPPER(WELL_NAME) IN ({placeholders})"
        params_campo = {f"n{i}": n for i, n in enumerate(nombres)}
        with engine.connect() as conn:
            df_campo = pd.read_sql(sqlalchemy_text(sql_campo), conn, params=params_campo)
        df_campo.columns = df_campo.columns.str.lower()
        campo_por_pozo = dict(zip(df_campo["well_name"].str.upper(), df_campo["asig_cont"]))
    except Exception:
        pass

    pozos = [
        {
            "pozo": r["well_name"],
            "fecha": r["fecha_evento"].isoformat() if pd.notna(r["fecha_evento"]) else None,
            "categoria_pozo": r["categoria_pozo"],
            "operador": r["operator"],
            "campo": campo_por_pozo.get(r["well_name"].upper()),
        }
        for r in df[["well_name", "fecha_evento", "categoria_pozo", "operator"]].to_dict("records")
    ]
    return {"pozos": pozos, "total": len(pozos)}


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
    # groupby descarta filas con clave NaN por defecto — un CAMPO_PORTAL (o
    # cuenca/ubicacion) nulo se perdía silenciosamente del desglose por campo,
    # aunque sí contaba en el total nacional de "Pozos operando" (Panorama
    # general), que no agrupa por campo. Sin este fillna los dos totales no
    # cuadraban entre sí.
    df["campo"] = df["campo"].fillna("Sin campo asignado")
    df["cuenca"] = df["cuenca"].fillna("Sin cuenca asignada")
    df["ubicacion"] = df["ubicacion"].fillna("Sin ambiente asignado")

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
