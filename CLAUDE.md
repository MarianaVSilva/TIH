# TIH — Tablero de Información de Hidrocarburos

## Descripción
Dashboard web para consultar estadísticas de producción, reservas, contratos, inversiones y precios de hidrocarburos en México. Backend en FastAPI, frontend en React, sobre una base de datos SQL Server preexistente consumida principalmente en modo lectura.

## Stack
| Capa | Tecnología |
|---|---|
| Backend | Python, FastAPI, SQLAlchemy (motor de conexión, sin ORM), `pyodbc`, Pydantic |
| Frontend | React, Vite, Tailwind CSS |
| Infraestructura | Nginx como reverse proxy (`nginx/nginx.conf`), sin contenedores Docker |
| Chat | Ollama local (modelo `qwen2.5:7b`) — `routers/chat.py`, `services/chat_service.py` |

## Puesta en marcha

**Backend**
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```
Variables de entorno en `backend/.env` (referencia: `backend/.env.example`): credenciales de SQL Server (`db_server`, `db_instance`, `db_name`, `db_user`, `db_password`), CORS, URL de Ollama.

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

## Estructura del backend
```
backend/app/
  main.py            FastAPI app, CORS, security headers, registro de routers
  config.py           Settings (pydantic-settings), lee backend/.env
  database.py          Conexión a SQL Server vía pyodbc + engine de SQLAlchemy
  models/schemas.py     Esquemas Pydantic: ProduccionParams, ReservasParams, ContratosParams, ApiResponse
  routers/             Un router por dominio: produccion, reservas, contratos, precios,
                        inversiones, estado, perforacion, temas, chat, resumen
  services/             Lógica y SQL de cada dominio (mismo split que routers), más:
    cache_utils.py       Decorador @cached(), usado en la mayoría de los servicios
    pozos_cache.py        Replica PRODUCCION_POZOS a una tabla local dbo.produccion_pozos (caché)
```

**Patrón por dominio**: el router valida el input con Pydantic y lo delega al service correspondiente. El service construye el SQL (f-strings o `sqlalchemy.text()` con bind params) y lo ejecuta contra el `engine`.

No hay ORM de tablas: todas las consultas son SQL directo dentro de `services/*.py`. Esquema completo de tablas y columnas en [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md).

## Estructura del frontend
```
frontend/src/
  api/          Clientes HTTP hacia el backend
  components/    Componentes de UI (gráficas, tablas, layout)
  hooks/         Hooks de datos/estado
  store/         Estado global
  utils/
```

## Convenciones y particularidades
- Columnas de negocio en MAYÚSCULAS, español/inglés mezclado (`PETROLEO_MBD`, `ASIG_CONT`, `FECHA`, `CUENCA`), heredado del esquema de origen.
- `WHERE ID <> 1` se repite en varias queries sobre `PRODUCCION_CAMPOS`: excluye una fila de totales/placeholder con `ID = 1`. Confirmar antes de modificar el filtro o la tabla.
- El caché de `@cached()` vive en memoria; `pozos_cache.py` es la excepción, materializa una tabla local en la BD.
- `CONTEXTO_SESION_*.md` y `SESION_*.md` en la raíz son notas de sesiones de trabajo pasadas, no documentación formal del sistema.

## Notas para el rediseño de la base de datos
- La BD (`cmde_public`, instancia `UMBRACODB`) se consume en modo lectura, salvo:
  - `dbo.cache_meta` y `dbo.produccion_pozos`: tablas de caché gestionadas por `pozos_cache.py`.
  - `PRECIOS_AUTOM`: tabla creada por el backend si no existe, usada para guardar precios obtenidos automáticamente (`precios_service.py`).
- Al no haber ORM, cualquier cambio de nombre de tabla o columna en las tablas de origen (`PRODUCCION_*`, `RESERVAS_CAMPOS`, `INVERSIONES_APROBADAS`, `CUBOS`, etc.) requiere actualizar el SQL manualmente en `backend/app/services/*.py`. Cualquier cambio de esquema debe coordinarse con esa actualización.
- Detalle completo de tablas y columnas en [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md).
