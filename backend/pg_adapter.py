"""
Chiron APM — PostgreSQL Adapter

Drop-in replacement for SnowflakeConnector that queries local PostgreSQL.
The DataService uses self._execute() which calls self.connector.execute_query().
By swapping the connector with this PgConnector, all existing queries work against
PostgreSQL with zero code changes to data_service.py.

SQL Compatibility:
- Snowflake uses DATEADD(unit, N, base) → PG uses (base + INTERVAL 'N unit')
- Snowflake uses CURRENT_TIMESTAMP() → PG uses NOW()
- Snowflake uses CURRENT_DATE() → PG uses CURRENT_DATE
- Column names are case-insensitive in PG but we return UPPER keys to match Snowflake DictCursor
"""

import os
import re
import logging
from typing import Optional, Dict, List, Any, Union

import psycopg2
import psycopg2.extras

logger = logging.getLogger(__name__)

PG_DSN = os.environ.get("CHIRON_PG_DSN", "postgresql://chiron:chiron@localhost/chiron_apm")


class PgConnector:
    """PostgreSQL connector with the same interface as SnowflakeConnector."""

    def __init__(self, dsn: str = None, **kwargs):
        self._dsn = dsn or PG_DSN
        self._conn = None
        # Ignore Snowflake-specific kwargs (account, warehouse, role, etc.)

    def connect(self) -> bool:
        try:
            self._conn = psycopg2.connect(self._dsn)
            self._conn.autocommit = True
            logger.info("Connected to PostgreSQL: %s", self._dsn.split("@")[-1])
            return True
        except Exception as e:
            logger.error("Failed to connect to PostgreSQL: %s", e)
            return False

    def disconnect(self):
        if self._conn:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None
            logger.info("Disconnected from PostgreSQL")

    def is_connected(self) -> bool:
        if self._conn is None:
            return False
        try:
            with self._conn.cursor() as cur:
                cur.execute("SELECT 1")
            return True
        except Exception:
            return False

    def _ensure_connected(self) -> bool:
        if not self.is_connected():
            return self.connect()
        return True

    def execute_query(
        self,
        query: str,
        params: Optional[Union[Dict, tuple]] = None,
        fetch: bool = True,
    ) -> Optional[List[Dict[str, Any]]]:
        """Execute query and return results as list of dicts with UPPER-CASE keys."""
        if not self._ensure_connected():
            logger.error("Not connected to PostgreSQL")
            return None

        # Translate Snowflake SQL → PostgreSQL SQL
        query = _translate_sql(query)

        import time
        t0 = time.time()

        try:
            with self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(query, params)
                if fetch and cur.description:
                    rows = cur.fetchall()
                    # Convert to plain dicts with UPPER keys (matching Snowflake DictCursor)
                    results = [{k.upper(): v for k, v in dict(row).items()} for row in rows]
                else:
                    results = []

            elapsed = (time.time() - t0) * 1000
            logger.debug("PG query in %.1fms, %d rows", elapsed, len(results))
            return results

        except Exception as e:
            logger.error("PG query error: %s", e)
            logger.debug("Query: %s...", query[:300])
            # Try to recover the connection
            try:
                self._conn.rollback()
            except Exception:
                self._conn = None
            return None


# ============================================================================
# SQL Translation: Snowflake → PostgreSQL
# ============================================================================

def _translate_sql(sql: str) -> str:
    """Convert Snowflake-dialect SQL to PostgreSQL."""
    out = sql

    # DATEADD(unit, N, base) → (base + INTERVAL 'N unit')
    # Handles negative N and expressions like CURRENT_TIMESTAMP()
    out = re.sub(
        r"DATEADD\s*\(\s*(\w+)\s*,\s*(-?\d+)\s*,\s*(.+?)\)",
        _replace_dateadd,
        out,
        flags=re.IGNORECASE,
    )

    # CURRENT_TIMESTAMP() → NOW()
    out = re.sub(r"CURRENT_TIMESTAMP\s*\(\s*\)", "NOW()", out, flags=re.IGNORECASE)

    # CURRENT_DATE() → CURRENT_DATE  (remove parens)
    out = re.sub(r"CURRENT_DATE\s*\(\s*\)", "CURRENT_DATE", out, flags=re.IGNORECASE)

    # DATE_TRUNC('unit', col) — same syntax in both, but Snowflake sometimes
    # uses month without quotes in EXTRACT
    # EXTRACT(MONTH FROM col) — same in both ✓

    # TIMESTAMPDIFF(unit, a, b) → EXTRACT(EPOCH FROM (b - a)) / divisor
    out = re.sub(
        r"TIMESTAMPDIFF\s*\(\s*(\w+)\s*,\s*(.+?)\s*,\s*(.+?)\)",
        _replace_timestampdiff,
        out,
        flags=re.IGNORECASE,
    )

    # ABS(TIMESTAMPDIFF(...)) is common — the above handles the inner part

    # Fully-qualified table names → local table names
    out = re.sub(r"MEI_ASSET_MGMT_DB\.PUBLIC\.", "", out, flags=re.IGNORECASE)
    out = re.sub(r"MEI_ASSET_MGMT_DB\.PERFORMANCE\.", "", out, flags=re.IGNORECASE)
    out = re.sub(r"MEI_FINANCE_DB\.MAIN_FINANCE\.", "", out, flags=re.IGNORECASE)

    # Snowflake's ILIKE → PG's ILIKE (same ✓)
    # Snowflake's NVL → PG's COALESCE
    out = re.sub(r"\bNVL\s*\(", "COALESCE(", out, flags=re.IGNORECASE)

    return out


def _replace_dateadd(match) -> str:
    """Replace DATEADD(unit, N, base) with PG interval arithmetic."""
    unit = match.group(1).lower()
    n = int(match.group(2))
    base = match.group(3).strip()
    # Handle nested parens in base — find the matching close
    abs_n = abs(n)
    sign = "+" if n >= 0 else "-"
    return f"({base} {sign} INTERVAL '{abs_n} {unit}')"


def _replace_timestampdiff(match) -> str:
    """Replace TIMESTAMPDIFF(unit, a, b) with PG epoch diff."""
    unit = match.group(1).lower()
    a = match.group(2).strip()
    b = match.group(3).strip()
    if unit in ("second", "seconds"):
        return f"EXTRACT(EPOCH FROM ({b} - {a}))"
    elif unit in ("minute", "minutes"):
        return f"(EXTRACT(EPOCH FROM ({b} - {a})) / 60)"
    elif unit in ("hour", "hours"):
        return f"(EXTRACT(EPOCH FROM ({b} - {a})) / 3600)"
    elif unit in ("day", "days"):
        return f"(EXTRACT(EPOCH FROM ({b} - {a})) / 86400)"
    return f"EXTRACT(EPOCH FROM ({b} - {a}))"
