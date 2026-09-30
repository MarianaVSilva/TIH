# Plan de migración TIH → PostgreSQL (staging / core / api)

> **Estado (2026-08-20): fase de extracción/transformación/validación completa para los 8 dominios de TIH**, contra una instancia de prueba (Postgres 17 local). Ver [MIGRATION_STATUS.md](MIGRATION_STATUS.md) para la bitácora completa: qué se corrió, con qué resultado, y los 12 bugs reales encontrados y corregidos en el camino. Este documento (`00_PLAN.md`) sigue siendo la referencia de arquitectura/diseño; `MIGRATION_STATUS.md` es la referencia de ejecución.

> Basado en [DATABASE_DEPENDENCIES.md](../DATABASE_DEPENDENCIES.md) (auditoría completa de SQL Server). Objetivo: mismos datos, sin perderlos, con un modelo optimizado para lectura analítica rápida — no una copia 1:1 de las vistas actuales.

## Por qué las consultas actuales son lentas (diagnóstico)

1. Cada tabla que consulta el backend es en realidad una **vista con 2-3 niveles de `UNION`/`JOIN`** recalculados en cada request (ver `PRODUCCION_CAMPOS_POZOS`, `PRODUCCION_OPERADOR_IP`, `bd_pozos`).
2. Hay **lógica de negocio recalculada por fila en cada consulta**: prorrateo de días por vigencia contractual (`FACTOR_MES`), derivación de `pozo_aceite`/`pozo_gas` por umbral, reglas de cuenca geológica — nada de esto está pre-agregado.
3. **Cero índices visibles** en las tablas base auditadas (`primary_key: []` en casi todas) — cada filtro por `fecha`/`cuenca` es un table scan.
4. Todo vive **desnormalizado como texto libre** (`CUENCA`, `OPERADOR`, `CAMPO_PORTAL` repetidos en cada fila) — comparaciones de texto en vez de joins por entero, y riesgo de inconsistencia de naming entre tablas.

El rediseño ataca los 4 puntos.

## Arquitectura: 3 capas + 1 schema de servicio

```
staging   → espejo 1:1 de las tablas base de SQL Server (sin transformar), reflejo fiel para poder re-derivar todo si algo sale mal
core      → modelo dimensional (star schema): dim_* + fact_* particionadas e indexadas, con la lógica de negocio aplicada UNA VEZ en el ETL, no en cada query
api       → vistas / vistas materializadas ya con la forma exacta que espera cada endpoint del backend — es el único schema que el backend de FastAPI debe tocar
ops       → metadatos de carga (cache_meta equivalente, log de ETL, control de refresh de materialized views)
```

El backend deja de hacer SQL crudo sobre tablas de negocio con nombres en mayúsculas mezclados con vistas de 3 niveles, y pasa a consultar `api.*` — vistas simples, ya resueltas, con nombres consistentes en `snake_case`.

## Mapeo staging → core → api (resumen, ver SQL para detalle completo)

| Dominio (router actual) | Tablas staging (origen) | Tabla(s) core | Vista(s) api |
|---|---|---|---|
| Producción por campo | `stg_produccion_campos_a2016`, `stg_vm_produccion_campos_d2016` | `core.fact_produccion_campo` (particionada por año) + `core.dim_campo`, `core.dim_geografia`, `core.dim_operador`, `core.dim_contrato` | `api.v_produccion_campos` |
| Producción por pozo | `stg_bd_pozos`, `stg_sih_produccion_d2016`, `stg_produccion_pozos_valid` | `core.fact_produccion_pozo` (particionada) + `core.dim_pozo` | `api.v_produccion_pozos`, `api.v_pozos_meta` |
| Producción por estado | `stg_sih_produccion_d2016`, `stg_cat_entidades`, `stg_produccion_estado_a2016` | `core.fact_produccion_estado` + `core.dim_entidad` | `api.v_produccion_estado` |
| Producción por operador (IP) | `core.fact_produccion_campo` + `stg_empresas_contratistas_historico` (+3 catálogos) | `core.fact_produccion_operador` (con `factor_mes`/`factor_ip` **precalculados en el ETL**, no en la vista) + `core.dim_empresa` | `api.v_produccion_operador_ip` |
| Reservas por campo | `stg_sih_reservas_c`, `stg_campos_loc` | `core.fact_reservas_campo` + `core.dim_campo` | `api.v_reservas_campos` |
| Reservas por asignación | `stg_sih_reservas`, `stg_campos_loc`, `stg_general_info_estados` | `core.fact_reservas_asignacion` | `api.v_reservas_asig_cont`, `api.v_reservas_asig_cont_campos` |
| Inversiones aprobadas | `stg_inversiones_aprobadas` | `core.fact_inversiones` (particionada, 449k filas) | `api.v_inversiones_aprobadas` |
| Precios | `stg_precios`, `core.fact_precios_autom` (TIH-managed, se mantiene igual) | `core.fact_precios` | `api.v_precios` |
| Temas/menú (`CUBOS`) | — (tabla real, se migra tal cual) | `core.dim_tema` | `api.v_temas` |
| Pozos comprometidos / licitaciones | `stg_t01a_infogral`, `stg_t12_pozos`, `stg_t21a_pozoscomprometidos`, `stg_licitaciones_bloques_ofertas` | `core.fact_pozos_comprometidos`, `core.fact_licitaciones_ofertas` + `core.dim_licitacion`, `core.dim_pais` | `api.v_pozos_comprometidos`, `api.v_licitaciones_ofertas` |
| Nombres/vigencia de bloque (`entitlements.v_general_info`) | `stg_general_info` (local, `cmde_raw`) + **`core.dim_bloque_siseaa`** (ver plan de linked server) | `core.dim_bloque` | `api.v_bloques` |

## Reglas de negocio que se preservan explícitamente en el ETL (antes vivían escondidas en SQL Server)

Cada una queda como una función o paso de transformación **documentado y con test**, no como un `CASE` enterrado en una vista:

1. **Pozo válido** (`cmde_valid.dbo.bd_pozos`): `ALTERNATE_WELL=0 AND SIDETRACK=0 AND STATUS IN ('CONCLUIDO','EN CONSTRUCCION','EN CONSTRUCCIÓN')`, más el relleno en cascada de fechas de perforación/terminación faltantes. → función `core.fn_pozo_es_valido()` + columna materializada `dim_pozo.es_valido`.
2. **Normalización de ubicación** (`PRODUCCION_ESTADO`): `'Terrestre'→'TERRESTRE'`, `'Aguas someras'→'MARINO'`. → tabla de mapeo `core.map_ubicacion`, no un `CASE` repetido.
3. **Prorrateo contractual** (`PRODUCCION_OPERADOR_IP`): `FACTOR_MES`/`FACTOR_IP`/`FACTOR_O` según vigencia del contrato. → calculado **una vez por fila en el ETL** al cargar `core.fact_produccion_operador`, no recalculado en cada consulta.
4. **Reasignación de cuenca geológica** (duplicada hoy en `entitlements.v_general_info` y `cmde_valid.dbo.bd_pozos`): reglas de `PETROLEUM_PROVINCE`/`GEOLOGICAL_PROVINCE` (Sabinas-Burro-Picachos, Golfo de México Profundo, etc.) → **una sola** tabla `core.map_provincia_petrolera`, referenciada desde ambos dominios (pozos y bloques) para que no puedan divergir.
5. **Remapeo de `BLOCK_ID`** histórico en `sih_reservas` (bloques renombrados/fusionados en fechas específicas) → tabla `core.map_block_id_historico(block_id_viejo, block_id_nuevo, vigente_desde)`.
6. **`id` mágico en `produccion_campos_new`** (`WHERE ID <> 1` / `WHERE id=2` en el código actual): **confirmado por inspección directa de datos** (no es un tipo de negocio) — `id=2` son filas de detalle real por contrato/operador (`asig_cont` con códigos reales como `A-0022`, `AR-0470`, operadores reales); `id=1` son filas de **total/placeholder** (`asig_cont` literalmente el texto `"asignaciones"`, `operador="TODOS"`, repetidas sin variar por contrato). No representan una categoría de negocio que valga la pena preservar. En el ETL, `core.fact_produccion_campo` **descarta las filas `id=1`** al cargar (igual que hace `WHERE ID <> 1` hoy) — no se modela ninguna columna `tipo_registro` para esto.

## Índices y particionamiento (la parte de "muy muy rápido")

- **Particionamiento nativo por rango de `fecha` (anual)** en las 3 tablas grandes: `fact_produccion_campo`, `fact_produccion_pozo` (933k+ filas y creciendo), `fact_inversiones` (449k filas). Permite *partition pruning*: una consulta de "últimos 2 años" ni toca las particiones viejas.
- **Índice BRIN sobre `fecha`** en cada partición (las tablas de hechos se cargan en orden cronológico por el ETL, BRIN es ideal: fracción del tamaño de un B-tree con casi la misma velocidad para range scans).
- **Índices B-tree compuestos** que calzan exactamente con los `WHERE`/`GROUP BY` reales del código actual: `(fecha, campo_id)`, `(fecha, cuenca_id)`, `(contrato_id, fecha)`, `(well_id, fecha)`.
- **Claves foráneas reales** `dim_*.*_id` en vez de comparar texto (`CUENCA='...'`) — join por entero indexado en vez de string matching.
- **Vistas materializadas en `api`** para los agregados que hoy se recalculan siempre igual (ranking de operadores, totales por cuenca/año) con `REFRESH MATERIALIZED VIEW CONCURRENTLY` disparado al final del ETL — el backend nunca vuelve a pagar el costo de agregación en el request.
- `pg_stat_statements` activado desde el día 1 para verificar en producción que las queries reales del backend usan los índices creados (evita "optimizar a ciegas").

## Plan de ETL (staging ← SQL Server)

No se recomienda un link vivo permanente tipo Foreign Data Wrapper SQL Server↔Postgres para producción (frágil, acopla la disponibilidad de Postgres a la de SQL Server, y las 5 bases cruzadas —`cmde_public`/`cmde_valid`/`cmde_raw`/`UATAC_SISEAA`— ya son bastante fragilidad como para sumar una más). En su lugar:

1. **Script Python de extracción** (`pyodbc` contra SQL Server → `COPY`/`psycopg2` hacia Postgres `staging.*`), uno por tabla base identificada en `DATABASE_DEPENDENCIES.md`. Corre en batch (cron/Task Scheduler), no por request.
2. **Carga incremental donde hay columna de fecha/`update_date` confiable** (`inversiones_aprobadas.update_date`, `bd_pozos.UPDATE_DATE`); *full refresh* donde no la hay (catálogos pequeños: `cat_entidades`, `campos_loc`, etc. — son chicos, no vale la pena la complejidad incremental).
3. **Transformación `staging → core`** en SQL puro dentro de Postgres (`04_transform_staging_to_core.sql`), con las reglas de negocio de la sección anterior. Idempotente (`INSERT ... ON CONFLICT DO UPDATE`), para poder re-correr sin duplicar.
4. **Refresh de `api`** (materialized views) al final de cada corrida.
5. **`ops.etl_log`**: una fila por corrida (tabla, filas leídas, filas cargadas, duración, errores) — reemplaza a `dbo.cache_meta` con algo consultable y con historial, no solo el último valor.

## Plan para el linked server externo (`UATAC_SISEAA.CnhSISEAA`)

Es el único punto que no se resolvió en la auditoría (queda fuera de `172.16.200.99`) — alimenta `entitlements.v_general_info` (nombres/vigencia de bloque), que el backend usa solo para *lookup* de metadatos (no para las métricas numéricas de producción/reservas). Impacto real si se retrasa: nombres de bloque desactualizados, no números de producción incorrectos.

**Opción A — acceso directo (preferida, gestionar primero):** pedir al administrador de `UATAC_SISEAA` credenciales de solo lectura para incluir `INTEGRAL_ASIGNACIONES_TOTAL` como una fuente más del mismo ETL Python (un `pyodbc.connect` más, con su propio `.env`). Costo: una solicitud de acceso + coordinación de red (¿es el mismo servidor físico o uno distinto? confirmar con IT). Es la única opción que mantiene el dato realmente vivo.

**Opción B — exportación programada (si A tarda o se niega):** pedir al equipo dueño de SISEAA un export periódico (CSV/Parquet, semanal o mensual — este catálogo cambia poco) dejado en una carpeta compartida; el ETL lo recoge como si fuera un archivo de staging más (`staging.stg_integral_asignaciones_total_manual`). Riesgo: depende de que alguien lo suba a tiempo; mitigar con alerta si el archivo no se actualiza en N días.

**Opción C — desacoplar por completo (fallback si A y B no son viables a corto plazo):** dado que el uso real es solo `BLOCK_ID → BLOCK_NAME` + vigencia (metadatos, no series numéricas), convertir `core.dim_bloque_siseaa` en una **tabla mantenida manualmente** dentro de TIH (carga inicial desde el último dato disponible, actualizaciones trimestrales manuales vía un endpoint admin o un CSV). Se pierde "tiempo real" en ese único campo, pero el resto del sistema (99% de las consultas) queda completamente independiente de un servidor externo que hoy ni siquiera se pudo auditar.

**Recomendación**: perseguir A en paralelo mientras se lanza el resto de la migración con C como fallback inmediato — así el rediseño de Postgres no queda bloqueado esperando una gestión de acceso entre equipos.

## Orden de ejecución

1. ✅ Crear los 3 esquemas + `ops` en Postgres (`sql/01_staging_schema.sql`, `02_core_schema.sql`, `03_api_schema.sql`).
2. ✅ Confirmar significado de `id=1/2` — resuelto: `id=1` es fila de total/placeholder, se descarta en el ETL (ver regla #6).
3. ✅ ETL Python de `staging`, los 8 dominios (`etl/01_*.py` … `etl/08_*.py`).
4. ✅ `04_transform_staging_to_core.sql` corrido y validado dominio por dominio contra SQL Server real — ver [MIGRATION_STATUS.md](MIGRATION_STATUS.md) para el detalle y los bugs corregidos.
5. **Pendiente**: publicar `api.*` como fuente real del backend de FastAPI, apuntando router por router (no todo de golpe) detrás de un flag, comparando respuestas contra el backend actual antes de cortar SQL Server.
6. **Pendiente**: gestionar acceso a `UATAC_SISEAA` en paralelo (Opción A del linked server) sin bloquear el paso 5.

## Archivos de este plan

- `sql/01_staging_schema.sql` — DDL de staging (espejo de origen).
- `sql/02_core_schema.sql` — DDL de dimensiones y hechos, particionado e índices.
- `sql/03_api_schema.sql` — vistas/vistas materializadas que consume el backend.
