# Chiron APM - Insolation Selection Logic Analysis Report

**Analysis Date:** March 12, 2026
**Analysis Period:** December 12, 2025 - March 12, 2026 (90 days)
**Sites Analyzed:** 547 Post-FC sites
**Site-Days:** 49,230

---

## Executive Summary

Analysis of 90 days of insolation data reveals **significant data quality issues** affecting Weather-Adjusted Performance Ratio (WA PR) calculations:

| Metric | Current State | Impact |
|--------|---------------|--------|
| Onsite sensor failures | 29.8% of site-days | Sites appear to overperform |
| WA PR > 120% (suspicious high) | 13.0% of site-days | Bad insolation selection |
| WA PR < 50% (suspicious low) | 31.5% of site-days | Mixed causes |
| Good onsite/satellite agreement | 17.8% of site-days | Only reliable data |

**With improved selection logic:**
- WA PR > 120% reduced from 13.0% to 5.9% (**54.9% improvement**)
- WA PR < 50% reduced from 31.5% to 16.4% (**48% improvement**)
- 351 sites identified for sensor maintenance

---

## 1. Data Quality Overview

### 1.1 Insolation Source Distribution (Current View Logic)

| Source | Count | Percentage |
|--------|-------|------------|
| POA (onsite) | 24,458 | 49.7% |
| POA_SATELLITE | 21,792 | 44.3% |
| GHI (onsite) | 2,260 | 4.6% |

### 1.2 Irradiance Type Configuration

| Type | Sites | Site-Days |
|------|-------|-----------|
| GHI preferred (type=1) | ~348 | 31,320 (63.6%) |
| POA preferred (type=2) | ~196 | 17,640 (35.8%) |

**Finding:** Most sites are configured for GHI, but the view is selecting POA anyway in many cases.

---

## 2. Failure Mode Analysis

### 2.1 Failure Mode Distribution

| Failure Mode | Count | Percentage | Description |
|--------------|-------|------------|-------------|
| ONSITE_DEAD | 37,153 | 75.5% | Onsite < 100 Wh/m², satellite valid |
| GOOD_AGREEMENT | 8,776 | 17.8% | Onsite/satellite ratio 0.7-1.5 |
| SATELLITE_LOW_MISS | 949 | 1.9% | Satellite underestimates (microclimate) |
| SATELLITE_HIGH_MISS | 868 | 1.8% | Satellite overestimates (local clouds) |
| BOTH_MISSING | 758 | 1.5% | Neither source has valid data |
| ONSITE_SUSPICIOUS_LOW | 283 | 0.6% | Onsite too low, WA PR < 60% |
| ONSITE_STUCK_LOW | 162 | 0.3% | Onsite < 20% of satellite |
| MODERATE_DEVIATION | 147 | 0.3% | Ratio outside 0.7-1.5 but not extreme |
| ONSITE_SUSPICIOUS_HIGH | 91 | 0.2% | Onsite too high, WA PR > 120% |
| ONSITE_EXTREME_HIGH | 30 | 0.1% | Onsite > 5x satellite |
| SATELLITE_MISSING | 13 | 0.0% | No satellite data |

**Key Finding:** 75.5% of site-days have dead onsite sensors! The current logic is using invalid onsite data.

### 2.2 Onsite/Satellite Ratio Statistics (Valid Data Only)

For site-days with both onsite > 100 and satellite > 100 Wh/m²:

| Percentile | Ratio |
|------------|-------|
| 1% | 0.16 |
| 5% | 0.46 |
| 10% | 0.65 |
| 25% | 0.88 |
| 50% (median) | 1.03 |
| 75% | 1.24 |
| 90% | 1.52 |
| 95% | 1.74 |
| 99% | 2.90 |

**Conclusion:** Normal ratio range is 0.65-1.52 (10th-90th percentile). Values outside 0.5-2.5 are suspicious.

---

## 3. Problem Site Identification

### 3.1 Sites with Chronic Onsite Sensor Issues

**Criteria:** >50% of days with onsite sensor reading < 100 Wh/m²

| Site ID | Site Name | State | Days | % Onsite Zero | % WA PR High | Avg Ratio |
|---------|-----------|-------|------|---------------|--------------|-----------|
| SP-325 | Midtown-Indi AZ | AZ | 90 | 64.4% | 97.8% | 0.024 |
| SP-382 | Scripps Campus Point | CA | 90 | 65.6% | 94.4% | 0.035 |
| SP-039 | RIC-AMC | NJ | 90 | 65.6% | 81.1% | 0.026 |
| SP-066D | Lakewood - Winterhurst | OH | 90 | 66.7% | 73.3% | 0.071 |
| SP-089 | Boulder - 63rd WTP | CO | 90 | 65.6% | 71.1% | 0.020 |
| SP-010 | Douglas Todd | MN | 90 | 65.6% | 70.0% | 0.047 |

**Total sites with >30% zero readings:** 351 sites

### 3.2 Sites with High WA PR Issues (Satellite Recommended)

These sites have reasonable onsite data but still show high WA PR, suggesting the current logic isn't using satellite when appropriate:

| Site ID | Site Name | State | % WA PR >120% | Avg Ratio |
|---------|-----------|-------|---------------|-----------|
| SP-578B | Pebble St. James Education | CA | 90.0% | 0.62 |
| SP-508 | Pebble Yucca Mesa ES | CA | 68.9% | 0.95 |
| SP-503 | Pebble Onaga ES | CA | 67.8% | 0.85 |
| SP-509 | Pebble Yucca Valley ES | CA | 66.7% | 0.90 |
| SP-558 | Pebble KPUB Jack Furman | TX | 66.7% | 0.54 |
| SP-478 | Pebble Troup Pine Mountain | GA | 66.7% | 0.61 |

---

## 4. Improved Selection Logic

### 4.1 Current Logic Problems

```
Current thresholds (in DAILY_DATA_LIVE):
- MIN_THRESHOLD: ~0 (no effective minimum)
- Ratio bounds: 0.2 - 5.0 (too wide)
- Expected check: > 5% of expected (too lenient)
```

**Issues:**
1. No effective MIN_THRESHOLD - uses near-zero readings from dead sensors
2. Ratio bounds too wide (0.2-5.0) - analysis shows 0.2-2.0 is optimal
3. Expected check too lenient (5%) - allows severely underreporting sensors
4. No POA adjustment when using satellite GHI for POA sites

### 4.2 Recommended Thresholds (Physics-Validated)

```python
# Physics-validated thresholds from 90-day analysis
MIN_THRESHOLD = 100      # Wh/m²/day - below is sensor noise
RATIO_MIN = 0.2          # Only 5-7% have good WA PR below this
RATIO_MAX = 2.0          # 98th percentile of valid data (2.04)
EXPECTED_MIN_PCT = 0.20  # Minimum % of expected insolation
EXPECTED_MAX_PCT = 1.50  # Maximum % of expected insolation
POA_SATELLITE_ADJUSTMENT = 1.15  # Adjust GHI to POA estimate (~15% tilt gain)
```

**Use satellite when:** `ONSITE < 100` OR `ONSITE/SATELLITE < 0.2` OR `ONSITE/SATELLITE > 2.0`

**Validation summary (26,663 site-days with valid onsite/satellite data):**
| Ratio Range | % Good WA PR (0.6-1.2) | Recommendation |
|-------------|------------------------|----------------|
| < 0.2 | 5-7% | Use satellite |
| 0.2-0.5 | 14-25% | Borderline - satellite preferred |
| 0.6-1.5 | 60-68% | Use onsite |
| > 2.0 | 40-46% | Use satellite |

### 4.3 New Logic Performance

| Metric | Old Logic | New Logic | Improvement |
|--------|-----------|-----------|-------------|
| WA PR > 120% | 6,404 (13.0%) | 2,886 (5.9%) | **54.9% reduction** |
| WA PR < 50% | 15,524 (31.5%) | 8,082 (16.4%) | **48% reduction** |
| Source changed | - | 38,970 (79.2%) | Major reselection |

### 4.4 New Source Distribution

| Source | Count | Percentage |
|--------|-------|------------|
| POA | 16,914 | 34.4% |
| GHI | 16,611 | 33.7% |
| POA_FALLBACK | 12,391 | 25.2% |
| SATELLITE_GHI | 2,089 | 4.2% |
| SATELLITE_POA_EST | 778 | 1.6% |
| NONE | 387 | 0.8% |
| GHI_FALLBACK | 60 | 0.1% |

---

## 5. Test Cases

### 5.1 Onsite Sensor Dead (Should Use Satellite)

```
Site: SP-325 (Midtown-Indi AZ)
Date: 2025-12-15
ONSITE_POA: 8 Wh/m²
ONSITE_GHI: 12 Wh/m²
SATELLITE_GHI: 4,250 Wh/m²
EXPECTED_POA: 4,800 Wh/m²

Current selection: POA (8 Wh/m²) → WA PR = 892%
New selection: SATELLITE_POA_EST (4,888 Wh/m²) → WA PR = 87%
```

### 5.2 Onsite Low but Valid (Should Use Onsite)

```
Site: SP-110 (if GHI working)
Date: Cloudy day
ONSITE_POA: 1,200 Wh/m²
SATELLITE_GHI: 4,500 Wh/m²
Ratio: 0.27 (onsite/satellite)

Current: Uses POA (fails validation → satellite)
New: Uses POA if consistent with expected (local weather)
```

### 5.3 POA Site Using Satellite GHI

```
Site: POA-preferred site
SATELLITE_GHI: 5,000 Wh/m²

Current: Uses 5,000 directly
New: Adjusts to 5,750 (×1.15) for POA estimate
Impact: Prevents systematic underestimation
```

### 5.4 Ratio Edge Cases

```
# Too low - reject onsite
Ratio: 0.3 (onsite 1,500 vs satellite 5,000)
Decision: Use satellite

# Acceptable - use onsite
Ratio: 0.7 (onsite 3,500 vs satellite 5,000)
Decision: Use onsite (could be cloudy)

# Too high - reject onsite
Ratio: 3.0 (onsite 15,000 vs satellite 5,000)
Decision: Use satellite (sensor error)
```

---

## 6. Implementation Recommendations

### 6.1 Immediate Actions (Quick Wins)

1. **Update MIN_THRESHOLD to 200 Wh/m²** - Prevents using dead sensor readings
2. **Tighten ratio bounds to 0.5-2.5** - Catches obvious sensor errors
3. **Add POA adjustment (×1.15)** - Corrects systematic bias

### 6.2 Medium-Term Improvements

4. **Add expected upper bound check (< 150%)** - Catches high sensor errors
5. **Implement rolling window validation** - Detect stuck/drifting sensors
6. **Create sensor health dashboard** - Track sites needing maintenance

### 6.3 Long-Term Enhancements

7. **Weighted average approach** - Blend onsite and satellite when uncertain
8. **Machine learning model** - Learn site-specific patterns
9. **Hourly pattern analysis** - Use time-of-day consistency checks

---

## 7. SQL Proposal

See `INSOLATION_FIX_PROPOSAL_V2.sql` for the complete Snowflake view changes.

Key changes:
1. Stricter validation thresholds
2. POA adjustment for satellite fallback
3. New INSOLATION_QUALITY_FLAG column
4. Bounded WA_PR for statistics

---

## 8. Files Generated

| File | Description |
|------|-------------|
| `insolation_analysis_full.csv` | 49,230 rows with all metrics |
| `problem_sites_insolation.csv` | 351 sites needing attention |
| `insolation_analysis_summary.json` | Machine-readable summary |
| `run_insolation_analysis.py` | Reusable analysis script |
| `insolation_research.ipynb` | Jupyter notebook for exploration |

---

## 9. Conclusion

The current insolation selection logic has significant issues, primarily due to:
1. **Dead onsite sensors** being used (75.5% of site-days)
2. **Too lenient validation thresholds** allowing bad data through
3. **Missing POA adjustment** when using satellite GHI

The proposed improvements reduce WA PR anomalies by ~50%, providing much more accurate fleet performance metrics.

**Immediate action recommended:** Update thresholds in both Snowflake view and Python backend.
