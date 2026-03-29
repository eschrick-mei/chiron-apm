"""
Improved Insolation Selection Logic for Chiron APM

This module contains the improved insolation selection algorithm based on
90-day analysis of 547 sites (49,230 site-days).

Key improvements:
- Stricter minimum threshold (200 vs 100 Wh/m²/day)
- Tighter ratio bounds (0.5-2.5 vs 0.2-5.0)
- Upper bound check on expected (< 150%)
- POA adjustment when using satellite GHI (×1.15)
- Better quality flagging

Expected impact:
- WA PR > 120% reduced by 55% (13.0% → 5.9%)
- WA PR < 50% reduced by 48% (31.5% → 16.4%)

Usage:
    from improved_insolation_logic import select_best_insolation_v2

    insolation, source, is_valid, quality = select_best_insolation_v2(
        onsite_poa=1500,
        onsite_ghi=1400,
        satellite_ghi=5000,
        expected_poa=5500,
        expected_ghi=5000,
        irradiance_type=2  # 1=GHI, 2=POA
    )
"""

from typing import Tuple, Optional
from dataclasses import dataclass
from enum import Enum
import pandas as pd
import numpy as np


class InsolationSource(Enum):
    """Enum for insolation source types."""
    POA = "POA"
    GHI = "GHI"
    POA_FALLBACK = "POA_FALLBACK"
    GHI_FALLBACK = "GHI_FALLBACK"
    SATELLITE_GHI = "SATELLITE_GHI"
    SATELLITE_POA_EST = "SATELLITE_POA_EST"
    NONE = "NONE"


class InsolationQuality(Enum):
    """Quality classification for insolation selection."""
    GOOD = "GOOD"               # Primary source valid
    FALLBACK = "FALLBACK"       # Secondary onsite source used
    SATELLITE = "SATELLITE"     # Satellite data used
    INVALID = "INVALID"         # No valid data available


@dataclass
class InsolationConfig:
    """Configuration for insolation selection thresholds."""
    min_threshold: float = 200.0        # Minimum valid insolation (Wh/m²/day)
    ratio_min: float = 0.5              # Minimum onsite/satellite ratio
    ratio_max: float = 2.5              # Maximum onsite/satellite ratio
    expected_min_pct: float = 0.20      # Minimum % of expected
    expected_max_pct: float = 1.50      # Maximum % of expected
    poa_adjustment: float = 1.15        # POA estimation from GHI


# Default configuration
DEFAULT_CONFIG = InsolationConfig()


def is_onsite_valid(
    onsite: float,
    expected: float,
    satellite: float,
    config: InsolationConfig = DEFAULT_CONFIG
) -> Tuple[bool, str]:
    """
    Validate onsite insolation reading against expected and satellite.

    Args:
        onsite: Onsite insolation reading (Wh/m²/day)
        expected: Expected insolation from forecast (Wh/m²/day)
        satellite: Satellite GHI reading (Wh/m²/day)
        config: Validation configuration

    Returns:
        Tuple of (is_valid, rejection_reason)
    """
    # Must exceed minimum threshold
    if onsite < config.min_threshold:
        return False, "below_min_threshold"

    # Check against expected (if available)
    if expected > 0:
        expected_ratio = onsite / expected
        if expected_ratio < config.expected_min_pct:
            return False, "below_expected"
        if expected_ratio > config.expected_max_pct:
            return False, "above_expected"

    # Cross-validate against satellite (if available)
    if satellite >= config.min_threshold:
        sat_ratio = onsite / satellite
        if sat_ratio < config.ratio_min:
            return False, "ratio_too_low"
        if sat_ratio > config.ratio_max:
            return False, "ratio_too_high"

    return True, "valid"


def select_best_insolation_v2(
    onsite_poa: float,
    onsite_ghi: float,
    satellite_ghi: float,
    expected_poa: float = 0,
    expected_ghi: float = 0,
    irradiance_type: int = 2,
    config: InsolationConfig = DEFAULT_CONFIG
) -> Tuple[float, str, bool, str]:
    """
    Improved insolation selection with stricter validation.

    Args:
        onsite_poa: POA pyranometer reading (Wh/m²/day)
        onsite_ghi: GHI pyranometer reading (Wh/m²/day)
        satellite_ghi: Satellite GHI data (Wh/m²/day)
        expected_poa: Expected POA from forecast (Wh/m²/day)
        expected_ghi: Expected GHI from forecast (Wh/m²/day)
        irradiance_type: 1=GHI preferred, 2=POA preferred
        config: Validation configuration

    Returns:
        Tuple of (insolation_value, source, is_valid, quality)
    """
    # Handle NaN/None values
    onsite_poa = float(onsite_poa) if pd.notna(onsite_poa) else 0.0
    onsite_ghi = float(onsite_ghi) if pd.notna(onsite_ghi) else 0.0
    satellite_ghi = float(satellite_ghi) if pd.notna(satellite_ghi) else 0.0
    expected_poa = float(expected_poa) if pd.notna(expected_poa) else 0.0
    expected_ghi = float(expected_ghi) if pd.notna(expected_ghi) else 0.0

    # Determine primary/secondary based on site preference
    if irradiance_type == 2:  # POA preferred
        primary_onsite = onsite_poa
        primary_expected = expected_poa
        primary_source = InsolationSource.POA.value
        secondary_onsite = onsite_ghi
        secondary_expected = expected_ghi
        secondary_source = InsolationSource.GHI_FALLBACK.value
        satellite_source = InsolationSource.SATELLITE_POA_EST.value
        apply_poa_adjustment = True
    else:  # GHI preferred
        primary_onsite = onsite_ghi
        primary_expected = expected_ghi
        primary_source = InsolationSource.GHI.value
        secondary_onsite = onsite_poa
        secondary_expected = expected_poa
        secondary_source = InsolationSource.POA_FALLBACK.value
        satellite_source = InsolationSource.SATELLITE_GHI.value
        apply_poa_adjustment = False

    # Try primary onsite source
    valid, reason = is_onsite_valid(primary_onsite, primary_expected, satellite_ghi, config)
    if valid:
        return primary_onsite, primary_source, True, InsolationQuality.GOOD.value

    # Try secondary onsite source (fallback type)
    valid, reason = is_onsite_valid(secondary_onsite, secondary_expected, satellite_ghi, config)
    if valid:
        return secondary_onsite, secondary_source, True, InsolationQuality.FALLBACK.value

    # Use satellite as last resort
    if satellite_ghi >= config.min_threshold:
        if apply_poa_adjustment:
            # For POA sites, adjust satellite GHI upward by ~15% to estimate POA
            adjusted_satellite = satellite_ghi * config.poa_adjustment
            return adjusted_satellite, satellite_source, True, InsolationQuality.SATELLITE.value
        return satellite_ghi, InsolationSource.SATELLITE_GHI.value, True, InsolationQuality.SATELLITE.value

    # No valid data available
    best_available = max(primary_onsite, satellite_ghi, 0)
    return best_available, InsolationSource.NONE.value, False, InsolationQuality.INVALID.value


def select_best_insolation_row(
    row: pd.Series,
    config: InsolationConfig = DEFAULT_CONFIG
) -> Tuple[float, str, bool, str]:
    """
    Row-wise insolation selection for pandas DataFrames.

    Expected columns:
        - ONSITE_POA or INSOLATION_POA
        - ONSITE_GHI or INSOLATION_GHI
        - SATELLITE_GHI or INSOLATION_GHI_SOLCAST
        - EXPECTED_INSOLATION_POA (optional)
        - EXPECTED_INSOLATION_GHI (optional)
        - IRRADIANCE_TYPE

    Args:
        row: pandas Series with insolation data
        config: Validation configuration

    Returns:
        Tuple of (insolation_value, source, is_valid, quality)
    """
    # Get values with column name flexibility
    onsite_poa = row.get('ONSITE_POA', row.get('INSOLATION_POA', 0))
    onsite_ghi = row.get('ONSITE_GHI', row.get('INSOLATION_GHI', 0))
    satellite_ghi = row.get('SATELLITE_GHI', row.get('INSOLATION_GHI_SOLCAST', 0))
    expected_poa = row.get('EXPECTED_INSOLATION_POA', 0)
    expected_ghi = row.get('EXPECTED_INSOLATION_GHI', 0)

    # Handle irradiance type
    irr_type = row.get('IRRADIANCE_TYPE', 2)
    irradiance_type = int(irr_type) if pd.notna(irr_type) else 2

    return select_best_insolation_v2(
        onsite_poa=onsite_poa,
        onsite_ghi=onsite_ghi,
        satellite_ghi=satellite_ghi,
        expected_poa=expected_poa,
        expected_ghi=expected_ghi,
        irradiance_type=irradiance_type,
        config=config
    )


def apply_improved_selection(
    df: pd.DataFrame,
    config: InsolationConfig = DEFAULT_CONFIG
) -> pd.DataFrame:
    """
    Apply improved insolation selection to a DataFrame.

    Args:
        df: DataFrame with insolation columns
        config: Validation configuration

    Returns:
        DataFrame with new columns:
        - SMART_INSOLATION
        - SMART_SOURCE
        - SMART_VALID
        - SMART_QUALITY
        - SMART_GAP (if expected columns present)
        - SMART_WA_PR (if production columns present)
    """
    result = df.copy()

    # Apply selection logic
    selections = result.apply(lambda row: select_best_insolation_row(row, config), axis=1)
    result['SMART_INSOLATION'] = selections.apply(lambda x: x[0])
    result['SMART_SOURCE'] = selections.apply(lambda x: x[1])
    result['SMART_VALID'] = selections.apply(lambda x: x[2])
    result['SMART_QUALITY'] = selections.apply(lambda x: x[3])

    # Compute gap if expected columns present
    expected_col = 'EXPECTED_INSOLATION_POA' if 'EXPECTED_INSOLATION_POA' in result.columns else None
    if expected_col is None and 'EXPECTED_INSOLATION_GHI' in result.columns:
        expected_col = 'EXPECTED_INSOLATION_GHI'

    if expected_col:
        result['SMART_GAP'] = (
            result['SMART_INSOLATION'] / result[expected_col].replace(0, np.nan)
        ) - 1

    # Compute WA PR if production columns present
    if 'PRODUCTION' in result.columns and 'EXPECTED_PRODUCTION' in result.columns and expected_col:
        result['SMART_WA_EXPECTED'] = result['EXPECTED_PRODUCTION'] * (1 + result['SMART_GAP'])
        result['SMART_WA_PR'] = result['PRODUCTION'] / result['SMART_WA_EXPECTED'].replace(0, np.nan)

    return result


def diagnose_site_insolation(
    df: pd.DataFrame,
    site_id: str,
    config: InsolationConfig = DEFAULT_CONFIG
) -> dict:
    """
    Diagnose insolation quality for a specific site.

    Args:
        df: DataFrame with insolation data
        site_id: Site ID to diagnose
        config: Validation configuration

    Returns:
        Dictionary with diagnostic metrics
    """
    site_data = df[df['SITEID'] == site_id].copy()

    if len(site_data) == 0:
        return {'error': f'Site {site_id} not found'}

    # Apply improved selection
    site_data = apply_improved_selection(site_data, config)

    # Compute diagnostics
    total_days = len(site_data)

    # Get onsite column names
    poa_col = 'ONSITE_POA' if 'ONSITE_POA' in site_data.columns else 'INSOLATION_POA'
    ghi_col = 'ONSITE_GHI' if 'ONSITE_GHI' in site_data.columns else 'INSOLATION_GHI'
    sat_col = 'SATELLITE_GHI' if 'SATELLITE_GHI' in site_data.columns else 'INSOLATION_GHI_SOLCAST'

    onsite_zero_days = (site_data[poa_col] < config.min_threshold).sum()
    satellite_days = (site_data['SMART_SOURCE'].str.contains('SATELLITE')).sum()

    # Compute ratios for valid data
    valid_mask = (site_data[poa_col] >= config.min_threshold) & (site_data[sat_col] >= config.min_threshold)
    valid_data = site_data[valid_mask]

    if len(valid_data) > 0:
        ratios = valid_data[poa_col] / valid_data[sat_col]
        avg_ratio = ratios.mean()
        std_ratio = ratios.std()
    else:
        avg_ratio = None
        std_ratio = None

    # WA PR stats
    wa_pr_col = 'SMART_WA_PR' if 'SMART_WA_PR' in site_data.columns else 'VIEW_WA_PR'
    if wa_pr_col in site_data.columns:
        high_wa_pr_days = (site_data[wa_pr_col] > 1.2).sum()
        low_wa_pr_days = (site_data[wa_pr_col] < 0.5).sum()
        avg_wa_pr = site_data[wa_pr_col].mean()
    else:
        high_wa_pr_days = None
        low_wa_pr_days = None
        avg_wa_pr = None

    return {
        'site_id': site_id,
        'total_days': total_days,
        'onsite_zero_days': int(onsite_zero_days),
        'onsite_zero_pct': round(onsite_zero_days / total_days * 100, 1),
        'satellite_days': int(satellite_days),
        'satellite_pct': round(satellite_days / total_days * 100, 1),
        'avg_onsite_sat_ratio': round(avg_ratio, 3) if avg_ratio else None,
        'std_onsite_sat_ratio': round(std_ratio, 3) if std_ratio else None,
        'high_wa_pr_days': int(high_wa_pr_days) if high_wa_pr_days else None,
        'low_wa_pr_days': int(low_wa_pr_days) if low_wa_pr_days else None,
        'avg_wa_pr': round(avg_wa_pr, 3) if avg_wa_pr else None,
        'source_distribution': site_data['SMART_SOURCE'].value_counts().to_dict(),
        'quality_distribution': site_data['SMART_QUALITY'].value_counts().to_dict(),
        'recommendation': _get_recommendation(
            onsite_zero_days / total_days,
            avg_ratio,
            high_wa_pr_days / total_days if high_wa_pr_days else 0
        )
    }


def _get_recommendation(onsite_zero_pct: float, avg_ratio: Optional[float], high_wa_pr_pct: float) -> str:
    """Generate recommendation based on diagnostics."""
    issues = []

    if onsite_zero_pct > 0.5:
        issues.append('CHECK_SENSOR_CONNECTION')
    elif onsite_zero_pct > 0.2:
        issues.append('INTERMITTENT_SENSOR')

    if avg_ratio is not None:
        if avg_ratio < 0.5:
            issues.append('SENSOR_LOW_OUTPUT')
        elif avg_ratio > 2.0:
            issues.append('SENSOR_HIGH_OUTPUT_OR_WRONG_TYPE')

    if high_wa_pr_pct > 0.3:
        issues.append('USE_SATELLITE_DATA')

    return ', '.join(issues) if issues else 'OK'


# =============================================================================
# Test Cases
# =============================================================================

def run_test_cases():
    """Run test cases to validate the improved logic."""
    print("=" * 60)
    print("INSOLATION SELECTION TEST CASES")
    print("=" * 60)

    test_cases = [
        {
            'name': 'Dead onsite sensor - should use satellite',
            'onsite_poa': 8,
            'onsite_ghi': 12,
            'satellite_ghi': 4250,
            'expected_poa': 4800,
            'expected_ghi': 4200,
            'irradiance_type': 2,
            'expected_source': 'SATELLITE_POA_EST'
        },
        {
            'name': 'Good onsite POA - should use POA',
            'onsite_poa': 5500,
            'onsite_ghi': 4800,
            'satellite_ghi': 5000,
            'expected_poa': 5500,
            'expected_ghi': 5000,
            'irradiance_type': 2,
            'expected_source': 'POA'
        },
        {
            'name': 'Onsite too low vs satellite - should use satellite',
            'onsite_poa': 1000,
            'onsite_ghi': 900,
            'satellite_ghi': 5000,
            'expected_poa': 5500,
            'expected_ghi': 5000,
            'irradiance_type': 2,
            'expected_source': 'SATELLITE_POA_EST'  # ratio = 0.2, below 0.5
        },
        {
            'name': 'Onsite too high vs expected - should use satellite',
            'onsite_poa': 10000,
            'onsite_ghi': 9000,
            'satellite_ghi': 5000,
            'expected_poa': 5500,
            'expected_ghi': 5000,
            'irradiance_type': 2,
            'expected_source': 'SATELLITE_POA_EST'  # ratio to expected = 1.8, above 1.5
        },
        {
            'name': 'GHI site with good data - should use GHI',
            'onsite_poa': 5500,
            'onsite_ghi': 4800,
            'satellite_ghi': 5000,
            'expected_poa': 5500,
            'expected_ghi': 5000,
            'irradiance_type': 1,  # GHI preferred
            'expected_source': 'GHI'
        },
        {
            'name': 'POA failed, GHI valid - should use GHI fallback',
            'onsite_poa': 50,  # Dead
            'onsite_ghi': 4800,
            'satellite_ghi': 5000,
            'expected_poa': 5500,
            'expected_ghi': 5000,
            'irradiance_type': 2,
            'expected_source': 'GHI_FALLBACK'
        },
        {
            'name': 'Cloudy day - onsite lower but valid',
            'onsite_poa': 2000,
            'onsite_ghi': 1800,
            'satellite_ghi': 3000,
            'expected_poa': 5500,
            'expected_ghi': 5000,
            'irradiance_type': 2,
            'expected_source': 'POA'  # ratio = 0.67, acceptable for cloudy day
        },
    ]

    passed = 0
    failed = 0

    for tc in test_cases:
        value, source, is_valid, quality = select_best_insolation_v2(
            onsite_poa=tc['onsite_poa'],
            onsite_ghi=tc['onsite_ghi'],
            satellite_ghi=tc['satellite_ghi'],
            expected_poa=tc['expected_poa'],
            expected_ghi=tc['expected_ghi'],
            irradiance_type=tc['irradiance_type']
        )

        status = "PASS" if source == tc['expected_source'] else "FAIL"
        if status == "PASS":
            passed += 1
        else:
            failed += 1

        print(f"\n{status}: {tc['name']}")
        print(f"  Expected: {tc['expected_source']}")
        print(f"  Got: {source} (value={value:.0f}, valid={is_valid}, quality={quality})")

    print(f"\n{'=' * 60}")
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 60)


if __name__ == '__main__':
    run_test_cases()
