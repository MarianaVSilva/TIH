from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.engine import Engine
from app.database import get_db_dep
from app.services.produccion_service import (
    get_produccion, get_produccion_cuenca, get_produccion_detalle, get_produccion_filtros,
    get_asignaciones_ranking, get_asignacion_detalle, get_produccion_historico, get_campo_detalle,
    get_operador_detalle,
)
from app.services import pozos_cache, pozos_service

router = APIRouter(prefix="/produccion", tags=["produccion"])


@router.post("/pozos/refrescar-cache")
def produccion_pozos_refrescar_cache():
    return pozos_cache.trigger_refresh()


@router.get("/pozos/cache-status")
def produccion_pozos_cache_status():
    return pozos_cache.get_cache_status()


@router.get("/")
def produccion(
    topic: str = Query("Cuenca"),
    start_year: int = Query(2019),
    end_year: int = Query(2023),
    start_month: int = Query(1),
    end_month: int = Query(12),
    period: str = Query("monthly"),
    cuencas: str = Query(""),
    ubicaciones: str = Query(""),
    productos: str = Query(""),
    years: str = Query(""),
    campos: str = Query(""),
    engine: Engine = Depends(get_db_dep),
):
    return get_produccion(engine, topic, start_year, end_year, start_month, end_month, period, cuencas, ubicaciones, productos, years, campos)


@router.get("/asignaciones/ranking")
def produccion_asignaciones_ranking(
    start_year: int = Query(2019),
    end_year: int = Query(2023),
    start_month: int = Query(1),
    end_month: int = Query(12),
    period: str = Query("monthly"),
    years: str = Query(""),
    engine: Engine = Depends(get_db_dep),
):
    return get_asignaciones_ranking(engine, start_year, end_year, start_month, end_month, period, years)


@router.get("/asignaciones/detalle")
def produccion_asignacion_detalle(
    asignacion: str = Query(...),
    start_year: int = Query(2019),
    end_year: int = Query(2023),
    start_month: int = Query(1),
    end_month: int = Query(12),
    period: str = Query("monthly"),
    years: str = Query(""),
    engine: Engine = Depends(get_db_dep),
):
    return get_asignacion_detalle(engine, asignacion, start_year, end_year, start_month, end_month, period, years)


@router.get("/campos/detalle")
def produccion_campo_detalle(
    campo: str = Query(...),
    start_year: int = Query(2019),
    end_year: int = Query(2023),
    start_month: int = Query(1),
    end_month: int = Query(12),
    period: str = Query("monthly"),
    years: str = Query(""),
    engine: Engine = Depends(get_db_dep),
):
    return get_campo_detalle(engine, campo, start_year, end_year, start_month, end_month, period, years)


@router.get("/operadores/detalle")
def produccion_operador_detalle(
    operador: str = Query(...),
    start_year: int = Query(2019),
    end_year: int = Query(2023),
    start_month: int = Query(1),
    end_month: int = Query(12),
    period: str = Query("monthly"),
    years: str = Query(""),
    engine: Engine = Depends(get_db_dep),
):
    return get_operador_detalle(engine, operador, start_year, end_year, start_month, end_month, period, years)


@router.get("/filtros")
def produccion_filtros(engine: Engine = Depends(get_db_dep)):
    return get_produccion_filtros(engine)


@router.get("/historico")
def produccion_historico(topic: str = Query(...), engine: Engine = Depends(get_db_dep)):
    return get_produccion_historico(engine, topic)


@router.get("/pozos/arbol")
def produccion_pozos_arbol(engine: Engine = Depends(get_db_dep)):
    return pozos_service.get_produccion_pozos_arbol(engine)


@router.get("/pozos/detalle")
def produccion_pozo_detalle(
    campo: str = Query(...),
    pozo: str = Query(...),
    start_year: int = Query(2019),
    end_year: int = Query(2023),
    start_month: int = Query(1),
    end_month: int = Query(12),
    period: str = Query("monthly"),
    years: str = Query(""),
    engine: Engine = Depends(get_db_dep),
):
    return pozos_service.get_produccion_pozo_detalle(engine, campo, pozo, start_year, end_year, start_month, end_month, period, years)


@router.get("/pozos/resumen")
def produccion_pozos_resumen(
    cuenca: str = Query(""),
    campo: str = Query(""),
    start_year: int = Query(2019),
    end_year: int = Query(2023),
    start_month: int = Query(1),
    end_month: int = Query(12),
    period: str = Query("monthly"),
    years: str = Query(""),
    engine: Engine = Depends(get_db_dep),
):
    return pozos_service.get_produccion_pozos_resumen(engine, cuenca, campo, start_year, end_year, start_month, end_month, period, years)


@router.get("/pozos/analisis")
def produccion_pozo_analisis(
    campo: str = Query(...),
    pozo: str = Query(...),
    metrica: str = Query("auto"),
    engine: Engine = Depends(get_db_dep),
):
    return pozos_service.get_pozo_analisis(engine, campo, pozo, metrica)


@router.get("/pozos/tendencia-desglose")
def produccion_pozo_tendencia_desglose(
    campo: str = Query(...),
    pozo: str = Query(...),
    metrica: str = Query("auto"),
    engine: Engine = Depends(get_db_dep),
):
    return pozos_service.get_pozo_tendencia_desglose(engine, campo, pozo, metrica)


@router.get("/pozos/ranking")
def produccion_pozos_ranking(
    cuenca: str = Query(""),
    campo: str = Query(""),
    start_year: int = Query(2019),
    end_year: int = Query(2023),
    start_month: int = Query(1),
    end_month: int = Query(12),
    period: str = Query("monthly"),
    years: str = Query(""),
    engine: Engine = Depends(get_db_dep),
):
    return pozos_service.get_pozos_ranking(engine, cuenca, campo, start_year, end_year, start_month, end_month, period, years)


@router.get("/pozos/comparar")
def produccion_pozos_comparar(
    pozos: str = Query(..., description="campo1::pozo1|campo2::pozo2 (2-4 pozos)"),
    start_year: int = Query(2019),
    end_year: int = Query(2023),
    start_month: int = Query(1),
    end_month: int = Query(12),
    period: str = Query("monthly"),
    years: str = Query(""),
    engine: Engine = Depends(get_db_dep),
):
    especificaciones = []
    for item in pozos.split("|"):
        if "::" in item:
            campo, pozo = item.split("::", 1)
            especificaciones.append((campo, pozo))
    return pozos_service.get_pozos_comparar(engine, especificaciones[:4], start_year, end_year, start_month, end_month, period, years)


@router.get("/pozos/filtrados")
def produccion_pozos_filtrados(
    start_year: int = Query(2019),
    end_year: int = Query(2023),
    start_month: int = Query(1),
    end_month: int = Query(12),
    period: str = Query("monthly"),
    produccion_min: float | None = Query(None),
    produccion_max: float | None = Query(None),
    tendencias: str = Query(""),
    estados: str = Query(""),
    edad_min: float | None = Query(None),
    edad_max: float | None = Query(None),
    pagina: int = Query(1),
    tam_pagina: int = Query(50),
    years: str = Query(""),
    engine: Engine = Depends(get_db_dep),
):
    return pozos_service.get_pozos_filtrados(
        engine, start_year, end_year, start_month, end_month, period,
        produccion_min, produccion_max, tendencias, estados, edad_min, edad_max,
        pagina, tam_pagina, years,
    )


@router.get("/pozos/exportar")
def produccion_pozos_exportar(
    start_year: int = Query(2019),
    end_year: int = Query(2023),
    start_month: int = Query(1),
    end_month: int = Query(12),
    period: str = Query("monthly"),
    produccion_min: float | None = Query(None),
    produccion_max: float | None = Query(None),
    tendencias: str = Query(""),
    estados: str = Query(""),
    edad_min: float | None = Query(None),
    edad_max: float | None = Query(None),
    years: str = Query(""),
    engine: Engine = Depends(get_db_dep),
):
    resultado = pozos_service.get_pozos_filtrados(
        engine, start_year, end_year, start_month, end_month, period,
        produccion_min, produccion_max, tendencias, estados, edad_min, edad_max,
        pagina=1, tam_pagina=100000, years=years,
    )
    csv = pozos_service.pozos_a_csv(resultado["pozos"])
    return Response(content=csv, media_type="text/csv", headers={"Content-Disposition": "attachment; filename=pozos.csv"})


@router.get("/cuenca")
def produccion_cuenca(
    start_year: int = Query(2019),
    end_year: int = Query(2023),
    start_month: int = Query(1),
    end_month: int = Query(12),
    period: str = Query("monthly"),
    engine: Engine = Depends(get_db_dep),
):
    return get_produccion_cuenca(engine, start_year, end_year, start_month, end_month, period)


@router.get("/detalle")
def produccion_detalle(
    start_year: int = Query(2019),
    end_year: int = Query(2023),
    start_month: int = Query(1),
    end_month: int = Query(12),
    period: str = Query("monthly"),
    variable: str = Query("liquidos_mbd"),
    engine: Engine = Depends(get_db_dep),
):
    return get_produccion_detalle(engine, start_year, end_year, start_month, end_month, period, variable)
