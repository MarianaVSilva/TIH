from fastapi import APIRouter, Depends, Query
from sqlalchemy.engine import Engine
from app.database import get_db_dep
from app.services.contratos_service import get_contratos, get_operadores, get_pozos_comprometidos, get_pozos_comprometidos_detalle, get_ofertas_efectivo, get_inversion_comprometida, get_contratos_adjudicados, get_contratos_adjudicados_detalle

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


@router.get("/pozos-comprometidos")
def pozos_comprometidos(engine: Engine = Depends(get_db_dep)):
    return get_pozos_comprometidos(engine)


@router.get("/pozos-comprometidos/detalle")
def pozos_comprometidos_detalle(
    contrato: str = Query(...),
    engine: Engine = Depends(get_db_dep),
):
    return get_pozos_comprometidos_detalle(engine, contrato)


@router.get("/ofertas-efectivo")
def ofertas_efectivo(engine: Engine = Depends(get_db_dep)):
    return get_ofertas_efectivo(engine)


@router.get("/inversion-comprometida")
def inversion_comprometida(engine: Engine = Depends(get_db_dep)):
    return get_inversion_comprometida(engine)


@router.get("/contratos-adjudicados")
def contratos_adjudicados(engine: Engine = Depends(get_db_dep)):
    return get_contratos_adjudicados(engine)


@router.get("/adjudicados/detalle")
def contratos_adjudicados_detalle(
    empresa: str = Query(...),
    columna: str = Query(...),
    engine: Engine = Depends(get_db_dep),
):
    return get_contratos_adjudicados_detalle(engine, empresa, columna)
