"""ETL de prueba de extremo a extremo: PRECIOS + CUBOS (los dominios mas
simples, sin logica de negocio pesada) SQL Server -> staging.

Uso:
    py -3 postgres_migration/etl/01_extract_precios_cubos.py
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import sqlserver_conn, pg_conn, log_etl_start, log_etl_end


def extract_precios(sql_cn, pg):
    batch_id = log_etl_start(pg, "staging.stg_precios", "cmde_raw.dbo.precios")
    try:
        cur = sql_cn.cursor()
        cur.execute("""
            SELECT fecha, brent, wti, mme, henry_hub, opec, insertado, fuentes, intradia
            FROM cmde_raw.dbo.precios
        """)
        rows = cur.fetchall()
        leidas = len(rows)

        with pg.cursor() as pcur:
            pcur.execute("TRUNCATE staging.stg_precios")
            pcur.executemany(
                """INSERT INTO staging.stg_precios
                   (fecha, brent, wti, mme, henry_hub, opec, insertado, fuentes, intradia, _load_batch_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                [tuple(r) + (batch_id,) for r in rows],
            )
        pg.commit()
        log_etl_end(pg, batch_id, leidas, leidas, "OK")
        print(f"stg_precios: {leidas} filas cargadas")
    except Exception as e:
        pg.rollback()
        log_etl_end(pg, batch_id, 0, 0, "ERROR", str(e))
        raise


def extract_cubos(sql_cn, pg):
    batch_id = log_etl_start(pg, "staging.stg_cubos", "cmde_public.dbo.CUBOS")
    try:
        cur = sql_cn.cursor()
        cur.execute("""
            SELECT SECCION, TEMA, JSON_ARG, INIT_YEAR, METODOLOGIA, TITULO,
                   PERIODICIDAD, END_YEAR, DOWNLOADABLE
            FROM cmde_public.dbo.CUBOS
        """)
        rows = cur.fetchall()
        leidas = len(rows)

        with pg.cursor() as pcur:
            pcur.execute("TRUNCATE staging.stg_cubos")
            pcur.executemany(
                """INSERT INTO staging.stg_cubos
                   (seccion, tema, json_arg, init_year, metodologia, titulo,
                    periodicidad, end_year, downloadable, _load_batch_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                [tuple(r) + (batch_id,) for r in rows],
            )
        pg.commit()
        log_etl_end(pg, batch_id, leidas, leidas, "OK")
        print(f"stg_cubos: {leidas} filas cargadas")
    except Exception as e:
        pg.rollback()
        log_etl_end(pg, batch_id, 0, 0, "ERROR", str(e))
        raise


if __name__ == "__main__":
    sql_cn = sqlserver_conn("cmde_raw")
    sql_cn_public = sqlserver_conn("cmde_public")
    pg = pg_conn()
    try:
        extract_precios(sql_cn, pg)
        extract_cubos(sql_cn_public, pg)
    finally:
        sql_cn.close()
        sql_cn_public.close()
        pg.close()
