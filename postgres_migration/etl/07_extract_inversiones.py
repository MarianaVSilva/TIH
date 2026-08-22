"""ETL: INVERSIONES_APROBADAS. Fuente real (ver DATABASE_DEPENDENCIES.md):
cmde_raw.dbo.inversiones_aprobadas (tabla base, 449,776 filas) -- las capas
intermedias cmde_valid/cmde_public son passthrough puro (SELECT * / WHERE
REPORTE='SI' AND VIGENTE='SI').

Uso:
    py -3 postgres_migration/etl/07_extract_inversiones.py
"""
import sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import sqlserver_conn, pg_conn, log_etl_start, log_etl_end, copy_rows


def load(sql_cn, pg, staging_table, sql_query, pg_columns, source_desc, fetch_batch=50000):
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
        log_etl_end(pg, batch_id, total, total, "OK")
        print(f"{staging_table}: {total} filas cargadas en {time.time()-t0:.0f}s")
    except Exception as e:
        pg.rollback()
        log_etl_end(pg, batch_id, 0, 0, "ERROR", str(e))
        raise


if __name__ == "__main__":
    sql_cn = sqlserver_conn("cmde_raw")
    pg = pg_conn()
    try:
        load(
            sql_cn, pg, "stg_inversiones_aprobadas",
            """SELECT block_id, campo, asg_cont, modalidad, ronda, licitacion, contrato,
                      contratista, cuenca, estado, tipo_plan, tipo_aprob, capex_opex,
                      id_act_petrolera, act_petrolera, id_sub_act_petrolera, sub_act_petrolera,
                      id_tarea, tarea, id_sub_tarea, anio, mes, mes_ref, monto_usd, tipo,
                      contenido, escenario, vigente, fecha_og, anio_contractual,
                      anio_presentacion, fuente, mod, reporte, ubicacion, update_date,
                      data_date, cnh_user
               FROM cmde_raw.dbo.inversiones_aprobadas""",
            ["block_id", "campo", "asg_cont", "modalidad", "ronda", "licitacion", "contrato",
             "contratista", "cuenca", "estado", "tipo_plan", "tipo_aprob", "capex_opex",
             "id_act_petrolera", "act_petrolera", "id_sub_act_petrolera", "sub_act_petrolera",
             "id_tarea", "tarea", "id_sub_tarea", "anio", "mes", "mes_ref", "monto_usd", "tipo",
             "contenido", "escenario", "vigente", "fecha_og", "anio_contractual",
             "anio_presentacion", "fuente", "mod", "reporte", "ubicacion", "update_date",
             "data_date", "cnh_user"],
            "cmde_raw.dbo.inversiones_aprobadas",
        )
    finally:
        sql_cn.close()
        pg.close()
