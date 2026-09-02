"""Buscador global: un texto libre contra todas las entidades del tablero.

El usuario escribe el nombre de un pozo, un campo, una asignación, un
contrato, una empresa, una entidad federativa o una cuenca, y este servicio
devuelve las coincidencias con su tipo. QUÉ TEMAS puede ver de cada una lo
decide el frontend, que ya tiene el catálogo de temas cargado (ver
BuscadorGlobal.jsx): así el mapeo entidad→tema vive junto a la navegación que
lo usa, y agregar un tema no obliga a tocar el backend.

CÓMO BUSCA: no consulta la base en cada tecleo. Arma UNA vez el catálogo
completo de entidades (unas decenas de miles de nombres, que caben de sobra en
memoria) y luego filtra en Python. La razón es medida, no estética: el
`LIKE '%texto%'` sobre la tabla de producción por pozo tarda ~5 s porque no
puede usar índice y recorre ~2 millones de filas; con el catálogo en memoria la
respuesta es inmediata y no toca la base. El catálogo se refresca cada media
hora, muy por encima del ritmo al que cambian estos nombres (a lo sumo una vez
al día), y se precalienta al arrancar para que ni la primera búsqueda espere.

Las búsquedas son insensibles a mayúsculas y acentos: los nombres de la BD
mezclan ambas cosas ("Ixachi", "IXACHI", "Poza Rica"), y nadie escribe los
acentos en un buscador.
"""

import threading
import time
import unicodedata

import pandas as pd
from sqlalchemy.engine import Engine

from app.config import settings

SCHEMA = settings.db_schema + "."
_PG = settings.db_engine == "postgres"

_TABLA_CAMPOS = "api.v_produccion_campos" if _PG else f"{SCHEMA}PRODUCCION_CAMPOS"
_TABLA_ESTADO = "api.v_produccion_estado" if _PG else f"{SCHEMA}PRODUCCION_ESTADO"
_TABLA_OPERADOR_IP = "api.v_produccion_operador_ip" if _PG else f"{SCHEMA}PRODUCCION_OPERADOR_IP"
# Contratos que aún no producen (TRION, por ejemplo) no están en
# PRODUCCION_CAMPOS: solo existen del lado de licitaciones/inversiones. Sin
# esta segunda fuente el buscador decía que no existen.
_TABLA_POZOS_COMPROMETIDOS = "api.v_pozos_comprometidos" if _PG else "rdmx.T_21_PozosComprometidos"
_TABLA_INVERSIONES = "api.v_inversiones_aprobadas" if _PG else f"{SCHEMA}INVERSIONES_APROBADAS"
_COL_OPERADOR_CAMPOS = "operador" if _PG else "OPERADOR"
_COL_EMPRESA_IP = "empresa" if _PG else "EMPRESA"
_TABLA_RESERVAS_CAMPOS = "api.v_reservas_campos" if _PG else f"{SCHEMA}RESERVAS_CAMPOS"
_TABLA_RESERVAS_ASIG = "api.v_reservas_asig_cont" if _PG else "dbo.reservas_asig_cont"
_COL_CAMPO_RESERVAS = "campo_portal" if _PG else "campo_nombre"
_FILTRO_ID = "1=1" if _PG else "ID <> 1"

# Máximo de coincidencias por tipo. Suficientes para que la lista sea útil sin
# volverla un volcado: si el usuario ve demasiadas, lo que necesita es escribir
# más letras.
_MAX_POR_TIPO = 8

# Mínimo de letras. Con una o dos casi todo hace match y la lista no dice nada.
_MIN_LETRAS = 3

_ISNULL0 = "COALESCE" if _PG else "ISNULL"


def _norm(v) -> str:
    """Minúsculas y sin acentos, para comparar."""
    s = str(v or "")
    return "".join(c for c in unicodedata.normalize("NFD", s.lower())
                   if unicodedata.category(c) != "Mn")


def _consulta(engine: Engine, sql: str) -> pd.DataFrame:
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)
    df.columns = df.columns.str.lower()
    return df


def _seguro(engine: Engine, sql: str) -> pd.DataFrame:
    """Una fuente que no responda (linked server caído, tabla ausente en un
    entorno) no puede tumbar el buscador entero: se pierde ese tipo y ya."""
    try:
        return _consulta(engine, sql)
    except Exception:
        return pd.DataFrame()


# El catálogo tarda ~23 s en armarse (el barrido de pozos es casi todo). Con un
# caché por TTL a secas, la primera búsqueda pasada la media hora pagaría esa
# espera completa — justo lo que se quería evitar. Así que se sirve el catálogo
# anterior mientras uno nuevo se arma en segundo plano: el usuario nunca espera,
# y a lo sumo ve nombres con media hora de antigüedad, que en estos datos
# (cambian a lo sumo una vez al día) no significa nada.
_TTL = 1800
_snapshot: list[dict] | None = None
_snapshot_hasta = 0.0
_refrescando = threading.Lock()


def _catalogo(engine: Engine) -> list[dict]:
    """El catálogo vigente. Si caducó, devuelve el viejo y refresca aparte."""
    global _snapshot, _snapshot_hasta
    if _snapshot is None:
        # Primera vez: no hay nada que servir, toca esperar.
        _snapshot = _construir_catalogo(engine)
        _snapshot_hasta = time.time() + _TTL
        return _snapshot
    if time.time() > _snapshot_hasta and not _refrescando.locked():
        def _tarea():
            global _snapshot, _snapshot_hasta
            with _refrescando:
                try:
                    nuevo = _construir_catalogo(engine)
                    _snapshot, _snapshot_hasta = nuevo, time.time() + _TTL
                except Exception:
                    # Que falle el refresco no debe invalidar lo que ya sirve:
                    # se reintenta en la siguiente búsqueda pasado un minuto.
                    _snapshot_hasta = time.time() + 60
        threading.Thread(target=_tarea, daemon=True).start()
    return _snapshot


def _construir_catalogo(engine: Engine) -> list[dict]:
    """Todas las entidades buscables, con su contexto, en una sola lista.

    Cada entrada trae `_n`, su nombre normalizado, para no recalcularlo en
    cada búsqueda."""
    entradas: list[dict] = []

    def agregar(tipo, nombre, **extra):
        if not nombre or not str(nombre).strip():
            return
        entradas.append({"tipo": tipo, "nombre": str(nombre).strip(),
                         "_n": _norm(nombre), **extra})

    # Que una entidad exista no significa que TODOS sus temas tengan algo que
    # mostrarle. GURUMAL, por ejemplo, esta en la tabla de reservas pero con
    # remanente cero en los tres productos (solo tiene volumen original), y la
    # tabla de Reservas descarta los ceros: ofrecer ahi ese tema llevaba a una
    # pantalla vacia. Se marca quien SI tiene reservas y el frontend solo
    # ofrece el tema a esos (ver `con_reservas` en BuscadorGlobal.jsx).
    df = _seguro(engine, f"""
        SELECT DISTINCT {_COL_CAMPO_RESERVAS} AS nombre
        FROM {_TABLA_RESERVAS_CAMPOS}
        WHERE {_COL_CAMPO_RESERVAS} IS NOT NULL
          AND ({_ISNULL0}(rr_aceite_mmb, 0) + {_ISNULL0}(rr_gas_mmmpc, 0) + {_ISNULL0}(rr_pce_mmbpce, 0)) > 0
    """)
    campos_con_reservas = {_norm(r["nombre"]) for r in df.to_dict("records")}
    df = _seguro(engine, f"""
        SELECT DISTINCT asignacion_contrato AS nombre
        FROM {_TABLA_RESERVAS_ASIG}
        WHERE asignacion_contrato IS NOT NULL
          AND ({_ISNULL0}(rr_aceite_mmb, 0) + {_ISNULL0}(rr_gas_natural_mmmpc, 0) + {_ISNULL0}(rr_pce_mmbpce, 0)) > 0
    """)
    asig_con_reservas = {_norm(r["nombre"]) for r in df.to_dict("records")}

    # Ultimo anio con produccion de cada campo y de cada asignacion/contrato.
    # Los temas abren en el anio en curso, asi que una entidad que dejo de
    # producir hace anios (GURUMAL, ultima produccion en 2001) sale vacia sin
    # explicacion. El buscador lo dice antes de entrar.
    anio_col = "EXTRACT(YEAR FROM FECHA)" if _PG else "YEAR(FECHA)"
    df = _seguro(engine, f"""
        SELECT CAMPO_PORTAL AS nombre, MAX({anio_col}) AS anio
        FROM {_TABLA_CAMPOS}
        WHERE {_FILTRO_ID} AND CAMPO_PORTAL IS NOT NULL
        GROUP BY CAMPO_PORTAL
    """)
    ultimo_campo = {_norm(r["nombre"]): int(r["anio"]) for r in df.to_dict("records") if r["anio"]}
    df = _seguro(engine, f"""
        SELECT ASIG_CONT AS nombre, MAX({anio_col}) AS anio
        FROM {_TABLA_CAMPOS}
        WHERE {_FILTRO_ID} AND ASIG_CONT IS NOT NULL
        GROUP BY ASIG_CONT
    """)
    ultimo_asig = {_norm(r["nombre"]): int(r["anio"]) for r in df.to_dict("records") if r["anio"]}

    # ── Campos ────────────────────────────────────────────────────────────
    df = _seguro(engine, f"""
        SELECT DISTINCT CAMPO_PORTAL AS nombre, CUENCA AS cuenca, UBICACION AS ubicacion
        FROM {_TABLA_CAMPOS}
        WHERE {_FILTRO_ID} AND CAMPO_PORTAL IS NOT NULL
    """)
    for r in df.to_dict("records"):
        agregar("campo", r["nombre"], cuenca=r["cuenca"], ubicacion=r["ubicacion"],
                con_reservas=_norm(r["nombre"]) in campos_con_reservas,
                ultimo_anio=ultimo_campo.get(_norm(r["nombre"])))

    # ── Asignaciones y contratos ──────────────────────────────────────────
    # El código (A-0001) y el nombre del bloque son dos etiquetas de la misma
    # cosa: se indexan las dos, porque cada tema destino muestra una u otra.
    from app.services.produccion_service import _mapa_asig_a_block_name
    mapa = _mapa_asig_a_block_name(engine)
    df = _seguro(engine, f"""
        SELECT DISTINCT ASIG_CONT AS codigo, TIPO AS tipo_asig, CUENCA AS cuenca, UBICACION AS ubicacion
        FROM {_TABLA_CAMPOS}
        WHERE {_FILTRO_ID} AND ASIG_CONT IS NOT NULL
    """)
    vistos_asig = set()
    for r in df.to_dict("records"):
        cod = r["codigo"]
        if cod in vistos_asig:
            continue
        vistos_asig.add(cod)
        nombre = mapa.get(cod) or cod
        es_contrato = str(r.get("tipo_asig") or "").upper() == "CONTRATO"
        agregar("contrato" if es_contrato else "asignacion", nombre,
                codigo=cod, tipo_asig=r.get("tipo_asig"),
                cuenca=r.get("cuenca"), ubicacion=r.get("ubicacion"),
                con_reservas=(_norm(cod) in asig_con_reservas
                              or _norm(nombre) in asig_con_reservas),
                ultimo_anio=ultimo_asig.get(_norm(cod)),
                # El código también se busca, aunque el nombre mostrado sea otro.
                _n_alt=_norm(cod))

    # Contratos sin producción, del lado de licitaciones/inversiones.
    ya_contratos = {e["_n"] for e in entradas if e["tipo"] in ("contrato", "asignacion")}
    for tabla, col in ((_TABLA_POZOS_COMPROMETIDOS, "contrato"), (_TABLA_INVERSIONES, "CONTRATO")):
        df = _seguro(engine, f"SELECT DISTINCT {col} AS nombre FROM {tabla} WHERE {col} IS NOT NULL")
        for r in df.to_dict("records"):
            nom = str(r["nombre"]).strip()
            if not nom or _norm(nom) in ya_contratos:
                continue
            ya_contratos.add(_norm(nom))
            agregar("contrato", nom, codigo=nom, sin_produccion=True)

    # ── Empresas / operadores ─────────────────────────────────────────────
    # Viven en dos tablas y con dos nombres: PRODUCCION_CAMPOS tiene el
    # operador de cada campo y PRODUCCION_OPERADOR_IP la empresa participante
    # del contrato, que es la que lista "Producción por operador".
    vistos_op = set()
    for tabla, col, filtro in ((_TABLA_CAMPOS, _COL_OPERADOR_CAMPOS, f"{_FILTRO_ID} AND "),
                               (_TABLA_OPERADOR_IP, _COL_EMPRESA_IP, "")):
        df = _seguro(engine, f"SELECT DISTINCT {col} AS nombre FROM {tabla} WHERE {filtro}{col} IS NOT NULL")
        for r in df.to_dict("records"):
            n = _norm(r["nombre"])
            if not n or n in vistos_op:
                continue
            vistos_op.add(n)
            agregar("operador", r["nombre"])

    # ── Entidades federativas ─────────────────────────────────────────────
    df = _seguro(engine, f"SELECT DISTINCT NOM_ENT AS nombre FROM {_TABLA_ESTADO} WHERE NOM_ENT IS NOT NULL")
    for r in df.to_dict("records"):
        agregar("entidad", r["nombre"])

    # ── Cuencas ───────────────────────────────────────────────────────────
    df = _seguro(engine, f"""
        SELECT DISTINCT CUENCA AS nombre FROM {_TABLA_CAMPOS}
        WHERE {_FILTRO_ID} AND CUENCA IS NOT NULL
    """)
    for r in df.to_dict("records"):
        agregar("cuenca", r["nombre"])

    # ── Pozos ─────────────────────────────────────────────────────────────
    # De la MISMA fuente que alimenta "Producción por pozo", no del catálogo
    # bd_pozos: ahí hay miles de pozos perforados que no reportan producción y
    # que ningún tema puede mostrar, y además el nombre está escrito distinto
    # ("Ayatsil-11DES" vs "AYATSIL-11DES"). Buscar donde se navega garantiza
    # que todo resultado se pueda abrir.
    #
    # Ojo con "campo" en ese tema: la unidad bajo la cuenca es el ASIG_CONT
    # ("A-0032-2M - CAMPO AYATSIL"), no el nombre del campo; es lo que espera
    # el detalle del pozo (ver pozos_service.get_produccion_pozo_detalle).
    #
    # Mismo corte de 2 años que el árbol del tema: si un pozo no sale ahí,
    # ofrecerlo aquí llevaría a una pantalla vacía.
    try:
        from app.services.pozos_service import _source_table
        corte = "(CURRENT_DATE - INTERVAL '2 years')" if _PG else "DATEADD(year, -2, GETDATE())"
        df = _seguro(engine, f"""
            SELECT DISTINCT WELL_NAME AS nombre, ASIG_CONT AS campo, CUENCA AS cuenca
            FROM {_source_table()}
            WHERE WELL_NAME IS NOT NULL AND ASIG_CONT IS NOT NULL AND FECHA >= {corte}
        """)
        if not df.empty:
            df["cuenca"] = df["cuenca"].fillna("").str.title()
            for r in df.to_dict("records"):
                agregar("pozo", r["nombre"], campo=r["campo"], cuenca=r["cuenca"] or None)
    except Exception:
        pass

    return entradas


def buscar(engine: Engine, q: str) -> dict:
    """Devuelve {"q": ..., "resultados": [{tipo, nombre, ...contexto}]}."""
    q = (q or "").strip()
    if len(q) < _MIN_LETRAS:
        return {"q": q, "resultados": []}

    qn = _norm(q)
    por_tipo: dict[str, list[tuple]] = {}
    for e in _catalogo(engine):
        pos = e["_n"].find(qn)
        if pos < 0:
            alt = e.get("_n_alt")
            pos = alt.find(qn) if alt else -1
            if pos < 0:
                continue
        # Los que EMPIEZAN con lo buscado van primero: escribiendo "aka"
        # interesa antes AKAL que CANTARELL-AKAL-2.
        por_tipo.setdefault(e["tipo"], []).append((pos != 0, e["_n"], e))

    resultados = []
    for filas in por_tipo.values():
        filas.sort(key=lambda f: (f[0], f[1]))
        for _, _, e in filas[:_MAX_POR_TIPO]:
            resultados.append({k: v for k, v in e.items() if not k.startswith("_")})
    return {"q": q, "resultados": resultados}


def precalentar(engine: Engine) -> None:
    """Arma el catálogo en segundo plano al arrancar, para que la primera
    búsqueda no pague los ~5 s del barrido de pozos."""
    def _tarea():
        try:
            _catalogo(engine)
        except Exception:
            pass
    threading.Thread(target=_tarea, daemon=True).start()
