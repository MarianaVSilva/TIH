"""ETL: PRODUCCION_POZOS (el dominio mas grande y mas complejo, ver
DATABASE_DEPENDENCIES.md "Correccion post-migracion"). Extrae:
  - cmde_raw.dbo.bd_pozos (catalogo maestro de pozos, crudo)
  - cmde_valid.dbo.PRODUCCION_POZOS_A2016 (historico <=2016, 2.77M filas)
  - cmde_raw.dbo.sih_well_name_link_p_inf6016 (enlace nombre->WID)
  - cmde_valid.dbo.ENTITLEMENTS_GENERAL_INFO (nombres de bloque, vigente)

Usa COPY (via common.copy_rows) en vez de executemany -- con 2.77M filas,
INSERT fila por fila tardaba ~3 horas; COPY tarda minutos.

Uso:
    py -3 postgres_migration/etl/05_extract_produccion_pozos.py
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

    sql_raw = sqlserver_conn("cmde_raw")
    load(
        sql_raw, pg, "stg_bd_pozos",
        """SELECT WELL_ID, BOREHOLE_ID, WELL_NAME, [TYPE], [RESULT], CURRENT_CONDITION,
                  STATUS, DRILLING_START_DATE, DRILLING_FINISH_DATE, COMPLETION_START_DATE,
                  COMPLETION_FINISH_DATE, BLOCK_ID_CURRENT, OPERATOR, ALTERNATE_WELL,
                  SIDETRACK, ENVIRONMENT, GEOLOGICAL_PROVINCE, PETROLEUM_PROVINCE, FIELD,
                  STATE, MUNICIPALITY, DEPTH_MD, CATEGORY, UPDATE_DATE
           FROM cmde_raw.dbo.bd_pozos""",
        ["well_id", "borehole_id", "well_name", "type", "result", "current_condition",
         "status", "drilling_start_date", "drilling_finish_date", "completion_start_date",
         "completion_finish_date", "block_id_current", "operator", "alternate_well",
         "sidetrack", "environment", "geological_province", "petroleum_province", "field",
         "state", "municipality", "depth_md", "category", "update_date"],
        "cmde_raw.dbo.bd_pozos",
    )
    load(
        sql_raw, pg, "stg_sih_well_name_link",
        "SELECT NOMBRE_POZO, WELL_NAME, WELL_ID, WID FROM cmde_raw.dbo.sih_well_name_link_p_inf6016",
        ["nombre_pozo", "well_name", "well_id", "wid"],
        "cmde_raw.dbo.sih_well_name_link_p_inf6016",
    )
    sql_raw.close()

    sql_valid = sqlserver_conn("cmde_valid")
    load(
        sql_valid, pg, "stg_produccion_pozos_a2016",
        """SELECT fecha, uwi, well_id, well_name, cuenca, block_id, asignacion_contrato,
                  gas_mmpcd, gas_asoc_mmpcd, gas_nasoc_mmpcd, condensado_mbd, petroleo_mbd, agua_mbd
           FROM cmde_valid.dbo.PRODUCCION_POZOS_A2016""",
        ["fecha", "uwi", "well_id", "well_name", "cuenca", "block_id", "asignacion_contrato",
         "gas_mmpcd", "gas_asoc_mmpcd", "gas_nasoc_mmpcd", "condensado_mbd", "petroleo_mbd", "agua_mbd"],
        "cmde_valid.dbo.PRODUCCION_POZOS_A2016",
    )
    load(
        sql_valid, pg, "stg_entitlements_general_info",
        "SELECT BLOCK_ID, BLOCK_NAME FROM cmde_valid.dbo.ENTITLEMENTS_GENERAL_INFO",
        ["block_id", "block_name"],
        "cmde_valid.dbo.ENTITLEMENTS_GENERAL_INFO",
    )
    sql_valid.close()
    pg.close()
