"""ETL: PRODUCCION_CAMPOS. Fuente real (ver DATABASE_DEPENDENCIES.md):
UNION de cmde_valid.dbo.vm_produccion_campos_d2016 (vigente) y
cmde_valid.dbo.produccion_campos_a2016 (historico <=2016, con remapeo de
id_operador/operador). Verificado contra INFORMATION_SCHEMA antes de
escribir el SELECT (evitar el error de columnas inventadas del script anterior).

Uso:
    py -3 postgres_migration/etl/04_extract_produccion_campos.py
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


def check_columns(sql_cn, schema, table, expected):
    cur = sql_cn.cursor()
    cur.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?",
        schema, table,
    )
    real = {r[0].lower() for r in cur.fetchall()}
    missing = [c for c in expected if c.lower() not in real]
    if missing:
        raise RuntimeError(f"{schema}.{table}: columnas inexistentes {missing}. Reales: {sorted(real)}")


if __name__ == "__main__":
    sql_cn = sqlserver_conn("cmde_valid")
    pg = pg_conn()

    cols_new = ["campo_portal", "latitud", "longitud", "ubicacion", "cuenca", "id_operador",
                "operador", "fecha", "tipo", "asig_cont", "petroleo_s", "petroleo_api",
                "dias_produccion", "region", "gas_mmbtud", "petroleo_mbd", "gas_asoc_mmpcd",
                "gas_nasoc_mmpcd", "gas_mmpcd", "condensado_mbd", "agua_mbd", "c1_mmpcd",
                "c2_mmpcd", "c3_mmpcd", "c4_mmpcd", "ic4_mmpcd", "co2_mmpcd", "c5_plus_mmpcd",
                "h2s_mmpcd", "n2_mmpcd", "h2o_mmpcd", "id"]
    cols_old = [c for c in cols_new if c not in ("id_operador", "agua_mbd")]

    check_columns(sql_cn, "dbo", "vm_produccion_campos_d2016", cols_new)
    check_columns(sql_cn, "dbo", "produccion_campos_a2016", cols_old)
    print("Columnas verificadas OK contra INFORMATION_SCHEMA")

    try:
        load(
            sql_cn, pg, "stg_vm_produccion_campos_d2016",
            f"SELECT {', '.join(cols_new)} FROM cmde_valid.dbo.vm_produccion_campos_d2016",
            cols_new, "cmde_valid.dbo.vm_produccion_campos_d2016",
        )
        load(
            sql_cn, pg, "stg_produccion_campos_a2016",
            f"SELECT {', '.join(cols_old)} FROM cmde_valid.dbo.produccion_campos_a2016",
            cols_old, "cmde_valid.dbo.produccion_campos_a2016",
        )
    finally:
        sql_cn.close()
        pg.close()
