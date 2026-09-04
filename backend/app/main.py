import math
import json
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.gzip import GZipMiddleware
from app.config import settings
from app.routers import temas, produccion, reservas, contratos, precios, inversiones, estado, perforacion, chat, resumen, buscador, uso
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
    # /docs, /redoc y /openapi.json solo si DOCS_ENABLED=true. En produccion
    # enumeran toda la superficie de la API a cualquiera; se dejan apagados.
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url="/redoc" if settings.docs_enabled else None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    # Sin cookies: el panel de admin autentica con un header, no con sesion de
    # navegador. allow_credentials=True obliga a origenes exactos y no aporta
    # nada aqui, asi que se apaga. Metodos y headers acotados a lo que se usa.
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Admin-Key"],
    max_age=3600,
)


@app.middleware("http")
async def limite_tamano_cuerpo(request: Request, call_next):
    """Rechaza cuerpos gigantes por Content-Length antes de leerlos. Los POST
    de este API son diminutos (eventos de telemetria); cualquier cosa grande
    es un intento de agotar memoria."""
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > settings.max_body_bytes:
        return SafeJSONResponse({"detail": "Cuerpo de la peticion demasiado grande."}, status_code=413)
    return await call_next(request)


@app.exception_handler(Exception)
async def error_no_controlado(request: Request, exc: Exception):
    """Nunca devolver una traza ni el mensaje interno al cliente: filtraria
    nombres de tablas, rutas y detalles utiles para un atacante. Se registra
    en el log del servidor y al cliente le llega un mensaje generico."""
    import logging
    logging.getLogger("tih").exception("Error no controlado en %s", request.url.path)
    return SafeJSONResponse({"detail": "Error interno del servidor."}, status_code=500)
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
    # Nota: estas respuestas son JSON de la API. La CSP que de verdad protege
    # la aplicacion es la del HTML, y ese lo sirve Apache (ver
    # deploy/apache_tih.conf) — alli va la CSP con la lista de origenes que el
    # frontend necesita. Aqui se manda una CSP minima igualmente, por defensa
    # en profundidad si alguien abre una respuesta de la API directo.
    response.headers["Content-Security-Policy"] = (
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    return response

PREFIX = "/api/v1"
app.include_router(temas.router,      prefix=PREFIX)
app.include_router(buscador.router,   prefix=PREFIX)
app.include_router(uso.router,        prefix=PREFIX)
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
