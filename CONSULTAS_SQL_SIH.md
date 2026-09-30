# Auditoría de consultas SQL — backend TIH

Generado el 2026-08-14. Recorre todos los archivos en `backend/app/services/*.py` y `backend/app/database.py`.

Archivos revisados: 14
Consultas SQL distintas encontradas: 79

---

## backend/app/services/cache_utils.py
Sin SQL — decorador de caché en memoria (`@cached()`).

## backend/app/services/chat_service.py
Sin SQL — solo llamadas HTTP a Ollama.

## backend/app/database.py
Sin SQL — solo configura el engine SQLAlchemy / conexión pyodbc.

## backend/app/services/resumen_service.py
Sin SQL propio — orquesta en paralelo (ThreadPoolExecutor) funciones de otros services, ya contabilizadas ahí.

---

## backend/app/services/contratos_service.py

**1. `get_contratos` — contratos_service.py:59 — SELECT — PRODUCCION_CAMPOS**
```sql
SELECT DIAS_PRODUCCION, FECHA, ASIG_CONT, TIPO, OPERADOR, SUM(...) AS LIQUIDOS_MBD, ...
FROM {SCHEMA}PRODUCCION_CAMPOS
WHERE ID <> 1 AND {where_fecha} AND TIPO = '{tipo}'
GROUP BY DIAS_PRODUCCION, FECHA, ASIG_CONT, TIPO, OPERADOR
```

**2. `get_operadores` — contratos_service.py:114 — SELECT — PRODUCCION_OPERADOR_IP**
```sql
SELECT DIAS_PRODUCCION, FECHA, ..., EMPRESA AS OPERADOR, ..., SUM(...) AS LIQUIDOS_MBD, SUM(PETROLEO_MBD*FACTOR_O) AS PETROLEO_MBD, ...
FROM {SCHEMA}PRODUCCION_OPERADOR_IP
WHERE FECHA BETWEEN '{init}' AND '{end}'
GROUP BY DIAS_PRODUCCION, FECHA, ASIG_CONT, EMPRESA
```

**3. `get_pozos_comprometidos` — contratos_service.py:180 — SELECT (JOIN) — rdmx.T_21_PozosComprometidos, INVERSIONES_APROBADAS**
```sql
SELECT p.contrato, p.ronda, p.licitacion, p.pozosPlanes, i.MODALIDAD, i.UBICACION
FROM rdmx.T_21_PozosComprometidos p
LEFT JOIN (SELECT DISTINCT CONTRATO, MODALIDAD, UBICACION FROM {SCHEMA}INVERSIONES_APROBADAS) i
  ON i.CONTRATO = p.contrato
```

**4. `get_ofertas_efectivo` — contratos_service.py:242 — SELECT — licitaciones_bloques_ofertas**
```sql
SELECT ronda, licitacion, contrato AS modalidad, contrato_nombre AS contrato, ubicacion, bono
FROM licitaciones_bloques_ofertas
WHERE bono IS NOT NULL AND contrato_nombre IS NOT NULL AND id_licitante = id_licitante_adj
```

**5. `get_inversion_comprometida` — contratos_service.py:298 — SELECT — licitaciones_bloques_ofertas**
```sql
SELECT ronda, licitacion, contrato AS modalidad, contrato_nombre AS contrato, ubicacion, inv_usd
FROM licitaciones_bloques_ofertas
WHERE inv_usd IS NOT NULL AND contrato_nombre IS NOT NULL AND id_licitante = id_licitante_adj
```

**6. `get_contratos_adjudicados` — contratos_service.py:364 — SELECT — licitaciones_bloques_ofertas**
```sql
SELECT ronda, licitacion, contrato_nombre, pais, empresa
FROM licitaciones_bloques_ofertas
WHERE contrato_nombre IS NOT NULL AND id_licitante = id_licitante_adj
```

---

## backend/app/services/estado_service.py

**7. `get_por_estado` — estado_service.py:30 — SELECT — PRODUCCION_ESTADO**
```sql
SELECT NOM_ENT, FECHA, UBICACION, SUM(...) AS LIQUIDOS_MBD, SUM(PETROLEO_MBD) AS PETROLEO_MBD,
       SUM(CONDENSADO_MBD) AS CONDENSADO_MBD, SUM(GAS_MMPCD) AS GAS_MMPCD
FROM {SCHEMA}PRODUCCION_ESTADO
WHERE {where_fecha}
GROUP BY NOM_ENT, FECHA, UBICACION
```

---

## backend/app/services/inversiones_service.py

**8. `get_inversiones` (subtopic="contrato") — inversiones_service.py:12 — SELECT — INVERSIONES_APROBADAS**
```sql
SELECT ANIO, RONDA, LICITACION, CONTRATO, ACT_PETROLERA, MONTO_USD
FROM {SCHEMA}INVERSIONES_APROBADAS
WHERE RONDA IS NOT NULL AND ANIO BETWEEN {start_year} AND {end_year}
```

**9. `get_inversiones` (subtopic="asignacion") — inversiones_service.py:19 — SELECT — INVERSIONES_APROBADAS**
```sql
SELECT ANIO, TIPO_PLAN, LICITACION, CONTRATO, ACT_PETROLERA, MONTO_USD
FROM {SCHEMA}INVERSIONES_APROBADAS
WHERE RONDA IS NULL AND ANIO BETWEEN {start_year} AND {end_year}
```

**10. `get_inversiones` (default/estado) — inversiones_service.py:26 — SELECT — INVERSIONES_APROBADAS**
```sql
SELECT ANIO, ACT_PETROLERA, TAREA, ESTADO, UBICACION, MONTO_USD
FROM {SCHEMA}INVERSIONES_APROBADAS
WHERE ANIO BETWEEN {start_year} AND {end_year}
```

**11. `get_inversiones_cuenca` — inversiones_service.py:63 — SELECT — INVERSIONES_APROBADAS**
```sql
SELECT ANIO, CUENCA, ESTADO AS ENTIDAD, UBICACION AS AMBIENTE, MONTO_USD
FROM {SCHEMA}INVERSIONES_APROBADAS
WHERE ANIO BETWEEN {start_year} AND {end_year} AND CUENCA IS NOT NULL
```

**12. `get_inversiones_contrato` — inversiones_service.py:140 — SELECT — INVERSIONES_APROBADAS**
```sql
SELECT ANIO, RONDA, CONTRATO, LICITACION, MONTO_USD
FROM {SCHEMA}INVERSIONES_APROBADAS
WHERE ANIO BETWEEN {start_year} AND {end_year} AND RONDA IS NOT NULL
```

---

## backend/app/services/perforacion_service.py

**13. `get_perforacion_filtros` (topic="PozosCampos") — perforacion_service.py:34 — SELECT DISTINCT — PRODUCCION_CAMPOS_POZOS**
```sql
SELECT DISTINCT CUENCA, UBICACION, CAMPO_PORTAL AS CAMPO FROM {SCHEMA}PRODUCCION_CAMPOS_POZOS
```

**14. `get_perforacion_filtros` (default) — perforacion_service.py:46 — SELECT DISTINCT — PERFORACION_POZOS_PERF**
```sql
SELECT DISTINCT CUENCA, CATEGORIA_POZO, UBICACION, OPERADOR
FROM {SCHEMA}PERFORACION_POZOS_PERF
WHERE POZOS_PERFORADOS > 0
```

**15. `get_perforacion` — perforacion_service.py:105 — SELECT — PERFORACION_POZOS_PERF / PERFORACION_POZOS_TERM / PERFORACION_EQUIPOS (según TOPIC_MAP)**
```sql
SELECT FECHA, CUENCA, CATEGORIA_POZO, UBICACION, OPERADOR, {var}
FROM {SCHEMA}{tabla}
WHERE {where_fecha} AND {var} > 0
```

**16. `get_perforacion_historico` (topic="PozosCampos") — perforacion_service.py:255 — SELECT — PRODUCCION_CAMPOS_POZOS**
```sql
SELECT FECHA, CAMPO_PORTAL AS CAMPO, CUENCA, UBICACION, POZOS_ACEITE, POZOS_GAS
FROM {SCHEMA}PRODUCCION_CAMPOS_POZOS
```

**17. `get_perforacion_historico` (TOPIC_MAP) — perforacion_service.py:263 — SELECT — PERFORACION_POZOS_PERF / PERFORACION_POZOS_TERM / PERFORACION_EQUIPOS**
```sql
SELECT FECHA, OPERADOR, CATEGORIA_POZO, CUENCA, UBICACION, {var}
FROM {SCHEMA}{tabla}
```

**18. `get_perforacion_pozos_detalle` — perforacion_service.py:345 — SELECT (bind params) — cmde_valid.dbo.bd_pozos**
```sql
SELECT WELL_NAME, {campo_fecha} AS FECHA_EVENTO, [TYPE], OPERATOR
FROM cmde_valid.dbo.bd_pozos
WHERE {campo_fecha} IS NOT NULL AND [YEAR] >= 1960 AND PETROLEUM_PROVINCE IS NOT NULL AND [TYPE] IS NOT NULL [+ filtros opcionales]
```

**19. `get_perforacion_pozos_detalle` (lookup campo) — perforacion_service.py:379 — SELECT DISTINCT (bind params) — tabla fuente dinámica (PRODUCCION_POZOS o caché)**
```sql
SELECT DISTINCT WELL_NAME, ASIG_CONT FROM {source} WHERE UPPER(WELL_NAME) IN (:n0, :n1, ...)
```

**20. `_get_pozos_campos` — perforacion_service.py:452 — SELECT — PRODUCCION_CAMPOS_POZOS**
```sql
SELECT FECHA, CUENCA, CAMPO_PORTAL AS CAMPO, UBICACION, POZOS_ACEITE, POZOS_GAS
FROM {SCHEMA}PRODUCCION_CAMPOS_POZOS
WHERE {where_fecha}
```

---

## backend/app/services/pozos_cache.py
Materializa la caché local `dbo.produccion_pozos` a partir de `PRODUCCION_POZOS`. Es el módulo con más escritura (DDL/DML) de todo el backend.

**21. `_leer_meta_db` — pozos_cache.py:37 — SELECT — dbo.cache_meta** (BD TIH_pozos_cache)
```sql
SELECT [key], value FROM dbo.cache_meta
```

**22. `_index_exists` — pozos_cache.py:67 — SELECT (catálogo dinámico) — {database}.sys.indexes**
```sql
SELECT 1 FROM {database}.sys.indexes WHERE object_id = OBJECT_ID('{object_name}') AND name = '{index_name}'
```

**23. `_refrescar` — pozos_cache.py:88 — CREATE DATABASE (condicional) — TIH_pozos_cache**
```sql
IF DB_ID('{CACHE_DB}') IS NULL CREATE DATABASE {CACHE_DB}
```

**24. `_refrescar` — pozos_cache.py:93-96 — CREATE TABLE (condicional) — dbo.cache_meta**
```sql
IF OBJECT_ID('dbo.cache_meta') IS NULL
CREATE TABLE dbo.cache_meta ([key] VARCHAR(50) PRIMARY KEY, value VARCHAR(200))
```

**25. `_refrescar` — pozos_cache.py:97 — DROP TABLE (condicional) — dbo.produccion_pozos**
```sql
IF OBJECT_ID('dbo.produccion_pozos') IS NOT NULL DROP TABLE dbo.produccion_pozos
```

**26. `_refrescar` — pozos_cache.py:98 — SELECT ... INTO — destino: dbo.produccion_pozos, origen: PRODUCCION_POZOS**
```sql
SELECT * INTO dbo.produccion_pozos
FROM {settings.db_name}.{settings.db_schema}.PRODUCCION_POZOS
```

**27-29. `_refrescar` — pozos_cache.py:105-107 — ALTER TABLE (x3) — dbo.produccion_pozos**
```sql
ALTER TABLE dbo.produccion_pozos ALTER COLUMN ASIG_CONT NVARCHAR(300)
ALTER TABLE dbo.produccion_pozos ALTER COLUMN UWI VARCHAR(100)
ALTER TABLE dbo.produccion_pozos ALTER COLUMN BLOCK_ID VARCHAR(100)
```

**30-32. `_refrescar` — pozos_cache.py:108-110 — CREATE INDEX (x3) — dbo.produccion_pozos**
```sql
CREATE INDEX ix_pp_well_fecha ON dbo.produccion_pozos(WELL_ID, FECHA)
CREATE INDEX ix_pp_asig_fecha ON dbo.produccion_pozos(ASIG_CONT, FECHA)
CREATE INDEX ix_pp_cuenca ON dbo.produccion_pozos(CUENCA)
```

**33. `_asegurar_indices_fuente` — pozos_cache.py:76 — CREATE INDEX (condicional) — {settings.db_name}.dbo.cat_pozos**
```sql
CREATE INDEX ix_cat_pozos_well_id ON {settings.db_name}.dbo.cat_pozos(well_id)
```

**34. `_asegurar_indices_fuente` — pozos_cache.py:78 — CREATE INDEX (condicional) — cmde_raw.dbo.bd_pozos**
```sql
CREATE INDEX ix_bd_pozos_well_id ON cmde_raw.dbo.bd_pozos(WELL_ID)
```

**35. `_refrescar` — pozos_cache.py:113 — SELECT COUNT(*) — dbo.produccion_pozos**
```sql
SELECT COUNT(*) FROM dbo.produccion_pozos
```

**36. `_refrescar` — pozos_cache.py:117-118 — MERGE (bind params, por cada key/value) — dbo.cache_meta**
```sql
MERGE dbo.cache_meta AS t USING (SELECT ? AS k, ? AS v) AS s ON t.[key]=s.k
WHEN MATCHED THEN UPDATE SET value=s.v WHEN NOT MATCHED THEN INSERT ([key],value) VALUES (s.k,s.v);
```

---

## backend/app/services/pozos_service.py

**37. `get_produccion_pozos_arbol` — pozos_service.py:37 — SELECT DISTINCT — fuente dinámica (TIH_pozos_cache.dbo.produccion_pozos o PRODUCCION_POZOS)**
```sql
SELECT DISTINCT CUENCA, ASIG_CONT, WELL_NAME
FROM {_source_table()}
WHERE CUENCA IS NOT NULL AND ASIG_CONT IS NOT NULL AND WELL_NAME IS NOT NULL
  AND FECHA >= DATEADD(year, -2, GETDATE())
```

**38. `get_produccion_pozo_detalle` — pozos_service.py:70 — SELECT (bind params) — fuente dinámica**
```sql
SELECT FECHA, PETROLEO_MBD, CONDENSADO_MBD, GAS_MMPCD, GAS_ASOC_MMPCD, GAS_NASOC_MMPCD, AGUA_MBD
FROM {source}
WHERE ASIG_CONT = :campo AND WELL_NAME = :pozo AND {where_fecha}
```

**39. `get_produccion_pozos_resumen` — pozos_service.py:119 — SELECT (bind params) — fuente dinámica**
```sql
SELECT FECHA, WELL_NAME, PETROLEO_MBD, CONDENSADO_MBD, GAS_MMPCD, GAS_ASOC_MMPCD, GAS_NASOC_MMPCD, AGUA_MBD
FROM {_source_table()}
WHERE {where_fecha}{where_extra}
```

**40. `_meta_bd_pozos` — pozos_service.py:289 — SELECT — cmde_raw.dbo.bd_pozos**
```sql
SELECT WELL_ID, CURRENT_CONDITION, DRILLING_START_DATE, OPERATOR, DEPTH_MD, CATEGORY
FROM cmde_raw.dbo.bd_pozos WHERE WELL_ID IN ({ids_sql})
```

**41. `_serie_mensual_pozo` — pozos_service.py:251 — SELECT (bind params) — fuente dinámica**
```sql
SELECT FECHA, WELL_ID, PETROLEO_MBD, CONDENSADO_MBD, GAS_MMPCD
FROM {_source_table()}
WHERE ASIG_CONT = :campo AND WELL_NAME = :pozo
```

**42. `get_pozos_ranking` — pozos_service.py:411 — SELECT (bind params) — fuente dinámica**
```sql
SELECT FECHA, WELL_ID, WELL_NAME, PETROLEO_MBD, CONDENSADO_MBD, GAS_MMPCD
FROM {_source_table()}
WHERE {where_fecha}{where_extra}
```

**43. `get_pozos_ranking` (recálculo histórico completo) — pozos_service.py:447 — SELECT — fuente dinámica**
```sql
SELECT FECHA, WELL_ID, WELL_NAME, PETROLEO_MBD, CONDENSADO_MBD, GAS_MMPCD
FROM {_source_table()}
WHERE WELL_ID IN ({well_ids_sql})
```

**44. `get_pozos_filtrados` — pozos_service.py:541 — SELECT — fuente dinámica**
```sql
SELECT FECHA, WELL_ID, WELL_NAME, ASIG_CONT, CUENCA, PETROLEO_MBD, CONDENSADO_MBD
FROM {_source_table()}
WHERE {where_fecha}
```

---

## backend/app/services/precios_service.py

**45. `_asegurar_tabla_precios_autom` — precios_service.py:18-37 — CREATE TABLE (condicional) — PRECIOS_AUTOM**
```sql
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PRECIOS_AUTOM' AND xtype='U')
CREATE TABLE {SCHEMA}PRECIOS_AUTOM (
    FECHA DATE NOT NULL, PRODUCTO VARCHAR(20) NOT NULL, VALOR DECIMAL(10,4) NOT NULL,
    FUENTE VARCHAR(50) NULL, ACTUALIZADO_EN DATETIME NOT NULL DEFAULT GETDATE(),
    CONSTRAINT PK_PRECIOS_AUTOM PRIMARY KEY (FECHA, PRODUCTO)
)
```

**46. `_guardar_precio_autom` — precios_service.py:43 — MERGE (bind params) — PRECIOS_AUTOM**
```sql
MERGE {SCHEMA}PRECIOS_AUTOM AS destino
USING (SELECT :fecha AS FECHA, :producto AS PRODUCTO) AS origen
ON destino.FECHA = origen.FECHA AND destino.PRODUCTO = origen.PRODUCTO
WHEN MATCHED THEN UPDATE SET VALOR = :valor, FUENTE = :fuente, ACTUALIZADO_EN = GETDATE()
WHEN NOT MATCHED THEN INSERT (FECHA, PRODUCTO, VALOR, FUENTE) VALUES (:fecha, :producto, :valor, :fuente);
```

**47. `_get_precio_autom_anterior` — precios_service.py:56 — SELECT TOP 1 (bind params) — PRECIOS_AUTOM**
```sql
SELECT TOP 1 VALOR FROM {SCHEMA}PRECIOS_AUTOM
WHERE PRODUCTO = :producto AND FECHA < :fecha ORDER BY FECHA DESC
```

**48. `_get_mme_anterior` — precios_service.py:142 — SELECT TOP 1 (bind params) — PRECIOS**
```sql
SELECT TOP 1 FECHA, MME FROM {SCHEMA}PRECIOS
WHERE MME IS NOT NULL AND FECHA < :fecha ORDER BY FECHA DESC
```

**49. `get_precios` — precios_service.py:207 — SELECT — PRECIOS**
```sql
SELECT FECHA, BRENT, WTI, MME, HENRY_HUB
FROM {SCHEMA}PRECIOS
WHERE FECHA BETWEEN '{init}' AND '{end}'
ORDER BY FECHA
```

---

## backend/app/services/produccion_service.py

**50. `get_produccion_filtros` — produccion_service.py:54 — SELECT DISTINCT — PRODUCCION_CAMPOS**
```sql
SELECT DISTINCT CUENCA, UBICACION FROM {SCHEMA}PRODUCCION_CAMPOS
```

**51. `get_produccion_filtros` — produccion_service.py:57 — SELECT DISTINCT — PRODUCCION_OPERADOR_IP**
```sql
SELECT DISTINCT EMPRESA FROM {SCHEMA}PRODUCCION_OPERADOR_IP
```

**52. `_cargar_df_producto_entidad` — produccion_service.py:216 — SELECT — PRODUCCION_CAMPOS / PRODUCCION_ESTADO (tabla parametrizada)**
```sql
SELECT FECHA, {entidad_col_sql}, SUM(ISNULL(PETROLEO_MBD,0)+ISNULL(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD, ...
FROM {SCHEMA}{tabla}
WHERE {extra_where}{where_fecha}
GROUP BY FECHA, {entidad_col_sql}
```
Usado por: get_produccion_contratos (ASIG_CONT), get_produccion_asignaciones (CUENCA), get_produccion_campos (CAMPO_PORTAL).

**53. `_cargar_df_producto_entidad_multi` — produccion_service.py:251 — SELECT — PRODUCCION_CAMPOS**
```sql
SELECT FECHA, {cols_list}, SUM(ISNULL(PETROLEO_MBD,0)+ISNULL(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD, ...
FROM {SCHEMA}{tabla}
WHERE {extra_where}{where_fecha}
GROUP BY FECHA, {cols_list}
```
Usado por: get_produccion_asignaciones (drilldown), get_produccion_campos (drilldown).

**54. `get_produccion_estado` — produccion_service.py:387 — SELECT — PRODUCCION_ESTADO**
```sql
SELECT FECHA, NOM_ENT, UBICACION, SUM(ISNULL(PETROLEO_MBD,0)+ISNULL(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD, ...
FROM {SCHEMA}PRODUCCION_ESTADO
WHERE {where_fecha}
GROUP BY FECHA, NOM_ENT, UBICACION
```

**55. `get_produccion_empresas` — produccion_service.py:448 — SELECT — PRODUCCION_OPERADOR_IP**
```sql
SELECT FECHA, EMPRESA, ASIG_CONT, SUM(PETROLEO_MBD*FACTOR_O) AS PETROLEO_MBD, ...
FROM {SCHEMA}PRODUCCION_OPERADOR_IP
WHERE {where_fecha}
GROUP BY FECHA, EMPRESA, ASIG_CONT
```

**56. `get_produccion_cuenca` — produccion_service.py:563 — SELECT — PRODUCCION_CAMPOS**
```sql
SELECT CUENCA, UBICACION, FECHA, DIAS_PRODUCCION, SUM(...) AS LIQUIDOS_MBD, ...
FROM {SCHEMA}PRODUCCION_CAMPOS
WHERE ID <> 1 AND {where_fecha}
GROUP BY CUENCA, UBICACION, FECHA, DIAS_PRODUCCION
```

**57. `get_resumen_nacional` — produccion_service.py:648 — SELECT — PRODUCCION_CAMPOS**
```sql
SELECT FECHA, SUM(ISNULL(PETROLEO_MBD,0)+ISNULL(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD, SUM(ISNULL(GAS_MMPCD,0)) AS GAS_MMPCD
FROM {SCHEMA}PRODUCCION_CAMPOS
WHERE ID <> 1 AND FECHA >= DATEADD(year, -2, GETDATE())
GROUP BY FECHA
```

**58. `get_top_campos` — produccion_service.py:697 — SELECT — PRODUCCION_CAMPOS**
```sql
SELECT CAMPO_PORTAL, FECHA, SUM(ISNULL(PETROLEO_MBD,0)+ISNULL(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD, SUM(ISNULL(GAS_MMPCD,0)) AS GAS_MMPCD
FROM {SCHEMA}PRODUCCION_CAMPOS
WHERE ID <> 1 AND TIPO = 'ASIGNACION' AND FECHA >= DATEADD(month, -12, GETDATE())
GROUP BY CAMPO_PORTAL, FECHA
```

**59. `get_produccion_por_operador` — produccion_service.py:750 — SELECT — PRODUCCION_CAMPOS**
```sql
SELECT FECHA, OPERADOR, ASIG_CONT, SUM(ISNULL(PETROLEO_MBD,0)+ISNULL(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD, SUM(ISNULL(GAS_MMPCD,0)) AS GAS_MMPCD
FROM {SCHEMA}PRODUCCION_CAMPOS
WHERE ID <> 1 AND FECHA >= DATEADD(month, -12, GETDATE())
GROUP BY FECHA, OPERADOR, ASIG_CONT
```

**60. `get_pozos_operando` — produccion_service.py:806 — SELECT — PRODUCCION_CAMPOS_POZOS**
```sql
SELECT FECHA, SUM(ISNULL(POZOS_ACEITE,0)) AS POZOS_ACEITE, SUM(ISNULL(POZOS_GAS,0)) AS POZOS_GAS
FROM {SCHEMA}PRODUCCION_CAMPOS_POZOS
WHERE UBICACION IS NOT NULL AND FECHA >= DATEADD(month, -12, GETDATE())
GROUP BY FECHA
```

**61. `get_produccion_detalle` — produccion_service.py:857 — SELECT — PRODUCCION_CAMPOS**
```sql
SELECT CUENCA, CAMPO_PORTAL, UBICACION, FECHA, SUM(...) AS LIQUIDOS_MBD, ...
FROM {SCHEMA}PRODUCCION_CAMPOS
WHERE ID <> 1 AND FECHA BETWEEN '{init}' AND '{end}'
GROUP BY CUENCA, CAMPO_PORTAL, UBICACION, FECHA
```

**62. `get_produccion_operadores` — produccion_service.py:922 — SELECT — PRODUCCION_OPERADOR_IP**
```sql
SELECT FECHA, EMPRESA, SUM(ISNULL(PETROLEO_MBD,0)*{factor_col}+ISNULL(CONDENSADO_MBD,0)*{factor_col}) AS LIQUIDOS_MBD, SUM(ISNULL(GAS_MMPCD,0)*{factor_col}) AS GAS_MMPCD
FROM {SCHEMA}PRODUCCION_OPERADOR_IP
WHERE {where_fecha}
GROUP BY FECHA, EMPRESA
```

**63. `get_asignaciones_ranking` — produccion_service.py:1022 — SELECT — PRODUCCION_CAMPOS**
```sql
SELECT FECHA, ASIG_CONT, CUENCA, UBICACION, SUM(...) AS LIQUIDOS_MBD, SUM(GAS_MMPCD) AS GAS_MMPCD
FROM {SCHEMA}PRODUCCION_CAMPOS
WHERE ID <> 1 AND TIPO = 'ASIGNACION' AND ASIG_CONT IS NOT NULL
  AND ASIG_CONT NOT LIKE '{_ASIGNACION_CODIGOS_RUIDO_PREFIJO}%' AND {where_fecha}
GROUP BY FECHA, ASIG_CONT, CUENCA, UBICACION
```

**64. `get_asignaciones_ranking` (metadatos) — produccion_service.py:1058 — SELECT — [cmde_public].[entitlements].[v_general_info]**
```sql
SELECT BLOCK_ID, BLOCK_NAME, [PLAN], ACTIVITY, ENVIRONMENT, BASIN, VALIDITY, START_DATE, END_DATE, AREA_KM2
FROM [cmde_public].[entitlements].[v_general_info]
```

**65. `get_asignacion_detalle` — produccion_service.py:1105 — SELECT (bind params) — PRODUCCION_CAMPOS**
```sql
SELECT FECHA, CAMPO_PORTAL, OPERADOR, PETROLEO_MBD, CONDENSADO_MBD, GAS_MMPCD, GAS_ASOC_MMPCD, GAS_NASOC_MMPCD, AGUA_MBD, N2_MMPCD
FROM {SCHEMA}PRODUCCION_CAMPOS
WHERE ID <> 1 AND TIPO = 'ASIGNACION' AND ASIG_CONT = :asig AND {where_fecha}
```

**66. `get_asignacion_detalle` (pozos) — produccion_service.py:1154 — SELECT DISTINCT (bind params) — fuente dinámica (PRODUCCION_POZOS o caché)**
```sql
SELECT DISTINCT ASIG_CONT, WELL_ID, WELL_NAME FROM {source} WHERE ASIG_CONT LIKE :asig_prefix
```

**67. `get_asignacion_detalle` (bloque) — produccion_service.py:1177 — SELECT (bind params) — [cmde_public].[entitlements].[v_general_info]**
```sql
SELECT BLOCK_NAME, [PLAN], ACTIVITY
FROM [cmde_public].[entitlements].[v_general_info]
WHERE BLOCK_ID = :asig
```

**68. `get_produccion_api` — produccion_service.py:1296 — SELECT — PRODUCCION_CAMPOS**
```sql
SELECT FECHA, CUENCA, UBICACION, PETROLEO_API, SUM(ISNULL(PETROLEO_MBD,0)+ISNULL(CONDENSADO_MBD,0)) AS LIQUIDOS_MBD
FROM {SCHEMA}PRODUCCION_CAMPOS
WHERE ID <> 1 AND {where_fecha}
GROUP BY FECHA, CUENCA, UBICACION, PETROLEO_API
```

**69. `get_produccion_gcompo` (sin filtro) — produccion_service.py:1374 — SELECT — PRODUCCION_CAMPOS**
```sql
SELECT FECHA, {cols_sql} -- SUM(GAS_MMPCD), SUM(C1_MMPCD), ... por componente
FROM {SCHEMA}PRODUCCION_CAMPOS
WHERE ID <> 1 AND {where_fecha}
GROUP BY FECHA
```

**70. `get_produccion_gcompo` (filtrado) — produccion_service.py:1401 — SELECT — PRODUCCION_CAMPOS**
```sql
SELECT FECHA, CUENCA, UBICACION, {cols_sql}
FROM {SCHEMA}PRODUCCION_CAMPOS
WHERE ID <> 1 AND {where_fecha}
GROUP BY FECHA, CUENCA, UBICACION
```

---

## backend/app/services/reservas_service.py

**71. `get_reservas_por_campo` — reservas_service.py:34 — SELECT (bind params) — RESERVAS_CAMPOS**
```sql
SELECT YEAR(fecha) AS anio, cuenca, ubicacion, campo_nombre, categoria, SUM({columna}) AS valor
FROM {SCHEMA}RESERVAS_CAMPOS
WHERE YEAR(fecha) BETWEEN :start_year AND :end_year AND campo_nombre IS NOT NULL
GROUP BY YEAR(fecha), cuenca, ubicacion, campo_nombre, categoria
```

**72. `get_reservas_asignacion_contrato` — reservas_service.py:135 — SELECT (bind params) — dbo.reservas_asig_cont**
```sql
SELECT YEAR(fecha) AS anio, cuenca, ubicacion, asignacion_contrato, tipo, SUM({columna}) AS valor
FROM dbo.reservas_asig_cont
WHERE YEAR(fecha) BETWEEN :start_year AND :end_year AND asignacion_contrato IS NOT NULL
GROUP BY YEAR(fecha), cuenca, ubicacion, asignacion_contrato, tipo
```

**73. `get_reservas_asignacion_contrato` (nombres) — reservas_service.py:146 — SELECT DISTINCT — dbo.reservas_asig_cont_campos**
```sql
SELECT DISTINCT asignacion_contrato, asignacion_contrato_nombre FROM dbo.reservas_asig_cont_campos WHERE asignacion_contrato IS NOT NULL
```

**74. `get_reservas` — reservas_service.py:242 — SELECT (bind params) — RESERVAS_CAMPOS**
```sql
SELECT YEAR(fecha) AS anio, cuenca, ubicacion, categoria, SUM(rr_aceite_mmb) AS aceite_mmb, SUM(rr_gas_mmmpc) AS gas_mmmpc,
       SUM(rr_condensado_mmb) AS condensado_mmb, SUM(rr_liquidos_planta_mmb) AS liquidos_planta_mmb,
       SUM(vo_aceite_mmb) AS vo_aceite_mmb, SUM(vo_gas_mmmpc) AS vo_gas_mmmpc
FROM {SCHEMA}RESERVAS_CAMPOS
WHERE YEAR(fecha) BETWEEN :start_year AND :end_year AND categoria = :tipo
GROUP BY YEAR(fecha), cuenca, ubicacion, categoria
ORDER BY YEAR(fecha), cuenca
```

**75. `get_categorias_disponibles` — reservas_service.py:296 — SELECT DISTINCT — RESERVAS_CAMPOS**
```sql
SELECT DISTINCT categoria FROM {SCHEMA}RESERVAS_CAMPOS WHERE categoria IS NOT NULL ORDER BY categoria
```

**76. `_ultima_fecha` — reservas_service.py:304 — SELECT — RESERVAS_CAMPOS**
```sql
SELECT MAX(fecha) AS fecha FROM {SCHEMA}RESERVAS_CAMPOS
```

**77. `get_top5_reservas_por_campo` — reservas_service.py:326 — SELECT (bind params) — RESERVAS_CAMPOS**
```sql
SELECT campo_nombre, categoria, SUM(rr_aceite_mmb) AS aceite_mmb, SUM(rr_gas_mmmpc) AS gas_mmmpc
FROM {SCHEMA}RESERVAS_CAMPOS
WHERE fecha = :fecha AND campo_nombre IS NOT NULL
GROUP BY campo_nombre, categoria
```

**78. `get_reservas_1p2p3p` — reservas_service.py:366 — SELECT (bind params) — RESERVAS_CAMPOS**
```sql
SELECT categoria, SUM(rr_aceite_mmb) AS aceite_mmb, SUM(rr_gas_mmmpc) AS gas_mmmpc
FROM {SCHEMA}RESERVAS_CAMPOS
WHERE fecha = :fecha
GROUP BY categoria
```

---

## backend/app/services/temas_service.py

**79. `get_temas` — temas_service.py:11 — SELECT — CUBOS**
```sql
SELECT SECCION, TEMA, JSON_ARG, INIT_YEAR, PERIODICIDAD, METODOLOGIA, TITULO, END_YEAR,
       IIF(DOWNLOADABLE IS NULL OR DOWNLOADABLE = '', NULL, CONCAT(DOWNLOADABLE, '?_=', FORMAT(GETDATE(), 'yyyyMMddhhmmss'))) AS DOWNLOADABLE
FROM {SCHEMA}CUBOS
WHERE JSON_ARG NOT IN ('', 'BalanceGas', 'InvAsig', 'InteresPart', 'EqPerf', 'InvTipo', 'InvEst', 'AreaLic')
  AND TEMA NOT IN ('Produccion por contrato (reportada al FMP)')
ORDER BY SECCION, TEMA DESC
```

---

## Resumen: tablas/vistas únicas encontradas (orden alfabético)

| Tabla / vista | Lectura | Escritura | Notas |
|---|---|---|---|
| `[cmde_public].[entitlements].[v_general_info]` | Sí | No | |
| `cmde_raw.dbo.bd_pozos` | Sí | No | también recibe `CREATE INDEX` en `pozos_cache.py` (índice sobre tabla de origen) |
| `cmde_valid.dbo.bd_pozos` | Sí | No | |
| `CUBOS` | Sí | No | |
| `dbo.cache_meta` | Sí | **Sí** | CREATE TABLE, MERGE — consistente con CLAUDE.md |
| `dbo.produccion_pozos` | Sí | **Sí** | DROP/CREATE/ALTER TABLE, CREATE INDEX, SELECT INTO — consistente con CLAUDE.md |
| `dbo.reservas_asig_cont` | Sí | No | |
| `dbo.reservas_asig_cont_campos` | Sí | No | |
| `INVERSIONES_APROBADAS` | Sí | No | |
| `licitaciones_bloques_ofertas` | Sí | No | |
| `PERFORACION_EQUIPOS` | Sí | No | |
| `PERFORACION_POZOS_PERF` | Sí | No | |
| `PERFORACION_POZOS_TERM` | Sí | No | |
| `PRECIOS` | Sí | No | |
| `PRECIOS_AUTOM` | Sí | **Sí** | CREATE TABLE (condicional) + MERGE — consistente con CLAUDE.md |
| `PRODUCCION_CAMPOS` | Sí | No | |
| `PRODUCCION_CAMPOS_POZOS` | Sí | No | |
| `PRODUCCION_ESTADO` | Sí | No | |
| `PRODUCCION_OPERADOR_IP` | Sí | No | |
| `PRODUCCION_POZOS` | Sí | No | tabla de origen leída por `pozos_cache.py` para poblar `dbo.produccion_pozos` |
| `rdmx.T_21_PozosComprometidos` | Sí | No | |
| `RESERVAS_CAMPOS` | Sí | No | |
| `sys.indexes` (`{database}.sys.indexes`) | Sí | No | consulta de catálogo del sistema, no tabla de negocio |
| `sysobjects` | Sí | No | consulta de catálogo del sistema, no tabla de negocio |
| `{settings.db_name}.dbo.cat_pozos` | No (solo índice) | **Sí (parcial)** | solo recibe `CREATE INDEX` condicional en `pozos_cache.py`, no se lee ni escriben datos — ver nota abajo |

### Nota de auditoría sobre escritura

CLAUDE.md indica que solo deberían tener escritura `dbo.cache_meta`, `dbo.produccion_pozos` y `PRECIOS_AUTOM`. Lo encontrado en el código es consistente con eso **excepto** por un caso adicional no mencionado en CLAUDE.md:

- **`{settings.db_name}.dbo.cat_pozos`** (tabla de origen, fuera del schema de caché): en `pozos_cache.py`, función `_asegurar_indices_fuente` (línea 76), se ejecuta un `CREATE INDEX` condicional directamente sobre esta tabla de origen si el índice `ix_cat_pozos_well_id` no existe. Esto es una escritura de DDL (creación de índice) sobre una tabla que, según CLAUDE.md, debería consumirse en modo solo lectura. Se reporta tal cual, sin corregir, para que el usuario lo evalúe.

- De forma similar, `cmde_raw.dbo.bd_pozos` recibe un `CREATE INDEX` condicional (línea 78 de `pozos_cache.py`) — misma observación: DDL sobre tabla de origen no listada como escribible en CLAUDE.md.

Todo lo demás (SELECT/SELECT DISTINCT sobre las demás tablas) es consistente con el modo de solo lectura declarado.
