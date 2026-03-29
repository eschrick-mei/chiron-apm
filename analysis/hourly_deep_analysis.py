#!/usr/bin/env python3
"""
Deep analysis of hourly insolation data to understand:
1. Satellite coverage patterns
2. Whether to use day-level or hour-level source selection
3. Optimal methodology for hourly data
"""

import pandas as pd
import numpy as np
from pathlib import Path

# Load the hourly analysis data
data_path = Path(__file__).parent / "hourly_insolation_analysis.csv"
df = pd.read_csv(data_path)
df['MEASUREMENTTIME'] = pd.to_datetime(df['MEASUREMENTTIME'])
df['DATE'] = pd.to_datetime(df['DATE'])

print("=" * 70)
print("DEEP ANALYSIS OF HOURLY INSOLATION DATA")
print("=" * 70)
print(f"\nTotal records: {len(df):,}")
print(f"Sites: {df['SITEID'].nunique()}")
print(f"Date range: {df['DATE'].min()} to {df['DATE'].max()}")

# Focus on daytime hours
daytime = df[(df['HOUR_OF_DAY'] >= 7) & (df['HOUR_OF_DAY'] < 19)].copy()
print(f"\nDaytime hours (7 AM - 7 PM): {len(daytime):,}")

# ============================================================================
# 1. SATELLITE COVERAGE ANALYSIS
# ============================================================================
print("\n" + "=" * 70)
print("1. SATELLITE COVERAGE ANALYSIS")
print("=" * 70)

# Check raw satellite values
print("\nSatellite GHI availability:")
sat_ghi_valid = (daytime['SATELLITE_GHI'].notna() & (daytime['SATELLITE_GHI'] > 10)).sum()
print(f"  Records with SATELLITE_GHI > 10: {sat_ghi_valid:,} ({sat_ghi_valid/len(daytime)*100:.1f}%)")

sat_poa_valid = (daytime['SATELLITE_POA'].notna() & (daytime['SATELLITE_POA'] > 10)).sum()
print(f"  Records with SATELLITE_POA > 10: {sat_poa_valid:,} ({sat_poa_valid/len(daytime)*100:.1f}%)")

# Check if satellite coverage varies by hour
print("\nSatellite coverage by hour:")
for hour in range(7, 19):
    hour_df = daytime[daytime['HOUR_OF_DAY'] == hour]
    ghi_valid = (hour_df['SATELLITE_GHI'].notna() & (hour_df['SATELLITE_GHI'] > 50)).sum()
    poa_valid = (hour_df['SATELLITE_POA'].notna() & (hour_df['SATELLITE_POA'] > 50)).sum()
    print(f"  Hour {hour:02d}: GHI={ghi_valid:>5} ({ghi_valid/len(hour_df)*100:.1f}%), "
          f"POA={poa_valid:>5} ({poa_valid/len(hour_df)*100:.1f}%)")

# ============================================================================
# 2. ONSITE DATA AVAILABILITY
# ============================================================================
print("\n" + "=" * 70)
print("2. ONSITE DATA AVAILABILITY")
print("=" * 70)

poa_valid = (daytime['ONSITE_POA'].notna() & (daytime['ONSITE_POA'] > 10)).sum()
ghi_valid = (daytime['ONSITE_GHI'].notna() & (daytime['ONSITE_GHI'] > 10)).sum()
print(f"  Records with ONSITE_POA > 10: {poa_valid:,} ({poa_valid/len(daytime)*100:.1f}%)")
print(f"  Records with ONSITE_GHI > 10: {ghi_valid:,} ({ghi_valid/len(daytime)*100:.1f}%)")

# Combined availability (either onsite available)
either_onsite = ((daytime['ONSITE_POA'].notna() & (daytime['ONSITE_POA'] > 10)) |
                 (daytime['ONSITE_GHI'].notna() & (daytime['ONSITE_GHI'] > 10))).sum()
print(f"  Records with either onsite > 10: {either_onsite:,} ({either_onsite/len(daytime)*100:.1f}%)")

# ============================================================================
# 3. COMPARISON AVAILABILITY (BOTH SOURCES)
# ============================================================================
print("\n" + "=" * 70)
print("3. COMPARISON AVAILABILITY (both onsite and satellite)")
print("=" * 70)

# Records where we can compare onsite vs satellite
both_available = daytime[
    (daytime['PREF_ONSITE'] > 50) &
    (daytime['PREF_SATELLITE'] > 50)
]
print(f"Records with both onsite and satellite > 50 W/m²: {len(both_available):,} ({len(both_available)/len(daytime)*100:.1f}%)")

# Ratio analysis when both are available
if len(both_available) > 0:
    ratios = both_available['PREF_ONSITE'] / both_available['PREF_SATELLITE']
    print(f"\nRatio distribution (when both available):")
    print(f"  Mean: {ratios.mean():.3f}")
    print(f"  Median: {ratios.median():.3f}")
    print(f"  P5: {ratios.quantile(0.05):.3f}")
    print(f"  P10: {ratios.quantile(0.10):.3f}")
    print(f"  P25: {ratios.quantile(0.25):.3f}")
    print(f"  P75: {ratios.quantile(0.75):.3f}")
    print(f"  P90: {ratios.quantile(0.90):.3f}")
    print(f"  P95: {ratios.quantile(0.95):.3f}")

# ============================================================================
# 4. DAY-LEVEL ANALYSIS
# ============================================================================
print("\n" + "=" * 70)
print("4. DAY-LEVEL ANALYSIS")
print("=" * 70)

# For each site-day, compute:
# - Total daytime hours
# - Hours with good onsite (> 50 W/m²)
# - Hours with good satellite (> 50 W/m²)
# - Hours with good comparison (both > 50)
# - Daily aggregated ratio

day_stats = []
for (site, date), group in daytime.groupby(['SITEID', 'DATE']):
    total_hours = len(group)
    onsite_good = (group['PREF_ONSITE'] > 50).sum()
    satellite_good = (group['PREF_SATELLITE'] > 50).sum()
    both_good = ((group['PREF_ONSITE'] > 50) & (group['PREF_SATELLITE'] > 50)).sum()

    # Daily sums
    daily_onsite = group['PREF_ONSITE'].sum()
    daily_satellite = group['PREF_SATELLITE'].sum()
    daily_ratio = daily_onsite / daily_satellite if daily_satellite > 100 else np.nan

    # Hourly ratios for hours with both
    valid_hours = group[(group['PREF_ONSITE'] > 50) & (group['PREF_SATELLITE'] > 50)]
    if len(valid_hours) > 0:
        hourly_ratios = valid_hours['PREF_ONSITE'] / valid_hours['PREF_SATELLITE']
        hourly_ratio_mean = hourly_ratios.mean()
        hourly_ratio_std = hourly_ratios.std()
    else:
        hourly_ratio_mean = np.nan
        hourly_ratio_std = np.nan

    day_stats.append({
        'siteid': site,
        'date': date,
        'total_hours': total_hours,
        'onsite_good_hours': onsite_good,
        'satellite_good_hours': satellite_good,
        'both_good_hours': both_good,
        'daily_onsite': daily_onsite,
        'daily_satellite': daily_satellite,
        'daily_ratio': daily_ratio,
        'hourly_ratio_mean': hourly_ratio_mean,
        'hourly_ratio_std': hourly_ratio_std,
    })

day_df = pd.DataFrame(day_stats)
print(f"\nSite-days analyzed: {len(day_df):,}")

print(f"\nSatellite coverage by site-day:")
print(f"  Days with >=6 hours satellite data: {(day_df['satellite_good_hours'] >= 6).sum():,} ({(day_df['satellite_good_hours'] >= 6).mean()*100:.1f}%)")
print(f"  Days with >=3 hours satellite data: {(day_df['satellite_good_hours'] >= 3).sum():,} ({(day_df['satellite_good_hours'] >= 3).mean()*100:.1f}%)")
print(f"  Days with 0 hours satellite data: {(day_df['satellite_good_hours'] == 0).sum():,} ({(day_df['satellite_good_hours'] == 0).mean()*100:.1f}%)")

print(f"\nOnsite coverage by site-day:")
print(f"  Days with >=6 hours onsite data: {(day_df['onsite_good_hours'] >= 6).sum():,} ({(day_df['onsite_good_hours'] >= 6).mean()*100:.1f}%)")
print(f"  Days with >=3 hours onsite data: {(day_df['onsite_good_hours'] >= 3).sum():,} ({(day_df['onsite_good_hours'] >= 3).mean()*100:.1f}%)")
print(f"  Days with 0 hours onsite data: {(day_df['onsite_good_hours'] == 0).sum():,} ({(day_df['onsite_good_hours'] == 0).mean()*100:.1f}%)")

# ============================================================================
# 5. DAILY VS HOURLY RATIO CONSISTENCY
# ============================================================================
print("\n" + "=" * 70)
print("5. DAILY VS HOURLY RATIO CONSISTENCY")
print("=" * 70)

# For days with at least 6 good comparison hours
good_days = day_df[(day_df['both_good_hours'] >= 6) & (day_df['daily_ratio'].notna())]
print(f"\nSite-days with >=6 comparable hours: {len(good_days):,}")

if len(good_days) > 0:
    print(f"\nDaily aggregated ratio distribution:")
    print(f"  Mean: {good_days['daily_ratio'].mean():.3f}")
    print(f"  Median: {good_days['daily_ratio'].median():.3f}")
    print(f"  P5: {good_days['daily_ratio'].quantile(0.05):.3f}")
    print(f"  P95: {good_days['daily_ratio'].quantile(0.95):.3f}")

    print(f"\nHourly ratio consistency within days:")
    print(f"  Mean of hourly ratio means: {good_days['hourly_ratio_mean'].mean():.3f}")
    print(f"  Mean of hourly ratio std: {good_days['hourly_ratio_std'].mean():.3f}")

    # Compare daily aggregate ratio vs mean of hourly ratios
    ratio_diff = (good_days['daily_ratio'] - good_days['hourly_ratio_mean']).abs()
    print(f"\nDaily aggregate vs hourly mean ratio:")
    print(f"  Mean absolute difference: {ratio_diff.mean():.3f}")
    print(f"  Median absolute difference: {ratio_diff.median():.3f}")

# ============================================================================
# 6. WITHIN-DAY RATIO VARIABILITY
# ============================================================================
print("\n" + "=" * 70)
print("6. WITHIN-DAY RATIO VARIABILITY")
print("=" * 70)

print(f"\nHourly ratio std by site-day:")
valid_std = good_days['hourly_ratio_std'].dropna()
print(f"  Mean std: {valid_std.mean():.3f}")
print(f"  Median std: {valid_std.median():.3f}")
print(f"  Days with std < 0.2: {(valid_std < 0.2).sum():,} ({(valid_std < 0.2).mean()*100:.1f}%)")
print(f"  Days with std < 0.3: {(valid_std < 0.3).sum():,} ({(valid_std < 0.3).mean()*100:.1f}%)")
print(f"  Days with std < 0.5: {(valid_std < 0.5).sum():,} ({(valid_std < 0.5).mean()*100:.1f}%)")

# ============================================================================
# 7. RECOMMENDED APPROACH
# ============================================================================
print("\n" + "=" * 70)
print("7. ANALYSIS CONCLUSIONS")
print("=" * 70)

print("""
Based on the analysis:

1. SATELLITE COVERAGE:
   - Satellite data is available for most daytime hours
   - Coverage drops at dawn/dusk (expected)

2. ONSITE COVERAGE:
   - Onsite data is available for many but not all hours
   - Significant portion has dead/low sensors

3. RATIO CONSISTENCY:
   - Within-day ratio variability exists but is manageable
   - Daily aggregated ratio is a good proxy for hourly behavior

4. RECOMMENDED APPROACHES:

   OPTION A: Day-level source selection (RECOMMENDED)
   - Aggregate hourly to daily sums
   - Use daily thresholds (MIN=100, RATIO 0.2-2.0)
   - If daily ratio is invalid, use satellite for entire day
   - Benefits: Consistent source per day, robust to hourly noise

   OPTION B: Hour-level with fallback
   - For hours with satellite > 50 W/m²: use hourly ratio thresholds
   - For hours without satellite: use minimum threshold only
   - Inherit source from previous/next valid hour

   OPTION C: Hybrid
   - Use day-level decision for overall source
   - But allow hour-level override for extreme deviations
   - E.g., if daily says "use onsite" but one hour has ratio < 0.1, use satellite for that hour
""")

# ============================================================================
# 8. SPECIFIC THRESHOLD RECOMMENDATIONS
# ============================================================================
print("\n" + "=" * 70)
print("8. SPECIFIC THRESHOLD RECOMMENDATIONS")
print("=" * 70)

print("""
HOURLY THRESHOLDS (aligned with daily):

  MIN_IRRADIANCE = 50 W/m² (hourly) = equivalent to ~100 Wh/m²/day

  MIDDAY (8 AM - 5 PM):
    - RATIO_MIN = 0.2 (same as daily)
    - RATIO_MAX = 2.0 (same as daily)

  DAWN/DUSK (6-8 AM, 5-7 PM):
    - RATIO_MIN = 0.1 (more lenient - sun angle effects)
    - RATIO_MAX = 3.0 (more lenient)

  NIGHT (before 6 AM, after 7 PM):
    - Both should be < 10 W/m² (normal)
    - If onsite > 50 W/m² at night: sensor error

DAY-LEVEL SELECTION LOGIC:

  1. Sum daytime hours (7 AM - 6 PM) for onsite and satellite
  2. Compute daily ratio = onsite_sum / satellite_sum
  3. If satellite_sum < 500 Wh/m²/day: Cannot validate, use onsite if available
  4. If ratio < 0.2 or ratio > 2.0: Use satellite for all hours
  5. If 0.2 <= ratio <= 2.0: Use onsite for all hours
  6. Flag the source as DAY_LEVEL_VALIDATED or HOUR_LEVEL if overridden
""")

# Save the day-level stats
day_df.to_csv(Path(__file__).parent / "hourly_day_level_stats.csv", index=False)
print(f"\nSaved day-level stats to hourly_day_level_stats.csv")
