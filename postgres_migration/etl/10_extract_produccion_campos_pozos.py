"""ETL: PRODUCCION_CAMPOS_POZOS (conteo de pozos operando por campo) --
dominio completo que se paso por alto (nunca estuvo en la lista de "8
dominios" original, encontrado al portar produccion_service.py:get_pozos_operando).
Fuente real (ver DATABASE_DEPENDENCIES.md): UNION de
cmde_valid.dbo.produccion_campos_pozos_a2016 (historico) + agregado sobre
cmde_valid.dbo.sih_produccion_d2016/cat_campos_alias (vigente).

Uso:
    py -3 postgres_migration/etl/10_extract_produccion_campos_pozos.py
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
    sql_cn = sqlserver_conn("cmde_valid")
    pg = pg_conn()
    try:
        load(
            sql_cn, pg, "stg_produccion_campos_pozos_a2016",
            "SELECT fecha, campo_portal, cuenca, pozos_aceite, pozos_gas, ubicacion FROM cmde_valid.dbo.produccion_campos_pozos_a2016",
            ["fecha", "campo_portal", "cuenca", "pozos_aceite", "pozos_gas", "ubicacion"],
            "cmde_valid.dbo.produccion_campos_pozos_a2016",
        )
        load(
            sql_cn, pg, "stg_cat_campos_alias",
            "SELECT campo_alias, id_campo, campo_nombre FROM cmde_valid.dbo.cat_campos_alias",
            ["campo_alias", "id_campo", "campo_nombre"],
            "cmde_valid.dbo.cat_campos_alias",
        )
    finally:
        sql_cn.close()
        pg.close()
