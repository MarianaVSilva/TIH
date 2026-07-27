import threading
import time
from datetime import datetime, timedelta
import pyodbc
from app.config import settings

CACHE_DB = "TIH_pozos_cache"
STALE_AFTER = timedelta(hours=24)

_lock = threading.Lock()
_status = {"status": "nunca_sincronizado", "last_refreshed_at": None, "row_count": None, "error": None}


def _server() -> str:
    return f"{settings.db_server}\\{settings.db_instance}" if settings.db_instance else settings.db_server


def _connect(database: str = "master") -> pyodbc.Connection:
    conn_str = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={_server()};"
        f"DATABASE={database};"
        "Trusted_Connection=yes;"
        "TrustServerCertificate=yes;"
    )
    return pyodbc.connect(conn_str, autocommit=True, timeout=30)


def _leer_meta_db() -> dict:
    """La verdad sobre el estado del caché vive en la BD, no en memoria del
    proceso — el backend se reinicia manualmente seguido (sin --reload) y
    perdería el estado en cada reinicio si solo viviera en `_status`."""
    try:
        conn = _connect(CACHE_DB)
        cur = conn.cursor()
        cur.execute("SELECT [key], value FROM dbo.cache_meta")
        rows = cur.fetchall()
        conn.close()
        return {r[0]: r[1] for r in rows}
    except Exception:
        return {}


def is_cache_available() -> bool:
    return get_cache_status()["status"] == "idle"


def get_cache_status() -> dict:
    with _lock:
        if _status["status"] == "sincronizando":
            return dict(_status)
    meta = _leer_meta_db()
    if not meta:
        return {"status": "nunca_sincronizado", "last_refreshed_at": None, "row_count": None, "error": None}
    return {
        "status": meta.get("status", "idle"),
        "last_refreshed_at": meta.get("last_refreshed_at"),
        "row_count": int(meta["row_count"]) if meta.get("row_count") else None,
        "error": None,
    }


def _index_exists(cur, database: str, object_name: str, index_name: str) -> bool:
    # sys.indexes es un catálogo por-BD: hay que consultarlo en la BD dueña
    # del objeto (database.sys.indexes), no en la BD de la conexión actual.
    cur.execute(f"SELECT 1 FROM {database}.sys.indexes WHERE object_id = OBJECT_ID('{object_name}') AND name = '{index_name}'")
    return cur.fetchone() is not None


def _asegurar_indices_fuente(cur):
    """Índices ligeros sobre las tablas fuente que quedan en el propio clon
    local del usuario (bd_pozos, cat_pozos) — no se duplican, se indexan
    donde ya están, sin riesgo por ser su propia copia local."""
    if not _index_exists(cur, settings.db_name, f"{settings.db_name}.dbo.cat_pozos", "ix_cat_pozos_well_id"):
        cur.execute(f"CREATE INDEX ix_cat_pozos_well_id ON {settings.db_name}.dbo.cat_pozos(well_id)")
    if not _index_exists(cur, "cmde_raw", "cmde_raw.dbo.bd_pozos", "ix_bd_pozos_well_id"):
        cur.execute("CREATE INDEX ix_bd_pozos_well_id ON cmde_raw.dbo.bd_pozos(WELL_ID)")


def _refrescar():
    t0 = time.time()
    with _lock:
        _status.update(status="sincronizando", error=None)
    try:
        master = _connect("master")
        cur = master.cursor()
        cur.execute(f"IF DB_ID('{CACHE_DB}') IS NULL CREATE DATABASE {CACHE_DB}")
        master.close()

        conn = _connect(CACHE_DB)
        cur = conn.cursor()
        cur.execute("""
            IF OBJECT_ID('dbo.cache_meta') IS NULL
            CREATE TABLE dbo.cache_meta ([key] VARCHAR(50) PRIMARY KEY, value VARCHAR(200))
        """)
        cur.execute("IF OBJECT_ID('dbo.produccion_pozos') IS NOT NULL DROP TABLE dbo.produccion_pozos")
        cur.execute(f"""
            SELECT * INTO dbo.produccion_pozos
            FROM {settings.db_name}.{settings.db_schema}.PRODUCCION_POZOS
        """)
        # La vista fuente produce UWI/BLOCK_ID/ASIG_CONT como *(MAX) por los
        # REPLACE/UPPER anidados que hace — un tipo MAX no se puede indexar,
        # hay que acotarlo primero.
        cur.execute("ALTER TABLE dbo.produccion_pozos ALTER COLUMN ASIG_CONT NVARCHAR(300)")
        cur.execute("ALTER TABLE dbo.produccion_pozos ALTER COLUMN UWI VARCHAR(100)")
        cur.execute("ALTER TABLE dbo.produccion_pozos ALTER COLUMN BLOCK_ID VARCHAR(100)")
        cur.execute("CREATE INDEX ix_pp_well_fecha ON dbo.produccion_pozos(WELL_ID, FECHA)")
        cur.execute("CREATE INDEX ix_pp_asig_fecha ON dbo.produccion_pozos(ASIG_CONT, FECHA)")
        cur.execute("CREATE INDEX ix_pp_cuenca ON dbo.produccion_pozos(CUENCA)")
        _asegurar_indices_fuente(cur)

        cur.execute("SELECT COUNT(*) FROM dbo.produccion_pozos")
        row_count = cur.fetchone()[0]

        for k, v in [("status", "idle"), ("last_refreshed_at", time.strftime("%Y-%m-%d %H:%M:%S")), ("row_count", str(row_count))]:
            cur.execute("MERGE dbo.cache_meta AS t USING (SELECT ? AS k, ? AS v) AS s ON t.[key]=s.k "
                        "WHEN MATCHED THEN UPDATE SET value=s.v WHEN NOT MATCHED THEN INSERT ([key],value) VALUES (s.k,s.v);", k, v)
        conn.close()

        with _lock:
            _status.update(status="idle", row_count=row_count, last_refreshed_at=time.strftime("%Y-%m-%d %H:%M:%S"), error=None)
        print(f"[pozos_cache] refrescado: {row_count} filas en {round(time.time()-t0,1)}s")
    except Exception as e:
        with _lock:
            _status.update(status="error", error=str(e))
        print(f"[pozos_cache] ERROR: {e}")


def trigger_refresh() -> dict:
    if _status["status"] == "sincronizando":
        return get_cache_status()
    threading.Thread(target=_refrescar, daemon=True).start()
    return get_cache_status()


def maybe_auto_refresh():
    """Dispara el refresco solo, sin que el usuario tenga que pedirlo: al
    arrancar el backend, si el caché nunca se sincronizó o ya pasó más de
    STALE_AFTER desde la última vez. Se llama una vez en el startup de la
    app (main.py) — no bloquea el arranque, corre en background."""
    status = get_cache_status()
    if status["status"] == "sincronizando":
        return
    if status["status"] == "nunca_sincronizado":
        trigger_refresh()
        return
    last = status.get("last_refreshed_at")
    if last:
        try:
            edad = datetime.now() - datetime.strptime(last, "%Y-%m-%d %H:%M:%S")
            if edad > STALE_AFTER:
                trigger_refresh()
        except ValueError:
            trigger_refresh()
