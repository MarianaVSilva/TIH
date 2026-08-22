"""ETL: PRODUCCION_OPERADOR_IP. Fuente: cmde_public.dbo.empresas_ip_hist
(vista ya resuelta -- JOIN de 5 tablas chicas en cmde_valid, ver
DATABASE_DEPENDENCIES.md, "traza completa"). Se extrae la vista directo en
vez de replicar el join de 5 tablas (355 filas en origen, sin riesgo de
UNION/duplicados ocultos como en produccion_pozos).

Uso:
    py -3 postgres_migration/etl/06_extract_produccion_operador_ip.py
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
            sql_cn, pg, "stg_empresas_ip_hist",
            """SELECT ID_CONTRATO, CONTRATO, CONTRATISTA_CORTO, MODIFICACION,
                      VIG_INICIO, VIG_FIN, ID_TIPO_PART, INTERES_PART
               FROM cmde_public.dbo.empresas_ip_hist""",
            ["id_contrato", "contrato", "contratista_corto", "modificacion",
             "vig_inicio", "vig_fin", "id_tipo_part", "interes_part"],
            "cmde_public.dbo.empresas_ip_hist",
        )
    finally:
        sql_cn.close()
        pg.close()
