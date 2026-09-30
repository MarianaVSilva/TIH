# Esquema de base de datos (inferido) — TIH

> **Importante**: este documento no viene de un ORM ni de un script de introspección de SQL Server — está reconstruido leyendo las consultas SQL crudas dentro de `backend/app/services/*.py`. Refleja **las columnas que la app usa**, no necesariamente todas las columnas que existen en cada tabla. Antes de rediseñar, corran un `INFORMATION_SCHEMA.COLUMNS` / diagrama ER real contra la instancia `UMBRACODB`, base `cmde_public`, y usen esto como mapa de qué se usa y dónde.

## Motor y conexión
- SQL Server, instancia `UMBRACODB`, base `cmde_public`, schema `dbo` (`backend/app/config.py`, `backend/app/database.py`).
- Acceso vía `pyodbc` + SQLAlchemy engine. Sin ORM: todo es SQL crudo con f-strings o `sqlalchemy.text()`.

## Tablas de origen (solo lectura por la app)

### `PRODUCCION_CAMPOS`
Producción por campo/cuenca a nivel diario o periodo. La tabla más usada (routers `produccion`, `contratos`).

| Columna | Uso observado |
|---|---|
| `ID` | filtrado con `WHERE ID <> 1` en casi toda consulta — probablemente excluye fila de totales |
| `CUENCA` | agrupación geográfica |
| `UBICACION` | agrupación (marina/terrestre, probablemente) |
| `CAMPO_PORTAL` | nombre de campo |
| `FECHA` | fecha del registro (agregación por periodo) |
| `DIAS_PRODUCCION` | días de producción del periodo |
| `ASIG_CONT` | asignación/contrato |
| `TIPO` | tipo de asignación (`'ASIGNACION'` es valor usado en filtro) |
| `OPERADOR` | operador del campo/contrato |
| `PETROLEO_API` | gravedad API del petróleo |
| `PETROLEO_MBD` | producción de petróleo (miles de barriles/día) |
| `CONDENSADO_MBD` | producción de condensado |
| `GAS_MMPCD` | producción de gas |
| `GAS_ASOC_MMPCD` | gas asociado |
| `GAS_NASOC_MMPCD` | gas no asociado |
| `AGUA_MBD` | producción de agua |
| `N2_MMPCD` | nitrógeno |

Columna calculada frecuente: `LIQUIDOS_MBD = SUM(PETROLEO_MBD + CONDENSADO_MBD)`.

### `PRODUCCION_CAMPOS_POZOS`
Producción/conteo de pozos por campo (routers `produccion`, `perforacion`).

| Columna | Uso observado |
|---|---|
| `CUENCA`, `UBICACION`, `CAMPO_PORTAL` | dimensiones |
| `FECHA` | periodo |
| `POZOS_ACEITE` | conteo de pozos de aceite |
| `POZOS_GAS` | conteo de pozos de gas |

### `PRODUCCION_ESTADO`
Producción agregada por estado de la república (router `estado`).

| Columna | Uso observado |
|---|---|
| `NOM_ENT` | nombre de la entidad federativa |
| `FECHA`, `UBICACION` | dimensiones |
| `PETROLEO_MBD`, `CONDENSADO_MBD`, `GAS_MMPCD` | métricas (mismo patrón que `PRODUCCION_CAMPOS`) |

### `PRODUCCION_OPERADOR_IP`
Producción por operador privado/IP (contratos, no Pemex asignaciones) (routers `contratos`, `produccion`).

| Columna | Uso observado |
|---|---|
| `FECHA` | periodo |
| `ASIG_CONT` | contrato (se remapea a "Asignaciones" si empieza con `A-`/`AE`/`AR`) |
| `EMPRESA` | operador — se expone como `OPERADOR` |
| `FACTOR_O` | factor de participación/ownership aplicado a métricas (`PETROLEO_MBD*FACTOR_O`, etc.) |
| `PETROLEO_MBD`, `GAS_MMPCD`, `AGUA_MBD` | métricas base |

### `PRODUCCION_POZOS` (y su copia cacheada `dbo.produccion_pozos`)
Producción a nivel pozo individual (router `perforacion`/pozos, vía `pozos_service.py` + `pozos_cache.py`).

| Columna | Uso observado |
|---|---|
| `FECHA` | periodo |
| `WELL_ID` | identificador de pozo |
| `WELL_NAME` | nombre de pozo |
| `ASIG_CONT` | contrato/asignación del pozo |
| `CUENCA` | cuenca |
| `PETROLEO_MBD`, `CONDENSADO_MBD`, `GAS_MMPCD` | métricas |

`pozos_cache.py` hace `SELECT * INTO dbo.produccion_pozos FROM cmde_public.dbo.PRODUCCION_POZOS` — es decir, **copia completa periódica** de esta tabla a una tabla local, usada como caché de lectura rápida (`_source_table()` en `pozos_service.py` decide si lee del origen o del caché).

### Tabla de catálogo de pozos (`BD_POZOS`, nombre exacto definido en `pozos_service.py`)
| Columna | Uso observado |
|---|---|
| `WELL_ID` | identificador (join con producción por pozo) |
| `CURRENT_CONDITION` | estado actual del pozo |
| `DRILLING_START_DATE` | fecha de inicio de perforación |
| `OPERATOR` | operador |
| `DEPTH_MD` | profundidad medida |
| `CATEGORY` | categoría del pozo |

### `RESERVAS_CAMPOS`
Reservas por campo/cuenca (router `reservas`). Nombres de columna en minúsculas (inconsistente con el resto del esquema, que usa MAYÚSCULAS).

| Columna | Uso observado |
|---|---|
| `fecha` | periodo (se agrupa por `YEAR(fecha)`) |
| `cuenca`, `ubicacion` | dimensiones geográficas |
| `campo_nombre` | nombre de campo |
| `categoria` | categoría de reserva (`'PROBADAS'` es valor usado; también hay parámetro `tipo` con default `'1P'`) |
| `rr_aceite_mmb` | reservas remanentes de aceite (millones de barriles) |
| `rr_gas_mmmpc` | reservas remanentes de gas |
| `rr_condensado_mmb` | reservas remanentes de condensado |
| `rr_liquidos_planta_mmb` | reservas remanentes de líquidos de planta |
| `vo_aceite_mmb` | volumen original de aceite |
| `vo_gas_mmmpc` | volumen original de gas |

### `INVERSIONES_APROBADAS`
Inversiones aprobadas por contrato/actividad (router `inversiones`).

| Columna | Uso observado |
|---|---|
| `ANIO` | año |
| `RONDA` | ronda de licitación (NULL para planes de inversión no ligados a ronda) |
| `TIPO_PLAN` | tipo de plan (cuando `RONDA IS NULL`) |
| `LICITACION`, `CONTRATO` | identificadores |
| `ACT_PETROLERA` | actividad petrolera |
| `TAREA` | tarea específica dentro de la inversión |
| `ESTADO` | estado del proyecto/tarea |
| `UBICACION` | ubicación |
| `MONTO_USD` | monto en USD |

### `PRECIOS`
Precios históricos de referencia (router `precios`).

| Columna | Uso observado |
|---|---|
| `FECHA` | fecha |
| `BRENT`, `WTI`, `MME`, `HENRY_HUB` | precios por benchmark |

### `CUBOS`
Catálogo/metadatos de "temas" disponibles para consulta en el frontend (router `temas` — parece ser configuración de qué gráficas/temas mostrar, no datos de negocio en sí).

| Columna | Uso observado |
|---|---|
| `SECCION`, `TEMA` | identificadores de sección/tema en el menú |
| `JSON_ARG` | argumentos serializados (filtrado excluye `''` y valores `'BalanceGas'`, `'InvAsig'`) |
| `INIT_YEAR` | año inicial disponible para ese tema |
| `PERIODICIDAD` | periodicidad de los datos (mensual/anual/etc.) |

## Tablas gestionadas por esta app (no son del origen — se pueden rediseñar con libertad)

### `PRECIOS_AUTOM`
Creada por el propio backend si no existe (`precios_service.py`). Guarda precios obtenidos automáticamente de fuentes externas, con upsert (`MERGE`) por `(FECHA, PRODUCTO)`.

```sql
CREATE TABLE dbo.PRECIOS_AUTOM (
    FECHA DATE NOT NULL,
    PRODUCTO VARCHAR(20) NOT NULL,
    VALOR DECIMAL(10,4) NOT NULL,
    FUENTE VARCHAR(50) NULL,
    ACTUALIZADO_EN DATETIME NOT NULL DEFAULT GETDATE(),
    CONSTRAINT PK_PRECIOS_AUTOM PRIMARY KEY (FECHA, PRODUCTO)
)
```

### `dbo.cache_meta`
Tabla clave-valor para metadatos de caché (ej. última fecha de refresco de `produccion_pozos`).
```sql
CREATE TABLE dbo.cache_meta ([key] VARCHAR(50) PRIMARY KEY, value VARCHAR(200))
```

### `dbo.produccion_pozos`
Copia local de `PRODUCCION_POZOS` (ver arriba), recreada periódicamente vía `SELECT * INTO`.

## Relaciones observadas (implícitas, no hay FKs declaradas en el código)
- `PRODUCCION_POZOS.WELL_ID` ↔ `BD_POZOS.WELL_ID` (join manual en `pozos_service.py` para traer condición/operador/profundidad del pozo).
- `ASIG_CONT` es la clave de negocio compartida entre `PRODUCCION_CAMPOS`, `PRODUCCION_OPERADOR_IP` y `PRODUCCION_POZOS` (identifica el mismo contrato/asignación en varias tablas, pero sin FK formal).
- `CUENCA` / `UBICACION` / `CAMPO_PORTAL` son dimensiones geográficas repetidas de forma desnormalizada en casi todas las tablas de producción (candidatas obvias a extraer a tablas de catálogo en un rediseño).

## Puntos a considerar para un rediseño
1. **Desnormalización fuerte**: `CUENCA`, `UBICACION`, `CAMPO_PORTAL`, `OPERADOR`/`EMPRESA` se repiten como texto libre en cada tabla de hechos en vez de referenciar catálogos con FK. Riesgo de inconsistencias de naming (p. ej. mismo operador escrito distinto en dos tablas).
2. **Inconsistencia de convención de nombres**: la mayoría de tablas usa columnas en MAYÚSCULAS (`PRODUCCION_*`, `PRECIOS`, `CUBOS`), pero `RESERVAS_CAMPOS` usa minúsculas. Un rediseño debería unificar esto.
3. **Fila mágica `ID = 1`** en `PRODUCCION_CAMPOS` excluida por convención en el código (`WHERE ID <> 1`) en vez de por diseño de esquema — confirmar qué es y si debe eliminarse o modelarse explícitamente.
4. **`FACTOR_O`** en `PRODUCCION_OPERADOR_IP` aplica un factor multiplicativo a las métricas en tiempo de consulta — vale la pena decidir si eso se pre-calcula y almacena en vez de recalcularse en cada query.
5. **Sin FKs ni constraints de integridad referencial visibles** entre tablas de producción/pozos/catálogo — todo el "join" es por convención de nombre de columna (`ASIG_CONT`, `WELL_ID`).
6. Cualquier cambio de nombre de tabla/columna debe replicarse manualmente en `backend/app/services/*.py` (no hay capa ORM ni tests automatizados de esquema visibles en el repo que detecten el desfase).
