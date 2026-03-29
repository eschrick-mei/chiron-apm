"""
Chiron APM v4.0 - Data Service
Optimized data access layer with shared Redis caching for multi-worker deployment.
"""

import os
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from pathlib import Path
import sys
import logging
import threading

# Add parent paths for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

try:
    from CHIRON_MONITORING.config import Config
    from CHIRON_MONITORING.data import SnowflakeConnector
    _HAS_SNOWFLAKE = True
except ImportError:
    _HAS_SNOWFLAKE = False
    Config = None
    SnowflakeConnector = None

from cache import RedisCache

logger = logging.getLogger(__name__)


class DataService:
    """
    Optimized data service with shared Redis caching.

    Features:
    - Redis-backed caching shared across all workers
    - Falls back to in-memory cache if Redis unavailable
    - Thread-safe Snowflake connection with timeout
    - All query methods are synchronous (called via asyncio.to_thread from routes)
    """

    def __init__(self, redis_url: Optional[str] = None):
        self._connector = None
        self._config = None
        self._lock = threading.Lock()
        self._conn_lock = threading.Lock()  # Protects connection init / reconnect only
        self._use_pg = bool(os.environ.get("CHIRON_PG_DSN"))

        # Shared Redis cache (or in-memory fallback)
        self.cache = RedisCache(redis_url=redis_url)

    def _execute(self, query: str, params=None):
        """Parallel-safe query execution.

        When CHIRON_PG_DSN is set, queries run against local PostgreSQL
        (sub-10ms).  Otherwise falls back to Snowflake with per-call cursors.
        """
        if self._use_pg:
            return self._execute_pg(query, params)
        return self._execute_snowflake(query, params)

    def _execute_pg(self, query: str, params=None):
        """Execute via PgConnector (local PostgreSQL)."""
        with self._conn_lock:
            conn = self.connector
            if not conn.is_connected():
                conn.connect()
        return conn.execute_query(query, params)

    def _execute_snowflake(self, query: str, params=None):
        """Execute via Snowflake with per-call cursor."""
        from snowflake.connector import DictCursor

        # Ensure connection is alive (serialized — very fast check)
        with self._conn_lock:
            conn = self.connector
            if not conn.is_connected():
                conn.connect()

        # Execute on a fresh cursor — no global lock needed
        cursor = conn._connection.cursor(DictCursor)
        try:
            start = datetime.now()
            if params:
                cursor.execute(query, params)
            else:
                cursor.execute(query)
            results = cursor.fetchall()
            elapsed = (datetime.now() - start).total_seconds() * 1000
            logger.debug("Query executed in %.1fms, %d rows", elapsed, len(results))
            return results
        except Exception as e:
            logger.error("Query execution error: %s", e)
            logger.debug("Query: %s...", query[:200])
            return None
        finally:
            cursor.close()

    @property
    def config(self):
        if self._config is None:
            if not _HAS_SNOWFLAKE:
                raise RuntimeError("Snowflake config not available — running in PG-only mode")
            config_path = Path(__file__).parent.parent.parent / "config.json"
            self._config = Config(config_file=str(config_path))
        return self._config

    @property
    def connector(self):
        with self._lock:
            if self._connector is None:
                if self._use_pg:
                    from pg_adapter import PgConnector
                    self._connector = PgConnector()
                    logger.info("Using PostgreSQL backend")
                else:
                    params = self.config.snowflake.connection_params
                    # Remove timeout params not accepted by SnowflakeConnector
                    params.pop('network_timeout', None)
                    params.pop('login_timeout', None)
                    self._connector = SnowflakeConnector(**params)
                    logger.info("Using Snowflake backend")
            return self._connector

    def close(self):
        with self._lock:
            if self._connector:
                try:
                    self._connector.disconnect()
                except Exception:
                    pass  # Ignore errors on shutdown
                self._connector = None

    # =========================================================================
    # PPA Rate Functions (from TE_OPERATING)
    # =========================================================================

    def get_site_ppa_rates(self) -> Dict[str, float]:
        """
        Get PPA rates for all sites from TE_OPERATING table.
        Rate = REVENUE_TOTAL_PPA / MONTHLY_PRODUCTION for current month.
        Cached for 1 hour at boot.
        """
        cache_key = "ppa_rates"

        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        try:
            # Get current month's data from TE_OPERATING
            query = """
            SELECT
                SITE_ID,
                REVENUE_TOTAL_PPA,
                MONTHLY_PRODUCTION,
                RECORD_DATE
            FROM MEI_FINANCE_DB.MAIN_FINANCE.TE_OPERATING
            WHERE DATE_TRUNC('month', RECORD_DATE) = DATE_TRUNC('month', CURRENT_DATE())
              AND MONTHLY_PRODUCTION > 0
            """
            result = self._execute(query)

            rates = {}
            if result:
                for row in result:
                    site_id = row.get('SITE_ID')
                    revenue = row.get('REVENUE_TOTAL_PPA', 0) or 0
                    production = row.get('MONTHLY_PRODUCTION', 0) or 0

                    if site_id and production > 0:
                        # Rate in $/kWh
                        rates[site_id] = round(revenue / production, 4)

            # If no current month data, try last month
            if not rates:
                query = """
                SELECT
                    SITE_ID,
                    REVENUE_TOTAL_PPA,
                    MONTHLY_PRODUCTION
                FROM MEI_FINANCE_DB.MAIN_FINANCE.TE_OPERATING
                WHERE DATE_TRUNC('month', RECORD_DATE) = DATE_TRUNC('month', DATEADD(month, -1, CURRENT_DATE()))
                  AND MONTHLY_PRODUCTION > 0
                """
                result = self._execute(query)

                if result:
                    for row in result:
                        site_id = row.get('SITE_ID')
                        revenue = row.get('REVENUE_TOTAL_PPA', 0) or 0
                        production = row.get('MONTHLY_PRODUCTION', 0) or 0

                        if site_id and production > 0:
                            rates[site_id] = round(revenue / production, 4)

            self.cache.set(cache_key, rates)
            return rates

        except Exception as e:
            # If TE_OPERATING table not accessible, return empty
            # (will fall back to default rate)
            print(f"Warning: Could not fetch PPA rates from TE_OPERATING: {e}")
            return {}

    def get_site_rate(self, site_id: str, default: float = 0.08) -> float:
        """Get PPA rate for a specific site in $/kWh."""
        rates = self.get_site_ppa_rates()
        return rates.get(site_id, default)

    # =========================================================================
    # Site Data Functions
    # =========================================================================

    def get_operational_sites(self) -> pd.DataFrame:
        """
        Get operational sites.
        - FC sites: PTO_ACTUAL_DATE < today AND FC_ACTUAL_DATE < today
        - Pre-FC sites: PTO_ACTUAL_DATE < today AND (FC_ACTUAL_DATE IS NULL OR FC_ACTUAL_DATE >= today)

        The DELIVERY_PHASE column is derived based on these dates.
        """
        cache_key = "operational_sites"

        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        query = """
        SELECT
            SITE_ID,
            SITE_NAME,
            SIZE_KW_DC,
            SIZE_KW_AC,
            PRIMARY_DAS,
            INVERTER_COUNT,
            PTO_ACTUAL_DATE,
            FC_ACTUAL_DATE,
            TIMEZONE,
            LATITUDE,
            LONGITUDE,
            DELIVERY_PHASE,
            -- IRRADIANCE_TYPE: 1=GHI preferred, 2=POA preferred (default POA)
            COALESCE(IRRADIANCE_TYPE, '2') as IRRADIANCE_TYPE,
            -- Derive operational stage based on dates
            CASE
                WHEN FC_ACTUAL_DATE IS NOT NULL AND FC_ACTUAL_DATE < CURRENT_DATE()
                THEN 'FC'
                WHEN PTO_ACTUAL_DATE IS NOT NULL AND PTO_ACTUAL_DATE < CURRENT_DATE()
                THEN 'Pre-FC'
                ELSE 'Pre-PTO'
            END as OPERATIONAL_STAGE
        FROM MEI_ASSET_MGMT_DB.PUBLIC.SITE_MASTER
        WHERE SITE_ID IS NOT NULL
          AND PTO_ACTUAL_DATE IS NOT NULL
          AND PTO_ACTUAL_DATE < CURRENT_DATE()
        ORDER BY SITE_ID
        """
        result = self._execute(query)
        df = pd.DataFrame(result) if result else pd.DataFrame()

        self.cache.set(cache_key, df)
        return df

    def get_site_details(self, site_id: str) -> Dict[str, Any]:
        """Get detailed info for a specific site."""
        cache_key = f"site_details_{site_id}"

        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        query = f"""
        SELECT *
        FROM MEI_ASSET_MGMT_DB.PUBLIC.SITE_MASTER
        WHERE SITE_ID = '{site_id}'
        """
        result = self._execute(query)
        details = dict(result[0]) if result else {}

        self.cache.set(cache_key, details)
        return details

    # =========================================================================
    # Equipment Functions
    # =========================================================================

    def get_site_equipment(self, site_id: str, primary_das_only: bool = True) -> pd.DataFrame:
        """Get equipment for a site from ASSET_REGISTRY."""
        cache_key = f"equipment_{site_id}_{primary_das_only}"

        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        if primary_das_only:
            query = f"""
            SELECT
                ar.EQUIPMENT_ID,
                ar.HARDWARE_ID,
                ar.EQUIPMENT_CODE,
                ar.EQUIPMENT_TYPE,
                ar.DAS_NAME,
                ar.TYPE_INDEX,
                ar.COLUMN_MAPPING,
                ar.CAPACITY_KW,
                ar.CAPACITY_DC_KW,
                ar.QUANTITY,
                ar.ATTRIBUTES,
                ar.PARENT_EQUIPMENT_ID,
                ar.DAS
            FROM MEI_ASSET_MGMT_DB.PUBLIC.ASSET_REGISTRY ar
            JOIN MEI_ASSET_MGMT_DB.PUBLIC.SITE_MASTER sm ON ar.SITE_ID = sm.SITE_ID
            WHERE ar.SITE_ID = '{site_id}'
              AND UPPER(ar.DAS) = UPPER(sm.PRIMARY_DAS)
            ORDER BY ar.EQUIPMENT_CODE, ar.TYPE_INDEX
            """
        else:
            query = f"""
            SELECT
                EQUIPMENT_ID, HARDWARE_ID, EQUIPMENT_CODE, EQUIPMENT_TYPE,
                DAS_NAME, TYPE_INDEX, COLUMN_MAPPING, CAPACITY_KW,
                CAPACITY_DC_KW, QUANTITY, ATTRIBUTES, PARENT_EQUIPMENT_ID, DAS
            FROM MEI_ASSET_MGMT_DB.PUBLIC.ASSET_REGISTRY
            WHERE SITE_ID = '{site_id}'
            ORDER BY EQUIPMENT_CODE, TYPE_INDEX
            """
        result = self._execute(query)
        df = pd.DataFrame(result) if result else pd.DataFrame()
        self.cache.set(cache_key, df)
        return df

    def get_equipment_latest_values(self, site_id: str) -> Dict[str, Any]:
        """Get latest equipment values from hourly data."""
        cache_key = f"latest_values_{site_id}"

        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        query = f"""
        SELECT *
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.HOURLY_DATA_LIVE
        WHERE SITEID = '{site_id}'
          AND DATA_TYPE = 'current'
        ORDER BY MEASUREMENTTIME DESC
        LIMIT 1
        """
        result = self._execute(query)
        values = dict(result[0]) if result else {}
        self.cache.set(cache_key, values)
        return values

    def get_all_sites_latest_values(self, site_ids: List[str] = None) -> pd.DataFrame:
        """
        Get latest equipment values for ALL sites in a single query.
        This is much more efficient than calling get_equipment_latest_values per site.
        """
        cache_key = "all_sites_latest"

        cached = self.cache.get(cache_key)
        if cached is not None:
            if site_ids:
                return cached[cached['SITEID'].isin(site_ids)]
            return cached

        # Get latest record per site using window function
        query = """
        WITH ranked AS (
            SELECT *,
                ROW_NUMBER() OVER (PARTITION BY SITEID ORDER BY MEASUREMENTTIME DESC) as rn
            FROM MEI_ASSET_MGMT_DB.PERFORMANCE.HOURLY_DATA_LIVE
            WHERE DATA_TYPE = 'current'
        )
        SELECT *
        FROM ranked
        WHERE rn = 1
        """
        result = self._execute(query)
        df = pd.DataFrame(result) if result else pd.DataFrame()

        self.cache.set(cache_key, df)

        if site_ids and not df.empty:
            return df[df['SITEID'].isin(site_ids)]
        return df

    def get_all_sites_historical_values(
        self, timestamp: datetime, site_ids: List[str] = None
    ) -> pd.DataFrame:
        """
        Get equipment values for ALL sites at a specific historical timestamp.
        Returns the closest data point within 1 hour of the requested time.
        """
        # Format timestamp for SQL
        ts_str = timestamp.strftime('%Y-%m-%d %H:00:00')

        # Query for the specific hour (within a 2-hour window to handle data gaps)
        query = f"""
        WITH ranked AS (
            SELECT *,
                ROW_NUMBER() OVER (PARTITION BY SITEID ORDER BY ABS(TIMESTAMPDIFF(minute, MEASUREMENTTIME, '{ts_str}'))) as rn
            FROM MEI_ASSET_MGMT_DB.PERFORMANCE.HOURLY_DATA_LIVE
            WHERE DATA_TYPE = 'current'
              AND MEASUREMENTTIME >= DATEADD(hour, -1, '{ts_str}')
              AND MEASUREMENTTIME <= DATEADD(hour, 1, '{ts_str}')
        )
        SELECT *
        FROM ranked
        WHERE rn = 1
        """
        result = self._execute(query)
        df = pd.DataFrame(result) if result else pd.DataFrame()

        if site_ids and not df.empty:
            return df[df['SITEID'].isin(site_ids)]
        return df

    def get_available_timestamps(self, hours: int = 72) -> List[str]:
        """
        Get list of available timestamps for the time slider.
        Returns distinct hours with data in the last N hours.
        """
        cache_key = f"available_timestamps_{hours}"

        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        query = f"""
        SELECT DISTINCT DATE_TRUNC('hour', MEASUREMENTTIME) as HOUR
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.HOURLY_DATA_LIVE
        WHERE DATA_TYPE = 'current'
          AND MEASUREMENTTIME >= DATEADD(hour, -{hours}, CURRENT_TIMESTAMP())
        ORDER BY HOUR DESC
        """
        result = self._execute(query)
        timestamps = [row['HOUR'].isoformat() for row in result] if result else []

        self.cache.set(cache_key, timestamps)
        return timestamps

    # =========================================================================
    # Alert Functions
    # =========================================================================

    def get_site_alerts(self, site_id: str) -> pd.DataFrame:
        """Get active alerts for a site."""
        query = f"""
        SELECT
            ALERT_ID, ALERT_TYPE, EQUIPMENT_ID, EQUIPMENT_NAME,
            VERIFICATION_STATUS, DURATION_HOURS, DETECTED_AT
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.CHIRON_ALERTS
        WHERE SITE_ID = '{site_id}'
          AND STATUS = 'ACTIVE'
        ORDER BY DETECTED_AT DESC
        """
        result = self._execute(query)
        return pd.DataFrame(result) if result else pd.DataFrame()

    def get_fleet_alert_summary(self) -> Dict[str, Any]:
        """Get summary of alerts across the fleet."""
        cache_key = "fleet_alert_summary"

        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        query = """
        SELECT
            COUNT(*) as TOTAL_ALERTS,
            SUM(CASE WHEN ALERT_TYPE = 'SITE_OFFLINE' THEN 1 ELSE 0 END) as SITE_OFFLINE,
            SUM(CASE WHEN ALERT_TYPE = 'INVERTER_OFFLINE' THEN 1 ELSE 0 END) as INVERTER_OFFLINE,
            SUM(CASE WHEN VERIFICATION_STATUS = 'CONFIRMED' THEN 1 ELSE 0 END) as CONFIRMED,
            COUNT(DISTINCT SITE_ID) as SITES_AFFECTED
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.CHIRON_ALERTS
        WHERE STATUS = 'ACTIVE'
        """
        result = self._execute(query)
        summary = dict(result[0]) if result else {}

        self.cache.set(cache_key, summary)
        return summary

    def get_sites_with_alerts(self) -> List[str]:
        """Get list of site IDs with active alerts."""
        cache_key = "sites_with_alerts"

        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        query = """
        SELECT DISTINCT SITE_ID
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.CHIRON_ALERTS
        WHERE STATUS = 'ACTIVE'
        """
        result = self._execute(query)
        sites = [row['SITE_ID'] for row in result] if result else []

        self.cache.set(cache_key, sites)
        return sites

    def get_all_alerts(
        self,
        days: int = 7,
        status: Optional[str] = None,
        alert_type: Optional[str] = None,
        verification_status: Optional[str] = None,
        site_id: Optional[str] = None,
        stage: str = 'FC',
        limit: int = 500
    ) -> pd.DataFrame:
        """Get alerts with filters."""
        where_parts = [
            f"a.DETECTED_AT >= DATEADD(day, -{days}, CURRENT_TIMESTAMP())",
            "sm.PTO_ACTUAL_DATE < CURRENT_DATE()"
        ]

        if status:
            where_parts.append(f"UPPER(a.STATUS) = '{status.upper()}'")
        if alert_type:
            where_parts.append(f"UPPER(a.ALERT_TYPE) = '{alert_type.upper()}'")
        if verification_status:
            where_parts.append(f"UPPER(a.VERIFICATION_STATUS) = '{verification_status.upper()}'")
        if site_id:
            where_parts.append(f"a.SITE_ID = '{site_id}'")

        if stage == 'FC':
            where_parts.append("UPPER(sm.DELIVERY_PHASE) = 'FC'")
        elif stage == 'Pre-FC':
            where_parts.append("UPPER(sm.DELIVERY_PHASE) IN ('BU', 'PTO', 'SC')")

        query = f"""
        SELECT
            a.ALERT_ID, a.SITE_ID, a.SITE_NAME, a.ALERT_TYPE,
            a.ALERT_CATEGORY, a.EQUIPMENT_TYPE, a.EQUIPMENT_ID, a.EQUIPMENT_NAME,
            a.SEVERITY, a.DETECTED_AT, a.DURATION_HOURS, a.VERIFICATION_STATUS,
            a.VERIFIED_AT, a.STATUS, a.RESOLVED_AT, a.CHECK_COUNT, a.CREATED_AT,
            sm.DELIVERY_PHASE
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.CHIRON_ALERTS a
        JOIN MEI_ASSET_MGMT_DB.PUBLIC.SITE_MASTER sm ON a.SITE_ID = sm.SITE_ID
        WHERE {' AND '.join(where_parts)}
        ORDER BY a.CREATED_AT DESC
        LIMIT {limit}
        """
        result = self._execute(query)
        if result:
            df = pd.DataFrame(result)
            for col in ['DETECTED_AT', 'VERIFIED_AT', 'RESOLVED_AT', 'CREATED_AT']:
                if col in df.columns:
                    df[col] = pd.to_datetime(df[col])
            return df
        return pd.DataFrame()

    def get_alert_timeline(self, days: int = 7, verification_status: Optional[str] = None) -> pd.DataFrame:
        """Get alert counts over time for timeline chart."""
        where_parts = [f"DETECTED_AT >= DATEADD(day, -{days}, CURRENT_TIMESTAMP())"]
        if verification_status:
            where_parts.append(f"UPPER(VERIFICATION_STATUS) = '{verification_status.upper()}'")

        query = f"""
        SELECT
            DATE_TRUNC('hour', DETECTED_AT) as HOUR,
            UPPER(ALERT_TYPE) as ALERT_TYPE,
            COUNT(*) as COUNT
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.CHIRON_ALERTS
        WHERE {' AND '.join(where_parts)}
        GROUP BY DATE_TRUNC('hour', DETECTED_AT), UPPER(ALERT_TYPE)
        ORDER BY HOUR
        """
        result = self._execute(query)
        if result:
            df = pd.DataFrame(result)
            if 'HOUR' in df.columns:
                df['HOUR'] = pd.to_datetime(df['HOUR'])
            return df
        return pd.DataFrame()

    def get_alerts_by_site(self, days: int = 7, limit: int = 10, verification_status: Optional[str] = None) -> pd.DataFrame:
        """Get alert counts grouped by site."""
        where_parts = [f"DETECTED_AT >= DATEADD(day, -{days}, CURRENT_TIMESTAMP())"]
        if verification_status:
            where_parts.append(f"UPPER(VERIFICATION_STATUS) = '{verification_status.upper()}'")

        query = f"""
        SELECT
            SITE_ID, SITE_NAME, COUNT(*) as ALERT_COUNT,
            SUM(CASE WHEN UPPER(STATUS) = 'ACTIVE' THEN 1 ELSE 0 END) as ACTIVE_COUNT,
            SUM(CASE WHEN UPPER(VERIFICATION_STATUS) = 'CONFIRMED' THEN 1 ELSE 0 END) as CONFIRMED_COUNT
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.CHIRON_ALERTS
        WHERE {' AND '.join(where_parts)}
        GROUP BY SITE_ID, SITE_NAME
        ORDER BY ALERT_COUNT DESC
        LIMIT {limit}
        """
        result = self._execute(query)
        return pd.DataFrame(result) if result else pd.DataFrame()

    def get_alert_detail_data(
        self, site_id: str, alert_type: str, equipment_id: Optional[str] = None, days: int = 3
    ) -> Dict[str, pd.DataFrame]:
        """Get detailed data for alert visualization."""
        result = {}

        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        date_filter = f"""
            MEASUREMENTTIME >= '{start_date.strftime('%Y-%m-%d')}'
            AND MEASUREMENTTIME <= '{end_date.strftime('%Y-%m-%d 23:59:59')}'
            AND DATA_TYPE = 'current'
        """

        alert_type_upper = alert_type.upper() if alert_type else ''

        if alert_type_upper == 'INVERTER_OFFLINE':
            site_info = self.get_site_details(site_id)
            inverter_count = site_info.get('INVERTER_COUNT', 10) or 10
            inv_cols = [f"IN{i}_VALUE" for i in range(1, inverter_count + 1)]
            inv_col_str = ", ".join(inv_cols)

            query = f"""
            SELECT MEASUREMENTTIME, INSOLATION_POA, {inv_col_str}
            FROM MEI_ASSET_MGMT_DB.PERFORMANCE.HOURLY_DATA_LIVE
            WHERE SITEID = '{site_id}' AND {date_filter}
            ORDER BY MEASUREMENTTIME
            """
            query_result = self._execute(query)
            if query_result:
                df = pd.DataFrame(query_result)
                df.columns = [str(c).upper() for c in df.columns]
                df['MEASUREMENTTIME'] = pd.to_datetime(df['MEASUREMENTTIME'])

                affected_col = equipment_id.upper() if equipment_id else None
                peer_cols = [c for c in inv_cols if c != affected_col]

                if peer_cols:
                    peer_df = df[peer_cols].copy()
                    peer_df = peer_df.replace(0, pd.NA)
                    df['PEER_AVG'] = peer_df.mean(axis=1, skipna=True)
                else:
                    df['PEER_AVG'] = 0

                if affected_col and affected_col in df.columns:
                    df['AFFECTED'] = df[affected_col]
                else:
                    df['AFFECTED'] = 0

                result['main'] = df[['MEASUREMENTTIME', 'AFFECTED', 'PEER_AVG', 'INSOLATION_POA']]

        elif alert_type_upper == 'SITE_OFFLINE':
            query = f"""
            SELECT MEASUREMENTTIME, INV_TOTAL_ENERGY, METER_ENERGY, INSOLATION_GHI_SOLCAST
            FROM MEI_ASSET_MGMT_DB.PERFORMANCE.HOURLY_DATA_LIVE
            WHERE SITEID = '{site_id}' AND {date_filter}
            ORDER BY MEASUREMENTTIME
            """
            query_result = self._execute(query)
            if query_result:
                df = pd.DataFrame(query_result)
                df.columns = [str(c).upper() for c in df.columns]
                df['MEASUREMENTTIME'] = pd.to_datetime(df['MEASUREMENTTIME'])
                result['main'] = df

        elif alert_type_upper == 'METER_OFFLINE':
            # Get all meter columns and inverter total for comparison
            query = f"""
            SELECT MEASUREMENTTIME, INV_TOTAL_ENERGY, METER_ENERGY, INSOLATION_GHI_SOLCAST,
                   M1_VALUE, M2_VALUE, M3_VALUE, M4_VALUE, M5_VALUE
            FROM MEI_ASSET_MGMT_DB.PERFORMANCE.HOURLY_DATA_LIVE
            WHERE SITEID = '{site_id}' AND {date_filter}
            ORDER BY MEASUREMENTTIME
            """
            query_result = self._execute(query)
            if query_result:
                df = pd.DataFrame(query_result)
                df.columns = [str(c).upper() for c in df.columns]
                df['MEASUREMENTTIME'] = pd.to_datetime(df['MEASUREMENTTIME'])
                result['main'] = df

        return result

    # =========================================================================
    # Metrics and Heatmap Functions
    # =========================================================================

    def get_inverter_heatmap_data(self, site_id: str, days: int = 5) -> pd.DataFrame:
        """Get inverter data for heatmap visualization."""
        cache_key = f"heatmap_{site_id}_{days}"
        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        site_info = self.get_site_details(site_id)
        inverter_count = site_info.get('INVERTER_COUNT', 10) or 10

        inv_cols = [f"IN{i}_VALUE" for i in range(1, inverter_count + 1)]
        col_list = ", ".join(inv_cols)

        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)

        query = f"""
        SELECT MEASUREMENTTIME, INSOLATION_POA, INSOLATION_GHI_SOLCAST, {col_list}
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.HOURLY_DATA_LIVE
        WHERE SITEID = '{site_id}'
          AND DATA_TYPE = 'current'
          AND MEASUREMENTTIME >= '{start_date.strftime('%Y-%m-%d')}'
          AND MEASUREMENTTIME <= '{end_date.strftime('%Y-%m-%d 23:59:59')}'
        ORDER BY MEASUREMENTTIME
        """
        result = self._execute(query)
        if result:
            df = pd.DataFrame(result)
            df.columns = [str(c).upper() for c in df.columns]
            if 'MEASUREMENTTIME' in df.columns:
                df['MEASUREMENTTIME'] = pd.to_datetime(df['MEASUREMENTTIME'])
            self.cache.set(cache_key, df, ttl=120)
            return df
        return pd.DataFrame()

    def get_site_metrics_data(self, site_id: str, days: int = 5) -> pd.DataFrame:
        """Get site metrics (production, irradiance, etc.)."""
        cache_key = f"metrics_{site_id}_{days}"
        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        site_info = self.get_site_details(site_id)
        inverter_count = site_info.get('INVERTER_COUNT', 10) or 10

        inv_cols = [f"IN{i}_VALUE" for i in range(1, inverter_count + 1)]
        inv_col_str = ", ".join(inv_cols)

        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)

        query = f"""
        SELECT
            MEASUREMENTTIME, METER_ENERGY, INV_TOTAL_ENERGY,
            INSOLATION_POA, INSOLATION_GHI, AVAILABILITY_PERCENTAGE,
            {inv_col_str}
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.HOURLY_DATA_LIVE
        WHERE SITEID = '{site_id}'
          AND DATA_TYPE = 'current'
          AND MEASUREMENTTIME >= '{start_date.strftime('%Y-%m-%d')}'
          AND MEASUREMENTTIME <= '{end_date.strftime('%Y-%m-%d 23:59:59')}'
        ORDER BY MEASUREMENTTIME
        """
        result = self._execute(query)
        if result:
            df = pd.DataFrame(result)
            df['MEASUREMENTTIME'] = pd.to_datetime(df['MEASUREMENTTIME'])
            self.cache.set(cache_key, df, ttl=120)
            return df
        return pd.DataFrame()

    # =========================================================================
    # Analytics Functions
    # =========================================================================

    def get_site_analytics_summary(self, stage: str = 'FC', days: int = 7) -> pd.DataFrame:
        """Get site-level analytics summary."""
        stage_filter = ""
        if stage == 'FC':
            stage_filter = "AND UPPER(sm.DELIVERY_PHASE) = 'FC'"
        elif stage == 'Pre-FC':
            stage_filter = "AND UPPER(sm.DELIVERY_PHASE) IN ('BU', 'PTO', 'SC')"

        query = f"""
        WITH site_alert_stats AS (
            SELECT
                a.SITE_ID,
                COUNT(*) as TOTAL_ALERTS,
                SUM(CASE WHEN UPPER(a.STATUS) = 'ACTIVE' THEN 1 ELSE 0 END) as ACTIVE_ALERTS,
                SUM(CASE WHEN UPPER(a.VERIFICATION_STATUS) = 'CONFIRMED' AND UPPER(a.STATUS) = 'ACTIVE' THEN 1 ELSE 0 END) as CONFIRMED_ALERTS,
                SUM(CASE WHEN UPPER(a.ALERT_TYPE) = 'SITE_OFFLINE' AND UPPER(a.STATUS) = 'ACTIVE' THEN 1 ELSE 0 END) as SITE_OFFLINE_COUNT,
                SUM(CASE WHEN UPPER(a.ALERT_TYPE) = 'INVERTER_OFFLINE' AND UPPER(a.STATUS) = 'ACTIVE' THEN 1 ELSE 0 END) as INV_OFFLINE_COUNT,
                SUM(CASE WHEN UPPER(a.ALERT_TYPE) = 'SITE_OFFLINE' AND UPPER(a.STATUS) = 'ACTIVE' AND UPPER(a.VERIFICATION_STATUS) = 'CONFIRMED' THEN 1 ELSE 0 END) as CONFIRMED_SITE_OFFLINE,
                SUM(CASE WHEN UPPER(a.ALERT_TYPE) = 'INVERTER_OFFLINE' AND UPPER(a.STATUS) = 'ACTIVE' AND UPPER(a.VERIFICATION_STATUS) = 'CONFIRMED' THEN 1 ELSE 0 END) as CONFIRMED_INV_OFFLINE,
                MIN(a.DETECTED_AT) as OLDEST_ALERT_AT
            FROM MEI_ASSET_MGMT_DB.PERFORMANCE.CHIRON_ALERTS a
            WHERE a.DETECTED_AT >= DATEADD(day, -{days}, CURRENT_TIMESTAMP())
            GROUP BY a.SITE_ID
        ),
        site_inv_capacity AS (
            SELECT ar.SITE_ID, SUM(ar.CAPACITY_KW) as TOTAL_INVERTER_CAPACITY_KW
            FROM MEI_ASSET_MGMT_DB.PUBLIC.ASSET_REGISTRY ar
            JOIN MEI_ASSET_MGMT_DB.PUBLIC.SITE_MASTER sm2 ON ar.SITE_ID = sm2.SITE_ID
            WHERE UPPER(ar.EQUIPMENT_TYPE) = 'INVERTER' AND UPPER(ar.DAS) = UPPER(sm2.PRIMARY_DAS)
            GROUP BY ar.SITE_ID
        )
        SELECT
            sm.SITE_ID, sm.SITE_NAME, sm.SIZE_KW_DC, sm.PRIMARY_DAS, sm.INVERTER_COUNT,
            sm.DELIVERY_PHASE, sm.PTO_ACTUAL_DATE, sm.LATITUDE, sm.LONGITUDE,
            COALESCE(sas.TOTAL_ALERTS, 0) as TOTAL_ALERTS,
            COALESCE(sas.ACTIVE_ALERTS, 0) as ACTIVE_ALERTS,
            COALESCE(sas.CONFIRMED_ALERTS, 0) as CONFIRMED_ALERTS,
            COALESCE(sas.SITE_OFFLINE_COUNT, 0) as SITE_OFFLINE_COUNT,
            COALESCE(sas.INV_OFFLINE_COUNT, 0) as INV_OFFLINE_COUNT,
            COALESCE(sas.CONFIRMED_SITE_OFFLINE, 0) as CONFIRMED_SITE_OFFLINE,
            COALESCE(sas.CONFIRMED_INV_OFFLINE, 0) as CONFIRMED_INV_OFFLINE,
            sas.OLDEST_ALERT_AT,
            CASE
                WHEN sas.CONFIRMED_SITE_OFFLINE > 0 THEN sm.SIZE_KW_DC
                WHEN sas.CONFIRMED_INV_OFFLINE > 0 AND sm.INVERTER_COUNT > 0
                    THEN ROUND((sas.CONFIRMED_INV_OFFLINE::FLOAT / sm.INVERTER_COUNT) * COALESCE(sic.TOTAL_INVERTER_CAPACITY_KW, sm.SIZE_KW_DC), 2)
                ELSE 0
            END as ESTIMATED_KW_OFFLINE
        FROM MEI_ASSET_MGMT_DB.PUBLIC.SITE_MASTER sm
        LEFT JOIN site_alert_stats sas ON sm.SITE_ID = sas.SITE_ID
        LEFT JOIN site_inv_capacity sic ON sm.SITE_ID = sic.SITE_ID
        WHERE sm.SITE_ID IS NOT NULL AND sm.PTO_ACTUAL_DATE IS NOT NULL
          AND sm.PTO_ACTUAL_DATE < CURRENT_DATE() {stage_filter}
        ORDER BY ESTIMATED_KW_OFFLINE DESC, sm.SIZE_KW_DC DESC
        """
        result = self._execute(query)
        if result:
            df = pd.DataFrame(result)
            for col in ['PTO_ACTUAL_DATE', 'OLDEST_ALERT_AT']:
                if col in df.columns:
                    df[col] = pd.to_datetime(df[col])
            return df
        return pd.DataFrame()

    # =========================================================================
    # DAILY_DATA_LIVE / HOURLY_DATA_LIVE Query Functions (NEW)
    # =========================================================================

    def get_daily_kpis(
        self,
        site_ids: List[str],
        start_date: str,
        end_date: str,
        stage: Optional[str] = None
    ) -> pd.DataFrame:
        """
        Get pre-computed daily KPIs from DAILY_DATA_LIVE view.

        Returns all pre-computed columns including:
        - PRODUCTION, PRODUCTION_SOURCE
        - INSOLATION, INSOLATION_SOURCE, INSOLATION_GAP
        - EXPECTED_PRODUCTION, WA_EXPECTED_PRODUCTION
        - PERFORMANCE_RATIO, WA_PERFORMANCE_RATIO
        - REVENUE_RATE, REVENUE, VARIANCE_WA_REVENUE
        - LOSS_SNOW, STAGE, etc.
        """
        if not site_ids:
            return pd.DataFrame()

        site_ids_str = "', '".join(site_ids)

        stage_filter = ""
        if stage == 'FC':
            stage_filter = "AND STAGE = 'Post-FC'"
        elif stage == 'Pre-FC':
            stage_filter = "AND STAGE = 'Pre-FC'"

        query = f"""
        SELECT
            SITEID,
            SITENAME,
            MEASUREMENTTIME,
            STAGE,
            -- Production (pre-computed smart selection)
            PRODUCTION,
            PRODUCTION_SOURCE,
            -- Insolation (pre-computed with source preference)
            INSOLATION,
            INSOLATION_SOURCE,
            INSOLATION_GAP,
            -- Expected production (with degradation already applied)
            EXPECTED_PRODUCTION,
            EXPECTED_PRODUCTION_UW,
            WA_EXPECTED_PRODUCTION,
            WA_EXPECTED_PRODUCTION_UW,
            -- Performance ratios (pre-computed)
            PERFORMANCE_RATIO,
            WA_PERFORMANCE_RATIO,
            PERFORMANCE_RATIO_UW,
            WA_PERFORMANCE_RATIO_UW,
            -- Revenue (pre-computed from TE_OPERATING)
            REVENUE_RATE,
            REVENUE,
            EXPECTED_REVENUE,
            WA_EXPECTED_REVENUE,
            VARIANCE_PRODUCTION,
            VARIANCE_WA_PRODUCTION,
            VARIANCE_REVENUE,
            VARIANCE_WA_REVENUE,
            -- Other
            AVAILABILITY_PERCENTAGE,
            LOSS_SNOW,
            VARIANCE_METER_INV,
            -- Raw values for reference
            METER_ENERGY,
            INV_TOTAL_ENERGY,
            INSOLATION_GHI,
            INSOLATION_POA
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.DAILY_DATA_LIVE
        WHERE SITEID IN ('{site_ids_str}')
          AND DATA_TYPE = 'current'
          AND MEASUREMENTTIME >= '{start_date}'
          AND MEASUREMENTTIME <= '{end_date}'
          {stage_filter}
        ORDER BY SITEID, MEASUREMENTTIME
        """
        result = self._execute(query)
        if result:
            df = pd.DataFrame(result)
            if 'MEASUREMENTTIME' in df.columns:
                df['MEASUREMENTTIME'] = pd.to_datetime(df['MEASUREMENTTIME'])
            return df
        return pd.DataFrame()

    def get_fleet_daily_kpi_summary(
        self,
        site_ids: List[str],
        start_date: str,
        end_date: str,
        stage: Optional[str] = None
    ) -> pd.DataFrame:
        """
        Get aggregated daily KPIs per site from DAILY_DATA_LIVE.

        Uses pre-computed columns and aggregates them for the period.
        This is the primary method for the Fleet KPI Table.
        """
        if not site_ids:
            return pd.DataFrame()

        site_ids_str = "', '".join(site_ids)

        stage_filter = ""
        if stage == 'FC':
            stage_filter = "AND STAGE = 'Post-FC'"
        elif stage == 'Pre-FC':
            stage_filter = "AND STAGE = 'Pre-FC'"

        query = f"""
        SELECT
            d.SITEID,
            MAX(d.SITENAME) as SITENAME,
            -- Aggregated production
            SUM(d.PRODUCTION) as TOTAL_PRODUCTION,
            MAX(d.PRODUCTION_SOURCE) as PRODUCTION_SOURCE,
            SUM(d.METER_ENERGY) as TOTAL_METER_ENERGY,
            SUM(d.INV_TOTAL_ENERGY) as TOTAL_INV_ENERGY,
            -- Aggregated expected
            SUM(d.EXPECTED_PRODUCTION) as TOTAL_EXPECTED,
            SUM(d.WA_EXPECTED_PRODUCTION) as TOTAL_WA_EXPECTED,
            -- Portfolio PR (computed from sums)
            SUM(d.PRODUCTION) / NULLIF(SUM(d.EXPECTED_PRODUCTION), 0) as PR,
            SUM(d.PRODUCTION) / NULLIF(SUM(d.WA_EXPECTED_PRODUCTION), 0) as WA_PR,
            -- Production-weighted insolation gap
            SUM(d.INSOLATION_GAP * d.EXPECTED_PRODUCTION) / NULLIF(SUM(d.EXPECTED_PRODUCTION), 0) as WEIGHTED_INSOLATION_GAP,
            -- Insolation totals
            SUM(d.INSOLATION) as TOTAL_INSOLATION,
            MAX(d.INSOLATION_SOURCE) as INSOLATION_SOURCE,
            -- Production-weighted availability
            SUM(CASE WHEN d.AVAILABILITY_PERCENTAGE BETWEEN 0 AND 1 AND d.EXPECTED_PRODUCTION > 0
                THEN d.AVAILABILITY_PERCENTAGE * d.EXPECTED_PRODUCTION ELSE 0 END)
            / NULLIF(SUM(CASE WHEN d.AVAILABILITY_PERCENTAGE BETWEEN 0 AND 1 AND d.EXPECTED_PRODUCTION > 0
                THEN d.EXPECTED_PRODUCTION ELSE 0 END), 0) as WEIGHTED_AVAILABILITY,
            -- Revenue
            AVG(d.REVENUE_RATE) as AVG_REVENUE_RATE,
            SUM(d.REVENUE) as TOTAL_REVENUE,
            SUM(d.VARIANCE_WA_REVENUE) as TOTAL_VARIANCE_WA_REVENUE,
            -- Snow loss
            SUM(d.LOSS_SNOW) as TOTAL_SNOW_LOSS,
            -- Data quality
            COUNT(*) as DAYS_WITH_DATA,
            MAX(d.STAGE) as STAGE
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.DAILY_DATA_LIVE d
        WHERE d.SITEID IN ('{site_ids_str}')
          AND d.DATA_TYPE = 'current'
          AND d.MEASUREMENTTIME >= '{start_date}'
          AND d.MEASUREMENTTIME <= '{end_date}'
          {stage_filter}
        GROUP BY d.SITEID
        ORDER BY WA_PR DESC NULLS LAST
        """
        result = self._execute(query)
        if result:
            return pd.DataFrame(result)
        return pd.DataFrame()

    def diagnose_insolation_quality(
        self,
        site_ids: List[str],
        start_date: str,
        end_date: str
    ) -> pd.DataFrame:
        """
        Diagnostic query to analyze insolation data quality issues.

        Identifies sites with:
        - Onsite insolation = 0 but satellite > 0 (weather station offline)
        - WA PR > 120% or < 50% (suspicious - likely bad insolation)
        - Large gaps between onsite and satellite data
        - Insolation gap < -50% or > +50% (unrealistic)

        This helps identify where the view's insolation selection logic is failing.
        """
        if not site_ids:
            return pd.DataFrame()

        site_ids_str = "', '".join(site_ids)

        query = f"""
        SELECT
            d.SITEID,
            d.SITENAME,
            d.MEASUREMENTTIME,
            -- Raw insolation values
            d.INSOLATION_POA as ONSITE_POA,
            d.INSOLATION_GHI as ONSITE_GHI,
            d.INSOLATION_POA_SOLCAST as SATELLITE_POA,
            d.INSOLATION_GHI_SOLCAST as SATELLITE_GHI,
            -- What the view selected
            d.INSOLATION as SELECTED_INSOLATION,
            d.INSOLATION_SOURCE,
            -- Expected insolation
            d.EXPECTED_INSOLATION_POA,
            d.EXPECTED_INSOLATION_GHI,
            -- Computed gap and PR
            d.INSOLATION_GAP,
            d.WA_PERFORMANCE_RATIO,
            d.PERFORMANCE_RATIO,
            -- Production to check if site was actually producing
            d.PRODUCTION,
            d.METER_ENERGY,
            d.INV_TOTAL_ENERGY,
            -- Site preference
            sm.IRRADIANCE_TYPE,
            sm.SIZE_KW_DC,
            -- Diagnostic flags
            CASE
                WHEN d.INSOLATION <= 0 AND COALESCE(d.INSOLATION_POA_SOLCAST, d.INSOLATION_GHI_SOLCAST, 0) > 0
                THEN 'ONSITE_ZERO_SAT_VALID'
                WHEN d.INSOLATION_GAP < -0.5 THEN 'GAP_EXTREME_NEGATIVE'
                WHEN d.INSOLATION_GAP > 0.5 THEN 'GAP_EXTREME_POSITIVE'
                WHEN d.WA_PERFORMANCE_RATIO > 1.2 THEN 'WA_PR_OVER_120'
                WHEN d.WA_PERFORMANCE_RATIO < 0.5 AND d.PRODUCTION > 0 THEN 'WA_PR_UNDER_50'
                WHEN d.INSOLATION_SOURCE IN ('POA', 'GHI')
                     AND ABS(d.INSOLATION - COALESCE(d.INSOLATION_POA_SOLCAST, d.INSOLATION_GHI_SOLCAST, 0))
                         / NULLIF(COALESCE(d.INSOLATION_POA_SOLCAST, d.INSOLATION_GHI_SOLCAST, 0), 0) > 0.3
                THEN 'ONSITE_SAT_MISMATCH_30PCT'
                ELSE 'OK'
            END as QUALITY_FLAG,
            -- Compare onsite vs satellite
            CASE
                WHEN d.INSOLATION_SOURCE IN ('POA', 'GHI') AND d.INSOLATION_POA_SOLCAST IS NOT NULL
                THEN d.INSOLATION - d.INSOLATION_POA_SOLCAST
                ELSE NULL
            END as ONSITE_VS_SATELLITE_DIFF
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.DAILY_DATA_LIVE d
        JOIN MEI_ASSET_MGMT_DB.PUBLIC.SITE_MASTER sm ON d.SITEID = sm.SITE_ID
        WHERE d.SITEID IN ('{site_ids_str}')
          AND d.DATA_TYPE = 'current'
          AND d.MEASUREMENTTIME >= '{start_date}'
          AND d.MEASUREMENTTIME <= '{end_date}'
          AND (
              -- Flag problematic rows
              d.WA_PERFORMANCE_RATIO > 1.2
              OR d.WA_PERFORMANCE_RATIO < 0.5
              OR d.INSOLATION_GAP < -0.5
              OR d.INSOLATION_GAP > 0.5
              OR (d.INSOLATION <= 0 AND d.PRODUCTION > 0)
          )
        ORDER BY d.MEASUREMENTTIME DESC, d.SITEID
        """
        result = self._execute(query)
        if result:
            df = pd.DataFrame(result)
            if 'MEASUREMENTTIME' in df.columns:
                df['MEASUREMENTTIME'] = pd.to_datetime(df['MEASUREMENTTIME'])
            return df
        return pd.DataFrame()

    def get_insolation_quality_summary(
        self,
        site_ids: List[str],
        start_date: str,
        end_date: str
    ) -> Dict[str, Any]:
        """
        Get summary statistics of insolation data quality issues.
        """
        if not site_ids:
            return {}

        site_ids_str = "', '".join(site_ids)

        query = f"""
        SELECT
            COUNT(*) as TOTAL_ROWS,
            SUM(CASE WHEN WA_PERFORMANCE_RATIO > 1.2 THEN 1 ELSE 0 END) as WA_PR_OVER_120_COUNT,
            SUM(CASE WHEN WA_PERFORMANCE_RATIO < 0.5 AND PRODUCTION > 0 THEN 1 ELSE 0 END) as WA_PR_UNDER_50_COUNT,
            SUM(CASE WHEN INSOLATION_GAP < -0.5 THEN 1 ELSE 0 END) as EXTREME_NEGATIVE_GAP_COUNT,
            SUM(CASE WHEN INSOLATION_GAP > 0.5 THEN 1 ELSE 0 END) as EXTREME_POSITIVE_GAP_COUNT,
            SUM(CASE WHEN INSOLATION <= 0 AND PRODUCTION > 0 THEN 1 ELSE 0 END) as ZERO_INSOLATION_WITH_PRODUCTION,
            SUM(CASE WHEN INSOLATION_SOURCE IN ('POA', 'GHI') THEN 1 ELSE 0 END) as USING_ONSITE,
            SUM(CASE WHEN INSOLATION_SOURCE IN ('POA_SATELLITE', 'GHI_SATELLITE') THEN 1 ELSE 0 END) as USING_SATELLITE,
            COUNT(DISTINCT SITEID) as TOTAL_SITES,
            COUNT(DISTINCT CASE WHEN WA_PERFORMANCE_RATIO > 1.2 THEN SITEID END) as SITES_WITH_HIGH_WA_PR
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.DAILY_DATA_LIVE
        WHERE SITEID IN ('{site_ids_str}')
          AND DATA_TYPE = 'current'
          AND MEASUREMENTTIME >= '{start_date}'
          AND MEASUREMENTTIME <= '{end_date}'
        """
        result = self._execute(query)
        if result and len(result) > 0:
            return dict(result[0])
        return {}

    def get_daily_raw_insolation(
        self,
        site_ids: List[str],
        start_date: str,
        end_date: str,
        stage: Optional[str] = None
    ) -> pd.DataFrame:
        """
        Get raw daily insolation data with all sources for smart selection.

        Returns all insolation columns so the app can apply intelligent selection:
        - INSOLATION_POA: Onsite POA pyranometer
        - INSOLATION_GHI: Onsite GHI pyranometer
        - INSOLATION_GHI_SOLCAST: Satellite GHI (actual satellite data)
        - INSOLATION_POA_SOLCAST: Usually just GHI masked as POA, unreliable

        IRRADIANCE_TYPE from SITE_MASTER: 1=GHI, 2=POA
        """
        if not site_ids:
            return pd.DataFrame()

        site_ids_str = "', '".join(site_ids)

        stage_filter = ""
        if stage == 'FC':
            stage_filter = "AND d.STAGE = 'Post-FC'"
        elif stage == 'Pre-FC':
            stage_filter = "AND d.STAGE = 'Pre-FC'"

        query = f"""
        SELECT
            d.SITEID,
            d.SITENAME,
            d.MEASUREMENTTIME,
            d.STAGE,

            -- Production (needed for PR recalculation)
            d.PRODUCTION,
            d.PRODUCTION_SOURCE,
            d.EXPECTED_PRODUCTION,
            d.METER_ENERGY,
            d.INV_TOTAL_ENERGY,

            -- All raw insolation sources
            d.INSOLATION_POA as ONSITE_POA,
            d.INSOLATION_GHI as ONSITE_GHI,
            d.INSOLATION_GHI_SOLCAST as SATELLITE_GHI,
            d.INSOLATION_POA_SOLCAST as SATELLITE_POA,  -- Usually unreliable (masked GHI)

            -- Expected insolation (for gap calculation)
            d.EXPECTED_INSOLATION_POA,
            d.EXPECTED_INSOLATION_GHI,

            -- View's current selection (for comparison)
            d.INSOLATION as VIEW_SELECTED_INSOLATION,
            d.INSOLATION_SOURCE as VIEW_INSOLATION_SOURCE,
            d.INSOLATION_GAP as VIEW_INSOLATION_GAP,
            d.WA_PERFORMANCE_RATIO as VIEW_WA_PR,

            -- Site configuration
            sm.IRRADIANCE_TYPE,  -- 1=GHI, 2=POA
            sm.SIZE_KW_DC,
            sm.SIZE_KW_AC

        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.DAILY_DATA_LIVE d
        JOIN MEI_ASSET_MGMT_DB.PUBLIC.SITE_MASTER sm ON d.SITEID = sm.SITE_ID
        WHERE d.SITEID IN ('{site_ids_str}')
          AND d.DATA_TYPE = 'current'
          AND d.MEASUREMENTTIME >= '{start_date}'
          AND d.MEASUREMENTTIME <= '{end_date}'
          {stage_filter}
        ORDER BY d.SITEID, d.MEASUREMENTTIME
        """
        result = self._execute(query)
        if result:
            df = pd.DataFrame(result)
            if 'MEASUREMENTTIME' in df.columns:
                df['MEASUREMENTTIME'] = pd.to_datetime(df['MEASUREMENTTIME'])
            return df
        return pd.DataFrame()

    def get_hourly_kpis(
        self,
        site_ids: List[str],
        start_datetime: str,
        end_datetime: str
    ) -> pd.DataFrame:
        """
        Get pre-computed hourly KPIs from HOURLY_DATA_LIVE view.

        Note: Outage detection (OUTAGE_FLAG, IS_LATEST_HOUR) is available
        but we keep smart outage logic in the app for flexibility.
        """
        if not site_ids:
            return pd.DataFrame()

        site_ids_str = "', '".join(site_ids)

        query = f"""
        SELECT
            SITEID,
            SITENAME,
            MEASUREMENTTIME,
            -- Production
            PRODUCTION,
            PRODUCTION_SOURCE,
            METER_ENERGY,
            INV_TOTAL_ENERGY,
            -- Insolation
            INSOLATION,
            INSOLATION_SOURCE,
            INSOLATION_SHARE,
            INSOLATION_GAP,
            -- Expected
            EXPECTED_PRODUCTION,
            WA_EXPECTED_PRODUCTION,
            -- Performance
            PERFORMANCE_RATIO,
            WA_PERFORMANCE_RATIO,
            -- Revenue
            REVENUE_RATE,
            REVENUE,
            VARIANCE_WA_REVENUE,
            -- Availability and inverters (for app-side outage detection)
            AVAILABILITY_PERCENTAGE,
            INVERTERS_PRODUCING,
            INVERTERS_TOTAL,
            -- Data quality flags from view (informational)
            DATA_QUALITY_FLAG,
            VARIANCE_METER_INV,
            STAGE
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.HOURLY_DATA_LIVE
        WHERE SITEID IN ('{site_ids_str}')
          AND DATA_TYPE = 'current'
          AND MEASUREMENTTIME >= '{start_datetime}'
          AND MEASUREMENTTIME <= '{end_datetime}'
        ORDER BY SITEID, MEASUREMENTTIME
        """
        result = self._execute(query)
        if result:
            df = pd.DataFrame(result)
            if 'MEASUREMENTTIME' in df.columns:
                df['MEASUREMENTTIME'] = pd.to_datetime(df['MEASUREMENTTIME'])
            return df
        return pd.DataFrame()

    # =========================================================================
    # Performance Ratio Functions
    # =========================================================================

    def get_site_forecast_data(self, site_id: str) -> Dict[str, Dict[int, float]]:
        """Get monthly forecast data for a site."""
        query = f"""
        SELECT ATTRIBUTE, MONTH, VALUE
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.FORECAST_DATA
        WHERE SITEID = '{site_id}' AND UPPER(ATTRIBUTE) IN ('PRODUCTION', 'POA', 'GHI')
        ORDER BY ATTRIBUTE, MONTH
        """
        result = self._execute(query)

        forecast = {'Production': {}, 'POA': {}, 'GHI': {}}
        if result:
            for row in result:
                attr = str(row.get('ATTRIBUTE', '')).upper()
                month = int(row.get('MONTH', 0))
                value = float(row.get('VALUE', 0) or 0)
                if attr == 'PRODUCTION':
                    forecast['Production'][month] = value
                elif attr == 'POA':
                    forecast['POA'][month] = value
                elif attr == 'GHI':
                    forecast['GHI'][month] = value
        return forecast

    def get_all_forecast_data(self, site_ids: List[str]) -> Dict[str, Dict[str, Dict[int, float]]]:
        """Get monthly forecast data for all sites in one batch query.

        Includes:
        - Production: Standard production forecast
        - Production_BESS: Production (Solar + BESS) for hybrid sites
        - POA: Plane of Array insolation forecast
        - GHI: Global Horizontal Irradiance forecast

        Returns:
            Dict[site_id, Dict[attribute, Dict[month, value]]]
        """
        if not site_ids:
            return {}

        # Check cache first (daily cache)
        cache_key = "all_forecast_data"
        cached = self.cache.get(cache_key)
        if cached is not None:
            # Return subset of cached data for requested sites
            return {sid: cached.get(sid, {'Production': {}, 'Production_BESS': {}, 'POA': {}, 'GHI': {}})
                    for sid in site_ids}

        # Build IN clause for all sites (we cache all to avoid repeated queries)
        # Get all operational site IDs for full cache
        all_sites_df = self.get_operational_sites()
        all_site_ids = all_sites_df['SITE_ID'].tolist() if not all_sites_df.empty else site_ids
        all_site_ids_str = "', '".join(all_site_ids)

        # Include BESS production forecast attribute
        query = f"""
        SELECT SITEID, ATTRIBUTE, MONTH, VALUE
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.FORECAST_DATA
        WHERE SITEID IN ('{all_site_ids_str}')
          AND (UPPER(ATTRIBUTE) IN ('PRODUCTION', 'POA', 'GHI')
               OR UPPER(ATTRIBUTE) = 'PRODUCTION (SOLAR + BESS)')
        ORDER BY SITEID, ATTRIBUTE, MONTH
        """
        result = self._execute(query)

        # Initialize result dict for all sites
        forecasts: Dict[str, Dict[str, Dict[int, float]]] = {}
        for sid in all_site_ids:
            forecasts[sid] = {'Production': {}, 'Production_BESS': {}, 'POA': {}, 'GHI': {}}

        if result:
            for row in result:
                site_id = row.get('SITEID')
                attr = str(row.get('ATTRIBUTE', '')).upper()
                month = int(row.get('MONTH', 0))
                value = float(row.get('VALUE', 0) or 0)

                if site_id in forecasts:
                    if attr == 'PRODUCTION':
                        forecasts[site_id]['Production'][month] = value
                    elif attr == 'PRODUCTION (SOLAR + BESS)':
                        forecasts[site_id]['Production_BESS'][month] = value
                    elif attr == 'POA':
                        forecasts[site_id]['POA'][month] = value
                    elif attr == 'GHI':
                        forecasts[site_id]['GHI'][month] = value

        # Cache for 24 hours
        self.cache.set(cache_key, forecasts)

        # Return subset for requested sites
        return {sid: forecasts.get(sid, {'Production': {}, 'Production_BESS': {}, 'POA': {}, 'GHI': {}})
                for sid in site_ids}

    def get_fleet_metrics_summary(self, site_ids: List[str], days: int = 7) -> pd.DataFrame:
        """Get summarized production and insolation metrics for all sites in one batch query.

        Returns DataFrame with columns: SITEID, METER_ENERGY_SUM, INV_TOTAL_ENERGY_SUM,
                                         INSOLATION_POA_SUM, INSOLATION_GHI_SUM,
                                         HOURS_COUNT, MONTH
        """
        if not site_ids:
            return pd.DataFrame()

        # Build IN clause
        site_ids_str = "', '".join(site_ids)

        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)

        query = f"""
        SELECT
            SITEID,
            EXTRACT(MONTH FROM MEASUREMENTTIME) as MONTH,
            SUM(COALESCE(METER_ENERGY, 0)) as METER_ENERGY_SUM,
            SUM(COALESCE(INV_TOTAL_ENERGY, 0)) as INV_TOTAL_ENERGY_SUM,
            SUM(COALESCE(INSOLATION_POA, 0)) as INSOLATION_POA_SUM,
            SUM(COALESCE(INSOLATION_GHI, 0)) as INSOLATION_GHI_SUM,
            COUNT(*) as HOURS_COUNT
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.HOURLY_DATA_LIVE
        WHERE SITEID IN ('{site_ids_str}')
          AND DATA_TYPE = 'current'
          AND MEASUREMENTTIME >= '{start_date.strftime('%Y-%m-%d')}'
          AND MEASUREMENTTIME <= '{end_date.strftime('%Y-%m-%d 23:59:59')}'
        GROUP BY SITEID, EXTRACT(MONTH FROM MEASUREMENTTIME)
        ORDER BY SITEID
        """
        result = self._execute(query)
        if result:
            return pd.DataFrame(result)
        return pd.DataFrame()

    def get_fleet_kpi_metrics(self, site_ids: List[str], days: int = 7) -> pd.DataFrame:
        """Get comprehensive KPI metrics for all sites in one batch query.

        Includes availability weighted by insolation (only count peak sun hours).

        Returns DataFrame with columns:
            SITEID, MONTH, METER_ENERGY_SUM, INV_TOTAL_ENERGY_SUM,
            INSOLATION_POA_SUM, INSOLATION_GHI_SUM, HOURS_COUNT,
            AVAILABILITY_WEIGHTED, INSOLATION_WEIGHT_TOTAL
        """
        if not site_ids:
            return pd.DataFrame()

        # Build IN clause
        site_ids_str = "', '".join(site_ids)

        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)

        # Calculate availability weighted by insolation
        # Only hours with insolation >= 250 W/m² count for availability weighting
        query = f"""
        SELECT
            SITEID,
            EXTRACT(MONTH FROM MEASUREMENTTIME) as MONTH,
            SUM(COALESCE(METER_ENERGY, 0)) as METER_ENERGY_SUM,
            SUM(COALESCE(INV_TOTAL_ENERGY, 0)) as INV_TOTAL_ENERGY_SUM,
            SUM(COALESCE(INSOLATION_POA, 0)) as INSOLATION_POA_SUM,
            SUM(COALESCE(INSOLATION_GHI, INSOLATION_GHI_SOLCAST, 0)) as INSOLATION_GHI_SUM,
            COUNT(*) as HOURS_COUNT,
            -- Weighted availability: availability * insolation weight (for peak hours only)
            SUM(
                CASE
                    WHEN COALESCE(INSOLATION_POA, INSOLATION_GHI, INSOLATION_GHI_SOLCAST, 0) >= 250
                    THEN COALESCE(AVAILABILITY_PERCENTAGE, 100) *
                         COALESCE(INSOLATION_POA, INSOLATION_GHI, INSOLATION_GHI_SOLCAST, 0)
                    ELSE 0
                END
            ) as AVAILABILITY_WEIGHTED,
            -- Total insolation weight (denominator for weighted average)
            SUM(
                CASE
                    WHEN COALESCE(INSOLATION_POA, INSOLATION_GHI, INSOLATION_GHI_SOLCAST, 0) >= 250
                    THEN COALESCE(INSOLATION_POA, INSOLATION_GHI, INSOLATION_GHI_SOLCAST, 0)
                    ELSE 0
                END
            ) as INSOLATION_WEIGHT_TOTAL
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.HOURLY_DATA_LIVE
        WHERE SITEID IN ('{site_ids_str}')
          AND DATA_TYPE = 'current'
          AND MEASUREMENTTIME >= '{start_date.strftime('%Y-%m-%d')}'
          AND MEASUREMENTTIME <= '{end_date.strftime('%Y-%m-%d 23:59:59')}'
        GROUP BY SITEID, EXTRACT(MONTH FROM MEASUREMENTTIME)
        ORDER BY SITEID
        """
        result = self._execute(query)
        if result:
            return pd.DataFrame(result)
        return pd.DataFrame()

    def calculate_site_performance_ratio(
        self, site_id: str, pto_date: Optional[datetime] = None, days: int = 30
    ) -> Dict[str, Any]:
        """Calculate Performance Ratio for a site."""
        cache_key = f"pr_{site_id}_{days}"
        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        result = {
            'pr': None, 'actual_production_kwh': 0, 'expected_production_kwh': 0,
            'weather_adjusted_expected_kwh': 0, 'weather_adjustment_factor': 1.0,
            'degradation_factor': 1.0, 'years_since_pto': 0, 'data_quality': 'insufficient'
        }

        try:
            forecast = self.get_site_forecast_data(site_id)
            if not forecast['Production']:
                result['data_quality'] = 'no_forecast'
                return result

            production_df = self.get_site_metrics_data(site_id, days=days)
            if production_df.empty or 'MEASUREMENTTIME' not in production_df.columns:
                result['data_quality'] = 'no_production_data'
                return result

            # Calculate degradation
            if pto_date:
                if isinstance(pto_date, str):
                    pto_date = pd.to_datetime(pto_date)
                # Handle both datetime and date objects
                if hasattr(pto_date, 'date'):
                    # It's a datetime object
                    pto_dt = pto_date
                else:
                    # It's a date object, convert to datetime
                    pto_dt = datetime.combine(pto_date, datetime.min.time())
                years_since_pto = (datetime.now() - pto_dt).days / 365.25
                result['years_since_pto'] = round(years_since_pto, 2)
                result['degradation_factor'] = round(0.995 ** max(0, years_since_pto), 4)

            production_df['MONTH'] = pd.to_datetime(production_df['MEASUREMENTTIME']).dt.month

            # Actual production (using pd.to_numeric to avoid FutureWarning)
            if 'METER_ENERGY' in production_df.columns:
                meter_vals = pd.to_numeric(production_df['METER_ENERGY'], errors='coerce').fillna(0).clip(lower=0)
                actual_prod = float(meter_vals.sum())
            elif 'INV_TOTAL_ENERGY' in production_df.columns:
                inv_vals = pd.to_numeric(production_df['INV_TOTAL_ENERGY'], errors='coerce').fillna(0).clip(lower=0)
                actual_prod = float(inv_vals.sum())
            else:
                result['data_quality'] = 'no_energy_data'
                return result

            result['actual_production_kwh'] = round(actual_prod, 2)

            # Expected production
            months_in_data = production_df['MONTH'].unique()
            hours_per_month = production_df.groupby('MONTH').size()

            expected_total = 0
            for month in months_in_data:
                if month in forecast['Production']:
                    hours_in_month = hours_per_month.get(month, 0)
                    month_fraction = hours_in_month / 730
                    expected_total += forecast['Production'][month] * month_fraction

            result['expected_production_kwh'] = round(expected_total, 2)

            # Weather adjustment
            insolation_col = None
            if 'INSOLATION_POA' in production_df.columns:
                insolation_col = 'INSOLATION_POA'
            elif 'INSOLATION_GHI' in production_df.columns:
                insolation_col = 'INSOLATION_GHI'

            if insolation_col:
                insol_vals = pd.to_numeric(production_df[insolation_col], errors='coerce').fillna(0).clip(lower=0)
                actual_insolation = float(insol_vals.sum())
                expected_insolation = 0

                for month in months_in_data:
                    hours_in_month = hours_per_month.get(month, 0)
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

        self.cache.set(cache_key, result, ttl=120)
        return result

    def get_daily_performance_data(
        self, site_id: str, pto_date: Optional[datetime] = None, days: int = 60
    ) -> pd.DataFrame:
        """Get daily performance data for trending."""
        cache_key = f"daily_perf_{site_id}_{days}"
        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        try:
            forecast = self.get_site_forecast_data(site_id)
            if not forecast['Production']:
                return pd.DataFrame()

            hourly_df = self.get_site_metrics_data(site_id, days=days)
            if hourly_df.empty or 'MEASUREMENTTIME' not in hourly_df.columns:
                return pd.DataFrame()

            hourly_df['MEASUREMENTTIME'] = pd.to_datetime(hourly_df['MEASUREMENTTIME'])
            hourly_df['DATE'] = hourly_df['MEASUREMENTTIME'].dt.date
            hourly_df['MONTH'] = hourly_df['MEASUREMENTTIME'].dt.month

            # Calculate degradation
            degradation_factor = 1.0
            if pto_date:
                if isinstance(pto_date, str):
                    pto_date = pd.to_datetime(pto_date)
                # Handle both datetime and date objects
                if hasattr(pto_date, 'date'):
                    # It's a datetime object
                    pto_dt = pto_date
                else:
                    # It's a date object, convert to datetime
                    pto_dt = datetime.combine(pto_date, datetime.min.time())
                years_since_pto = (datetime.now() - pto_dt).days / 365.25
                degradation_factor = 0.995 ** max(0, years_since_pto)

            # Determine insolation column (POA preferred, then GHI)
            insol_col = None
            if 'INSOLATION_POA' in hourly_df.columns:
                insol_col = 'INSOLATION_POA'
            elif 'INSOLATION_GHI' in hourly_df.columns:
                insol_col = 'INSOLATION_GHI'
            elif 'INSOLATION_GHI_SOLCAST' in hourly_df.columns:
                insol_col = 'INSOLATION_GHI_SOLCAST'

            daily_data = []
            for date, group in hourly_df.groupby('DATE'):
                month = group['MONTH'].iloc[0]
                hours_in_day = len(group)

                # Actual production (using pd.to_numeric to avoid FutureWarning)
                if 'METER_ENERGY' in group.columns:
                    meter_vals = pd.to_numeric(group['METER_ENERGY'], errors='coerce').fillna(0).clip(lower=0)
                    actual = float(meter_vals.sum())
                elif 'INV_TOTAL_ENERGY' in group.columns:
                    inv_vals = pd.to_numeric(group['INV_TOTAL_ENERGY'], errors='coerce').fillna(0).clip(lower=0)
                    actual = float(inv_vals.sum())
                else:
                    continue

                # Expected
                if month in forecast['Production']:
                    expected_base = forecast['Production'][month] * (hours_in_day / 730)

                    # Weather adjustment using POA or GHI
                    weather_factor = 1.0
                    if insol_col and insol_col in group.columns:
                        insol_vals = pd.to_numeric(group[insol_col], errors='coerce').fillna(0).clip(lower=0)
                        actual_insol = float(insol_vals.sum())
                        # Try POA first, then GHI
                        expected_insol = 0
                        if month in forecast.get('POA', {}) and forecast['POA'][month] > 0:
                            expected_insol = forecast['POA'][month] * (hours_in_day / 730)
                        elif month in forecast.get('GHI', {}) and forecast['GHI'][month] > 0:
                            expected_insol = forecast['GHI'][month] * (hours_in_day / 730)

                        if expected_insol > 0 and actual_insol > 0:
                            weather_factor = actual_insol / expected_insol
                            # Cap weather factor to reasonable range
                            weather_factor = max(0.1, min(2.0, weather_factor))

                    expected = expected_base * weather_factor * degradation_factor
                    pr_pct = (actual / expected * 100) if expected > 0 else None
                    # Cap PR at reasonable range
                    if pr_pct is not None:
                        pr_pct = max(0, min(150, pr_pct))
                else:
                    expected = 0
                    pr_pct = None

                # Availability - weighted by insolation > 250 W/m² (peak sun hours)
                avail_pct = None
                if 'AVAILABILITY_PERCENTAGE' in group.columns:
                    if insol_col and insol_col in group.columns:
                        # Weight = insolation if > 250, else 0 (only count peak sun hours)
                        def calc_weight(x):
                            try:
                                val = float(x) if pd.notna(x) else 0
                                return val if val > 250 else 0
                            except (ValueError, TypeError):
                                return 0

                        weights = group[insol_col].apply(calc_weight)
                        avail_vals = pd.to_numeric(group['AVAILABILITY_PERCENTAGE'], errors='coerce').fillna(0)
                        weighted_avail = (avail_vals * weights).sum()
                        total_weight = weights.sum()

                        if total_weight > 0:
                            avail_pct = weighted_avail / total_weight
                        else:
                            # Fallback to simple mean if no high insolation hours
                            avail_pct = float(group['AVAILABILITY_PERCENTAGE'].mean())
                    else:
                        # Fallback to simple mean if no insolation data
                        avail_pct = float(group['AVAILABILITY_PERCENTAGE'].mean())

                daily_data.append({
                    'DATE': date,
                    'ACTUAL_KWH': round(actual, 2),
                    'EXPECTED_KWH': round(expected, 2),
                    'PR_PCT': round(pr_pct, 1) if pr_pct is not None else None,
                    'AVAILABILITY_PCT': round(avail_pct, 1) if avail_pct is not None else None
                })

            df = pd.DataFrame(daily_data)
            self.cache.set(cache_key, df, ttl=120)
            return df

        except Exception:
            return pd.DataFrame()

    # =========================================================================
    # Real-time Verification
    # =========================================================================

    def verify_alert_realtime(
        self, site_id: str, alert_type: str, equipment_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Verify an alert in real-time using DAS APIs."""
        from CHIRON_MONITORING.models import DetectedOutage, OutageType, VerificationStatus
        from CHIRON_MONITORING.verifiers.outage_verifier import OutageVerifier, VerificationConfig
        from CHIRON_MONITORING.utils.asset_registry import AssetRegistry
        from CHIRON_MONITORING.api.alsoenergy_client import AlsoEnergyClient
        from CHIRON_MONITORING.api.solaredge_client import SolarEdgeClient

        result = {
            'status': 'ERROR', 'power_kw': None, 'minutes_stale': None,
            'message': 'Verification failed', 'das': None,
            'is_offline': None, 'equipment_name': None
        }

        try:
            site_info = self.get_site_details(site_id)
            if not site_info:
                result['message'] = f'Site {site_id} not found'
                return result

            primary_das = site_info.get('PRIMARY_DAS', '').upper()
            result['das'] = primary_das

            ae_client = None
            se_client = None

            if primary_das in ('ALSOENERGY', 'AE', 'LOCUS'):
                try:
                    ae_client = AlsoEnergyClient(
                        username=self.config.alsoenergy.username,
                        password=self.config.alsoenergy.password
                    )
                    ae_client.authenticate()
                except Exception as e:
                    result['message'] = f'AlsoEnergy auth failed: {str(e)}'
                    return result
            elif primary_das in ('SOLAREDGE', 'SE'):
                try:
                    se_client = SolarEdgeClient(api_key=self.config.solaredge.api_key)
                except Exception as e:
                    result['message'] = f'SolarEdge init failed: {str(e)}'
                    return result
            else:
                result['status'] = 'INCONCLUSIVE'
                result['message'] = f'DAS "{primary_das}" not supported'
                return result

            cache_path = Path(__file__).parent.parent.parent / "cache" / "asset_registry.json"
            registry = AssetRegistry(cache_file=str(cache_path))

            verifier = OutageVerifier(
                alsoenergy_client=ae_client,
                asset_registry=registry,
                config=VerificationConfig(),
                solaredge_client=se_client
            )

            outage_type_map = {
                'SITE_OFFLINE': OutageType.SITE_OFFLINE,
                'INVERTER_OFFLINE': OutageType.INVERTER_OFFLINE,
                'METER_OFFLINE': OutageType.METER_OFFLINE
            }
            outage_type = outage_type_map.get(alert_type.upper(), OutageType.SITE_OFFLINE)

            equipment_index = None
            equipment_type_str = None
            if equipment_id:
                eq_id = equipment_id.upper()
                if eq_id.startswith('IN') and '_VALUE' in eq_id:
                    equipment_index = int(eq_id.replace('IN', '').replace('_VALUE', ''))
                    equipment_type_str = 'inverter'
                elif eq_id.startswith('M') and '_VALUE' in eq_id:
                    equipment_index = int(eq_id.replace('M', '').replace('_VALUE', ''))
                    equipment_type_str = 'meter'

            detected = DetectedOutage(
                site_id=site_id,
                site_name=site_info.get('SITE_NAME', site_id),
                outage_type=outage_type,
                equipment_index=equipment_index,
                equipment_type=equipment_type_str,
                primary_das=primary_das,
                detection_time=datetime.now()
            )

            verified = verifier.verify_outage(detected)

            status_map = {
                VerificationStatus.CONFIRMED: 'CONFIRMED',
                VerificationStatus.FALSE_POSITIVE: 'FALSE_POSITIVE',
                VerificationStatus.INCONCLUSIVE: 'INCONCLUSIVE',
                VerificationStatus.PENDING: 'PENDING'
            }
            result['status'] = status_map.get(verified.status, 'INCONCLUSIVE')

            if verified.realtime_power_w is not None:
                result['power_kw'] = round(verified.realtime_power_w / 1000, 2)

            result['minutes_stale'] = verified.minutes_since_update
            result['is_offline'] = (result['status'] == 'CONFIRMED')

            if result['status'] == 'CONFIRMED':
                stale_msg = ""
                if result['minutes_stale']:
                    hours = result['minutes_stale'] / 60
                    if hours >= 24:
                        stale_msg = f", {int(hours // 24)}d {hours % 24:.0f}h stale"
                    else:
                        stale_msg = f", {hours:.1f}h stale"
                power_msg = f"{result['power_kw']} kW" if result['power_kw'] is not None else "no data"
                result['message'] = f"Outage CONFIRMED: {power_msg}{stale_msg}"
            elif result['status'] == 'FALSE_POSITIVE':
                power_msg = f"{result['power_kw']} kW" if result['power_kw'] is not None else "producing"
                result['message'] = f"FALSE POSITIVE: Equipment is {power_msg}"
            elif verified.verification_error:
                result['message'] = f"Inconclusive: {verified.verification_error}"
            else:
                result['message'] = "Verification inconclusive"

        except Exception as e:
            result['status'] = 'ERROR'
            result['message'] = f'Verification error: {str(e)}'

        return result
