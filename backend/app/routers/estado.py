from fastapi import APIRouter, Depends, Query
from sqlalchemy.engine import Engine
from app.database import get_db_dep
from app.services.estado_service import get_por_estado

router = APIRouter(prefix="/estado", tags=["estado"])


@router.get("/")
def produccion_estado(
    start_year: int = Query(2019),
    end_year: int = Query(2023),
    start_month: int = Query(1),
    end_month: int = Query(12),
    period: str = Query("annually"),
    engine: Engine = Depends(get_db_dep),
):
    return get_por_estado(engine, start_year, end_year, start_month, end_month, period)
