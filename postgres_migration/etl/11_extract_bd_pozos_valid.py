"""ETL: cmde_valid.dbo.bd_pozos (catalogo de pozos VALIDADO -- distinto de
cmde_raw.dbo.bd_pozos ya cargado en stg_bd_pozos: 34,477 filas vs 34,850,
discrepancia raw/valid ya documentada en DATABASE_DEPENDENCIES.md). Necesario
para perforacion_service.py: dbo.perforacion_pozos_perf/term/equipos estan
definidas sobre esta version "valid" y usan YEAR/RIG_NAME, columnas que no
existen en la version raw ya staged.

Uso:
    py -3 postgres_migration/etl/11_extract_bd_pozos_valid.py
"""
import sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import sqlserver_conn, pg_conn, log_etl_start, log_etl_end, copy_rows


def load(sql_cn, pg, staging_table, sql_query, pg_columns, source_desc, fetch_batch=100000):
    batch_id = log_etl_start(pg, f"staging.{staging_table}", source_desc)
    t0 = time.time()
    try:
        cur = sql_cn.cursor()
        cur.execute(sql_query)
        with pg.cursor() as pcur:
            pcur.execute(f"TRUNCATE staging.{staging_table}")
        pg.commit()
        total = 0
        while True:
            rows = cur.fetchmany(fetch_batch)
            if not rows:
                break
            n = copy_rows(pg, staging_table, pg_columns, rows, batch_id)
            pg.commit()
            total += n
            print(f"  ... {staging_table}: {total} filas ({time.time()-t0:.0f}s)")
        log_etl_end(pg, batch_id, total, total, "OK")
        print(f"{staging_table}: {total} filas cargadas en {time.time()-t0:.0f}s")
    except Exception as e:
        pg.rollback()
        log_etl_end(pg, batch_id, 0, 0, "ERROR", str(e))
        raise


if __name__ == "__main__":
    pg = pg_conn()
    sql_valid = sqlserver_conn("cmde_valid")
    load(
        sql_valid, pg, "stg_bd_pozos_valid",
        """SELECT WELL_ID, WELL_NAME, [TYPE], STATUS, [YEAR],
                  DRILLING_START_DATE, DRILLING_FINISH_DATE,
                  COMPLETION_START_DATE, COMPLETION_FINISH_DATE,
                  OPERATOR, ENVIRONMENT, PETROLEUM_PROVINCE, RIG_NAME
           FROM cmde_valid.dbo.bd_pozos""",
        ["well_id", "well_name", "type", "status", "year",
         "drilling_start_date", "drilling_finish_date",
         "completion_start_date", "completion_finish_date",
         "operator", "environment", "petroleum_province", "rig_name"],
        "cmde_valid.dbo.bd_pozos",
    )
    print("listo")
