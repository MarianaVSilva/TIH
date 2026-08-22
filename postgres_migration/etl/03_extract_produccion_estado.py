"""ETL: PRODUCCION_ESTADO. Fuente real (ver DATABASE_DEPENDENCIES.md):
UNION de:
  - cmde_valid.dbo.sih_produccion_d2016 (agregado, actual)  JOIN  cat_entidades
  - cmde_valid.dbo.produccion_estado_a2016 (historico <=2016)

Uso:
    py -3 postgres_migration/etl/03_extract_produccion_estado.py
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
            total += copy_rows(pg, staging_table, pg_columns, rows, batch_id)
            pg.commit()
        log_etl_end(pg, batch_id, total, total, "OK")
        print(f"{staging_table}: {total} filas cargadas en {time.time()-t0:.0f}s")
    except Exception as e:
        pg.rollback()
        log_etl_end(pg, batch_id, 0, 0, "ERROR", str(e))
        raise


if __name__ == "__main__":
    sql_cn = sqlserver_conn("cmde_valid")
    pg = pg_conn()
    try:
        load(
            sql_cn, pg, "stg_cat_entidades",
            "SELECT ENT_ID, ENT_NOM FROM cmde_valid.dbo.cat_entidades",
            ["ent_id", "ent_nom"], "cmde_valid.dbo.cat_entidades",
        )
        load(
            sql_cn, pg, "stg_produccion_estado_a2016",
            """SELECT fecha, nom_ent, nom_mun, cve_mun, ubicacion, petroleo_mbd,
                      gas_mmpcd, gas_asoc_mmpcd, gas_nasoc_mmpcd, condensado_mbd, agua_mbd, cve_ent
               FROM cmde_valid.dbo.produccion_estado_a2016""",
            ["fecha", "nom_ent", "nom_mun", "cve_mun", "ubicacion", "petroleo_mbd",
             "gas_mmpcd", "gas_asoc_mmpcd", "gas_nasoc_mmpcd", "condensado_mbd", "agua_mbd", "cve_ent"],
            "cmde_valid.dbo.produccion_estado_a2016",
        )
        # sih_produccion_d2016 se usa completa tambien en PRODUCCION_CAMPOS_POZOS /
        # PRODUCCION_POZOS; se carga una sola vez con TODAS las columnas usadas por
        # los distintos dominios para no repetir la extraccion (933k+ filas).
        # OJO: esta tabla NO tiene columna ASIG_CONT (verificado contra
        # INFORMATION_SCHEMA.COLUMNS real -- staging.stg_sih_produccion_d2016
        # tenia ese campo puesto sin confirmar en el DDL original; se deja
        # la columna en staging para no romper el esquema pero no se llena
        # aqui, queda NULL).
        load(
            sql_cn, pg, "stg_sih_produccion_d2016",
            """SELECT FECHA, WELL_ID, WELL_NAME, CAMPO_ID, ENT_ID, CUENCA, UBICACION,
                      DIAS_MES, PETROLEO_MB, CONDENSADO_MB, GAS_MMPC, GAS_ASOC_MMPC,
                      GAS_NASOC_MMPC, AGUA_MB, N2_PERC_ASIG, BLOCK_ID
               FROM cmde_valid.dbo.sih_produccion_d2016""",
            ["fecha", "well_id", "well_name", "campo_id", "ent_id", "cuenca", "ubicacion",
             "dias_mes", "petroleo_mb", "condensado_mb", "gas_mmpc", "gas_asoc_mmpc",
             "gas_nasoc_mmpc", "agua_mb", "n2_perc_asig", "block_id"],
            "cmde_valid.dbo.sih_produccion_d2016",
        )
    finally:
        sql_cn.close()
        pg.close()
