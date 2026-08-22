-- =====================================================================
-- TIH — staging schema: espejo 1:1 de las tablas base reales de SQL Server
-- (identificadas en DATABASE_DEPENDENCIES.md). Sin transformar, sin PK/FK
-- de negocio — solo tipos + metadatos de carga. El ETL trunca/reinserta
-- (full refresh) o hace upsert incremental por load_batch_id.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS staging;
CREATE SCHEMA IF NOT EXISTS ops;

-- Metadatos de carga: reemplaza a dbo.cache_meta con historial real.
CREATE TABLE IF NOT EXISTS ops.etl_log (
    id              BIGSERIAL PRIMARY KEY,
    tabla_staging   TEXT NOT NULL,
    fuente          TEXT NOT NULL,           -- p.ej. 'cmde_raw.dbo.sih_produccion_d2016'
    filas_leidas    BIGINT,
    filas_cargadas  BIGINT,
    iniciado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    terminado_en    TIMESTAMPTZ,
    estado          TEXT NOT NULL DEFAULT 'RUNNING', -- RUNNING | OK | ERROR
    error_detalle   TEXT
);
CREATE INDEX IF NOT EXISTS ix_etl_log_tabla_fecha ON ops.etl_log (tabla_staging, iniciado_en DESC);

-- Columnas de auditoría comunes a toda tabla de staging.
--   _load_batch_id  → agrupa una corrida de ETL (FK lógica a ops.etl_log.id)
--   _loaded_at      → cuándo se insertó esta fila en Postgres

-- ---------------------------------------------------------------------
-- Producción diaria (cmde_valid.dbo.sih_produccion_d2016) — 933k+ filas,
-- la más grande y la que más domina el costo del ETL.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staging.stg_sih_produccion_d2016 (
    fecha               DATE,
    well_id             BIGINT,
    well_name           TEXT,
    campo_id            TEXT,
    ent_id              BIGINT,
    cuenca              TEXT,
    ubicacion           TEXT,
    dias_mes            NUMERIC,
    petroleo_mb         NUMERIC,
    condensado_mb       NUMERIC,
    gas_mmpc            NUMERIC,
    gas_asoc_mmpc       NUMERIC,
    gas_nasoc_mmpc      NUMERIC,
    agua_mb             NUMERIC,
    n2_perc_asig        NUMERIC,
    asig_cont           TEXT,
    block_id            TEXT,
    -- resto de columnas (44 en total en origen): agregar según
    -- INFORMATION_SCHEMA.COLUMNS real al momento de escribir el ETL.
    _load_batch_id      BIGINT,
    _loaded_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Histórico ≤2016 de producción por campo (cmde_valid.dbo.produccion_campos_a2016)
CREATE TABLE IF NOT EXISTS staging.stg_produccion_campos_a2016 (
    campo_portal        TEXT,
    cuenca               TEXT,
    dias_produccion      NUMERIC,
    fecha                DATE,
    tipo                 TEXT,
    asig_cont            TEXT,
    latitud              TEXT,
    longitud             TEXT,
    ubicacion            TEXT,
    region               TEXT,
    operador             TEXT,
    petroleo_mbd         NUMERIC,
    petroleo_api         TEXT,
    petroleo_s           TEXT,
    gas_asoc_mmpcd       NUMERIC,
    gas_nasoc_mmpcd      NUMERIC,
    gas_mmpcd            NUMERIC,
    gas_mmbtud           NUMERIC,
    co2_mmpcd            NUMERIC,
    c1_mmpcd             NUMERIC,
    c2_mmpcd             NUMERIC,
    c3_mmpcd             NUMERIC,
    c4_mmpcd             NUMERIC,
    c5_plus_mmpcd        NUMERIC,
    h2o_mmpcd            NUMERIC,
    h2s_mmpcd            NUMERIC,
    ic4_mmpcd            NUMERIC,
    n2_mmpcd             NUMERIC,
    condensado_mbd       NUMERIC,
    id                   INTEGER,
    _load_batch_id       BIGINT,
    _loaded_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Producción vigente (>2016) por campo (cmde_valid.dbo.vm_produccion_campos_d2016)
-- Mismas columnas que produccion_campos_a2016 más agua_mbd (existe en esta, NULL en la a2016 histórica).
CREATE TABLE IF NOT EXISTS staging.stg_vm_produccion_campos_d2016 (
    LIKE staging.stg_produccion_campos_a2016 INCLUDING ALL
);
ALTER TABLE staging.stg_vm_produccion_campos_d2016 ADD COLUMN IF NOT EXISTS agua_mbd NUMERIC;
ALTER TABLE staging.stg_vm_produccion_campos_d2016 ADD COLUMN IF NOT EXISTS id_operador INTEGER;

-- Catálogo campo_alias → campo_portal (cmde_valid.dbo.cat_campos_alias)
CREATE TABLE IF NOT EXISTS staging.stg_cat_campos_alias (
    campo_alias   TEXT,
    id_campo      TEXT,
    campo_nombre  TEXT,
    _load_batch_id BIGINT,
    _loaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conteo histórico de pozos por campo ≤2016 (cmde_valid.dbo.produccion_campos_pozos_a2016)
CREATE TABLE IF NOT EXISTS staging.stg_produccion_campos_pozos_a2016 (
    fecha         DATE,
    campo_portal  TEXT,
    cuenca        TEXT,
    pozos_aceite  NUMERIC,
    pozos_gas     NUMERIC,
    ubicacion     TEXT,
    _load_batch_id BIGINT,
    _loaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Catálogo de entidades federativas (cmde_valid.dbo.cat_entidades)
CREATE TABLE IF NOT EXISTS staging.stg_cat_entidades (
    ent_id   BIGINT,
    ent_nom  TEXT,
    _load_batch_id BIGINT,
    _loaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Histórico producción por estado ≤2016 (cmde_valid.dbo.produccion_estado_a2016)
CREATE TABLE IF NOT EXISTS staging.stg_produccion_estado_a2016 (
    fecha           DATE,
    nom_ent         TEXT,
    nom_mun         TEXT,
    cve_mun         BIGINT,
    ubicacion       TEXT,
    petroleo_mbd    NUMERIC,
    gas_mmpcd       NUMERIC,
    gas_asoc_mmpcd  NUMERIC,
    gas_nasoc_mmpcd NUMERIC,
    condensado_mbd  NUMERIC,
    agua_mbd        NUMERIC,
    cve_ent         BIGINT,
    _load_batch_id  BIGINT,
    _loaded_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Catálogo maestro de pozos, fuente cruda (cmde_raw.dbo.bd_pozos, 69 columnas en origen).
-- Se listan las columnas que el backend usa hoy; ampliar 1:1 con el origen al escribir el ETL.
CREATE TABLE IF NOT EXISTS staging.stg_bd_pozos (
    well_id                 BIGINT,
    borehole_id             BIGINT,
    well_name               TEXT,
    type                    TEXT,
    result                  TEXT,
    current_condition       TEXT,
    status                  TEXT,
    drilling_start_date     DATE,
    drilling_finish_date    DATE,
    completion_start_date   DATE,
    completion_finish_date  DATE,
    block_id_current        TEXT,
    operator                TEXT,
    alternate_well          INTEGER,
    sidetrack               INTEGER,
    environment             TEXT,
    geological_province     TEXT,
    petroleum_province      TEXT,
    field                   TEXT,
    state                   TEXT,
    municipality             TEXT,
    depth_md                NUMERIC,
    category                TEXT,
    update_date              DATE,
    _load_batch_id          BIGINT,
    _loaded_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Catalogo de pozos, fuente VALIDADA (cmde_valid.dbo.bd_pozos -- distinta de
-- cmde_raw.dbo.bd_pozos arriba: 34,477 filas vs 34,850, discrepancia raw/valid
-- ya documentada en DATABASE_DEPENDENCIES.md). Necesaria para perforacion_service.py
-- (dbo.perforacion_pozos_perf/term/equipos, todas definidas sobre esta version
-- "valid" -- YEAR y RIG_NAME no existen en la version raw ya staged).
CREATE TABLE IF NOT EXISTS staging.stg_bd_pozos_valid (
    well_id                 BIGINT,
    well_name               TEXT,
    type                    TEXT,
    status                  TEXT,
    year                    INTEGER,
    drilling_start_date     DATE,
    drilling_finish_date    DATE,
    completion_start_date   DATE,
    completion_finish_date  DATE,
    operator                TEXT,
    environment             TEXT,
    petroleum_province      TEXT,
    rig_name                TEXT,
    _load_batch_id          BIGINT,
    _loaded_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Producción por pozo vigente (cmde_valid.dbo.produccion_pozos)
CREATE TABLE IF NOT EXISTS staging.stg_produccion_pozos_valid (
    fecha            DATE,
    wid              BIGINT,
    uwi              TEXT,
    well_id          BIGINT,
    well_name        TEXT,
    cuenca           TEXT,
    block_id         TEXT,
    asig_cont        TEXT,
    gas_mmpcd        NUMERIC,
    gas_asoc_mmpcd   NUMERIC,
    gas_nasoc_mmpcd  NUMERIC,
    condensado_mbd   NUMERIC,
    petroleo_mbd     NUMERIC,
    agua_mbd         NUMERIC,
    _load_batch_id   BIGINT,
    _loaded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reservas — tabla cruda por campo (cmde_raw.dbo.sih_reservas_c)
CREATE TABLE IF NOT EXISTS staging.stg_sih_reservas_c (
    date                    DATE,
    field_id                TEXT,
    class_desc              TEXT,
    vo_aceite_mmb           NUMERIC,
    vo_gas_mmmpc            NUMERIC,
    pce_mmbpce              NUMERIC,
    aceite_mmb              NUMERIC,
    gas_mmmpc               NUMERIC,
    condensado_mmb          NUMERIC,
    liquidos_planta_mmb     NUMERIC,
    gas_seco_mmbpce         NUMERIC,
    gas_seco_mmmpc          NUMERIC,
    _load_batch_id          BIGINT,
    _loaded_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reservas — tabla cruda por bloque/asignación (cmde_raw.dbo.sih_reservas)
CREATE TABLE IF NOT EXISTS staging.stg_sih_reservas (
    date                 DATE,
    block_id             TEXT,
    field_id             TEXT,
    class_id             INTEGER,
    class_desc           TEXT,
    note                 TEXT,
    pce_mmbpce           NUMERIC,
    aceite_mmb           NUMERIC,
    gas_mmmpc            NUMERIC,
    condensado_mmb       NUMERIC,
    liquidos_planta_mmb  NUMERIC,
    gas_seco_mmbpce      NUMERIC,
    gas_seco_mmmpc       NUMERIC,
    gas_venta_mmmpc      NUMERIC,
    vo_aceite_mmb        NUMERIC,
    vo_gas_mmmpc         NUMERIC,
    _load_batch_id       BIGINT,
    _loaded_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Catálogo geográfico de campos (cmde_raw.dbo.campos_loc)
CREATE TABLE IF NOT EXISTS staging.stg_campos_loc (
    id_campo       TEXT,
    campo          TEXT,
    campo_nombre   TEXT,
    cuenca         TEXT,
    cuenca_bloque  TEXT,
    ubicacion      TEXT,
    latitud        TEXT,
    longitud       TEXT,
    _load_batch_id BIGINT,
    _loaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Inversiones aprobadas, tabla base real (cmde_raw.dbo.inversiones_aprobadas, 449,776 filas)
CREATE TABLE IF NOT EXISTS staging.stg_inversiones_aprobadas (
    id                     TEXT,
    block_id               TEXT,
    campo                  TEXT,
    asg_cont               TEXT,
    modalidad              TEXT,
    ronda                  TEXT,
    licitacion             TEXT,
    contrato               TEXT,
    contratista            TEXT,
    cuenca                 TEXT,
    estado                 TEXT,
    tipo_plan              TEXT,
    tipo_aprob             TEXT,
    capex_opex             TEXT,
    id_act_petrolera       TEXT,
    act_petrolera          TEXT,
    id_sub_act_petrolera   TEXT,
    sub_act_petrolera      TEXT,
    id_tarea               TEXT,
    tarea                  TEXT,
    id_sub_tarea            TEXT,
    anio                   NUMERIC,
    mes                    TEXT,
    mes_ref                TEXT,
    monto_usd              NUMERIC,
    tipo                   TEXT,
    contenido              TEXT,
    escenario               TEXT,
    vigente                 TEXT,
    fecha_og                DATE,
    anio_contractual         NUMERIC,
    anio_presentacion        NUMERIC,
    fuente                   TEXT,
    mod                      TEXT,
    reporte                  TEXT,
    ubicacion                TEXT,
    update_date              DATE,
    data_date                DATE,
    cnh_user                 TEXT,
    _load_batch_id           BIGINT,
    _loaded_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Precios, tabla base real (cmde_raw.dbo.precios)
CREATE TABLE IF NOT EXISTS staging.stg_precios (
    fecha       DATE,
    brent       NUMERIC,
    wti         NUMERIC,
    mme         NUMERIC,
    henry_hub   NUMERIC,
    opec        NUMERIC,
    insertado   TIMESTAMP,
    fuentes     TEXT,
    intradia    INTEGER,
    _load_batch_id BIGINT,
    _loaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bloques/asignaciones, tabla base real (cmde_raw.dbo.general_info)
CREATE TABLE IF NOT EXISTS staging.stg_general_info (
    block_id             TEXT,
    block_type           INTEGER,
    block_subtype        TEXT,
    validity              INTEGER,
    block_activity        TEXT,
    modifications          INTEGER,
    block_name             TEXT,
    validity_period         INTEGER,
    start_date              DATE,
    end_date                DATE,
    effective_date           DATE,
    environment              TEXT,
    petroleum_province        TEXT,
    geological_province        TEXT,
    entity                     TEXT,
    polygon_name                TEXT,
    depth                       TEXT,
    area_km2                     NUMERIC,
    area_count                    INTEGER,
    update_date                    DATE,
    _load_batch_id                BIGINT,
    _loaded_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Catálogo normalizado de empresas/contratistas (cmde_valid.dbo.*, el único
-- rincón del origen con PK/FK reales) — 5 tablas, chicas, full refresh siempre.
CREATE TABLE IF NOT EXISTS staging.stg_cat_contratistas (
    id_contratista BIGINT, contratista TEXT,
    _load_batch_id BIGINT, _loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staging.stg_cat_contratistascorto (
    id_contratista_corto BIGINT, contratista_corto TEXT,
    _load_batch_id BIGINT, _loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staging.stg_empresas_contratistas_historico (
    contrato TEXT, id_contrato BIGINT, id_contratista BIGINT, id_tipo_part INTEGER,
    interes_part NUMERIC, vpe NUMERIC, modificacion INTEGER,
    vig_inicio DATE, vig_fin DATE, contrato_vig TEXT, last_update TIMESTAMP,
    _load_batch_id BIGINT, _loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staging.stg_empresas_contratistascorto_licitantes (
    id_contratista_corto BIGINT, id_licitante BIGINT,
    _load_batch_id BIGINT, _loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staging.stg_empresas_gruposcorp_composicion (
    id_contratista BIGINT, id_contratista_corto BIGINT, id_grupo_corp BIGINT, vpe_part NUMERIC,
    _load_batch_id BIGINT, _loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Subsistema de licitaciones/rondas (schema rdmx, tablas base directas)
CREATE TABLE IF NOT EXISTS staging.stg_t01a_infogral (
    contrato TEXT, contratista TEXT, ronda TEXT, licitacion TEXT,
    ac TEXT, ac_nombre TEXT, f_firmacontr DATE, modalidad TEXT, ubicacion TEXT,
    superficie NUMERIC, licitante TEXT,
    _load_batch_id BIGINT, _loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staging.stg_t12_pozos (
    contrato TEXT, pozo TEXT, estatus TEXT,
    f_inicio_perfora DATE, f_termino_perfora DATE,
    f_inicio_terminacion DATE, f_termino_terminacion DATE,
    resultado TEXT, hidrocarburo TEXT,
    _load_batch_id BIGINT, _loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staging.stg_t21a_pozoscomprometidos (
    contrato TEXT, pmteapozos TEXT, pozosplanes TEXT, descubrimientos TEXT, comentarios TEXT,
    _load_batch_id BIGINT, _loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ofertas de licitación (cmde_public.dbo.licitaciones_bloques_ofertas, tabla real)
CREATE TABLE IF NOT EXISTS staging.stg_licitaciones_bloques_ofertas (
    ronda TEXT, licitacion TEXT, var_adj1 NUMERIC, var_adj2 NUMERIC, vpo NUMERIC, bono NUMERIC,
    id_licitante BIGINT, id_bloque TEXT, id_empresa BIGINT, id_licitante_adj NUMERIC,
    empresa TEXT, pais TEXT, inv_usd NUMERIC, area NUMERIC, validez TEXT, licitante TEXT,
    contrato TEXT, pozos_comprometidos NUMERIC, ubicacion TEXT, contrato_nombre TEXT,
    entidad_principal TEXT, cuenca TEXT,
    _load_batch_id BIGINT, _loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Menú de temas del frontend (cmde_public.dbo.CUBOS, tabla real — se migra tal cual)
CREATE TABLE IF NOT EXISTS staging.stg_cubos (
    seccion TEXT, tema TEXT, json_arg TEXT, init_year BIGINT, metodologia TEXT,
    titulo TEXT, periodicidad TEXT, end_year NUMERIC, downloadable TEXT,
    _load_batch_id BIGINT, _loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Producción por pozo histórica <=2016 (cmde_valid.dbo.PRODUCCION_POZOS_A2016)
-- Descubierta al construir el ETL real (no estaba en la auditoría inicial,
-- ver DATABASE_DEPENDENCIES.md). 2,776,502 filas en origen.
CREATE TABLE IF NOT EXISTS staging.stg_produccion_pozos_a2016 (
    fecha                 DATE,
    uwi                   TEXT,
    well_id               BIGINT,
    well_name             TEXT,
    cuenca                TEXT,
    block_id              TEXT,
    asignacion_contrato   TEXT,
    gas_mmpcd             NUMERIC,
    gas_asoc_mmpcd        NUMERIC,
    gas_nasoc_mmpcd       NUMERIC,
    condensado_mbd        NUMERIC,
    petroleo_mbd          NUMERIC,
    agua_mbd              NUMERIC,
    _load_batch_id        BIGINT,
    _loaded_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabla de enlace nombre de pozo -> WID/WELL_ID (cmde_raw.dbo.sih_well_name_link_p_inf6016)
CREATE TABLE IF NOT EXISTS staging.stg_sih_well_name_link (
    nombre_pozo   TEXT,
    well_name     TEXT,
    well_id       BIGINT,
    wid           BIGINT,
    _load_batch_id BIGINT,
    _loaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nombres de bloque para producción por pozo vigente (cmde_valid.dbo.ENTITLEMENTS_GENERAL_INFO)
-- Nota: distinta de cmde_public.entitlements.v_general_info (esa depende del
-- linked server SISEAA); esta es una tabla base propia de cmde_valid.
CREATE TABLE IF NOT EXISTS staging.stg_entitlements_general_info (
    block_id    TEXT,
    block_name  TEXT,
    _load_batch_id BIGINT,
    _loaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Metadatos de bloque SISEAA (linked server externo — ver 00_PLAN.md,
-- "Plan para el linked server"). Se deja preparada para Opción A/B; si se
-- usa Opción C (fallback manual) esta tabla se llena a mano, no por ETL.
CREATE TABLE IF NOT EXISTS staging.stg_integral_asignaciones_total (
    id_asignacion   TEXT,
    region_nuevo    TEXT,
    -- ampliar con columnas reales una vez que se resuelva el acceso a
    -- UATAC_SISEAA.CnhSISEAA.dbo.INTEGRAL_ASIGNACIONES_TOTAL
    _load_batch_id  BIGINT,
    _loaded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    _fuente_carga   TEXT DEFAULT 'manual' -- 'etl' cuando se resuelva Opción A/B
);
