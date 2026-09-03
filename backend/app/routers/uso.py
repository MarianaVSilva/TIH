"""Endpoints de telemetría y del panel de administrador.

Dos niveles de acceso muy distintos:

- `POST /uso/evento` es **público**: lo llama el propio tablero desde el
  navegador de cada visitante, que por definición no tiene credenciales. Solo
  escribe, nunca lee, y valida el tipo de evento para que no sirva de vertedero.
- El resto **exige la clave de administrador** (`X-Admin-Key`, contra
  `admin_key` de la configuración). Ahí es donde se leen las métricas, que
  incluyen IPs.
"""

import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine

from app.config import settings
from app.database import get_db_dep
from app.services import uso_service

router = APIRouter(prefix="/uso", tags=["uso"])


class EventoIn(BaseModel):
    sesion: str = Field(max_length=40)
    tipo: str = Field(max_length=20)
    seccion: str | None = Field(default=None, max_length=120)
    tema: str | None = Field(default=None, max_length=120)
    detalle: str | None = Field(default=None, max_length=200)


def _ip(request: Request) -> str | None:
    """IP real del visitante. Detrás de Apache/Nginx la conexión viene del
    proxy, así que manda X-Forwarded-For si está presente."""
    reenviada = request.headers.get("x-forwarded-for")
    if reenviada:
        return reenviada.split(",")[0].strip()
    return request.client.host if request.client else None


def _exigir_admin(x_admin_key: str | None = Header(default=None)) -> None:
    """Clave de administrador. Se compara en tiempo constante para no filtrar
    por cuánto tarda en fallar, y se rechaza si no hay clave configurada: sin
    eso, un despliegue sin `admin_key` en el .env dejaría el panel abierto."""
    esperada = (settings.admin_key or "").strip()
    if not esperada:
        raise HTTPException(status_code=503, detail="El panel de administrador no está configurado (falta admin_key).")
    if not x_admin_key or not secrets.compare_digest(x_admin_key, esperada):
        raise HTTPException(status_code=401, detail="Clave de administrador incorrecta.")


@router.post("/evento", status_code=204)
def registrar_evento(evento: EventoIn, request: Request, engine: Engine = Depends(get_db_dep)):
    uso_service.registrar(
        engine, sesion=evento.sesion, tipo=evento.tipo, ip=_ip(request),
        seccion=evento.seccion, tema=evento.tema, detalle=evento.detalle,
    )
    return None


@router.get("/verificar")
def verificar_clave(_: None = Depends(_exigir_admin)):
    """Sirve para que el panel valide la clave antes de mostrarse."""
    return {"ok": True}


@router.get("/metricas")
def metricas(
    desde: str | None = Query(default=None),
    hasta: str | None = Query(default=None),
    _: None = Depends(_exigir_admin),
    engine: Engine = Depends(get_db_dep),
):
    return uso_service.metricas(engine, desde, hasta)


@router.post("/purgar")
def purgar(
    dias: int = Query(default=365, ge=30),
    _: None = Depends(_exigir_admin),
    engine: Engine = Depends(get_db_dep),
):
    return {"borrados": uso_service.purgar(engine, dias)}
