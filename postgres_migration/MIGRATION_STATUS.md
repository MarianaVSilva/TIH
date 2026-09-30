# Estado de la migración a PostgreSQL — bitácora

> Complementa [00_PLAN.md](00_PLAN.md) (arquitectura y plan) con el estado real de lo ejecutado: qué se corrió, contra qué instancia, qué se validó y qué bugs se encontraron y corrigieron en el camino. Última actualización: 2026-08-20.

## Instancia de referencia usada en esta migración

- Postgres 17, `localhost:5433`, base `tih_pg`, usuario `postgres`. Credenciales en `postgres_migration/.env` (gitignoreado).
- SQL Server origen: `172.16.200.99\UMBRACODB`, credenciales en `backend/.env` (las mismas que usa el backend hoy).
- Esta es una instancia de **prueba/desarrollo** para validar el diseño — no es la instancia de producción. Antes de cortar a producción real, repetir el mismo proceso contra la instancia definitiva.

## Estado: los 8 dominios de TIH están extraídos, transformados y validados

| # | Dominio (router actual) | Script extracción | Filas en `core` | Validación |
|---|---|---|---|---|
| 1 | Precios / Temas (menú) | `etl/01_extract_precios_cubos.py` | 10,482 precios / 35 temas | Exacto (`validate_precios_cubos.py`) |
| 2 | Reservas por campo | `etl/02_extract_reservas_campos.py` | 31,770 | Exacto, 8 años muestreados (`validate_reservas_campos.py`) |
| 3 | Producción por estado | `etl/03_extract_produccion_estado.py` | 3,880 | Exacto, 27 años (2000-2026) (`validate_produccion_estado.py`) |
| 4 | Producción por campo | `etl/04_extract_produccion_campos.py` | 225,412 | Exacto, 67 años (1960-2026) (`validate_produccion_campos.py`) |
| 5 | Producción por pozo | `etl/05_extract_produccion_pozos.py` | 3,427,548 | 2016-2021 exacto; 1930-2015 <0.1% (redondeo); 2022-2026 con brecha ~5% explicada (ver abajo) (`validate_produccion_pozos.py`) |
| 6 | Producción por operador (IP) | `etl/06_extract_produccion_operador_ip.py` | 38,074 | Empresas exactas (11/11 años); montos <0.4% (`validate_produccion_operador_ip.py`) |
| 7 | Inversiones aprobadas | `etl/07_extract_inversiones.py` | 207,579 | Exacto al dólar: $70,878,978,864 USD (`validate_inversiones.py`) |
| 8 | Licitaciones / pozos comprometidos | `etl/08_extract_licitaciones.py` | 112 + 5,527 | Exacto (`validate_licitaciones.py`) |

**Orden de ejecución para reproducir desde cero:**
```bash
# 1. Crear esquema (una sola vez)
psql -f sql/01_staging_schema.sql
psql -f sql/02_core_schema.sql
psql -f sql/03_api_schema.sql

# 2. Extraer (en cualquier orden, son independientes)
py -3 etl/01_extract_precios_cubos.py
py -3 etl/02_extract_reservas_campos.py
py -3 etl/03_extract_produccion_estado.py   # incluye sih_produccion_d2016, reusada por otros dominios
py -3 etl/04_extract_produccion_campos.py
py -3 etl/05_extract_produccion_pozos.py    # el mas grande, ~15-20 min (2.77M filas)
py -3 etl/06_extract_produccion_operador_ip.py
py -3 etl/07_extract_inversiones.py
py -3 etl/08_extract_licitaciones.py

# 3. Transformar TODO staging -> core (un solo script, orden interno ya resuelto)
psql -f sql/04_transform_staging_to_core.sql

# 4. Validar (opcional pero recomendado tras cualquier cambio)
py -3 etl/validate_precios_cubos.py
py -3 etl/validate_reservas_campos.py
py -3 etl/validate_produccion_estado.py
py -3 etl/validate_produccion_campos.py
py -3 etl/validate_produccion_pozos.py
py -3 etl/validate_produccion_operador_ip.py
py -3 etl/validate_inversiones.py
py -3 etl/validate_licitaciones.py
```
El transform (`sql/04_transform_staging_to_core.sql`) es **idempotente**: usa `TRUNCATE` + `INSERT` o `ON CONFLICT DO UPDATE` según la tabla, así que se puede re-correr completo tras cualquier extracción sin duplicar datos.

## Bugs reales encontrados y corregidos durante la migración

Todos se encontraron **comparando contra los números reales que hoy devuelve SQL Server** (no por inspección de código) — es la razón de ser de la validación dominio por dominio en vez de asumir que el diseño en papel era correcto.

| # | Dominio | Bug | Causa raíz | Corrección |
|---|---|---|---|---|
| 1 | Precios | Perdía el valor de `mme` en 9 fechas | Tomaba "la fila más reciente completa" cuando el origen tiene filas con la MISMA fecha y valores en conflicto (una con dato, otra sin él) | Coalesce columna por columna, no fila por fila |
| 2 | Reservas por campo | Subestimaba totales | Asumía una fila por campo/fecha/categoría; el origen tiene grano más fino (hasta 3 filas por combinación) | `SUM` en vez de tomar una fila |
| 3 | Producción por estado | Perdía ~20-25% del histórico ≤2016 | Histórico viene a nivel MUNICIPIO (hasta 47 filas por entidad/fecha); `ON CONFLICT DO NOTHING` se quedaba solo con la primera | `SUM GROUP BY` antes del upsert |
| 4 | Producción por campo | `petroleo_api` fallaba con error de tipo | Es categórico (`Ligero`/`Pesado`...) en el origen, no numérico como asumía la documentación heredada | Columna `TEXT`, valor representativo en vez de `AVG` |
| 5 | Producción por campo | `(fecha,campo,tipo)` no es clave única | Múltiples contratos por campo/mes + sub-grano adicional no capturado | PK ampliada con `contrato_id`, `SUM` dentro del grupo |
| 6 | Producción por campo | Histórico 1960-2015 (67 años) desaparecía completo | `asig_cont` es `NULL` en 99% del histórico pre-reforma energética; `INNER JOIN` descartaba esas filas | Contrato sentinela `'(SIN ASIGNACION)'` |
| 7 | Producción por pozo | Histórico completo en 0 filas | Cruce por `WID` (identificador físico) contra `dim_pozo.well_id` — son namespaces distintos, nunca calzan | Join directo por `well_id` |
| 8 | Producción por pozo | Totales ~15-20% más altos que SQL Server | La vista SQL Server usa `UNION` (no `UNION ALL`); había 19,039 duplicados exactos solo en 2015 | `DISTINCT` antes de sumar |
| 9 | Producción por pozo | Violación de PK al final | Dos filas del origen con mismo pozo/fecha/valor pero `cuenca` distinta (una vacía) resolvían a `geografia_id` distinto | Agrupar por la PK real `(fecha,pozo_id)`, valor representativo para `contrato_id`/`geografia_id` |
| 10 | Producción por operador | Aparecía producción falsa en todo el histórico ≤2015 | Faltaba el filtro `AND ASIG_CONT IS NOT NULL` de la vista original | Excluir el contrato sentinela explícitamente |
| 11 | Producción por operador | Perdía empresas co-participantes de un mismo contrato | Un `LATERAL LIMIT 1` colapsaba a una sola empresa por contrato cuando SQL Server reparte la misma producción entre varias (fan-out intencional) | Permitir el fan-out por empresa; deduplicar solo dentro de la misma empresa |
| 12 | Pozos comprometidos | `terminados`/`en_perforacion` en 0 para varios contratos | Comparación de texto case-sensitive en Postgres vs. collation case-insensitive de SQL Server (`EK-BALAM` ≠ `Ek-Balam`) | `upper()` en ambos lados de los joins de texto |

**Patrón general que vale la pena recordar para lo que falta**: cada vez que se asumió "esta combinación de columnas es una clave única" sin probarlo contra los datos reales, hubo un bug. La regla que quedó validada en la práctica: **nunca insertar en una tabla con clave compuesta sin antes correr un `GROUP BY ... HAVING COUNT(*) > 1` contra el staging real.**

## Diferencia conocida y aceptada (no es un bug)

`PRODUCCION_POZOS` 2022-2026 tiene ~5% menos volumen en Postgres que en la vista SQL Server. Causa: ~1-2% de las filas de producción reciente tienen `well_id = NULL` en el origen (producción sin pozo específico atribuido). Como `core.fact_produccion_pozo` es una tabla de grano "por pozo" con FK obligatoria, esas filas no tienen dónde ir — es correcto excluirlas de una tabla cuyo grano es por-pozo. Si se necesita ese ~5% en algún reporte, debe modelarse aparte (no pertenece a un fact table por pozo).

## Dominio #9 encontrado tarde: RESERVAS_ASIG_CONT

Al portar `reservas_service.py` (fase de backend) se descubrió que `core.fact_reservas_asignacion` **nunca se cargó** en la fase de datos — quedó vacía porque el dominio `dbo.reservas_asig_cont`/`reservas_asig_cont_campos` no estaba en la lista de 8 que se auditaron con foco de "qué usa el frontend hoy" (existía en `DATABASE_DEPENDENCIES.md` pero se traspapeló al planear el ETL). Corregido:
- `etl/09_extract_reservas_asig_cont.py` — extrae `cmde_valid.dbo.sih_reservas` (19,126 filas) y `cmde_public.dbo.general_info_estados` (693 filas, nombres de bloque).
- `sql/04_transform_staging_to_core.sql` — replica el self-join acumulativo por `CLASS_ID` (1P/2P/3P) de la vista SQL Server, filtrado a `fecha>=2016-01-01` igual que el original. **Simplificación consciente**: no se replicó el detalle por campo (`reservas_asig_cont_campos`) porque el único uso real en el backend de esa vista es un catálogo código→nombre de bloque, que ya se resuelve vía `core.dim_bloque` sin necesitar el grano por campo — si en el futuro se necesita el desglose por campo, hay que ampliar esta parte.
- Validado por paridad exacta contra el backend real (`reservas_service.py` completo, las 6 funciones, salida byte-a-byte idéntica) — ver sección de porteo de backend.

**Lección**: la lista de "8 dominios" se armó mirando `services/*.py` de arriba hacia abajo, pero un archivo (`reservas_service.py`) usa dos tablas de origen distintas (`RESERVAS_CAMPOS` y `reservas_asig_cont`) y solo se migró la primera. Al portar el backend completo (paso siguiente), cada servicio es una buena lista de verificación cruzada de qué tablas de origen tocar — vale la pena revisar los demás servicios contra esta misma lista antes de darlos por completos.

## Backend portado a Postgres (paso 5 del plan, en curso)

Patrón: `settings.db_engine` (`"mssql"` por defecto, `"postgres"` opt-in vía `.env`) selecciona el motor en `backend/app/database.py`; cada servicio porta sus queries con una rama `if settings.db_engine == "postgres"` apuntando a `api.*`, verificada con paridad exacta (mismo output, byte a byte) contra la ruta SQL Server antes de darla por buena.

| Servicio | Estado | Verificación |
|---|---|---|
| `temas_service.py` | ✅ portado | Idéntico (25 temas, mismo orden) |
| `precios_service.py` | ✅ portado | Idéntico (`get_precios` anual/diario, roundtrip `PRECIOS_AUTOM`) |
| `reservas_service.py` | ✅ portado | Idéntico (6 funciones) — encontró el dominio #9 faltante (ver arriba) |
| `inversiones_service.py` | ✅ portado | Idéntico en estructura/valores; **diferencia cosmética intencional**: `ANIO` es `FLOAT` en el esquema SQL Server original (`"2020.0"` en las categorías), se modeló correcto como `INTEGER` en `core.fact_inversiones` (`"2020"`) — mejora de tipo, no bug. Aviso para QA de frontend si algo dependía del sufijo `.0`. También se encontró y corrigió `cuenca` faltante en `core.fact_inversiones`/`api.v_inversiones_aprobadas` (se me había pasado en el diseño original). |
| `estado_service.py` | ✅ portado | Idéntico (mensual, anual, filtro por años sueltos) |
| `contratos_service.py` | ✅ portado | Idéntico en 6 de 7 funciones; 1 diferencia cosmética (ver abajo). Encontró **4 bugs reales** de esquema — ver detalle abajo. |
| `produccion_service.py` | ✅ portado | 15/17 funciones idénticas exactas. 2 diferencias aceptadas y documentadas (ver abajo) — ninguna es un bug nuevo. |
| `pozos_service.py` | ✅ portado | Ver "Estado de `pozos_service.py`" abajo — discrepancia de árbol de navegación resuelta (5 bugs reales encontrados y corregidos); 1 diferencia residual explicada (pozos exploratorios sin `WELL_ID`). |
| `perforacion_service.py` | ✅ portado | Ver "Estado de `perforacion_service.py`" abajo — dominio nuevo (3 vistas + 1 tabla staging), validado exacto en 5 de 6 funciones. |
| `resumen_service.py` | ✅ portado | Sin SQL propio — orquesta los demás servicios ya portados en paralelo. Validado idéntico salvo diferencias ya aceptadas (ver abajo). |

### Estado de `perforacion_service.py` (dominio nuevo, portado y validado)

Las 3 fuentes (`PERFORACION_POZOS_PERF/TERM/EQUIPOS`) resultaron estar definidas enteramente sobre `cmde_valid.dbo.bd_pozos` — pero una version **distinta** de la ya migrada (`cmde_raw.dbo.bd_pozos`, usada para `dim_pozo`): 34,477 filas vs 34,850, con columnas `YEAR`/`RIG_NAME` que la version raw no tiene. Se agregó `staging.stg_bd_pozos_valid` (`etl/11_extract_bd_pozos_valid.py`) y 3 vistas nuevas en `api.*` que replican línea a línea `OBJECT_DEFINITION` de cada vista SQL Server real (sin fact table dedicada — la fuente es chica y el cálculo es agregación directa).

**Bugs reales encontrados y corregidos durante la validación:**
1. `STATUS = 'CONCLUIDO'` (case-sensitive) nunca matcheaba — el origen trae `'Concluido'` mixto. Corregido a `upper(status) = 'CONCLUIDO'`.
2. El `CASE` que mapea `TYPE` → `categoria_pozo` (`'DELIMITADOR'`/`'EXPLORATORIO'` → `'Exploración'`, etc.) también comparaba case-sensitive contra un origen mixto (`'Delimitador'`) — nunca matcheaba, dejando "Delimitador"/"Exploratorio" como dos categorías falsas en vez de fusionarse en una. Causaba en `PERFORACION_EQUIPOS` un fan-out de 4048 filas en vez de las 3706 reales. Corregido con `upper(type)` en las 3 vistas.
3. **`get_perforacion_historico`** ordenaba (`df.sort_values(orden)`) con nombres de columna en MAYÚSCULAS antes de bajarlas a minúsculas — funciona en SQL Server (`pd.read_sql` conserva el case del `SELECT`) pero revienta en Postgres (que devuelve identificadores sin comillas en minúsculas). Corregido invirtiendo el orden (lower primero).
4. **Hallazgo lateral en `PRODUCCION_CAMPOS_POZOS`** (dominio de `produccion_service.py`, no de este porteo): la rama vigente de `core.fact_produccion_campo_pozos` resolvía `campo_portal` con `upper(campo_nombre)` (nombre "bonito" con acentos, ej. `"ÉBANO"`), pero `core.dim_campo` se había poblado con `campo_alias` (código sin acentos, `"EBANO"`) desde la rama histórica — el join nunca calzaba para campos con acento en su nombre, y 13 campos completos (`EBANO`, `TREVIÑO`, `POKCHÉ`, `BAKTÉ`, ...) desaparecían de `PRODUCCION_CAMPOS_POZOS` y de sus filtros/totales. Corregido usando `campo_alias` consistentemente. Efecto: el total nacional de "Pozos operando" (`PozosCampos`) pasó de estar sistemáticamente ~0.5% por debajo a **coincidir exacto año por año** (`[8053, 7814, 7366, 7098, 7020, 7016, 6815]` idéntico en ambos motores).
5. **Ambigüedad preexistente en el lookup pozo→campo de `get_perforacion_pozos_detalle`**: un pozo perforado puede tener más de un `ASIG_CONT` distinto en su historial de producción (una asignación real y, en otro registro, una administrativa `'ADM-%'` — ver nota de `dim_contrato` arriba); `dict(zip(...))` se quedaba con el último visto, no determinista, y tras agregar el fallback `ADM-%` (pedido del usuario) empezó a mostrar `ADM-E-0010` en vez del campo real para un pozo de prueba. Corregido ordenando para que una asignación real siempre gane sobre `ADM-%`.

**Validado exacto (`DB_ENGINE=mssql` vs `postgres`, funciones reales):** `get_perforacion_filtros` (los 4 topics), `get_perforacion` (`PozPerf`, `PozTerm`, `EqPerf`, y `PozosCampos` — totales nacionales exactos).

### Estado de `resumen_service.py` (último servicio — portado sin cambios propios)

Este archivo no tiene SQL propio: `get_resumen()` orquesta en paralelo (`ThreadPoolExecutor`) a `produccion_service`, `precios_service`, `perforacion_service`, `reservas_service`, `contratos_service` e `inversiones_service` — todos ya portados. Validado con `DB_ENGINE=mssql` vs `postgres` sobre `get_resumen()` completo.

**Bug real encontrado y corregido (en `reservas_service.get_reservas`, no en `resumen_service.py`):** `EXTRACT(YEAR FROM fecha)` en Postgres devuelve `numeric` (no entero como `YEAR(fecha)` en SQL Server); a esta función (a diferencia de las otras dos de ese mismo archivo, que sí lo hacían) le faltaba `df["anio"].astype(int)` antes de construir `categories = [str(a) for a in anios]` — salían categorías `"2021.0"` en vez de `"2021"` en el gráfico de Reservas del panorama general. Corregido agregando el cast, igual que en las funciones hermanas.

**Diferencias aceptadas, no nuevas:**
- Precio Brent promedio anual con ruido de redondeo de <0.01% (`100.97` vs `100.98` en un promedio de USD/barril) — mismo tipo de ruido de agregación ya documentado para `produccion_service.py`.
- `Inversión aprobada`: categorías `"2021.0"` en SQL Server vs `"2021"` en Postgres — es la mejora de tipo `ANIO` FLOAT→INTEGER ya documentada arriba para `inversiones_service.py` (dirección inversa a la del bug de reservas: aquí SQL Server es el que trae `.0`, no Postgres).
- `indicadores_economicos.mezcla_mexicana.anterior` difiere entre motores — **no es un bug de migración**: viene de `PRECIOS_AUTOM`/`core.fact_precios_autom`, una tabla que el backend mismo escribe en vivo día a día (RSS de Pemex), no una tabla migrada por ETL. Cada motor acumula su propio historial según cuándo se ha ejecutado contra él; es esperable que difieran hasta que ambas tengan el mismo tiempo de operación acumulado.

Con esto, **los 12 servicios de `backend/app/services/` quedan portados** (`temas`, `precios`, `reservas`, `inversiones`, `estado`, `contratos`, `produccion`, `pozos`, `perforacion`, `resumen`, más `pozos_cache`/`chat` que no requieren SQL de negocio).

**Diferencia residual aceptada, no perseguida más:** 5 de 673 nombres de campo (`CHIAPAS-COPANO`, `CUICHAPA-PONIENTE`, `JUJO-TECOMINOACAN`, `LUNA-PALAPA`, `TUPILCO PROFUNDO`/`TUPILCOPROFUNDO`) tienen variantes de espacio/guión distintas entre la tabla histórica (`stg_produccion_campos_pozos_a2016.campo_portal`) y el catálogo `cat_campos_alias` — inconsistencia preexistente en el origen, no introducida por la migración; afecta solo el listado de nombres en `filtros_campos.operadores`, no los totales. `get_perforacion_pozos_detalle` (campo #5 arriba) queda con algunas filas donde el campo de referencia cruzada difiere por la ambigüedad histórica ya descrita — es un dato secundario (enlace de navegación), no la cifra principal de la tabla.

### Estado de `pozos_service.py` (portado y validado — discrepancia de árbol resuelta)

Este servicio navega por nombre de campo/pozo (`ASIG_CONT`/`WELL_NAME`), no por ID interno — mucho más sensible a diferencias textuales que el resto del backend.

**Corregido y confirmado durante el porteo (ronda 1):**
1. `ASIG_CONT` de `PRODUCCION_POZOS` (vigente) **no es el código crudo de bloque** (`A-0203`) — es `BLOCK_NAME` completo de `ENTITLEMENTS_GENERAL_INFO` con reemplazo de acentos (`"A-0203-3M - Campo Maloob"`). La primera versión usaba el código crudo; corregido con `translate()` replicando la cadena de `REPLACE` de la vista SQL Server.
2. `WELL_NAME` va en mayúsculas en la vista SQL Server (`UPPER(WELL_NAME)`) para la rama vigente; `api.v_produccion_pozos` no lo hacía. Corregido.

**Investigación retomada — causa raíz real de "5 cuencas SQL Server vs 4 Postgres" (no era `MIN(geografia_id)` como se sospechaba):** se bajó a la definición literal de `cmde_valid.dbo.produccion_pozos` (`OBJECT_DEFINITION`) en vez de seguir sospechando en el vacío. Se encontraron y corrigieron **5 bugs reales** en `04_transform_staging_to_core.sql`:
1. **`cuenca` de la rama histórica usaba la columna equivocada.** La vista SQL Server tiene la columna `PROD_A_2016.cuenca` explícitamente comentada/reemplazada por `UPPER(BDP.PETROLEUM_PROVINCE)` (de `bd_pozos`). El transform usaba `staging.stg_produccion_pozos_a2016.cuenca` (la que SQL Server descarta). Corregido: se usa `dim_pozo.provincia_petrolera` (ya poblado desde `bd_pozos.petroleum_province`, vía el join por `well_id` que ya identifica el pozo correctamente).
2. **El sentinel `'(SIN ASIGNACION)'` no aplica a `produccion_pozos`.** `PRODUCCION_POZOS_A2016.asignacion_contrato` está **100% NULL en la fuente** (confirmado: `COUNT(asignacion_contrato)=0` sobre 2,776,502 filas) — a diferencia de `PRODUCCION_CAMPOS`, esta vista SQL Server nunca sustituye ese NULL. Como `get_produccion_pozos_arbol` filtra `WHERE ASIG_CONT IS NOT NULL`, toda la rama histórica queda excluida del árbol en SQL Server. Usar el sentinel (patrón correcto para `PRODUCCION_CAMPOS`, incorrecto aquí) hacía que ~2.7M filas históricas aparecieran como pozos de un campo falso. Se quitó el fallback para esta tabla — también se quitó el mismo sentinel indebido (`ctdef`) de la rama vigente.
3. **`core.dim_bloque` nunca se actualizaba entre corridas del transform.** Usaba `ON CONFLICT (block_id) DO NOTHING`, así que una fila cargada en una corrida anterior a esta sesión (con un sufijo de versión de `block_name` desactualizado, p.ej. `"A-0006-3M"`) nunca se refrescaba aunque `ENTITLEMENTS_GENERAL_INFO` ya tuviera el valor vigente (`"A-0006-2M"`) en `staging`. Cambiado a `DO UPDATE`.
4. **Un segundo `INSERT` a `dim_bloque` (dominio de licitaciones/reservas, tabla `staging.stg_general_info_estados`) pisaba el valor correcto** de la fuente autoritativa (`ENTITLEMENTS_GENERAL_INFO`) con un snapshot de otra tabla, potencialmente desfasado en el tiempo. Cambiado a `DO NOTHING` para que la fuente autoritativa nunca se sobreescriba.
5. **Fallback indebido al código crudo de bloque cuando no hay match en `ENTITLEMENTS_GENERAL_INFO`.** La vista SQL Server solo cae al código crudo (`ASIG.block_name = SIH.block_id`) cuando `block_id LIKE 'CNH-%'`; para cualquier otro código sin match (p.ej. bloques administrativos `ADM-E-002`) `ASIG_CONT` queda NULL. El transform aplicaba ese fallback a cualquier `block_id`, generando "campos" falsos (`ADM-E-*`) que SQL Server nunca muestra. Corregido: el fallback ahora es condicional a `block_id LIKE 'CNH-%'`, igual que la vista real (aplicado tanto en la población de `dim_contrato` como en el join de `fact_produccion_pozo`). **Actualización posterior, pedido explícito del usuario:** los bloques `ADM-%` (un tipo de asignación administrativa nueva, sin registro en `ENTITLEMENTS_GENERAL_INFO`) SÍ se quieren ver en el árbol de pozos, a diferencia de SQL Server que los excluye — se agregó `ADM-%` al mismo fallback condicional junto a `CNH-%`, en `dim_bloque`, `dim_contrato` y el join de `fact_produccion_pozo`. Es una mejora intencional sobre el comportamiento de SQL Server, no un bug de paridad — 5 bloques `ADM-E-*` confirmados visibles (`ADM-E-001`, `ADM-E-002`, `ADM-E-003`, `ADM-E-0010`, `ADM-E-0011`) sin introducir regresión en el resto del árbol (re-verificado: mismo único caso residual explicado abajo).
6. **`dim_geografia` no tenía filas en mayúsculas exactas para el texto crudo de `cuenca` de la rama vigente** (el join `g.cuenca = upper(s.cuenca)` es case-sensitive del lado de `g`, y existían filas como `'Sabinas'`/`'Cinturon Plegado de Chiapas'` en minúscula/mixta de otros dominios). Se agrega un `INSERT` que asegura una fila en mayúsculas por cada texto de cuenca crudo usado en esta rama, igual que ya se hacía para `petroleum_province`.

**Resultado de la reinvestigación:** comparando el conjunto completo `(cuenca, asig_cont)` vía consulta directa a SQL Server (`OBJECT_ID`, no la app) contra `api.v_produccion_pozos`, se pasó de **439 diferencias** a **1 diferencia** (437 de 439 combinaciones exactas, más las 2 explicadas abajo). Se confirmó además con la función real del backend (`get_produccion_pozos_arbol`, `DB_ENGINE=mssql` vs `DB_ENGINE=postgres`, JSON completo comparado): **5 de 5 cuencas idénticas**, con 2 campos de diferencia sobre cientos.

**Diferencia residual explicada (no es un bug):** los 2 campos que difieren (`AE-0159-M - CHALABIL` y `CNH-R02-L03-VC-02/2017`) tienen la misma causa: dependen de un pozo con `WELL_ID = NULL` incluso en el origen SQL Server (`TUMUT-101EXP`, `UXU-1EXP` — pozos exploratorios recién perforados, solo tienen `WID`, sin `WELL_ID` asignado todavía en `bd_pozos`). La vista SQL Server los muestra igual porque no depende de `WELL_ID` para nada (pasa `WID`/`WELL_NAME` crudos); nuestro esquema estrella sí requiere `well_id` para adjuntar una fila de hecho a `dim_pozo` — es una limitación estructural inherente al diseño dimensional, no un error de lógica. Impacto: pozos exploratorios sin `WELL_ID` quedan fuera de la navegación por árbol hasta que se les asigna un `WELL_ID` real (lo cual ocurre normalmente cuando el pozo se valida/registra).

Lo que SÍ está validado con confianza para este dominio: los totales agregados de `PRODUCCION_POZOS` (sección de dominio de datos, arriba) coinciden exactos vía `well_id` para 2016-2021 y dentro de <0.1% para el resto, y ahora también el árbol de navegación completo (`detalle`, `análisis`, `ranking`, `comparar`, `filtrados` dependen de la misma resolución de cuenca/campo, ya corregida).

### Dominio #10 y #11 encontrados al portar `produccion_service.py` (el archivo más grande, 1542 líneas / 17 funciones)

1. **`PRODUCCION_CAMPOS_POZOS` (conteo de pozos operando) nunca se migró** — dominio completo faltante, usado por `get_pozos_operando()`. Se construyó de cero: `etl/10_extract_produccion_campos_pozos.py`, `core.fact_produccion_campo_pozos`, `api.v_produccion_campos_pozos`, y la transformación (réplica del `UNION` histórico + agregado por pozo desde `sih_produccion_d2016`/`cat_campos_alias`). **Bug encontrado en el camino**: la vista SQL Server agrupa por `(WELL_ID, WELL_NAME)`, no solo `WELL_ID` — hay filas con `WELL_ID` nulo pero `WELL_NAME` distinto que SQL Server cuenta como pozos separados; agrupar solo por `WELL_ID` los colapsaba, restando ~1.5% del conteo. Corregido agregando `well_name` a la agrupación. Validado exacto en los 3 meses más recientes.
2. **`dim_campo.geografia_id` nunca se poblaba desde los datos de producción** — solo se llenaba vía `RESERVAS_CAMPOS`/`campos_loc`. Para campos que solo existen en `PRODUCCION_CAMPOS` (no en el catálogo de reservas), `cuenca`/`ubicacion` salían `NULL` en `api.v_produccion_campos`, rompiendo silenciosamente `get_produccion_cuenca()`. Corregido: el ETL de producción ahora resuelve y completa `geografia_id` también.
3. **Columnas de composición de gas nunca se cargaron a `core`** (`C1`-`C5`, `IC4`, `CO2`, `H2S`, `H2O`) — estaban en `staging` desde la primera ronda pero nunca llegaron a `core.fact_produccion_campo` ni a `api.v_produccion_campos`, rompiendo `get_produccion_gcompo()`. Agregadas.

### Diferencias aceptadas en `produccion_service.py` (no son bugs)

- **`get_produccion_api`** (clasificación por gravedad API): valores con ruido de <0.5% en algunas celdas (los totales/KPIs coinciden exacto). Causa: `petroleo_api` se colapsa a un valor representativo por `(fecha,campo,contrato,tipo)` en `core.fact_produccion_campo`, pero SQL Server agrupa también por `PETROLEO_API` en esta consulta puntual, permitiendo que un mismo campo reparta producción entre 2 clases API en el mismo mes. Afecta solo esta vista de desglose, no los totales.
- **`get_asignaciones_ranking`**: los campos de metadata de bloque (`activity`, `area_km2`, `basin`, `environment`, `plan`, `productividad_mbd_km2`, `start_date`, `end_date`, `validity`) salen `None` — es el hueco de SISEAA ya documentado desde el inicio de la migración (`00_PLAN.md`, "Plan para el linked server"), no un bug nuevo. Los datos numéricos (producción, orden del ranking) coinciden exactos.

### Bugs encontrados al portar `contratos_service.py` (los más serios hasta ahora)

1. **`licitaciones_bloques_ofertas.contrato` es la MODALIDAD, no un código de contrato** (`"Producción compartida"`, `"Licencia"`) — el identificador real está en `contrato_nombre`. La primera versión del ETL usó `contrato` para poblar `dim_contrato`, contaminándolo con texto de modalidad en vez de códigos reales. `core.fact_licitaciones_ofertas` no tenía columnas para `modalidad`/`contrato_nombre`/`id_licitante`/`id_licitante_adj` — se agregaron, y `api.v_licitaciones_ofertas` se rediseñó para exponer las columnas 1:1 con la tabla original (misma ambigüedad `contrato`=modalidad) en vez de intentar "arreglarlo" en la vista, para que el backend pueda alias igual que hace hoy.
2. **`INVERSIONES_APROBADAS` tiene DOS columnas parecidas**: `ASG_CONT` (categórica, siempre `'Contrato'` tras el filtro `REPORTE/VIGENTE` — no es un bug del origen, es un flag de tipo) y `CONTRATO` (el código real, el que usan `get_pozos_comprometidos` y otros). El ETL original usó `ASG_CONT` por error — `dim_contrato` quedaba con una sola fila literal `"Contrato"` y cualquier join `INVERSIONES_APROBADAS↔otra tabla` por código de contrato fallaba en silencio.
3. **Mismo contrato, mayúsculas distintas entre tablas de origen** (`rdmx.T_21a_PozosComprometidos` trae `"Ek-Balam"`, `INVERSIONES_APROBADAS`/`T_12_Pozos` traen `"EK-BALAM"`). SQL Server compara texto sin distinguir mayúsculas por *collation* default; Postgres sí distingue — mismo patrón que el bug #12 de la ronda anterior, pero esta vez afectaba a **todo el modelo**, no un solo dominio. Se normalizó `dim_contrato.asig_cont` a mayúsculas en **todos** los puntos de inserción/join del transform (11 sitios). Efecto secundario cosmético aceptado: los códigos de contrato se muestran siempre en mayúsculas consistentes (antes mezclaban según la tabla de origen) — mejora de consistencia, no pérdida de dato.
4. **`dim_empresa` se poblaba en la columna equivocada** para el dominio de licitaciones: se llenaba `contratista_corto`, pero `api.v_licitaciones_ofertas` lee `contratista` (columna distinta, pensada para nombres completos vs. cortos de `empresas_ip_hist`). Resultado: `get_contratos_adjudicados()` colapsaba **todas** las empresas a "Sin clasificar". Se llenan ambas columnas para este dominio (solo hay un nombre disponible).
5. **`PRODUCCION_OPERADOR_IP` perdía la mitad del volumen en meses con modificación contractual a mitad de mes** (mismo contrato, misma empresa, dos fragmentos con distinto `FACTOR_MES`) — la corrección de fan-out de la ronda anterior (pensada para el caso de *varias empresas* en un contrato) también colapsaba este caso por error, tomando un fragmento representativo en vez de sumar ambos. Corregido a `SUM` para las métricas de producción (dejando `factor_o`/`factor_ip`/`factor_mes`/`dias_produccion` como valor representativo, ya que son atributos de un fragmento, no algo que tenga sentido sumar). **Efecto colateral positivo**: esto también eliminó el ruido residual de <0.4% que había quedado en la validación de `PRODUCCION_OPERADOR_IP` — ahora es exacto en los 11 años.

## Lo que falta

1. Portar los 7 servicios restantes (ver tabla arriba), mismo patrón: rama `postgres`, verificación de paridad exacta antes de avanzar.
2. **Linked server SISEAA** (`entitlements.v_general_info` / nombres de bloque) — plan ya definido en `00_PLAN.md`, pendiente de decisión de negocio (Opción A/B/C).
3. **Vistas materializadas de `api`** (`mv_produccion_campos_mensual`, `mv_ranking_operadores_anual`) están creadas pero nunca se refrescaron con datos reales — correr `SELECT ops.refresh_api_materialized_views();` tras la carga completa.
4. Revisar el caso ambiguo de `PRECIOS` 2022-02-02 (dos valores de `brent` distintos con el mismo timestamp de inserción en el origen — ambigüedad real de la fuente, no de la migración).
5. Los scripts `validate_*.py` en `etl/` son herramientas de verificación puntual, no pruebas automatizadas — si se quiere CI, convertirlos a un runner único con assertions.
6. Antes de dar por cerrado el porteo de backend, revisar **cada** `services/*.py` contra las tablas de origen que realmente toca (no asumir que coincide con la lista de 8/9 dominios ya migrados) — el caso de `reservas_asig_cont` demuestra que puede haber más de una tabla de origen por archivo de servicio.
