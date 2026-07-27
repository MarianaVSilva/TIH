from fastapi import APIRouter, Depends, Query
from sqlalchemy.engine import Engine
from app.database import get_db_dep
from app.services.precios_service import get_precios

router = APIRouter(prefix="/precios", tags=["precios"])


@router.get("/")
def precios(
    start_year: int = Query(2015),
    end_year: int = Query(2023),
    start_month: int = Query(1),
    end_month: int = Query(12),
    engine: Engine = Depends(get_db_dep),
):
    return get_precios(engine, start_year, end_year, start_month, end_month)
