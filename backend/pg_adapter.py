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


def _find_matching_paren(sql: str, start: int) -> int:
    """Find the index of the closing ')' that matches the '(' at `start`.
    Handles nested parentheses and quoted strings."""
    depth = 0
    i = start
    in_single_quote = False
    in_double_quote = False
    while i < len(sql):
        ch = sql[i]
        if ch == "'" and not in_double_quote:
            in_single_quote = not in_single_quote
        elif ch == '"' and not in_single_quote:
            in_double_quote = not in_double_quote
        elif not in_single_quote and not in_double_quote:
            if ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    return -1  # unbalanced


def _split_args(arg_str: str, expected: int = 3) -> list:
    """Split a comma-separated argument string respecting nested parens and quotes.
    Returns up to `expected` parts (last part gets the remainder)."""
    parts = []
    depth = 0
    current = []
    in_single_quote = False
    in_double_quote = False
    for ch in arg_str:
        if ch == "'" and not in_double_quote:
            in_single_quote = not in_single_quote
        elif ch == '"' and not in_single_quote:
            in_double_quote = not in_double_quote
        elif not in_single_quote and not in_double_quote:
            if ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
            elif ch == ',' and depth == 0 and len(parts) < expected - 1:
                parts.append(''.join(current).strip())
                current = []
                continue
        current.append(ch)
    parts.append(''.join(current).strip())
    return parts


def _translate_function(sql: str, func_name: str, replacer) -> str:
    """Find all occurrences of func_name(...) in sql, parse args with balanced
    parens, and replace using the replacer callback."""
    pattern = re.compile(re.escape(func_name) + r'\s*\(', re.IGNORECASE)
    result = []
    last_end = 0
    for m in pattern.finditer(sql):
        open_idx = m.end() - 1  # index of the '('
        close_idx = _find_matching_paren(sql, open_idx)
        if close_idx == -1:
            continue  # unbalanced — leave as-is
        inner = sql[open_idx + 1: close_idx]
        replacement = replacer(inner)
        if replacement is not None:
            result.append(sql[last_end:m.start()])
            result.append(replacement)
            last_end = close_idx + 1
    result.append(sql[last_end:])
    return ''.join(result)


def _translate_sql(sql: str) -> str:
    """Convert Snowflake-dialect SQL to PostgreSQL."""
    out = sql

    # 1. Simple function replacements FIRST (before DATEADD, so nested calls are clean)
    out = re.sub(r"CURRENT_TIMESTAMP\s*\(\s*\)", "NOW()", out, flags=re.IGNORECASE)
    out = re.sub(r"CURRENT_DATE\s*\(\s*\)", "CURRENT_DATE", out, flags=re.IGNORECASE)

    # 2. DATEADD(unit, N, base) → (base ± INTERVAL 'N unit')
    def _dateadd_replacer(inner: str):
        args = _split_args(inner, 3)
        if len(args) != 3:
            return None
        unit = args[0].strip().lower()
        try:
            n = int(args[1].strip())
        except ValueError:
            return None
        base = args[2].strip()
        abs_n = abs(n)
        sign = "+" if n >= 0 else "-"
        return f"({base} {sign} INTERVAL '{abs_n} {unit}')"

    out = _translate_function(out, "DATEADD", _dateadd_replacer)

    # 3. TIMESTAMPDIFF(unit, a, b) → EXTRACT(EPOCH FROM (b - a)) / divisor
    def _timestampdiff_replacer(inner: str):
        args = _split_args(inner, 3)
        if len(args) != 3:
            return None
        unit = args[0].strip().lower()
        a = args[1].strip()
        b = args[2].strip()
        divisors = {
            "second": None, "seconds": None,
            "minute": 60, "minutes": 60,
            "hour": 3600, "hours": 3600,
            "day": 86400, "days": 86400,
        }
        divisor = divisors.get(unit)
        expr = f"EXTRACT(EPOCH FROM ({b} - {a}))"
        if divisor:
            return f"({expr} / {divisor})"
        return expr

    out = _translate_function(out, "TIMESTAMPDIFF", _timestampdiff_replacer)

    # 4. Fully-qualified table names → local table names
    out = re.sub(r"MEI_ASSET_MGMT_DB\.PUBLIC\.", "", out, flags=re.IGNORECASE)
    out = re.sub(r"MEI_ASSET_MGMT_DB\.PERFORMANCE\.", "", out, flags=re.IGNORECASE)
    out = re.sub(r"MEI_FINANCE_DB\.MAIN_FINANCE\.", "", out, flags=re.IGNORECASE)

    # 5. NVL → COALESCE
    out = re.sub(r"\bNVL\s*\(", "COALESCE(", out, flags=re.IGNORECASE)

    return out
