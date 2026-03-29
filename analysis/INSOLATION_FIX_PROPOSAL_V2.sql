-- =============================================================================
-- INSOLATION SELECTION LOGIC FIX - V2 (Physics-Validated Thresholds)
-- =============================================================================
-- Based on analysis of 49,230 site-days (90 days, 547 sites)
--
-- Key findings:
--   - 75.5% of site-days have dead onsite sensors (reading < 100 Wh/m²)
--   - 13.0% have WA PR > 120% (bad insolation selection)
--   - Current ratio bounds too wide; physics analysis shows:
--       - Ratio < 0.2: Only 5-7% have good WA PR (sensor dead)
--       - Ratio 0.9-1.5: 60-68% have good WA PR (use onsite)
--       - Ratio > 2.0: Only 40-46% have good WA PR (sensor error)
--   - POA/Satellite median ratio: 1.02, 98th percentile: 2.04
--
-- Validated thresholds (use satellite when):
--   - ONSITE < 100 Wh/m²
--   - ONSITE/SATELLITE < 0.2
--   - ONSITE/SATELLITE > 2.0
--
-- Expected improvement:
--   - WA PR > 120% reduced from 13.0% to 5.9% (55% reduction)
--   - WA PR < 50% reduced from 31.5% to 16.4% (48% reduction)
-- =============================================================================


-- =============================================================================
-- STEP 1: Create the improved insolation selection logic as a CTE
-- =============================================================================

WITH insolation_validation AS (
    SELECT
        d.*,
        sm.IRRADIANCE_TYPE,
        sm.ADDRESS_STATE,

        -- Thresholds (physics-validated from 90-day analysis)
        100 as MIN_THRESHOLD,      -- Minimum valid insolation (Wh/m²/day) - below is sensor noise
        0.2 as RATIO_MIN,          -- Minimum onsite/satellite ratio (below: only 5-7% good WA PR)
        2.0 as RATIO_MAX,          -- Maximum onsite/satellite ratio (98th percentile: 2.04)
        0.20 as EXPECTED_MIN_PCT,  -- Minimum % of expected
        1.50 as EXPECTED_MAX_PCT,  -- Maximum % of expected
        1.15 as POA_ADJUSTMENT,    -- POA estimation from GHI (~15% tilt gain)

        -- Determine preferred onsite based on IRRADIANCE_TYPE (1=GHI, 2=POA)
        CASE
            WHEN COALESCE(sm.IRRADIANCE_TYPE, 2) = 2 THEN d.INSOLATION_POA
            ELSE d.INSOLATION_GHI
        END as PRIMARY_ONSITE,

        CASE
            WHEN COALESCE(sm.IRRADIANCE_TYPE, 2) = 2 THEN d.EXPECTED_INSOLATION_POA
            ELSE d.EXPECTED_INSOLATION_GHI
        END as PRIMARY_EXPECTED,

        CASE
            WHEN COALESCE(sm.IRRADIANCE_TYPE, 2) = 2 THEN d.INSOLATION_GHI
            ELSE d.INSOLATION_POA
        END as SECONDARY_ONSITE,

        CASE
            WHEN COALESCE(sm.IRRADIANCE_TYPE, 2) = 2 THEN d.EXPECTED_INSOLATION_GHI
            ELSE d.EXPECTED_INSOLATION_POA
        END as SECONDARY_EXPECTED

    FROM MEI_ASSET_MGMT_DB.PERFORMANCE.DAILY_DATA_BASE d
    JOIN MEI_ASSET_MGMT_DB.PUBLIC.SITE_MASTER sm ON d.SITEID = sm.SITE_ID
),

-- =============================================================================
-- STEP 2: Validate each insolation source
-- =============================================================================

insolation_flags AS (
    SELECT
        *,

        -- Validate PRIMARY onsite
        CASE
            -- Below minimum threshold
            WHEN COALESCE(PRIMARY_ONSITE, 0) < MIN_THRESHOLD THEN FALSE
            -- Below minimum % of expected
            WHEN PRIMARY_EXPECTED > 0
                 AND PRIMARY_ONSITE / NULLIF(PRIMARY_EXPECTED, 0) < EXPECTED_MIN_PCT THEN FALSE
            -- Above maximum % of expected
            WHEN PRIMARY_EXPECTED > 0
                 AND PRIMARY_ONSITE / NULLIF(PRIMARY_EXPECTED, 0) > EXPECTED_MAX_PCT THEN FALSE
            -- Satellite cross-validation (if satellite available)
            WHEN INSOLATION_GHI_SOLCAST > MIN_THRESHOLD
                 AND (PRIMARY_ONSITE / NULLIF(INSOLATION_GHI_SOLCAST, 0) < RATIO_MIN
                      OR PRIMARY_ONSITE / NULLIF(INSOLATION_GHI_SOLCAST, 0) > RATIO_MAX) THEN FALSE
            ELSE TRUE
        END as PRIMARY_VALID,

        -- Validate SECONDARY onsite (fallback)
        CASE
            WHEN COALESCE(SECONDARY_ONSITE, 0) < MIN_THRESHOLD THEN FALSE
            WHEN SECONDARY_EXPECTED > 0
                 AND SECONDARY_ONSITE / NULLIF(SECONDARY_EXPECTED, 0) < EXPECTED_MIN_PCT THEN FALSE
            WHEN SECONDARY_EXPECTED > 0
                 AND SECONDARY_ONSITE / NULLIF(SECONDARY_EXPECTED, 0) > EXPECTED_MAX_PCT THEN FALSE
            WHEN INSOLATION_GHI_SOLCAST > MIN_THRESHOLD
                 AND (SECONDARY_ONSITE / NULLIF(INSOLATION_GHI_SOLCAST, 0) < RATIO_MIN
                      OR SECONDARY_ONSITE / NULLIF(INSOLATION_GHI_SOLCAST, 0) > RATIO_MAX) THEN FALSE
            ELSE TRUE
        END as SECONDARY_VALID,

        -- Satellite valid check
        CASE
            WHEN COALESCE(INSOLATION_GHI_SOLCAST, 0) >= MIN_THRESHOLD THEN TRUE
            ELSE FALSE
        END as SATELLITE_VALID,

        -- Onsite/Satellite ratio for diagnostics
        CASE
            WHEN INSOLATION_GHI_SOLCAST > MIN_THRESHOLD AND PRIMARY_ONSITE > 0
            THEN PRIMARY_ONSITE / NULLIF(INSOLATION_GHI_SOLCAST, 0)
            ELSE NULL
        END as ONSITE_SATELLITE_RATIO

    FROM insolation_validation
),

-- =============================================================================
-- STEP 3: Select best insolation with smart fallback
-- =============================================================================

insolation_selection AS (
    SELECT
        *,

        -- SMART_INSOLATION: Best available insolation value
        CASE
            -- Priority 1: Valid primary onsite
            WHEN PRIMARY_VALID THEN PRIMARY_ONSITE

            -- Priority 2: Valid secondary onsite (fallback type)
            WHEN SECONDARY_VALID THEN SECONDARY_ONSITE

            -- Priority 3: Satellite with POA adjustment if needed
            WHEN SATELLITE_VALID AND COALESCE(IRRADIANCE_TYPE, 2) = 2
            THEN INSOLATION_GHI_SOLCAST * POA_ADJUSTMENT  -- Adjust GHI to POA estimate

            WHEN SATELLITE_VALID
            THEN INSOLATION_GHI_SOLCAST

            -- Priority 4: No valid data - use primary onsite anyway (flagged)
            ELSE COALESCE(PRIMARY_ONSITE, INSOLATION_GHI_SOLCAST, 0)
        END as SMART_INSOLATION,

        -- SMART_INSOLATION_SOURCE: Track which source was used
        CASE
            WHEN PRIMARY_VALID AND COALESCE(IRRADIANCE_TYPE, 2) = 2 THEN 'POA'
            WHEN PRIMARY_VALID THEN 'GHI'
            WHEN SECONDARY_VALID AND COALESCE(IRRADIANCE_TYPE, 2) = 2 THEN 'GHI_FALLBACK'
            WHEN SECONDARY_VALID THEN 'POA_FALLBACK'
            WHEN SATELLITE_VALID AND COALESCE(IRRADIANCE_TYPE, 2) = 2 THEN 'SATELLITE_POA_EST'
            WHEN SATELLITE_VALID THEN 'SATELLITE_GHI'
            ELSE 'NONE'
        END as SMART_INSOLATION_SOURCE,

        -- INSOLATION_QUALITY_FLAG: Data quality indicator
        CASE
            WHEN PRIMARY_VALID THEN 'GOOD'
            WHEN SECONDARY_VALID THEN 'FALLBACK_USED'
            WHEN SATELLITE_VALID THEN 'SATELLITE_ONLY'
            ELSE 'NO_VALID_DATA'
        END as INSOLATION_QUALITY_FLAG,

        -- INSOLATION_VALID: Boolean for filtering
        CASE
            WHEN PRIMARY_VALID OR SECONDARY_VALID OR SATELLITE_VALID THEN TRUE
            ELSE FALSE
        END as INSOLATION_VALID

    FROM insolation_flags
),

-- =============================================================================
-- STEP 4: Recompute WA metrics with smart insolation
-- =============================================================================

final_data AS (
    SELECT
        s.*,

        -- Smart insolation gap
        CASE
            WHEN s.PRIMARY_EXPECTED > 0
            THEN (s.SMART_INSOLATION / s.PRIMARY_EXPECTED) - 1
            ELSE NULL
        END as SMART_INSOLATION_GAP,

        -- Smart WA Expected Production
        CASE
            WHEN s.PRIMARY_EXPECTED > 0 AND s.EXPECTED_PRODUCTION > 0
            THEN s.EXPECTED_PRODUCTION * (1 + ((s.SMART_INSOLATION / s.PRIMARY_EXPECTED) - 1))
            ELSE s.EXPECTED_PRODUCTION
        END as SMART_WA_EXPECTED,

        -- Smart WA Performance Ratio (unbounded for diagnostics)
        CASE
            WHEN s.PRIMARY_EXPECTED > 0 AND s.EXPECTED_PRODUCTION > 0 AND s.PRODUCTION > 0
            THEN s.PRODUCTION / NULLIF(
                s.EXPECTED_PRODUCTION * (1 + ((s.SMART_INSOLATION / s.PRIMARY_EXPECTED) - 1)), 0)
            ELSE NULL
        END as SMART_WA_PR,

        -- Smart WA Performance Ratio (bounded 0.1-1.5 for statistics)
        CASE
            WHEN s.PRIMARY_EXPECTED > 0 AND s.EXPECTED_PRODUCTION > 0 AND s.PRODUCTION > 0
            THEN LEAST(GREATEST(
                s.PRODUCTION / NULLIF(
                    s.EXPECTED_PRODUCTION * (1 + ((s.SMART_INSOLATION / s.PRIMARY_EXPECTED) - 1)), 0),
                0.1), 1.5)
            ELSE NULL
        END as SMART_WA_PR_BOUNDED

    FROM insolation_selection s
)

SELECT * FROM final_data;


-- =============================================================================
-- ALTERNATIVE: Simplified view modification
-- =============================================================================
-- If modifying the existing DAILY_DATA_LIVE view, add these computed columns:

/*
CREATE OR REPLACE VIEW MEI_ASSET_MGMT_DB.PERFORMANCE.DAILY_DATA_LIVE_V2 AS
SELECT
    d.*,

    -- Validation flags (physics-validated thresholds)
    CASE
        WHEN COALESCE(d.INSOLATION_POA, 0) < 100 THEN FALSE  -- Below noise threshold
        WHEN d.EXPECTED_INSOLATION_POA > 0
             AND d.INSOLATION_POA / NULLIF(d.EXPECTED_INSOLATION_POA, 0) < 0.20 THEN FALSE
        WHEN d.INSOLATION_GHI_SOLCAST > 100
             AND (d.INSOLATION_POA / NULLIF(d.INSOLATION_GHI_SOLCAST, 0) < 0.2  -- Only 5-7% good WA PR below
                  OR d.INSOLATION_POA / NULLIF(d.INSOLATION_GHI_SOLCAST, 0) > 2.0) THEN FALSE  -- 98th percentile
        ELSE TRUE
    END as POA_VALID,

    CASE
        WHEN COALESCE(d.INSOLATION_GHI, 0) < 100 THEN FALSE  -- Below noise threshold
        WHEN d.EXPECTED_INSOLATION_GHI > 0
             AND d.INSOLATION_GHI / NULLIF(d.EXPECTED_INSOLATION_GHI, 0) < 0.20 THEN FALSE
        WHEN d.INSOLATION_GHI_SOLCAST > 100
             AND (d.INSOLATION_GHI / NULLIF(d.INSOLATION_GHI_SOLCAST, 0) < 0.2  -- Only 5-7% good WA PR below
                  OR d.INSOLATION_GHI / NULLIF(d.INSOLATION_GHI_SOLCAST, 0) > 2.0) THEN FALSE  -- 98th percentile
        ELSE TRUE
    END as GHI_VALID,

    -- Smart insolation selection
    CASE
        WHEN sm.IRRADIANCE_TYPE = 2 AND POA_VALID THEN d.INSOLATION_POA
        WHEN sm.IRRADIANCE_TYPE = 1 AND GHI_VALID THEN d.INSOLATION_GHI
        WHEN sm.IRRADIANCE_TYPE = 2 AND GHI_VALID THEN d.INSOLATION_GHI  -- Fallback
        WHEN sm.IRRADIANCE_TYPE = 1 AND POA_VALID THEN d.INSOLATION_POA  -- Fallback
        WHEN d.INSOLATION_GHI_SOLCAST >= 100 AND sm.IRRADIANCE_TYPE = 2
             THEN d.INSOLATION_GHI_SOLCAST * 1.15  -- Satellite with POA adjustment
        WHEN d.INSOLATION_GHI_SOLCAST >= 100
             THEN d.INSOLATION_GHI_SOLCAST  -- Satellite direct
        ELSE COALESCE(d.INSOLATION_POA, d.INSOLATION_GHI, d.INSOLATION_GHI_SOLCAST, 0)
    END as SMART_INSOLATION,

    -- Quality flag
    CASE
        WHEN (sm.IRRADIANCE_TYPE = 2 AND POA_VALID) OR (sm.IRRADIANCE_TYPE = 1 AND GHI_VALID)
             THEN 'GOOD'
        WHEN POA_VALID OR GHI_VALID THEN 'FALLBACK'
        WHEN d.INSOLATION_GHI_SOLCAST >= 100 THEN 'SATELLITE'
        ELSE 'INVALID'
    END as INSOLATION_QUALITY

FROM MEI_ASSET_MGMT_DB.PERFORMANCE.DAILY_DATA_BASE d
JOIN MEI_ASSET_MGMT_DB.PUBLIC.SITE_MASTER sm ON d.SITEID = sm.SITE_ID
WHERE d.DATA_TYPE = 'current';
*/


-- =============================================================================
-- VALIDATION QUERY: Compare old vs new logic
-- =============================================================================

/*
-- Run this to compare impact before deploying

SELECT
    SMART_INSOLATION_SOURCE,
    COUNT(*) as COUNT,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as PCT,
    AVG(SMART_WA_PR) as AVG_WA_PR,
    SUM(CASE WHEN SMART_WA_PR > 1.2 THEN 1 ELSE 0 END) as HIGH_WA_PR_COUNT,
    SUM(CASE WHEN SMART_WA_PR < 0.5 THEN 1 ELSE 0 END) as LOW_WA_PR_COUNT
FROM final_data
WHERE DATA_TYPE = 'current'
  AND MEASUREMENTTIME >= DATEADD(day, -90, CURRENT_DATE())
  AND STAGE = 'Post-FC'
GROUP BY SMART_INSOLATION_SOURCE
ORDER BY COUNT DESC;
*/


-- =============================================================================
-- PROBLEM SITES QUERY: Identify sites needing sensor maintenance
-- =============================================================================

/*
SELECT
    SITEID,
    MAX(SITENAME) as SITENAME,
    MAX(ADDRESS_STATE) as STATE,
    COUNT(*) as DAYS,
    SUM(CASE WHEN NOT PRIMARY_VALID AND NOT SECONDARY_VALID THEN 1 ELSE 0 END) as DAYS_ONSITE_INVALID,
    ROUND(SUM(CASE WHEN NOT PRIMARY_VALID AND NOT SECONDARY_VALID THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as PCT_INVALID,
    SUM(CASE WHEN SMART_WA_PR > 1.2 THEN 1 ELSE 0 END) as DAYS_HIGH_WA_PR,
    AVG(ONSITE_SATELLITE_RATIO) as AVG_RATIO,
    CASE
        WHEN SUM(CASE WHEN NOT PRIMARY_VALID AND NOT SECONDARY_VALID THEN 1 ELSE 0 END) * 100.0 / COUNT(*) > 50
             THEN 'CHECK_SENSOR_CONNECTION'
        WHEN SUM(CASE WHEN NOT PRIMARY_VALID AND NOT SECONDARY_VALID THEN 1 ELSE 0 END) * 100.0 / COUNT(*) > 20
             THEN 'INTERMITTENT_SENSOR'
        WHEN AVG(ONSITE_SATELLITE_RATIO) < 0.5 THEN 'SENSOR_LOW_OUTPUT'
        WHEN AVG(ONSITE_SATELLITE_RATIO) > 2.0 THEN 'SENSOR_HIGH_OUTPUT'
        WHEN SUM(CASE WHEN SMART_WA_PR > 1.2 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) > 30
             THEN 'USE_SATELLITE_DATA'
        ELSE 'MONITOR'
    END as RECOMMENDATION
FROM final_data
WHERE DATA_TYPE = 'current'
  AND MEASUREMENTTIME >= DATEADD(day, -90, CURRENT_DATE())
  AND STAGE = 'Post-FC'
GROUP BY SITEID
HAVING SUM(CASE WHEN NOT PRIMARY_VALID AND NOT SECONDARY_VALID THEN 1 ELSE 0 END) * 100.0 / COUNT(*) > 20
    OR SUM(CASE WHEN SMART_WA_PR > 1.2 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) > 15
    OR AVG(ONSITE_SATELLITE_RATIO) < 0.5
    OR AVG(ONSITE_SATELLITE_RATIO) > 2.0
ORDER BY PCT_INVALID DESC;
*/
