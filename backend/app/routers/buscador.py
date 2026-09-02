from fastapi import APIRouter, Depends, Query
from sqlalchemy.engine import Engine
from app.database import get_db_dep
from app.services.buscador_service import buscar

router = APIRouter(prefix="/buscar", tags=["buscador"])


@router.get("/")
def buscador_global(q: str = Query("", max_length=100), engine: Engine = Depends(get_db_dep)):
    return buscar(engine, q)
