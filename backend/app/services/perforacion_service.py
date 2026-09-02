import unicodedata
import pandas as pd
from sqlalchemy import text as sqlalchemy_text
from sqlalchemy.engine import Engine
from app.config import settings
from app.services.cache_utils import cached

SCHEMA = settings.db_schema + "."
_PG = settings.db_engine == "postgres"
_YEAR_FECHA = "EXTRACT(YEAR FROM FECHA)" if _PG else "YEAR(FECHA)"
_MONTH_FECHA = "EXTRACT(MONTH FROM FECHA)" if _PG else "MONTH(FECHA)"
_ISNULL = "COALESCE" if _PG else "ISNULL"
_FILTRO_ID_WHERE = "1=1" if _PG else "ID <> 1"
_TABLA_PRODUCCION_CAMPOS_POZOS = "api.v_produccion_campos_pozos" if _PG else f"{SCHEMA}PRODUCCION_CAMPOS_POZOS"
_TABLA_PRODUCCION_CAMPOS = "api.v_produccion_campos" if _PG else f"{SCHEMA}PRODUCCION_CAMPOS"
_TABLA_BD_POZOS_VALID = "api.v_bd_pozos_valid" if _PG else "cmde_valid.dbo.bd_pozos"
# Catálogo pozo→campo (columna FIELD), para saber a qué campo pertenece cada
# pozo sin pasar por su asignación (un contrato puede cubrir varios campos).
# En Postgres FIELD hoy solo existe en staging: ni core.dim_pozo ni
# api.v_pozos_meta / api.v_bd_pozos_valid la exponen todavía — vale la pena
# subirla a una vista de `api` cuando se retome la migración, y entonces
# cambiar esta constante.
_TABLA_BD_POZOS_CAMPO = "staging.stg_bd_pozos" if _PG else "cmde_raw.dbo.bd_pozos"
_COL_FIELD = "field" if _PG else "FIELD"
_COL_WELL_ID = "well_id" if _PG else "WELL_ID"
_COL_WELL_NAME_CATALOGO = "well_name" if _PG else "WELL_NAME"

TOPIC_MAP = {
    "PozPerf": ("api.v_perforacion_pozos_perf" if _PG else f"{SCHEMA}PERFORACION_POZOS_PERF", "pozos_perforados" if _PG else "POZOS_PERFORADOS"),
    "PozTerm": ("api.v_perforacion_pozos_term" if _PG else f"{SCHEMA}PERFORACION_POZOS_TERM", "pozos_terminados" if _PG else "POZOS_TERMINADOS"),
    "EqPerf":  ("api.v_perforacion_equipos" if _PG else f"{SCHEMA}PERFORACION_EQUIPOS",       "prom_eq_perforacion" if _PG else "PROM_EQ_PERFORACION"),
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
        sql = f"SELECT DISTINCT CUENCA, UBICACION, CAMPO_PORTAL AS CAMPO FROM {_TABLA_PRODUCCION_CAMPOS_POZOS}"
        with engine.connect() as conn:
            df = pd.read_sql(sql, conn)
        df.columns = df.columns.str.lower()
        return {
            "cuencas":     sorted(df["cuenca"].dropna().unique().tolist()),
            "categorias":  [label for label, _ in _POZOS_CAMPOS_TIPOS],
            "ubicaciones": sorted(df["ubicacion"].dropna().unique().tolist()),
            "operadores":  sorted(df["campo"].dropna().unique().tolist()),
        }

    tabla, var = TOPIC_MAP["PozPerf"]
    sql = f"""
        SELECT DISTINCT CUENCA, CATEGORIA_POZO, UBICACION, OPERADOR
        FROM {tabla}
        WHERE {var} > 0
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
        where_fecha = f"{_YEAR_FECHA} IN ({años_sql})"
        period = "annually"
    else:
        init = f"{start_year}-{start_month:02d}-01"
        end  = f"{end_year}-{end_month:02d}-01"
        where_fecha = f"FECHA BETWEEN '{init}' AND '{end}'"

    sql = f"""
        SELECT FECHA, CUENCA, CATEGORIA_POZO, UBICACION, OPERADOR, {var}
        FROM {tabla}
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
            FROM {_TABLA_PRODUCCION_CAMPOS_POZOS}
        """
        orden = ["FECHA", "CUENCA", "CAMPO"]
        columnas = ["Fecha", "Campo", "Cuenca", "Ambiente", "Pozos de petróleo y gas asociado", "Pozos de gas no asociado"]
    elif topic in TOPIC_MAP:
        tabla, var = TOPIC_MAP[topic]
        sql = f"""
            SELECT FECHA, OPERADOR, CATEGORIA_POZO, CUENCA, UBICACION, {var}
            FROM {tabla}
        """
        orden = ["FECHA", "CUENCA", "OPERADOR"]
        columnas = ["Fecha", "Operador", "Categoría", "Cuenca", "Ambiente", var.replace("_", " ").title()]
    else:
        return {"columnas": [], "filas": [], "periodo_nota": ""}

    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"columnas": columnas, "filas": [], "periodo_nota": ""}

    df.columns = df.columns.str.lower()
    df.sort_values([c.lower() for c in orden], inplace=True)
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
    _year_of = (lambda c: f"EXTRACT(YEAR FROM {c})") if _PG else (lambda c: f"YEAR({c})")
    _month_of = (lambda c: f"EXTRACT(MONTH FROM {c})") if _PG else (lambda c: f"MONTH({c})")
    _campo_year = "YEAR" if _PG else "[YEAR]"
    _campo_type = "TYPE" if _PG else "[TYPE]"
    _status_concluido = "upper(STATUS) = 'CONCLUIDO'" if _PG else "STATUS = 'CONCLUIDO'"

    params = {}
    where = [f"{campo_fecha} IS NOT NULL", f"{_campo_year} >= 1960", "PETROLEUM_PROVINCE IS NOT NULL", f"{_campo_type} IS NOT NULL"]
    if topic == "PozTerm":
        where.append(_status_concluido)
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
        where.append(f"{_year_of(campo_fecha)} = :anio")
        params["anio"] = int(periodo)
    else:
        anio, mes = periodo.split("-")
        where.append(f"{_year_of(campo_fecha)} = :anio")
        where.append(f"{_month_of(campo_fecha)} = :mes")
        params["anio"], params["mes"] = int(anio), int(mes)

    sql = f"""
        SELECT WELL_NAME, {campo_fecha} AS FECHA_EVENTO, {_campo_type}, OPERATOR
        FROM {_TABLA_BD_POZOS_VALID}
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
        # Un pozo puede tener mas de un ASIG_CONT distinto en su historial
        # (p.ej. una asignacion real y, en otro registro, una administrativa
        # "ADM-%" — ver nota de core.dim_contrato en 04_transform_staging_to_core.sql).
        # dict(zip(...)) se queda con el ultimo valor visto, no determinista;
        # se ordena para que una asignacion real siempre gane sobre "ADM-%".
        df_campo = df_campo.sort_values("asig_cont", key=lambda s: s.str.startswith("ADM-"), ascending=False)
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


def get_pozos_campo_detalle(engine: Engine, campo: str, periodo: str) -> dict:
    """Desglose por nombre de pozo detrás de una celda de "Pozos operando por
    campo" (PozosCampos): pozos con producción (>0) en PRODUCCION_POZOS que
    pertenecen a ESTE campo, en el periodo clickeado.

    El campo del pozo se resuelve por bd_pozos.FIELD, no por su asignación:
    un contrato puede cubrir VARIOS campos (p.ej. CNH-R01-L02-A1/2015 = Eni
    Área 1 cubre Amoca, Miztón y Tecoalli), así que filtrar por asignación
    mezclaba pozos de campos vecinos en la lista de un campo. Verificado
    contra PRODUCCION_CAMPOS_POZOS (la cifra que muestra la tabla): con
    bd_pozos.FIELD los conteos coinciden en la gran mayoría de campos
    (Culebra 241=241, Nejo 171=171, Arcabuz 156=156…).

    Si el cruce por FIELD no devuelve nada (algunos campos no empatan de
    nombre con bd_pozos), se cae al método anterior por asignación para no
    dejar la lista vacía — es preferible una lista aproximada a ninguna.
    """
    from app.services import pozos_service
    source = pozos_service._source_table()

    periodo = periodo.strip()
    params_fecha = {}
    if len(periodo) == 4:
        where_fecha = f"{_YEAR_FECHA} = :anio"
        params_fecha["anio"] = int(periodo)
    else:
        anio, mes = periodo.split("-")
        where_fecha = f"{_YEAR_FECHA} = :anio AND {_MONTH_FECHA} = :mes"
        params_fecha["anio"], params_fecha["mes"] = int(anio), int(mes)

    select_cols = f"""
        SELECT p.WELL_NAME, p.ASIG_CONT, p.FECHA,
               {_ISNULL}(p.PETROLEO_MBD,0)+{_ISNULL}(p.CONDENSADO_MBD,0) AS LIQUIDOS_MBD,
               {_ISNULL}(p.GAS_MMPCD,0) AS GAS_MMPCD
    """

    # 1) Camino principal: el campo real del pozo (bd_pozos.FIELD).
    df = pd.DataFrame()
    try:
        from app.services.produccion_service import _norm_texto_sql
        # Algunos pozos no tienen WELL_ID en ninguna de las dos tablas (ej.
        # AMOCA-10DES/23DES/25DES/27DES/29DES/31DES) — NULL = NULL nunca es
        # verdadero en SQL, así que esos pozos se caían del join aunque sí
        # tuvieran producción. Fallback: si el WELL_ID es nulo en ambos lados,
        # empatar por nombre normalizado en vez de perder la fila.
        # El catálogo se deduplica con MIN(FIELD) — exactamente igual que en la
        # tabla (ver _pozos_campos_conteo_real). Hay un pozo (WELL_ID 236763)
        # catalogado a la vez como "Ku" y como "Maloob"; sin deduplicar, la
        # tabla lo asignaba a un solo campo y esta lista lo contaba en los dos,
        # y Maloob salía con un pozo de más que la celda que se clickeó.
        sql_field = f"""
            WITH cat_id AS (
                SELECT {_COL_WELL_ID} AS WID, MIN({_COL_FIELD}) AS FIELD
                FROM {_TABLA_BD_POZOS_CAMPO}
                WHERE {_COL_WELL_ID} IS NOT NULL AND {_COL_FIELD} IS NOT NULL
                GROUP BY {_COL_WELL_ID}
            ),
            cat_nom AS (
                SELECT {_norm_texto_sql(_COL_WELL_NAME_CATALOGO)} AS NOMBRE_NORM, MIN({_COL_FIELD}) AS FIELD
                FROM {_TABLA_BD_POZOS_CAMPO}
                WHERE {_COL_WELL_ID} IS NULL AND {_COL_FIELD} IS NOT NULL
                GROUP BY {_norm_texto_sql(_COL_WELL_NAME_CATALOGO)}
            )
            {select_cols}
            FROM {source} p
            JOIN cat_id b ON p.WELL_ID = b.WID
            WHERE {_norm_texto_sql('b.FIELD')} = {_norm_texto_sql(':campo')}
              AND {where_fecha.replace('FECHA', 'p.FECHA')}
            UNION ALL
            {select_cols}
            FROM {source} p
            JOIN cat_nom b ON {_norm_texto_sql('p.WELL_NAME')} = b.NOMBRE_NORM
            WHERE p.WELL_ID IS NULL
              AND {_norm_texto_sql('b.FIELD')} = {_norm_texto_sql(':campo')}
              AND {where_fecha.replace('FECHA', 'p.FECHA')}
        """
        with engine.connect() as conn:
            df = pd.read_sql(sqlalchemy_text(sql_field), conn, params={**params_fecha, "campo": campo})
    except Exception:
        df = pd.DataFrame()

    # 2) Respaldo: por asignación (como antes), solo si lo anterior no dio nada.
    if df.empty:
        sql_asig = f"""
            SELECT DISTINCT ASIG_CONT FROM {_TABLA_PRODUCCION_CAMPOS}
            WHERE {_FILTRO_ID_WHERE} AND CAMPO_PORTAL = :campo AND ASIG_CONT IS NOT NULL
        """
        with engine.connect() as conn:
            asigs = pd.read_sql(sqlalchemy_text(sql_asig), conn, params={"campo": campo})
        asig_list = asigs.iloc[:, 0].dropna().unique().tolist()
        if not asig_list:
            return {"pozos": [], "total": 0}

        # ASIG_CONT se escribe distinto en PRODUCCION_POZOS según el tipo:
        #   - Asignaciones: "A-0001-5M - CAMPO ABKATUN" (código + sufijo +
        #     campo), por eso hace falta el LIKE "<código>-%".
        #   - Contratos: "CNH-R01-L02-A1/2015" tal cual — ahí el LIKE no
        #     encuentra NADA (le sobra el "-"), de ahí también la igualdad.
        params = dict(params_fecha)
        clausulas = []
        for i, a in enumerate(asig_list):
            clausulas.append(f"p.ASIG_CONT = :e{i} OR p.ASIG_CONT LIKE :p{i}")
            params[f"e{i}"] = a
            params[f"p{i}"] = f"{a}-%"
        sql = f"""
            {select_cols}
            FROM {source} p
            WHERE ({' OR '.join(clausulas)}) AND {where_fecha.replace('FECHA', 'p.FECHA')}
        """
        with engine.connect() as conn:
            df = pd.read_sql(sqlalchemy_text(sql), conn, params=params)

    if df.empty:
        return {"pozos": [], "total": 0}

    df.columns = df.columns.str.lower()
    df = df[(df["liquidos_mbd"] > 0) | (df["gas_mmpcd"] > 0)]
    if df.empty:
        return {"pozos": [], "total": 0}

    df["fecha"] = pd.to_datetime(df["fecha"])
    df = df.sort_values("fecha").drop_duplicates("well_name", keep="last")
    df["tipo"] = df.apply(lambda r: "Petróleo y gas asociado" if r["liquidos_mbd"] > 0 else "Gas no asociado", axis=1)
    df = df.dropna(subset=["well_name"]).sort_values("well_name")

    pozos = [
        {
            "pozo": r["well_name"],
            "campo": r["asig_cont"],
            "tipo": r["tipo"],
            "fecha": r["fecha"].isoformat() if pd.notna(r["fecha"]) else None,
        }
        for r in df[["well_name", "asig_cont", "tipo", "fecha"]].to_dict("records")
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


def _norm_py(s):
    """Normalización en pandas equivalente a _norm_texto_sql: mayúsculas, sin
    acentos, sin espacios ni guiones — para cruzar CAMPO_PORTAL
    (PRODUCCION_CAMPOS) con FIELD (bd_pozos), que se escriben distinto
    ("AMOCA" vs "Amoca", "TAMAULIPAS CONSTITUCIONES" vs
    "Tamaulipas-Constituciones")."""
    if pd.isna(s):
        return None
    s = unicodedata.normalize("NFKD", str(s).upper().strip())
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return s.replace(" ", "").replace("-", "").replace(".", "")


def _periodo_sql(expr: str, period: str) -> str:
    """Etiqueta de periodo ("2026" anual / "2026-06" mensual) calculada en SQL."""
    if period == "monthly":
        return f"TO_CHAR({expr}, 'YYYY-MM')" if _PG else f"CONVERT(varchar(7), {expr}, 126)"
    return f"TO_CHAR({expr}, 'YYYY')" if _PG else f"CAST({_YEAR_FECHA.replace('FECHA', expr)} AS varchar(4))"


def _pozos_campos_conteo_real(engine: Engine, where_fecha: str, period: str) -> pd.DataFrame:
    """Conteo de pozos DISTINTOS con producción (>0) en PRODUCCION_POZOS por
    periodo y campo, resolviendo el campo real del pozo vía bd_pozos.FIELD — la
    misma fuente y lógica que get_pozos_campo_detalle, para que la cifra de la
    tabla y la lista de pozos detrás de cada celda SIEMPRE coincidan.

    Contar distintos dentro del periodo es lo que hace que el número anual
    coincida con la lista (AMOCA 2026 = 20; promediar los meses daba 19).

    Sustituye a POZOS_ACEITE/POZOS_GAS de PRODUCCION_CAMPOS_POZOS, que es un
    agregado calculado aparte y no derivado de estos pozos individuales.

    TODO el trabajo pesado se hace en SQL a propósito: a nivel pozo son ~2
    millones de filas para un rango de 20 años, y traerlas a pandas tardaba
    más de 30 s (la petición moría por timeout). Agregando en el servidor
    vuelven solo unos miles de filas ya contadas.
    """
    from app.services import pozos_service
    source = pozos_service._source_table()
    from app.services.produccion_service import _norm_texto_sql

    periodo = _periodo_sql("p.FECHA", period)
    liquidos = f"{_ISNULL}(p.PETROLEO_MBD,0)+{_ISNULL}(p.CONDENSADO_MBD,0)"
    gas = f"{_ISNULL}(p.GAS_MMPCD,0)"

    # Catálogo pozo→campo, deduplicado en SQL (MIN(FIELD)) para que un WELL_ID
    # repetido no multiplique las filas de producción al unir.
    cat_por_id = f"""
        SELECT {_COL_WELL_ID} AS WELL_ID, MIN({_COL_FIELD}) AS FIELD
        FROM {_TABLA_BD_POZOS_CAMPO}
        WHERE {_COL_WELL_ID} IS NOT NULL AND {_COL_FIELD} IS NOT NULL
        GROUP BY {_COL_WELL_ID}
    """
    # Pozos sin WELL_ID en el catálogo: se emparejan por nombre normalizado
    # (NULL = NULL nunca es cierto en SQL, si no se perderían — ver AMOCA).
    cat_por_nombre = f"""
        SELECT {_norm_texto_sql(_COL_WELL_NAME_CATALOGO)} AS NOMBRE_NORM, MIN({_COL_FIELD}) AS FIELD
        FROM {_TABLA_BD_POZOS_CAMPO}
        WHERE {_COL_WELL_ID} IS NULL AND {_COL_FIELD} IS NOT NULL
        GROUP BY {_norm_texto_sql(_COL_WELL_NAME_CATALOGO)}
    """

    where_p = where_fecha.replace("FECHA", "p.FECHA")
    select_pozo = f"""
        SELECT p.WELL_NAME, p.FECHA, c.FIELD,
               CASE WHEN {liquidos} > 0 THEN 'pozos_aceite' ELSE 'pozos_gas' END AS TIPO_COL
    """
    # Dos uniones limpias en vez de un JOIN con OR (un OR impide usar el índice
    # por WELL_ID y hace la consulta mucho más lenta).
    sql = f"""
        WITH cat_id AS ({cat_por_id}),
             cat_nom AS ({cat_por_nombre}),
             emparejado AS (
                {select_pozo}
                FROM {source} p
                JOIN cat_id c ON p.WELL_ID = c.WELL_ID
                WHERE {where_p} AND ({liquidos} > 0 OR {gas} > 0)
                UNION ALL
                {select_pozo}
                FROM {source} p
                JOIN cat_nom c ON {_norm_texto_sql('p.WELL_NAME')} = c.NOMBRE_NORM
                WHERE p.WELL_ID IS NULL AND {where_p} AND ({liquidos} > 0 OR {gas} > 0)
             ),
             -- Un mismo pozo puede ser de aceite un mes y de gas otro dentro del
             -- mismo periodo: se queda con el tipo de su registro más reciente
             -- (igual que get_pozos_campo_detalle) para no contarlo dos veces.
             por_periodo AS (
                SELECT WELL_NAME, FIELD, TIPO_COL, PERIODO,
                       ROW_NUMBER() OVER (PARTITION BY FIELD, WELL_NAME, PERIODO ORDER BY FECHA DESC) AS RN
                FROM (SELECT WELL_NAME, FIELD, TIPO_COL, FECHA, {_periodo_sql('FECHA', period)} AS PERIODO
                      FROM emparejado) e
             )
        -- RN = 1 ya deja una sola fila por (campo, pozo, periodo), así que
        -- COUNT(*) cuenta pozos distintos sin pagar el DISTINCT.
        SELECT PERIODO, FIELD, TIPO_COL, COUNT(*) AS POZOS
        FROM por_periodo
        WHERE RN = 1
        GROUP BY PERIODO, FIELD, TIPO_COL
    """
    sql_meta = f"""
        SELECT DISTINCT CAMPO_PORTAL AS CAMPO, CUENCA, UBICACION
        FROM {_TABLA_PRODUCCION_CAMPOS}
        WHERE {_FILTRO_ID_WHERE} AND CAMPO_PORTAL IS NOT NULL
    """
    vacio = pd.DataFrame(columns=["periodo", "cuenca", "campo", "ubicacion", "pozos_aceite", "pozos_gas"])
    with engine.connect() as conn:
        conteos = pd.read_sql(sql, conn)
        meta = pd.read_sql(sql_meta, conn)

    if conteos.empty:
        return vacio

    conteos.columns = conteos.columns.str.lower()
    meta.columns = meta.columns.str.lower()

    # FIELD (bd_pozos) → CAMPO_PORTAL de PRODUCCION_CAMPOS, para que la etiqueta
    # coincida con el resto del tablero (misma grafía en mayúsculas).
    meta = meta.dropna(subset=["campo"]).copy()
    meta["campo_norm"] = meta["campo"].map(_norm_py)
    meta = meta.drop_duplicates("campo_norm")

    conteos["campo_norm"] = conteos["field"].map(_norm_py)
    conteos = conteos.merge(meta[["campo_norm", "campo", "cuenca", "ubicacion"]], on="campo_norm", how="left")

    # Se rellenan ANTES del pivote: pivot_table descarta las filas cuya clave de
    # índice es NaN, así que los pozos cuyo campo no empata con ningún
    # CAMPO_PORTAL desaparecerían del desglose (y del total) en silencio.
    conteos["campo"] = conteos["campo"].fillna("Sin campo asignado")
    conteos["cuenca"] = conteos["cuenca"].fillna("Sin cuenca asignada")
    conteos["ubicacion"] = conteos["ubicacion"].fillna("Sin ambiente asignado")

    # groupby+unstack, no pivot_table(dropna=False): este último rellena TODAS
    # las combinaciones posibles de índice (22 periodos × 825 campos × cuenca ×
    # ambiente = cientos de miles de filas vacías), lo que disparaba el tiempo
    # de respuesta. Los nulos ya se rellenaron arriba, así que groupby no pierde
    # ninguna fila.
    df = (
        conteos.groupby(["periodo", "cuenca", "ubicacion", "campo", "tipo_col"])["pozos"]
        .sum()
        .unstack("tipo_col", fill_value=0)
        .reset_index()
    )
    for col in ("pozos_aceite", "pozos_gas"):
        if col not in df.columns:
            df[col] = 0
    return df[["periodo", "cuenca", "campo", "ubicacion", "pozos_aceite", "pozos_gas"]]


def _get_pozos_campos(
    engine: Engine, start_year: int, end_year: int, start_month: int, end_month: int,
    period: str, cuencas: str = "", ubicaciones: str = "", campos: str = "", years: str = "",
    tipos: str = "",
) -> dict:
    years_list = [int(y.strip()) for y in years.split("|") if y.strip()] if years else []
    if years_list:
        años_sql = ", ".join(str(y) for y in years_list)
        where_fecha = f"{_YEAR_FECHA} IN ({años_sql})"
        period = "annually"
    else:
        init = f"{start_year}-{start_month:02d}-01"
        end  = f"{end_year}-{end_month:02d}-01"
        where_fecha = f"FECHA BETWEEN '{init}' AND '{end}'"

    # Ya viene contado por periodo/campo desde SQL (pozos DISTINTOS, no promedio
    # de meses) — ver _pozos_campos_conteo_real.
    df = _pozos_campos_conteo_real(engine, where_fecha, period)

    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

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
