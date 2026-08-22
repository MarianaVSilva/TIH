"""ETL: subsistema de licitaciones/rondas (schema rdmx, tablas base directas,
ver DATABASE_DEPENDENCIES.md) + licitaciones_bloques_ofertas.

Uso:
    py -3 postgres_migration/etl/08_extract_licitaciones.py
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import sqlserver_conn, pg_conn, log_etl_start, log_etl_end


def load(sql_cn, pg, staging_table, sql_query, pg_columns, source_desc):
    batch_id = log_etl_start(pg, f"staging.{staging_table}", source_desc)
    try:
        cur = sql_cn.cursor()
        cur.execute(sql_query)
        rows = cur.fetchall()
        leidas = len(rows)
        cols = ", ".join(pg_columns)
        placeholders = ", ".join(["%s"] * (len(pg_columns) + 1))
        with pg.cursor() as pcur:
            pcur.execute(f"TRUNCATE staging.{staging_table}")
            pcur.executemany(
                f"INSERT INTO staging.{staging_table} ({cols}, _load_batch_id) VALUES ({placeholders})",
                [tuple(r) + (batch_id,) for r in rows],
            )
        pg.commit()
        log_etl_end(pg, batch_id, leidas, leidas, "OK")
        print(f"{staging_table}: {leidas} filas cargadas")
    except Exception as e:
        pg.rollback()
        log_etl_end(pg, batch_id, 0, 0, "ERROR", str(e))
        raise


if __name__ == "__main__":
    sql_cn = sqlserver_conn("cmde_public")
    pg = pg_conn()
    try:
        load(
            sql_cn, pg, "stg_t01a_infogral",
            """SELECT contrato, contratista, ronda, licitacion, ac, ac_nombre,
                      f_firmacontr, modalidad, ubicacion, superficie, licitante
               FROM rdmx.T_01A_InfoGral""",
            ["contrato", "contratista", "ronda", "licitacion", "ac", "ac_nombre",
             "f_firmacontr", "modalidad", "ubicacion", "superficie", "licitante"],
            "cmde_public.rdmx.T_01A_InfoGral",
        )
        load(
            sql_cn, pg, "stg_t12_pozos",
            """SELECT contrato, pozo, estatus, f_inicio_perfora, f_termino_perfora,
                      f_inicio_terminacion, f_termino_terminacion, resultado, hidrocarburo
               FROM rdmx.T_12_Pozos""",
            ["contrato", "pozo", "estatus", "f_inicio_perfora", "f_termino_perfora",
             "f_inicio_terminacion", "f_termino_terminacion", "resultado", "hidrocarburo"],
            "cmde_public.rdmx.T_12_Pozos",
        )
        load(
            sql_cn, pg, "stg_t21a_pozoscomprometidos",
            """SELECT contrato, PMTeaPozos, pozosPlanes, descubrimientos, comentarios
               FROM rdmx.T_21a_PozosComprometidos""",
            ["contrato", "pmteapozos", "pozosplanes", "descubrimientos", "comentarios"],
            "cmde_public.rdmx.T_21a_PozosComprometidos",
        )
        load(
            sql_cn, pg, "stg_licitaciones_bloques_ofertas",
            """SELECT ronda, licitacion, var_adj1, var_adj2, vpo, bono, id_licitante,
                      id_bloque, id_empresa, id_licitante_adj, empresa, pais, inv_usd,
                      area, validez, licitante, contrato, pozos_comprometidos, ubicacion,
                      contrato_nombre, entidad_principal, cuenca
               FROM dbo.licitaciones_bloques_ofertas""",
            ["ronda", "licitacion", "var_adj1", "var_adj2", "vpo", "bono", "id_licitante",
             "id_bloque", "id_empresa", "id_licitante_adj", "empresa", "pais", "inv_usd",
             "area", "validez", "licitante", "contrato", "pozos_comprometidos", "ubicacion",
             "contrato_nombre", "entidad_principal", "cuenca"],
            "cmde_public.dbo.licitaciones_bloques_ofertas",
        )
    finally:
        sql_cn.close()
        pg.close()
