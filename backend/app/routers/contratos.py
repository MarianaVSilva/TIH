from fastapi import APIRouter, Depends, Query
from sqlalchemy.engine import Engine
from app.database import get_db_dep
from app.services.contratos_service import get_contratos, get_operadores

router = APIRouter(prefix="/contratos", tags=["contratos"])


@router.get("/")
def contratos(
    start_year: int = Query(2016),
    end_year: int = Query(2023),
    start_month: int = Query(1),
    end_month: int = Query(12),
    period: str = Query("monthly"),
    tipo: str = Query("CONTRATO"),
    engine: Engine = Depends(get_db_dep),
):
    return get_contratos(engine, start_year, end_year, start_month, end_month, period, tipo)


@router.get("/operadores")
def operadores(
    start_year: int = Query(2016),
    end_year: int = Query(2023),
    start_month: int = Query(1),
    end_month: int = Query(12),
    period: str = Query("monthly"),
    engine: Engine = Depends(get_db_dep),
):
    return get_operadores(engine, start_year, end_year, start_month, end_month, period)
