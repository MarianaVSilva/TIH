from typing import Optional
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
    period: str = Query("monthly"),
    # Rango exacto día a día, solo usado con period="daily" (selector de
    # calendario en el front) — si vienen, reemplazan start_year/end_year/
    # start_month/end_month para armar el BETWEEN.
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    engine: Engine = Depends(get_db_dep),
):
    return get_precios(engine, start_year, end_year, start_month, end_month, period, start_date, end_date)
