"""ETL: RESERVAS_ASIG_CONT / RESERVAS_ASIG_CONT_CAMPOS -- se paso por alto en
la primera ronda de migracion (encontrado al portar reservas_service.py:
core.fact_reservas_asignacion estaba vacia). Fuente real (ver
DATABASE_DEPENDENCIES.md): cmde_valid.dbo.sih_reservas LEFT JOIN
cmde_raw.dbo.campos_loc (ya cargada) + cmde_public.dbo.general_info_estados.

Uso:
    py -3 postgres_migration/etl/09_extract_reservas_asig_cont.py
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
    sql_valid = sqlserver_conn("cmde_valid")
    pg = pg_conn()
    try:
        load(
            sql_valid, pg, "stg_sih_reservas",
            """SELECT [DATE], BLOCK_ID, FIELD_ID, CLASS_ID, CLASS_DESC, NOTE,
                      PCE_MMBPCE, ACEITE_MMB, GAS_MMMPC, CONDENSADO_MMB,
                      LIQUIDOS_PLANTA_MMB, GAS_SECO_MMBPCE, GAS_SECO_MMMPC,
                      GAS_VENTA_MMMPC, VO_ACEITE_MMB, VO_GAS_MMMPC
               FROM cmde_valid.dbo.sih_reservas""",
            ["date", "block_id", "field_id", "class_id", "class_desc", "note",
             "pce_mmbpce", "aceite_mmb", "gas_mmmpc", "condensado_mmb",
             "liquidos_planta_mmb", "gas_seco_mmbpce", "gas_seco_mmmpc",
             "gas_venta_mmmpc", "vo_aceite_mmb", "vo_gas_mmmpc"],
            "cmde_valid.dbo.sih_reservas",
        )
    finally:
        sql_valid.close()

    sql_public = sqlserver_conn("cmde_public")
    try:
        load(
            sql_public, pg, "stg_general_info_estados",
            "SELECT DISTINCT block_id, block_name FROM dbo.general_info_estados",
            ["block_id", "block_name"],
            "cmde_public.dbo.general_info_estados",
        )
    finally:
        sql_public.close()
        pg.close()
