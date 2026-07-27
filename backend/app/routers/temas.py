from fastapi import APIRouter, Depends
from sqlalchemy.engine import Engine
from app.database import get_db_dep
from app.services.temas_service import get_temas

router = APIRouter(prefix="/temas", tags=["temas"])


@router.get("/")
def list_temas(engine: Engine = Depends(get_db_dep)):
    return get_temas(engine)
