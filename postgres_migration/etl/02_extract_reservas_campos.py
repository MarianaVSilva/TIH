"""ETL: RESERVAS_CAMPOS. Fuente real (ver DATABASE_DEPENDENCIES.md):
cmde_raw.dbo.sih_reservas_c LEFT JOIN cmde_raw.dbo.campos_loc.

Uso:
    py -3 postgres_migration/etl/02_extract_reservas_campos.py
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import sqlserver_conn, pg_conn, log_etl_start, log_etl_end


def extract_table(sql_cn, pg, staging_table, columns_sql, columns_stg, source_desc, source_table):
    batch_id = log_etl_start(pg, f"staging.{staging_table}", source_desc)
    try:
        cur = sql_cn.cursor()
        cur.execute(f"SELECT {columns_sql} FROM {source_table}")
        rows = cur.fetchall()
        leidas = len(rows)
        cols = ", ".join(columns_stg)
        placeholders = ", ".join(["%s"] * (len(columns_stg) + 1))
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
    sql_cn = sqlserver_conn("cmde_raw")
    pg = pg_conn()
    try:
        extract_table(
            sql_cn, pg, "stg_sih_reservas_c",
            "[date], field_id, class_desc, vo_aceite_mmb, vo_gas_mmmpc, pce_mmbpce, "
            "aceite_mmb, gas_mmmpc, condensado_mmb, liquidos_planta_mmb, gas_seco_mmbpce, gas_seco_mmmpc",
            ["date", "field_id", "class_desc", "vo_aceite_mmb", "vo_gas_mmmpc", "pce_mmbpce",
             "aceite_mmb", "gas_mmmpc", "condensado_mmb", "liquidos_planta_mmb", "gas_seco_mmbpce", "gas_seco_mmmpc"],
            "cmde_raw.dbo.sih_reservas_c", "cmde_raw.dbo.sih_reservas_c",
        )
        extract_table(
            sql_cn, pg, "stg_campos_loc",
            "id_campo, campo, campo_nombre, cuenca, cuenca_bloque, ubicacion, latitud, longitud",
            ["id_campo", "campo", "campo_nombre", "cuenca", "cuenca_bloque", "ubicacion", "latitud", "longitud"],
            "cmde_raw.dbo.campos_loc", "cmde_raw.dbo.campos_loc",
        )
    finally:
        sql_cn.close()
        pg.close()
