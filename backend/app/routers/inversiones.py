from fastapi import APIRouter, Depends, Query
from sqlalchemy.engine import Engine
from app.database import get_db_dep
from app.services.inversiones_service import get_inversiones

router = APIRouter(prefix="/inversiones", tags=["inversiones"])


@router.get("/")
def inversiones(
    start_year: int = Query(2016),
    end_year: int = Query(2023),
    subtopic: str = Query("estado"),
    engine: Engine = Depends(get_db_dep),
):
    return get_inversiones(engine, start_year, end_year, subtopic)
