import time
import threading

# Caché genérico en memoria con expiración (TTL) para las consultas pesadas que
# recalculan agregados en vivo desde las vistas SQL Server (ver PRODUCCION_CAMPOS_POZOS,
# PRODUCCION_ESTADO, etc. — no son tablas indexables, hacen JOIN/GROUP BY sobre
# datos crudos en cada llamada). Los datos de este tablero cambian a lo sumo una
# vez al día, así que servir la misma respuesta unos minutos no arriesga nada.
_lock = threading.Lock()
_store: dict[tuple, tuple[float, object]] = {}


def cached(ttl_seconds: int = 1200):
    """Cachea el resultado de una función pura (misma entrada → misma salida)
    por `ttl_seconds`, en base a sus argumentos posicionales/nombrados."""
    def decorator(fn):
        def wrapper(*args, **kwargs):
            key = (fn.__module__, fn.__qualname__, args, tuple(sorted(kwargs.items())))
            now = time.time()
            with _lock:
                hit = _store.get(key)
                if hit and hit[0] > now:
                    return hit[1]
            result = fn(*args, **kwargs)
            with _lock:
                _store[key] = (now + ttl_seconds, result)
            return result
        wrapper.__wrapped__ = fn
        return wrapper
    return decorator
