# Mapa real de dependencias — TIH → SQL Server (auditado en vivo, 2026-08-19)

> Generado conectando directamente a `172.16.200.99\UMBRACODB` (usuario `estadistica`) y consultando `sys.objects`, `INFORMATION_SCHEMA.COLUMNS`, `sys.dm_sql_referenced_entities` y `sys.dm_sql_referencing_entities`. Reemplaza los supuestos de `DATABASE_SCHEMA.md` (que asumía tablas base) — **en realidad casi todo lo que la app consume es una VIEW**, no una tabla.

## Hallazgo principal

El backend de TIH lee de `cmde_public`, pero **`cmde_public` es casi enteramente una capa de vistas** que reexpone datos que en realidad viven en otras dos bases del mismo servidor: `cmde_valid` y `cmde_raw`. Hay 3 niveles de indirección en varios casos. Para el rediseño en PostgreSQL esto importa mucho: **no basta con migrar `cmde_public`** — hay que migrar (o recrear como vistas materializadas) las tablas de origen reales en `cmde_valid`/`cmde_raw`, y algunas en schemas especiales (`rdmx`, `entitlements`, `siseaa`).

```
Frontend
  └─ Backend (services/*.py)
       └─ cmde_public.dbo.*  (VIEWS, salvo excepciones marcadas)
            └─ cmde_valid.dbo.* / cmde_raw.dbo.*  (mezcla de VIEWS y TABLAS)
                 └─ (en algunos casos) otro nivel más de vistas/tablas base
```

## Objetos que el código consulta directamente, por base

### `cmde_public` (base configurada en `.env`, `DB_NAME`)

| Objeto que usa el código | Tipo real | Fuente inmediata | Notas |
|---|---|---|---|
| `dbo.PRODUCCION_CAMPOS` | **VIEW** | `cmde_public.dbo.produccion_campos_new` (VIEW, 32 cols) | Comentario en la vista indica que hubo un `produccion_campos_old` reemplazado. **32 objetos dependen de esta vista** (ver abajo) — tocarla rompe mucho más que TIH. |
| `dbo.PRODUCCION_CAMPOS_POZOS` | **VIEW** | `UNION` de `cmde_valid.dbo.produccion_campos_pozos_a2016` (tabla, histórico ≤2016) + cálculo sobre `cmde_valid.dbo.sih_produccion_d2016` join `cmde_valid.dbo.cat_campos_alias` | Lógica de negocio (`pozo_aceite`/`pozo_gas` derivados de si `PETROLEO_MB>0` etc.) vive **dentro de la vista**, no en el backend. |
| `dbo.PRODUCCION_ESTADO` | **VIEW** | `UNION` de cálculo sobre `cmde_valid.dbo.sih_produccion_d2016` + `cmde_valid.dbo.cat_entidades`, y `cmde_valid.dbo.produccion_estado_a2016` (histórico) | Normaliza `UBICACION` con un `CASE` (`'Terrestre'→'TERRESTRE'`, `'Aguas someras'→'MARINO'`) dentro de la vista. |
| `dbo.PRODUCCION_OPERADOR_IP` | **VIEW** | `dbo.produccion_campos` (la vista anterior, `WHERE id=2`) `LEFT JOIN` `dbo.empresas_ip_hist` (VIEW) | Contiene lógica de prorrateo por vigencia de contrato (`FACTOR_MES`, `FACTOR_IP`) calculada en SQL, no en Python. 10 objetos dependen de esta vista. |
| `dbo.PRODUCCION_POZOS` | **VIEW** (passthrough) | `cmde_valid.dbo.produccion_pozos` (también VIEW) | **Corrección post-migración (2026-08-20)**: esta vista NO es un passthrough simple — es un `UNION` de dos ramas bastante distintas: (1) histórico ≤2016 desde `cmde_valid.dbo.PRODUCCION_POZOS_A2016` (**2,776,502 filas**, más grande que `sih_produccion_d2016`) enriquecido con nombre/cuenca desde `cmde_raw.dbo.bd_pozos` vía una tabla de enlace por nombre `cmde_raw.dbo.sih_well_name_link_p_inf6016` (20,372 filas, `LEFT JOIN` por `well_name` con collation `Latin1_General_CI_AI`); (2) vigente desde `cmde_valid.dbo.SIH_PRODUCCION_D2016` agregado por pozo/fecha (`/dias_mes`) con el nombre de bloque resuelto contra `cmde_valid.dbo.ENTITLEMENTS_GENERAL_INFO` (574 filas) o, si no hay match, contra los propios `block_id LIKE 'CNH-%'` de `SIH_PRODUCCION_D2016`, con reemplazo manual de acentos mal codificados (`REPLACE` encadenado). Esto NO se detectó en la auditoría inicial (que solo veía `cmde_valid.dbo.produccion_pozos` como "VIEW, 14 columnas" sin bajar a su definición) — se encontró al construir el ETL real. |
| `dbo.RESERVAS_CAMPOS` | **VIEW** | `cmde_raw.dbo.sih_reservas_c` (tabla, 32,151 filas) `LEFT JOIN` `cmde_raw.dbo.campos_loc` (tabla, 861 filas) | Filtro `WHERE date>='2001-01-01'` fijo en la vista. |
| `dbo.INVERSIONES_APROBADAS` | **VIEW** | `cmde_valid.dbo.inversiones_aprobadas` (también VIEW) `WHERE REPORTE='SI' AND VIGENTE='SI'` | El filtro de vigencia vive en la vista, no en el backend. |
| `dbo.PRECIOS` | **VIEW** | `cmde_valid.dbo.precios` (también VIEW), con subquery de fecha máxima | |
| `dbo.CUBOS` | **TABLA real** | — | Única tabla base genuina de las consultadas en `cmde_public.dbo`. |
| `dbo.reservas_asig_cont` | **VIEW** | `cmde_valid.dbo.sih_reservas` (VIEW) `FULL JOIN` consigo misma, `LEFT JOIN cmde_raw.dbo.campos_loc` | Query compleja (self-join con `CLASS_ID >=`) para acumular 1P/2P/3P. |
| `dbo.reservas_asig_cont_campos` | **VIEW** | Igual que arriba + `LEFT JOIN cmde_public.dbo.general_info_estados` (VIEW) | |
| `dbo.PRECIOS_AUTOM` | **TABLA real, gestionada por TIH** | — | Ya documentada en `DATABASE_SCHEMA.md`; `CREATE TABLE IF NOT EXISTS` desde `precios_service.py`. Segura de migrar tal cual. |
| `dbo.cache_meta` | **NOT_FOUND en este momento** | — | Tabla clave-valor que `pozos_cache.py` crea/usa — no existía al momento de la auditoría (puede haberse recreado o el caché no se ha corrido en este entorno). Confirmar antes de asumir estructura. |
| `dbo.produccion_pozos` (caché local, minúsculas) | Coincide con `dbo.PRODUCCION_POZOS` (mismo objeto, SQL Server es case-insensitive por default aquí) | — | **Importante**: `pozos_cache.py` espera crear una tabla local `dbo.produccion_pozos` vía `SELECT * INTO`, pero ese nombre **ya está tomado por la vista real de origen** (`cmde_public.dbo.produccion_pozos`, mostrada arriba). Si el caché llegó a ejecutarse alguna vez pudo haber intentado sobrescribir o chocar con esta vista — confirmar con el equipo de BD si esto se resolvió con otro nombre o instancia antes de tocarlo. |
| `rdmx.T_21_PozosComprometidos` | **VIEW**, schema `rdmx` (no `dbo`) | `rdmx.T_21a_PozosComprometidos` + `rdmx.T_01A_InfoGral` + `rdmx.T_12_Pozos` (conteo por `estatus`) | Todo el schema `rdmx` es un subsistema aparte (licitaciones/rondas) con su propia jerarquía de tablas `T_XX_*`. Dos vistas más dependen de esta (`rdmx.C_10_Pozos2`, `rdmx.E_C_10_Pozos2`). |
| `dbo.licitaciones_bloques_ofertas` | **TABLA real** | — | Usada por `contratos_service.py` para ofertas/adjudicaciones. |
| `entitlements.v_general_info` | **VIEW**, schema `entitlements` | `cmde_valid.dbo.general_info` (VIEW) `LEFT JOIN cmde_valid.siseaa.INTEGRAL_ASIGNACIONES_TOTAL` (**SYNONYM**, no tabla — apunta a otro objeto/servidor no resuelto en esta auditoría) + función `cmde_public.dbo.f_ProperCase` (scalar function) | La más compleja: cruza 3 objetos de distinto tipo. Una vista más depende de ella (`entitlements.general_info_bk_en_us`). |

### `cmde_raw`

| Objeto | Tipo | Notas |
|---|---|---|
| `dbo.bd_pozos` | **TABLA real**, 69 columnas, catálogo maestro de pozos | Es la fuente de verdad real. `cmde_valid.dbo.bd_pozos` (usada por el backend vía `BD_POZOS = "cmde_raw.dbo.bd_pozos"` en `pozos_service.py`... **ojo**: el código apunta a `cmde_raw.dbo.bd_pozos` en un lugar y `cmde_valid.dbo.bd_pozos` en otro, ver discrepancia abajo) es una VIEW filtrada sobre esta tabla. Dos vistas del schema `dbo` dependen de ella (`V_VIERNES`, `V_VIERNES_2`). |
| `dbo.sih_reservas_c` | **TABLA real**, 32,151 filas | Fuente de `RESERVAS_CAMPOS`. |
| `dbo.campos_loc` | **TABLA real**, 861 filas | Catálogo de ubicación/cuenca por campo — usado por 4+ vistas distintas como dimensión geográfica compartida. |

### `cmde_valid` (capa intermedia de validación, entre `cmde_raw` y `cmde_public`)

| Objeto | Tipo | Notas |
|---|---|---|
| `dbo.bd_pozos` | **VIEW** sobre `cmde_raw.dbo.bd_pozos` | Filtra `ALTERNATE_WELL=0`, `SIDETRACK=0`, `STATUS IN ('CONCLUIDO','EN CONSTRUCCION','EN CONSTRUCCIÓN')` y normaliza fechas de perforación con lógica `CASE` compleja. **Esta lógica de negocio (qué cuenta como pozo "válido") debe preservarse explícitamente en el rediseño**, hoy vive solo en SQL. |
| `dbo.sih_produccion_d2016` | **TABLA real**, 44 columnas, 933,182 filas | La tabla de producción diaria más grande y más usada transitivamente (alimenta `PRODUCCION_CAMPOS_POZOS` y `PRODUCCION_ESTADO`). |
| `dbo.cat_entidades` | **TABLA real**, PK `ENT_ID`, 32 filas | Catálogo de estados de México. |
| `dbo.produccion_estado_a2016` / `dbo.produccion_campos_pozos_a2016` | **TABLAS reales** (históricos pre-2016) | Sin PK declarada. |
| `dbo.cat_campos_alias` | **TABLA real**, PK `campo_alias`, 1,026 filas | Mapea alias de campo → nombre "portal". |
| `dbo.inversiones_aprobadas` | **VIEW** (nombre coincide con la tabla en `cmde_public`, un nivel más abajo) | No se pudo bajar más en esta pasada — el rediseño debe seguir un nivel más para encontrar la tabla base real. |
| `dbo.precios`, `dbo.sih_reservas`, `dbo.general_info` | **VIEWS**, no tablas | Mismo caso: hay al menos un nivel más de indirección debajo de `cmde_valid` que no se auditó en esta pasada (siguiente paso recomendado, ver abajo). |
| `siseaa.INTEGRAL_ASIGNACIONES_TOTAL` | **SYNONYM** | Apunta a un objeto fuera del alcance resuelto aquí (posiblemente otro servidor/linked server). **Requiere investigación aparte** — un sinónimo no resuelto es un riesgo real para la migración si el objeto de destino desaparece o cambia. |

## Objetos ajenos a TIH que dependen de las mismas vistas (radio de impacto)

Estas vistas **no las usa TIH**, pero comparten las mismas fuentes que TIH consume — tocar la tabla base sin coordinar rompe estos otros consumidores también:

- **`dbo.PRODUCCION_CAMPOS`**: 32 dependientes — casi todo el schema `handbook` (`handbook.v_2001` … `v_7037`, reportes probablemente para un "handbook" de indicadores públicos), más `shr.v_sih_prod_contracts`, `shr.v_sih_prod_entitlements`, `dbo.perforacion_equipos(_p)`.
- **`dbo.PRODUCCION_OPERADOR_IP`**: 10 dependientes en `handbook.*`.
- **`dbo.INVERSIONES_APROBADAS`**: `handbook.*`, `bkp.v_4007_explo/extra`, `entitlements.v_notes`, `shr.v_sih_approved_investment`.
- **`dbo.RESERVAS_CAMPOS`**: `dbo.reservas_bncp`, `shr.v_prcp_reservas_c2`.
- **`rdmx.T_21_PozosComprometidos`**: `rdmx.C_10_Pozos2`, `rdmx.E_C_10_Pozos2`.
- **`cmde_valid.dbo.bd_pozos`**: schema `bkp.*` (varias vistas de asignaciones), `dbo.pmt_gap`.
- **`cmde_raw.dbo.bd_pozos`**: `dbo.V_VIERNES`, `dbo.V_VIERNES_2`.

**Implicación para el rediseño**: hay al menos 4 schemas más (`handbook`, `shr`, `bkp`, `entitlements`) que son consumidores paralelos de las mismas tablas base. Si el objetivo es migrar *solo* lo que usa TIH a PostgreSQL, hay que decidir explícitamente: ¿se replica la tabla base y se abandonan estos otros consumidores en SQL Server (quedan igual, sin tocar), o el rediseño también debe servirles? Confirmar con quien mantiene esos otros sistemas antes de deprecar cualquier tabla/vista de origen en SQL Server.

## Discrepancia detectada en el código (revisar antes de migrar)

En `backend/app/services/pozos_service.py:10`:
```python
BD_POZOS = "cmde_raw.dbo.bd_pozos"
```
pero en `backend/app/services/perforacion_service.py:347` y comentarios cercanos, se consulta explícitamente `cmde_valid.dbo.bd_pozos` (la vista filtrada), y el comentario en `perforacion_service.py:367-368` dice que esto es intencional para no romper contra `bd_pozos` "que no tiene esa columna" (refiriéndose a `cmde_raw.dbo.bd_pozos`, tabla cruda sin el filtro de pozos válidos).

Es decir: **dos partes del backend usan intencionalmente dos versiones distintas del "mismo" catálogo de pozos** — una la tabla cruda (`cmde_raw`, todos los pozos, incluye alternates/sidetracks) y otra la vista filtrada/validada (`cmde_valid`, solo pozos "reales"). Esto **debe preservarse como dos vistas/dos flags explícitos** en PostgreSQL, no colapsarse en una sola tabla — de lo contrario `pozos_service.py` y `perforacion_service.py` empezarían a mostrar números distintos a los actuales silenciosamente.

## Recomendaciones concretas para el rediseño a PostgreSQL

1. **No migrar solo `cmde_public`.** Las tablas base reales están 2-3 niveles abajo, repartidas entre `cmde_raw` (más crudo) y `cmde_valid` (validado/curado). El plan de migración debe mapear tabla-base → vista-final explícitamente, tabla por tabla (ver tabla de arriba), y decidir si en PostgreSQL se colapsa la cadena de vistas en una sola tabla materializada por dominio, o se preserva la separación cruda/validada/pública en 3 schemas.
2. **La lógica de negocio embebida en las vistas SQL Server debe migrarse explícitamente**, no se puede asumir que "es solo una tabla". Casos concretos ya encontrados:
   - Normalización de `UBICACION` (`Terrestre`→`TERRESTRE`, `Aguas someras`→`MARINO`) en `PRODUCCION_ESTADO`.
   - Derivación de `pozo_aceite`/`pozo_gas` desde umbrales de producción (`PETROLEO_MB>0`) en `PRODUCCION_CAMPOS_POZOS`.
   - Prorrateo de días de producción por vigencia contractual (`FACTOR_MES`, `FACTOR_IP`, `FACTOR_O`) en `PRODUCCION_OPERADOR_IP`.
   - Filtro de "pozo válido" (`ALTERNATE_WELL=0 AND SIDETRACK=0 AND STATUS IN (...)`) + relleno de fechas faltantes con `CASE` en cascada, en `cmde_valid.dbo.bd_pozos`.
   - Reasignación de provincia geológica (`BASIN`) por reglas ad-hoc (Sabinas-Burro-Picachos, Golfo de México Profundo, etc.) duplicada casi idéntica en `entitlements.v_general_info` y en `cmde_valid.dbo.bd_pozos` — candidata a extraer como función/tabla de mapeo única en el rediseño, hoy está copiada dos veces con riesgo de divergir.
3. **`WHERE ID <> 1`** en el `PRODUCCION_CAMPOS` que usa el backend (`services/*.py`) probablemente corresponde al `where id=2` visto en la definición de `PRODUCCION_OPERADOR_IP` filtrando el caso contrario — sugiere que `id` en `produccion_campos_new` es un flag de tipo de registro (1 = un tipo, 2 = otro) más que una fila de "totales". **Confirmar con el equipo de datos qué son los valores de `id` en `produccion_campos_new`** antes de decidir cómo modelarlo en PostgreSQL (probablemente debería ser un enum/columna con nombre, no un ID mágico).
4. **`siseaa.INTEGRAL_ASIGNACIONES_TOTAL` es un SYNONYM sin resolver en esta auditoría** — antes de migrar `entitlements.v_general_info` (usada para nombres de bloque/vigencia en `produccion_service.py`), hay que averiguar a qué apunta realmente (puede ser un linked server u otra base no cubierta aquí).
5. **`dbo.cache_meta` no existe actualmente** en `cmde_public` pese a que `pozos_cache.py` la referencia — confirmar si el mecanismo de caché de pozos está activo en este entorno antes de asumir que hay que migrar esa tabla.
6. **Nombres de tabla/vista en SQL Server son case-insensitive** (`PRODUCCION_CAMPOS` == `produccion_campos`); si PostgreSQL usa identificadores con comillas o case-sensitive, decidir una convención única (el propio `DATABASE_SCHEMA.md` ya notaba la inconsistencia MAYÚSCULAS/minúsculas entre tablas).
7. **Confirmar impacto en `handbook`, `shr`, `bkp`, `entitlements`** (ver sección de radio de impacto) antes de deprecar cualquier objeto de origen en SQL Server — no son parte de TIH pero comparten las mismas tablas base.

## Traza completa hasta el fondo (segunda pasada — cierra todo lo que quedaba abierto)

Se siguió cada cadena de vistas hasta llegar a `USER_TABLE` real. Resultado:

| Vista intermedia | → | Tabla base real (fondo) | Filas aprox. |
|---|---|---|---|
| `cmde_valid.dbo.inversiones_aprobadas` (`SELECT * FROM cmde_raw.dbo.inversiones_aprobadas`, passthrough total) | → | `cmde_raw.dbo.inversiones_aprobadas` | 449,776 |
| `cmde_valid.dbo.precios` (passthrough total) | → | `cmde_raw.dbo.precios` | 10,491 |
| `cmde_valid.dbo.sih_reservas` (remapea `BLOCK_ID`s viejos a nuevos por fecha de corte + redondea a 6 decimales) | → | `cmde_raw.dbo.sih_reservas` | 19,126 |
| `cmde_valid.dbo.general_info` (agrega `POLYGON_DEPTH` calculado) | → | `cmde_raw.dbo.general_info` | 763 |
| `cmde_public.dbo.general_info_estados` (mismo origen, con `DISTINCT`) | → | `cmde_raw.dbo.general_info` | (misma tabla de arriba) |
| `cmde_public.dbo.produccion_campos_new` (`UNION` de vigente + histórico ≤2016, con remapeo de `id_operador`/`operador` en el histórico) | → | `cmde_valid.dbo.vm_produccion_campos_d2016` (58,174 filas) `UNION` `cmde_valid.dbo.produccion_campos_a2016` (171,482 filas) |
| `cmde_public.dbo.empresas_ip_hist` (4 `JOIN`) | → | `cmde_valid.dbo.empresas_contratistas_historico` (355), `cat_contratistas` (91, PK `ID_CONTRATISTA`), `cat_contratistascorto` (71, PK `ID_CONTRATISTA_CORTO`), `empresas_contratistascorto_licitantes` (77, PK compuesta), `empresas_gruposcorp_composicion` (110, PK compuesta) | — catálogo normalizado de empresas/contratistas, el único rincón del modelo con FKs/PKs reales declaradas. |
| `rdmx.T_01A_InfoGral`, `rdmx.T_12_Pozos`, `rdmx.T_21a_PozosComprometidos` | — | **son tablas base reales** (112, 106 y 112 filas resp.), no vistas. El subsistema `rdmx` (licitaciones/rondas) toca fondo en un solo salto. |
| `cmde_public.dbo.f_ProperCase` | — | Función escalar (`SQL_SCALAR_FUNCTION`), no una tabla — transforma texto (capitalización). Se debe reimplementar como función/expresión en PostgreSQL, no migrar datos. |
| `cmde_valid.siseaa.INTEGRAL_ASIGNACIONES_TOTAL` (SYNONYM) | → | **`[UATAC_SISEAA].[CnhSISEAA].[dbo].[INTEGRAL_ASIGNACIONES_TOTAL]`** — un **linked server externo** (`UATAC_SISEAA`), fuera de la instancia `UMBRACODB` y fuera del alcance de esta auditoría (no se pudo consultar desde aquí). |

**Con esto, toda la cadena que alimenta a TIH queda 100% rastreada hasta tabla base**, con una única excepción real: `entitlements.v_general_info` (usada por `produccion_service.py` para nombres/vigencia de bloques) depende parcialmente de un servidor vinculado ajeno a `UMBRACODB`. Esto es lo único que **no se puede resolver solo con acceso a `172.16.200.99`** — se necesita acceso o coordinación con quien administra `UATAC_SISEAA`/`CnhSISEAA` para saber qué migrar de ahí (o si en Postgres esa columna se deja como dato manual/estático en vez de una dependencia viva).

## Alcance de esta auditoría

- No se auditaron los schemas `handbook`, `shr`, `bkp` en detalle (solo se ven como "dependientes" de las tablas que sí usa TIH) — quedan fuera del alcance de "todo lo que usa TIH", pero son parte del "radio de impacto" si se toca la fuente.
- Fuente de esta auditoría: scripts Python (`pyodbc` + `sys.dm_sql_referenced/referencing_entities`, BFS recursivo hasta tabla base) ejecutados contra `172.16.200.99\UMBRACODB`, no incluidos en el repo (se descartaron tras generar este documento).
