import math
import json
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.gzip import GZipMiddleware
from app.config import settings
from app.routers import temas, produccion, reservas, contratos, precios, inversiones, estado, perforacion, chat, resumen, buscador
from app.services import pozos_cache


def _sanitize(obj):
    """Reemplaza NaN/Inf de float (no serializables en JSON) con None."""
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    return obj


class SafeJSONResponse(JSONResponse):
    def render(self, content) -> bytes:
        return json.dumps(_sanitize(content), ensure_ascii=False).encode("utf-8")


app = FastAPI(
    default_response_class=SafeJSONResponse,
    title="TIH – Tablero de Información de Hidrocarburos",
    description="API moderna para consulta de información estadística de hidrocarburos.",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Comprime respuestas grandes (p. ej. "Descargar todo" en Actividad Petrolera,
# ~10MB de JSON sin comprimir para 150k filas) — reduce bastante el tiempo de
# transferencia sin tocar dependencias nuevas (GZipMiddleware ya viene con
# Starlette, que FastAPI ya trae). compresslevel bajo (no el default 9): con
# payloads de este tamaño, comprimir al máximo cuesta más CPU de lo que ahorra
# en transferencia — nivel 3 sigue comprimiendo JSON repetitivo ~8-10x pero en
# una fracción del tiempo.
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=3)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "frame-ancestors 'none'; "
        "base-uri 'self'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    return response

PREFIX = "/api/v1"
app.include_router(temas.router,      prefix=PREFIX)
app.include_router(buscador.router,   prefix=PREFIX)
app.include_router(produccion.router, prefix=PREFIX)
app.include_router(reservas.router,   prefix=PREFIX)
app.include_router(contratos.router,  prefix=PREFIX)
app.include_router(precios.router,    prefix=PREFIX)
app.include_router(inversiones.router, prefix=PREFIX)
app.include_router(estado.router,       prefix=PREFIX)
app.include_router(perforacion.router,  prefix=PREFIX)
app.include_router(chat.router,         prefix=PREFIX)
app.include_router(resumen.router,      prefix=PREFIX)


@app.get(f"{PREFIX}/health", tags=["health"])
def health():
    return {"status": "ok", "version": "2.0.0"}


@app.on_event("startup")
def _startup():
    # Refresca el caché de Pozos solo si nunca se sincronizó o ya pasó más
    # de un día — no requiere que el usuario haga nada.
    pozos_cache.maybe_auto_refresh()
    # Arma el catalogo del buscador global en segundo plano: sin esto la
    # primera busqueda paga el barrido completo de pozos (~5 s).
    from app.database import engine as _engine
    from app.services import buscador_service
    buscador_service.precalentar(_engine)
