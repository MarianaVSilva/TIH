-- =====================================================================
-- TIH — core schema: modelo dimensional (star schema), optimizado para
-- lectura analítica. Dimensiones con PK entera + índices; hechos
-- particionados por año con índices BRIN sobre fecha.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS core;

-- ---------------------------------------------------------------------
-- Tablas de mapeo / reglas de negocio explícitas (antes escondidas en
-- vistas SQL Server — ver 00_PLAN.md, sección de reglas preservadas)
-- ---------------------------------------------------------------------

CREATE TABLE core.map_ubicacion (
    ubicacion_origen TEXT PRIMARY KEY,   -- 'Terrestre', 'Aguas someras'
    ubicacion_norm   TEXT NOT NULL       -- 'TERRESTRE', 'MARINO'
);
INSERT INTO core.map_ubicacion VALUES ('Terrestre','TERRESTRE'), ('Aguas someras','MARINO')
ON CONFLICT DO NOTHING;

CREATE TABLE core.map_provincia_petrolera (
    petroleum_province   TEXT NOT NULL,
    geological_province  TEXT,            -- NULL = aplica a cualquier geological_province
    basin_resultante      TEXT NOT NULL,
    PRIMARY KEY (petroleum_province, geological_province)
);
-- Reglas encontradas duplicadas en entitlements.v_general_info y cmde_valid.dbo.bd_pozos —
-- se consolidan aquí UNA sola vez. Completar/confirmar con el equipo de datos antes de cargar producción.

CREATE TABLE core.map_block_id_historico (
    block_id_viejo   TEXT NOT NULL,
    block_id_nuevo   TEXT NOT NULL,
    vigente_desde    DATE NOT NULL,
    PRIMARY KEY (block_id_viejo, vigente_desde)
);
INSERT INTO core.map_block_id_historico VALUES
    ('A-0267','A-0060','2016-07-28'),
    ('A-0333','A-0288','2016-07-28'),
    ('AE-0004','AE-0006','2019-08-27'),
    ('AE-0027','AE-0158','2019-08-27'),
    ('AE-0051','AE-0006','2019-08-27'),
    ('AE-0053','AE-0045','2021-07-26')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- Dimensiones
-- ---------------------------------------------------------------------

CREATE TABLE core.dim_geografia (
    geografia_id  SERIAL PRIMARY KEY,
    cuenca        TEXT NOT NULL,
    ubicacion     TEXT NOT NULL,          -- ya normalizada (TERRESTRE/MARINO)
    UNIQUE (cuenca, ubicacion)
);

CREATE TABLE core.dim_campo (
    campo_id      SERIAL PRIMARY KEY,
    campo_portal  TEXT NOT NULL UNIQUE,
    geografia_id  INTEGER REFERENCES core.dim_geografia(geografia_id),
    region        TEXT,
    latitud       DOUBLE PRECISION,
    longitud      DOUBLE PRECISION
);
CREATE INDEX ix_dim_campo_geografia ON core.dim_campo (geografia_id);

CREATE TABLE core.dim_operador (
    operador_id   SERIAL PRIMARY KEY,
    nombre        TEXT NOT NULL UNIQUE
);

CREATE TABLE core.dim_contrato (
    contrato_id     SERIAL PRIMARY KEY,
    asig_cont       TEXT NOT NULL UNIQUE,   -- código de negocio (p.ej. 'A-0194')
    nombre          TEXT
);

CREATE TABLE core.dim_empresa (
    empresa_id            SERIAL PRIMARY KEY,
    id_contratista         BIGINT UNIQUE,   -- de cat_contratistas, cuando exista
    contratista            TEXT,
    contratista_corto       TEXT UNIQUE,
    id_grupo_corp            BIGINT
);

CREATE TABLE core.dim_entidad (
    cve_ent   BIGINT PRIMARY KEY,
    nom_ent   TEXT NOT NULL,
    cve_mun   BIGINT,
    nom_mun   TEXT
);

CREATE TABLE core.dim_pozo (
    pozo_id                 SERIAL PRIMARY KEY,
    well_id                 BIGINT NOT NULL UNIQUE,
    well_name               TEXT,
    uwi                      TEXT,
    categoria                TEXT,
    current_condition         TEXT,
    operador                  TEXT,
    drilling_start_date        DATE,
    depth_md                    NUMERIC,
    block_id_current             TEXT,
    ambiente                      TEXT,
    provincia_geologica            TEXT,
    provincia_petrolera             TEXT,
    basin                            TEXT,   -- resultado de core.map_provincia_petrolera
    es_valido                        BOOLEAN NOT NULL DEFAULT true  -- réplica del filtro cmde_valid.dbo.bd_pozos
);
CREATE INDEX ix_dim_pozo_block ON core.dim_pozo (block_id_current);
CREATE INDEX ix_dim_pozo_valido ON core.dim_pozo (es_valido);

CREATE TABLE core.dim_licitacion (
    licitacion_id  SERIAL PRIMARY KEY,
    ronda          TEXT,
    licitacion     TEXT NOT NULL,
    UNIQUE (ronda, licitacion)
);

CREATE TABLE core.dim_pais (
    pais_id  SERIAL PRIMARY KEY,
    nombre   TEXT NOT NULL UNIQUE
);

CREATE TABLE core.dim_bloque (
    bloque_id        SERIAL PRIMARY KEY,
    block_id          TEXT NOT NULL UNIQUE,
    block_name         TEXT,
    block_type          INTEGER,
    plan                 TEXT,   -- 'Exploración' | 'Extracción'
    validity               INTEGER,
    start_date               DATE,
    end_date                  DATE,
    -- Metadatos que hoy dependen del linked server externo UATAC_SISEAA
    -- (ver 00_PLAN.md). Nullable a propósito: se llenan cuando se resuelva
    -- el acceso; el resto del modelo no depende de estas dos columnas.
    region_siseaa              TEXT,
    fuente_region                TEXT DEFAULT NULL  -- 'siseaa_etl' | 'manual' | NULL
);

CREATE TABLE core.dim_tema (
    tema_id        SERIAL PRIMARY KEY,
    seccion        TEXT,
    tema           TEXT,
    json_arg       TEXT,
    init_year      INTEGER,
    end_year       INTEGER,
    periodicidad   TEXT,
    metodologia    TEXT,
    titulo         TEXT,
    downloadable   TEXT  -- ruta de archivo (p.ej. '/downloads/X.csv'), NO booleano -- confirmado en ETL real
);

-- ---------------------------------------------------------------------
-- Hechos — particionados por año (RANGE sobre fecha) en los dominios
-- grandes/crecientes. Cada partición lleva su propio índice BRIN.
-- ---------------------------------------------------------------------

-- PK incluye contrato_id: confirmado en ETL real que (fecha, campo, tipo) NO
-- es unico -- un mismo campo puede tener varios asig_cont/contrato distintos
-- en el mismo mes (p.ej. REMOLINO trae 6 en 2016-07), y ademas puede haber
-- filas repetidas dentro del MISMO (fecha,campo,tipo,contrato) con valores
-- distintos (mismo patron de sub-grano no capturado que en reservas) -- se
-- resuelven sumando en el ETL, ver 04_transform_staging_to_core.sql.
CREATE TABLE core.fact_produccion_campo (
    fecha            DATE NOT NULL,
    campo_id         INTEGER NOT NULL REFERENCES core.dim_campo(campo_id),
    contrato_id      INTEGER NOT NULL REFERENCES core.dim_contrato(contrato_id),
    operador_id      INTEGER REFERENCES core.dim_operador(operador_id),
    tipo             TEXT,             -- 'ASIGNACION' etc.
    dias_produccion  NUMERIC,
    petroleo_mbd     NUMERIC,
    petroleo_api     TEXT,             -- categorico en el origen (Ligero/Pesado/...), NO numerico -- confirmado en ETL real
    condensado_mbd   NUMERIC,
    gas_mmpcd        NUMERIC,
    gas_asoc_mmpcd   NUMERIC,
    gas_nasoc_mmpcd  NUMERIC,
    agua_mbd         NUMERIC,
    n2_mmpcd         NUMERIC,
    -- Composicion del gas (usadas por produccion_service.py:get_produccion_gcompo,
    -- encontradas faltantes al portar el backend -- estaban en staging pero
    -- nunca se cargaron a core).
    c1_mmpcd         NUMERIC,
    c2_mmpcd         NUMERIC,
    c3_mmpcd         NUMERIC,
    c4_mmpcd         NUMERIC,
    ic4_mmpcd        NUMERIC,
    c5_plus_mmpcd    NUMERIC,
    co2_mmpcd        NUMERIC,
    h2s_mmpcd        NUMERIC,
    h2o_mmpcd        NUMERIC,
    PRIMARY KEY (fecha, campo_id, tipo, contrato_id)
) PARTITION BY RANGE (fecha);

CREATE TABLE core.fact_produccion_pozo (
    fecha            DATE NOT NULL,
    pozo_id          INTEGER NOT NULL REFERENCES core.dim_pozo(pozo_id),
    contrato_id      INTEGER REFERENCES core.dim_contrato(contrato_id),
    geografia_id     INTEGER REFERENCES core.dim_geografia(geografia_id),
    petroleo_mbd     NUMERIC,
    condensado_mbd   NUMERIC,
    gas_mmpcd        NUMERIC,
    gas_asoc_mmpcd   NUMERIC,
    gas_nasoc_mmpcd  NUMERIC,
    agua_mbd         NUMERIC,
    PRIMARY KEY (fecha, pozo_id)
) PARTITION BY RANGE (fecha);

-- Conteo de pozos operando por campo (dominio encontrado tarde, ver
-- MIGRATION_STATUS.md -- get_pozos_operando en produccion_service.py).
CREATE TABLE core.fact_produccion_campo_pozos (
    fecha            DATE NOT NULL,
    campo_id         INTEGER REFERENCES core.dim_campo(campo_id),
    geografia_id     INTEGER REFERENCES core.dim_geografia(geografia_id),
    pozos_aceite     NUMERIC,
    pozos_gas        NUMERIC
);
CREATE INDEX ix_fpcp_fecha ON core.fact_produccion_campo_pozos USING brin (fecha);

CREATE TABLE core.fact_produccion_estado (
    fecha            DATE NOT NULL,
    cve_ent          BIGINT NOT NULL REFERENCES core.dim_entidad(cve_ent),
    ubicacion        TEXT,
    petroleo_mbd     NUMERIC,
    gas_mmpcd        NUMERIC,
    gas_asoc_mmpcd   NUMERIC,
    gas_nasoc_mmpcd  NUMERIC,
    condensado_mbd   NUMERIC,
    agua_mbd         NUMERIC,
    n2_mmpcd         NUMERIC,
    PRIMARY KEY (fecha, cve_ent, ubicacion)
) PARTITION BY RANGE (fecha);

-- FACTOR_MES/FACTOR_IP/FACTOR_O precalculados en el ETL (regla #3 de 00_PLAN.md) —
-- ya no se recalculan por fila en cada query como en dbo.produccion_operador_ip.
CREATE TABLE core.fact_produccion_operador (
    fecha            DATE NOT NULL,
    contrato_id      INTEGER NOT NULL REFERENCES core.dim_contrato(contrato_id),
    empresa_id       INTEGER REFERENCES core.dim_empresa(empresa_id),
    factor_o         SMALLINT NOT NULL DEFAULT 1,
    factor_ip        NUMERIC NOT NULL DEFAULT 1,
    factor_mes       NUMERIC NOT NULL DEFAULT 1,
    dias_produccion  NUMERIC,
    petroleo_mbd     NUMERIC,
    gas_mmpcd        NUMERIC,
    gas_asoc_mmpcd   NUMERIC,
    gas_nasoc_mmpcd  NUMERIC,
    condensado_mbd   NUMERIC,
    n2_mmpcd         NUMERIC,
    agua_mbd         NUMERIC,
    PRIMARY KEY (fecha, contrato_id, empresa_id)
) PARTITION BY RANGE (fecha);

CREATE TABLE core.fact_reservas_campo (
    fecha                    DATE NOT NULL,
    campo_id                 INTEGER NOT NULL REFERENCES core.dim_campo(campo_id),
    categoria                TEXT NOT NULL,   -- 'PROBADAS', '1P', etc.
    vo_aceite_mmb            NUMERIC,
    vo_gas_mmmpc             NUMERIC,
    rr_aceite_mmb            NUMERIC,
    rr_gas_mmmpc             NUMERIC,
    rr_condensado_mmb        NUMERIC,
    rr_liquidos_planta_mmb   NUMERIC,
    rr_pce_mmbpce            NUMERIC,
    rr_gas_seco_mmbpce       NUMERIC,
    rr_gas_seco_mmmpc        NUMERIC,
    PRIMARY KEY (fecha, campo_id, categoria)
);
CREATE INDEX ix_fact_reservas_campo_fecha ON core.fact_reservas_campo USING brin (fecha);

CREATE TABLE core.fact_reservas_asignacion (
    fecha                    DATE NOT NULL,
    contrato_id              INTEGER REFERENCES core.dim_contrato(contrato_id),  -- NULL permitido: BLOCK_ID puede ser 0/null en origen
    geografia_id             INTEGER REFERENCES core.dim_geografia(geografia_id),
    campo_id                 INTEGER REFERENCES core.dim_campo(campo_id),
    tipo                     TEXT NOT NULL,   -- '1P','2P','3P'
    rr_pce_mmbpce            NUMERIC,
    rr_aceite_mmb            NUMERIC,
    rr_gas_natural_mmmpc     NUMERIC,
    rr_condensado_mmb        NUMERIC,
    rr_liquidos_planta_mmb   NUMERIC,
    rr_gas_seco_mmmpc        NUMERIC
);
CREATE INDEX ix_fact_reservas_asig_fecha ON core.fact_reservas_asignacion USING brin (fecha);
CREATE INDEX ix_fact_reservas_asig_contrato ON core.fact_reservas_asignacion (contrato_id, fecha);

CREATE TABLE core.fact_inversiones (
    anio                 INTEGER NOT NULL,
    contrato_id          INTEGER REFERENCES core.dim_contrato(contrato_id),
    licitacion_id        INTEGER REFERENCES core.dim_licitacion(licitacion_id),
    ronda                TEXT,
    tipo_plan            TEXT,
    act_petrolera        TEXT,
    sub_act_petrolera    TEXT,
    tarea                TEXT,
    estado               TEXT,
    ubicacion            TEXT,
    cuenca               TEXT,
    modalidad            TEXT,
    capex_opex           TEXT,
    mes                  SMALLINT,
    monto_usd            NUMERIC NOT NULL,
    tipo                 TEXT,
    escenario            TEXT,
    vigente              BOOLEAN,
    reporte              BOOLEAN,
    fecha_og             DATE
) PARTITION BY RANGE (anio);
CREATE INDEX ix_fact_inversiones_contrato ON core.fact_inversiones (contrato_id, anio);

CREATE TABLE core.fact_precios (
    fecha       DATE PRIMARY KEY,
    brent       NUMERIC,
    wti         NUMERIC,
    mme         NUMERIC,
    henry_hub   NUMERIC,
    opec        NUMERIC,
    fuente      TEXT
);

-- Tabla gestionada por TIH (no viene de SQL Server) — se conserva igual, ya está bien diseñada.
CREATE TABLE core.fact_precios_autom (
    fecha            DATE NOT NULL,
    producto         VARCHAR(20) NOT NULL,
    valor            DECIMAL(10,4) NOT NULL,
    fuente           VARCHAR(50),
    actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (fecha, producto)
);

CREATE TABLE core.fact_pozos_comprometidos (
    contrato_id       INTEGER PRIMARY KEY REFERENCES core.dim_contrato(contrato_id),
    licitacion_id     INTEGER REFERENCES core.dim_licitacion(licitacion_id),
    area_contractual  TEXT,
    pmt_pozos         NUMERIC,
    pozos_planes      NUMERIC,
    terminados        INTEGER NOT NULL DEFAULT 0,
    en_perforacion    INTEGER NOT NULL DEFAULT 0,
    por_perforar      INTEGER NOT NULL DEFAULT 0,
    descubrimientos   TEXT,
    comentarios       TEXT
);

CREATE TABLE core.fact_licitaciones_ofertas (
    id                    BIGSERIAL PRIMARY KEY,
    licitacion_id         INTEGER REFERENCES core.dim_licitacion(licitacion_id),
    id_bloque             TEXT,
    empresa_id            INTEGER REFERENCES core.dim_empresa(empresa_id),
    pais_id               INTEGER REFERENCES core.dim_pais(pais_id),
    contrato_id           INTEGER REFERENCES core.dim_contrato(contrato_id),
    geografia_id          INTEGER REFERENCES core.dim_geografia(geografia_id),
    inv_usd               NUMERIC,
    bono                  NUMERIC,
    vpo                   NUMERIC,
    pozos_comprometidos   NUMERIC,
    area                  NUMERIC,
    validez               TEXT,
    entidad_principal     TEXT,
    -- OJO: en licitaciones_bloques_ofertas la columna "contrato" cruda es en
    -- realidad la MODALIDAD (Licencia/Produccion compartida); el
    -- identificador real del contrato es "contrato_nombre" -- confirmado al
    -- portar contratos_service.py. id_licitante/id_licitante_adj identifican
    -- la oferta GANADORA (id_licitante = id_licitante_adj).
    modalidad             TEXT,
    contrato_nombre       TEXT,
    id_licitante          BIGINT,
    id_licitante_adj      BIGINT
);
CREATE INDEX ix_fact_licitaciones_licitacion ON core.fact_licitaciones_ofertas (licitacion_id);
CREATE INDEX ix_fact_licitaciones_pais ON core.fact_licitaciones_ofertas (pais_id);

-- ---------------------------------------------------------------------
-- Particiones anuales (ejemplo 2015-2027; extender con un script/cron
-- de mantenimiento — pg_partman es buena opción para automatizar esto).
-- ---------------------------------------------------------------------
DO $$
DECLARE yr INT;
BEGIN
  FOR yr IN 2015..2027 LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS core.fact_produccion_campo_%s PARTITION OF core.fact_produccion_campo
         FOR VALUES FROM (%L) TO (%L)',
      yr, format('%s-01-01', yr), format('%s-01-01', yr + 1));
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS ix_fpc_%s_fecha ON core.fact_produccion_campo_%s USING brin (fecha)', yr, yr);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS ix_fpc_%s_campo ON core.fact_produccion_campo_%s (campo_id, fecha)', yr, yr);

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS core.fact_produccion_pozo_%s PARTITION OF core.fact_produccion_pozo
         FOR VALUES FROM (%L) TO (%L)',
      yr, format('%s-01-01', yr), format('%s-01-01', yr + 1));
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS ix_fpp_%s_fecha ON core.fact_produccion_pozo_%s USING brin (fecha)', yr, yr);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS ix_fpp_%s_pozo ON core.fact_produccion_pozo_%s (pozo_id, fecha)', yr, yr);

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS core.fact_produccion_estado_%s PARTITION OF core.fact_produccion_estado
         FOR VALUES FROM (%L) TO (%L)',
      yr, format('%s-01-01', yr), format('%s-01-01', yr + 1));
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS ix_fpe_%s_fecha ON core.fact_produccion_estado_%s USING brin (fecha)', yr, yr);

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS core.fact_produccion_operador_%s PARTITION OF core.fact_produccion_operador
         FOR VALUES FROM (%L) TO (%L)',
      yr, format('%s-01-01', yr), format('%s-01-01', yr + 1));
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS ix_fpo_%s_fecha ON core.fact_produccion_operador_%s USING brin (fecha)', yr, yr);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS ix_fpo_%s_contrato ON core.fact_produccion_operador_%s (contrato_id, fecha)', yr, yr);

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS core.fact_inversiones_%s PARTITION OF core.fact_inversiones
         FOR VALUES FROM (%s) TO (%s)', yr, yr, yr + 1);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS ix_fi_%s_contrato ON core.fact_inversiones_%s (contrato_id)', yr, yr);
  END LOOP;
END $$;

-- Particiones "catch-all" para fechas fuera de rango (evita errores de
-- inserción si aparece un dato con fecha inesperada; revisar periódicamente).
CREATE TABLE IF NOT EXISTS core.fact_produccion_campo_default PARTITION OF core.fact_produccion_campo DEFAULT;
CREATE TABLE IF NOT EXISTS core.fact_produccion_pozo_default PARTITION OF core.fact_produccion_pozo DEFAULT;
CREATE TABLE IF NOT EXISTS core.fact_produccion_estado_default PARTITION OF core.fact_produccion_estado DEFAULT;
CREATE TABLE IF NOT EXISTS core.fact_produccion_operador_default PARTITION OF core.fact_produccion_operador DEFAULT;
CREATE TABLE IF NOT EXISTS core.fact_inversiones_default PARTITION OF core.fact_inversiones DEFAULT;
