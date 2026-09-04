from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    db_engine: str = "mssql"  # "mssql" (por defecto, sin cambios) | "postgres" (ver postgres_migration/)
    db_server: str = "172.16.200.99"
    db_instance: str = "UMBRACODB"
    db_name: str = "cmde_public"
    db_user: str = "estadistica"
    db_password: str = ""
    db_schema: str = "dbo"
    pg_host: str = "localhost"
    pg_port: str = "5433"
    pg_database: str = "tih_pg"
    pg_user: str = "postgres"
    pg_password: str = ""
    cors_origins: str = "http://localhost:5173,http://localhost:5174,http://localhost:80"
    secret_key: str = "change-in-production"
    # Clave del panel de administrador (metricas de uso). Vacia = panel
    # deshabilitado: preferimos que no exista a que exista sin proteccion.
    admin_key: str = ""
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b"
    # Documentacion interactiva (/docs, /redoc, /openapi.json). Apagada por
    # defecto: en produccion enumera toda la API a cualquiera. Se enciende con
    # DOCS_ENABLED=true en el .env solo cuando se necesita depurar.
    docs_enabled: bool = False
    # Tope de tamano del cuerpo de una peticion (bytes). Corta cargas absurdas
    # antes de que lleguen a leerse. 1 MB sobra para todo lo que este API recibe
    # (los POST son eventos de telemetria diminutos).
    max_body_bytes: int = 1_048_576

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]

    model_config = {"env_file": ".env"}


settings = Settings()
