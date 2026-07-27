from fastapi import APIRouter, Depends
from sqlalchemy.engine import Engine
from app.database import get_db_dep
from app.services.resumen_service import get_resumen

router = APIRouter(prefix="/resumen", tags=["resumen"])


@router.get("/")
def resumen(engine: Engine = Depends(get_db_dep)):
    return get_resumen(engine)
