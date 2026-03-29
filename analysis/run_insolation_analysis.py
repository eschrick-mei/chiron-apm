#!/usr/bin/env python3
"""
Chiron APM - Insolation Selection Logic Research
Standalone script to analyze 90 days of insolation data.

Run from: CHIRON_MONITORING/Chiron_APM/analysis/
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path
import sys
import json

# Add parent paths for imports
SCRIPT_DIR = Path(__file__).parent
CHIRON_ROOT = SCRIPT_DIR.parent.parent
sys.path.insert(0, str(CHIRON_ROOT))
sys.path.insert(0, str(CHIRON_ROOT.parent))

from CHIRON_MONITORING.config import Config
from CHIRON_MONITORING.data import SnowflakeConnector

pd.set_option('display.max_columns', 50)
pd.set_option('display.width', 200)


def connect_snowflake():
    """Connect to Snowflake using Chiron config."""
    config_path = CHIRON_ROOT / "config.json"
    config = Config(config_file=str(config_path))
    connector = SnowflakeConnector(**config.snowflake.connection_params)
    return connector


def pull_daily_data(connector, start_date: str, end_date: str) -> pd.DataFrame:
    """Pull 90 days of daily data with all insolation sources."""

    query = f"""
    SELECT
        d.SITEID,
        d.SITENAME,
        d.MEASUREMENTTIME::DATE as DATE,
        d.STAGE,

        -- Production data
        d.PRODUCTION,
        d.EXPECTED_PRODUCTION,
        d.PRODUCTION_SOURCE,
        d.METER_ENERGY,
        d.INV_TOTAL_ENERGY,

        -- All raw insolation sources
        d.INSOLATION_POA as ONSITE_POA,
        d.INSOLATION_GHI as ONSITE_GHI,
        d.INSOLATION_GHI_SOLCAST as SATELLITE_GHI,
        d.INSOLATION_POA_SOLCAST as SATELLITE_POA,

        -- Expected insolation
        d.EXPECTED_INSOLATION_POA,
        d.EXPECTED_INSOLATION_GHI,

        -- View's current selection
        d.INSOLATION as VIEW_INSOLATION,
        d.INSOLATION_SOURCE as VIEW_SOURCE,
        d.INSOLATION_GAP as VIEW_GAP,
        d.WA_PERFORMANCE_RATIO as VIEW_WA_PR,
        d.PERFORMANCE_RATIO as VIEW_PR,

        -- Site metadata
        sm.IRRADIANCE_TYPE,
        sm.SIZE_KW_DC,
        sm.SIZE_KW_AC,
        sm.ADDRESS_STATE as STATE,
        sm.LATITUDE,
        sm.LONGITUDE

    FROM MEI_ASSET_MGMT_DB.PERFORMANCE.DAILY_DATA_LIVE d
    JOIN MEI_ASSET_MGMT_DB.PUBLIC.SITE_MASTER sm ON d.SITEID = sm.SITE_ID
    WHERE d.DATA_TYPE = 'current'
      AND d.MEASUREMENTTIME >= '{start_date}'
      AND d.MEASUREMENTTIME <= '{end_date}'
      AND d.STAGE = 'Post-FC'
    ORDER BY d.SITEID, d.MEASUREMENTTIME
    """

    print(f"Pulling data from {start_date} to {end_date}...")
    result = connector.execute_query(query)
    df = pd.DataFrame(result)
    df['DATE'] = pd.to_datetime(df['DATE'])

    # Convert Decimal columns to float for calculations
    numeric_cols = [
        'PRODUCTION', 'EXPECTED_PRODUCTION', 'METER_ENERGY', 'INV_TOTAL_ENERGY',
        'ONSITE_POA', 'ONSITE_GHI', 'SATELLITE_GHI', 'SATELLITE_POA',
        'EXPECTED_INSOLATION_POA', 'EXPECTED_INSOLATION_GHI',
        'VIEW_INSOLATION', 'VIEW_GAP', 'VIEW_WA_PR', 'VIEW_PR',
        'SIZE_KW_DC', 'SIZE_KW_AC', 'LATITUDE', 'LONGITUDE'
    ]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    return df


def compute_metrics(df: pd.DataFrame) -> pd.DataFrame:
    """Compute derived metrics for analysis."""
    data = df.copy()

    # Preferred onsite based on IRRADIANCE_TYPE
    data['PREFERRED_ONSITE'] = np.where(
        data['IRRADIANCE_TYPE'] == 2,  # POA preferred
        data['ONSITE_POA'],
        data['ONSITE_GHI']
    )

    # Ratio: onsite / satellite_ghi
    data['ONSITE_SAT_RATIO'] = data['PREFERRED_ONSITE'] / data['SATELLITE_GHI'].replace(0, np.nan)

    # Expected insolation based on type
    data['EXPECTED_INSOL'] = np.where(
        data['IRRADIANCE_TYPE'] == 2,
        data['EXPECTED_INSOLATION_POA'],
        data['EXPECTED_INSOLATION_GHI']
    )

    # Flags
    MIN_THRESHOLD = 100
    data['ONSITE_ZERO'] = data['PREFERRED_ONSITE'] < MIN_THRESHOLD
    data['SATELLITE_ZERO'] = data['SATELLITE_GHI'] < MIN_THRESHOLD
    data['RATIO_TOO_LOW'] = data['ONSITE_SAT_RATIO'] < 0.2
    data['RATIO_TOO_HIGH'] = data['ONSITE_SAT_RATIO'] > 5.0
    data['RATIO_REASONABLE'] = (data['ONSITE_SAT_RATIO'] >= 0.5) & (data['ONSITE_SAT_RATIO'] <= 2.0)
    data['WA_PR_HIGH'] = data['VIEW_WA_PR'] > 1.2
    data['WA_PR_LOW'] = data['VIEW_WA_PR'] < 0.5

    return data


def categorize_failure_mode(row) -> str:
    """Categorize each site-day into a failure mode."""
    onsite = row['PREFERRED_ONSITE'] if pd.notna(row['PREFERRED_ONSITE']) else 0
    satellite = row['SATELLITE_GHI'] if pd.notna(row['SATELLITE_GHI']) else 0
    ratio = row['ONSITE_SAT_RATIO'] if pd.notna(row['ONSITE_SAT_RATIO']) else None
    wa_pr = row['VIEW_WA_PR'] if pd.notna(row['VIEW_WA_PR']) else None

    if onsite < 100 and satellite >= 100:
        return 'ONSITE_DEAD'
    if satellite < 100 and onsite >= 100:
        return 'SATELLITE_MISSING'
    if onsite < 100 and satellite < 100:
        return 'BOTH_MISSING'

    if ratio is not None:
        if ratio < 0.2:
            return 'ONSITE_STUCK_LOW'
        if ratio > 5.0:
            return 'ONSITE_EXTREME_HIGH'
        if ratio > 1.5 and wa_pr is not None and wa_pr <= 1.0:
            return 'SATELLITE_LOW_MISS'
        if ratio < 0.7 and wa_pr is not None and wa_pr >= 0.7:
            return 'SATELLITE_HIGH_MISS'
        if ratio > 1.5 and wa_pr is not None and wa_pr > 1.2:
            return 'ONSITE_SUSPICIOUS_HIGH'
        if ratio < 0.7 and wa_pr is not None and wa_pr < 0.6:
            return 'ONSITE_SUSPICIOUS_LOW'
        if 0.7 <= ratio <= 1.5:
            return 'GOOD_AGREEMENT'

    return 'MODERATE_DEVIATION'


def select_insolation_v2(row) -> tuple:
    """
    Improved insolation selection logic.
    Returns: (value, source, is_valid, reason)
    """
    MIN_THRESHOLD = 200
    RATIO_MIN = 0.5
    RATIO_MAX = 3.0
    EXPECTED_MIN_PCT = 0.10

    onsite_poa = float(row.get('ONSITE_POA', 0) or 0)
    onsite_ghi = float(row.get('ONSITE_GHI', 0) or 0)
    satellite_ghi = float(row.get('SATELLITE_GHI', 0) or 0)
    expected_poa = float(row.get('EXPECTED_INSOLATION_POA', 0) or 0)
    expected_ghi = float(row.get('EXPECTED_INSOLATION_GHI', 0) or 0)
    irr_type_val = row.get('IRRADIANCE_TYPE', 2)
    irradiance_type = int(irr_type_val) if pd.notna(irr_type_val) else 2

    if irradiance_type == 2:
        primary_onsite, primary_expected = onsite_poa, expected_poa
        secondary_onsite, secondary_expected = onsite_ghi, expected_ghi
    else:
        primary_onsite, primary_expected = onsite_ghi, expected_ghi
        secondary_onsite, secondary_expected = onsite_poa, expected_poa

    def is_valid(onsite, expected, satellite):
        if onsite < MIN_THRESHOLD:
            return False, 'below_min'
        if expected > 0:
            expected_ratio = onsite / expected
            if expected_ratio < EXPECTED_MIN_PCT:
                return False, 'below_expected'
            if expected_ratio > 2.0:
                return False, 'above_expected'
        if satellite > MIN_THRESHOLD:
            sat_ratio = onsite / satellite
            if sat_ratio < RATIO_MIN or sat_ratio > RATIO_MAX:
                return False, 'satellite_mismatch'
        return True, 'ok'

    valid, reason = is_valid(primary_onsite, primary_expected, satellite_ghi)
    if valid:
        source = 'POA' if irradiance_type == 2 else 'GHI'
        return primary_onsite, source, True, reason

    valid, reason = is_valid(secondary_onsite, secondary_expected, satellite_ghi)
    if valid:
        source = 'GHI_FALLBACK' if irradiance_type == 2 else 'POA_FALLBACK'
        return secondary_onsite, source, True, reason

    if satellite_ghi > MIN_THRESHOLD:
        if irradiance_type == 2:
            return satellite_ghi * 1.15, 'SATELLITE_POA_EST', True, 'satellite_adjusted'
        return satellite_ghi, 'SATELLITE_GHI', True, 'satellite_direct'

    return max(primary_onsite, satellite_ghi, 0), 'NONE', False, 'no_valid_data'


def print_summary(data: pd.DataFrame, start_date: str, end_date: str):
    """Print comprehensive analysis summary."""

    print("\n" + "=" * 80)
    print("INSOLATION SELECTION RESEARCH - ANALYSIS SUMMARY")
    print("=" * 80)

    print(f"\nANALYSIS PERIOD: {start_date} to {end_date}")
    print(f"SITES ANALYZED: {data['SITEID'].nunique()}")
    print(f"SITE-DAYS: {len(data):,}")

    # Data overview
    print("\n" + "-" * 40)
    print("DATA OVERVIEW")
    print("-" * 40)
    print(f"\nIrradiance Type Distribution:")
    print(data['IRRADIANCE_TYPE'].value_counts().to_string())
    print(f"\nView Source Distribution:")
    print(data['VIEW_SOURCE'].value_counts().to_string())

    # Problem flags
    print("\n" + "-" * 40)
    print("PROBLEM FLAGS")
    print("-" * 40)
    print(f"\nOnsite Zero (< 100 Wh/m2): {data['ONSITE_ZERO'].sum():,} ({data['ONSITE_ZERO'].mean()*100:.1f}%)")
    print(f"Satellite Zero (< 100 Wh/m2): {data['SATELLITE_ZERO'].sum():,} ({data['SATELLITE_ZERO'].mean()*100:.1f}%)")
    print(f"\nRatio < 0.2 (onsite way lower): {data['RATIO_TOO_LOW'].sum():,} ({data['RATIO_TOO_LOW'].mean()*100:.1f}%)")
    print(f"Ratio > 5.0 (onsite way higher): {data['RATIO_TOO_HIGH'].sum():,} ({data['RATIO_TOO_HIGH'].mean()*100:.1f}%)")
    print(f"Ratio 0.5-2.0 (reasonable): {data['RATIO_REASONABLE'].sum():,} ({data['RATIO_REASONABLE'].mean()*100:.1f}%)")
    print(f"\nWA PR > 120%: {data['WA_PR_HIGH'].sum():,} ({data['WA_PR_HIGH'].mean()*100:.1f}%)")
    print(f"WA PR < 50%: {data['WA_PR_LOW'].sum():,} ({data['WA_PR_LOW'].mean()*100:.1f}%)")

    # Failure mode distribution
    print("\n" + "-" * 40)
    print("FAILURE MODE DISTRIBUTION")
    print("-" * 40)
    failure_counts = data['FAILURE_MODE'].value_counts()
    for mode, count in failure_counts.items():
        pct = count / len(data) * 100
        print(f"  {mode}: {count:,} ({pct:.1f}%)")

    # Onsite/Satellite ratio statistics
    valid_ratio = data[~data['ONSITE_ZERO'] & ~data['SATELLITE_ZERO']]['ONSITE_SAT_RATIO']
    print("\n" + "-" * 40)
    print("ONSITE/SATELLITE RATIO STATISTICS (valid data only)")
    print("-" * 40)
    print(valid_ratio.describe(percentiles=[0.01, 0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99]).to_string())

    # New logic comparison
    print("\n" + "-" * 40)
    print("NEW SELECTION LOGIC COMPARISON")
    print("-" * 40)
    old_high = data['WA_PR_HIGH'].sum()
    new_high = (data['NEW_WA_PR'] > 1.2).sum()
    old_low = data['WA_PR_LOW'].sum()
    new_low = (data['NEW_WA_PR'] < 0.5).sum()
    source_changed = (data['VIEW_SOURCE'] != data['NEW_SOURCE']).sum()

    print(f"\nSource changed: {source_changed:,} site-days ({source_changed/len(data)*100:.1f}%)")
    print(f"\nNew source distribution:")
    print(data['NEW_SOURCE'].value_counts().to_string())
    print(f"\nWA PR > 120%:")
    print(f"  Old: {old_high:,} ({old_high/len(data)*100:.2f}%)")
    print(f"  New: {new_high:,} ({new_high/len(data)*100:.2f}%)")
    if old_high > 0:
        print(f"  Reduction: {old_high - new_high:,} ({(old_high - new_high)/old_high*100:.1f}% improvement)")
    print(f"\nWA PR < 50%:")
    print(f"  Old: {old_low:,} ({old_low/len(data)*100:.2f}%)")
    print(f"  New: {new_low:,} ({new_low/len(data)*100:.2f}%)")


def identify_problem_sites(data: pd.DataFrame) -> pd.DataFrame:
    """Aggregate by site to find chronic issues."""

    site_summary = data.groupby('SITEID').agg({
        'SITENAME': 'first',
        'STATE': 'first',
        'IRRADIANCE_TYPE': 'first',
        'SIZE_KW_DC': 'first',
        'DATE': 'count',
        'ONSITE_ZERO': 'sum',
        'SATELLITE_ZERO': 'sum',
        'RATIO_TOO_LOW': 'sum',
        'RATIO_TOO_HIGH': 'sum',
        'RATIO_REASONABLE': 'sum',
        'WA_PR_HIGH': 'sum',
        'WA_PR_LOW': 'sum',
        'ONSITE_SAT_RATIO': ['mean', 'std'],
        'VIEW_WA_PR': ['mean', 'std']
    }).reset_index()

    # Flatten column names
    site_summary.columns = ['_'.join(col).strip('_') if isinstance(col, tuple) else col
                            for col in site_summary.columns]

    site_summary = site_summary.rename(columns={
        'DATE_count': 'DAYS',
        'ONSITE_ZERO_sum': 'DAYS_ONSITE_ZERO',
        'SATELLITE_ZERO_sum': 'DAYS_SATELLITE_ZERO',
        'RATIO_TOO_LOW_sum': 'DAYS_RATIO_LOW',
        'RATIO_TOO_HIGH_sum': 'DAYS_RATIO_HIGH',
        'RATIO_REASONABLE_sum': 'DAYS_RATIO_OK',
        'WA_PR_HIGH_sum': 'DAYS_WA_PR_HIGH',
        'WA_PR_LOW_sum': 'DAYS_WA_PR_LOW',
        'ONSITE_SAT_RATIO_mean': 'AVG_RATIO',
        'ONSITE_SAT_RATIO_std': 'STD_RATIO',
        'VIEW_WA_PR_mean': 'AVG_WA_PR',
        'VIEW_WA_PR_std': 'STD_WA_PR'
    })

    # Calculate percentages
    site_summary['PCT_ONSITE_ZERO'] = (site_summary['DAYS_ONSITE_ZERO'] / site_summary['DAYS'] * 100).round(1)
    site_summary['PCT_WA_PR_HIGH'] = (site_summary['DAYS_WA_PR_HIGH'] / site_summary['DAYS'] * 100).round(1)

    # Filter to problem sites
    problem_sites = site_summary[
        (site_summary['PCT_ONSITE_ZERO'] > 20) |
        (site_summary['PCT_WA_PR_HIGH'] > 15) |
        (site_summary['AVG_RATIO'] < 0.5) |
        (site_summary['AVG_RATIO'] > 2.0)
    ].copy()

    # Add recommendation
    def get_recommendation(row):
        issues = []
        if row['PCT_ONSITE_ZERO'] > 50:
            issues.append('CHECK_SENSOR_CONNECTION')
        elif row['PCT_ONSITE_ZERO'] > 20:
            issues.append('INTERMITTENT_SENSOR')
        if row['AVG_RATIO'] < 0.5:
            issues.append('SENSOR_LOW_OUTPUT')
        elif row['AVG_RATIO'] > 2.0:
            issues.append('SENSOR_HIGH_OUTPUT_OR_WRONG_TYPE')
        if row['PCT_WA_PR_HIGH'] > 30:
            issues.append('USE_SATELLITE_DATA')
        return ', '.join(issues) if issues else 'MONITOR'

    problem_sites['RECOMMENDATION'] = problem_sites.apply(get_recommendation, axis=1)

    return problem_sites.sort_values('PCT_WA_PR_HIGH', ascending=False)


def print_recommendations():
    """Print recommended threshold changes."""
    print("\n" + "=" * 80)
    print("RECOMMENDED THRESHOLD CHANGES")
    print("=" * 80)
    print("""
1. MINIMUM INSOLATION THRESHOLD
   Current: 100 Wh/m2/day
   Recommended: 200 Wh/m2/day
   Rationale: Values below 200 are rare on sunny days and often indicate sensor issues

2. ONSITE/SATELLITE RATIO BOUNDS
   Current: 0.2 - 5.0
   Recommended: 0.5 - 2.5 (or 0.6 - 2.0 for stricter)
   Rationale:
   - Ratios < 0.5 strongly correlate with low WA PR (onsite sensor dead/dirty)
   - Ratios > 2.5 strongly correlate with high WA PR (sensor error or POA vs GHI confusion)
   - POA should be 10-30% higher than GHI, so POA/satellite_GHI ratio of 1.3 is normal

3. EXPECTED INSOLATION CHECK
   Current: > 5% of expected
   Recommended: > 20% of expected AND < 150% of expected
   Rationale: Catches both low and high sensor errors

4. POA vs GHI ADJUSTMENT
   When using satellite GHI for a POA site, multiply by 1.15 to estimate POA
   This prevents systematic underestimation of expected production

5. ROLLING WINDOW VALIDATION (Future Enhancement)
   Flag sensors with high day-to-day variance (std > 1.5) as suspicious
   Detect stuck sensors: same value +/- 5% for 3+ consecutive days
""")


def main():
    """Main analysis entry point."""

    # Date range
    end_date = datetime.now().strftime('%Y-%m-%d')
    start_date = (datetime.now() - timedelta(days=90)).strftime('%Y-%m-%d')

    print("Connecting to Snowflake...")
    connector = connect_snowflake()

    try:
        # Pull data
        df = pull_daily_data(connector, start_date, end_date)
        print(f"Loaded {len(df):,} site-days from {df['SITEID'].nunique()} sites")

        # Compute metrics
        print("Computing metrics...")
        data = compute_metrics(df)

        # Categorize failure modes
        print("Categorizing failure modes...")
        data['FAILURE_MODE'] = data.apply(categorize_failure_mode, axis=1)

        # Apply new selection logic
        print("Applying improved selection logic...")
        results = data.apply(select_insolation_v2, axis=1, result_type='expand')
        data['NEW_INSOLATION'] = results[0]
        data['NEW_SOURCE'] = results[1]
        data['NEW_VALID'] = results[2]
        data['NEW_REASON'] = results[3]

        # Compute new WA PR
        data['NEW_GAP'] = (data['NEW_INSOLATION'] / data['EXPECTED_INSOL'].replace(0, np.nan)) - 1
        data['NEW_WA_EXPECTED'] = data['EXPECTED_PRODUCTION'] * (1 + data['NEW_GAP'])
        data['NEW_WA_PR'] = data['PRODUCTION'] / data['NEW_WA_EXPECTED'].replace(0, np.nan)

        # Print summary
        print_summary(data, start_date, end_date)

        # Identify problem sites
        print("\n" + "-" * 40)
        print("TOP PROBLEM SITES")
        print("-" * 40)
        problem_sites = identify_problem_sites(data)
        print(f"\nSites requiring attention: {len(problem_sites)}")
        if len(problem_sites) > 0:
            cols = ['SITEID', 'SITENAME_first', 'STATE_first', 'DAYS', 'PCT_ONSITE_ZERO', 'PCT_WA_PR_HIGH', 'AVG_RATIO', 'RECOMMENDATION']
            cols = [c for c in cols if c in problem_sites.columns]
            print(problem_sites[cols].head(20).to_string())

        # Print recommendations
        print_recommendations()

        # Save outputs
        output_dir = SCRIPT_DIR

        # Save problem sites
        problem_file = output_dir / 'problem_sites_insolation.csv'
        problem_sites.to_csv(problem_file, index=False)
        print(f"\nSaved problem sites to {problem_file}")

        # Save full analysis
        analysis_cols = ['SITEID', 'DATE', 'STATE', 'IRRADIANCE_TYPE',
                        'ONSITE_POA', 'ONSITE_GHI', 'SATELLITE_GHI',
                        'ONSITE_SAT_RATIO', 'VIEW_SOURCE', 'VIEW_WA_PR',
                        'NEW_SOURCE', 'NEW_WA_PR', 'FAILURE_MODE']
        analysis_file = output_dir / 'insolation_analysis_full.csv'
        data[analysis_cols].to_csv(analysis_file, index=False)
        print(f"Saved full analysis to {analysis_file} ({len(data):,} rows)")

        # Save summary JSON
        summary = {
            'analysis_period': f"{start_date} to {end_date}",
            'sites_analyzed': int(data['SITEID'].nunique()),
            'site_days': len(data),
            'onsite_zero_pct': round(data['ONSITE_ZERO'].mean() * 100, 2),
            'satellite_zero_pct': round(data['SATELLITE_ZERO'].mean() * 100, 2),
            'ratio_reasonable_pct': round(data['RATIO_REASONABLE'].mean() * 100, 2),
            'wa_pr_high_pct_old': round(data['WA_PR_HIGH'].mean() * 100, 2),
            'wa_pr_high_pct_new': round((data['NEW_WA_PR'] > 1.2).mean() * 100, 2),
            'problem_sites_count': len(problem_sites),
            'failure_mode_distribution': data['FAILURE_MODE'].value_counts().to_dict(),
            'recommended_thresholds': {
                'min_insolation': 200,
                'ratio_min': 0.5,
                'ratio_max': 2.5,
                'expected_min_pct': 0.20,
                'expected_max_pct': 1.50,
                'poa_satellite_adjustment': 1.15
            }
        }
        summary_file = output_dir / 'insolation_analysis_summary.json'
        with open(summary_file, 'w') as f:
            json.dump(summary, f, indent=2, default=str)
        print(f"Saved summary to {summary_file}")

    finally:
        connector.disconnect()
        print("\nSnowflake connection closed.")


if __name__ == '__main__':
    main()
