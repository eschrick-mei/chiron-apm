"""
Chiron APM - Redis Cache Layer

Shared cache that works across multiple workers.
Falls back to in-memory TTL cache if Redis is unavailable.
"""

import json
import logging
import os
from decimal import Decimal
from typing import Any, Optional
from datetime import datetime, date

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Default TTLs (seconds)
CACHE_TTLS = {
    "fleet_summary": 60,
    "operational_sites": 300,
    "fleet_alert_summary": 30,
    "sites_with_alerts": 30,
    "all_sites_latest": 60,
    "available_timestamps": 60,
    "ppa_rates": 86400,
    "all_forecast_data": 86400,
    "site_details": 300,
    "equipment": 300,
    "latest_values": 60,
    "alerts": 30,
    "heatmap": 120,
    "fleet_matrix": 30,
    "kpi_table": 120,
    "analytics_summary": 120,
}


def _json_default(obj: Any) -> Any:
    """Custom JSON encoder for Snowflake types."""
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    return str(obj)


def _serialize(value: Any) -> str:
    """Serialize a value for Redis storage."""
    if isinstance(value, pd.DataFrame):
        return json.dumps({"__type__": "dataframe", "data": value.to_dict("list"), "columns": list(value.columns)}, default=_json_default)
    if isinstance(value, datetime):
        return json.dumps({"__type__": "datetime", "iso": value.isoformat()})
    return json.dumps(value, default=_json_default)


def _deserialize(raw: str) -> Any:
    """Deserialize a value from Redis storage."""
    obj = json.loads(raw)
    if isinstance(obj, dict) and obj.get("__type__") == "dataframe":
        return pd.DataFrame(obj["data"], columns=obj["columns"])
    if isinstance(obj, dict) and obj.get("__type__") == "datetime":
        return datetime.fromisoformat(obj["iso"])
    return obj


class RedisCache:
    """
    Redis-backed cache with automatic serialization.
    Falls back to in-memory dict if Redis is unavailable.
    """

    def __init__(self, redis_url: Optional[str] = None, prefix: str = "chiron:"):
        self._prefix = prefix
        self._redis = None
        self._fallback: dict[str, Any] = {}
        self._fallback_expiry: dict[str, float] = {}
        self._using_fallback = False

        url = redis_url or os.environ.get("CHIRON_REDIS_URL", "redis://localhost:6379/0")

        try:
            import redis
            self._redis = redis.Redis.from_url(url, decode_responses=True, socket_timeout=2, socket_connect_timeout=2)
            self._redis.ping()
            logger.info(f"Redis cache connected: {url}")
        except Exception as e:
            logger.warning(f"Redis unavailable ({e}), using in-memory fallback cache")
            self._redis = None
            self._using_fallback = True

    @property
    def is_redis(self) -> bool:
        return not self._using_fallback

    def _full_key(self, key: str) -> str:
        return f"{self._prefix}{key}"

    def get(self, key: str) -> Optional[Any]:
        """Get a value from cache. Returns None on miss."""
        if self._using_fallback:
            import time
            full_key = self._full_key(key)
            expiry = self._fallback_expiry.get(full_key, 0)
            if expiry and time.time() > expiry:
                self._fallback.pop(full_key, None)
                self._fallback_expiry.pop(full_key, None)
                return None
            raw = self._fallback.get(full_key)
            if raw is None:
                return None
            return _deserialize(raw)

        try:
            raw = self._redis.get(self._full_key(key))
            if raw is None:
                return None
            return _deserialize(raw)
        except Exception as e:
            logger.warning(f"Redis GET error for {key}: {e}")
            return None

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> bool:
        """Set a value in cache with optional TTL in seconds."""
        if ttl is None:
            # Try to infer TTL from key prefix
            for prefix, default_ttl in CACHE_TTLS.items():
                if key.startswith(prefix):
                    ttl = default_ttl
                    break
            if ttl is None:
                ttl = 300  # Default 5 minutes

        serialized = _serialize(value)

        if self._using_fallback:
            import time
            full_key = self._full_key(key)
            self._fallback[full_key] = serialized
            self._fallback_expiry[full_key] = time.time() + ttl
            return True

        try:
            self._redis.setex(self._full_key(key), ttl, serialized)
            return True
        except Exception as e:
            logger.warning(f"Redis SET error for {key}: {e}")
            return False

    def delete(self, key: str) -> bool:
        """Delete a key from cache."""
        if self._using_fallback:
            full_key = self._full_key(key)
            self._fallback.pop(full_key, None)
            self._fallback_expiry.pop(full_key, None)
            return True

        try:
            self._redis.delete(self._full_key(key))
            return True
        except Exception as e:
            logger.warning(f"Redis DELETE error for {key}: {e}")
            return False

    def invalidate_pattern(self, pattern: str) -> int:
        """Delete all keys matching a pattern (e.g., 'alerts*')."""
        if self._using_fallback:
            import fnmatch
            full_pattern = self._full_key(pattern)
            to_delete = [k for k in self._fallback if fnmatch.fnmatch(k, full_pattern)]
            for k in to_delete:
                self._fallback.pop(k, None)
                self._fallback_expiry.pop(k, None)
            return len(to_delete)

        try:
            keys = self._redis.keys(self._full_key(pattern))
            if keys:
                return self._redis.delete(*keys)
            return 0
        except Exception as e:
            logger.warning(f"Redis pattern delete error for {pattern}: {e}")
            return 0

    def flush(self) -> bool:
        """Clear all cache entries with our prefix."""
        return self.invalidate_pattern("*") >= 0

    def stats(self) -> dict:
        """Get cache stats."""
        if self._using_fallback:
            return {
                "backend": "in-memory",
                "keys": len(self._fallback),
            }
        try:
            info = self._redis.info("keyspace")
            keys = self._redis.keys(self._full_key("*"))
            return {
                "backend": "redis",
                "chiron_keys": len(keys),
                "info": info,
            }
        except Exception:
            return {"backend": "redis", "error": "could not fetch stats"}
