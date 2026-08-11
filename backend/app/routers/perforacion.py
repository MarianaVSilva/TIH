import traceback
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy.engine import Engine
from app.database import get_db_dep
from app.services.perforacion_service import (
    get_perforacion, get_perforacion_filtros, get_perforacion_pozos_detalle, get_perforacion_historico,
)

router = APIRouter(prefix="/perforacion", tags=["perforacion"])


@router.get("/filtros")
def perforacion_filtros(topic: str = Query("PozPerf"), engine: Engine = Depends(get_db_dep)):
    return get_perforacion_filtros(engine, topic)


@router.get("/historico")
def perforacion_historico(topic: str = Query(...), engine: Engine = Depends(get_db_dep)):
    try:
        return get_perforacion_historico(engine, topic)
    except Exception as e:
        tb = traceback.format_exc()
        print(tb)
        return JSONResponse(status_code=500, content={"detail": str(e), "traceback": tb})


@router.get("/")
def perforacion(
    topic: str = Query("PozPerf"),
    start_year: int = Query(2019),
    end_year: int = Query(2023),
    start_month: int = Query(1),
    end_month: int = Query(12),
    period: str = Query("annually"),
    cuencas: str = Query(""),
    categorias: str = Query(""),
    ubicaciones: str = Query(""),
    operadores: str = Query(""),
    years: str = Query(""),
    engine: Engine = Depends(get_db_dep),
):
    try:
        return get_perforacion(engine, topic, start_year, end_year, start_month, end_month,
                               period, cuencas, categorias, ubicaciones, operadores, years)
    except Exception as e:
        tb = traceback.format_exc()
        print(tb)
        return JSONResponse(status_code=500, content={"detail": str(e), "traceback": tb})


@router.get("/pozos-detalle")
def perforacion_pozos_detalle(
    topic: str = Query(...),
    periodo: str = Query(...),
    cuenca: str = Query(""),
    ubicacion: str = Query(""),
    operador: str = Query(""),
    categoria_pozo: str = Query(""),
    engine: Engine = Depends(get_db_dep),
):
    try:
        return get_perforacion_pozos_detalle(engine, topic, periodo, cuenca, ubicacion, operador, categoria_pozo)
    except Exception as e:
        tb = traceback.format_exc()
        print(tb)
        return JSONResponse(status_code=500, content={"detail": str(e), "traceback": tb})
