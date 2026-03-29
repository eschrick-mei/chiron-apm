"""
Chiron APM - Advanced Analytics Service
Sophisticated analytics for Asset Performance Management.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
from enum import Enum
import pytz


def _to_native(value):
    """Convert numpy/pandas types to native Python types for JSON serialization."""
    if value is None:
        return None
    if isinstance(value, (np.integer, np.int64, np.int32)):
        return int(value)
    if isinstance(value, (np.floating, np.float64, np.float32)):
        return float(value)
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (pd.Timestamp, np.datetime64)):
        return pd.Timestamp(value).isoformat()
    return value


def _to_native_dict(d: dict) -> dict:
    """Convert all values in a dict to native Python types."""
    return {k: _to_native(v) for k, v in d.items()}


class AnomalyType(Enum):
    PRODUCTION_DROP = "production_drop"
    UNDERPERFORMANCE = "underperformance"
    COMMUNICATION_LOSS = "communication_loss"
    DEGRADATION_ACCELERATED = "degradation_accelerated"
    WEATHER_MISMATCH = "weather_mismatch"
    STRING_IMBALANCE = "string_imbalance"
    CLIPPING = "clipping"


class SeverityLevel(Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


@dataclass
class AnomalyDetection:
    site_id: str
    anomaly_type: AnomalyType
    severity: SeverityLevel
    confidence: float
    description: str
    affected_equipment: List[str]
    estimated_loss_kw: float
    detected_at: datetime
    metrics: Dict[str, Any]


@dataclass
class RevenueImpact:
    site_id: str
    daily_loss_kwh: float
    daily_loss_usd: float
    monthly_projected_loss_usd: float
    capacity_factor_loss: float
    availability_loss_pct: float


class APMAnalytics:
    """
    Advanced analytics engine for Asset Performance Management.

    Features:
    - Real-time anomaly detection
    - Predictive maintenance scoring
    - Revenue impact calculations
    - Fleet comparative analytics
    - Weather-adjusted performance
    - String-level monitoring
    - Smart production algorithm (meter/inverter arbitration)
    """

    # Energy price assumptions ($/kWh)
    DEFAULT_ENERGY_PRICE = 0.08
    PEAK_ENERGY_PRICE = 0.12

    # Thresholds for anomaly detection
    PRODUCTION_DROP_THRESHOLD = 0.3  # 30% drop from expected
    UNDERPERFORMANCE_THRESHOLD = 0.85  # PR < 85%
    # Data pull runs at :20 each hour, completes ~:50-:00
    # So current hour data won't be available until next hour
    # Expected delay: 60-90 minutes. Mark stale only if > 120 min (2 hours)
    STALE_DATA_MINUTES = 120
    STRING_IMBALANCE_THRESHOLD = 0.15  # 15% deviation between strings

    def __init__(self, data_service):
        self.ds = data_service

    # =========================================================================
    # Smart Production Algorithm
    # =========================================================================

    def calculate_smart_production(
        self,
        meter_value: Optional[float],
        inverter_value: Optional[float],
        dc_capacity_kw: Optional[float] = None,
        ac_capacity_kw: Optional[float] = None,
        hours: int = 1
    ) -> Tuple[float, str, List[str]]:
        """
        Smart production calculation that intelligently chooses between meter and inverter data.

        Logic (adapted from DAX):
        1. If both are blank -> 0
        2. If neither is reasonable -> 0
        3. If inverter exceeds DC capacity * 20 (per day) -> unrealistic, use meter
        4. If only one is reasonable -> use that one
        5. If meter/inverter ratio >= 0.85 -> use meter (meter is more reliable)
        6. If ratio < 0.85 -> use inverter (meter may have comm issues)

        Args:
            meter_value: Meter energy reading (kWh)
            inverter_value: Inverter total energy reading (kWh)
            dc_capacity_kw: Site DC capacity for unrealistic check (SIZE_KW_DC)
            ac_capacity_kw: Site AC capacity for reasonableness check
            hours: Number of hours this data represents (for capacity limit scaling)

        Returns:
            Tuple of (production_value, source, data_quality_flags)
            - source is 'meter', 'inverter', or 'none'
            - data_quality_flags is a list of warning flags
        """
        flags: List[str] = []

        # Define reasonable max (12 hours at full AC capacity for hourly data)
        # Scale by hours for period data
        reasonable_max = (ac_capacity_kw * 12 * max(1, hours / 24)) if ac_capacity_kw and ac_capacity_kw > 0 else float('inf')

        # Unrealistic inverter check: DC capacity * 20 kWh per day (scaled by hours)
        # This catches rollover/cumulative meter issues
        unrealistic_threshold = (dc_capacity_kw * 20 * max(1, hours / 24)) if dc_capacity_kw and dc_capacity_kw > 0 else float('inf')

        # Check if values are reasonable
        def is_reasonable(val: Optional[float]) -> bool:
            if val is None or pd.isna(val):
                return False
            return val > 0 and val <= reasonable_max

        meter_val = float(meter_value) if meter_value and pd.notna(meter_value) else 0
        inverter_val = float(inverter_value) if inverter_value and pd.notna(inverter_value) else 0

        # Check for unrealistic inverter value (exceeds theoretical maximum)
        inverter_unrealistic = inverter_val > unrealistic_threshold
        if inverter_unrealistic:
            flags.append('inverter_exceeds_capacity')

        meter_reasonable = is_reasonable(meter_value) if not pd.isna(meter_value) else False
        inverter_reasonable = is_reasonable(inverter_value) and not inverter_unrealistic

        # Both blank
        if meter_val <= 0 and inverter_val <= 0:
            flags.append('no_data')
            return (0.0, 'none', flags)

        # Generate data quality flags for meter/inverter comparison
        if meter_val > 0 and inverter_val > 0:
            ratio = meter_val / inverter_val if inverter_val > 0 else 0
            if ratio > 1.10:
                flags.append('meter_exceeds_inverter_10pct')
            elif ratio < 0.90:
                flags.append('inverter_exceeds_meter_10pct')
        elif meter_val > 0 and inverter_val <= 0:
            flags.append('meter_only')
        elif inverter_val > 0 and meter_val <= 0:
            flags.append('inverter_only')

        # If inverter is unrealistic, force meter usage
        if inverter_unrealistic and meter_reasonable:
            return (meter_val, 'meter', flags)

        # Neither reasonable
        if not meter_reasonable and not inverter_reasonable:
            flags.append('no_reasonable_data')
            return (0.0, 'none', flags)

        # Only inverter reasonable
        if not meter_reasonable and inverter_reasonable:
            return (max(0, inverter_val), 'inverter', flags)

        # Only meter reasonable
        if not inverter_reasonable and meter_reasonable:
            return (max(0, meter_val), 'meter', flags)

        # Both reasonable - check ratio
        if inverter_val > 0:
            ratio = meter_val / inverter_val
            if ratio >= 0.85:
                return (meter_val, 'meter', flags)
            else:
                # Meter significantly lower than inverter - likely comm issue
                return (inverter_val, 'inverter', flags)

        # Fallback to meter if inverter is 0
        if meter_reasonable:
            return (meter_val, 'meter', flags)

        return (0.0, 'none', flags)

    # =========================================================================
    # Fleet Matrix - Real-time Inverter Production Grid
    # =========================================================================

    def get_fleet_matrix(
        self, stage: str = 'FC', timestamp: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        Get fleet matrix showing all sites and their inverter production.

        Returns a matrix where:
        - Rows = Sites
        - Columns = Inverters (IN1, IN2, ..., INn)
        - Values = Production (kWh) with status indicators

        Args:
            stage: 'FC' or 'Pre-FC' to filter sites
            timestamp: Optional historical timestamp. If None, returns real-time data.

        This is the key view for identifying outages across the entire fleet.
        """
        # Get all operational sites
        sites_df = self.ds.get_operational_sites()

        # Filter by operational stage (derived from PTO_ACTUAL_DATE and FC_ACTUAL_DATE)
        if stage == 'FC':
            sites_df = sites_df[sites_df['OPERATIONAL_STAGE'] == 'FC']
        elif stage == 'Pre-FC':
            sites_df = sites_df[sites_df['OPERATIONAL_STAGE'] == 'Pre-FC']

        # Get values - either historical or latest
        site_ids = sites_df['SITE_ID'].tolist()
        if timestamp:
            all_latest_df = self.ds.get_all_sites_historical_values(timestamp, site_ids)
            query_time = timestamp
        else:
            all_latest_df = self.ds.get_all_sites_latest_values(site_ids)
            query_time = datetime.now()

        # Convert to dict keyed by site_id for fast lookup
        latest_by_site = {}
        if not all_latest_df.empty:
            for _, row in all_latest_df.iterrows():
                latest_by_site[row['SITEID']] = row.to_dict()

        matrix_data = []
        max_inverters = 0

        for _, site in sites_df.iterrows():
            site_id = site['SITE_ID']
            timezone = site.get('TIMEZONE', 'America/New_York')

            # Safely handle NaN values for numeric fields
            inv_count_raw = site.get('INVERTER_COUNT')
            inverter_count = int(inv_count_raw) if pd.notna(inv_count_raw) and inv_count_raw else 0

            size_raw = site.get('SIZE_KW_DC')
            size_kw_dc = float(size_raw) if pd.notna(size_raw) and size_raw else 0

            # Use SIZE_KW_AC for capacity factor calculations (better reflects inverter capacity)
            size_ac_raw = site.get('SIZE_KW_AC')
            size_kw_ac = float(size_ac_raw) if pd.notna(size_ac_raw) and size_ac_raw else size_kw_dc

            if inverter_count > max_inverters:
                max_inverters = inverter_count

            # Get latest hourly data for this site from the bulk query result
            latest_values = latest_by_site.get(site_id, {})

            # Calculate expected kW per inverter (use AC capacity for more accurate CF)
            expected_kw_per_inv = (size_kw_ac / inverter_count) if inverter_count > 0 else 0

            # Get irradiance values first (used for smart daylight detection)
            poa_raw = latest_values.get('INSOLATION_POA')
            poa = float(poa_raw) if poa_raw and pd.notna(poa_raw) else 0
            ghi_raw = latest_values.get('INSOLATION_GHI_SOLCAST')
            ghi = float(ghi_raw) if ghi_raw and pd.notna(ghi_raw) else 0

            # Get local time for the site (use query_time for historical, now for real-time)
            try:
                tz = pytz.timezone(timezone) if timezone else pytz.UTC
                if timestamp:
                    # For historical: convert query_time to site's local timezone
                    local_now = query_time.replace(tzinfo=pytz.UTC).astimezone(tz)
                else:
                    local_now = datetime.now(tz)
            except Exception:
                local_now = query_time if timestamp else datetime.now()

            # SMART daylight detection (from proven CHIRON logic):
            # 1. Primary: Irradiance-based (POA or GHI >= 50 W/m²)
            # 2. Fallback: Time-based (7 AM to 7 PM)
            irradiance_available = poa >= 50 or ghi >= 50
            time_based_daylight = 7 <= local_now.hour < 19  # 7 AM to 7 PM
            is_daylight = irradiance_available or (time_based_daylight and poa == 0 and ghi == 0)

            # First pass: collect all inverter values to calculate peer average
            raw_values = []
            for i in range(1, inverter_count + 1):
                col_name = f'IN{i}_VALUE'
                val = latest_values.get(col_name, 0)
                try:
                    val = float(val) if val is not None and pd.notna(val) else 0
                except (ValueError, TypeError):
                    val = 0
                raw_values.append(val)

            # Calculate peer production average (for offline detection)
            producing_values = [v for v in raw_values if v > 0]
            peer_avg = sum(producing_values) / len(producing_values) if producing_values else 0

            # Extract inverter values with smart status detection
            inverter_values = []
            total_production = 0
            inverters_online = 0
            inverters_offline = 0

            for i, value in enumerate(raw_values, start=1):
                total_production += value

                # SMART status determination (based on CHIRON proven logic):
                # - If value > 0: definitely online
                # - If value = 0 AND is_daylight:
                #   - If peers are producing (peer_avg > 1 kWh): this inverter is OFFLINE
                #   - If no peers producing: could be sunset/cloud, mark as "low_production"
                # - If value = 0 AND not daylight: night mode
                if value > 0:
                    status = 'online'
                    inverters_online += 1
                elif is_daylight:
                    if peer_avg >= 1.0:
                        # Peers producing but this one isn't - confirmed offline
                        status = 'offline'
                        inverters_offline += 1
                    else:
                        # No peers producing either - likely sunset/weather
                        status = 'low_production'
                else:
                    status = 'night'

                # Calculate capacity factor for this inverter
                capacity_factor = (value / expected_kw_per_inv * 100) if expected_kw_per_inv > 0 else 0

                inverter_values.append({
                    'index': i,
                    'value': round(value, 2),
                    'status': status,
                    'capacity_factor': round(min(capacity_factor, 100), 1),
                    'expected_kw': round(expected_kw_per_inv, 2)
                })

            # Get measurement time - use UTC for consistent comparison
            measurement_time = latest_values.get('MEASUREMENTTIME')
            if measurement_time:
                try:
                    if isinstance(measurement_time, str):
                        measurement_time = pd.to_datetime(measurement_time)
                    # MEASUREMENTTIME is stored in UTC, compare with UTC now
                    utc_now = datetime.utcnow()
                    measurement_naive = measurement_time.replace(tzinfo=None)
                    minutes_ago = (utc_now - measurement_naive).total_seconds() / 60
                except Exception:
                    minutes_ago = None
            else:
                minutes_ago = None

            # Determine site-level status (smarter logic)
            if inverters_offline > 0 and inverters_online == 0 and is_daylight:
                site_status = 'site_offline'
            elif inverters_offline > 0 and is_daylight:
                site_status = 'partial_outage'
            elif not is_daylight:
                site_status = 'night'
            elif peer_avg < 1.0 and time_based_daylight:
                # Low/no production during expected daylight - could be weather
                site_status = 'low_production'
            else:
                site_status = 'healthy'

            # Note: poa and ghi already extracted above

            matrix_data.append({
                'site_id': site_id,
                'site_name': site.get('SITE_NAME', site_id),
                'primary_das': site.get('PRIMARY_DAS', 'Unknown'),
                'timezone': timezone,
                'local_hour': local_now.hour if local_now else None,
                'is_daylight': is_daylight,
                'inverter_count': inverter_count,
                'size_kw_dc': size_kw_dc,
                'size_kw_ac': size_kw_ac,  # Added for debugging
                'expected_kw_per_inv': round(expected_kw_per_inv, 2),  # Added for debugging
                'inverters': inverter_values,
                'total_production': round(total_production, 2),
                'peer_avg_kwh': round(peer_avg, 2),  # Added for debugging
                'inverters_online': inverters_online,
                'inverters_offline': inverters_offline,
                'site_status': site_status,
                'measurement_time': str(measurement_time) if measurement_time else None,
                'minutes_ago': round(minutes_ago, 1) if minutes_ago else None,
                # Data pull runs at :20 each hour, completes near top of next hour
                # Expected delay is 60-90 min. Mark stale only if > 2 hours behind
                'data_stale': minutes_ago is not None and minutes_ago > self.STALE_DATA_MINUTES,
                'has_data': bool(latest_values),  # Added for debugging - True if we got data
                'irradiance_poa': round(poa, 1),
                'irradiance_ghi': round(ghi, 1)
            })

        # Sort by status priority (site_offline first, then partial_outage, etc.)
        status_priority = {'site_offline': 0, 'partial_outage': 1, 'low_production': 2, 'healthy': 3, 'night': 4}
        matrix_data.sort(key=lambda x: (status_priority.get(x['site_status'], 5), -x['inverters_offline']))

        # Calculate summary
        total_sites = len(matrix_data)
        sites_offline = len([s for s in matrix_data if s['site_status'] == 'site_offline'])
        sites_partial = len([s for s in matrix_data if s['site_status'] == 'partial_outage'])
        sites_low_production = len([s for s in matrix_data if s['site_status'] == 'low_production'])
        sites_healthy = len([s for s in matrix_data if s['site_status'] == 'healthy'])
        sites_night = len([s for s in matrix_data if s['site_status'] == 'night'])

        total_inverters = sum(s['inverter_count'] for s in matrix_data)
        total_offline = sum(s['inverters_offline'] for s in matrix_data)
        total_online = sum(s['inverters_online'] for s in matrix_data)

        # Calculate fleet capacity factor
        total_production = sum(s['total_production'] for s in matrix_data)
        total_capacity = sum(s['size_kw_dc'] for s in matrix_data)
        fleet_cf = (total_production / total_capacity * 100) if total_capacity > 0 else 0

        return {
            'matrix': matrix_data,
            'max_inverters': max_inverters,
            'summary': {
                'total_sites': total_sites,
                'sites_offline': sites_offline,
                'sites_partial_outage': sites_partial,
                'sites_low_production': sites_low_production,
                'sites_healthy': sites_healthy,
                'sites_night': sites_night,
                'total_inverters': total_inverters,
                'inverters_online': total_online,
                'inverters_offline': total_offline,
                'fleet_capacity_factor': round(fleet_cf, 1),
                'total_production_kw': round(total_production, 2),
                'total_capacity_kw': round(total_capacity, 2)
            },
            'query_timestamp': query_time.isoformat() if timestamp else None,
            'is_historical': timestamp is not None,
            'generated_at': datetime.now().isoformat()
        }

    # =========================================================================
    # Anomaly Detection
    # =========================================================================

    def detect_anomalies(self, site_id: str, hours: int = 24) -> List[Dict[str, Any]]:
        """
        Detect anomalies for a specific site over the past N hours.
        """
        anomalies = []

        site_info = self.ds.get_site_details(site_id)
        if not site_info:
            return anomalies

        metrics_df = self.ds.get_site_metrics_data(site_id, days=max(1, hours // 24))
        if metrics_df.empty:
            return anomalies

        # Check for production drop
        production_anomaly = self._detect_production_drop(site_id, site_info, metrics_df)
        if production_anomaly:
            anomalies.append(production_anomaly)

        # Check for underperformance
        perf_anomaly = self._detect_underperformance(site_id, site_info, metrics_df)
        if perf_anomaly:
            anomalies.append(perf_anomaly)

        # Check for string imbalance
        string_anomaly = self._detect_string_imbalance(site_id, site_info, metrics_df)
        if string_anomaly:
            anomalies.append(string_anomaly)

        # Check for communication loss
        comm_anomaly = self._detect_communication_loss(site_id, site_info)
        if comm_anomaly:
            anomalies.append(comm_anomaly)

        return anomalies

    def _detect_production_drop(
        self, site_id: str, site_info: Dict, metrics_df: pd.DataFrame
    ) -> Optional[Dict[str, Any]]:
        """Detect sudden production drops."""
        if len(metrics_df) < 2:
            return None

        # Get recent production values
        energy_col = 'METER_ENERGY' if 'METER_ENERGY' in metrics_df.columns else 'INV_TOTAL_ENERGY'
        if energy_col not in metrics_df.columns:
            return None

        recent = metrics_df[energy_col].tail(6)  # Last 6 hours
        historical = metrics_df[energy_col].head(len(metrics_df) - 6)

        if len(recent) < 3 or len(historical) < 3:
            return None

        recent_avg = recent.mean()
        historical_avg = historical.mean()

        if historical_avg > 0:
            drop_pct = (historical_avg - recent_avg) / historical_avg

            if drop_pct >= self.PRODUCTION_DROP_THRESHOLD:
                return {
                    'type': AnomalyType.PRODUCTION_DROP.value,
                    'severity': SeverityLevel.HIGH.value if drop_pct > 0.5 else SeverityLevel.MEDIUM.value,
                    'confidence': min(0.95, 0.7 + drop_pct),
                    'description': f'Production dropped {drop_pct*100:.1f}% from historical average',
                    'metrics': {
                        'recent_avg_kwh': round(recent_avg, 2),
                        'historical_avg_kwh': round(historical_avg, 2),
                        'drop_percentage': round(drop_pct * 100, 1)
                    },
                    'estimated_loss_kw': round((historical_avg - recent_avg), 2),
                    'detected_at': datetime.now().isoformat()
                }
        return None

    def _detect_underperformance(
        self, site_id: str, site_info: Dict, metrics_df: pd.DataFrame
    ) -> Optional[Dict[str, Any]]:
        """Detect systematic underperformance vs expected."""
        # Calculate quick PR
        pto_date = site_info.get('PTO_ACTUAL_DATE')
        pr_data = self.ds.calculate_site_performance_ratio(site_id, pto_date=pto_date, days=7)

        if pr_data.get('pr') is None:
            return None

        pr = pr_data['pr'] / 100  # Convert to decimal

        if pr < self.UNDERPERFORMANCE_THRESHOLD:
            severity = SeverityLevel.CRITICAL if pr < 0.6 else (
                SeverityLevel.HIGH if pr < 0.75 else SeverityLevel.MEDIUM
            )

            return {
                'type': AnomalyType.UNDERPERFORMANCE.value,
                'severity': severity.value,
                'confidence': 0.85,
                'description': f'Site underperforming at {pr*100:.1f}% PR (threshold: {self.UNDERPERFORMANCE_THRESHOLD*100}%)',
                'metrics': {
                    'performance_ratio': round(pr * 100, 1),
                    'threshold': self.UNDERPERFORMANCE_THRESHOLD * 100,
                    'weather_factor': pr_data.get('weather_adjustment_factor', 1.0),
                    'degradation_factor': pr_data.get('degradation_factor', 1.0)
                },
                'estimated_loss_kw': round(
                    pr_data.get('weather_adjusted_expected_kwh', 0) * (1 - pr) / 24, 2
                ),
                'detected_at': datetime.now().isoformat()
            }
        return None

    def _detect_string_imbalance(
        self, site_id: str, site_info: Dict, metrics_df: pd.DataFrame
    ) -> Optional[Dict[str, Any]]:
        """Detect imbalance between inverter strings."""
        inverter_count = int(site_info.get('INVERTER_COUNT', 0) or 0)
        if inverter_count < 2:
            return None

        # Get latest row
        latest = metrics_df.iloc[-1] if len(metrics_df) > 0 else None
        if latest is None:
            return None

        inv_values = []
        for i in range(1, inverter_count + 1):
            col = f'IN{i}_VALUE'
            if col in latest:
                val = float(latest[col]) if pd.notna(latest[col]) else 0
                if val > 0:
                    inv_values.append((f'IN{i}', val))

        if len(inv_values) < 2:
            return None

        values = [v[1] for v in inv_values]
        avg = np.mean(values)

        if avg > 0:
            deviations = [(name, (val - avg) / avg) for name, val in inv_values]
            outliers = [(name, dev) for name, dev in deviations if abs(dev) > self.STRING_IMBALANCE_THRESHOLD]

            if outliers:
                return {
                    'type': AnomalyType.STRING_IMBALANCE.value,
                    'severity': SeverityLevel.MEDIUM.value,
                    'confidence': 0.75,
                    'description': f'{len(outliers)} inverter(s) showing significant deviation from fleet average',
                    'metrics': {
                        'average_kw': round(avg, 2),
                        'outliers': [
                            {'inverter': name, 'deviation_pct': round(dev * 100, 1)}
                            for name, dev in outliers
                        ]
                    },
                    'affected_equipment': [name for name, _ in outliers],
                    'estimated_loss_kw': round(sum(avg * abs(dev) for _, dev in outliers), 2),
                    'detected_at': datetime.now().isoformat()
                }
        return None

    def _detect_communication_loss(
        self, site_id: str, site_info: Dict
    ) -> Optional[Dict[str, Any]]:
        """Detect communication/data staleness issues."""
        latest = self.ds.get_equipment_latest_values(site_id)

        if not latest:
            return {
                'type': AnomalyType.COMMUNICATION_LOSS.value,
                'severity': SeverityLevel.HIGH.value,
                'confidence': 0.95,
                'description': 'No data available from site - possible communication loss',
                'metrics': {'data_available': False},
                'estimated_loss_kw': float(site_info.get('SIZE_KW_DC', 0) or 0),
                'detected_at': datetime.now().isoformat()
            }

        measurement_time = latest.get('MEASUREMENTTIME')
        if measurement_time:
            try:
                if isinstance(measurement_time, str):
                    measurement_time = pd.to_datetime(measurement_time)
                minutes_ago = (datetime.now() - measurement_time.replace(tzinfo=None)).total_seconds() / 60

                if minutes_ago > self.STALE_DATA_MINUTES * 2:  # 2+ hours stale
                    return {
                        'type': AnomalyType.COMMUNICATION_LOSS.value,
                        'severity': SeverityLevel.HIGH.value,
                        'confidence': 0.9,
                        'description': f'Data is {minutes_ago/60:.1f} hours stale - possible communication loss',
                        'metrics': {
                            'minutes_stale': round(minutes_ago, 1),
                            'last_update': str(measurement_time)
                        },
                        'estimated_loss_kw': float(site_info.get('SIZE_KW_DC', 0) or 0) * 0.5,
                        'detected_at': datetime.now().isoformat()
                    }
            except Exception:
                pass

        return None

    # =========================================================================
    # Revenue Impact Calculations
    # =========================================================================

    def calculate_revenue_impact(
        self,
        site_id: str,
        energy_price: float = None,
        hours: int = 24
    ) -> Dict[str, Any]:
        """
        Calculate revenue impact for a site with outages/underperformance.
        Uses actual PPA rate from TE_OPERATING if available.
        """
        # Use site-specific PPA rate from TE_OPERATING, fallback to provided or default
        price = energy_price or self.ds.get_site_rate(site_id, self.DEFAULT_ENERGY_PRICE)

        site_info = self.ds.get_site_details(site_id)
        if not site_info:
            return {'error': 'Site not found'}

        size_kw = float(site_info.get('SIZE_KW_DC', 0) or 0)

        # Get performance data
        pr_data = self.ds.calculate_site_performance_ratio(
            site_id,
            pto_date=site_info.get('PTO_ACTUAL_DATE'),
            days=max(1, hours // 24)
        )

        actual_kwh = pr_data.get('actual_production_kwh', 0)
        expected_kwh = pr_data.get('weather_adjusted_expected_kwh', 0)

        # Calculate losses
        lost_kwh = max(0, expected_kwh - actual_kwh)
        lost_revenue = lost_kwh * price

        # Annualize
        days_analyzed = max(1, hours / 24)
        annual_factor = 365 / days_analyzed

        # Get alert info
        alerts = self.ds.get_site_alerts(site_id)
        confirmed_alerts = len(alerts[alerts['VERIFICATION_STATUS'] == 'CONFIRMED']) if not alerts.empty else 0

        return {
            'site_id': site_id,
            'site_name': site_info.get('SITE_NAME', site_id),
            'size_kw_dc': size_kw,
            'period_hours': hours,
            'actual_kwh': round(actual_kwh, 2),
            'expected_kwh': round(expected_kwh, 2),
            'lost_kwh': round(lost_kwh, 2),
            'lost_revenue_usd': round(lost_revenue, 2),
            'performance_ratio': pr_data.get('pr'),
            'energy_price_per_kwh': price,
            'projected_annual_loss_usd': round(lost_revenue * annual_factor, 2),
            'confirmed_alerts': confirmed_alerts,
            'capacity_factor_actual': round((actual_kwh / (size_kw * hours) * 100) if size_kw > 0 else 0, 1),
            'data_quality': pr_data.get('data_quality', 'unknown')
        }

    def calculate_fleet_revenue_impact(
        self,
        stage: str = 'FC',
        energy_price: float = None,
        days: int = 7
    ) -> Dict[str, Any]:
        """
        Calculate total fleet revenue impact.
        Uses site-specific PPA rates from TE_OPERATING when available.
        """
        # Get all PPA rates upfront for efficiency
        ppa_rates = self.ds.get_site_ppa_rates()
        default_price = energy_price or self.DEFAULT_ENERGY_PRICE

        analytics = self.ds.get_site_analytics_summary(stage=stage, days=days)
        if analytics.empty:
            return {'sites': [], 'summary': {}}

        site_impacts = []
        total_lost_kwh = 0
        total_lost_revenue = 0

        for _, row in analytics.iterrows():
            site_id = row['SITE_ID']
            kw_offline = float(row.get('ESTIMATED_KW_OFFLINE', 0) or 0)

            # Use site-specific PPA rate if available
            site_price = ppa_rates.get(site_id, default_price)

            # Estimate lost production (assume 5 peak sun hours per day)
            estimated_daily_loss_kwh = kw_offline * 5  # Peak sun hours
            estimated_period_loss = estimated_daily_loss_kwh * days
            period_revenue_loss = estimated_period_loss * site_price

            if kw_offline > 0:
                site_impacts.append({
                    'site_id': site_id,
                    'site_name': row.get('SITE_NAME', site_id),
                    'size_kw_dc': float(row.get('SIZE_KW_DC', 0) or 0),
                    'kw_offline': kw_offline,
                    'ppa_rate': site_price,
                    'estimated_daily_loss_kwh': round(estimated_daily_loss_kwh, 2),
                    'period_loss_kwh': round(estimated_period_loss, 2),
                    'period_loss_usd': round(period_revenue_loss, 2),
                    'confirmed_alerts': int(row.get('CONFIRMED_ALERTS', 0) or 0),
                    'site_offline': int(row.get('CONFIRMED_SITE_OFFLINE', 0) or 0) > 0,
                    'inverters_offline': int(row.get('CONFIRMED_INV_OFFLINE', 0) or 0)
                })

                total_lost_kwh += estimated_period_loss
                total_lost_revenue += period_revenue_loss

        # Sort by revenue impact
        site_impacts.sort(key=lambda x: x['period_loss_usd'], reverse=True)

        # Calculate totals
        total_capacity = float(analytics['SIZE_KW_DC'].sum())
        total_kw_offline = float(analytics['ESTIMATED_KW_OFFLINE'].sum())

        # Calculate average PPA rate across impacted sites
        avg_rate = (sum(s['ppa_rate'] for s in site_impacts) / len(site_impacts)) if site_impacts else default_price

        return {
            'sites': site_impacts,
            'summary': {
                'total_sites_impacted': len(site_impacts),
                'total_kw_offline': round(total_kw_offline, 2),
                'total_capacity_kw': round(total_capacity, 2),
                'offline_percentage': round((total_kw_offline / total_capacity * 100) if total_capacity > 0 else 0, 2),
                'period_days': days,
                'avg_ppa_rate': round(avg_rate, 4),
                'total_lost_kwh': round(total_lost_kwh, 2),
                'total_lost_revenue_usd': round(total_lost_revenue, 2),
                'projected_annual_loss_usd': round(total_lost_revenue * (365 / days), 2)
            }
        }

    # =========================================================================
    # Predictive Maintenance Scoring
    # =========================================================================

    def calculate_maintenance_score(self, site_id: str) -> Dict[str, Any]:
        """
        Calculate a predictive maintenance score for a site.
        Score from 0-100, where:
        - 100 = Perfect condition, no maintenance needed
        - 0 = Critical condition, immediate maintenance required
        """
        site_info = self.ds.get_site_details(site_id)
        if not site_info:
            return {'error': 'Site not found'}

        score = 100.0
        factors = []

        # Factor 1: Performance Ratio (weight: 30%)
        pr_data = self.ds.calculate_site_performance_ratio(
            site_id,
            pto_date=site_info.get('PTO_ACTUAL_DATE'),
            days=30
        )
        if pr_data.get('pr'):
            pr = pr_data['pr']
            if pr >= 95:
                pr_score = 100
            elif pr >= 85:
                pr_score = 80 + (pr - 85) * 2
            elif pr >= 70:
                pr_score = 50 + (pr - 70) * 2
            else:
                pr_score = max(0, pr - 20)

            score -= (100 - pr_score) * 0.30
            factors.append({
                'name': 'Performance Ratio',
                'weight': 0.30,
                'score': round(pr_score, 1),
                'details': f'PR: {pr:.1f}%'
            })

        # Factor 2: Alert History (weight: 25%)
        alerts = self.ds.get_site_alerts(site_id)
        if not alerts.empty:
            confirmed_count = len(alerts[alerts['VERIFICATION_STATUS'] == 'CONFIRMED'])
            if confirmed_count == 0:
                alert_score = 100
            elif confirmed_count <= 2:
                alert_score = 70
            elif confirmed_count <= 5:
                alert_score = 40
            else:
                alert_score = 10

            score -= (100 - alert_score) * 0.25
            factors.append({
                'name': 'Alert History',
                'weight': 0.25,
                'score': round(alert_score, 1),
                'details': f'{confirmed_count} confirmed alerts'
            })
        else:
            factors.append({
                'name': 'Alert History',
                'weight': 0.25,
                'score': 100,
                'details': 'No active alerts'
            })

        # Factor 3: Equipment Age (weight: 20%)
        pto_date = site_info.get('PTO_ACTUAL_DATE')
        if pto_date:
            try:
                if isinstance(pto_date, str):
                    pto_date = pd.to_datetime(pto_date)
                if hasattr(pto_date, 'date'):
                    pto_dt = pto_date
                else:
                    pto_dt = datetime.combine(pto_date, datetime.min.time())
                years = (datetime.now() - pto_dt.replace(tzinfo=None)).days / 365.25

                if years <= 2:
                    age_score = 100
                elif years <= 5:
                    age_score = 90 - (years - 2) * 5
                elif years <= 10:
                    age_score = 75 - (years - 5) * 5
                else:
                    age_score = max(30, 50 - (years - 10) * 3)

                score -= (100 - age_score) * 0.20
                factors.append({
                    'name': 'Equipment Age',
                    'weight': 0.20,
                    'score': round(age_score, 1),
                    'details': f'{years:.1f} years since PTO'
                })
            except Exception:
                pass

        # Factor 4: Data Quality/Communication (weight: 15%)
        latest = self.ds.get_equipment_latest_values(site_id)
        if latest:
            measurement_time = latest.get('MEASUREMENTTIME')
            if measurement_time:
                try:
                    if isinstance(measurement_time, str):
                        measurement_time = pd.to_datetime(measurement_time)
                    minutes_stale = (datetime.now() - measurement_time.replace(tzinfo=None)).total_seconds() / 60

                    if minutes_stale <= 60:
                        comm_score = 100
                    elif minutes_stale <= 120:
                        comm_score = 80
                    elif minutes_stale <= 360:
                        comm_score = 50
                    else:
                        comm_score = 20

                    score -= (100 - comm_score) * 0.15
                    factors.append({
                        'name': 'Data Quality',
                        'weight': 0.15,
                        'score': round(comm_score, 1),
                        'details': f'{minutes_stale/60:.1f}h since update'
                    })
                except Exception:
                    pass

        # Factor 5: Inverter Health (weight: 10%)
        inverter_count = int(site_info.get('INVERTER_COUNT', 0) or 0)
        if inverter_count > 0 and latest:
            online_count = 0
            for i in range(1, inverter_count + 1):
                val = latest.get(f'IN{i}_VALUE', 0)
                try:
                    if float(val or 0) > 0:
                        online_count += 1
                except (ValueError, TypeError):
                    pass

            online_pct = (online_count / inverter_count) * 100
            inv_score = online_pct

            score -= (100 - inv_score) * 0.10
            factors.append({
                'name': 'Inverter Health',
                'weight': 0.10,
                'score': round(inv_score, 1),
                'details': f'{online_count}/{inverter_count} online'
            })

        # Determine status
        if score >= 85:
            status = 'excellent'
            recommendation = 'No immediate maintenance required'
        elif score >= 70:
            status = 'good'
            recommendation = 'Schedule routine inspection'
        elif score >= 50:
            status = 'fair'
            recommendation = 'Plan maintenance within 30 days'
        elif score >= 30:
            status = 'poor'
            recommendation = 'Urgent maintenance recommended within 7 days'
        else:
            status = 'critical'
            recommendation = 'Immediate maintenance required'

        return {
            'site_id': site_id,
            'site_name': site_info.get('SITE_NAME', site_id),
            'score': round(max(0, min(100, score)), 1),
            'status': status,
            'recommendation': recommendation,
            'factors': factors,
            'calculated_at': datetime.now().isoformat()
        }

    # =========================================================================
    # Fleet KPI Table (Comprehensive Performance Metrics)
    # =========================================================================

    # Known BESS hybrid sites that need 'Production (Solar + BESS)' forecast
    BESS_SITE_IDS = {
        'SITE_001', 'SITE_002', 'SITE_003', 'SITE_004', 'SITE_005',
        'SITE_006', 'SITE_007', 'SITE_008', 'SITE_009', 'SITE_010', 'SITE_011'
    }  # TODO: Load from config or database

    def _select_best_insolation(
        self,
        row: pd.Series,
        irradiance_type: int  # 1=GHI, 2=POA
    ) -> Tuple[float, str, bool]:
        """
        Smart insolation selection per day.

        Validates onsite data and falls back to satellite if needed.

        Returns: (insolation_value, source, is_valid)
        """
        onsite_poa = float(row.get('ONSITE_POA', 0) or 0)
        onsite_ghi = float(row.get('ONSITE_GHI', 0) or 0)
        satellite_ghi = float(row.get('SATELLITE_GHI', 0) or 0)
        expected_poa = float(row.get('EXPECTED_INSOLATION_POA', 0) or 0)
        expected_ghi = float(row.get('EXPECTED_INSOLATION_GHI', 0) or 0)

        # Minimum threshold to consider valid (Wh/m²/day)
        MIN_THRESHOLD = 100  # Very cloudy day minimum

        # For POA sites (irradiance_type=2), prefer onsite POA
        if irradiance_type == 2:
            primary_onsite = onsite_poa
            expected = expected_poa
        else:
            primary_onsite = onsite_ghi
            expected = expected_ghi

        # Validation checks for onsite data
        # Thresholds based on fleet-wide analysis:
        # - Onsite < 100 Wh/m²/day: sensor offline or stuck
        # - Onsite/Satellite < 0.2: onsite too low (dirty sensor, shade)
        # - Onsite/Satellite > 2.0: onsite too high (calibration error)
        def is_onsite_valid(onsite: float, expected: float, satellite: float) -> bool:
            # Must be above minimum threshold
            if onsite < MIN_THRESHOLD:
                return False

            # Cross-validate against satellite if available
            # Tighter bounds from analysis: 0.2x to 2.0x
            if satellite > MIN_THRESHOLD:
                ratio = onsite / satellite
                if ratio < 0.2 or ratio > 2.0:
                    return False

            return True

        # Try primary onsite source
        if is_onsite_valid(primary_onsite, expected, satellite_ghi):
            source = 'POA' if irradiance_type == 2 else 'GHI'
            return primary_onsite, source, True

        # Try secondary onsite (GHI for POA sites, POA for GHI sites)
        secondary_onsite = onsite_ghi if irradiance_type == 2 else onsite_poa
        secondary_expected = expected_ghi if irradiance_type == 2 else expected_poa
        if is_onsite_valid(secondary_onsite, secondary_expected, satellite_ghi):
            source = 'GHI' if irradiance_type == 2 else 'POA'
            return secondary_onsite, source + '_FALLBACK', True

        # Fallback to satellite GHI
        if satellite_ghi > MIN_THRESHOLD:
            return satellite_ghi, 'SATELLITE_GHI', True

        # No valid data
        return max(primary_onsite, satellite_ghi, 0), 'NONE', False

    def _select_best_production(
        self,
        row: pd.Series,
        size_kw_dc: float
    ) -> Tuple[float, str, bool]:
        """
        Smart production selection per day.

        Validates meter vs inverter data and picks the most reliable source.

        Returns: (production_value, source, is_valid)
        """
        meter = float(row.get('METER_ENERGY', 0) or 0)
        inverter = float(row.get('INV_TOTAL_ENERGY', 0) or 0)
        expected = float(row.get('EXPECTED_PRODUCTION', 0) or 0)

        # Maximum possible daily production (assume 8 peak sun hours max)
        max_possible = size_kw_dc * 8 if size_kw_dc > 0 else float('inf')

        # Validation thresholds
        METER_INV_RATIO_MAX = 1.3  # Meter can be up to 30% higher (losses)
        METER_INV_RATIO_MIN = 0.5  # But not more than 2x lower
        EXPECTED_RATIO_MAX = 2.0   # Can exceed expected by 2x on very good days

        def is_meter_valid():
            if meter <= 0:
                return False
            # Check against physical maximum
            if meter > max_possible * 1.5:  # Allow some margin for meter errors
                return False
            # Cross-validate against inverter if available
            if inverter > 100:  # Meaningful inverter data
                ratio = meter / inverter
                if ratio > 3.0 or ratio < 0.3:  # Wildly different = meter spike/error
                    return False
            # Check against expected (if available)
            if expected > 0 and meter > expected * 5:  # 5x expected is suspicious
                return False
            return True

        def is_inverter_valid():
            if inverter <= 0:
                return False
            # Check against physical maximum
            if inverter > max_possible * 1.2:
                return False
            return True

        # Prefer meter (more accurate for revenue) if valid
        if is_meter_valid():
            return meter, 'METER', True

        # Fall back to inverter
        if is_inverter_valid():
            return inverter, 'INVERTER_FALLBACK', True

        # Both invalid - use the more conservative (lower) value if positive
        if meter > 0 and inverter > 0:
            # Pick the smaller one as it's likely more accurate
            if meter < inverter:
                return meter, 'METER_UNVALIDATED', False
            return inverter, 'INVERTER_UNVALIDATED', False

        # Use whichever has data
        if meter > 0:
            return meter, 'METER_UNVALIDATED', False
        if inverter > 0:
            return inverter, 'INVERTER_UNVALIDATED', False

        return 0, 'NONE', False

    def _compute_corrected_kpis(
        self,
        raw_df: pd.DataFrame,
        site_info: Dict[str, Dict]
    ) -> pd.DataFrame:
        """
        Compute corrected KPIs per day using smart production AND insolation selection.

        For each day:
        1. Select best production source (meter vs inverter validation)
        2. Select best insolation source
        3. Compute corrected insolation gap
        4. Compute corrected WA expected
        5. Compute corrected WA PR
        """
        if raw_df.empty:
            return pd.DataFrame()

        results = []

        for _, row in raw_df.iterrows():
            site_id = row['SITEID']
            info = site_info.get(site_id, {})
            irradiance_type = info.get('irradiance_type', 2)  # Default to POA
            size_kw_dc = info.get('size_kw_dc', 0)

            # Smart production selection (meter vs inverter validation)
            production, production_source, production_valid = self._select_best_production(row, size_kw_dc)
            expected_production = float(row.get('EXPECTED_PRODUCTION', 0) or 0)

            # Smart insolation selection
            corrected_insolation, insolation_source, insolation_valid = self._select_best_insolation(row, irradiance_type)

            # Get expected insolation for gap calculation
            if irradiance_type == 2:  # POA
                expected_insolation = float(row.get('EXPECTED_INSOLATION_POA', 0) or 0)
            else:  # GHI
                expected_insolation = float(row.get('EXPECTED_INSOLATION_GHI', 0) or 0)

            # Calculate corrected insolation gap
            if expected_insolation > 0 and corrected_insolation > 0:
                corrected_gap = (corrected_insolation / expected_insolation) - 1
            else:
                corrected_gap = 0

            # Calculate corrected WA expected
            # WA_EXPECTED = EXPECTED * (1 + gap) where gap = (actual_insol / expected_insol) - 1
            if expected_production > 0:
                corrected_wa_expected = expected_production * (1 + corrected_gap)
            else:
                corrected_wa_expected = 0

            # Calculate corrected WA PR
            if corrected_wa_expected > 0:
                corrected_wa_pr = production / corrected_wa_expected
            else:
                corrected_wa_pr = None

            # Keep raw values for audit
            meter_energy = float(row.get('METER_ENERGY', 0) or 0)
            inv_energy = float(row.get('INV_TOTAL_ENERGY', 0) or 0)

            results.append({
                'SITEID': site_id,
                'MEASUREMENTTIME': row['MEASUREMENTTIME'],
                'PRODUCTION': production,
                'PRODUCTION_SOURCE': production_source,
                'PRODUCTION_VALID': production_valid,
                'EXPECTED_PRODUCTION': expected_production,
                'CORRECTED_INSOLATION': corrected_insolation,
                'CORRECTED_INSOLATION_SOURCE': insolation_source,
                'CORRECTED_INSOLATION_GAP': corrected_gap,
                'CORRECTED_WA_EXPECTED': corrected_wa_expected,
                'CORRECTED_WA_PR': corrected_wa_pr,
                'INSOLATION_VALID': insolation_valid,
                # Keep view values for comparison/debugging
                'VIEW_WA_PR': row.get('VIEW_WA_PR'),
                'VIEW_INSOLATION_GAP': row.get('VIEW_INSOLATION_GAP'),
                'VIEW_INSOLATION_SOURCE': row.get('VIEW_INSOLATION_SOURCE'),
                # Raw energy values for audit
                'METER_ENERGY': meter_energy,
                'INV_TOTAL_ENERGY': inv_energy,
            })

        return pd.DataFrame(results)

    def get_fleet_kpi_table(
        self,
        stage: str = 'FC',
        days: int = 7,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get comprehensive KPI table for all sites using DAILY_DATA_LIVE pre-computed columns.

        Now leverages Snowflake views that pre-compute:
        - PRODUCTION (smart meter/inverter selection)
        - WA_EXPECTED_PRODUCTION (with degradation and weather adjustment)
        - WA_PERFORMANCE_RATIO (primary KPI)
        - INSOLATION_GAP, REVENUE_RATE, etc.

        The app only aggregates these pre-computed values.

        Args:
            stage: 'FC' or 'Pre-FC' to filter sites
            days: Number of days to analyze (used if start_date/end_date not provided)
            start_date: Optional custom start date (YYYY-MM-DD)
            end_date: Optional custom end date (YYYY-MM-DD)
        """
        # Calculate date range
        if end_date:
            end_dt = datetime.strptime(end_date, '%Y-%m-%d')
        else:
            end_dt = datetime.now() - timedelta(days=1)  # Yesterday
            end_date = end_dt.strftime('%Y-%m-%d')

        if start_date:
            start_dt = datetime.strptime(start_date, '%Y-%m-%d')
        else:
            start_dt = end_dt - timedelta(days=days - 1)
            start_date = start_dt.strftime('%Y-%m-%d')

        actual_days = (end_dt - start_dt).days + 1

        # Get operational sites
        sites_df = self.ds.get_operational_sites()

        if stage == 'FC':
            sites_df = sites_df[sites_df['DELIVERY_PHASE'].str.upper() == 'FC']
        elif stage == 'Pre-FC':
            sites_df = sites_df[sites_df['DELIVERY_PHASE'].str.upper().isin(['BU', 'PTO', 'SC'])]

        site_ids = sites_df['SITE_ID'].tolist()

        if not site_ids:
            return {
                'kpis': [],
                'stage': stage,
                'period_days': actual_days,
                'start_date': start_date,
                'end_date': end_date,
                'statistics': {},
                'generated_at': datetime.now().isoformat()
            }

        # Build site info lookup for additional fields
        site_info = {}
        for _, site in sites_df.iterrows():
            site_info[site['SITE_ID']] = {
                'site_name': site.get('SITE_NAME', site['SITE_ID']),
                'size_kw_dc': float(site.get('SIZE_KW_DC', 0) or 0),
                'size_kw_ac': float(site.get('SIZE_KW_AC', 0) or 0) or float(site.get('SIZE_KW_DC', 0) or 0),
                'primary_das': site.get('PRIMARY_DAS', 'Unknown'),
                'pto_date': site.get('PTO_ACTUAL_DATE'),
                'irradiance_type': int(site.get('IRRADIANCE_TYPE', 2) or 2),  # 1=GHI, 2=POA
                'is_bess_site': site['SITE_ID'] in self.BESS_SITE_IDS
            }

        # Get raw daily data with all insolation sources for smart selection
        raw_df = self.ds.get_daily_raw_insolation(
            site_ids=site_ids,
            start_date=start_date,
            end_date=end_date,
            stage=stage
        )

        # Apply smart insolation selection and compute corrected KPIs per day
        corrected_df = self._compute_corrected_kpis(raw_df, site_info)

        # Also get the view's aggregated data for revenue and other fields
        kpi_df = self.ds.get_fleet_daily_kpi_summary(
            site_ids=site_ids,
            start_date=start_date,
            end_date=end_date,
            stage=stage
        )

        # Create lookup for view aggregates (for revenue, availability, etc.)
        view_aggregates = {}
        if not kpi_df.empty:
            for _, row in kpi_df.iterrows():
                view_aggregates[row['SITEID']] = row

        kpi_rows = []

        # Aggregate corrected daily data per site
        if not corrected_df.empty:
            for site_id in corrected_df['SITEID'].unique():
                site_data = corrected_df[corrected_df['SITEID'] == site_id]
                info = site_info.get(site_id, {})
                size_kw_dc = info.get('size_kw_dc', 0)
                view_agg = view_aggregates.get(site_id, {})

                # Aggregate corrected values
                total_production = site_data['PRODUCTION'].sum()
                total_expected = site_data['EXPECTED_PRODUCTION'].sum()
                total_corrected_wa_expected = site_data['CORRECTED_WA_EXPECTED'].sum()
                days_with_data = len(site_data)

                # Corrected WA PR from aggregated sums
                if total_corrected_wa_expected > 0:
                    wa_pr = (total_production / total_corrected_wa_expected) * 100
                else:
                    wa_pr = None

                # Raw PR (no weather adjustment)
                if total_expected > 0:
                    raw_pr = (total_production / total_expected) * 100
                else:
                    raw_pr = None

                # Weighted corrected insolation gap
                valid_gaps = site_data[site_data['EXPECTED_PRODUCTION'] > 0]
                if not valid_gaps.empty:
                    insolation_gap = (valid_gaps['CORRECTED_INSOLATION_GAP'] * valid_gaps['EXPECTED_PRODUCTION']).sum() / valid_gaps['EXPECTED_PRODUCTION'].sum()
                else:
                    insolation_gap = 0

                # Get insolation source (most common)
                insolation_sources = site_data['CORRECTED_INSOLATION_SOURCE'].value_counts()
                insolation_source = insolation_sources.index[0] if len(insolation_sources) > 0 else 'UNKNOWN'

                # Count days with valid insolation
                days_with_valid_insolation = site_data['INSOLATION_VALID'].sum()

                # Count days with valid production (meter vs inverter validation passed)
                days_with_valid_production = site_data['PRODUCTION_VALID'].sum() if 'PRODUCTION_VALID' in site_data.columns else days_with_data

                # Get production source (most common from our smart selection)
                prod_sources = site_data['PRODUCTION_SOURCE'].value_counts() if 'PRODUCTION_SOURCE' in site_data.columns else {}
                corrected_prod_source = prod_sources.index[0] if len(prod_sources) > 0 else 'UNKNOWN'

                # Get other values from view aggregates
                if isinstance(view_agg, pd.Series):
                    availability = float(view_agg.get('WEIGHTED_AVAILABILITY', 0) or 0) * 100 if view_agg.get('WEIGHTED_AVAILABILITY') else None
                    revenue_rate = float(view_agg.get('AVG_REVENUE_RATE', 0.08) or 0.08)
                    total_revenue = float(view_agg.get('TOTAL_REVENUE', 0) or 0)
                    variance_wa_revenue = float(view_agg.get('TOTAL_VARIANCE_WA_REVENUE', 0) or 0)
                    snow_loss = float(view_agg.get('TOTAL_SNOW_LOSS', 0) or 0)
                    production_source = view_agg.get('PRODUCTION_SOURCE', 'meter')
                else:
                    availability = None
                    revenue_rate = 0.08
                    total_revenue = 0
                    variance_wa_revenue = 0
                    snow_loss = 0
                    production_source = 'meter'

                # Calculate years since PTO for display
                years_since_pto = 0
                pto_date = info.get('pto_date')
                if pto_date:
                    try:
                        if isinstance(pto_date, str):
                            pto_date = pd.to_datetime(pto_date)
                        if hasattr(pto_date, 'date'):
                            pto_dt = pto_date
                        else:
                            pto_dt = datetime.combine(pto_date, datetime.min.time())
                        years_since_pto = (datetime.now() - pto_dt.replace(tzinfo=None)).days / 365.25
                    except Exception:
                        pass

                # Degradation factor for display
                degradation_factor = 0.995 ** max(0, years_since_pto)

                # Weather factor for display
                weather_factor = 1.0 + insolation_gap

                # Capacity factor
                capacity_factor = None
                if size_kw_dc > 0 and days_with_data > 0:
                    capacity_factor = (total_production / (size_kw_dc * days_with_data * 5)) * 100

                # Specific yield
                specific_yield = (total_production / size_kw_dc) if size_kw_dc > 0 else 0

                # Data quality assessment
                data_quality_flags = []

                # Flag production source issues
                if 'FALLBACK' in corrected_prod_source:
                    data_quality_flags.append('meter_spike_corrected')
                if 'UNVALIDATED' in corrected_prod_source:
                    data_quality_flags.append('production_unvalidated')

                # Flag if many days had invalid production (used inverter fallback)
                prod_invalid_ratio = (days_with_data - days_with_valid_production) / days_with_data if days_with_data > 0 else 0
                if prod_invalid_ratio > 0.3:
                    data_quality_flags.append('production_data_issues')

                # Flag if many days had invalid insolation (required satellite fallback)
                satellite_ratio = (days_with_data - days_with_valid_insolation) / days_with_data if days_with_data > 0 else 0
                if satellite_ratio > 0.5:
                    data_quality_flags.append('mostly_satellite_insolation')
                elif satellite_ratio > 0.2:
                    data_quality_flags.append('some_satellite_insolation')

                # WA PR validity for stats
                # With corrected insolation, extreme values indicate real performance issues
                # so we DON'T exclude low performers (that's valuable info!)
                # Only exclude impossibly high values (>130% even with corrections)
                wa_pr_valid_for_stats = True
                if wa_pr is not None and wa_pr > 130:
                    data_quality_flags.append('wa_pr_extreme_high')
                    wa_pr_valid_for_stats = False

                # Flag extreme insolation gap for period (tighter threshold for multi-day)
                # For 7+ days, gap should be within ±30%
                gap_threshold = 0.5 if actual_days <= 3 else 0.3
                if insolation_gap < -gap_threshold:
                    data_quality_flags.append('insolation_gap_negative')
                elif insolation_gap > gap_threshold:
                    data_quality_flags.append('insolation_gap_positive')

                # Availability estimation fallback
                availability_estimated = False
                if (availability is None or availability < 1.0) and total_production > 0 and capacity_factor:
                    if capacity_factor > 0:
                        availability = min(100, (capacity_factor / 20.0) * 100)
                        availability_estimated = True
                        data_quality_flags.append('availability_estimated_from_cf')

                # Get meter/inverter production from corrected daily data
                meter_production = site_data['METER_ENERGY'].sum() if 'METER_ENERGY' in site_data.columns else total_production
                inv_production = site_data['INV_TOTAL_ENERGY'].sum() if 'INV_TOTAL_ENERGY' in site_data.columns else 0

                # Total corrected insolation
                total_corrected_insolation = site_data['CORRECTED_INSOLATION'].sum()

                kpi_rows.append(_to_native_dict({
                    'site_id': site_id,
                    'site_name': info.get('site_name', site_id),
                    'size_kw_dc': round(size_kw_dc, 1),
                    'size_kw_ac': round(info.get('size_kw_ac', size_kw_dc), 1),
                    'primary_das': info.get('primary_das', 'Unknown'),
                    'years_since_pto': round(years_since_pto, 1),
                    'is_bess_site': info.get('is_bess_site', False),

                    # Production metrics (smart selection: meter validated vs inverter fallback)
                    'meter_production_kwh': round(meter_production, 1),
                    'inverter_production_kwh': round(inv_production, 1),
                    'smart_production_kwh': round(total_production, 1),
                    'production_source': corrected_prod_source.lower() if corrected_prod_source else 'none',
                    'expected_production_kwh': round(total_expected, 1),
                    'weather_adjusted_expected_kwh': round(total_corrected_wa_expected, 1),

                    # Insolation (corrected via smart selection)
                    'actual_insolation': round(total_corrected_insolation, 1),
                    'expected_insolation': 0,
                    'insolation_gap': round(insolation_gap * 100, 1),  # Convert to percentage

                    # Performance ratios (corrected WA PR)
                    'pr_raw': round(raw_pr, 1) if raw_pr is not None else None,
                    'pr_weather_adjusted': round(wa_pr, 1) if wa_pr is not None else None,

                    # Factors
                    'weather_factor': round(weather_factor, 3),
                    'degradation_factor': round(degradation_factor, 4),

                    # Other KPIs
                    'availability_pct': round(availability, 1) if availability is not None else None,
                    'availability_estimated': availability_estimated,
                    'specific_yield_kwh_kwp': round(specific_yield, 2),
                    'capacity_factor_pct': round(capacity_factor, 1) if capacity_factor is not None else None,

                    # Revenue (from view aggregates)
                    'revenue_rate': round(revenue_rate, 4),
                    'total_revenue': round(total_revenue, 2),
                    'variance_wa_revenue': round(variance_wa_revenue, 2),
                    'snow_loss_kwh': round(snow_loss, 1),

                    # Data quality
                    'hours_with_data': days_with_data * 24,
                    'days_with_data': days_with_data,
                    'data_quality': 'good' if days_with_data >= (actual_days * 0.7) else 'partial' if days_with_data > 0 else 'no_data',
                    'data_quality_flags': data_quality_flags,
                    'irradiance_type': 'POA' if info.get('irradiance_type', 2) == 2 else 'GHI',
                    'insolation_source': insolation_source,  # Show which source was primarily used

                    # Flag for statistics inclusion
                    'wa_pr_valid_for_stats': wa_pr_valid_for_stats
                }))

        # Sort by WA PR descending (best performers first)
        kpi_rows.sort(key=lambda x: x.get('pr_weather_adjusted') or 0, reverse=True)

        # Add rank
        for i, row in enumerate(kpi_rows):
            row['rank'] = i + 1

        # Calculate fleet-level statistics
        # IMPORTANT: Filter out extreme WA PR values from statistics
        # These are sites with bad insolation data (weather station offline, etc.)
        valid_rows = [r for r in kpi_rows if r.get('wa_pr_valid_for_stats', True)]
        flagged_count = len(kpi_rows) - len(valid_rows)

        wa_prs = [r['pr_weather_adjusted'] for r in valid_rows if r.get('pr_weather_adjusted')]
        raw_prs = [r['pr_raw'] for r in valid_rows if r.get('pr_raw')]
        availabilities = [r['availability_pct'] for r in valid_rows if r.get('availability_pct')]

        return {
            'kpis': kpi_rows,
            'stage': stage,
            'period_days': actual_days,
            'start_date': start_date,
            'end_date': end_date,
            'statistics': _to_native_dict({
                'site_count': len(kpi_rows),
                'sites_valid_for_stats': len(valid_rows),
                'sites_with_data_quality_issues': flagged_count,
                'wa_pr_avg': round(np.mean(wa_prs), 1) if wa_prs else None,
                'wa_pr_median': round(np.median(wa_prs), 1) if wa_prs else None,
                'wa_pr_min': round(min(wa_prs), 1) if wa_prs else None,
                'wa_pr_max': round(max(wa_prs), 1) if wa_prs else None,
                'raw_pr_avg': round(np.mean(raw_prs), 1) if raw_prs else None,
                'availability_avg': round(np.mean(availabilities), 1) if availabilities else None,
                'total_production_kwh': round(sum(r['smart_production_kwh'] for r in kpi_rows), 0),
                'total_capacity_kw': round(sum(r['size_kw_dc'] for r in kpi_rows), 0),
                'total_revenue': round(sum(r.get('total_revenue', 0) for r in kpi_rows), 2),
                'total_variance_wa_revenue': round(sum(r.get('variance_wa_revenue', 0) for r in kpi_rows), 2),
            }),
            'generated_at': datetime.now().isoformat()
        }

    # =========================================================================
    # Fleet Comparative Analytics
    # =========================================================================

    def get_fleet_rankings(self, stage: str = 'FC', metric: str = 'performance') -> Dict[str, Any]:
        """
        Get fleet rankings by various metrics.

        Metrics:
        - performance: By PR
        - availability: By availability %
        - production: By kWh/kWp
        - health: By maintenance score

        Optimized: Uses batch queries instead of per-site queries for fast loading.
        """
        sites_df = self.ds.get_operational_sites()

        if stage == 'FC':
            sites_df = sites_df[sites_df['DELIVERY_PHASE'].str.upper() == 'FC']
        elif stage == 'Pre-FC':
            sites_df = sites_df[sites_df['DELIVERY_PHASE'].str.upper().isin(['BU', 'PTO', 'SC'])]

        site_ids = sites_df['SITE_ID'].tolist()

        # BATCH: Get all forecast data in one query
        all_forecasts = self.ds.get_all_forecast_data(site_ids)

        # BATCH: Get all metrics summaries in one query
        metrics_df = self.ds.get_fleet_metrics_summary(site_ids, days=7)

        # Build metrics lookup by site_id
        metrics_by_site: Dict[str, Dict] = {}
        if not metrics_df.empty:
            for site_id in site_ids:
                site_metrics = metrics_df[metrics_df['SITEID'] == site_id]
                if not site_metrics.empty:
                    metrics_by_site[site_id] = {
                        'meter_energy': float(site_metrics['METER_ENERGY_SUM'].sum()),
                        'inv_energy': float(site_metrics['INV_TOTAL_ENERGY_SUM'].sum()),
                        'insolation_poa': float(site_metrics['INSOLATION_POA_SUM'].sum()),
                        'insolation_ghi': float(site_metrics['INSOLATION_GHI_SUM'].sum()),
                        'months': site_metrics['MONTH'].tolist(),
                        'hours_by_month': dict(zip(
                            site_metrics['MONTH'].tolist(),
                            site_metrics['HOURS_COUNT'].tolist()
                        ))
                    }

        rankings = []

        for _, site in sites_df.iterrows():
            site_id = site['SITE_ID']
            site_data = {
                'site_id': site_id,
                'site_name': site.get('SITE_NAME', site_id),
                'size_kw_dc': float(site.get('SIZE_KW_DC', 0) or 0),
                'primary_das': site.get('PRIMARY_DAS', 'Unknown')
            }

            # Get forecast for this site
            forecast = all_forecasts.get(site_id, {'Production': {}, 'POA': {}, 'GHI': {}})
            site_metrics = metrics_by_site.get(site_id, {})

            # Calculate PR in memory
            pr_result = self._calculate_pr_from_batch(
                forecast=forecast,
                site_metrics=site_metrics,
                pto_date=site.get('PTO_ACTUAL_DATE')
            )

            site_data['performance_ratio'] = pr_result.get('pr')
            site_data['data_quality'] = pr_result.get('data_quality', 'unknown')

            # Calculate specific KWh/kWp
            actual = pr_result.get('actual_production_kwh', 0)
            size = site_data['size_kw_dc']
            site_data['kwh_per_kwp'] = round(actual / size, 2) if size > 0 else 0

            rankings.append(site_data)

        # Sort by metric
        if metric == 'performance':
            rankings.sort(key=lambda x: x.get('performance_ratio') or 0, reverse=True)
        elif metric == 'production':
            rankings.sort(key=lambda x: x.get('kwh_per_kwp', 0), reverse=True)

        # Add rank
        for i, site in enumerate(rankings):
            site['rank'] = i + 1

        # Calculate statistics
        prs = [r['performance_ratio'] for r in rankings if r.get('performance_ratio')]

        return {
            'rankings': rankings,
            'metric': metric,
            'stage': stage,
            'statistics': {
                'count': len(rankings),
                'avg_pr': round(np.mean(prs), 1) if prs else None,
                'median_pr': round(np.median(prs), 1) if prs else None,
                'min_pr': round(min(prs), 1) if prs else None,
                'max_pr': round(max(prs), 1) if prs else None,
                'std_pr': round(np.std(prs), 1) if len(prs) > 1 else None
            },
            'generated_at': datetime.now().isoformat()
        }

    def _calculate_pr_from_batch(
        self,
        forecast: Dict[str, Dict[int, float]],
        site_metrics: Dict[str, Any],
        pto_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Calculate PR using pre-fetched batch data (no additional queries)."""
        result = {
            'pr': None, 'actual_production_kwh': 0, 'expected_production_kwh': 0,
            'weather_adjusted_expected_kwh': 0, 'weather_adjustment_factor': 1.0,
            'degradation_factor': 1.0, 'data_quality': 'insufficient'
        }

        if not forecast.get('Production'):
            result['data_quality'] = 'no_forecast'
            return result

        if not site_metrics:
            result['data_quality'] = 'no_production_data'
            return result

        try:
            # Calculate degradation
            if pto_date:
                if isinstance(pto_date, str):
                    pto_date = pd.to_datetime(pto_date)
                if hasattr(pto_date, 'date'):
                    pto_dt = pto_date
                else:
                    pto_dt = datetime.combine(pto_date, datetime.min.time())
                years_since_pto = (datetime.now() - pto_dt).days / 365.25
                result['degradation_factor'] = round(0.995 ** max(0, years_since_pto), 4)

            # Actual production (prefer meter, fallback to inverter)
            meter_energy = site_metrics.get('meter_energy', 0)
            inv_energy = site_metrics.get('inv_energy', 0)
            actual_prod = max(0, meter_energy) if meter_energy > 0 else max(0, inv_energy)

            if actual_prod <= 0:
                result['data_quality'] = 'no_energy_data'
                return result

            result['actual_production_kwh'] = round(actual_prod, 2)

            # Expected production
            months_in_data = site_metrics.get('months', [])
            hours_by_month = site_metrics.get('hours_by_month', {})

            expected_total = 0
            for month in months_in_data:
                if month in forecast['Production']:
                    hours_in_month = hours_by_month.get(month, 0)
                    month_fraction = hours_in_month / 730
                    expected_total += forecast['Production'][month] * month_fraction

            result['expected_production_kwh'] = round(expected_total, 2)

            # Weather adjustment
            actual_insolation = site_metrics.get('insolation_poa', 0)
            if actual_insolation <= 0:
                actual_insolation = site_metrics.get('insolation_ghi', 0)

            expected_insolation = 0
            for month in months_in_data:
                hours_in_month = hours_by_month.get(month, 0)
                month_fraction = hours_in_month / 730
                if month in forecast.get('POA', {}):
                    expected_insolation += forecast['POA'][month] * month_fraction
                elif month in forecast.get('GHI', {}):
                    expected_insolation += forecast['GHI'][month] * month_fraction

            if expected_insolation > 0 and actual_insolation > 0:
                result['weather_adjustment_factor'] = round(actual_insolation / expected_insolation, 3)

            weather_adjusted = expected_total * result['weather_adjustment_factor'] * result['degradation_factor']
            result['weather_adjusted_expected_kwh'] = round(weather_adjusted, 2)

            if weather_adjusted > 0:
                result['pr'] = round((actual_prod / weather_adjusted) * 100, 1)
                result['data_quality'] = 'good'
            else:
                result['data_quality'] = 'zero_expected'

        except Exception as e:
            result['data_quality'] = f'error: {str(e)}'

        return result

    # =========================================================================
    # String-Level Analysis
    # =========================================================================

    def get_string_analysis(self, site_id: str, days: int = 7) -> Dict[str, Any]:
        """
        Get detailed string/inverter-level analysis for a site.
        """
        site_info = self.ds.get_site_details(site_id)
        if not site_info:
            return {'error': 'Site not found'}

        inverter_count = int(site_info.get('INVERTER_COUNT', 0) or 0)
        size_kw = float(site_info.get('SIZE_KW_DC', 0) or 0)

        if inverter_count == 0:
            return {'error': 'No inverters configured'}

        expected_kw_per_inv = size_kw / inverter_count

        # Get metrics data
        metrics_df = self.ds.get_site_metrics_data(site_id, days=days)
        if metrics_df.empty:
            return {'error': 'No metrics data available'}

        # Analyze each inverter
        inverter_analysis = []
        for i in range(1, inverter_count + 1):
            col = f'IN{i}_VALUE'
            if col not in metrics_df.columns:
                continue

            values = pd.to_numeric(metrics_df[col], errors='coerce').fillna(0)

            # Calculate statistics
            total_kwh = values.sum()
            avg_kw = values.mean()
            max_kw = values.max()
            hours_producing = (values > 0).sum()
            total_hours = len(values)

            # Calculate capacity factor
            capacity_factor = (total_kwh / (expected_kw_per_inv * total_hours) * 100) if (expected_kw_per_inv * total_hours) > 0 else 0

            # Detect issues
            issues = []
            if hours_producing / total_hours < 0.3:
                issues.append('Low production hours')
            if capacity_factor < 10:
                issues.append('Very low capacity factor')

            inverter_analysis.append({
                'inverter': f'IN{i}',
                'total_kwh': round(total_kwh, 2),
                'avg_kw': round(avg_kw, 2),
                'max_kw': round(max_kw, 2),
                'expected_kw': round(expected_kw_per_inv, 2),
                'capacity_factor': round(capacity_factor, 1),
                'hours_producing': int(hours_producing),
                'total_hours': int(total_hours),
                'uptime_pct': round((hours_producing / total_hours * 100) if total_hours > 0 else 0, 1),
                'issues': issues,
                'status': 'warning' if issues else 'healthy'
            })

        # Sort by capacity factor (worst first for troubleshooting)
        inverter_analysis.sort(key=lambda x: x['capacity_factor'])

        # Calculate fleet average for comparison
        all_cfs = [inv['capacity_factor'] for inv in inverter_analysis]
        avg_cf = np.mean(all_cfs) if all_cfs else 0

        # Flag outliers (more than 15% below average)
        for inv in inverter_analysis:
            if avg_cf > 0 and inv['capacity_factor'] < avg_cf * 0.85:
                inv['is_outlier'] = True
                if 'Underperforming vs peers' not in inv['issues']:
                    inv['issues'].append('Underperforming vs peers')
                    inv['status'] = 'warning'
            else:
                inv['is_outlier'] = False

        return {
            'site_id': site_id,
            'site_name': site_info.get('SITE_NAME', site_id),
            'inverter_count': inverter_count,
            'size_kw_dc': size_kw,
            'expected_kw_per_inverter': round(expected_kw_per_inv, 2),
            'analysis_period_days': days,
            'inverters': inverter_analysis,
            'summary': {
                'avg_capacity_factor': round(avg_cf, 1),
                'best_performer': inverter_analysis[-1]['inverter'] if inverter_analysis else None,
                'worst_performer': inverter_analysis[0]['inverter'] if inverter_analysis else None,
                'outliers_count': len([inv for inv in inverter_analysis if inv.get('is_outlier')]),
                'total_issues': sum(len(inv['issues']) for inv in inverter_analysis)
            },
            'generated_at': datetime.now().isoformat()
        }
