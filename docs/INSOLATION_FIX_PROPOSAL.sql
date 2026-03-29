-- =============================================================================
-- DAILY_DATA_LIVE View - Smart Insolation Selection Fix
-- =============================================================================
--
-- PROBLEM IDENTIFIED:
-- The current view selects onsite irradiance even when it's clearly invalid,
-- causing WA Performance Ratio values of 120%+ or even 100,000%+.
--
-- ROOT CAUSE:
-- When onsite weather stations go offline or malfunction:
-- - They return 0 or near-zero values
-- - The view still selects these as "valid" onsite readings
-- - This causes extreme negative insolation gaps and WA PR spikes
--
-- EVIDENCE FROM DATA:
-- - 620 rows (14%) with WA PR > 120% in last 7 days
-- - 177 sites (33%) affected
-- - GHI source avg WA PR = 113,000 (completely broken)
-- - POA source avg WA PR = 36 (often using invalid data)
-- - POA_SATELLITE avg WA PR = 0.90 (working correctly)
--
-- Sites like SP-594A show onsite=0.06 vs satellite=6976 (0.001% ratio)
-- Sites like SP-024 show onsite=84 vs satellite=2952 (3% ratio)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PROPOSED SMART INSOLATION SELECTION LOGIC
-- -----------------------------------------------------------------------------
--
-- The fix adds validation before using onsite data:
-- 1. Check if onsite reading is reasonable (> 5% of expected)
-- 2. Cross-validate against satellite when available
-- 3. Only use onsite if it passes validation
-- 4. Fall back to satellite if onsite is invalid
-- -----------------------------------------------------------------------------

-- Replace the current INSOLATION and INSOLATION_SOURCE columns with:

-- Step 1: Add validation flags
-- Note: Satellite GHI (INSOLATION_GHI_SOLCAST) is the real satellite data
-- Satellite "POA" is just GHI masked, so we compare against GHI satellite for both

ONSITE_POA_VALID AS (
    CASE
        -- Must have a reading above noise threshold
        WHEN COALESCE(INSOLATION_POA, 0) < 10 THEN FALSE
        -- If expected is available, must be > 5% of expected
        WHEN EXPECTED_INSOLATION_POA > 0
             AND INSOLATION_POA / EXPECTED_INSOLATION_POA < 0.05 THEN FALSE
        -- Cross-validate against satellite GHI (the real satellite data)
        -- POA is typically 10-20% higher than GHI, so allow 0.25 to 3.5 ratio
        WHEN INSOLATION_GHI_SOLCAST > 100
             AND (INSOLATION_POA / INSOLATION_GHI_SOLCAST < 0.25
                  OR INSOLATION_POA / INSOLATION_GHI_SOLCAST > 3.5) THEN FALSE
        ELSE TRUE
    END
),

ONSITE_GHI_VALID AS (
    CASE
        -- Must have a reading above noise threshold
        WHEN COALESCE(INSOLATION_GHI, 0) < 10 THEN FALSE
        -- If expected is available, must be > 5% of expected
        WHEN EXPECTED_INSOLATION_GHI > 0
             AND INSOLATION_GHI / EXPECTED_INSOLATION_GHI < 0.05 THEN FALSE
        -- Cross-validate against satellite GHI (should be similar, 0.3 to 3.0 ratio)
        WHEN INSOLATION_GHI_SOLCAST > 100
             AND (INSOLATION_GHI / INSOLATION_GHI_SOLCAST < 0.3
                  OR INSOLATION_GHI / INSOLATION_GHI_SOLCAST > 3.0) THEN FALSE
        ELSE TRUE
    END
),

-- Step 2: Smart selection with validation
-- NOTE: Satellite "POA" is actually just GHI data masked as POA - don't use it for POA sites
-- Priority: Valid Onsite POA > Valid Onsite GHI > Satellite GHI (for all sites)
INSOLATION AS (
    CASE
        -- Priority 1: Valid onsite POA (for POA sites)
        WHEN sm.IRRADIANCE_TYPE = 'POA' AND ONSITE_POA_VALID
             AND INSOLATION_POA > 0
             THEN INSOLATION_POA

        -- Priority 2: Valid onsite GHI (for GHI sites, or POA sites with bad POA sensor)
        WHEN ONSITE_GHI_VALID AND INSOLATION_GHI > 0
             THEN INSOLATION_GHI

        -- Priority 3: Satellite GHI as fallback (only real satellite data we have)
        -- Note: INSOLATION_GHI_SOLCAST is the actual satellite data
        WHEN INSOLATION_GHI_SOLCAST IS NOT NULL
             AND INSOLATION_GHI_SOLCAST > 0
             THEN INSOLATION_GHI_SOLCAST

        -- Last resort: use onsite even if suspicious (but flag it)
        WHEN INSOLATION_POA > 0 THEN INSOLATION_POA
        WHEN INSOLATION_GHI > 0 THEN INSOLATION_GHI

        ELSE NULL
    END
),

-- Step 3: Track which source was used and if it was validated
INSOLATION_SOURCE AS (
    CASE
        WHEN sm.IRRADIANCE_TYPE = 'POA' AND ONSITE_POA_VALID
             AND INSOLATION_POA > 0
             THEN 'POA'

        WHEN ONSITE_GHI_VALID AND INSOLATION_GHI > 0
             THEN 'GHI'

        WHEN INSOLATION_GHI_SOLCAST IS NOT NULL
             AND INSOLATION_GHI_SOLCAST > 0
             THEN 'GHI_SATELLITE'

        WHEN INSOLATION_POA > 0 THEN 'POA_UNVALIDATED'
        WHEN INSOLATION_GHI > 0 THEN 'GHI_UNVALIDATED'

        ELSE 'NONE'
    END
),

-- Step 4: Add data quality flag for downstream filtering
INSOLATION_QUALITY AS (
    CASE
        WHEN INSOLATION_SOURCE IN ('POA', 'GHI') THEN 'VALIDATED_ONSITE'
        WHEN INSOLATION_SOURCE IN ('POA_SATELLITE', 'GHI_SATELLITE') THEN 'SATELLITE'
        WHEN INSOLATION_SOURCE LIKE '%_UNVALIDATED' THEN 'UNVALIDATED_ONSITE'
        ELSE 'NO_DATA'
    END
),

-- =============================================================================
-- ADDITIONAL: WA PR Sanity Bounds
-- =============================================================================
-- Even with better insolation selection, cap WA PR to reasonable bounds
-- to prevent outliers from skewing fleet statistics

WA_PERFORMANCE_RATIO_RAW AS (
    CASE
        WHEN WA_EXPECTED_PRODUCTION > 0
        THEN PRODUCTION / WA_EXPECTED_PRODUCTION
        ELSE NULL
    END
),

-- Bounded version for statistics (0.1 to 1.5 range)
WA_PERFORMANCE_RATIO AS (
    CASE
        WHEN WA_PERFORMANCE_RATIO_RAW IS NULL THEN NULL
        WHEN WA_PERFORMANCE_RATIO_RAW > 1.5 THEN NULL  -- Exclude from stats
        WHEN WA_PERFORMANCE_RATIO_RAW < 0.1 THEN NULL  -- Exclude from stats
        ELSE WA_PERFORMANCE_RATIO_RAW
    END
),

-- Keep unbounded for diagnostics
WA_PERFORMANCE_RATIO_UNBOUNDED AS (
    CASE
        WHEN WA_EXPECTED_PRODUCTION > 0
        THEN PRODUCTION / WA_EXPECTED_PRODUCTION
        ELSE NULL
    END
),

-- =============================================================================
-- SUMMARY OF CHANGES
-- =============================================================================
--
-- 1. Added ONSITE_POA_VALID and ONSITE_GHI_VALID columns
--    - Validates onsite readings are > 10 Wh (noise threshold)
--    - Validates onsite is > 5% of expected (not stuck at near-zero)
--    - Validates onsite/satellite ratio is between 0.3 and 3.0
--
-- 2. Modified INSOLATION selection hierarchy:
--    - Only uses onsite if it passes validation
--    - Falls back to satellite automatically when onsite is invalid
--    - Tracks validation status in INSOLATION_SOURCE
--
-- 3. Added INSOLATION_QUALITY column for easy filtering
--    - 'VALIDATED_ONSITE' - passed all checks
--    - 'SATELLITE' - using satellite data
--    - 'UNVALIDATED_ONSITE' - using onsite but didn't pass validation
--    - 'NO_DATA' - no insolation available
--
-- 4. Added WA PR bounding:
--    - WA_PERFORMANCE_RATIO capped to 0.1-1.5 range for stats
--    - WA_PERFORMANCE_RATIO_UNBOUNDED kept for diagnostics
--
-- =============================================================================
-- EXPECTED IMPACT
-- =============================================================================
--
-- Before fix: 620 rows (14%) with WA PR > 120%
-- After fix: These rows will either:
--   a) Use satellite data (if available) → realistic WA PR
--   b) Be flagged as UNVALIDATED_ONSITE → excluded from stats
--   c) Have WA_PERFORMANCE_RATIO = NULL → excluded from stats
--
-- This ensures fleet statistics are based on quality data only.
-- =============================================================================
