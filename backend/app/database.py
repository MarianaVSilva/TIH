import pyodbc
from sqlalchemy import create_engine
from app.config import settings


def _make_connection():
    """
    Crea la conexión directamente con pyodbc para evitar problemas de
    URL-encoding con contraseñas que contienen caracteres especiales
    o instancias nombradas con backslash. Sin DB_USER (servidor local con
    Windows Auth) usa Trusted_Connection en vez de UID/PWD; sin DB_INSTANCE
    no concatena el backslash (instancia default).
    """
    server = f"{settings.db_server}\\{settings.db_instance}" if settings.db_instance else settings.db_server
    auth = "Trusted_Connection=yes;" if not settings.db_user else f"UID={settings.db_user};PWD={settings.db_password};"
    conn_str = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={server};"
        f"DATABASE={settings.db_name};"
        f"{auth}"
        "TrustServerCertificate=yes;"
    )
    return pyodbc.connect(conn_str, timeout=30)


def _make_mssql_engine():
    return create_engine(
        "mssql+pyodbc://",
        creator=_make_connection,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
    )


def _make_postgres_engine():
    # Motor nuevo (ver postgres_migration/) -- el backend consulta solo el
    # schema `api`, nunca staging/core directamente.
    url = (
        f"postgresql+psycopg2://{settings.pg_user}:{settings.pg_password}"
        f"@{settings.pg_host}:{settings.pg_port}/{settings.pg_database}"
    )
    return create_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=10)


engine = _make_postgres_engine() if settings.db_engine == "postgres" else _make_mssql_engine()


def get_db_dep():
    yield engine
