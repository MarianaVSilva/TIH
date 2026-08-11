import pandas as pd
from sqlalchemy.engine import Engine
from app.config import settings
from app.services.cache_utils import cached

SCHEMA = settings.db_schema + "."


@cached()
def get_inversiones(engine: Engine, start_year: int, end_year: int, subtopic: str = "estado") -> dict:
    if subtopic == "contrato":
        sql = f"""
            SELECT ANIO, RONDA, LICITACION, CONTRATO, ACT_PETROLERA, MONTO_USD
            FROM {SCHEMA}INVERSIONES_APROBADAS
            WHERE RONDA IS NOT NULL AND ANIO BETWEEN {start_year} AND {end_year}
        """
        group_col = "contrato"
    elif subtopic == "asignacion":
        sql = f"""
            SELECT ANIO, TIPO_PLAN, LICITACION, CONTRATO, ACT_PETROLERA, MONTO_USD
            FROM {SCHEMA}INVERSIONES_APROBADAS
            WHERE RONDA IS NULL AND ANIO BETWEEN {start_year} AND {end_year}
        """
        group_col = "act_petrolera"
    else:
        sql = f"""
            SELECT ANIO, ACT_PETROLERA, TAREA, ESTADO, UBICACION, MONTO_USD
            FROM {SCHEMA}INVERSIONES_APROBADAS
            WHERE ANIO BETWEEN {start_year} AND {end_year}
        """
        group_col = "act_petrolera"

    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"series": [], "categories": []}

    df.columns = df.columns.str.lower()
    df["monto_usd"] = pd.to_numeric(df["monto_usd"], errors="coerce").fillna(0)

    anios = sorted(df["anio"].unique().tolist())
    grupos = sorted(df[group_col].dropna().unique().tolist())

    grupos = grupos[:15]  # límite para no saturar
    pivot = (
        df[df[group_col].isin(grupos)].groupby([group_col, "anio"])["monto_usd"].sum()
        .unstack(fill_value=0).reindex(columns=anios, fill_value=0)
    )
    series = [
        {"name": str(g), "data": [round(float(v), 2) for v in pivot.loc[g]], "type": "bar"}
        for g in grupos
    ]

    return {"categories": [str(a) for a in anios], "series": series}


@cached()
def get_inversiones_cuenca(engine: Engine, start_year: int, end_year: int) -> dict:
    # ESTADO en esta tabla es la Entidad Federativa (no un estatus de
    # proyecto — nombre heredado del esquema de origen) y UBICACION es el
    # Ambiente (Aguas profundas/Aguas someras/Terrestre).
    sql = f"""
        SELECT ANIO, CUENCA, ESTADO AS ENTIDAD, UBICACION AS AMBIENTE, MONTO_USD
        FROM {SCHEMA}INVERSIONES_APROBADAS
        WHERE ANIO BETWEEN {start_year} AND {end_year} AND CUENCA IS NOT NULL
    """
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)

    if df.empty:
        return {"type": "hierarchical", "categories": [], "groups": []}

    df.columns = df.columns.str.lower()
    df["monto_usd"] = pd.to_numeric(df["monto_usd"], errors="coerce").fillna(0)

    df["anio"] = df["anio"].astype(int)
    anios = sorted(df["anio"].unique().tolist())
    categories = [str(a) for a in anios]

    def serie_por_anio(sub: pd.DataFrame) -> list:
        por_anio = sub.groupby("anio")["monto_usd"].sum()
        return [round(float(por_anio.get(a, 0)), 2) for a in anios]

    # Mismo formato "hierarchical" (groups→subgroups→rows) que usa DynamicTable
    # para Producción por cuenca — así se reusa tal cual esa tabla (estilo,
    # búsqueda, export, colapsar/expandir) en vez de armar una tabla propia.
    # Sin grupo "cuenca": "Nacional" a propósito — ese sentinela dispara el
    # banner "NACIONAL" + fila "Total" de DynamicTable, redundante con "Total
    # general" de abajo (que ya cubre el desglose por Ambiente). Sin banner,
    # DynamicTable pone el botón Contraer/Expandir todo directo en el
    # encabezado de columnas (rowHeaderLabel), en vez de la barra aparte.
    total_general_rows = [
        {"type": "operator", "label": amb, "data": serie_por_anio(sub)}
        for amb, sub in df.groupby("ambiente")
    ]

    groups = [
        {"cuenca": "Total general", "subgroups": [{"ubicacion": "Nacional", "rows": total_general_rows}]},
    ]

    cuencas_ordenadas = sorted(
        df.groupby("cuenca"), key=lambda item: item[1]["monto_usd"].sum(), reverse=True,
    )
    for cuenca, sub_cuenca in cuencas_ordenadas:
        rows = []
        for entidad, sub_entidad in sub_cuenca.groupby("entidad"):
            rows.append({"type": "subtotal", "label": entidad, "data": serie_por_anio(sub_entidad)})
            for amb, sub_amb in sub_entidad.groupby("ambiente"):
                rows.append({"type": "operator", "label": amb, "data": serie_por_anio(sub_amb)})
        groups.append({"cuenca": cuenca, "subgroups": [{"ubicacion": "Nacional", "rows": rows}]})

    return {"type": "hierarchical", "categories": categories, "groups": groups}
