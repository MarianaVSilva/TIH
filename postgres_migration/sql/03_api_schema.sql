-- =====================================================================
-- TIH — api schema: la única superficie que debe tocar el backend de
-- FastAPI. Vistas simples sobre core (ya resuelto) + vistas materializadas
-- para los agregados costosos, refrescadas al final de cada ETL.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS api;

-- ---------------------------------------------------------------------
-- Vistas 1:1 sobre los hechos (reemplazan a las vistas SQL Server que
-- hoy recalculan JOIN/UNION en cada request — aquí ya está resuelto en core)
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW api.v_produccion_campos AS
SELECT
    f.fecha,
    c.campo_portal,
    g.cuenca,
    g.ubicacion,
    c.region,
    ct.asig_cont,
    o.nombre AS operador,
    f.tipo,
    f.dias_produccion,
    f.petroleo_mbd,
    f.petroleo_api,
    f.condensado_mbd,
    (f.petroleo_mbd + f.condensado_mbd) AS liquidos_mbd,
    f.gas_mmpcd, f.gas_asoc_mmpcd, f.gas_nasoc_mmpcd,
    f.agua_mbd, f.n2_mmpcd,
    f.c1_mmpcd, f.c2_mmpcd, f.c3_mmpcd, f.c4_mmpcd, f.ic4_mmpcd,
    f.c5_plus_mmpcd, f.co2_mmpcd, f.h2s_mmpcd, f.h2o_mmpcd
FROM core.fact_produccion_campo f
JOIN core.dim_campo c       ON c.campo_id = f.campo_id
LEFT JOIN core.dim_geografia g ON g.geografia_id = c.geografia_id
LEFT JOIN core.dim_contrato ct ON ct.contrato_id = f.contrato_id
LEFT JOIN core.dim_operador o  ON o.operador_id = f.operador_id;

-- Dominio encontrado tarde (ver MIGRATION_STATUS.md) -- conteo de pozos
-- operando por campo, usado por produccion_service.py:get_pozos_operando.
CREATE OR REPLACE VIEW api.v_produccion_campos_pozos AS
SELECT f.fecha, c.campo_portal, g.cuenca, g.ubicacion, f.pozos_aceite, f.pozos_gas
FROM core.fact_produccion_campo_pozos f
LEFT JOIN core.dim_campo c ON c.campo_id = f.campo_id
LEFT JOIN core.dim_geografia g ON g.geografia_id = f.geografia_id;

-- well_name en MAYUSCULAS: la vista SQL Server original hace UPPER(WELL_NAME)
-- para la rama vigente -- sin esto, pozos_service.py (que busca por nombre
-- exacto en el arbol de navegacion) no encontraba coincidencia.
CREATE OR REPLACE VIEW api.v_produccion_pozos AS
SELECT
    f.fecha,
    p.well_id, upper(p.well_name) AS well_name, p.uwi,
    g.cuenca,
    ct.asig_cont,
    f.petroleo_mbd, f.condensado_mbd,
    f.gas_mmpcd, f.gas_asoc_mmpcd, f.gas_nasoc_mmpcd,
    f.agua_mbd
FROM core.fact_produccion_pozo f
JOIN core.dim_pozo p ON p.pozo_id = f.pozo_id
LEFT JOIN core.dim_geografia g ON g.geografia_id = f.geografia_id
LEFT JOIN core.dim_contrato ct ON ct.contrato_id = f.contrato_id;

-- Metadatos de pozo (reemplaza el join manual a BD_POZOS en pozos_service.py)
-- expone las dos variantes que el backend usa hoy a propósito
-- (cruda vs. validada — ver "Discrepancia detectada" en DATABASE_DEPENDENCIES.md).
CREATE OR REPLACE VIEW api.v_pozos_meta AS
SELECT
    well_id, well_name, current_condition, operador,
    drilling_start_date, depth_md, categoria,
    block_id_current, ambiente, basin, es_valido
FROM core.dim_pozo;

CREATE OR REPLACE VIEW api.v_pozos_meta_validados AS
SELECT * FROM api.v_pozos_meta WHERE es_valido;

CREATE OR REPLACE VIEW api.v_produccion_estado AS
SELECT
    f.fecha, e.nom_ent, e.nom_mun, e.cve_mun, f.ubicacion,
    f.petroleo_mbd, f.gas_mmpcd, f.gas_asoc_mmpcd, f.gas_nasoc_mmpcd,
    f.condensado_mbd, f.agua_mbd, f.n2_mmpcd, e.cve_ent
FROM core.fact_produccion_estado f
JOIN core.dim_entidad e ON e.cve_ent = f.cve_ent;

CREATE OR REPLACE VIEW api.v_produccion_operador_ip AS
SELECT
    f.fecha, ct.asig_cont,
    COALESCE(em.contratista_corto, 'PEMEX EXPLORACIÓN Y PRODUCCIÓN') AS operador,
    f.factor_o, f.factor_ip, f.factor_mes, f.dias_produccion,
    f.petroleo_mbd, f.gas_mmpcd, f.gas_asoc_mmpcd, f.gas_nasoc_mmpcd,
    f.condensado_mbd, f.n2_mmpcd, f.agua_mbd
FROM core.fact_produccion_operador f
JOIN core.dim_contrato ct ON ct.contrato_id = f.contrato_id
LEFT JOIN core.dim_empresa em ON em.empresa_id = f.empresa_id;

CREATE OR REPLACE VIEW api.v_reservas_campos AS
SELECT
    r.fecha, g.cuenca, g.ubicacion, c.campo_portal, r.categoria,
    r.rr_aceite_mmb, r.rr_gas_mmmpc, r.rr_condensado_mmb, r.rr_liquidos_planta_mmb,
    r.vo_aceite_mmb, r.vo_gas_mmmpc, r.rr_pce_mmbpce, r.rr_gas_seco_mmbpce, r.rr_gas_seco_mmmpc
FROM core.fact_reservas_campo r
JOIN core.dim_campo c ON c.campo_id = r.campo_id
LEFT JOIN core.dim_geografia g ON g.geografia_id = c.geografia_id;

CREATE OR REPLACE VIEW api.v_reservas_asig_cont AS
SELECT
    r.fecha, ct.asig_cont AS asignacion_contrato, r.tipo,
    g.cuenca, g.ubicacion,
    r.rr_pce_mmbpce, r.rr_aceite_mmb, r.rr_gas_natural_mmmpc,
    r.rr_condensado_mmb, r.rr_liquidos_planta_mmb, r.rr_gas_seco_mmmpc
FROM core.fact_reservas_asignacion r
LEFT JOIN core.dim_contrato ct ON ct.contrato_id = r.contrato_id
LEFT JOIN core.dim_geografia g ON g.geografia_id = r.geografia_id;

CREATE OR REPLACE VIEW api.v_reservas_asig_cont_campos AS
SELECT
    r.fecha, g.ubicacion, g.cuenca, c.campo_portal AS campo,
    ct.asig_cont AS asignacion_contrato, b.block_name AS asignacion_contrato_nombre,
    r.tipo,
    r.rr_pce_mmbpce, r.rr_aceite_mmb, r.rr_gas_natural_mmmpc,
    r.rr_condensado_mmb, r.rr_liquidos_planta_mmb, r.rr_gas_seco_mmmpc
FROM core.fact_reservas_asignacion r
LEFT JOIN core.dim_contrato ct ON ct.contrato_id = r.contrato_id
LEFT JOIN core.dim_geografia g ON g.geografia_id = r.geografia_id
LEFT JOIN core.dim_campo c ON c.campo_id = r.campo_id
LEFT JOIN core.dim_bloque b ON b.block_id = ct.asig_cont;

CREATE OR REPLACE VIEW api.v_inversiones_aprobadas AS
SELECT
    i.anio, i.ronda, l.licitacion, ct.asig_cont AS contrato,
    i.act_petrolera, i.sub_act_petrolera, i.tarea, i.estado, i.ubicacion, i.cuenca, i.modalidad,
    i.tipo_plan, i.capex_opex, i.mes, i.monto_usd, i.tipo, i.escenario
FROM core.fact_inversiones i
LEFT JOIN core.dim_licitacion l ON l.licitacion_id = i.licitacion_id
LEFT JOIN core.dim_contrato ct ON ct.contrato_id = i.contrato_id
WHERE i.reporte AND i.vigente;

CREATE OR REPLACE VIEW api.v_precios AS
SELECT fecha, brent, wti, mme, henry_hub
FROM core.fact_precios
WHERE fecha <= (SELECT max(fecha) FROM core.fact_precios WHERE mme > 0);

CREATE OR REPLACE VIEW api.v_temas AS
SELECT tema_id, seccion, tema, json_arg, init_year, end_year, periodicidad, metodologia, titulo, downloadable
FROM core.dim_tema
WHERE json_arg <> '' AND json_arg NOT IN ('BalanceGas','InvAsig');

CREATE OR REPLACE VIEW api.v_pozos_comprometidos AS
SELECT
    ct.asig_cont AS contrato, l.ronda, l.licitacion, pc.area_contractual,
    pc.pmt_pozos, pc.pozos_planes, pc.terminados, pc.en_perforacion,
    pc.por_perforar, pc.descubrimientos, pc.comentarios
FROM core.fact_pozos_comprometidos pc
JOIN core.dim_contrato ct ON ct.contrato_id = pc.contrato_id
LEFT JOIN core.dim_licitacion l ON l.licitacion_id = pc.licitacion_id;

-- Columnas 1:1 con la tabla original cmde_public.dbo.licitaciones_bloques_ofertas
-- (incluida la ambiguedad "contrato"=modalidad, "contrato_nombre"=id real del
-- contrato -- ver nota en 02_core_schema.sql) para que el backend pueda
-- alias igual que hace hoy contra SQL Server, sin logica adicional aqui.
CREATE OR REPLACE VIEW api.v_licitaciones_ofertas AS
SELECT
    l.ronda, l.licitacion, o.id_bloque, em.contratista AS empresa, pa.nombre AS pais,
    o.inv_usd, o.bono, o.vpo, o.pozos_comprometidos, o.area, o.validez,
    o.modalidad AS contrato, o.contrato_nombre,
    g.ubicacion, g.cuenca, o.entidad_principal,
    o.id_licitante, o.id_licitante_adj
FROM core.fact_licitaciones_ofertas o
LEFT JOIN core.dim_licitacion l ON l.licitacion_id = o.licitacion_id
LEFT JOIN core.dim_empresa em   ON em.empresa_id = o.empresa_id
LEFT JOIN core.dim_pais pa      ON pa.pais_id = o.pais_id
LEFT JOIN core.dim_geografia g  ON g.geografia_id = o.geografia_id;

CREATE OR REPLACE VIEW api.v_bloques AS
SELECT block_id, block_name, block_type, plan, validity, start_date, end_date,
       region_siseaa, fuente_region
FROM core.dim_bloque;

-- ---------------------------------------------------------------------
-- Vistas materializadas para agregados costosos y repetidos (rankings,
-- totales por cuenca/año) — refrescar al final de cada corrida de ETL
-- vía `ops.refresh_api_materialized_views()`.
-- ---------------------------------------------------------------------

CREATE MATERIALIZED VIEW api.mv_produccion_campos_mensual AS
SELECT
    date_trunc('month', f.fecha)::date AS periodo,
    g.cuenca, g.ubicacion,
    sum(f.petroleo_mbd)   AS petroleo_mbd,
    sum(f.condensado_mbd) AS condensado_mbd,
    sum(f.gas_mmpcd)      AS gas_mmpcd,
    sum(f.agua_mbd)       AS agua_mbd
FROM core.fact_produccion_campo f
JOIN core.dim_campo c ON c.campo_id = f.campo_id
LEFT JOIN core.dim_geografia g ON g.geografia_id = c.geografia_id
GROUP BY 1, 2, 3
WITH NO DATA;
CREATE UNIQUE INDEX ux_mv_prod_campos_mensual ON api.mv_produccion_campos_mensual (periodo, cuenca, ubicacion);

CREATE MATERIALIZED VIEW api.mv_ranking_operadores_anual AS
SELECT
    date_trunc('year', f.fecha)::date AS anio,
    COALESCE(em.contratista_corto, 'PEMEX EXPLORACIÓN Y PRODUCCIÓN') AS operador,
    sum(f.petroleo_mbd * f.factor_o) AS petroleo_mbd,
    sum(f.gas_mmpcd * f.factor_o)    AS gas_mmpcd
FROM core.fact_produccion_operador f
LEFT JOIN core.dim_empresa em ON em.empresa_id = f.empresa_id
GROUP BY 1, 2
WITH NO DATA;
CREATE UNIQUE INDEX ux_mv_ranking_operadores ON api.mv_ranking_operadores_anual (anio, operador);

CREATE OR REPLACE FUNCTION ops.refresh_api_materialized_views() RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY api.mv_produccion_campos_mensual;
    REFRESH MATERIALIZED VIEW CONCURRENTLY api.mv_ranking_operadores_anual;
END;
$$ LANGUAGE plpgsql;

-- Nota: api.v_precios queda con un placeholder — portar la lógica real de
-- precios_service.py (fusión PRECIOS + PRECIOS_AUTOM, extremos por rango
-- seleccionado) como parte del trabajo de aplicación, no de esquema.

-- ---------------------------------------------------------------------
-- perforacion_service.py: dbo.perforacion_pozos_perf/term/equipos, las 3
-- definidas enteramente sobre cmde_valid.dbo.bd_pozos (staging.stg_bd_pozos_valid,
-- tabla staging nueva -- distinta de stg_bd_pozos/cruda ya usada para dim_pozo,
-- ver 01_staging_schema.sql). Se implementan como vistas simples (sin fact
-- table dedicada): la fuente es chica (34,477 filas) y el calculo es
-- agregacion directa, replicando linea a linea OBJECT_DEFINITION de cada
-- vista SQL Server real.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW api.v_perforacion_pozos_perf AS
SELECT
    date_trunc('month', drilling_finish_date)::date AS fecha,
    petroleum_province AS cuenca,
    CASE
        WHEN upper(type) IN ('DELIMITADOR', 'EXPLORATORIO') THEN 'EXPLORACION'
        WHEN upper(type) = 'INYECTOR' THEN 'DESARROLLO'
        ELSE type
    END AS categoria_pozo,
    environment AS ubicacion,
    operator AS operador,
    count(well_name) AS pozos_perforados
FROM staging.stg_bd_pozos_valid
WHERE drilling_finish_date IS NOT NULL
  AND year >= 1960
  AND petroleum_province IS NOT NULL
  AND type IS NOT NULL
  AND (EXTRACT(YEAR FROM drilling_finish_date) < EXTRACT(YEAR FROM CURRENT_DATE)
       OR EXTRACT(QUARTER FROM drilling_finish_date) < EXTRACT(QUARTER FROM CURRENT_DATE))
GROUP BY 1, 2, 3, 4, 5;

CREATE OR REPLACE VIEW api.v_perforacion_pozos_term AS
SELECT
    date_trunc('month', completion_finish_date)::date AS fecha,
    petroleum_province AS cuenca,
    CASE
        WHEN upper(type) IN ('DELIMITADOR', 'EXPLORATORIO') THEN 'Exploración'
        WHEN upper(type) = 'INYECTOR' THEN 'Desarrollo'
        ELSE type
    END AS categoria_pozo,
    environment AS ubicacion,
    operator AS operador,
    count(well_name) AS pozos_terminados
FROM staging.stg_bd_pozos_valid
WHERE completion_finish_date IS NOT NULL
  AND upper(status) = 'CONCLUIDO'  -- SQL Server compara case-insensitive por defecto; el origen trae 'Concluido' mixto
  AND year >= 1960
  AND petroleum_province IS NOT NULL
  AND type IS NOT NULL
  AND (EXTRACT(YEAR FROM completion_finish_date) < EXTRACT(YEAR FROM CURRENT_DATE)
       OR EXTRACT(QUARTER FROM completion_finish_date) < EXTRACT(QUARTER FROM CURRENT_DATE))
GROUP BY 1, 2, 3, 4, 5;

-- Prorrateo diario de equipos activos por mes -- replica linea a linea la
-- vista SQL Server (calendario de fechas de PRODUCCION_CAMPOS, LEFT JOIN
-- contra el rango [DRILLING_START_DATE, FECHA_PERFORACION_FIN] de cada pozo
-- con un factor de dias del mes cubiertos por ese rango).
CREATE OR REPLACE VIEW api.v_perforacion_equipos AS
WITH fechas AS (
    SELECT DISTINCT fecha FROM core.fact_produccion_campo
    WHERE fecha >= '2000-01-01' AND fecha <= (SELECT max(fecha) FROM core.fact_produccion_campo)
),
pozos_0 AS (
    SELECT
        petroleum_province AS cuenca,
        CASE
            WHEN upper(type) IN ('DELIMITADOR', 'EXPLORATORIO') THEN 'Exploración'
            WHEN upper(type) IN ('INYECTOR', 'DESARROLLO') THEN 'Desarrollo'
            ELSE type
        END AS categoria_pozo,
        environment AS ubicacion,
        operator AS operador,
        rig_name AS equipo_perforacion,
        well_id,
        well_name AS pozo,
        drilling_start_date AS fecha_perforacion_inicio,
        CASE
            WHEN drilling_finish_date IS NULL AND completion_start_date IS NULL AND completion_finish_date IS NULL
                THEN CURRENT_DATE
            ELSE drilling_finish_date
        END AS fecha_perforacion_fin_raw
    FROM staging.stg_bd_pozos_valid
),
pozos_1 AS (
    SELECT
        cuenca, categoria_pozo, ubicacion, operador, equipo_perforacion, well_id, pozo,
        fecha_perforacion_inicio,
        CASE
            WHEN fecha_perforacion_fin_raw > (fecha_perforacion_inicio + INTERVAL '1 year')
                THEN (fecha_perforacion_inicio + INTERVAL '1 year')::date
            ELSE fecha_perforacion_fin_raw
        END AS fecha_perforacion_fin
    FROM pozos_0
),
pozos AS (
    SELECT
        *,
        date_trunc('month', fecha_perforacion_inicio)::date AS periodo_inicio,
        date_trunc('month', fecha_perforacion_fin)::date AS periodo_fin
    FROM pozos_1
    WHERE cuenca IS NOT NULL
      AND fecha_perforacion_inicio < fecha_perforacion_fin
),
factores AS (
    SELECT
        fechas.fecha,
        pozos.cuenca, pozos.categoria_pozo, pozos.ubicacion, pozos.operador,
        CASE
            WHEN pozos.pozo IS NULL THEN 0
            WHEN fechas.fecha = pozos.periodo_inicio AND fechas.fecha = pozos.periodo_fin THEN
                (EXTRACT(DAY FROM pozos.fecha_perforacion_fin) - EXTRACT(DAY FROM pozos.fecha_perforacion_inicio) + 1)
                / EXTRACT(DAY FROM (date_trunc('month', fechas.fecha) + INTERVAL '1 month' - INTERVAL '1 day'))
            WHEN fechas.fecha = pozos.periodo_inicio AND fechas.fecha <> pozos.periodo_fin THEN
                1 - (EXTRACT(DAY FROM pozos.fecha_perforacion_inicio) - 1)
                / EXTRACT(DAY FROM (date_trunc('month', fechas.fecha) + INTERVAL '1 month' - INTERVAL '1 day'))
            WHEN fechas.fecha <> pozos.periodo_inicio AND fechas.fecha = pozos.periodo_fin THEN
                EXTRACT(DAY FROM pozos.fecha_perforacion_fin)
                / EXTRACT(DAY FROM (date_trunc('month', fechas.fecha) + INTERVAL '1 month' - INTERVAL '1 day'))
            ELSE 1
        END AS factor
    FROM fechas
    LEFT JOIN pozos ON pozos.periodo_inicio <= fechas.fecha AND fechas.fecha <= pozos.periodo_fin
)
SELECT fecha, cuenca, categoria_pozo, ubicacion, operador, sum(factor) AS prom_eq_perforacion
FROM factores
WHERE EXTRACT(YEAR FROM fecha) < EXTRACT(YEAR FROM CURRENT_DATE)
   OR EXTRACT(QUARTER FROM fecha) < EXTRACT(QUARTER FROM CURRENT_DATE)
GROUP BY fecha, cuenca, categoria_pozo, ubicacion, operador;

-- get_perforacion_pozos_detalle (desglose por nombre de pozo) consulta
-- cmde_valid.dbo.bd_pozos directamente en SQL Server -- se expone un
-- passthrough delgado de staging.stg_bd_pozos_valid en vez de que el backend
-- toque staging directamente (mismo criterio de capas que el resto de api.*).
CREATE OR REPLACE VIEW api.v_bd_pozos_valid AS
SELECT well_id, well_name, type, status, year,
       drilling_start_date, drilling_finish_date,
       completion_start_date, completion_finish_date,
       operator, environment, petroleum_province, rig_name
FROM staging.stg_bd_pozos_valid;
