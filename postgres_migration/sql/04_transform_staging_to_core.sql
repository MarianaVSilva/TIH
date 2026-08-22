-- =====================================================================
-- TIH — transformacion staging -> core. Se corre despues de cada carga
-- de ETL. Idempotente (ON CONFLICT DO UPDATE / TRUNCATE+INSERT segun el
-- caso). Empieza con los dominios mas simples (precios, temas); se
-- amplia dominio por dominio segun el orden del plan (00_PLAN.md).
-- =====================================================================

-- ---------------------------------------------------------------------
-- PRECIOS: cmde_raw.dbo.precios -> core.fact_precios
-- Hay filas con la MISMA fecha pero valores en conflicto en el origen
-- (confirmado en validacion: 9 fechas con 2 filas, no duplicados
-- identicos -- p.ej. 2016-02-01 trae mme=25.53 en una carga vieja y
-- mme=NULL en la mas reciente). Tomar "la fila mas reciente" a secas
-- pierde datos reales. En su lugar: por cada fecha y cada columna, nos
-- quedamos con el valor NO NULO mas reciente (por 'insertado'),
-- columna por columna, no fila por fila.
-- Caso sin resolver algoritmicamente: 2022-02-02 tiene dos valores de
-- brent distintos (92.35 y 91.43) con el MISMO 'insertado' -- ambiguedad
-- real del origen, no de la transformacion. Confirmar con el equipo de
-- datos cual es el valor correcto antes de considerar esto cerrado.
-- ---------------------------------------------------------------------
INSERT INTO core.fact_precios (fecha, brent, wti, mme, henry_hub, opec, fuente)
SELECT
    fecha,
    (array_agg(brent     ORDER BY insertado DESC NULLS LAST) FILTER (WHERE brent IS NOT NULL))[1],
    (array_agg(wti       ORDER BY insertado DESC NULLS LAST) FILTER (WHERE wti IS NOT NULL))[1],
    (array_agg(mme       ORDER BY insertado DESC NULLS LAST) FILTER (WHERE mme IS NOT NULL))[1],
    (array_agg(henry_hub ORDER BY insertado DESC NULLS LAST) FILTER (WHERE henry_hub IS NOT NULL))[1],
    (array_agg(opec      ORDER BY insertado DESC NULLS LAST) FILTER (WHERE opec IS NOT NULL))[1],
    (array_agg(fuentes   ORDER BY insertado DESC NULLS LAST) FILTER (WHERE fuentes IS NOT NULL))[1]
FROM staging.stg_precios
GROUP BY fecha
ON CONFLICT (fecha) DO UPDATE SET
    brent = EXCLUDED.brent,
    wti = EXCLUDED.wti,
    mme = EXCLUDED.mme,
    henry_hub = EXCLUDED.henry_hub,
    opec = EXCLUDED.opec,
    fuente = EXCLUDED.fuente;

-- ---------------------------------------------------------------------
-- TEMAS: cmde_public.dbo.CUBOS -> core.dim_tema
-- Tabla chica, catalogo de menu: full refresh siempre es mas simple y
-- barato que upsert.
-- ---------------------------------------------------------------------
TRUNCATE core.dim_tema RESTART IDENTITY;
INSERT INTO core.dim_tema (seccion, tema, json_arg, init_year, end_year, periodicidad, metodologia, titulo, downloadable)
SELECT
    seccion, tema, json_arg, init_year,
    end_year::INTEGER,
    periodicidad, metodologia, titulo,
    NULLIF(downloadable, '')
FROM staging.stg_cubos;

-- ---------------------------------------------------------------------
-- RESERVAS_CAMPOS: cmde_raw.dbo.sih_reservas_c LEFT JOIN cmde_raw.dbo.campos_loc
-- Replica el filtro WHERE date>='2001-01-01' y el ROUND(...,6) de la vista
-- SQL Server dbo.reservas_campos (ver DATABASE_DEPENDENCIES.md).
-- ---------------------------------------------------------------------

-- dim_geografia: catalogo de (cuenca, ubicacion) — upsert
INSERT INTO core.dim_geografia (cuenca, ubicacion)
SELECT DISTINCT cuenca, ubicacion
FROM staging.stg_campos_loc
WHERE cuenca IS NOT NULL AND ubicacion IS NOT NULL
ON CONFLICT (cuenca, ubicacion) DO NOTHING;

-- dim_campo: catalogo de campos — upsert, campo_portal = campo_nombre (nombre de negocio)
INSERT INTO core.dim_campo (campo_portal, geografia_id, latitud, longitud)
SELECT DISTINCT ON (l.campo_nombre)
    l.campo_nombre,
    g.geografia_id,
    NULLIF(l.latitud, '')::DOUBLE PRECISION,
    NULLIF(l.longitud, '')::DOUBLE PRECISION
FROM staging.stg_campos_loc l
LEFT JOIN core.dim_geografia g ON g.cuenca = l.cuenca AND g.ubicacion = l.ubicacion
WHERE l.campo_nombre IS NOT NULL
ON CONFLICT (campo_portal) DO UPDATE SET
    geografia_id = EXCLUDED.geografia_id,
    latitud = EXCLUDED.latitud,
    longitud = EXCLUDED.longitud;

-- NOTA: staging.stg_sih_reservas_c trae varias filas por (field_id, date,
-- class_desc) con valores DISTINTOS (confirmado: no son duplicados, p.ej.
-- AGUAFRIA/2024-01-01/PROBADAS trae 3 filas con volúmenes diferentes) --
-- la tabla base real tiene una granularidad mas fina que "por campo" que
-- no se capturo en las columnas traidas a staging (probablemente un
-- sub-bloque/corte interno). reservas_service.py ya sumaba estos valores
-- al agregar por año en el backend actual, asi que sumamos aqui en vez de
-- insertar fila por fila -- preserva los totales correctos. Si mas adelante
-- se necesita el detalle fino, ampliar staging.stg_sih_reservas_c con la(s)
-- columna(s) que falten del origen y quitar este SUM.
TRUNCATE core.fact_reservas_campo;
INSERT INTO core.fact_reservas_campo (
    fecha, campo_id, categoria, vo_aceite_mmb, vo_gas_mmmpc,
    rr_aceite_mmb, rr_gas_mmmpc, rr_condensado_mmb, rr_liquidos_planta_mmb,
    rr_pce_mmbpce, rr_gas_seco_mmbpce, rr_gas_seco_mmmpc
)
SELECT
    a.date,
    c.campo_id,
    a.class_desc,
    round(sum(a.vo_aceite_mmb)::numeric, 6),
    round(sum(a.vo_gas_mmmpc)::numeric, 6),
    round(sum(a.aceite_mmb)::numeric, 6),
    round(sum(a.gas_mmmpc)::numeric, 6),
    round(sum(a.condensado_mmb)::numeric, 6),
    round(sum(a.liquidos_planta_mmb)::numeric, 6),
    round(sum(a.pce_mmbpce)::numeric, 6),
    round(sum(a.gas_seco_mmbpce)::numeric, 6),
    round(sum(a.gas_seco_mmmpc)::numeric, 6)
FROM staging.stg_sih_reservas_c a
LEFT JOIN staging.stg_campos_loc l ON a.field_id = l.id_campo
LEFT JOIN core.dim_campo c ON c.campo_portal = l.campo_nombre
WHERE a.date >= '2001-01-01' AND a.class_desc IS NOT NULL
GROUP BY a.date, c.campo_id, a.class_desc;

-- ---------------------------------------------------------------------
-- PRODUCCION_ESTADO: replica dbo.produccion_estado (UNION de:
--   1) sih_produccion_d2016 agregado por (fecha, ent_id, ubicacion norm.),
--      dividido por dias_mes (mismo patron *_MBD/*_MMPCD que el resto)
--   2) produccion_estado_a2016 (historico <=2016, ya viene en unidades /dia)
-- La normalizacion de ubicacion usa core.map_ubicacion (regla de negocio
-- #2 de 00_PLAN.md) en vez de un CASE repetido.
-- ---------------------------------------------------------------------

-- dim_entidad: catalogo de estados
INSERT INTO core.dim_entidad (cve_ent, nom_ent)
SELECT ent_id, upper(ent_nom) FROM staging.stg_cat_entidades
ON CONFLICT (cve_ent) DO UPDATE SET nom_ent = EXCLUDED.nom_ent;

TRUNCATE core.fact_produccion_estado;

-- Parte 1: agregado >2016 desde sih_produccion_d2016
INSERT INTO core.fact_produccion_estado (
    fecha, cve_ent, ubicacion, petroleo_mbd, gas_mmpcd,
    gas_asoc_mmpcd, gas_nasoc_mmpcd, condensado_mbd, agua_mbd, n2_mmpcd
)
SELECT
    a.fecha,
    a.ent_id,
    COALESCE(m.ubicacion_norm, upper(a.ubicacion)),
    sum(a.petroleo_mb / NULLIF(a.dias_mes, 0)),
    sum(a.gas_mmpc / NULLIF(a.dias_mes, 0)),
    sum(a.gas_asoc_mmpc / NULLIF(a.dias_mes, 0)),
    sum(a.gas_nasoc_mmpc / NULLIF(a.dias_mes, 0)),
    sum(a.condensado_mb / NULLIF(a.dias_mes, 0)),
    sum(a.agua_mb / NULLIF(a.dias_mes, 0)),
    sum(a.gas_mmpc / NULLIF(a.dias_mes, 0) * a.n2_perc_asig / 100)
FROM staging.stg_sih_produccion_d2016 a
LEFT JOIN core.map_ubicacion m ON m.ubicacion_origen = a.ubicacion
WHERE a.ent_id IS NOT NULL
GROUP BY a.fecha, a.ent_id, COALESCE(m.ubicacion_norm, upper(a.ubicacion))
ON CONFLICT (fecha, cve_ent, ubicacion) DO UPDATE SET
    petroleo_mbd = EXCLUDED.petroleo_mbd,
    gas_mmpcd = EXCLUDED.gas_mmpcd,
    gas_asoc_mmpcd = EXCLUDED.gas_asoc_mmpcd,
    gas_nasoc_mmpcd = EXCLUDED.gas_nasoc_mmpcd,
    condensado_mbd = EXCLUDED.condensado_mbd,
    agua_mbd = EXCLUDED.agua_mbd,
    n2_mmpcd = EXCLUDED.n2_mmpcd;

-- Parte 2: historico <=2016 desde produccion_estado_a2016 (ya en unidades /dia,
-- no lleva n2_mmpcd en el origen -> NULL, igual que en la vista SQL Server).
-- OJO: esta tabla viene a nivel MUNICIPIO (hasta 47 filas por entidad/fecha/
-- ubicacion, confirmado en validacion) -- hay que sumar por entidad, no
-- insertar fila por fila (el bug original perdia ~20-25% de la produccion
-- historica al quedarse solo con la primera fila via ON CONFLICT DO NOTHING).
INSERT INTO core.fact_produccion_estado (
    fecha, cve_ent, ubicacion, petroleo_mbd, gas_mmpcd,
    gas_asoc_mmpcd, gas_nasoc_mmpcd, condensado_mbd, agua_mbd, n2_mmpcd
)
SELECT fecha, cve_ent, upper(ubicacion),
       sum(petroleo_mbd), sum(gas_mmpcd), sum(gas_asoc_mmpcd),
       sum(gas_nasoc_mmpcd), sum(condensado_mbd), sum(agua_mbd), NULL
FROM staging.stg_produccion_estado_a2016
WHERE cve_ent IS NOT NULL
GROUP BY fecha, cve_ent, upper(ubicacion)
ON CONFLICT (fecha, cve_ent, ubicacion) DO NOTHING;

-- ---------------------------------------------------------------------
-- PRODUCCION_CAMPOS: UNION de vm_produccion_campos_d2016 (vigente) y
-- produccion_campos_a2016 (historico, con remapeo operador/id_operador).
-- Descarta id=1 (fila de totales/placeholder, ver regla #6 de 00_PLAN.md).
-- Confirmado en ETL real: (fecha, campo, tipo) NO es unico -- hay varios
-- contrato/asig_cont por campo/mes, y ademas filas repetidas dentro del
-- mismo (fecha,campo,tipo,contrato) con valores distintos (mismo patron de
-- sub-grano no capturado que en RESERVAS_CAMPOS) -- se suman en el ETL.
-- ---------------------------------------------------------------------

-- dim_contrato: catalogo de asig_cont (ambas fuentes).
-- OJO: en produccion_campos_a2016 (historico <=2016, era previa al sistema
-- de asignaciones/contratos), asig_cont es NULL en el 99% de las filas
-- (170,138 de 171,482, confirmado en ETL real) -- no es un dato faltante
-- por error, es que el concepto de "contrato" no existia todavia para esos
-- registros. Se modela con un contrato sentinela en vez de descartar esas
-- filas con un INNER JOIN (lo que perdia silenciosamente todo el historico
-- <=2015 en la primera version de este script).
INSERT INTO core.dim_contrato (asig_cont, nombre) VALUES
    ('(SIN ASIGNACION)', 'Pre-reforma energetica / sin contrato registrado')
ON CONFLICT (asig_cont) DO NOTHING;

INSERT INTO core.dim_contrato (asig_cont)
SELECT DISTINCT upper(asig_cont) FROM staging.stg_vm_produccion_campos_d2016 WHERE id <> 1 AND asig_cont IS NOT NULL
UNION
SELECT DISTINCT upper(asig_cont) FROM staging.stg_produccion_campos_a2016 WHERE id <> 1 AND asig_cont IS NOT NULL
ON CONFLICT (asig_cont) DO NOTHING;

-- dim_operador
INSERT INTO core.dim_operador (nombre)
SELECT DISTINCT operador FROM staging.stg_vm_produccion_campos_d2016 WHERE id <> 1 AND operador IS NOT NULL
UNION
SELECT DISTINCT CASE operador
    WHEN 'Petroleos Mexicanos' THEN 'PEMEX EXPLORACIÓN Y PRODUCCIÓN'
    ELSE operador END
FROM staging.stg_produccion_campos_a2016 WHERE id <> 1 AND operador IS NOT NULL
ON CONFLICT (nombre) DO NOTHING;

-- dim_geografia: completar con (cuenca,ubicacion) propios de produccion_campos
-- (pueden no existir en campos_loc/RESERVAS_CAMPOS -- son catalogos distintos).
INSERT INTO core.dim_geografia (cuenca, ubicacion)
SELECT DISTINCT cuenca, ubicacion FROM staging.stg_vm_produccion_campos_d2016
WHERE id <> 1 AND cuenca IS NOT NULL AND ubicacion IS NOT NULL
ON CONFLICT (cuenca, ubicacion) DO NOTHING;
INSERT INTO core.dim_geografia (cuenca, ubicacion)
SELECT DISTINCT cuenca, ubicacion FROM staging.stg_produccion_campos_a2016
WHERE id <> 1 AND cuenca IS NOT NULL AND ubicacion IS NOT NULL
ON CONFLICT (cuenca, ubicacion) DO NOTHING;

-- dim_campo: completar con campos que aparezcan aqui y no vinieran ya de RESERVAS_CAMPOS/campos_loc.
-- Se resuelve geografia_id aqui mismo (bug encontrado al portar
-- produccion_service.py:get_produccion_cuenca -- api.v_produccion_campos
-- devolvia cuenca/ubicacion NULL para campos que solo existen en produccion,
-- porque el insert original solo llenaba campo_portal/region, nunca geografia_id).
INSERT INTO core.dim_campo (campo_portal, region, geografia_id)
SELECT DISTINCT ON (campo_portal) campo_portal, region, g.geografia_id
FROM staging.stg_vm_produccion_campos_d2016 s
LEFT JOIN core.dim_geografia g ON g.cuenca = s.cuenca AND g.ubicacion = s.ubicacion
WHERE s.id <> 1 AND s.campo_portal IS NOT NULL
ORDER BY campo_portal, (g.geografia_id IS NULL)
ON CONFLICT (campo_portal) DO UPDATE SET geografia_id = COALESCE(core.dim_campo.geografia_id, EXCLUDED.geografia_id);
INSERT INTO core.dim_campo (campo_portal, region, geografia_id)
SELECT DISTINCT ON (campo_portal) campo_portal, region, g.geografia_id
FROM staging.stg_produccion_campos_a2016 s
LEFT JOIN core.dim_geografia g ON g.cuenca = s.cuenca AND g.ubicacion = s.ubicacion
WHERE s.id <> 1 AND s.campo_portal IS NOT NULL
ORDER BY campo_portal, (g.geografia_id IS NULL)
ON CONFLICT (campo_portal) DO UPDATE SET geografia_id = COALESCE(core.dim_campo.geografia_id, EXCLUDED.geografia_id);

TRUNCATE core.fact_produccion_campo;
-- c1..h2o_mmpcd (composicion del gas): encontradas faltantes al portar
-- produccion_service.py:get_produccion_gcompo -- estaban en staging desde
-- el principio pero nunca se cargaron a core.
INSERT INTO core.fact_produccion_campo (
    fecha, campo_id, contrato_id, operador_id, tipo, dias_produccion,
    petroleo_mbd, petroleo_api, condensado_mbd, gas_mmpcd, gas_asoc_mmpcd,
    gas_nasoc_mmpcd, agua_mbd, n2_mmpcd,
    c1_mmpcd, c2_mmpcd, c3_mmpcd, c4_mmpcd, ic4_mmpcd, c5_plus_mmpcd, co2_mmpcd, h2s_mmpcd, h2o_mmpcd
)
SELECT
    fecha, campo_id, contrato_id, operador_id, tipo,
    sum(dias_produccion), sum(petroleo_mbd),
    (array_agg(petroleo_api) FILTER (WHERE petroleo_api IS NOT NULL))[1],
    sum(condensado_mbd), sum(gas_mmpcd), sum(gas_asoc_mmpcd),
    sum(gas_nasoc_mmpcd), sum(agua_mbd), sum(n2_mmpcd),
    sum(c1_mmpcd), sum(c2_mmpcd), sum(c3_mmpcd), sum(c4_mmpcd), sum(ic4_mmpcd),
    sum(c5_plus_mmpcd), sum(co2_mmpcd), sum(h2s_mmpcd), sum(h2o_mmpcd)
FROM (
    -- vigente
    SELECT
        s.fecha, c.campo_id, ct.contrato_id, o.operador_id, s.tipo,
        s.dias_produccion, s.petroleo_mbd,
        NULLIF(s.petroleo_api, '') AS petroleo_api,
        s.condensado_mbd, s.gas_mmpcd, s.gas_asoc_mmpcd, s.gas_nasoc_mmpcd,
        s.agua_mbd, s.n2_mmpcd,
        s.c1_mmpcd, s.c2_mmpcd, s.c3_mmpcd, s.c4_mmpcd, s.ic4_mmpcd, s.c5_plus_mmpcd, s.co2_mmpcd, s.h2s_mmpcd, s.h2o_mmpcd
    FROM staging.stg_vm_produccion_campos_d2016 s
    JOIN core.dim_campo c ON c.campo_portal = s.campo_portal
    JOIN core.dim_contrato ct ON ct.asig_cont = upper(s.asig_cont)
    LEFT JOIN core.dim_operador o ON o.nombre = s.operador
    WHERE s.id <> 1

    UNION ALL

    -- historico <=2016 (agua_mbd no existe en el origen -> NULL, igual que la vista SQL Server)
    SELECT
        s.fecha, c.campo_id, ct.contrato_id, o.operador_id, s.tipo,
        s.dias_produccion, s.petroleo_mbd,
        NULLIF(s.petroleo_api, ''),
        s.condensado_mbd, s.gas_mmpcd, s.gas_asoc_mmpcd, s.gas_nasoc_mmpcd,
        NULL::numeric, s.n2_mmpcd,
        s.c1_mmpcd, s.c2_mmpcd, s.c3_mmpcd, s.c4_mmpcd, s.ic4_mmpcd, s.c5_plus_mmpcd, s.co2_mmpcd, s.h2s_mmpcd, s.h2o_mmpcd
    FROM staging.stg_produccion_campos_a2016 s
    JOIN core.dim_campo c ON c.campo_portal = s.campo_portal
    JOIN core.dim_contrato ct ON ct.asig_cont = COALESCE(upper(NULLIF(s.asig_cont, '')), '(SIN ASIGNACION)')
    LEFT JOIN core.dim_operador o ON o.nombre = CASE s.operador
        WHEN 'Petroleos Mexicanos' THEN 'PEMEX EXPLORACIÓN Y PRODUCCIÓN' ELSE s.operador END
    WHERE s.id <> 1
) u
GROUP BY fecha, campo_id, contrato_id, operador_id, tipo;

-- ---------------------------------------------------------------------
-- PRODUCCION_POZOS: dim_pozo desde cmde_raw.dbo.bd_pozos, con la regla de
-- "pozo valido" de cmde_valid.dbo.bd_pozos aplicada explicitamente (regla
-- #1 de 00_PLAN.md): ALTERNATE_WELL=0 AND SIDETRACK=0 AND STATUS IN
-- ('CONCLUIDO','EN CONSTRUCCION','EN CONSTRUCCIÓN').
-- ---------------------------------------------------------------------
INSERT INTO core.dim_pozo (
    well_id, well_name, categoria, current_condition, operador,
    drilling_start_date, depth_md, block_id_current, ambiente,
    provincia_geologica, provincia_petrolera, es_valido
)
SELECT DISTINCT ON (well_id)
    well_id, well_name, category, current_condition, operator,
    drilling_start_date, depth_md, block_id_current, environment,
    geological_province, petroleum_province,
    (COALESCE(alternate_well, 0) = 0
     AND COALESCE(sidetrack, 0) = 0
     AND upper(status) IN ('CONCLUIDO', 'EN CONSTRUCCION', 'EN CONSTRUCCIÓN'))
FROM staging.stg_bd_pozos
WHERE well_id IS NOT NULL
ORDER BY well_id, update_date DESC NULLS LAST
ON CONFLICT (well_id) DO UPDATE SET
    well_name = EXCLUDED.well_name,
    categoria = EXCLUDED.categoria,
    current_condition = EXCLUDED.current_condition,
    operador = EXCLUDED.operador,
    drilling_start_date = EXCLUDED.drilling_start_date,
    depth_md = EXCLUDED.depth_md,
    block_id_current = EXCLUDED.block_id_current,
    ambiente = EXCLUDED.ambiente,
    provincia_geologica = EXCLUDED.provincia_geologica,
    provincia_petrolera = EXCLUDED.provincia_petrolera,
    es_valido = EXCLUDED.es_valido;

-- dim_geografia adicional (basin de bd_pozos, por si difiere de cuenca/ubicacion de produccion)
-- (se omite: geografia de pozo se maneja via dim_pozo.provincia_petrolera, no via dim_geografia)

-- fact_produccion_pozo: UNION de las dos ramas reales de cmde_valid.dbo.produccion_pozos
-- (ver DATABASE_DEPENDENCIES.md, correccion post-migracion). Igual que en
-- PRODUCCION_CAMPOS, se agrupa por (fecha,pozo,contrato) sumando -- no se
-- asume que la clave es unica sin probarla primero.
TRUNCATE core.fact_produccion_pozo;

-- dim_bloque: nombres de bloque (ENTITLEMENTS_GENERAL_INFO + fallback CNH-%)
-- BUG (retomando investigacion de discrepancia de cuencas): este INSERT usaba
-- ON CONFLICT DO NOTHING, asi que una fila ya presente de una corrida
-- anterior del transform NUNCA se actualizaba cuando el sufijo de version
-- del block_name cambiaba en la fuente real (ENTITLEMENTS_GENERAL_INFO se
-- actualiza -- p.ej. "A-0006-2M" pasa a "A-0006-3M" con cada enmienda de
-- contrato). dim_bloque quedo con valores obsoletos de una corrida previa a
-- esta sesion, causando que el "campo" (asig_cont, derivado de block_name)
-- mostrado en Postgres tuviera un sufijo de version distinto al que muestra
-- SQL Server ahora mismo -- misma cuenca, mismo campo real, texto distinto.
-- NOTA (pedido explicito del usuario, no paridad estricta con SQL Server):
-- ademas del fallback 'CNH-%' que ya replica la vista SQL Server real, se
-- agrega 'ADM-%' como fallback tambien -- son un tipo de asignacion nueva
-- (administrativa) sin registro en ENTITLEMENTS_GENERAL_INFO que el usuario
-- quiere ver en el arbol de pozos en vez de quedar excluida como en SQL
-- Server. Es una mejora intencional sobre el origen, no un bug replicado.
INSERT INTO core.dim_bloque (block_id, block_name)
SELECT DISTINCT ON (block_id) block_id, block_name
FROM staging.stg_entitlements_general_info
WHERE block_id IS NOT NULL
UNION ALL
SELECT DISTINCT s.block_id, s.block_id
FROM staging.stg_sih_produccion_d2016 s
WHERE (s.block_id LIKE 'CNH-%' OR s.block_id LIKE 'ADM-%')
  AND NOT EXISTS (SELECT 1 FROM staging.stg_entitlements_general_info e WHERE e.block_id = s.block_id)
ON CONFLICT (block_id) DO UPDATE SET block_name = EXCLUDED.block_name;

-- dim_contrato: completar con block_id/asig_cont que aparezcan solo en pozos.
-- OJO (bug encontrado al portar pozos_service.py): en la vista SQL Server
-- original, el ASIG_CONT de produccion_pozos para la rama vigente NO es el
-- codigo crudo de bloque -- es BLOCK_NAME de ENTITLEMENTS_GENERAL_INFO
-- (p.ej. "A-0203-4M - CAMPO MALOOB", no "A-0203"), con reemplazo de acentos
-- (Á→A,É→E,Í→I,Ó→O,Ú→U) y en mayusculas; solo cae al codigo crudo cuando es
-- un contrato 'CNH-%' sin match en ENTITLEMENTS_GENERAL_INFO. La primera
-- version de este script uso el codigo crudo siempre -- el arbol de pozos y
-- el detalle por pozo quedaban con un valor de "campo" distinto al que
-- muestra SQL Server, y las consultas de detalle (que filtran por ese valor)
-- no encontraban nada.
INSERT INTO core.dim_contrato (asig_cont)
SELECT DISTINCT upper(NULLIF(asignacion_contrato, '')) FROM staging.stg_produccion_pozos_a2016
WHERE NULLIF(asignacion_contrato, '') IS NOT NULL
ON CONFLICT (asig_cont) DO NOTHING;
-- BUG (retomando investigacion de discrepancia de cuencas): el fallback a
-- s.block_id aplicaba a CUALQUIER block_id sin match en dim_bloque. La vista
-- SQL Server real solo hace ese fallback para block_id LIKE 'CNH-%' (ver
-- subquery ASIG); para cualquier otro codigo sin match en
-- ENTITLEMENTS_GENERAL_INFO (p.ej. 'ADM-E-002', administrativos) ASIG.block_name
-- queda NULL -- SQL Server nunca inventa un asig_cont con el codigo crudo
-- para esos, por lo que esas filas terminan con ASIG_CONT NULL y se excluyen
-- del arbol de pozos. Postgres las mostraba como "campos" falsos.
-- Se agrega 'ADM-%' al fallback (ver nota de dim_bloque arriba) -- pedido
-- explicito del usuario para mostrar las asignaciones administrativas.
INSERT INTO core.dim_contrato (asig_cont)
SELECT DISTINCT
    translate(upper(COALESCE(b.block_name, CASE WHEN s.block_id LIKE 'CNH-%' OR s.block_id LIKE 'ADM-%' THEN s.block_id END)), 'ÁÉÍÓÚ', 'AEIOU')
FROM staging.stg_sih_produccion_d2016 s
LEFT JOIN core.dim_bloque b ON b.block_id = s.block_id
WHERE COALESCE(b.block_name, CASE WHEN s.block_id LIKE 'CNH-%' OR s.block_id LIKE 'ADM-%' THEN s.block_id END) IS NOT NULL
ON CONFLICT (asig_cont) DO NOTHING;

-- BUG ENCONTRADO (retomando investigacion de discrepancia 5 vs 4 cuencas en el
-- arbol de pozos): la vista SQL Server real (cmde_valid.dbo.produccion_pozos)
-- NO usa PROD_A_2016.cuenca para la rama historica -- esa columna esta
-- explicitamente comentada/reemplazada en la definicion real por
-- UPPER(BDP.PETROLEUM_PROVINCE) (bd_pozos, resuelto vía la tabla de enlace
-- por nombre solo para ESE dato -- pero como ya identificamos el pozo por
-- well_id via dim_pozo, podemos leer directo dim_pozo.provincia_petrolera,
-- que ya viene de stg_bd_pozos.petroleum_province). La primera version de
-- este script uso staging.stg_produccion_pozos_a2016.cuenca (la columna que
-- SQL Server descarta), lo que resolvia geografia_id distinto -- causa raiz
-- de que el arbol de navegacion (get_produccion_pozos_arbol) mostrara 4
-- cuencas en Postgres contra 5 en SQL Server para el mismo filtro.
-- Aseguramos que exista una fila de dim_geografia por cada provincia
-- petrolera de bd_pozos (puede haber varias con la misma cuenca y distinta
-- ubicacion ya cargadas; se agrega con ubicacion generica solo si falta).
INSERT INTO core.dim_geografia (cuenca, ubicacion)
SELECT DISTINCT upper(petroleum_province), 'SIN CLASIFICAR'
FROM staging.stg_bd_pozos
WHERE petroleum_province IS NOT NULL
ON CONFLICT (cuenca, ubicacion) DO NOTHING;

-- Mismo problema para la rama vigente: el join de mas abajo es
-- "g.cuenca = upper(s.cuenca)" (exacto, sin upper() del lado de g), pero
-- dim_geografia ya tenia filas para varias de estas cuencas cargadas con
-- capitalizacion mixta desde otros dominios (p.ej. 'Sabinas', 'Cinturon
-- Plegado de Chiapas') en vez de mayusculas -- el join nunca las
-- encontraba, dejando geografia_id NULL y esas filas fuera del arbol
-- (aun con contrato_id ya resuelto correctamente). Se asegura una fila en
-- mayusculas exacta por cada texto de cuenca crudo que usa esta rama.
INSERT INTO core.dim_geografia (cuenca, ubicacion)
SELECT DISTINCT upper(s.cuenca), 'SIN CLASIFICAR'
FROM staging.stg_sih_produccion_d2016 s
WHERE NULLIF(s.cuenca, '') IS NOT NULL
ON CONFLICT (cuenca, ubicacion) DO NOTHING;

-- La PK real de la tabla es (fecha, pozo_id) -- SIN contrato_id/geografia_id.
-- Se encontraron filas del origen con el MISMO pozo/fecha/valores pero
-- 'cuenca' distinta (una poblada, otra vacia -- confirmado: well_id=110712,
-- 1980-09-01) que resuelven a geografia_id distinto y violan la PK real.
-- Se deduplica por VALOR (DISTINCT en la subquery interna, ya existente)
-- y se agrupa por la PK real, tomando contrato_id/geografia_id
-- representativo (preferencia por no-nulo) en vez de que cada combinacion
-- distinta genere una fila -- la tabla no soporta mas de un contrato/cuenca
-- por pozo/fecha por diseno.
INSERT INTO core.fact_produccion_pozo (fecha, pozo_id, contrato_id, geografia_id, petroleo_mbd, condensado_mbd, gas_mmpcd, gas_asoc_mmpcd, gas_nasoc_mmpcd, agua_mbd)
SELECT
    fecha, pozo_id,
    (array_agg(contrato_id) FILTER (WHERE contrato_id IS NOT NULL))[1],
    (array_agg(geografia_id) FILTER (WHERE geografia_id IS NOT NULL))[1],
    sum(petroleo_mbd), sum(condensado_mbd), sum(gas_mmpcd), sum(gas_asoc_mmpcd), sum(gas_nasoc_mmpcd), sum(agua_mbd)
FROM (
    -- historico <=2016: el identificador de pozo es PROD_A_2016.well_id
    -- directamente (well_id, NO wid). La tabla de enlace por nombre
    -- (sih_well_name_link_p_inf6016) solo se usa en la vista SQL Server
    -- original para tomar WELL_NAME/cuenca "bonitos" de bd_pozos por
    -- cosmetica -- NO para resolver la identidad del pozo. Usarla como
    -- join key (bug encontrado en la primera version de este script) hacia
    -- dim_pozo.well_id (que se llena con bd_pozos.WELL_ID, no WID) hacia
    -- 0 filas siempre -- WID y WELL_ID son namespaces distintos.
    -- DISTINCT: la vista SQL Server original usa UNION (no UNION ALL) para
    -- combinar esta rama con la vigente, lo que deduplica filas identicas --
    -- confirmado en ETL real: 19,039 de 131,176 filas de 2015 eran
    -- duplicados exactos. Sin este DISTINCT, el SUM cuenta esos duplicados
    -- de mas (se detecto porque los totales de Postgres salian ~15-20% MAS
    -- altos que SQL Server para 1948-2015, nunca menos).
    SELECT
        s.fecha, p.pozo_id, ct.contrato_id, g.geografia_id,
        s.petroleo_mbd, s.condensado_mbd, s.gas_mmpcd, s.gas_asoc_mmpcd, s.gas_nasoc_mmpcd, s.agua_mbd
    FROM (
        SELECT DISTINCT
            fecha, well_id, cuenca, block_id, asignacion_contrato,
            petroleo_mbd, condensado_mbd, gas_mmpcd, gas_asoc_mmpcd, gas_nasoc_mmpcd, agua_mbd
        FROM staging.stg_produccion_pozos_a2016
    ) s
    LEFT JOIN core.dim_pozo p ON p.well_id = s.well_id
    -- BUG (retomando investigacion de discrepancia de cuencas): la fuente
    -- real cmde_valid.dbo.PRODUCCION_POZOS_A2016.asignacion_contrato esta
    -- 100% NULL (confirmado: COUNT(asignacion_contrato)=0 sobre las
    -- 2,776,502 filas). SQL Server nunca sustituye ese NULL para esta tabla
    -- -- a diferencia de PRODUCCION_CAMPOS, produccion_pozos NO tiene rama
    -- de fallback a un contrato generico. Como get_produccion_pozos_arbol
    -- filtra "WHERE ASIG_CONT IS NOT NULL", TODA la rama historica queda
    -- excluida del arbol en SQL Server. Usar el sentinel '(SIN ASIGNACION)'
    -- aqui (como se hizo para PRODUCCION_CAMPOS) hacia que ~2.7M filas
    -- historicas aparecieran como pozos de un "campo" falso bajo la cuenca
    -- resuelta via petroleum_province, cuando SQL Server los excluye del
    -- todo -- causa raiz real de la discrepancia de cuencas en el arbol
    -- (no era el MIN(geografia_id) como se sospechaba originalmente).
    LEFT JOIN core.dim_contrato ct ON ct.asig_cont = upper(NULLIF(s.asignacion_contrato, ''))
    LEFT JOIN core.dim_geografia g ON g.geografia_id = (SELECT min(g2.geografia_id) FROM core.dim_geografia g2 WHERE g2.cuenca = upper(p.provincia_petrolera))
    WHERE p.pozo_id IS NOT NULL

    UNION ALL

    -- vigente: agregado desde sih_produccion_d2016 por pozo/fecha (ya cargada por 03_*)
    -- Mismo bug que en la insercion de dim_contrato de arriba: el fallback a
    -- s.block_id (y el sentinel '(SIN ASIGNACION)' via ctdef) no existen en
    -- la vista SQL Server real -- si block_id no matchea EGI y no es
    -- 'CNH-%', ASIG_CONT queda NULL, punto. Se quita el sentinel para que
    -- esas filas queden con contrato_id NULL igual que SQL Server (se
    -- excluyen del arbol de pozos por el filtro ASIG_CONT IS NOT NULL,
    -- pero SI cuentan para los totales agregados de KPIs por cuenca/campo,
    -- que no filtran por asig_cont).
    SELECT
        s.fecha,
        p.pozo_id,
        ct.contrato_id,
        g.geografia_id,
        sum(s.petroleo_mb / NULLIF(s.dias_mes,0)),
        sum(s.condensado_mb / NULLIF(s.dias_mes,0)),
        sum(s.gas_mmpc / NULLIF(s.dias_mes,0)),
        sum(s.gas_asoc_mmpc / NULLIF(s.dias_mes,0)),
        sum(s.gas_nasoc_mmpc / NULLIF(s.dias_mes,0)),
        sum(s.agua_mb / NULLIF(s.dias_mes,0))
    FROM staging.stg_sih_produccion_d2016 s
    LEFT JOIN core.dim_pozo p ON p.well_id = s.well_id
    LEFT JOIN core.dim_bloque b ON b.block_id = s.block_id
    LEFT JOIN core.dim_contrato ct ON ct.asig_cont = translate(upper(COALESCE(b.block_name, CASE WHEN s.block_id LIKE 'CNH-%' OR s.block_id LIKE 'ADM-%' THEN s.block_id END)), 'ÁÉÍÓÚ', 'AEIOU')
    LEFT JOIN core.dim_geografia g ON g.geografia_id = (SELECT min(g2.geografia_id) FROM core.dim_geografia g2 WHERE g2.cuenca = upper(s.cuenca))
    WHERE p.pozo_id IS NOT NULL
    GROUP BY s.fecha, p.pozo_id, ct.contrato_id, g.geografia_id
) u
WHERE pozo_id IS NOT NULL
GROUP BY fecha, pozo_id;

-- ---------------------------------------------------------------------
-- PRODUCCION_OPERADOR_IP: replica dbo.produccion_operador_ip. Prorratea
-- por vigencia contractual (FACTOR_MES/FACTOR_IP/FACTOR_O) UNA VEZ aqui en
-- el ETL, no en cada consulta como hace la vista SQL Server (regla de
-- negocio #3 de 00_PLAN.md).
-- ---------------------------------------------------------------------

INSERT INTO core.dim_empresa (contratista_corto)
SELECT DISTINCT contratista_corto FROM staging.stg_empresas_ip_hist WHERE contratista_corto IS NOT NULL
ON CONFLICT DO NOTHING;
-- Sentinela: igual que la vista SQL Server (COALESCE(CONTRATISTA_CORTO, 'PEMEX...')),
-- cuando no hay match en empresas_ip_hist para el periodo (p.ej. asignaciones
-- antiguas sin contrato de participacion registrado) se asume Pemex operador directo.
INSERT INTO core.dim_empresa (contratista_corto) VALUES ('PEMEX EXPLORACIÓN Y PRODUCCIÓN')
ON CONFLICT DO NOTHING;

TRUNCATE core.fact_produccion_operador;
WITH b0 AS (
    SELECT DISTINCT id_contrato, contrato, contratista_corto, modificacion,
           vig_inicio, (vig_fin - INTERVAL '1 day')::date AS vig_fin, id_tipo_part, interes_part
    FROM staging.stg_empresas_ip_hist
),
b AS (
    SELECT
        upper(contrato) AS asig_cont, contratista_corto,
        min(id_tipo_part) AS id_tipo_part,
        sum(interes_part) AS interes_part,
        modificacion,
        date_trunc('month', vig_inicio)::date AS periodo_inicio,
        date_trunc('month', COALESCE(vig_fin, now()))::date AS periodo_fin,
        vig_inicio, vig_fin
    FROM b0
    GROUP BY contrato, modificacion, vig_inicio, vig_fin, contratista_corto
),
-- La vista SQL Server filtra "AND ASIG_CONT is not null" -- en core eso
-- equivale a excluir el contrato sentinela '(SIN ASIGNACION)' usado para
-- el historico pre-reforma sin contrato registrado (ver regla del contrato
-- sentinela en la seccion de PRODUCCION_CAMPOS). Sin este filtro, TODO el
-- historico <=2015 aparecia con datos en este dominio cuando en SQL Server
-- la vista real no devuelve nada antes de 2016 (confirmado en validacion).
a AS (
    SELECT f.fecha, ct.asig_cont,
           sum(f.petroleo_mbd) petroleo_mbd, sum(f.gas_mmpcd) gas_mmpcd,
           sum(f.gas_asoc_mmpcd) gas_asoc_mmpcd, sum(f.gas_nasoc_mmpcd) gas_nasoc_mmpcd,
           sum(f.condensado_mbd) condensado_mbd, sum(f.n2_mmpcd) n2_mmpcd, sum(f.agua_mbd) agua_mbd
    FROM core.fact_produccion_campo f
    JOIN core.dim_contrato ct ON ct.contrato_id = f.contrato_id
    WHERE ct.asig_cont <> '(SIN ASIGNACION)'
    GROUP BY f.fecha, ct.asig_cont
),
-- FAN-OUT INTENCIONAL: un mismo contrato puede tener varias empresas
-- co-participantes vigentes en el mismo periodo (confirmado en ETL real) --
-- la vista SQL Server repite la produccion total del contrato una vez por
-- empresa, cada una con su propio FACTOR_IP, para que el consumidor aplique
-- el prorrateo. Se permite ese fan-out por empresa; lo que SI se deduplica
-- es una MISMA empresa con periodos de contrato solapados en la propia
-- fuente (eso era el bug real que violaba la PK) -- se resuelve con un
-- agregado final que toma un valor representativo por (fecha,contrato,empresa)
-- en vez de sumar (sumar duplicaria la produccion de esa empresa).
joined AS (
    SELECT
        a.fecha, ct.contrato_id, COALESCE(em.empresa_id, pemex.empresa_id) AS empresa_id,
        CASE WHEN b.id_tipo_part IS NULL THEN 1 WHEN b.id_tipo_part = 1 THEN 1 ELSE 0 END AS factor_o,
        COALESCE(b.interes_part, 1) AS factor_ip,
        CASE
            WHEN b.modificacion > 0 AND a.fecha = b.periodo_inicio
                THEN 1 - (EXTRACT(DAY FROM b.vig_inicio) - 1) / EXTRACT(DAY FROM (date_trunc('month', a.fecha) + INTERVAL '1 month' - INTERVAL '1 day'))
            WHEN a.fecha = b.periodo_fin
                THEN (EXTRACT(DAY FROM b.vig_fin) - 1) / EXTRACT(DAY FROM (date_trunc('month', a.fecha) + INTERVAL '1 month' - INTERVAL '1 day'))
            ELSE 1
        END AS factor_mes,
        CASE
            WHEN b.modificacion > 0 AND a.fecha = b.periodo_inicio
                THEN EXTRACT(DAY FROM (date_trunc('month', a.fecha) + INTERVAL '1 month' - INTERVAL '1 day')) - EXTRACT(DAY FROM b.vig_inicio)
            WHEN a.fecha = b.periodo_fin
                THEN EXTRACT(DAY FROM b.vig_fin)
            ELSE EXTRACT(DAY FROM (date_trunc('month', a.fecha) + INTERVAL '1 month' - INTERVAL '1 day'))
        END AS dias_produccion,
        a.petroleo_mbd, a.gas_mmpcd, a.gas_asoc_mmpcd, a.gas_nasoc_mmpcd,
        a.condensado_mbd, a.n2_mmpcd, a.agua_mbd,
        b.modificacion, b.vig_inicio
    FROM a
    JOIN core.dim_contrato ct ON ct.asig_cont = a.asig_cont
    LEFT JOIN b ON b.asig_cont = a.asig_cont AND b.periodo_inicio <= a.fecha AND a.fecha <= b.periodo_fin
    LEFT JOIN core.dim_empresa em ON em.contratista_corto = b.contratista_corto
    LEFT JOIN core.dim_empresa pemex ON pemex.contratista_corto = 'PEMEX EXPLORACIÓN Y PRODUCCIÓN'
)
INSERT INTO core.fact_produccion_operador (
    fecha, contrato_id, empresa_id, factor_o, factor_ip, factor_mes,
    dias_produccion, petroleo_mbd, gas_mmpcd, gas_asoc_mmpcd, gas_nasoc_mmpcd,
    condensado_mbd, n2_mmpcd, agua_mbd
)
-- petroleo_mbd/gas_mmpcd/etc: SUM, no valor representativo. Encontrado al
-- portar contratos_service.py (get_operadores): cuando el MISMO contrato
-- tiene 2 fragmentos de modificacion distintos dentro del mismo mes
-- calendario para la MISMA empresa (p.ej. HOKCHI ENERGY, 2022-05), la vista
-- SQL Server original hace fan-out (JOIN plano sin GROUP BY en ese nivel) y
-- el propio contratos_service.py suma esos fragmentos con su SUM(...) --
-- osea que SQL Server SI reporta el mes completo como la suma de ambos
-- fragmentos. La primera version de este bloque tomaba solo un fragmento
-- (para resolver una violacion de PK real de otro caso -- distintas
-- empresas en el mismo contrato) y por error tambien colapsaba este caso,
-- perdiendo la mitad del volumen de ese mes. factor_o/factor_ip/factor_mes/
-- dias_produccion siguen siendo representativos (son atributos descriptivos
-- de UN fragmento, no algo que sume con sentido).
SELECT
    fecha, contrato_id, empresa_id,
    (array_agg(factor_o ORDER BY modificacion DESC NULLS LAST, vig_inicio DESC NULLS LAST))[1],
    (array_agg(factor_ip ORDER BY modificacion DESC NULLS LAST, vig_inicio DESC NULLS LAST))[1],
    (array_agg(factor_mes ORDER BY modificacion DESC NULLS LAST, vig_inicio DESC NULLS LAST))[1],
    (array_agg(dias_produccion ORDER BY modificacion DESC NULLS LAST, vig_inicio DESC NULLS LAST))[1],
    sum(petroleo_mbd), sum(gas_mmpcd), sum(gas_asoc_mmpcd), sum(gas_nasoc_mmpcd),
    sum(condensado_mbd), sum(n2_mmpcd), sum(agua_mbd)
FROM joined
GROUP BY fecha, contrato_id, empresa_id;

-- ---------------------------------------------------------------------
-- INVERSIONES_APROBADAS: cmde_raw.dbo.inversiones_aprobadas, replicando el
-- filtro WHERE REPORTE='SI' AND VIGENTE='SI' de la cadena de vistas
-- (cmde_valid.dbo.inversiones_aprobadas -> cmde_public.dbo.inversiones_aprobadas).
-- ---------------------------------------------------------------------

-- OJO: la tabla trae DOS columnas parecidas -- "asg_cont" (categorica, SIEMPRE
-- 'Contrato' tras el filtro REPORTE/VIGENTE -- confirmado en ETL real, no es
-- un bug del origen, es un flag de tipo) y "contrato" (el codigo real, el
-- que usa el resto del backend: get_pozos_comprometidos hace JOIN por este
-- campo). La primera version de este script uso "asg_cont" por error --
-- dim_contrato quedaba con una sola entrada literal "Contrato" y todo el
-- join de pozos_comprometidos->inversiones (MODALIDAD/UBICACION) fallaba.
INSERT INTO core.dim_contrato (asig_cont)
SELECT DISTINCT upper(NULLIF(contrato, '')) FROM staging.stg_inversiones_aprobadas
WHERE reporte = 'SI' AND vigente = 'SI' AND NULLIF(contrato, '') IS NOT NULL
ON CONFLICT (asig_cont) DO NOTHING;

INSERT INTO core.dim_licitacion (ronda, licitacion)
SELECT DISTINCT ronda, licitacion FROM staging.stg_inversiones_aprobadas
WHERE reporte = 'SI' AND vigente = 'SI' AND licitacion IS NOT NULL
ON CONFLICT (ronda, licitacion) DO NOTHING;

TRUNCATE core.fact_inversiones;
INSERT INTO core.fact_inversiones (
    anio, contrato_id, licitacion_id, ronda, tipo_plan, act_petrolera,
    sub_act_petrolera, tarea, estado, ubicacion, cuenca, modalidad, capex_opex, mes, monto_usd,
    tipo, escenario, vigente, reporte, fecha_og
)
SELECT
    s.anio::int, ct.contrato_id, lic.licitacion_id, s.ronda, s.tipo_plan,
    s.act_petrolera, s.sub_act_petrolera, s.tarea, s.estado, s.ubicacion, s.cuenca, s.modalidad,
    s.capex_opex,
    NULLIF(s.mes, '')::smallint,
    s.monto_usd, s.tipo, s.escenario,
    (s.vigente = 'SI'), (s.reporte = 'SI'), s.fecha_og
FROM staging.stg_inversiones_aprobadas s
LEFT JOIN core.dim_contrato ct ON ct.asig_cont = upper(NULLIF(s.contrato, ''))
LEFT JOIN core.dim_licitacion lic ON lic.ronda IS NOT DISTINCT FROM s.ronda AND lic.licitacion = s.licitacion
WHERE s.reporte = 'SI' AND s.vigente = 'SI' AND s.anio IS NOT NULL;

-- ---------------------------------------------------------------------
-- POZOS_COMPROMETIDOS: replica rdmx.T_21_PozosComprometidos (subsistema
-- de licitaciones, tablas base directas -- sin indireccion, ver
-- DATABASE_DEPENDENCIES.md).
-- ---------------------------------------------------------------------

INSERT INTO core.dim_contrato (asig_cont)
SELECT DISTINCT upper(contrato) FROM staging.stg_t21a_pozoscomprometidos WHERE contrato IS NOT NULL
ON CONFLICT (asig_cont) DO NOTHING;

INSERT INTO core.dim_licitacion (ronda, licitacion)
SELECT DISTINCT ronda, licitacion FROM staging.stg_t01a_infogral WHERE licitacion IS NOT NULL
ON CONFLICT (ronda, licitacion) DO NOTHING;

TRUNCATE core.fact_pozos_comprometidos;
INSERT INTO core.fact_pozos_comprometidos (
    contrato_id, licitacion_id, area_contractual, pmt_pozos, pozos_planes,
    terminados, en_perforacion, por_perforar, descubrimientos, comentarios
)
SELECT
    ct.contrato_id, lic.licitacion_id, b.ac,
    NULLIF(a.pmteapozos, '')::numeric,
    NULLIF(a.pozosplanes, '')::numeric,
    COALESCE(c.terminados, 0),
    COALESCE(d.en_perforacion, 0),
    GREATEST(0, COALESCE(NULLIF(a.pozosplanes,'')::numeric,0) - COALESCE(c.terminados,0) - COALESCE(d.en_perforacion,0)),
    a.descubrimientos, a.comentarios
FROM staging.stg_t21a_pozoscomprometidos a
JOIN core.dim_contrato ct ON ct.asig_cont = upper(a.contrato)
-- upper(): SQL Server compara CONTRATO con collation insensible a
-- mayusculas por default: T_12_Pozos trae 'EK-BALAM'/'EK-Balam' y
-- T_21a_PozosComprometidos trae 'Ek-Balam' para el MISMO contrato --
-- confirmado en ETL real (terminados/en_perforacion salian en 0 para varios
-- contratos por comparacion case-sensitive de Postgres).
LEFT JOIN staging.stg_t01a_infogral b ON upper(b.contrato) = upper(a.contrato)
LEFT JOIN core.dim_licitacion lic ON lic.ronda IS NOT DISTINCT FROM b.ronda AND lic.licitacion = b.licitacion
LEFT JOIN (SELECT upper(contrato) contrato, count(pozo) terminados FROM staging.stg_t12_pozos WHERE estatus = 'Concluido' GROUP BY upper(contrato)) c ON c.contrato = upper(a.contrato)
LEFT JOIN (SELECT upper(contrato) contrato, count(pozo) en_perforacion FROM staging.stg_t12_pozos WHERE estatus = 'En perforación' GROUP BY upper(contrato)) d ON d.contrato = upper(a.contrato)
ON CONFLICT (contrato_id) DO UPDATE SET
    licitacion_id = EXCLUDED.licitacion_id, area_contractual = EXCLUDED.area_contractual,
    pmt_pozos = EXCLUDED.pmt_pozos, pozos_planes = EXCLUDED.pozos_planes,
    terminados = EXCLUDED.terminados, en_perforacion = EXCLUDED.en_perforacion,
    por_perforar = EXCLUDED.por_perforar, descubrimientos = EXCLUDED.descubrimientos,
    comentarios = EXCLUDED.comentarios;

-- ---------------------------------------------------------------------
-- LICITACIONES_OFERTAS: cmde_public.dbo.licitaciones_bloques_ofertas (tabla real)
-- ---------------------------------------------------------------------

INSERT INTO core.dim_pais (nombre)
SELECT DISTINCT pais FROM staging.stg_licitaciones_bloques_ofertas WHERE pais IS NOT NULL
ON CONFLICT (nombre) DO NOTHING;

-- OJO: api.v_licitaciones_ofertas expone em.contratista (no contratista_corto)
-- como "empresa" -- si solo se llena contratista_corto aqui, el join de la
-- vista devuelve NULL y get_contratos_adjudicados() colapsa TODO a "Sin
-- clasificar" (encontrado al portar contratos_service.py). Se llenan ambas
-- columnas con el mismo valor -- para este dominio solo hay un nombre.
INSERT INTO core.dim_empresa (contratista_corto, contratista)
SELECT DISTINCT empresa, empresa FROM staging.stg_licitaciones_bloques_ofertas WHERE empresa IS NOT NULL
ON CONFLICT (contratista_corto) DO UPDATE SET contratista = EXCLUDED.contratista;

INSERT INTO core.dim_geografia (cuenca, ubicacion)
SELECT DISTINCT cuenca, COALESCE(ubicacion, 'SIN DATO') FROM staging.stg_licitaciones_bloques_ofertas
WHERE cuenca IS NOT NULL
ON CONFLICT (cuenca, ubicacion) DO NOTHING;

-- OJO: la columna cruda "contrato" en licitaciones_bloques_ofertas es en
-- realidad la MODALIDAD ("Producción compartida", "Licencia"...), no un
-- codigo de contrato -- "contrato_nombre" es el identificador real
-- (confirmado al portar contratos_service.py). dim_contrato se puebla desde
-- contrato_nombre; la primera version de este script metia texto de
-- modalidad en dim_contrato por error.
INSERT INTO core.dim_contrato (asig_cont)
SELECT DISTINCT upper(contrato_nombre) FROM staging.stg_licitaciones_bloques_ofertas WHERE contrato_nombre IS NOT NULL
ON CONFLICT (asig_cont) DO NOTHING;

INSERT INTO core.dim_licitacion (ronda, licitacion)
SELECT DISTINCT ronda, licitacion FROM staging.stg_licitaciones_bloques_ofertas WHERE licitacion IS NOT NULL
ON CONFLICT (ronda, licitacion) DO NOTHING;

TRUNCATE core.fact_licitaciones_ofertas;
INSERT INTO core.fact_licitaciones_ofertas (
    licitacion_id, id_bloque, empresa_id, pais_id, contrato_id, geografia_id,
    inv_usd, bono, vpo, pozos_comprometidos, area, validez, entidad_principal,
    modalidad, contrato_nombre, id_licitante, id_licitante_adj
)
SELECT
    lic.licitacion_id, s.id_bloque, em.empresa_id, pa.pais_id, ct.contrato_id, g.geografia_id,
    s.inv_usd, s.bono, s.vpo, s.pozos_comprometidos, s.area, s.validez, s.entidad_principal,
    s.contrato, s.contrato_nombre, s.id_licitante, s.id_licitante_adj
FROM staging.stg_licitaciones_bloques_ofertas s
LEFT JOIN core.dim_licitacion lic ON lic.ronda IS NOT DISTINCT FROM s.ronda AND lic.licitacion = s.licitacion
LEFT JOIN core.dim_empresa em ON em.contratista_corto = s.empresa
LEFT JOIN core.dim_pais pa ON pa.nombre = s.pais
LEFT JOIN core.dim_contrato ct ON ct.asig_cont = upper(s.contrato_nombre)
LEFT JOIN core.dim_geografia g ON g.cuenca = s.cuenca AND g.ubicacion = COALESCE(s.ubicacion, 'SIN DATO');

-- ---------------------------------------------------------------------
-- RESERVAS_ASIG_CONT: se paso por alto en la primera ronda de migracion
-- (encontrado vacio al portar reservas_service.py). Replica dbo.reservas_asig_cont:
-- self-join acumulativo de sih_reservas contra si misma por CLASS_ID (1P/2P/3P),
-- filtrado a fecha>=2016-01-01 igual que la vista SQL Server.
-- No se replica el detalle por CAMPO (reservas_asig_cont_campos) -- el unico
-- uso real en el backend de esa vista es un catalogo codigo->nombre de
-- bloque, que se resuelve via dim_bloque.block_name (poblado abajo).
-- ---------------------------------------------------------------------

-- BUG (retomando investigacion de discrepancia de cuencas): este INSERT
-- corre DESPUES del de arriba (que usa staging.stg_entitlements_general_info,
-- la fuente que la vista SQL Server real de produccion_pozos efectivamente
-- usa) y antes usaba DO UPDATE -- pisaba el block_name correcto con el valor
-- de esta OTRA fuente (usada para reservas), que puede estar desfasada en el
-- tiempo respecto a ENTITLEMENTS_GENERAL_INFO (confirmado: A-0399/A-0401/
-- AE-0159 traian aqui un sufijo de version distinto al vigente). Se cambia a
-- DO NOTHING para que la fuente autoritativa (EGI, insertada arriba) nunca
-- sea sobreescrita; esta tabla solo debe completar block_id que EGI no tenga.
INSERT INTO core.dim_bloque (block_id, block_name)
SELECT DISTINCT block_id, block_name FROM staging.stg_general_info_estados WHERE block_id IS NOT NULL
ON CONFLICT (block_id) DO NOTHING;

INSERT INTO core.dim_geografia (cuenca, ubicacion)
SELECT DISTINCT l.cuenca_bloque, l.ubicacion FROM staging.stg_campos_loc l
WHERE l.cuenca_bloque IS NOT NULL AND l.ubicacion IS NOT NULL
ON CONFLICT (cuenca, ubicacion) DO NOTHING;

INSERT INTO core.dim_contrato (asig_cont)
SELECT DISTINCT upper(block_id) FROM staging.stg_sih_reservas
WHERE block_id IS NOT NULL AND block_id <> '0'
ON CONFLICT (asig_cont) DO NOTHING;

TRUNCATE core.fact_reservas_asignacion;
WITH base AS (
    SELECT
        r.date, COALESCE(NULLIF(r.block_id, ''), '0') AS block_id, r.class_id,
        l.cuenca_bloque AS cuenca, l.ubicacion,
        r.pce_mmbpce, r.aceite_mmb, r.gas_mmmpc, r.condensado_mmb, r.liquidos_planta_mmb, r.gas_seco_mmmpc
    FROM staging.stg_sih_reservas r
    LEFT JOIN staging.stg_campos_loc l ON r.field_id = l.id_campo
    WHERE r.date >= '2016-01-01'
),
t1 AS (
    SELECT DISTINCT date, block_id, class_id, cuenca, ubicacion FROM base
),
t2 AS (
    SELECT date, block_id, class_id, cuenca, ubicacion,
           sum(pce_mmbpce) pce_mmbpce, sum(aceite_mmb) aceite_mmb, sum(gas_mmmpc) gas_mmmpc,
           sum(condensado_mmb) condensado_mmb, sum(liquidos_planta_mmb) liquidos_planta_mmb, sum(gas_seco_mmmpc) gas_seco_mmmpc
    FROM base
    GROUP BY date, block_id, class_id, cuenca, ubicacion
)
INSERT INTO core.fact_reservas_asignacion (
    fecha, contrato_id, geografia_id, tipo,
    rr_pce_mmbpce, rr_aceite_mmb, rr_gas_natural_mmmpc, rr_condensado_mmb, rr_liquidos_planta_mmb, rr_gas_seco_mmmpc
)
SELECT
    t1.date, ct.contrato_id, g.geografia_id, concat(t1.class_id, 'P'),
    sum(t2.pce_mmbpce), sum(t2.aceite_mmb), sum(t2.gas_mmmpc),
    sum(t2.condensado_mmb), sum(t2.liquidos_planta_mmb), sum(t2.gas_seco_mmmpc)
FROM t1
FULL JOIN t2 ON t1.date = t2.date AND t1.block_id = t2.block_id
    AND t1.cuenca IS NOT DISTINCT FROM t2.cuenca AND t1.ubicacion IS NOT DISTINCT FROM t2.ubicacion
    AND t1.class_id >= t2.class_id
LEFT JOIN core.dim_contrato ct ON ct.asig_cont = upper(NULLIF(t1.block_id, '0'))
LEFT JOIN core.dim_geografia g ON g.cuenca = t1.cuenca AND g.ubicacion = t1.ubicacion
GROUP BY t1.date, t1.block_id, ct.contrato_id, g.geografia_id, t1.class_id;

-- ---------------------------------------------------------------------
-- PRODUCCION_CAMPOS_POZOS: dominio encontrado tarde (ver MIGRATION_STATUS.md,
-- get_pozos_operando en produccion_service.py) -- conteo de pozos operando
-- por campo. Replica dbo.produccion_campos_pozos: UNION de historico
-- (produccion_campos_pozos_a2016) + derivado de sih_produccion_d2016
-- (pozo_aceite si PETROLEO_MB>0 or GAS_ASOC_MMPC>0; pozo_gas si GAS_NASOC_MMPC>0).
-- ---------------------------------------------------------------------

INSERT INTO core.dim_geografia (cuenca, ubicacion)
SELECT DISTINCT cuenca, ubicacion FROM staging.stg_produccion_campos_pozos_a2016
WHERE cuenca IS NOT NULL AND ubicacion IS NOT NULL
ON CONFLICT (cuenca, ubicacion) DO NOTHING;

INSERT INTO core.dim_campo (campo_portal)
SELECT DISTINCT campo_portal FROM staging.stg_produccion_campos_pozos_a2016 WHERE campo_portal IS NOT NULL
ON CONFLICT (campo_portal) DO NOTHING;

TRUNCATE core.fact_produccion_campo_pozos;

-- Parte 1: historico directo
INSERT INTO core.fact_produccion_campo_pozos (fecha, campo_id, geografia_id, pozos_aceite, pozos_gas)
SELECT s.fecha, c.campo_id,
       (SELECT min(g2.geografia_id) FROM core.dim_geografia g2 WHERE g2.cuenca = s.cuenca AND g2.ubicacion = s.ubicacion),
       s.pozos_aceite, s.pozos_gas
FROM staging.stg_produccion_campos_pozos_a2016 s
LEFT JOIN core.dim_campo c ON c.campo_portal = s.campo_portal;

-- Parte 2: vigente, derivado de sih_produccion_d2016 via cat_campos_alias (campo_id=campo_alias)
-- GROUP BY incluye well_name ademas de well_id: la vista SQL Server original
-- agrupa por (FECHA,WELL_ID,WELL_NAME,...) -- hay filas con WELL_ID nulo pero
-- WELL_NAME distinto (confirmado en ETL real, ~120 nombres distintos bajo
-- well_id NULL solo en 2026-06); agrupar solo por well_id las colapsaba
-- todas en un pozo, restando ~1.5% del conteo total.
-- BUG (retomando investigacion de discrepancia de cuencas, hallazgo lateral
-- en filtros de perforacion_service.py "PozosCampos"): campo_portal aqui
-- usaba upper(a.campo_nombre) -- el nombre "bonito" CON acentos ("ÉBANO"),
-- pero core.dim_campo se poblo (arriba, INSERT desde
-- stg_produccion_campos_pozos_a2016) con el codigo SIN acentos ("EBANO",
-- igual que a.campo_alias). El LEFT JOIN de mas abajo (c.campo_portal =
-- flags.campo_portal) nunca calzaba para campos con acento en su nombre
-- (EBANO, TREVIÑO, POKCHE, BAKTE, ...) -- 13 campos completos desaparecian
-- de PRODUCCION_CAMPOS_POZOS/filtros. Corregido a campo_alias (mismo estilo
-- que la fuente historica).
WITH base AS (
    SELECT
        s.fecha, s.well_id, s.well_name,
        upper(a.campo_alias) AS campo_portal,
        s.cuenca, s.ubicacion,
        sum(s.petroleo_mb) petroleo_mb, sum(s.gas_asoc_mmpc) gas_asoc_mmpc, sum(s.gas_nasoc_mmpc) gas_nasoc_mmpc
    FROM staging.stg_sih_produccion_d2016 s
    LEFT JOIN staging.stg_cat_campos_alias a ON s.campo_id::text = a.campo_alias
    WHERE COALESCE(s.petroleo_mb,0) > 0 OR COALESCE(s.gas_asoc_mmpc,0) > 0 OR COALESCE(s.gas_nasoc_mmpc,0) > 0
    GROUP BY s.fecha, s.well_id, s.well_name, upper(a.campo_alias), s.cuenca, s.ubicacion
),
flags AS (
    SELECT fecha, campo_portal, cuenca, ubicacion,
           CASE WHEN petroleo_mb > 0 OR gas_asoc_mmpc > 0 THEN 1 ELSE 0 END AS pozo_aceite,
           CASE WHEN gas_nasoc_mmpc > 0 THEN 1 ELSE 0 END AS pozo_gas
    FROM base
)
INSERT INTO core.fact_produccion_campo_pozos (fecha, campo_id, geografia_id, pozos_aceite, pozos_gas)
SELECT
    fecha, c.campo_id,
    (SELECT min(g2.geografia_id) FROM core.dim_geografia g2 WHERE g2.cuenca = flags.cuenca AND g2.ubicacion = flags.ubicacion),
    sum(pozo_aceite), sum(pozo_gas)
FROM flags
LEFT JOIN core.dim_campo c ON c.campo_portal = flags.campo_portal
GROUP BY fecha, c.campo_id, flags.cuenca, flags.ubicacion;

-- Refrescar vistas materializadas dependientes (ninguna de estos dominios
-- por ahora, pero se deja el llamado explicito para consistencia del pipeline)
-- SELECT ops.refresh_api_materialized_views();
