-- =============================================================================
-- HOURLY INSOLATION SELECTION LOGIC FIX
-- =============================================================================
-- Based on analysis of 394,387 hourly records (30 days, 547 sites)
--
-- KEY FINDINGS:
--   - Satellite coverage is GOOD: 87% of daytime hours, 97.8% of site-days
--   - Onsite coverage is POOR: only 20% of hours have valid onsite data
--   - 77.8% of site-days have ZERO hours of valid onsite data (dead sensors)
--   - When both available, ratio stats align with daily: median 0.90, P5-P95: 0.30-2.24
--   - Daily aggregation smooths hourly noise: std drops from 0.55 to ~0.15
--
-- RECOMMENDED APPROACH: DAY-LEVEL SOURCE SELECTION
--   1. Aggregate hourly insolation to daily totals
--   2. Validate using daily thresholds (same as DAILY_DATA_LIVE)
--   3. Apply source decision to ALL hours of that day
--   4. Benefits: Consistent source per day, robust to hourly noise
-- =============================================================================


-- =============================================================================
-- STEP 1: Compute daily aggregates from hourly data
-- =============================================================================

WITH hourly_with_meta AS (
    SELECT
        h.*,
        sm.IRRADIANCE_TYPE,
        DATE(h.MEASUREMENTTIME) as DATA_DATE,
        HOUR(h.MEASUREMENTTIME) as HOUR_OF_DAY,

        -- Preferred onsite based on site configuration
        CASE
            WHEN COALESCE(sm.IRRADIANCE_TYPE, 2) = 2 THEN h.INSOLATION_POA
            ELSE h.INSOLATION_GHI
        END as PREF_ONSITE,

        -- Preferred satellite (use POA if site is POA-configured)
        CASE
            WHEN COALESCE(sm.IRRADIANCE_TYPE, 2) = 2 THEN h.INSOLATION_POA_SOLCAST
            ELSE h.INSOLATION_GHI_SOLCAST
        END as PREF_SATELLITE

    FROM MEI_ASSET_MGMT_DB.PERFORMANCE.HOURLY_DATA h
    JOIN MEI_ASSET_MGMT_DB.PUBLIC.SITE_MASTER sm ON h.SITEID = sm.SITE_ID
    WHERE h.DATA_TYPE = 'current'
),

-- Sum daytime hours (7 AM - 6 PM) to get daily totals
daily_aggregates AS (
    SELECT
        SITEID,
        DATA_DATE,
        MAX(IRRADIANCE_TYPE) as IRRADIANCE_TYPE,

        -- Sum of daytime hours (7 AM - 6 PM = 11 hours)
        SUM(CASE WHEN HOUR_OF_DAY >= 7 AND HOUR_OF_DAY < 18 THEN PREF_ONSITE ELSE 0 END) as DAILY_ONSITE,
        SUM(CASE WHEN HOUR_OF_DAY >= 7 AND HOUR_OF_DAY < 18 THEN PREF_SATELLITE ELSE 0 END) as DAILY_SATELLITE,

        -- Count valid hours for quality assessment
        SUM(CASE WHEN HOUR_OF_DAY >= 7 AND HOUR_OF_DAY < 18
                 AND PREF_ONSITE > 50 THEN 1 ELSE 0 END) as ONSITE_VALID_HOURS,
        SUM(CASE WHEN HOUR_OF_DAY >= 7 AND HOUR_OF_DAY < 18
                 AND PREF_SATELLITE > 50 THEN 1 ELSE 0 END) as SATELLITE_VALID_HOURS,

        COUNT(CASE WHEN HOUR_OF_DAY >= 7 AND HOUR_OF_DAY < 18 THEN 1 END) as TOTAL_DAYTIME_HOURS

    FROM hourly_with_meta
    GROUP BY SITEID, DATA_DATE
),


-- =============================================================================
-- STEP 2: Validate daily aggregates and determine source
-- =============================================================================

daily_source_decision AS (
    SELECT
        *,

        -- Daily ratio (onsite / satellite)
        CASE
            WHEN DAILY_SATELLITE > 500 THEN DAILY_ONSITE / DAILY_SATELLITE
            ELSE NULL
        END as DAILY_RATIO,

        -- Thresholds (aligned with DAILY_DATA_LIVE)
        100 as MIN_THRESHOLD,      -- Minimum daily insolation (Wh/m²)
        0.2 as RATIO_MIN,          -- Minimum onsite/satellite ratio
        2.0 as RATIO_MAX,          -- Maximum onsite/satellite ratio
        1.15 as POA_ADJUSTMENT,    -- POA estimation from GHI

        -- Source decision logic
        CASE
            -- Priority 1: Valid onsite (passes all checks)
            WHEN DAILY_ONSITE >= 100  -- Above noise threshold
                 AND DAILY_SATELLITE > 500  -- Have satellite to validate
                 AND (DAILY_ONSITE / NULLIF(DAILY_SATELLITE, 0)) >= 0.2
                 AND (DAILY_ONSITE / NULLIF(DAILY_SATELLITE, 0)) <= 2.0
            THEN 'ONSITE_VALIDATED'

            -- Priority 2: Satellite fallback (onsite invalid or missing)
            WHEN DAILY_SATELLITE >= 100
            THEN 'SATELLITE_FALLBACK'

            -- Priority 3: Use onsite anyway if no satellite (flag as unvalidated)
            WHEN DAILY_ONSITE >= 100
            THEN 'ONSITE_UNVALIDATED'

            -- No valid data
            ELSE 'NO_DATA'
        END as DAY_SOURCE_DECISION,

        -- Quality flag
        CASE
            WHEN ONSITE_VALID_HOURS >= 6 AND SATELLITE_VALID_HOURS >= 6 THEN 'FULL_COVERAGE'
            WHEN ONSITE_VALID_HOURS >= 3 OR SATELLITE_VALID_HOURS >= 6 THEN 'PARTIAL_COVERAGE'
            WHEN SATELLITE_VALID_HOURS >= 3 THEN 'SATELLITE_ONLY'
            ELSE 'POOR_COVERAGE'
        END as COVERAGE_QUALITY

    FROM daily_aggregates
),


-- =============================================================================
-- STEP 3: Join back to hourly and apply day-level source decision
-- =============================================================================

hourly_with_source AS (
    SELECT
        h.*,
        d.DAY_SOURCE_DECISION,
        d.COVERAGE_QUALITY,
        d.DAILY_RATIO,
        d.DAILY_ONSITE,
        d.DAILY_SATELLITE,

        -- Apply day-level source to hourly
        CASE
            -- Validated onsite: use onsite for all hours
            WHEN d.DAY_SOURCE_DECISION = 'ONSITE_VALIDATED'
            THEN h.PREF_ONSITE

            -- Satellite fallback: use satellite for all hours
            -- Apply POA adjustment if site is POA-configured
            WHEN d.DAY_SOURCE_DECISION = 'SATELLITE_FALLBACK'
                 AND COALESCE(h.IRRADIANCE_TYPE, 2) = 2  -- POA site
            THEN h.PREF_SATELLITE * 1.15  -- Adjust GHI to POA estimate

            WHEN d.DAY_SOURCE_DECISION = 'SATELLITE_FALLBACK'
            THEN h.PREF_SATELLITE

            -- Unvalidated onsite: use anyway but flag
            WHEN d.DAY_SOURCE_DECISION = 'ONSITE_UNVALIDATED'
            THEN h.PREF_ONSITE

            -- No data
            ELSE NULL
        END as SMART_INSOLATION,

        -- Source tracking
        CASE
            WHEN d.DAY_SOURCE_DECISION = 'ONSITE_VALIDATED'
                 AND COALESCE(h.IRRADIANCE_TYPE, 2) = 2
            THEN 'POA_VALIDATED'
            WHEN d.DAY_SOURCE_DECISION = 'ONSITE_VALIDATED'
            THEN 'GHI_VALIDATED'
            WHEN d.DAY_SOURCE_DECISION = 'SATELLITE_FALLBACK'
                 AND COALESCE(h.IRRADIANCE_TYPE, 2) = 2
            THEN 'SATELLITE_POA_EST'
            WHEN d.DAY_SOURCE_DECISION = 'SATELLITE_FALLBACK'
            THEN 'SATELLITE_GHI'
            WHEN d.DAY_SOURCE_DECISION = 'ONSITE_UNVALIDATED'
            THEN 'ONSITE_UNVALIDATED'
            ELSE 'NO_DATA'
        END as SMART_INSOLATION_SOURCE

    FROM hourly_with_meta h
    JOIN daily_source_decision d
        ON h.SITEID = d.SITEID
        AND DATE(h.MEASUREMENTTIME) = d.DATA_DATE
)

SELECT * FROM hourly_with_source;


-- =============================================================================
-- ALTERNATIVE: Simplified implementation for existing views
-- =============================================================================
-- If you need to modify existing HOURLY_DATA view without full CTEs,
-- you can create a lookup table for daily source decisions and join.

/*
-- Create daily source lookup (refresh daily)
CREATE OR REPLACE TABLE MEI_ASSET_MGMT_DB.PERFORMANCE.DAILY_INSOLATION_SOURCE AS
WITH daily_agg AS (
    SELECT
        SITEID,
        DATE(MEASUREMENTTIME) as DATA_DATE,
        SUM(CASE WHEN HOUR(MEASUREMENTTIME) BETWEEN 7 AND 17
                 THEN COALESCE(INSOLATION_POA, INSOLATION_GHI, 0) ELSE 0 END) as DAILY_ONSITE,
        SUM(CASE WHEN HOUR(MEASUREMENTTIME) BETWEEN 7 AND 17
                 THEN COALESCE(INSOLATION_POA_SOLCAST, INSOLATION_GHI_SOLCAST, 0) ELSE 0 END) as DAILY_SATELLITE
    FROM MEI_ASSET_MGMT_DB.PERFORMANCE.HOURLY_DATA
    WHERE DATA_TYPE = 'current'
    GROUP BY SITEID, DATA_DATE
)
SELECT
    SITEID,
    DATA_DATE,
    DAILY_ONSITE,
    DAILY_SATELLITE,
    CASE
        WHEN DAILY_SATELLITE > 500 THEN DAILY_ONSITE / DAILY_SATELLITE
        ELSE NULL
    END as DAILY_RATIO,
    CASE
        WHEN DAILY_ONSITE >= 100
             AND DAILY_SATELLITE > 500
             AND DAILY_ONSITE / NULLIF(DAILY_SATELLITE, 0) BETWEEN 0.2 AND 2.0
        THEN 'USE_ONSITE'
        WHEN DAILY_SATELLITE >= 100
        THEN 'USE_SATELLITE'
        WHEN DAILY_ONSITE >= 100
        THEN 'USE_ONSITE_UNVALIDATED'
        ELSE 'NO_DATA'
    END as SOURCE_DECISION
FROM daily_agg;

-- Then join in hourly view:
-- LEFT JOIN MEI_ASSET_MGMT_DB.PERFORMANCE.DAILY_INSOLATION_SOURCE ds
--     ON h.SITEID = ds.SITEID AND DATE(h.MEASUREMENTTIME) = ds.DATA_DATE
*/


-- =============================================================================
-- VALIDATION QUERY: Compare old vs new hourly selection
-- =============================================================================

/*
WITH comparison AS (
    SELECT
        SITEID,
        DATE(MEASUREMENTTIME) as DATA_DATE,
        -- Old logic: direct hourly values
        SUM(INSOLATION) as OLD_DAILY_INSOLATION,
        -- New logic: day-level validated
        SUM(SMART_INSOLATION) as NEW_DAILY_INSOLATION,
        MAX(DAY_SOURCE_DECISION) as SOURCE_DECISION,
        MAX(DAILY_RATIO) as DAILY_RATIO
    FROM hourly_with_source
    WHERE HOUR(MEASUREMENTTIME) BETWEEN 7 AND 17
    GROUP BY SITEID, DATE(MEASUREMENTTIME)
)
SELECT
    SOURCE_DECISION,
    COUNT(*) as SITE_DAYS,
    AVG(DAILY_RATIO) as AVG_RATIO,
    AVG(ABS(NEW_DAILY_INSOLATION - OLD_DAILY_INSOLATION) / NULLIF(OLD_DAILY_INSOLATION, 0)) as AVG_CHANGE_PCT
FROM comparison
GROUP BY SOURCE_DECISION
ORDER BY SITE_DAYS DESC;
*/


-- =============================================================================
-- SUMMARY
-- =============================================================================
--
-- This proposal implements DAY-LEVEL SOURCE SELECTION for hourly data:
--
-- 1. Aggregate hourly → daily (sum of 7 AM - 6 PM hours)
-- 2. Validate daily using same thresholds as DAILY_DATA_LIVE:
--    - MIN_THRESHOLD: 100 Wh/m²/day
--    - RATIO_MIN: 0.2
--    - RATIO_MAX: 2.0
-- 3. Apply source decision to ALL hours of that day
-- 4. Apply POA adjustment (×1.15) when using satellite for POA sites
--
-- BENEFITS:
-- - Consistent source within each day (no switching mid-day)
-- - Robust to hourly noise and transients
-- - Handles dawn/dusk naturally (same source as midday)
-- - Aligned with daily data logic for consistency
--
-- EXPECTED IMPACT:
-- - Sites with dead onsite sensors (77.8%) will now use satellite consistently
-- - Sites with valid onsite data (22.2%) will use validated onsite
-- - No more mid-day source switching causing inconsistencies
-- =============================================================================
