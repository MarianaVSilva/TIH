"""Puente SQL Server -> Postgres: corre todos los extractores en orden, luego
el transform completo, y refresca las materialized views de api.*. Pensado
para ejecutarse solo (Task Scheduler en Windows -- ver setup_bridge_task.ps1),
no a mano salvo para depurar.

Uso:
    py -3 postgres_migration/run_bridge.py

Registra cada paso en postgres_migration/logs/bridge_YYYYMMDD_HHMMSS.log y
también en ops.etl_log (via los scripts de extract, que ya llaman a
log_etl_start/log_etl_end individualmente).
"""
import subprocess
import sys
import pathlib
import time
import datetime

ROOT = pathlib.Path(__file__).resolve().parent
LOG_DIR = ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)

EXTRACT_SCRIPTS = [
    "01_extract_precios_cubos.py",
    "02_extract_reservas_campos.py",
    "03_extract_produccion_estado.py",
    "04_extract_produccion_campos.py",
    "05_extract_produccion_pozos.py",
    "06_extract_produccion_operador_ip.py",
    "07_extract_inversiones.py",
    "08_extract_licitaciones.py",
    "09_extract_reservas_asig_cont.py",
    "10_extract_produccion_campos_pozos.py",
    "11_extract_bd_pozos_valid.py",
]

TRANSFORM_SQL = ROOT / "sql" / "04_transform_staging_to_core.sql"


def _psql_env():
    import os
    env = dict(os.environ)
    # postgres_migration/.env trae PG_PASSWORD -- psql usa PGPASSWORD.
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("PG_PASSWORD="):
            env["PGPASSWORD"] = line.split("=", 1)[1].strip()
    return env


def _pg_conn_args():
    vals = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            vals[k.strip()] = v.strip()
    return vals


def main():
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    log_path = LOG_DIR / f"bridge_{ts}.log"
    t0 = time.time()
    ok = True

    with open(log_path, "w", encoding="utf-8") as log:
        def w(msg):
            line = f"[{datetime.datetime.now().isoformat(timespec='seconds')}] {msg}"
            print(line)
            log.write(line + "\n")
            log.flush()

        w("=== Puente SQL Server -> Postgres: inicio ===")

        for script in EXTRACT_SCRIPTS:
            w(f"--- extract: {script} ---")
            result = subprocess.run(
                [sys.executable, str(ROOT / "etl" / script)],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
            )
            log.write(result.stdout)
            log.write(result.stderr)
            if result.returncode != 0:
                w(f"FALLO en {script} (exit code {result.returncode}) -- se aborta el puente, transform NO se ejecuta")
                ok = False
                break
            w(f"OK: {script}")

        if ok:
            w("--- transform: 04_transform_staging_to_core.sql ---")
            pg = _pg_conn_args()
            psql = r"C:\Program Files\PostgreSQL\17\bin\psql.exe"
            result = subprocess.run(
                [psql, "-h", pg.get("PG_HOST", "localhost"), "-p", pg.get("PG_PORT", "5433"),
                 "-U", pg.get("PG_USER", "postgres"), "-d", pg.get("PG_DATABASE", "tih_pg"),
                 "-v", "ON_ERROR_STOP=1", "-f", str(TRANSFORM_SQL)],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                env=_psql_env(),
            )
            log.write(result.stdout)
            log.write(result.stderr)
            if result.returncode != 0:
                w(f"FALLO en el transform (exit code {result.returncode})")
                ok = False
            else:
                w("OK: transform")

        if ok:
            w("--- refresh materialized views ---")
            pg = _pg_conn_args()
            psql = r"C:\Program Files\PostgreSQL\17\bin\psql.exe"
            result = subprocess.run(
                [psql, "-h", pg.get("PG_HOST", "localhost"), "-p", pg.get("PG_PORT", "5433"),
                 "-U", pg.get("PG_USER", "postgres"), "-d", pg.get("PG_DATABASE", "tih_pg"),
                 "-v", "ON_ERROR_STOP=1", "-c", "SELECT ops.refresh_api_materialized_views();"],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                env=_psql_env(),
            )
            log.write(result.stdout)
            log.write(result.stderr)
            if result.returncode != 0:
                w(f"FALLO al refrescar materialized views (exit code {result.returncode})")
                ok = False
            else:
                w("OK: materialized views refrescadas")

        w(f"=== Puente terminado {'OK' if ok else 'CON ERRORES'} en {time.time()-t0:.0f}s ===")

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
