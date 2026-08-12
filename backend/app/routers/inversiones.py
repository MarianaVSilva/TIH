from fastapi import APIRouter, Depends, Query
from sqlalchemy.engine import Engine
from app.database import get_db_dep
from app.services.inversiones_service import get_inversiones, get_inversiones_cuenca, get_inversiones_contrato

router = APIRouter(prefix="/inversiones", tags=["inversiones"])


@router.get("/")
def inversiones(
    start_year: int = Query(2016),
    end_year: int = Query(2023),
    subtopic: str = Query("estado"),
    engine: Engine = Depends(get_db_dep),
):
    if subtopic == "InvCuenca":
        return get_inversiones_cuenca(engine, start_year, end_year)
    if subtopic == "InvCont":
        return get_inversiones_contrato(engine, start_year, end_year)
    return get_inversiones(engine, start_year, end_year, subtopic)
