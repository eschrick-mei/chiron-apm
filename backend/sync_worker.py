"""
Chiron APM — Snowflake → PostgreSQL Sync Worker

Pulls data from Snowflake on a schedule and mirrors it into a local
PostgreSQL database so the API can serve queries in <10 ms.

Usage:
    # Full initial sync (first run)
    python sync_worker.py --full

    # Continuous sync (run as systemd service)
    python sync_worker.py

    # One-shot incremental sync then exit
    python sync_worker.py --once

Environment variables:
    CHIRON_PG_DSN       PostgreSQL connection string (default: postgresql://chiron:chiron@localhost/chiron_apm)
    SNOWFLAKE_ACCOUNT   Snowflake account
    SNOWFLAKE_USER      Snowflake user
    SNOWFLAKE_PASSWORD  Snowflake password
    SNOWFLAKE_DATABASE  Snowflake database (default: MEI_ASSET_MGMT_DB)
"""

import os
import sys
import time
import logging
import argparse
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Any

import psycopg2
import psycopg2.extras
import pandas as pd

# Add parent paths for Snowflake connector
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))
from CHIRON_MONITORING.config import Config
from CHIRON_MONITORING.data import SnowflakeConnector

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("sync_worker")

# ============================================================================
# Configuration
# ============================================================================

PG_DSN = os.environ.get("CHIRON_PG_DSN", "postgresql://chiron:chiron@localhost/chiron_apm")

# Sync intervals (seconds)
INTERVALS = {
    "chiron_alerts":    300,    # 5 min
    "hourly_data_live": 900,    # 15 min
    "daily_data_live":  3600,   # 1 hour
    "site_master":      21600,  # 6 hours
    "asset_registry":   21600,  # 6 hours
    "forecast_data":    86400,  # 24 hours
    "te_operating":     86400,  # 24 hours
}

# How many days of history to keep for time-series tables
RETENTION_DAYS = {
    "hourly_data_live": 365,
    "daily_data_live":  730,
    "chiron_alerts":    365,
}

# Columns we explicitly track (rest go into `extra` JSONB)
SITE_MASTER_COLS = [
    "SITE_ID", "SITE_NAME", "SIZE_KW_DC", "SIZE_KW_AC", "PRIMARY_DAS",
    "INVERTER_COUNT", "PTO_ACTUAL_DATE", "FC_ACTUAL_DATE", "TIMEZONE",
    "LATITUDE", "LONGITUDE", "DELIVERY_PHASE", "IRRADIANCE_TYPE",
]

ALERT_COLS = [
    "ALERT_ID", "SITE_ID", "SITE_NAME", "ALERT_TYPE", "ALERT_CATEGORY",
    "EQUIPMENT_TYPE", "EQUIPMENT_ID", "EQUIPMENT_NAME", "SEVERITY",
    "DETECTED_AT", "DURATION_HOURS", "VERIFICATION_STATUS", "VERIFIED_AT",
    "STATUS", "RESOLVED_AT", "CHECK_COUNT", "CREATED_AT",
]


# ============================================================================
# Helpers
# ============================================================================

def get_snowflake_connector() -> SnowflakeConnector:
    """Create a Snowflake connector from config.json."""
    # Check multiple locations for config.json
    candidates = [
        Path(__file__).parent.parent / "config.json",          # /opt/chiron/config.json (EC2)
        Path(__file__).parent.parent.parent / "config.json",   # repo-level config.json (local dev)
    ]
    config_path = next((p for p in candidates if p.exists()), candidates[0])
    config = Config(config_file=str(config_path))
    params = config.snowflake.connection_params
    params.pop("network_timeout", None)
    params.pop("login_timeout", None)
    conn = SnowflakeConnector(**params)
    conn.connect()
    return conn


def get_pg_conn():
    """Get a PostgreSQL connection."""
    conn = psycopg2.connect(PG_DSN)
    conn.autocommit = False
    return conn


def sf_query(sf: SnowflakeConnector, query: str) -> List[Dict]:
    """Execute a Snowflake query and return list of dicts."""
    result = sf.execute_query(query)
    return result or []


def log_sync(pg, table: str, rows: int, duration_ms: int, status: str = "ok", error: str = None):
    """Write to _sync_log."""
    with pg.cursor() as cur:
        cur.execute(
            "INSERT INTO _sync_log (table_name, rows_synced, duration_ms, status, error) VALUES (%s,%s,%s,%s,%s)",
            (table, rows, duration_ms, status, error),
        )
    pg.commit()


def _dict_to_json_extra(row: Dict, known_cols: List[str]) -> Dict:
    """Split a Snowflake row into known columns + extra JSONB."""
    import json
    from decimal import Decimal

    known_set = {c.upper() for c in known_cols}
    known = {}
    extra = {}
    for k, v in row.items():
        uk = k.upper()
        if isinstance(v, Decimal):
            v = float(v)
        if isinstance(v, (datetime,)):
            v_str = v.isoformat()
        else:
            v_str = v

        if uk in known_set:
            known[uk] = v
        else:
            extra[uk] = v_str

    known["extra"] = json.dumps(extra, default=str)
    return known


# ============================================================================
# Sync Functions
# ============================================================================

def sync_site_master(sf: SnowflakeConnector, pg) -> int:
    """Full replace of site_master."""
    t0 = time.time()
    rows = sf_query(sf, """
        SELECT *
        FROM MEI_ASSET_MGMT_DB.PUBLIC.SITE_MASTER
        WHERE SITE_ID IS NOT NULL
    """)
    if not rows:
        log_sync(pg, "site_master", 0, 0, "empty")
        return 0

    with pg.cursor() as cur:
        cur.execute("DELETE FROM site_master")
        for row in rows:
            d = _dict_to_json_extra(row, SITE_MASTER_COLS)
            cur.execute("""
                INSERT INTO site_master (site_id, site_name, size_kw_dc, size_kw_ac,
                    primary_das, inverter_count, pto_actual_date, fc_actual_date,
                    timezone, latitude, longitude, delivery_phase, irradiance_type, extra)
                VALUES (%(SITE_ID)s, %(SITE_NAME)s, %(SIZE_KW_DC)s, %(SIZE_KW_AC)s,
                    %(PRIMARY_DAS)s, %(INVERTER_COUNT)s, %(PTO_ACTUAL_DATE)s, %(FC_ACTUAL_DATE)s,
                    %(TIMEZONE)s, %(LATITUDE)s, %(LONGITUDE)s, %(DELIVERY_PHASE)s, %(IRRADIANCE_TYPE)s,
                    %(extra)s)
            """, d)
    pg.commit()
    ms = int((time.time() - t0) * 1000)
    log_sync(pg, "site_master", len(rows), ms)
    logger.info("site_master: %d rows in %dms", len(rows), ms)
    return len(rows)


def sync_asset_registry(sf: SnowflakeConnector, pg) -> int:
    """Full replace of asset_registry."""
    t0 = time.time()
    rows = sf_query(sf, """
        SELECT SITE_ID, EQUIPMENT_ID, HARDWARE_ID, EQUIPMENT_CODE, EQUIPMENT_TYPE,
               DAS_NAME, DAS, TYPE_INDEX, COLUMN_MAPPING, CAPACITY_KW, CAPACITY_DC_KW,
               QUANTITY, ATTRIBUTES, PARENT_EQUIPMENT_ID
        FROM MEI_ASSET_MGMT_DB.PUBLIC.ASSET_REGISTRY
    """)
    if not rows:
        log_sync(pg, "asset_registry", 0, 0, "empty")
        return 0

    # Filter out rows with null site_id
    rows = [r for r in rows if r.get("SITE_ID")]

    with pg.cursor() as cur:
        cur.execute("DELETE FROM asset_registry")
        for row in rows:
            attrs = row.get("ATTRIBUTES")
            if attrs and not isinstance(attrs, str):
                import json
                attrs = json.dumps(attrs, default=str)
            cur.execute("""
                INSERT INTO asset_registry (site_id, equipment_id, hardware_id, equipment_code,
                    equipment_type, das_name, das, type_index, column_mapping, capacity_kw,
                    capacity_dc_kw, quantity, attributes, parent_equipment_id)
                VALUES (%(SITE_ID)s, %(EQUIPMENT_ID)s, %(HARDWARE_ID)s, %(EQUIPMENT_CODE)s,
                    %(EQUIPMENT_TYPE)s, %(DAS_NAME)s, %(DAS)s, %(TYPE_INDEX)s, %(COLUMN_MAPPING)s,
                    %(CAPACITY_KW)s, %(CAPACITY_DC_KW)s, %(QUANTITY)s, %(attrs)s, %(PARENT_EQUIPMENT_ID)s)
            """, {**row, "attrs": attrs})
    pg.commit()
    ms = int((time.time() - t0) * 1000)
    log_sync(pg, "asset_registry", len(rows), ms)
    logger.info("asset_registry: %d rows in %dms", len(rows), ms)
    return len(rows)


def sync_forecast_data(sf: SnowflakeConnector, pg) -> int:
    """Full replace of forecast_data."""
    t0 = time.time()
    rows = sf_query(sf, """
        SELECT SITEID AS SITE_ID, ATTRIBUTE, MONTH, VALUE
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.FORECAST_DATA
    """)
    if not rows:
        log_sync(pg, "forecast_data", 0, 0, "empty")
        return 0

    # Dedupe by primary key (site_id, attribute, month) — Snowflake may have duplicates
    seen = set()
    deduped = []
    for r in rows:
        key = (r.get("SITE_ID"), r.get("ATTRIBUTE"), r.get("MONTH"))
        if key not in seen:
            seen.add(key)
            deduped.append(r)
    rows = deduped

    with pg.cursor() as cur:
        cur.execute("DELETE FROM forecast_data")
        psycopg2.extras.execute_batch(cur, """
            INSERT INTO forecast_data (site_id, attribute, month, value)
            VALUES (%(SITE_ID)s, %(ATTRIBUTE)s, %(MONTH)s, %(VALUE)s)
        """, rows, page_size=1000)
    pg.commit()
    ms = int((time.time() - t0) * 1000)
    log_sync(pg, "forecast_data", len(rows), ms)
    logger.info("forecast_data: %d rows in %dms", len(rows), ms)
    return len(rows)


def sync_te_operating(sf: SnowflakeConnector, pg) -> int:
    """Sync last 12 months of TE_OPERATING_FORECAST."""
    t0 = time.time()
    rows = sf_query(sf, """
        SELECT SP_NUM AS SITE_ID, RECORD_DATE, REVENUE_TOTAL_PPA, MONTHLY_PRODUCTION
        FROM MEI_ASSET_MGMT_DB.PUBLIC.TE_OPERATING_FORECAST
        WHERE RECORD_DATE >= DATEADD(month, -12, CURRENT_DATE())
    """)
    if not rows:
        log_sync(pg, "te_operating", 0, 0, "empty")
        return 0

    with pg.cursor() as cur:
        cur.execute("DELETE FROM te_operating")
        psycopg2.extras.execute_batch(cur, """
            INSERT INTO te_operating (site_id, record_date, revenue_total_ppa, monthly_production)
            VALUES (%(SITE_ID)s, %(RECORD_DATE)s, %(REVENUE_TOTAL_PPA)s, %(MONTHLY_PRODUCTION)s)
        """, rows, page_size=1000)
    pg.commit()
    ms = int((time.time() - t0) * 1000)
    log_sync(pg, "te_operating", len(rows), ms)
    logger.info("te_operating: %d rows in %dms", len(rows), ms)
    return len(rows)


def sync_chiron_alerts(sf: SnowflakeConnector, pg) -> int:
    """Incremental sync of alerts — upsert by ALERT_ID."""
    t0 = time.time()
    retention = RETENTION_DAYS["chiron_alerts"]
    rows = sf_query(sf, f"""
        SELECT {', '.join(ALERT_COLS)}
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.CHIRON_ALERTS
        WHERE DETECTED_AT >= DATEADD(day, -{retention}, CURRENT_TIMESTAMP())
           OR STATUS = 'ACTIVE'
    """)
    if not rows:
        log_sync(pg, "chiron_alerts", 0, 0, "empty")
        return 0

    with pg.cursor() as cur:
        # Upsert
        for row in rows:
            cur.execute("""
                INSERT INTO chiron_alerts (alert_id, site_id, site_name, alert_type,
                    alert_category, equipment_type, equipment_id, equipment_name,
                    severity, detected_at, duration_hours, verification_status,
                    verified_at, status, resolved_at, check_count, created_at)
                VALUES (%(ALERT_ID)s, %(SITE_ID)s, %(SITE_NAME)s, %(ALERT_TYPE)s,
                    %(ALERT_CATEGORY)s, %(EQUIPMENT_TYPE)s, %(EQUIPMENT_ID)s, %(EQUIPMENT_NAME)s,
                    %(SEVERITY)s, %(DETECTED_AT)s, %(DURATION_HOURS)s, %(VERIFICATION_STATUS)s,
                    %(VERIFIED_AT)s, %(STATUS)s, %(RESOLVED_AT)s, %(CHECK_COUNT)s, %(CREATED_AT)s)
                ON CONFLICT (alert_id) DO UPDATE SET
                    duration_hours = EXCLUDED.duration_hours,
                    verification_status = EXCLUDED.verification_status,
                    verified_at = EXCLUDED.verified_at,
                    status = EXCLUDED.status,
                    resolved_at = EXCLUDED.resolved_at,
                    check_count = EXCLUDED.check_count
            """, row)
        # Prune old resolved alerts
        cur.execute(f"""
            DELETE FROM chiron_alerts
            WHERE status != 'ACTIVE'
              AND detected_at < NOW() - INTERVAL '{retention} days'
        """)
    pg.commit()
    ms = int((time.time() - t0) * 1000)
    log_sync(pg, "chiron_alerts", len(rows), ms)
    logger.info("chiron_alerts: %d rows in %dms", len(rows), ms)
    return len(rows)


def _build_hourly_cols() -> str:
    """Build the SELECT column list for hourly_data_live."""
    base = [
        "SITEID", "MEASUREMENTTIME", "DATA_TYPE", "SITENAME", "STAGE",
        "PRODUCTION", "PRODUCTION_SOURCE", "METER_ENERGY", "INV_TOTAL_ENERGY",
        "EXPECTED_PRODUCTION", "WA_EXPECTED_PRODUCTION",
        "PERFORMANCE_RATIO", "WA_PERFORMANCE_RATIO",
        "INSOLATION", "INSOLATION_SOURCE", "INSOLATION_SHARE", "INSOLATION_GAP",
        "INSOLATION_POA", "INSOLATION_GHI", "INSOLATION_GHI_SOLCAST",
        "REVENUE_RATE", "REVENUE", "VARIANCE_WA_REVENUE",
        "AVAILABILITY_PERCENTAGE", "INVERTERS_PRODUCING", "INVERTERS_TOTAL",
        "OFFLINE_INVERTER_COUNT", "OUTAGE_FLAG", "DATA_QUALITY_FLAG",
        "VARIANCE_METER_INV",
    ]
    inv = [f"IN{i}_VALUE" for i in range(1, 117)]
    return ", ".join(base + inv)


def sync_hourly_data(sf: SnowflakeConnector, pg, days: int = None) -> int:
    """Incremental sync of hourly_data_live.
    Chunks by 7-day windows to avoid OOM on small instances.
    Only pulls rows newer than the most recent timestamp in PG.
    For full sync, pass days=60."""
    from io import StringIO
    t0 = time.time()
    total_rows = 0

    if days is None:
        # Find last synced timestamp
        with pg.cursor() as cur:
            cur.execute("SELECT MAX(measurementtime) FROM hourly_data_live")
            last = cur.fetchone()[0]
        if last:
            since_dt = last - timedelta(hours=2)
        else:
            since_dt = datetime.utcnow() - timedelta(days=RETENTION_DAYS["hourly_data_live"])
    else:
        since_dt = datetime.utcnow() - timedelta(days=days)

    # Break into 7-day chunks to stay within memory
    chunk_days = 7
    now = datetime.utcnow()
    chunk_start = since_dt

    cols = _build_hourly_cols()

    # Get PG column list once
    with pg.cursor() as cur:
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'hourly_data_live' AND column_name != 'extra' ORDER BY ordinal_position")
        pg_cols = [r[0] for r in cur.fetchall()]

    while chunk_start < now:
        chunk_end = min(chunk_start + timedelta(days=chunk_days), now)
        since_str = chunk_start.strftime("%Y-%m-%d %H:%M:%S")
        until_str = chunk_end.strftime("%Y-%m-%d %H:%M:%S")

        query = f"""
            SELECT {cols}
            FROM MEI_ASSET_MGMT_DB.PERFORMANCE.HOURLY_DATA_LIVE
            WHERE DATA_TYPE = 'current'
              AND MEASUREMENTTIME >= '{since_str}'
              AND MEASUREMENTTIME < '{until_str}'
            ORDER BY MEASUREMENTTIME
        """
        logger.info("hourly_data_live: chunk %s to %s ...", since_str[:10], until_str[:10])
        rows = sf_query(sf, query)

        if rows:
            df = pd.DataFrame(rows)
            df.columns = [c.lower() for c in df.columns]
            common_cols = [c for c in pg_cols if c in df.columns]

            with pg.cursor() as cur:
                cur.execute("CREATE TEMP TABLE _hourly_tmp (LIKE hourly_data_live INCLUDING ALL) ON COMMIT DROP")
                buf = StringIO()
                sub_df = df[common_cols].copy()
                # Cast integer columns — Snowflake returns 0.0 for INTEGER fields
                int_cols = ["inverters_producing", "inverters_total", "offline_inverter_count", "outage_flag"]
                for ic in int_cols:
                    if ic in sub_df.columns:
                        sub_df[ic] = pd.to_numeric(sub_df[ic], errors="coerce").astype("Int64")
                sub_df.to_csv(buf, index=False, header=False, sep='\t', na_rep='\\N')
                buf.seek(0)
                cur.copy_from(buf, '_hourly_tmp', columns=common_cols, sep='\t', null='\\N')

                col_list = ", ".join(common_cols)
                excluded = ", ".join(f"{c} = EXCLUDED.{c}" for c in common_cols if c not in ("siteid", "measurementtime", "data_type"))
                cur.execute(f"""
                    INSERT INTO hourly_data_live ({col_list})
                    SELECT {col_list} FROM _hourly_tmp
                    ON CONFLICT (siteid, measurementtime, data_type) DO UPDATE SET {excluded}
                """)
            pg.commit()
            total_rows += len(rows)
            logger.info("hourly_data_live: chunk done, %d rows", len(rows))

            # Free memory
            del df, rows

        chunk_start = chunk_end

    # Prune old data
    retention = RETENTION_DAYS["hourly_data_live"]
    with pg.cursor() as cur:
        cur.execute(f"DELETE FROM hourly_data_live WHERE measurementtime < NOW() - INTERVAL '{retention} days'")
    pg.commit()

    ms = int((time.time() - t0) * 1000)
    log_sync(pg, "hourly_data_live", total_rows, ms)
    logger.info("hourly_data_live: %d total rows in %dms", total_rows, ms)
    return total_rows


def _build_daily_cols() -> str:
    """Build the SELECT column list for daily_data_live."""
    return ", ".join([
        "SITEID", "MEASUREMENTTIME", "DATA_TYPE", "SITENAME", "STAGE",
        "PRODUCTION", "PRODUCTION_SOURCE", "METER_ENERGY", "INV_TOTAL_ENERGY",
        "EXPECTED_PRODUCTION", "EXPECTED_PRODUCTION_UW",
        "WA_EXPECTED_PRODUCTION", "WA_EXPECTED_PRODUCTION_UW",
        "INSOLATION", "INSOLATION_SOURCE", "INSOLATION_GAP",
        "INSOLATION_POA", "INSOLATION_GHI",
        "INSOLATION_POA_SOLCAST", "INSOLATION_GHI_SOLCAST",
        "EXPECTED_INSOLATION_POA", "EXPECTED_INSOLATION_GHI",
        "PERFORMANCE_RATIO", "WA_PERFORMANCE_RATIO",
        "PERFORMANCE_RATIO_UW", "WA_PERFORMANCE_RATIO_UW",
        "REVENUE_RATE", "REVENUE", "EXPECTED_REVENUE", "WA_EXPECTED_REVENUE",
        "VARIANCE_PRODUCTION", "VARIANCE_WA_PRODUCTION",
        "VARIANCE_REVENUE", "VARIANCE_WA_REVENUE",
        "AVAILABILITY_PERCENTAGE", "LOSS_SNOW", "VARIANCE_METER_INV",
        "AMBIENT_TEMPERATURE",
    ])


def sync_daily_data(sf: SnowflakeConnector, pg, days: int = None) -> int:
    """Incremental sync of daily_data_live."""
    t0 = time.time()

    if days is None:
        with pg.cursor() as cur:
            cur.execute("SELECT MAX(measurementtime) FROM daily_data_live")
            last = cur.fetchone()[0]
        if last:
            since = (last - timedelta(days=2)).strftime("%Y-%m-%d")
        else:
            since = (datetime.utcnow() - timedelta(days=RETENTION_DAYS["daily_data_live"])).strftime("%Y-%m-%d")
    else:
        since = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")

    cols = _build_daily_cols()
    query = f"""
        SELECT {cols}
        FROM MEI_ASSET_MGMT_DB.PERFORMANCE.DAILY_DATA_LIVE
        WHERE DATA_TYPE = 'current'
          AND MEASUREMENTTIME >= '{since}'
        ORDER BY MEASUREMENTTIME
    """
    logger.info("daily_data_live: fetching since %s ...", since)
    rows = sf_query(sf, query)
    if not rows:
        log_sync(pg, "daily_data_live", 0, int((time.time() - t0) * 1000), "empty")
        return 0

    df = pd.DataFrame(rows)
    df.columns = [c.lower() for c in df.columns]

    with pg.cursor() as cur:
        cur.execute("CREATE TEMP TABLE _daily_tmp (LIKE daily_data_live INCLUDING ALL) ON COMMIT DROP")
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'daily_data_live' AND column_name != 'extra' ORDER BY ordinal_position")
        pg_cols = [r[0] for r in cur.fetchall()]
        common_cols = [c for c in pg_cols if c in df.columns]

        from io import StringIO
        buf = StringIO()
        sub_df = df[common_cols].copy()
        sub_df.to_csv(buf, index=False, header=False, sep='\t', na_rep='\\N')
        buf.seek(0)
        cur.copy_from(buf, '_daily_tmp', columns=common_cols, sep='\t', null='\\N')

        col_list = ", ".join(common_cols)
        excluded = ", ".join(f"{c} = EXCLUDED.{c}" for c in common_cols if c not in ("siteid", "measurementtime", "data_type"))
        cur.execute(f"""
            INSERT INTO daily_data_live ({col_list})
            SELECT {col_list} FROM _daily_tmp
            ON CONFLICT (siteid, measurementtime, data_type) DO UPDATE SET {excluded}
        """)

    retention = RETENTION_DAYS["daily_data_live"]
    with pg.cursor() as cur:
        cur.execute(f"DELETE FROM daily_data_live WHERE measurementtime < NOW() - INTERVAL '{retention} days'")

    pg.commit()
    ms = int((time.time() - t0) * 1000)
    log_sync(pg, "daily_data_live", len(rows), ms)
    logger.info("daily_data_live: %d rows in %dms", len(rows), ms)
    return len(rows)


# ============================================================================
# Orchestrator
# ============================================================================

def full_sync(sf: SnowflakeConnector, pg):
    """Run a complete sync of all tables."""
    logger.info("=" * 60)
    logger.info("FULL SYNC — pulling all data from Snowflake")
    logger.info("=" * 60)

    sync_site_master(sf, pg)
    sync_asset_registry(sf, pg)
    sync_forecast_data(sf, pg)
    sync_te_operating(sf, pg)
    sync_chiron_alerts(sf, pg)
    sync_daily_data(sf, pg, days=RETENTION_DAYS["daily_data_live"])
    sync_hourly_data(sf, pg, days=RETENTION_DAYS["hourly_data_live"])

    logger.info("FULL SYNC complete")


def incremental_sync(sf: SnowflakeConnector, pg):
    """Run an incremental sync — only new data."""
    logger.info("--- Incremental sync ---")
    sync_chiron_alerts(sf, pg)
    sync_hourly_data(sf, pg)
    sync_daily_data(sf, pg)


def run_scheduler(sf: SnowflakeConnector, pg):
    """Continuous loop — sync each table at its configured interval."""
    last_sync = {table: 0.0 for table in INTERVALS}

    # Map table names to sync functions
    sync_fns = {
        "chiron_alerts":    lambda: sync_chiron_alerts(sf, pg),
        "hourly_data_live": lambda: sync_hourly_data(sf, pg),
        "daily_data_live":  lambda: sync_daily_data(sf, pg),
        "site_master":      lambda: sync_site_master(sf, pg),
        "asset_registry":   lambda: sync_asset_registry(sf, pg),
        "forecast_data":    lambda: sync_forecast_data(sf, pg),
        "te_operating":     lambda: sync_te_operating(sf, pg),
    }

    logger.info("Starting continuous sync scheduler")
    logger.info("Intervals: %s", {k: f"{v}s" for k, v in INTERVALS.items()})

    while True:
        now = time.time()
        for table, interval in INTERVALS.items():
            if now - last_sync[table] >= interval:
                try:
                    sync_fns[table]()
                    last_sync[table] = time.time()
                except Exception as e:
                    logger.error("Sync failed for %s: %s", table, e)
                    log_sync(pg, table, 0, 0, "error", str(e))
                    # Reconnect on failure
                    try:
                        pg = get_pg_conn()
                    except Exception:
                        pass

        time.sleep(30)  # Check every 30 seconds


# ============================================================================
# CLI
# ============================================================================

def init_schema(pg):
    """Run the schema SQL if tables don't exist."""
    with pg.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'site_master' AND table_schema = 'public'")
        exists = cur.fetchone()[0] > 0

    if not exists:
        logger.info("Creating schema...")
        schema_path = Path(__file__).parent / "pg_schema.sql"
        with open(schema_path) as f:
            sql = f.read()
        with pg.cursor() as cur:
            cur.execute(sql)
        pg.commit()
        logger.info("Schema created")
    else:
        logger.info("Schema already exists")


def main():
    parser = argparse.ArgumentParser(description="Chiron APM — Snowflake → PostgreSQL Sync")
    parser.add_argument("--full", action="store_true", help="Run full initial sync")
    parser.add_argument("--once", action="store_true", help="Run one incremental sync then exit")
    parser.add_argument("--table", type=str, help="Sync only this table")
    args = parser.parse_args()

    logger.info("Connecting to PostgreSQL: %s", PG_DSN.split("@")[-1])
    pg = get_pg_conn()
    init_schema(pg)

    logger.info("Connecting to Snowflake...")
    sf = get_snowflake_connector()
    logger.info("Snowflake connected")

    try:
        if args.table:
            fn_map = {
                "site_master": lambda: sync_site_master(sf, pg),
                "asset_registry": lambda: sync_asset_registry(sf, pg),
                "forecast_data": lambda: sync_forecast_data(sf, pg),
                "te_operating": lambda: sync_te_operating(sf, pg),
                "chiron_alerts": lambda: sync_chiron_alerts(sf, pg),
                "daily_data_live": lambda: sync_daily_data(sf, pg, days=RETENTION_DAYS.get("daily_data_live", 90)),
                "hourly_data_live": lambda: sync_hourly_data(sf, pg, days=RETENTION_DAYS.get("hourly_data_live", 60)),
            }
            if args.table not in fn_map:
                logger.error("Unknown table: %s. Choose from: %s", args.table, list(fn_map.keys()))
                sys.exit(1)
            fn_map[args.table]()
        elif args.full:
            full_sync(sf, pg)
        elif args.once:
            incremental_sync(sf, pg)
        else:
            # Initial full sync if DB is empty
            with pg.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM site_master")
                if cur.fetchone()[0] == 0:
                    logger.info("Empty database — running full sync first")
                    full_sync(sf, pg)

            # Then continuous scheduler
            run_scheduler(sf, pg)
    except KeyboardInterrupt:
        logger.info("Shutting down")
    finally:
        sf.disconnect()
        pg.close()


if __name__ == "__main__":
    main()
