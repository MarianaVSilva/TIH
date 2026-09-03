"""Métricas de uso del tablero: cuánto se visita, cuánto tiempo y qué
secciones se consultan.

Es la ÚNICA parte del sistema que escribe datos propios de negocio (el resto
de la base se consume en lectura, salvo los cachés). Vive en su propia tabla,
`TIH_USO_EVENTOS`, creada por el backend si no existe — mismo patrón que
PRECIOS_AUTOM, para no depender de una migración manual en el servidor.

QUÉ SE GUARDA (decisión explícita del usuario): visita anónima más la IP. No
hay cuentas de usuario en el tablero, así que no se puede saber quién es
quien; la IP sirve para distinguir equipos y estimar usuarios únicos. Ojo:
en una red interna una IP suele corresponder a una persona concreta, así que
esta tabla es dato personal en la práctica y conviene tratarla como tal
(acceso restringido, y borrarla cuando deje de ser útil — ver `purgar`).

CÓMO SE MIDE EL TIEMPO: el frontend manda un "pulso" cada 30 s mientras la
pestaña está visible, con la sección que se está viendo. El tiempo de una sesión
es la suma de sus pulsos. Se eligió así en vez de medir al cerrar la pestaña
porque el evento de cierre no llega de forma confiable (el navegador lo
descarta si tarda), y porque una pestaña olvidada en segundo plano no debe
contar como tiempo de consulta.
"""

from datetime import date, timedelta

import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.config import settings

SCHEMA = settings.db_schema + "."
_PG = settings.db_engine == "postgres"

_TABLA = "api.tih_uso_eventos" if _PG else f"{SCHEMA}TIH_USO_EVENTOS"

# Segundos que representa cada pulso. Tiene que coincidir con el intervalo del
# frontend (utils/telemetria.js): si se cambia uno hay que cambiar el otro.
SEGUNDOS_POR_PULSO = 30

_DDL_MSSQL = f"""
IF OBJECT_ID('{_TABLA}', 'U') IS NULL
CREATE TABLE {_TABLA} (
    id        BIGINT IDENTITY(1,1) PRIMARY KEY,
    fecha     DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    sesion    VARCHAR(40)    NOT NULL,
    ip        VARCHAR(45)    NULL,
    tipo      VARCHAR(20)    NOT NULL,
    seccion   NVARCHAR(120)  NULL,
    tema      NVARCHAR(120)  NULL,
    detalle   NVARCHAR(200)  NULL,
    segundos  INT            NOT NULL DEFAULT 0
)
"""

_DDL_PG = f"""
CREATE TABLE IF NOT EXISTS {_TABLA} (
    id        BIGSERIAL PRIMARY KEY,
    fecha     TIMESTAMP    NOT NULL DEFAULT NOW(),
    sesion    VARCHAR(40)  NOT NULL,
    ip        VARCHAR(45),
    tipo      VARCHAR(20)  NOT NULL,
    seccion   VARCHAR(120),
    tema      VARCHAR(120),
    detalle   VARCHAR(200),
    segundos  INT          NOT NULL DEFAULT 0
)
"""

_tabla_lista = False


def _asegurar_tabla(engine: Engine) -> None:
    """Crea la tabla la primera vez. Se recuerda en memoria para no lanzar el
    DDL en cada evento."""
    global _tabla_lista
    if _tabla_lista:
        return
    with engine.begin() as conn:
        conn.execute(text(_DDL_PG if _PG else _DDL_MSSQL))
        # Índice por fecha: todas las consultas del panel filtran por rango.
        try:
            if _PG:
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_uso_fecha ON {_TABLA}(fecha)"))
            else:
                conn.execute(text(
                    f"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_uso_fecha') "
                    f"CREATE INDEX ix_uso_fecha ON {_TABLA}(fecha)"
                ))
        except Exception:
            # El índice es una optimización, no un requisito: si el usuario de
            # la BD no puede crearlo, el panel sigue funcionando.
            pass
    _tabla_lista = True


# Tipos de evento aceptados. Se validan para que un cliente mal escrito (o
# alguien golpeando el endpoint) no llene la tabla de basura arbitraria.
# "tema" queda aceptado por los registros que ya existen: la unidad de medida
# paso a ser la SECCION (las pills del encabezado), no el tema concreto.
TIPOS = {"vista", "seccion", "tema", "pulso", "busqueda"}


def registrar(engine: Engine, *, sesion: str, tipo: str, ip: str | None = None,
              seccion: str | None = None, tema: str | None = None,
              detalle: str | None = None) -> None:
    """Guarda un evento. Silencioso ante fallos: la telemetría nunca debe
    tumbar ni ralentizar la navegación del usuario."""
    if tipo not in TIPOS or not sesion:
        return
    try:
        _asegurar_tabla(engine)
        with engine.begin() as conn:
            conn.execute(text(f"""
                INSERT INTO {_TABLA} (sesion, ip, tipo, seccion, tema, detalle, segundos)
                VALUES (:sesion, :ip, :tipo, :seccion, :tema, :detalle, :segundos)
            """), {
                "sesion": sesion[:40], "ip": (ip or "")[:45] or None, "tipo": tipo,
                "seccion": (seccion or None), "tema": (tema or None),
                "detalle": (detalle or None)[:200] if detalle else None,
                "segundos": SEGUNDOS_POR_PULSO if tipo == "pulso" else 0,
            })
    except Exception:
        pass


def _rango(desde: str | None, hasta: str | None) -> tuple[str, str]:
    """Por defecto, los últimos 30 días."""
    hoy = date.today()
    d = desde or (hoy - timedelta(days=29)).isoformat()
    h = hasta or hoy.isoformat()
    return d, h


def _leer(engine: Engine, sql: str, params: dict) -> pd.DataFrame:
    with engine.connect() as conn:
        df = pd.read_sql(text(sql), conn, params=params)
    df.columns = df.columns.str.lower()
    return df


def metricas(engine: Engine, desde: str | None = None, hasta: str | None = None) -> dict:
    """Todo lo que pinta el panel de administrador, en una sola llamada."""
    _asegurar_tabla(engine)
    d, h = _rango(desde, hasta)
    # El rango es inclusivo por día: 'hasta' se compara contra el día siguiente
    # para no perder los eventos de esa misma fecha por la hora.
    params = {"d": d, "h": h}
    fecha_dia = "CAST(fecha AS DATE)" if not _PG else "fecha::date"
    filtro = "fecha >= :d AND fecha < DATEADD(day, 1, CAST(:h AS DATE))" if not _PG \
        else "fecha >= :d AND fecha < (:h::date + INTERVAL '1 day')"

    resumen = _leer(engine, f"""
        SELECT COUNT(DISTINCT sesion)  AS sesiones,
               COUNT(DISTINCT ip)      AS equipos,
               SUM(segundos)           AS segundos,
               SUM(CASE WHEN tipo IN ('seccion', 'tema') THEN 1 ELSE 0 END) AS consultas
        FROM {_TABLA} WHERE {filtro}
    """, params)
    fila = resumen.iloc[0] if not resumen.empty else {}

    def _num(v):
        return int(v) if v is not None and not pd.isna(v) else 0

    sesiones = _num(fila.get("sesiones"))
    segundos = _num(fila.get("segundos"))

    por_dia = _leer(engine, f"""
        SELECT {fecha_dia} AS dia, COUNT(DISTINCT sesion) AS sesiones, SUM(segundos) AS segundos
        FROM {_TABLA} WHERE {filtro}
        GROUP BY {fecha_dia} ORDER BY 1
    """, params)

    # Lo que se mide es la SECCION del encabezado (las pills), no el tema
    # concreto: interesa que area del tablero se usa mas.
    secciones = _leer(engine, f"""
        SELECT seccion,
               COUNT(*)                AS consultas,
               COUNT(DISTINCT sesion)  AS sesiones
        FROM {_TABLA}
        WHERE {filtro} AND tipo IN ('seccion', 'tema') AND seccion IS NOT NULL
        GROUP BY seccion ORDER BY 2 DESC
    """, params)

    # Tiempo por seccion: los pulsos llevan la seccion que se estaba viendo.
    tiempo_seccion = _leer(engine, f"""
        SELECT seccion, SUM(segundos) AS segundos
        FROM {_TABLA}
        WHERE {filtro} AND tipo = 'pulso' AND seccion IS NOT NULL
        GROUP BY seccion ORDER BY 2 DESC
    """, params)
    minutos_por_seccion = {r["seccion"]: round(_num(r["segundos"]) / 60) for r in tiempo_seccion.to_dict("records")}

    busquedas = _leer(engine, f"""
        SELECT detalle AS texto, COUNT(*) AS veces
        FROM {_TABLA}
        WHERE {filtro} AND tipo = 'busqueda' AND detalle IS NOT NULL
        GROUP BY detalle ORDER BY 2 DESC
    """, params)

    horas = _leer(engine, f"""
        SELECT {"DATEPART(hour, fecha)" if not _PG else "EXTRACT(hour FROM fecha)"} AS hora,
               COUNT(DISTINCT sesion) AS sesiones
        FROM {_TABLA} WHERE {filtro}
        GROUP BY {"DATEPART(hour, fecha)" if not _PG else "EXTRACT(hour FROM fecha)"}
        ORDER BY 1
    """, params)

    return {
        "desde": d, "hasta": h,
        "resumen": {
            "sesiones": sesiones,
            "equipos": _num(fila.get("equipos")),
            "consultas_seccion": _num(fila.get("consultas")),
            "minutos": round(segundos / 60),
            # Promedio por sesión: la cifra que de verdad dice si la gente se
            # queda o solo asoma.
            "minutos_por_sesion": round(segundos / 60 / sesiones, 1) if sesiones else 0,
        },
        "por_dia": [
            {"dia": str(r["dia"]), "sesiones": _num(r["sesiones"]), "minutos": round(_num(r["segundos"]) / 60)}
            for r in por_dia.to_dict("records")
        ],
        "secciones": [
            {"seccion": r["seccion"], "consultas": _num(r["consultas"]),
             "sesiones": _num(r["sesiones"]), "minutos": minutos_por_seccion.get(r["seccion"], 0)}
            for r in secciones.to_dict("records")
        ],
        "busquedas": [
            {"texto": r["texto"], "veces": _num(r["veces"])}
            for r in busquedas.to_dict("records")[:20]
        ],
        "por_hora": [
            {"hora": int(r["hora"]), "sesiones": _num(r["sesiones"])}
            for r in horas.to_dict("records")
        ],
    }


def purgar(engine: Engine, dias: int = 365) -> int:
    """Borra eventos más viejos que `dias`. La tabla guarda IPs: conservarlas
    para siempre no tiene justificación."""
    _asegurar_tabla(engine)
    corte = f"DATEADD(day, -{int(dias)}, SYSDATETIME())" if not _PG \
        else f"(NOW() - INTERVAL '{int(dias)} days')"
    with engine.begin() as conn:
        res = conn.execute(text(f"DELETE FROM {_TABLA} WHERE fecha < {corte}"))
        return res.rowcount or 0
