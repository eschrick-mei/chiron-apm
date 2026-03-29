#!/usr/bin/env python3
"""
Hourly Insolation Analysis Script
Analyzes hourly insolation data to determine optimal selection thresholds.

Key considerations:
1. Dawn/dusk variability - low readings at edges are normal
2. Nighttime hours - zero readings expected
3. Cloud transients - can cause momentary disagreement
4. Aggregation to daily - should match daily analysis results
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path
import sys
import json

# Add parent paths for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from CHIRON_MONITORING.config import Config
from CHIRON_MONITORING.data import SnowflakeConnector


def get_snowflake_connection():
    """Get Snowflake connector."""
    config_path = Path(__file__).parent.parent.parent / "config.json"
    config = Config(config_file=str(config_path))
    return SnowflakeConnector(**config.snowflake.connection_params)


def pull_hourly_data(connector, days: int = 30) -> pd.DataFrame:
    """Pull hourly insolation data for analysis."""
    end_date = datetime.now().strftime('%Y-%m-%d')
    start_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')

    query = f"""
    SELECT
        h.SITEID,
        h.SITENAME,
        h.MEASUREMENTTIME,
        DATE(h.MEASUREMENTTIME) as DATE,
        HOUR(h.MEASUREMENTTIME) as HOUR_OF_DAY,

        -- Onsite insolation (W/m²)
        h.INSOLATION_POA as ONSITE_POA,
        h.INSOLATION_GHI as ONSITE_GHI,

        -- Satellite insolation (W/m²)
        h.INSOLATION_GHI_SOLCAST as SATELLITE_GHI,
        h.INSOLATION_POA_SOLCAST as SATELLITE_POA,

        -- Production
        h.METER_ENERGY,
        h.INV_TOTAL_ENERGY,

        -- Site metadata
        sm.IRRADIANCE_TYPE,
        sm.SIZE_KW_DC,
        sm.ADDRESS_STATE as STATE,
        sm.LATITUDE,
        sm.LONGITUDE

    FROM MEI_ASSET_MGMT_DB.PERFORMANCE.HOURLY_DATA h
    JOIN MEI_ASSET_MGMT_DB.PUBLIC.SITE_MASTER sm ON h.SITEID = sm.SITE_ID
    WHERE h.DATA_TYPE = 'current'
      AND h.MEASUREMENTTIME >= '{start_date}'
      AND h.MEASUREMENTTIME <= '{end_date}'
      AND sm.SITE_ID IN (
          SELECT DISTINCT SITEID
          FROM MEI_ASSET_MGMT_DB.PERFORMANCE.DAILY_DATA_LIVE
          WHERE STAGE = 'Post-FC' AND DATA_TYPE = 'current'
      )
    ORDER BY h.SITEID, h.MEASUREMENTTIME
    """

    print(f"Pulling hourly data from {start_date} to {end_date}...")
    result = connector.execute_query(query)
    df = pd.DataFrame(result)

    if df.empty:
        print("No data returned!")
        return df

    df['MEASUREMENTTIME'] = pd.to_datetime(df['MEASUREMENTTIME'])
    df['DATE'] = pd.to_datetime(df['DATE'])

    # Convert Decimal columns to float
    numeric_cols = [
        'ONSITE_POA', 'ONSITE_GHI', 'SATELLITE_GHI', 'SATELLITE_POA',
        'METER_ENERGY', 'INV_TOTAL_ENERGY', 'SIZE_KW_DC', 'LATITUDE', 'LONGITUDE'
    ]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    print(f"Pulled {len(df):,} hourly records from {df['SITEID'].nunique()} sites")
    return df


def classify_hour_period(hour: int) -> str:
    """Classify hour into period of day."""
    if hour < 6:
        return 'NIGHT'
    elif hour < 8:
        return 'DAWN'
    elif hour < 17:
        return 'MIDDAY'
    elif hour < 20:
        return 'DUSK'
    else:
        return 'NIGHT'


def compute_hourly_metrics(df: pd.DataFrame) -> pd.DataFrame:
    """Compute metrics for each hourly record."""
    data = df.copy()

    # Classify time period
    data['PERIOD'] = data['HOUR_OF_DAY'].apply(classify_hour_period)

    # Get preferred onsite based on IRRADIANCE_TYPE
    def get_preferred_onsite(row):
        irr_type = row.get('IRRADIANCE_TYPE', 2)
        irr_type = int(irr_type) if pd.notna(irr_type) else 2
        if irr_type == 2:  # POA preferred
            return row.get('ONSITE_POA', 0) or 0
        else:  # GHI preferred
            return row.get('ONSITE_GHI', 0) or 0

    def get_preferred_satellite(row):
        irr_type = row.get('IRRADIANCE_TYPE', 2)
        irr_type = int(irr_type) if pd.notna(irr_type) else 2
        if irr_type == 2:  # POA preferred
            return row.get('SATELLITE_POA', 0) or 0
        else:  # GHI preferred
            return row.get('SATELLITE_GHI', 0) or 0

    data['PREF_ONSITE'] = data.apply(get_preferred_onsite, axis=1)
    data['PREF_SATELLITE'] = data.apply(get_preferred_satellite, axis=1)

    # Compute ratio (onsite/satellite)
    data['RATIO'] = np.where(
        data['PREF_SATELLITE'] > 10,  # Minimum threshold for valid ratio
        data['PREF_ONSITE'] / data['PREF_SATELLITE'],
        np.nan
    )

    # Classify data quality
    def classify_hourly_quality(row):
        onsite = row['PREF_ONSITE']
        satellite = row['PREF_SATELLITE']
        ratio = row['RATIO']
        period = row['PERIOD']

        # Nighttime - should both be near zero
        if period == 'NIGHT':
            if satellite < 10 and onsite < 10:
                return 'NIGHT_NORMAL'
            elif satellite < 10 and onsite >= 10:
                return 'NIGHT_ONSITE_HIGH'  # Sensor error
            elif satellite >= 10 and onsite < 10:
                return 'NIGHT_SATELLITE_HIGH'  # Unusual
            else:
                return 'NIGHT_BOTH_HIGH'

        # Daytime analysis
        if pd.isna(ratio):
            if onsite < 10 and satellite < 10:
                return 'BOTH_LOW'  # Cloudy or low light
            elif onsite < 10:
                return 'ONSITE_DEAD'
            elif satellite < 10:
                return 'SATELLITE_LOW'
            else:
                return 'UNKNOWN'

        # Dawn/dusk - more lenient thresholds
        if period in ['DAWN', 'DUSK']:
            if ratio < 0.1:
                return 'DAWN_DUSK_ONSITE_LOW'
            elif ratio > 5.0:
                return 'DAWN_DUSK_ONSITE_HIGH'
            elif 0.3 <= ratio <= 3.0:
                return 'DAWN_DUSK_GOOD'
            else:
                return 'DAWN_DUSK_MODERATE_DEV'

        # Midday - strict thresholds
        if ratio < 0.2:
            return 'MIDDAY_ONSITE_DEAD'
        elif ratio < 0.5:
            return 'MIDDAY_ONSITE_LOW'
        elif ratio > 2.0:
            return 'MIDDAY_ONSITE_HIGH'
        elif ratio > 1.5:
            return 'MIDDAY_ONSITE_MODERATE_HIGH'
        elif 0.7 <= ratio <= 1.5:
            return 'MIDDAY_GOOD'
        else:
            return 'MIDDAY_MODERATE_DEV'

    data['QUALITY'] = data.apply(classify_hourly_quality, axis=1)

    return data


def aggregate_to_daily(df: pd.DataFrame) -> pd.DataFrame:
    """Aggregate hourly data to daily for comparison with daily analysis."""
    # Filter to daytime hours only (6 AM - 8 PM)
    daytime = df[(df['HOUR_OF_DAY'] >= 6) & (df['HOUR_OF_DAY'] < 20)].copy()

    daily = daytime.groupby(['SITEID', 'DATE']).agg({
        'ONSITE_POA': 'sum',
        'ONSITE_GHI': 'sum',
        'SATELLITE_GHI': 'sum',
        'SATELLITE_POA': 'sum',
        'PREF_ONSITE': 'sum',
        'PREF_SATELLITE': 'sum',
        'IRRADIANCE_TYPE': 'first',
        'STATE': 'first',
        'SIZE_KW_DC': 'first',
        'METER_ENERGY': 'sum',
        'INV_TOTAL_ENERGY': 'sum'
    }).reset_index()

    # Compute daily ratio
    daily['DAILY_RATIO'] = np.where(
        daily['PREF_SATELLITE'] > 100,
        daily['PREF_ONSITE'] / daily['PREF_SATELLITE'],
        np.nan
    )

    # Count hours with good data per day
    good_hours = daytime[daytime['QUALITY'].str.contains('GOOD', na=False)].groupby(
        ['SITEID', 'DATE']
    ).size().reset_index(name='GOOD_HOURS')

    total_hours = daytime.groupby(['SITEID', 'DATE']).size().reset_index(name='TOTAL_HOURS')

    daily = daily.merge(good_hours, on=['SITEID', 'DATE'], how='left')
    daily = daily.merge(total_hours, on=['SITEID', 'DATE'], how='left')
    daily['GOOD_HOURS'] = daily['GOOD_HOURS'].fillna(0)
    daily['PCT_GOOD_HOURS'] = daily['GOOD_HOURS'] / daily['TOTAL_HOURS']

    return daily


def analyze_by_period(df: pd.DataFrame) -> dict:
    """Analyze patterns by time period."""
    results = {}

    for period in ['DAWN', 'MIDDAY', 'DUSK', 'NIGHT']:
        period_df = df[df['PERIOD'] == period]

        if len(period_df) == 0:
            continue

        quality_dist = period_df['QUALITY'].value_counts().to_dict()

        # Ratio statistics for records with valid ratio
        valid_ratio = period_df[period_df['RATIO'].notna() & (period_df['RATIO'] > 0)]

        if len(valid_ratio) > 0:
            ratio_stats = {
                'count': len(valid_ratio),
                'mean': float(valid_ratio['RATIO'].mean()),
                'median': float(valid_ratio['RATIO'].median()),
                'p5': float(valid_ratio['RATIO'].quantile(0.05)),
                'p10': float(valid_ratio['RATIO'].quantile(0.10)),
                'p25': float(valid_ratio['RATIO'].quantile(0.25)),
                'p75': float(valid_ratio['RATIO'].quantile(0.75)),
                'p90': float(valid_ratio['RATIO'].quantile(0.90)),
                'p95': float(valid_ratio['RATIO'].quantile(0.95)),
                'p99': float(valid_ratio['RATIO'].quantile(0.99)),
            }
        else:
            ratio_stats = {'count': 0}

        results[period] = {
            'total_hours': len(period_df),
            'quality_distribution': quality_dist,
            'ratio_stats': ratio_stats
        }

    return results


def analyze_by_hour(df: pd.DataFrame) -> pd.DataFrame:
    """Analyze ratio distribution by hour of day."""
    hourly_stats = []

    for hour in range(24):
        hour_df = df[df['HOUR_OF_DAY'] == hour]
        valid_ratio = hour_df[hour_df['RATIO'].notna() & (hour_df['RATIO'] > 0)]

        stats = {
            'hour': hour,
            'total_records': len(hour_df),
            'valid_ratio_records': len(valid_ratio),
            'ratio_median': valid_ratio['RATIO'].median() if len(valid_ratio) > 0 else np.nan,
            'ratio_mean': valid_ratio['RATIO'].mean() if len(valid_ratio) > 0 else np.nan,
            'ratio_p10': valid_ratio['RATIO'].quantile(0.10) if len(valid_ratio) > 0 else np.nan,
            'ratio_p90': valid_ratio['RATIO'].quantile(0.90) if len(valid_ratio) > 0 else np.nan,
            'onsite_dead_pct': (hour_df['QUALITY'].str.contains('DEAD|LOW', na=False).sum() / len(hour_df) * 100) if len(hour_df) > 0 else 0,
            'good_pct': (hour_df['QUALITY'].str.contains('GOOD', na=False).sum() / len(hour_df) * 100) if len(hour_df) > 0 else 0,
        }
        hourly_stats.append(stats)

    return pd.DataFrame(hourly_stats)


def analyze_source_consistency(df: pd.DataFrame) -> dict:
    """Analyze if source selection should be consistent within a day."""
    daily_consistency = []

    # For each site-day, check if onsite/satellite agreement is consistent
    for (site, date), group in df.groupby(['SITEID', 'DATE']):
        daytime = group[(group['HOUR_OF_DAY'] >= 8) & (group['HOUR_OF_DAY'] < 17)]

        if len(daytime) < 5:  # Need at least 5 midday hours
            continue

        # Count hours where onsite is good vs bad
        good_onsite = daytime['QUALITY'].str.contains('GOOD', na=False).sum()
        bad_onsite = daytime['QUALITY'].str.contains('DEAD|LOW', na=False).sum()
        total = len(daytime)

        # Calculate median ratio for the day
        valid_ratios = daytime[daytime['RATIO'].notna()]['RATIO']
        median_ratio = valid_ratios.median() if len(valid_ratios) > 0 else np.nan

        # Consistency score: how many hours agree with daily assessment
        daily_good = good_onsite > bad_onsite

        if daily_good:
            consistency = good_onsite / total
        else:
            consistency = bad_onsite / total

        daily_consistency.append({
            'siteid': site,
            'date': date,
            'good_hours': good_onsite,
            'bad_hours': bad_onsite,
            'total_hours': total,
            'daily_good': daily_good,
            'consistency': consistency,
            'median_ratio': median_ratio
        })

    df_consistency = pd.DataFrame(daily_consistency)

    if len(df_consistency) == 0:
        return {'no_data': True}

    return {
        'total_site_days': len(df_consistency),
        'avg_consistency': float(df_consistency['consistency'].mean()),
        'high_consistency_pct': float((df_consistency['consistency'] >= 0.8).mean() * 100),
        'consistency_distribution': {
            '>=90%': int((df_consistency['consistency'] >= 0.9).sum()),
            '80-90%': int(((df_consistency['consistency'] >= 0.8) & (df_consistency['consistency'] < 0.9)).sum()),
            '70-80%': int(((df_consistency['consistency'] >= 0.7) & (df_consistency['consistency'] < 0.8)).sum()),
            '<70%': int((df_consistency['consistency'] < 0.7).sum()),
        }
    }


def determine_optimal_hourly_thresholds(df: pd.DataFrame) -> dict:
    """Determine optimal thresholds for hourly data."""
    # Focus on midday hours (8 AM - 5 PM) for threshold determination
    midday = df[(df['HOUR_OF_DAY'] >= 8) & (df['HOUR_OF_DAY'] < 17)]

    # Get records with valid ratio
    valid = midday[midday['RATIO'].notna() & (midday['RATIO'] > 0)]

    if len(valid) == 0:
        return {'error': 'No valid data'}

    # Analyze ratio distribution
    ratio_percentiles = {
        'p1': float(valid['RATIO'].quantile(0.01)),
        'p2': float(valid['RATIO'].quantile(0.02)),
        'p5': float(valid['RATIO'].quantile(0.05)),
        'p10': float(valid['RATIO'].quantile(0.10)),
        'p25': float(valid['RATIO'].quantile(0.25)),
        'p50': float(valid['RATIO'].quantile(0.50)),
        'p75': float(valid['RATIO'].quantile(0.75)),
        'p90': float(valid['RATIO'].quantile(0.90)),
        'p95': float(valid['RATIO'].quantile(0.95)),
        'p98': float(valid['RATIO'].quantile(0.98)),
        'p99': float(valid['RATIO'].quantile(0.99)),
    }

    # Test different thresholds
    threshold_tests = []
    for min_ratio in [0.1, 0.15, 0.2, 0.25, 0.3]:
        for max_ratio in [1.5, 2.0, 2.5, 3.0]:
            valid_pct = ((valid['RATIO'] >= min_ratio) & (valid['RATIO'] <= max_ratio)).mean() * 100
            threshold_tests.append({
                'min_ratio': min_ratio,
                'max_ratio': max_ratio,
                'valid_pct': round(valid_pct, 1)
            })

    # Minimum irradiance thresholds
    min_irr_tests = []
    for min_irr in [5, 10, 20, 50, 100]:
        above_threshold = (valid['PREF_SATELLITE'] >= min_irr).sum()
        total = len(valid)
        min_irr_tests.append({
            'min_irradiance': min_irr,
            'records_above': above_threshold,
            'pct_above': round(above_threshold / total * 100, 1) if total > 0 else 0
        })

    return {
        'midday_records': len(valid),
        'ratio_percentiles': ratio_percentiles,
        'threshold_tests': threshold_tests,
        'min_irradiance_tests': min_irr_tests,
        'recommended_thresholds': {
            'min_irradiance_wm2': 50,  # W/m² minimum for hourly
            'ratio_min': 0.2,  # Same as daily
            'ratio_max': 2.0,  # Same as daily
            'dawn_dusk_ratio_min': 0.1,  # More lenient at edges
            'dawn_dusk_ratio_max': 5.0,  # More lenient at edges
        }
    }


def main():
    """Main analysis function."""
    print("=" * 70)
    print("HOURLY INSOLATION ANALYSIS")
    print("=" * 70)

    connector = get_snowflake_connection()

    # Pull 30 days of hourly data
    df = pull_hourly_data(connector, days=30)

    if df.empty:
        print("No data available!")
        return

    print(f"\nData range: {df['MEASUREMENTTIME'].min()} to {df['MEASUREMENTTIME'].max()}")
    print(f"Sites: {df['SITEID'].nunique()}")
    print(f"Total hourly records: {len(df):,}")

    # Compute metrics
    print("\nComputing hourly metrics...")
    df = compute_hourly_metrics(df)

    # Save full dataset
    output_dir = Path(__file__).parent
    df.to_csv(output_dir / "hourly_insolation_analysis.csv", index=False)
    print(f"Saved full dataset to hourly_insolation_analysis.csv")

    # Analyze by period
    print("\n" + "=" * 70)
    print("ANALYSIS BY TIME PERIOD")
    print("=" * 70)

    period_analysis = analyze_by_period(df)
    for period, stats in period_analysis.items():
        print(f"\n{period}:")
        print(f"  Total hours: {stats['total_hours']:,}")
        if stats['ratio_stats'].get('count', 0) > 0:
            rs = stats['ratio_stats']
            print(f"  Ratio stats (n={rs['count']:,}):")
            print(f"    Median: {rs['median']:.2f}")
            print(f"    P5-P95: {rs['p5']:.2f} - {rs['p95']:.2f}")
            print(f"    P10-P90: {rs['p10']:.2f} - {rs['p90']:.2f}")
        print(f"  Quality distribution:")
        for quality, count in sorted(stats['quality_distribution'].items(), key=lambda x: -x[1])[:5]:
            pct = count / stats['total_hours'] * 100
            print(f"    {quality}: {count:,} ({pct:.1f}%)")

    # Analyze by hour
    print("\n" + "=" * 70)
    print("ANALYSIS BY HOUR OF DAY")
    print("=" * 70)

    hourly_stats = analyze_by_hour(df)
    print("\nHour | Records | Valid Ratio | Median | P10-P90 | Good% | Dead%")
    print("-" * 70)
    for _, row in hourly_stats.iterrows():
        print(f"  {int(row['hour']):02d} | {int(row['total_records']):>7,} | {int(row['valid_ratio_records']):>7,} | "
              f"{row['ratio_median']:.2f} | {row['ratio_p10']:.2f}-{row['ratio_p90']:.2f} | "
              f"{row['good_pct']:.1f}% | {row['onsite_dead_pct']:.1f}%")

    hourly_stats.to_csv(output_dir / "hourly_stats_by_hour.csv", index=False)

    # Analyze source consistency
    print("\n" + "=" * 70)
    print("SOURCE CONSISTENCY WITHIN DAYS")
    print("=" * 70)

    consistency = analyze_source_consistency(df)
    if not consistency.get('no_data'):
        print(f"\nTotal site-days analyzed: {consistency['total_site_days']:,}")
        print(f"Average consistency: {consistency['avg_consistency']:.1%}")
        print(f"Site-days with >=80% consistency: {consistency['high_consistency_pct']:.1f}%")
        print("\nConsistency distribution:")
        for label, count in consistency['consistency_distribution'].items():
            print(f"  {label}: {count:,}")

    # Aggregate to daily and compare
    print("\n" + "=" * 70)
    print("HOURLY AGGREGATION TO DAILY")
    print("=" * 70)

    daily = aggregate_to_daily(df)
    print(f"\nSite-days aggregated: {len(daily):,}")

    valid_daily = daily[daily['DAILY_RATIO'].notna()]
    print(f"Site-days with valid ratio: {len(valid_daily):,}")
    print(f"\nDaily ratio distribution (from hourly aggregation):")
    print(f"  Median: {valid_daily['DAILY_RATIO'].median():.2f}")
    print(f"  Mean: {valid_daily['DAILY_RATIO'].mean():.2f}")
    print(f"  P5: {valid_daily['DAILY_RATIO'].quantile(0.05):.2f}")
    print(f"  P95: {valid_daily['DAILY_RATIO'].quantile(0.95):.2f}")
    print(f"  P98: {valid_daily['DAILY_RATIO'].quantile(0.98):.2f}")

    daily.to_csv(output_dir / "hourly_aggregated_to_daily.csv", index=False)

    # Determine optimal thresholds
    print("\n" + "=" * 70)
    print("OPTIMAL THRESHOLD ANALYSIS")
    print("=" * 70)

    thresholds = determine_optimal_hourly_thresholds(df)

    print(f"\nMidday records analyzed: {thresholds.get('midday_records', 0):,}")
    print("\nRatio percentiles (midday hours 8AM-5PM):")
    if 'ratio_percentiles' in thresholds:
        rp = thresholds['ratio_percentiles']
        print(f"  P1: {rp['p1']:.3f}  P5: {rp['p5']:.3f}  P10: {rp['p10']:.3f}")
        print(f"  P25: {rp['p25']:.3f}  P50: {rp['p50']:.3f}  P75: {rp['p75']:.3f}")
        print(f"  P90: {rp['p90']:.3f}  P95: {rp['p95']:.3f}  P99: {rp['p99']:.3f}")

    print("\nThreshold tests (% of midday records valid):")
    if 'threshold_tests' in thresholds:
        for test in thresholds['threshold_tests']:
            print(f"  Ratio {test['min_ratio']:.2f}-{test['max_ratio']:.1f}: {test['valid_pct']:.1f}%")

    print("\nRecommended hourly thresholds:")
    if 'recommended_thresholds' in thresholds:
        rt = thresholds['recommended_thresholds']
        print(f"  Minimum irradiance: {rt['min_irradiance_wm2']} W/m²")
        print(f"  Midday ratio range: {rt['ratio_min']} - {rt['ratio_max']}")
        print(f"  Dawn/dusk ratio range: {rt['dawn_dusk_ratio_min']} - {rt['dawn_dusk_ratio_max']}")

    # Save summary
    summary = {
        'analysis_date': datetime.now().isoformat(),
        'data_range': {
            'start': str(df['MEASUREMENTTIME'].min()),
            'end': str(df['MEASUREMENTTIME'].max()),
        },
        'sites_analyzed': int(df['SITEID'].nunique()),
        'total_hourly_records': int(len(df)),
        'period_analysis': period_analysis,
        'source_consistency': consistency,
        'optimal_thresholds': thresholds,
    }

    with open(output_dir / "hourly_insolation_summary.json", 'w') as f:
        json.dump(summary, f, indent=2, default=str)

    print(f"\nSaved summary to hourly_insolation_summary.json")

    connector.disconnect()
    print("\nAnalysis complete!")


if __name__ == "__main__":
    main()
