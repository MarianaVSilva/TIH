from fastapi import APIRouter, Depends, Query
from sqlalchemy.engine import Engine
from app.database import get_db_dep
from app.services.temas_service import get_temas, get_rango_anios

router = APIRouter(prefix="/temas", tags=["temas"])


@router.get("/")
def list_temas(engine: Engine = Depends(get_db_dep)):
    return get_temas(engine)


@router.get("/rango-anios")
def rango_anios(topic: str = Query(...), engine: Engine = Depends(get_db_dep)):
    return get_rango_anios(engine, topic)
