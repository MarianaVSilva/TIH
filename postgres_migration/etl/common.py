"""Conexiones compartidas para los scripts de ETL SQL Server -> Postgres.

Lee credenciales de SQL Server desde backend/.env (mismas que usa el backend
de FastAPI) y de Postgres desde postgres_migration/.env (instancia de
destino, staging/core/api).
"""
import csv
import io
import os
import pathlib
import pyodbc
import psycopg2
from dotenv import load_dotenv

ROOT = pathlib.Path(__file__).resolve().parents[2]
load_dotenv(ROOT / "backend" / ".env")
load_dotenv(ROOT / "postgres_migration" / ".env", override=False)


def sqlserver_conn(database: str | None = None):
    db = database or os.environ["DB_NAME"]
    conn_str = (
        "DRIVER={ODBC Driver 17 for SQL Server};"
        f"SERVER={os.environ['DB_SERVER']}\\{os.environ['DB_INSTANCE']};"
        f"DATABASE={db};"
        f"UID={os.environ['DB_USER']};PWD={os.environ['DB_PASSWORD']};"
        "TrustServerCertificate=yes;"
    )
    return pyodbc.connect(conn_str, timeout=15)


def pg_conn():
    return psycopg2.connect(
        host=os.environ["PG_HOST"],
        port=os.environ["PG_PORT"],
        dbname=os.environ["PG_DATABASE"],
        user=os.environ["PG_USER"],
        password=os.environ["PG_PASSWORD"],
    )


def log_etl_start(pg, tabla_staging: str, fuente: str) -> int:
    with pg.cursor() as cur:
        cur.execute(
            "INSERT INTO ops.etl_log (tabla_staging, fuente) VALUES (%s, %s) RETURNING id",
            (tabla_staging, fuente),
        )
        batch_id = cur.fetchone()[0]
    pg.commit()
    return batch_id


def copy_rows(pg, table: str, columns: list[str], rows, batch_id: int):
    """Carga masiva vía COPY (mucho mas rapido que executemany para
    tablas grandes -- INSERT fila por fila con 2.7M filas tarda horas,
    COPY tarda segundos/minutos)."""
    all_cols = columns + ["_load_batch_id"]
    buf = io.StringIO()
    writer = csv.writer(buf)
    n = 0
    for r in rows:
        writer.writerow(list(r) + [batch_id])
        n += 1
    buf.seek(0)
    with pg.cursor() as cur:
        cur.copy_expert(
            f"COPY staging.{table} ({', '.join(all_cols)}) FROM STDIN WITH (FORMAT csv, NULL '')",
            buf,
        )
    return n


def log_etl_end(pg, batch_id: int, filas_leidas: int, filas_cargadas: int, estado: str = "OK", error: str | None = None):
    with pg.cursor() as cur:
        cur.execute(
            """UPDATE ops.etl_log SET filas_leidas=%s, filas_cargadas=%s,
               terminado_en=now(), estado=%s, error_detalle=%s WHERE id=%s""",
            (filas_leidas, filas_cargadas, estado, error, batch_id),
        )
    pg.commit()
