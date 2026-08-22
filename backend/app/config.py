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
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]

    model_config = {"env_file": ".env"}


settings = Settings()
