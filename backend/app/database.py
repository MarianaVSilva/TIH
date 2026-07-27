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
    return pyodbc.connect(conn_str)


engine = create_engine(
    "mssql+pyodbc://",
    creator=_make_connection,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)


def get_db_dep():
    yield engine
