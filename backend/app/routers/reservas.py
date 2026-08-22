from fastapi import APIRouter, Depends, Query
from sqlalchemy.engine import Engine
from app.database import get_db_dep
from app.services.reservas_service import get_reservas_por_campo, get_reservas_asignacion_contrato, get_categorias_disponibles

router = APIRouter(prefix="/reservas", tags=["reservas"])


@router.get("/categorias")
def categorias(engine: Engine = Depends(get_db_dep)):
    return get_categorias_disponibles(engine)


@router.get("/")
def reservas(
    start_year: int = Query(2015),
    end_year: int = Query(2023),
    tipo: str = Query("ReservasP"),
    engine: Engine = Depends(get_db_dep),
):
    if tipo.startswith("ReservasAsig"):
        return get_reservas_asignacion_contrato(engine, start_year, end_year, tipo)
    return get_reservas_por_campo(engine, start_year, end_year, tipo)
