from pydantic import BaseModel
from typing import Any


class ProduccionParams(BaseModel):
    topic: str
    start_year: int
    end_year: int
    start_month: int = 1
    end_month: int = 12
    period: str = "monthly"  # monthly | annually | quarterly | semesterly


class ReservasParams(BaseModel):
    start_year: int
    end_year: int
    tipo: str = "1P"


class ContratosParams(BaseModel):
    start_year: int
    end_year: int
    start_month: int = 1
    end_month: int = 12
    period: str = "monthly"
    subtopic: str = "Contratos"


class ApiResponse(BaseModel):
    data: Any
    ok: bool = True
    message: str = ""
