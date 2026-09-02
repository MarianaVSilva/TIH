import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Engine
from app.config import settings
from app.services.cache_utils import cached

SCHEMA = settings.db_schema + "."
_PG = settings.db_engine == "postgres"
# YEAR(fecha) es sintaxis SQL Server; el equivalente en Postgres es
# EXTRACT(YEAR FROM fecha) -- se define una vez aqui, se usa en todo el archivo.
_YEAR = "EXTRACT(YEAR FROM fecha)" if _PG else "YEAR(fecha)"
_TABLA_RESERVAS_CAMPOS = "api.v_reservas_campos" if _PG else f"{SCHEMA}RESERVAS_CAMPOS"
_TABLA_ASIG_CONT = "api.v_reservas_asig_cont" if _PG else "dbo.reservas_asig_cont"
_TABLA_ASIG_CONT_CAMPOS = "api.v_reservas_asig_cont_campos" if _PG else "dbo.reservas_asig_cont_campos"
# En api.v_reservas_campos la columna se llama campo_portal (core.dim_campo),
# no campo_nombre como en la RESERVAS_CAMPOS de SQL Server -- se alia aqui
# para no tocar el resto de la logica (pivots, agrupaciones) que asume
# "campo_nombre" en todo el archivo.
_CAMPO_NOMBRE_COL = "campo_portal AS campo_nombre" if _PG else "campo_nombre"

# JSON_ARG heredado de CUBOS para los temas "Reservas por campo de X":
# selecciona el hidrocarburo, no la categoría (esa siempre es PROBADAS = 1P,
# no hay selector de categoría en el explorador).
TIPO_COLUMNA = {
    "ReservasP":   "rr_aceite_mmb",
    "ReservasG":   "rr_gas_mmmpc",
    "ReservasPCE": "rr_pce_mmbpce",
}


UNIDAD_RESERVAS = {"ReservasP": "MMb", "ReservasG": "MMMpc", "ReservasPCE": "MMbpce"}
AMBIENTES_ORDEN_RESERVAS = ["Aguas profundas", "Aguas someras", "Terrestre"]

# Nombre de la columna de campo sin alias, para usarla en WHERE/GROUP BY.
_CAMPO_COL = "campo_portal" if _PG else "campo_nombre"


def _norm_campo_sql(expr: str) -> str:
    """Normaliza un nombre de campo para cruzarlo entre tablas.

    RESERVAS_CAMPOS guarda el nombre "bonito" del campo ("Abkatún", "Tupilco
    Profundo") mientras que PRODUCCION_CAMPOS.CAMPO_PORTAL -- de donde sale el
    identificador que usa el resto del sistema -- lo trae en mayúsculas, sin
    acentos y sin espacios ("ABKATUN", "TUPILCOPROFUNDO"). Sin normalizar los
    dos lados, el join no encuentra nada. En SQL Server la collation
    CI_AI resuelve mayúsculas/acentos; en Postgres se hace con TRANSLATE
    (unaccent es una extensión que puede no estar instalada).
    """
    sin_espacios = f"REPLACE({expr}, ' ', '')"
    if _PG:
        return f"UPPER(TRANSLATE({sin_espacios}, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'))"
    return f"{sin_espacios} COLLATE Latin1_General_CI_AI"


@cached()
def get_reservas_de_campo(engine: Engine, campo: str, start_year: int, end_year: int) -> dict:
    """Reservas 1P/2P/3P por año de UN campo (aceite/gas/pce), para el bloque
    de reservas de la ficha de campo. 1P/2P/3P son acumulados de PROBADAS /
    +PROBABLES / +POSIBLES, igual que en el resto del módulo."""
    sql = text(f"""
        SELECT {_YEAR} AS anio, categoria,
               SUM(rr_aceite_mmb)  AS aceite,
               SUM(rr_gas_mmmpc)   AS gas,
               SUM(rr_pce_mmbpce)  AS pce
        FROM {_TABLA_RESERVAS_CAMPOS}
        WHERE {_norm_campo_sql(_CAMPO_COL)} = {_norm_campo_sql(':campo')}
          AND {_YEAR} BETWEEN :start_year AND :end_year
        GROUP BY {_YEAR}, categoria
    """)
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn, params={"campo": campo, "start_year": start_year, "end_year": end_year})

    if df.empty:
        return None

    df.columns = df.columns.str.lower()
    df["anio"] = df["anio"].astype(int)
    for c in ["aceite", "gas", "pce"]:
        df[c] = df[c].astype(float).fillna(0)

    anios = sorted(df["anio"].unique().tolist())
    out = {"categories": [str(a) for a in anios]}
    for producto in ["aceite", "gas", "pce"]:
        pivot = df.pivot_table(index="anio", columns="categoria", values=producto, aggfunc="sum", fill_value=0)
        for cat in ["PROBADAS", "PROBABLES", "POSIBLES"]:
            if cat not in pivot.columns:
                pivot[cat] = 0
        pivot = pivot.reindex(anios, fill_value=0)
        p1 = pivot["PROBADAS"]
        p2 = p1 + pivot["PROBABLES"]
        p3 = p2 + pivot["POSIBLES"]
        out[producto] = {
            "p1": [round(float(v), 2) for v in p1],
            "p2": [round(float(v), 2) for v in p2],
            "p3": [round(float(v), 2) for v in p3],
        }
    return out


@cached()
def get_reservas_por_campo(engine: Engine, start_year: int, end_year: int, tipo: str = "ReservasP") -> dict:
    # Jerarquía Nacional (Total general) → Cuenca → Ambiente → Campo → 1P/2P/3P,
    # mismo formato "hierarchical" (groups→subgroups→rows) que usa DynamicTable
    # para Inversiones por cuenca. 1P/2P/3P son acumulados de PROBADAS/
    # PROBABLES/POSIBLES, no columnas propias de la tabla origen.
    columna = TIPO_COLUMNA.get(tipo)
    if not columna:
        return {"type": "hierarchical", "categories": [], "groups": []}
    unidad = UNIDAD_RESERVAS.get(tipo, "MMb")

    sql = text(f"""
        SELECT {_YEAR} AS anio, cuenca, ubicacion, {_CAMPO_NOMBRE_COL}, categoria, SUM({columna}) AS valor
        FROM {_TABLA_RESERVAS_CAMPOS}
        WHERE {_YEAR} BETWEEN :start_year AND :end_year AND {"campo_portal" if _PG else "campo_nombre"} IS NOT NULL
        GROUP BY {_YEAR}, cuenca, ubicacion, {"campo_portal" if _PG else "campo_nombre"}, categoria
    """)
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn, params={"start_year": start_year, "end_year": end_year})

    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

    df.columns = df.columns.str.lower()
    df["anio"] = df["anio"].astype(int)
    df["cuenca"] = df["cuenca"].fillna("Sin clasificar")
    df["ubicacion"] = df["ubicacion"].fillna("Sin clasificar")
    anios = sorted(df["anio"].unique().tolist())
    categories = [str(a) for a in anios]

    pivot = df.pivot_table(
        index=["cuenca", "ubicacion", "campo_nombre", "anio"], columns="categoria", values="valor",
        aggfunc="sum", fill_value=0,
    )
    for cat in ["PROBADAS", "PROBABLES", "POSIBLES"]:
        if cat not in pivot.columns:
            pivot[cat] = 0
    pivot["1P"] = pivot["PROBADAS"]
    pivot["2P"] = pivot["PROBADAS"] + pivot["PROBABLES"]
    pivot["3P"] = pivot["PROBADAS"] + pivot["PROBABLES"] + pivot["POSIBLES"]
    pivot = pivot.reset_index()

    def serie(sub: pd.DataFrame, col: str) -> list:
        por_anio = sub.groupby("anio")[col].sum()
        return [round(float(por_anio.get(a, 0)), 2) for a in anios]

    def filas_1p2p3p(sub: pd.DataFrame, label: str) -> list:
        # Subtotal (3P) + desglose 1P/2P/3P para un subconjunto (un campo, un
        # ambiente, el total nacional…) — mismo bloque de 4 filas en todos los niveles.
        return [
            {"type": "subtotal", "label": label, "data": serie(sub, "3P")},
            {"type": "operator", "label": f"1P = PROBADAS ({unidad})", "data": serie(sub, "1P")},
            {"type": "operator", "label": f"2P = PROBADAS + PROBABLES ({unidad})", "data": serie(sub, "2P")},
            {"type": "operator", "label": f"3P = PROBADAS + PROBABLES + POSIBLES ({unidad})", "data": serie(sub, "3P")},
        ]

    def filas_campo(sub_amb: pd.DataFrame) -> list:
        rows = []
        for campo, sub_campo in sorted(sub_amb.groupby("campo_nombre"), key=lambda item: item[0]):
            if serie(sub_campo, "1P")[0] == 0:
                # Sin 1P al inicio del rango: campo sin reservas probadas vigentes, se omite.
                continue
            rows += filas_1p2p3p(sub_campo, campo)
        return rows

    # "Total general": suma nacional 1P/2P/3P + desglose por Ambiente, cada uno
    # también dividido en 1P/2P/3P — sobre TODOS los campos (el filtro de
    # filas_campo solo oculta filas individuales, no debe restar del total).
    total_general_rows = filas_1p2p3p(pivot, "Todos los ambientes")
    for amb in AMBIENTES_ORDEN_RESERVAS + sorted(set(pivot["ubicacion"]) - set(AMBIENTES_ORDEN_RESERVAS)):
        sub_amb = pivot[pivot["ubicacion"] == amb]
        if not sub_amb.empty:
            total_general_rows += filas_1p2p3p(sub_amb, amb)

    groups = [
        {"cuenca": "Total general", "data": serie(pivot, "3P"), "subgroups": [{"ubicacion": "Nacional", "rows": total_general_rows}]},
    ]

    cuencas_ordenadas = sorted(pivot.groupby("cuenca"), key=lambda item: item[1]["3P"].sum(), reverse=True)
    for cuenca, sub_cuenca in cuencas_ordenadas:
        ambientes = AMBIENTES_ORDEN_RESERVAS + sorted(set(sub_cuenca["ubicacion"]) - set(AMBIENTES_ORDEN_RESERVAS))
        subgroups = []
        for amb in ambientes:
            rows = filas_campo(sub_cuenca[sub_cuenca["ubicacion"] == amb])
            if rows:
                subgroups.append({"ubicacion": amb, "rows": rows})
        if subgroups:
            groups.append({"cuenca": cuenca, "data": serie(sub_cuenca, "3P"), "subgroups": subgroups})

    return {"type": "hierarchical", "categories": categories, "groups": groups}


# JSON_ARG de "Reservas por asignacion-contrato de X" — tabla propia
# (dbo.reservas_asig_cont), sin esquema de negocio: se consulta sin SCHEMA.
TIPO_COLUMNA_ASIG = {
    "ReservasAsigP":   "rr_aceite_mmb",
    "ReservasAsigG":   "rr_gas_natural_mmmpc",
    "ReservasAsigPCE": "rr_pce_mmbpce",
}


@cached()
def get_reservas_asignacion_contrato(engine: Engine, start_year: int, end_year: int, tipo: str = "ReservasAsigP") -> dict:
    # Jerarquía Nacional (Total general) → Cuenca → Ambiente → Asignación/
    # Contrato → 1P/2P/3P — mismo formato que get_reservas_por_campo, pero
    # aquí la columna "tipo" de la tabla origen YA viene como 1P/2P/3P (no
    # PROBADAS/PROBABLES/POSIBLES por acumular).
    columna = TIPO_COLUMNA_ASIG.get(tipo)
    if not columna:
        return {"type": "hierarchical", "categories": [], "groups": []}
    unidad = UNIDAD_RESERVAS.get(tipo.replace("Asig", ""), "MMb")

    sql = text(f"""
        SELECT {_YEAR} AS anio, cuenca, ubicacion, asignacion_contrato, tipo, SUM({columna}) AS valor
        FROM {_TABLA_ASIG_CONT}
        WHERE {_YEAR} BETWEEN :start_year AND :end_year AND asignacion_contrato IS NOT NULL
        GROUP BY {_YEAR}, cuenca, ubicacion, asignacion_contrato, tipo
    """)
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn, params={"start_year": start_year, "end_year": end_year})
        # reservas_asig_cont solo trae el código ("A-0001"); el nombre completo
        # del bloque ("A-0001-6M - Campo Abkatún") vive en la tabla de detalle
        # por campo — se usa solo como catálogo código→nombre.
        nombres_df = pd.read_sql(
            f"SELECT DISTINCT asignacion_contrato, asignacion_contrato_nombre FROM {_TABLA_ASIG_CONT_CAMPOS} WHERE asignacion_contrato IS NOT NULL",
            conn,
        )

    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

    nombres = dict(zip(nombres_df["asignacion_contrato"], nombres_df["asignacion_contrato_nombre"]))

    df.columns = df.columns.str.lower()
    df["anio"] = df["anio"].astype(int)
    df["cuenca"] = df["cuenca"].fillna("Sin clasificar")
    df["ubicacion"] = df["ubicacion"].fillna("Sin clasificar")
    anios = sorted(df["anio"].unique().tolist())
    categories = [str(a) for a in anios]

    pivot = df.pivot_table(
        index=["cuenca", "ubicacion", "asignacion_contrato", "anio"], columns="tipo", values="valor",
        aggfunc="sum", fill_value=0,
    )
    for cat in ["1P", "2P", "3P"]:
        if cat not in pivot.columns:
            pivot[cat] = 0
    pivot = pivot.reset_index()
    # "A-0001" = Asignación; cualquier otro prefijo (CNH-…, rondas/licitaciones
    # tipo "R01L02") es Contrato — nunca se mezclan en el mismo grupo.
    pivot["tipo_item"] = pivot["asignacion_contrato"].apply(lambda n: "Asignaciones" if str(n).startswith("A") else "Contratos")

    def serie(sub: pd.DataFrame, col: str) -> list:
        por_anio = sub.groupby("anio")[col].sum()
        return [round(float(por_anio.get(a, 0)), 2) for a in anios]

    def filas_1p2p3p(sub: pd.DataFrame, label: str) -> list:
        return [
            {"type": "subtotal", "label": label, "data": serie(sub, "3P")},
            {"type": "operator", "label": f"1P = PROBADAS ({unidad})", "data": serie(sub, "1P")},
            {"type": "operator", "label": f"2P = PROBADAS + PROBABLES ({unidad})", "data": serie(sub, "2P")},
            {"type": "operator", "label": f"3P = PROBADAS + PROBABLES + POSIBLES ({unidad})", "data": serie(sub, "3P")},
        ]

    def filas_asig(sub_amb: pd.DataFrame) -> list:
        rows = []
        for asig, sub_asig in sorted(sub_amb.groupby("asignacion_contrato"), key=lambda item: item[0]):
            if serie(sub_asig, "1P")[0] == 0:
                continue
            # nombres.get(asig, asig): algunos códigos ("R01L03"…) sí están en
            # el catálogo pero con nombre NULL — el default de .get() no
            # aplica ahí (la clave existe), hace falta el "or" explícito.
            rows += filas_1p2p3p(sub_asig, nombres.get(asig) or asig)
        return rows

    total_general_rows = filas_1p2p3p(pivot, "Todos los ambientes")
    for amb in AMBIENTES_ORDEN_RESERVAS + sorted(set(pivot["ubicacion"]) - set(AMBIENTES_ORDEN_RESERVAS)):
        sub_amb = pivot[pivot["ubicacion"] == amb]
        if not sub_amb.empty:
            total_general_rows += filas_1p2p3p(sub_amb, amb)

    groups = [
        {"cuenca": "Total general", "data": serie(pivot, "3P"), "subgroups": [{"ubicacion": "Nacional", "rows": total_general_rows}]},
    ]

    # Nivel superior = Asignaciones / Contratos (nunca revueltos) → Ambiente →
    # item. Las Asignaciones llevan además la Cuenca como subtotal intermedio
    # (son cientos, agrupar ayuda); los Contratos son pocos y van directo,
    # sin nivel de Cuenca, ordenados alfabéticamente por nombre.
    for categoria in ["Asignaciones", "Contratos"]:
        sub_cat = pivot[pivot["tipo_item"] == categoria]
        if sub_cat.empty:
            continue
        ambientes = AMBIENTES_ORDEN_RESERVAS + sorted(set(sub_cat["ubicacion"]) - set(AMBIENTES_ORDEN_RESERVAS))
        subgroups = []
        for amb in ambientes:
            sub_amb = sub_cat[sub_cat["ubicacion"] == amb]
            if sub_amb.empty:
                continue
            if categoria == "Contratos":
                rows = filas_asig(sub_amb)
            else:
                rows = []
                for cuenca, sub_cuenca_amb in sorted(sub_amb.groupby("cuenca"), key=lambda item: item[0]):
                    filas = filas_asig(sub_cuenca_amb)
                    if not filas:
                        continue
                    rows.append({"type": "subtotal", "label": cuenca, "data": serie(sub_cuenca_amb, "3P")})
                    rows += filas
            if rows:
                subgroups.append({"ubicacion": amb, "rows": rows})
        if subgroups:
            groups.append({"cuenca": categoria, "data": serie(sub_cat, "3P"), "subgroups": subgroups})

    return {"type": "hierarchical", "categories": categories, "groups": groups}


@cached()
def get_reservas(engine: Engine, start_year: int, end_year: int, tipo: str = "1P") -> dict:
    sql = text(f"""
        SELECT
            {_YEAR}            AS anio,
            cuenca,
            ubicacion,
            categoria,
            SUM(rr_aceite_mmb)          AS aceite_mmb,
            SUM(rr_gas_mmmpc)           AS gas_mmmpc,
            SUM(rr_condensado_mmb)      AS condensado_mmb,
            SUM(rr_liquidos_planta_mmb) AS liquidos_planta_mmb,
            SUM(vo_aceite_mmb)          AS vo_aceite_mmb,
            SUM(vo_gas_mmmpc)           AS vo_gas_mmmpc
        FROM {_TABLA_RESERVAS_CAMPOS}
        WHERE {_YEAR} BETWEEN :start_year AND :end_year
          AND categoria = :tipo
        GROUP BY {_YEAR}, cuenca, ubicacion, categoria
        ORDER BY {_YEAR}, cuenca
    """)
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn, params={"start_year": start_year, "end_year": end_year, "tipo": tipo})

    if df.empty:
        return {"series_aceite": [], "series_gas": [], "categories": [], "tipo": tipo}

    df.columns = df.columns.str.lower()
    df["anio"] = df["anio"].astype(int)
    numeric = ["aceite_mmb", "gas_mmmpc", "condensado_mmb", "liquidos_planta_mmb"]
    df[numeric] = df[numeric].fillna(0)

    anios = sorted(df["anio"].unique().tolist())
    cuencas = sorted(df["cuenca"].unique().tolist())

    grouped = df.groupby(["cuenca", "anio"])[["aceite_mmb", "gas_mmmpc"]].sum()
    pivot_aceite = grouped["aceite_mmb"].unstack(fill_value=0).reindex(columns=anios, fill_value=0)
    pivot_gas = grouped["gas_mmmpc"].unstack(fill_value=0).reindex(columns=anios, fill_value=0)

    series_aceite = [
        {"name": cuenca, "data": [round(float(v), 2) for v in pivot_aceite.loc[cuenca]], "type": "bar"}
        for cuenca in cuencas
    ]
    series_gas = [
        {"name": cuenca, "data": [round(float(v), 2) for v in pivot_gas.loc[cuenca]], "type": "bar"}
        for cuenca in cuencas
    ]

    return {
        "categories": [str(a) for a in anios],
        "series_aceite": series_aceite,
        "series_gas": series_gas,
        "tipo": tipo,
    }


@cached()
def get_categorias_disponibles(engine: Engine) -> list[str]:
    sql = f"SELECT DISTINCT categoria FROM {_TABLA_RESERVAS_CAMPOS} WHERE categoria IS NOT NULL ORDER BY categoria"
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)
    return df["categoria"].tolist()


@cached()
def _ultima_fecha(engine: Engine) -> str | None:
    sql = text(f"SELECT MAX(fecha) AS fecha FROM {_TABLA_RESERVAS_CAMPOS}")
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)
    if df.empty or pd.isna(df.loc[0, "fecha"]):
        return None
    return str(df.loc[0, "fecha"])[:10]


def _top_n(df: pd.DataFrame, columna: str, n: int) -> list[dict]:
    top = df[["campo_nombre", columna]].sort_values(columna, ascending=False).head(n)
    return [{"nombre": r.campo_nombre, "valor": round(float(getattr(r, columna)), 0)} for r in top.itertuples()]


@cached()
def get_top5_reservas_por_campo(engine: Engine, n: int = 5) -> dict:
    """Top N campos por reservas acumuladas 1P/2P/3P, al dato más reciente —
    para el mini-tablero 'Top 5: Reservas por campo' del Panorama general.
    1P = Probada, 2P = Probada+Probable, 3P = Probada+Probable+Posible."""
    fecha = _ultima_fecha(engine)
    if not fecha:
        return {}

    sql = text(f"""
        SELECT {_CAMPO_NOMBRE_COL}, categoria, SUM(rr_aceite_mmb) AS aceite_mmb, SUM(rr_gas_mmmpc) AS gas_mmmpc
        FROM {_TABLA_RESERVAS_CAMPOS}
        WHERE {"campo_portal" if _PG else "campo_nombre"} IS NOT NULL AND fecha = :fecha
        GROUP BY {"campo_portal" if _PG else "campo_nombre"}, categoria
    """)
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn, params={"fecha": fecha})
    if df.empty:
        return {}

    df.columns = df.columns.str.lower()
    pivot_aceite = df.pivot_table(index="campo_nombre", columns="categoria", values="aceite_mmb", aggfunc="sum", fill_value=0)
    pivot_gas = df.pivot_table(index="campo_nombre", columns="categoria", values="gas_mmmpc", aggfunc="sum", fill_value=0)
    for cat in ["PROBADAS", "PROBABLES", "POSIBLES"]:
        if cat not in pivot_aceite.columns:
            pivot_aceite[cat] = 0
        if cat not in pivot_gas.columns:
            pivot_gas[cat] = 0

    acumulados = {}
    for nivel, cats in [("1P", ["PROBADAS"]), ("2P", ["PROBADAS", "PROBABLES"]), ("3P", ["PROBADAS", "PROBABLES", "POSIBLES"])]:
        acum_aceite = pivot_aceite[cats].sum(axis=1).reset_index(name="aceite_mmb")
        acum_gas = pivot_gas[cats].sum(axis=1).reset_index(name="gas_mmmpc")
        acumulados[nivel] = {
            "aceite": _top_n(acum_aceite, "aceite_mmb", n),
            "gas": _top_n(acum_gas, "gas_mmmpc", n),
        }

    return {"fecha": fecha, **acumulados}


@cached()
def get_reservas_1p2p3p(engine: Engine) -> dict:
    """Reservas nacionales acumuladas 1P/2P/3P (Probada / +Probable / +Posible),
    al dato más reciente — para la gráfica de cascada del Panorama general."""
    fecha = _ultima_fecha(engine)
    if not fecha:
        return {}

    sql = text(f"""
        SELECT categoria, SUM(rr_aceite_mmb) AS aceite_mmb, SUM(rr_gas_mmmpc) AS gas_mmmpc
        FROM {_TABLA_RESERVAS_CAMPOS}
        WHERE fecha = :fecha
        GROUP BY categoria
    """)
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn, params={"fecha": fecha})
    if df.empty:
        return {}

    df.columns = df.columns.str.lower()
    totales = df.set_index("categoria")[["aceite_mmb", "gas_mmmpc"]].to_dict("index")
    probada = totales.get("PROBADAS", {"aceite_mmb": 0, "gas_mmmpc": 0})
    probable = totales.get("PROBABLES", {"aceite_mmb": 0, "gas_mmmpc": 0})
    posible = totales.get("POSIBLES", {"aceite_mmb": 0, "gas_mmmpc": 0})

    def _bloque(campo):
        p = round(float(probada.get(campo) or 0), 0)
        pb = round(float(probable.get(campo) or 0), 0)
        ps = round(float(posible.get(campo) or 0), 0)
        return {
            "probada": p, "probable": pb, "posible": ps,
            "un_p": p, "dos_p": p + pb, "tres_p": p + pb + ps,
        }

    return {"fecha": fecha, "aceite": _bloque("aceite_mmb"), "gas": _bloque("gas_mmmpc")}
