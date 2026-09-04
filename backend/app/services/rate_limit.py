"""Limitador de tasa en memoria, sin dependencias externas.

Protege los puntos sensibles de dos abusos:
  - Fuerza bruta contra la clave de administrador (/uso/verificar, /uso/metricas).
  - Flood del endpoint publico de telemetria (/uso/evento), que escribe en BD.

Es una ventana deslizante por IP: se guardan los timestamps recientes de cada
IP y se rechaza cuando superan el maximo en la ventana. Vive en memoria del
proceso, asi que con varios workers el limite efectivo se multiplica por el
numero de workers — suficiente como primera barrera; el limite duro real es
cosa del proxy/WAF si algun dia hace falta. No usa slowapi ni redis a
proposito: el servidor tiene poco margen para instalar y mantener piezas
nuevas, y esto cubre el caso realista.

No es un mecanismo de seguridad perfecto (una botnet con muchas IPs lo evade),
pero convierte un ataque de diccionario de millones de intentos por minuto en
algo inviable, que es el objetivo.
"""

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

_lock = threading.Lock()
_hits: dict[str, deque] = defaultdict(deque)
# Cada cuanto se barren las IPs que ya no tienen hits vigentes, para que el
# diccionario no crezca sin fin bajo un ataque distribuido.
_ultima_limpieza = 0.0
_INTERVALO_LIMPIEZA = 300


def _ip(request: Request) -> str:
    # Detras de un unico proxy de confianza (Apache -> uvicorn en 127.0.0.1),
    # el ULTIMO valor de X-Forwarded-For es el que Apache anadio con la IP real
    # del cliente; los anteriores los pudo poner el propio cliente y son
    # falsificables. Tomar el primero dejaria evadir el limite mandando una IP
    # falsa distinta en cada intento.
    reenviada = request.headers.get("x-forwarded-for")
    if reenviada:
        partes = [p.strip() for p in reenviada.split(",") if p.strip()]
        if partes:
            return partes[-1]
    return request.client.host if request.client else "desconocida"


def limitar(request: Request, *, max_peticiones: int, ventana_seg: int, ambito: str) -> None:
    """Cuenta esta peticion; lanza 429 si la IP supero el cupo en la ventana.

    `ambito` separa contadores (p. ej. la clave de admin y la telemetria no
    comparten cupo). Un 429 incluye Retry-After para clientes bien portados.
    """
    global _ultima_limpieza
    ahora = time.monotonic()
    clave = f"{ambito}:{_ip(request)}"
    with _lock:
        if ahora - _ultima_limpieza > _INTERVALO_LIMPIEZA:
            for k in [k for k, dq in _hits.items() if not dq or dq[-1] < ahora - ventana_seg]:
                _hits.pop(k, None)
            _ultima_limpieza = ahora
        dq = _hits[clave]
        limite = ahora - ventana_seg
        while dq and dq[0] < limite:
            dq.popleft()
        if len(dq) >= max_peticiones:
            espera = int(dq[0] + ventana_seg - ahora) + 1
            raise HTTPException(
                status_code=429,
                detail="Demasiadas peticiones. Espera un momento.",
                headers={"Retry-After": str(max(espera, 1))},
            )
        dq.append(ahora)
