-- Chiron APM — PostgreSQL Mirror Schema
-- Local cache of Snowflake data for sub-10ms query times.
-- Run: psql -U chiron -d chiron_apm -f pg_schema.sql

-- ============================================================================
-- Reference / Static Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS site_master (
    site_id             TEXT PRIMARY KEY,
    site_name           TEXT,
    size_kw_dc          NUMERIC,
    size_kw_ac          NUMERIC,
    primary_das         TEXT,
    inverter_count      INTEGER,
    pto_actual_date     DATE,
    fc_actual_date      DATE,
    timezone            TEXT,
    latitude            NUMERIC,
    longitude           NUMERIC,
    delivery_phase      TEXT,
    irradiance_type     TEXT,
    -- Store all remaining columns as JSONB so we never lose fields from SELECT *
    extra               JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_sm_pto ON site_master (pto_actual_date);
CREATE INDEX IF NOT EXISTS idx_sm_phase ON site_master (delivery_phase);

CREATE TABLE IF NOT EXISTS asset_registry (
    id                  SERIAL PRIMARY KEY,
    site_id             TEXT NOT NULL,
    equipment_id        TEXT,
    hardware_id         TEXT,
    equipment_code      TEXT,
    equipment_type      TEXT,
    das_name            TEXT,
    das                 TEXT,
    type_index          INTEGER,
    column_mapping      TEXT,
    capacity_kw         NUMERIC,
    capacity_dc_kw      NUMERIC,
    quantity            INTEGER,
    attributes          JSONB,
    parent_equipment_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_ar_site ON asset_registry (site_id);
CREATE INDEX IF NOT EXISTS idx_ar_das ON asset_registry (site_id, das);

CREATE TABLE IF NOT EXISTS forecast_data (
    site_id     TEXT NOT NULL,
    attribute   TEXT NOT NULL,
    month       INTEGER NOT NULL,
    value       NUMERIC,
    PRIMARY KEY (site_id, attribute, month)
);

CREATE TABLE IF NOT EXISTS te_operating (
    site_id             TEXT NOT NULL,
    record_date         DATE NOT NULL,
    revenue_total_ppa   NUMERIC,
    monthly_production  NUMERIC,
    extra               JSONB DEFAULT '{}',
    PRIMARY KEY (site_id, record_date)
);

-- ============================================================================
-- Time-Series Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS hourly_data_live (
    siteid                      TEXT NOT NULL,
    measurementtime             TIMESTAMPTZ NOT NULL,
    data_type                   TEXT DEFAULT 'current',
    -- Core production
    production                  NUMERIC,
    production_source           TEXT,
    meter_energy                NUMERIC,
    inv_total_energy            NUMERIC,
    -- Expected / KPIs
    expected_production         NUMERIC,
    wa_expected_production      NUMERIC,
    performance_ratio           NUMERIC,
    wa_performance_ratio        NUMERIC,
    -- Insolation
    insolation                  NUMERIC,
    insolation_source           TEXT,
    insolation_share            NUMERIC,
    insolation_gap              NUMERIC,
    insolation_poa              NUMERIC,
    insolation_ghi              NUMERIC,
    insolation_ghi_solcast      NUMERIC,
    -- Revenue
    revenue_rate                NUMERIC,
    revenue                     NUMERIC,
    variance_wa_revenue         NUMERIC,
    -- Availability
    availability_percentage     NUMERIC,
    inverters_producing         INTEGER,
    inverters_total             INTEGER,
    offline_inverter_count      INTEGER,
    outage_flag                 INTEGER,
    data_quality_flag           TEXT,
    variance_meter_inv          NUMERIC,
    stage                       TEXT,
    sitename                    TEXT,
    -- Inverter columns (up to 120)
    in1_value NUMERIC, in2_value NUMERIC, in3_value NUMERIC, in4_value NUMERIC,
    in5_value NUMERIC, in6_value NUMERIC, in7_value NUMERIC, in8_value NUMERIC,
    in9_value NUMERIC, in10_value NUMERIC, in11_value NUMERIC, in12_value NUMERIC,
    in13_value NUMERIC, in14_value NUMERIC, in15_value NUMERIC, in16_value NUMERIC,
    in17_value NUMERIC, in18_value NUMERIC, in19_value NUMERIC, in20_value NUMERIC,
    in21_value NUMERIC, in22_value NUMERIC, in23_value NUMERIC, in24_value NUMERIC,
    in25_value NUMERIC, in26_value NUMERIC, in27_value NUMERIC, in28_value NUMERIC,
    in29_value NUMERIC, in30_value NUMERIC, in31_value NUMERIC, in32_value NUMERIC,
    in33_value NUMERIC, in34_value NUMERIC, in35_value NUMERIC, in36_value NUMERIC,
    in37_value NUMERIC, in38_value NUMERIC, in39_value NUMERIC, in40_value NUMERIC,
    in41_value NUMERIC, in42_value NUMERIC, in43_value NUMERIC, in44_value NUMERIC,
    in45_value NUMERIC, in46_value NUMERIC, in47_value NUMERIC, in48_value NUMERIC,
    in49_value NUMERIC, in50_value NUMERIC, in51_value NUMERIC, in52_value NUMERIC,
    in53_value NUMERIC, in54_value NUMERIC, in55_value NUMERIC, in56_value NUMERIC,
    in57_value NUMERIC, in58_value NUMERIC, in59_value NUMERIC, in60_value NUMERIC,
    in61_value NUMERIC, in62_value NUMERIC, in63_value NUMERIC, in64_value NUMERIC,
    in65_value NUMERIC, in66_value NUMERIC, in67_value NUMERIC, in68_value NUMERIC,
    in69_value NUMERIC, in70_value NUMERIC, in71_value NUMERIC, in72_value NUMERIC,
    in73_value NUMERIC, in74_value NUMERIC, in75_value NUMERIC, in76_value NUMERIC,
    in77_value NUMERIC, in78_value NUMERIC, in79_value NUMERIC, in80_value NUMERIC,
    in81_value NUMERIC, in82_value NUMERIC, in83_value NUMERIC, in84_value NUMERIC,
    in85_value NUMERIC, in86_value NUMERIC, in87_value NUMERIC, in88_value NUMERIC,
    in89_value NUMERIC, in90_value NUMERIC, in91_value NUMERIC, in92_value NUMERIC,
    in93_value NUMERIC, in94_value NUMERIC, in95_value NUMERIC, in96_value NUMERIC,
    in97_value NUMERIC, in98_value NUMERIC, in99_value NUMERIC, in100_value NUMERIC,
    in101_value NUMERIC, in102_value NUMERIC, in103_value NUMERIC, in104_value NUMERIC,
    in105_value NUMERIC, in106_value NUMERIC, in107_value NUMERIC, in108_value NUMERIC,
    in109_value NUMERIC, in110_value NUMERIC, in111_value NUMERIC, in112_value NUMERIC,
    in113_value NUMERIC, in114_value NUMERIC, in115_value NUMERIC, in116_value NUMERIC,
    -- Meter columns
    m1_value NUMERIC, m2_value NUMERIC, m3_value NUMERIC, m4_value NUMERIC, m5_value NUMERIC,
    -- Overflow JSONB for any columns not explicitly defined
    extra JSONB DEFAULT '{}',
    PRIMARY KEY (siteid, measurementtime, data_type)
);
CREATE INDEX IF NOT EXISTS idx_hdl_time ON hourly_data_live (measurementtime DESC);
CREATE INDEX IF NOT EXISTS idx_hdl_site_time ON hourly_data_live (siteid, measurementtime DESC);

CREATE TABLE IF NOT EXISTS daily_data_live (
    siteid                      TEXT NOT NULL,
    measurementtime             DATE NOT NULL,
    data_type                   TEXT DEFAULT 'current',
    sitename                    TEXT,
    stage                       TEXT,
    -- Production
    production                  NUMERIC,
    production_source           TEXT,
    meter_energy                NUMERIC,
    inv_total_energy            NUMERIC,
    -- Expected
    expected_production         NUMERIC,
    expected_production_uw      NUMERIC,
    wa_expected_production      NUMERIC,
    wa_expected_production_uw   NUMERIC,
    -- Insolation
    insolation                  NUMERIC,
    insolation_source           TEXT,
    insolation_gap              NUMERIC,
    insolation_poa              NUMERIC,
    insolation_ghi              NUMERIC,
    insolation_poa_solcast      NUMERIC,
    insolation_ghi_solcast      NUMERIC,
    expected_insolation_poa     NUMERIC,
    expected_insolation_ghi     NUMERIC,
    -- Performance
    performance_ratio           NUMERIC,
    wa_performance_ratio        NUMERIC,
    performance_ratio_uw        NUMERIC,
    wa_performance_ratio_uw     NUMERIC,
    -- Revenue
    revenue_rate                NUMERIC,
    revenue                     NUMERIC,
    expected_revenue            NUMERIC,
    wa_expected_revenue         NUMERIC,
    variance_production         NUMERIC,
    variance_wa_production      NUMERIC,
    variance_revenue            NUMERIC,
    variance_wa_revenue         NUMERIC,
    -- Other
    availability_percentage     NUMERIC,
    loss_snow                   NUMERIC,
    variance_meter_inv          NUMERIC,
    ambient_temperature         NUMERIC,
    extra                       JSONB DEFAULT '{}',
    PRIMARY KEY (siteid, measurementtime, data_type)
);
CREATE INDEX IF NOT EXISTS idx_ddl_time ON daily_data_live (measurementtime DESC);
CREATE INDEX IF NOT EXISTS idx_ddl_site_time ON daily_data_live (siteid, measurementtime DESC);

CREATE TABLE IF NOT EXISTS chiron_alerts (
    alert_id                TEXT PRIMARY KEY,
    site_id                 TEXT NOT NULL,
    site_name               TEXT,
    alert_type              TEXT,
    alert_category          TEXT,
    equipment_type          TEXT,
    equipment_id            TEXT,
    equipment_name          TEXT,
    severity                TEXT,
    detected_at             TIMESTAMPTZ,
    duration_hours          NUMERIC,
    verification_status     TEXT,
    verified_at             TIMESTAMPTZ,
    status                  TEXT,
    resolved_at             TIMESTAMPTZ,
    check_count             INTEGER,
    created_at              TIMESTAMPTZ,
    extra                   JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_ca_site ON chiron_alerts (site_id);
CREATE INDEX IF NOT EXISTS idx_ca_status ON chiron_alerts (status);
CREATE INDEX IF NOT EXISTS idx_ca_detected ON chiron_alerts (detected_at DESC);

-- ============================================================================
-- Sync tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS _sync_log (
    id          SERIAL PRIMARY KEY,
    table_name  TEXT NOT NULL,
    synced_at   TIMESTAMPTZ DEFAULT NOW(),
    rows_synced INTEGER DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    status      TEXT DEFAULT 'ok',
    error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_sl_table ON _sync_log (table_name, synced_at DESC);
