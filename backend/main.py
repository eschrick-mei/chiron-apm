"""
Chiron APM v4.0 - Asset Performance Management Platform
High-performance API for solar portfolio monitoring and analytics.

Multi-worker deployment with shared Redis cache and JWT auth.
Run with: gunicorn main:app -c gunicorn.conf.py
"""

import os
import logging
import asyncio
from contextlib import asynccontextmanager
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Depends, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware

from data_service import DataService
from apm_analytics import APMAnalytics
from auth import (
    get_current_user, require_role, User, UserRole,
    LoginRequest, LoginResponse, verify_credentials, create_token,
    create_user, list_users, AUTH_ENABLED,
)

logger = logging.getLogger(__name__)


# =============================================================================
# Async helpers — wrap blocking DataService calls so they don't block the loop
# =============================================================================

async def run_sync(func, *args, **kwargs):
    """Run a synchronous function in a thread pool to avoid blocking the event loop.
    Thread-safety is handled by DataService._query_lock internally."""
    return await asyncio.to_thread(func, *args, **kwargs)


# =============================================================================
# Request timeout middleware
# =============================================================================

ROUTE_TIMEOUT_SECONDS = int(os.environ.get("CHIRON_ROUTE_TIMEOUT", "30"))


class TimeoutMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        try:
            return await asyncio.wait_for(
                call_next(request),
                timeout=ROUTE_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            return Response(
                content='{"detail":"Request timed out"}',
                status_code=504,
                media_type="application/json",
            )


# =============================================================================
# App initialization
# =============================================================================

async def _warm_cache(ds: DataService):
    """Pre-populate cache with core fleet data so first page load is instant."""
    try:
        logger.info("Warming cache...")
        # These run sequentially (shared cursor), but happen before any user request
        sites_df = await asyncio.to_thread(ds.get_operational_sites)
        logger.info("  Cached %d operational sites", len(sites_df))
        await asyncio.to_thread(ds.get_fleet_alert_summary)
        logger.info("  Cached fleet alert summary")
        await asyncio.to_thread(ds.get_sites_with_alerts)
        logger.info("  Cached sites with alerts")
        logger.info("Cache warm complete")
    except Exception as e:
        logger.warning("Cache warm failed (non-fatal): %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize services
    redis_url = os.environ.get("CHIRON_REDIS_URL")
    app.state.data_service = DataService(redis_url=redis_url)
    app.state.apm_analytics = APMAnalytics(app.state.data_service)
    logger.info("Chiron APM started (auth=%s, redis=%s)",
                AUTH_ENABLED, app.state.data_service.cache.is_redis)
    # Warm cache in background so startup isn't blocked
    asyncio.create_task(_warm_cache(app.state.data_service))
    yield
    # Shutdown: cleanup
    app.state.data_service.close()


app = FastAPI(
    title="Chiron APM - Asset Performance Management",
    description="Advanced API for solar portfolio monitoring, analytics, and predictive maintenance",
    version="4.0.0",
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
)

# Timeout middleware (must be added before CORS)
app.add_middleware(TimeoutMiddleware)

# CORS — configurable via environment
cors_origins = os.environ.get("CHIRON_CORS_ORIGINS", "").split(",") if os.environ.get("CHIRON_CORS_ORIGINS") else [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3002",
    "http://127.0.0.1:3003",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# Response Models
# =============================================================================

class SiteBase(BaseModel):
    site_id: str
    site_name: Optional[str] = None
    size_kw_dc: Optional[float] = None
    primary_das: Optional[str] = None
    inverter_count: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class FleetSummary(BaseModel):
    total_sites: int
    total_capacity_mw: float
    healthy_sites: int
    sites_with_alerts: int
    fleet_health_pct: float
    total_alerts: int
    site_offline_count: int
    inverter_offline_count: int
    confirmed_alerts: int


class AlertSummary(BaseModel):
    alert_id: str
    site_id: str
    site_name: Optional[str] = None
    alert_type: str
    equipment_id: Optional[str] = None
    equipment_name: Optional[str] = None
    verification_status: Optional[str] = None
    status: str
    duration_hours: Optional[float] = None
    detected_at: Optional[str] = None


# =============================================================================
# Health Check
# =============================================================================

@app.get("/health")
async def health_check():
    ds = app.state.data_service
    return {
        "status": "healthy",
        "service": "Chiron APM",
        "version": "4.0.0",
        "auth_enabled": AUTH_ENABLED,
        "cache_backend": "redis" if ds.cache.is_redis else "in-memory",
        "timestamp": datetime.utcnow().isoformat(),
    }


# =============================================================================
# Auth Endpoints
# =============================================================================

@app.post("/api/auth/login")
async def login(req: LoginRequest) -> LoginResponse:
    """Authenticate and receive a JWT token."""
    user = verify_credentials(req.username, req.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(user)
    exp = datetime.utcnow() + timedelta(hours=24)
    return LoginResponse(token=token, user=user, expires_at=exp.isoformat())


@app.get("/api/auth/me")
async def get_me(user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """Get current user info."""
    return {"user": user.model_dump(), "auth_enabled": AUTH_ENABLED}


@app.get("/api/auth/users")
async def get_users(user: User = Depends(require_role(UserRole.ADMIN))) -> List[Dict[str, Any]]:
    """List all users (admin only)."""
    return [u.model_dump() for u in list_users()]


class CreateUserRequest(BaseModel):
    username: str
    password: str
    display_name: str
    role: str = "viewer"
    email: str = ""


@app.post("/api/auth/users")
async def add_user(
    req: CreateUserRequest,
    user: User = Depends(require_role(UserRole.ADMIN))
) -> Dict[str, Any]:
    """Create a new user (admin only)."""
    try:
        new_user = create_user(req.username, req.password, req.display_name, req.role, req.email)
        return {"user": new_user.model_dump(), "created_by": user.username}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/cache/stats")
async def get_cache_stats(user: User = Depends(require_role(UserRole.ADMIN))) -> Dict[str, Any]:
    """Get cache statistics (admin only)."""
    ds = app.state.data_service
    return ds.cache.stats()


@app.post("/api/cache/flush")
async def flush_cache(user: User = Depends(require_role(UserRole.ADMIN))) -> Dict[str, str]:
    """Flush all cache entries (admin only)."""
    ds = app.state.data_service
    ds.cache.flush()
    return {"status": "flushed", "by": user.username}


# =============================================================================
# Fleet Endpoints
# =============================================================================

@app.get("/api/fleet/summary")
async def get_fleet_summary() -> FleetSummary:
    """Get overall fleet summary statistics."""
    ds = app.state.data_service

    sites_df, alert_summary, alert_sites = await asyncio.gather(
        run_sync(ds.get_operational_sites),
        run_sync(ds.get_fleet_alert_summary),
        run_sync(ds.get_sites_with_alerts),
    )

    total_sites = len(sites_df)
    total_capacity = sites_df['SIZE_KW_DC'].sum() / 1000 if 'SIZE_KW_DC' in sites_df.columns else 0
    sites_with_alerts = len(set(alert_sites) & set(sites_df['SITE_ID'].tolist()))
    healthy_sites = total_sites - sites_with_alerts
    health_pct = (healthy_sites / total_sites * 100) if total_sites > 0 else 0

    return FleetSummary(
        total_sites=total_sites,
        total_capacity_mw=round(total_capacity, 2),
        healthy_sites=healthy_sites,
        sites_with_alerts=sites_with_alerts,
        fleet_health_pct=round(health_pct, 1),
        total_alerts=alert_summary.get('TOTAL_ALERTS', 0) or 0,
        site_offline_count=alert_summary.get('SITE_OFFLINE', 0) or 0,
        inverter_offline_count=alert_summary.get('INVERTER_OFFLINE', 0) or 0,
        confirmed_alerts=alert_summary.get('CONFIRMED', 0) or 0
    )


@app.get("/api/fleet/sites")
async def get_fleet_sites(
    search: Optional[str] = None,
    status: Optional[str] = None,
    das: Optional[str] = None,
    stage: Optional[str] = None,
    limit: int = Query(default=200, le=500)
) -> List[Dict[str, Any]]:
    """Get list of operational sites with optional filtering."""
    ds = app.state.data_service

    sites_df, alert_sites_list = await asyncio.gather(
        run_sync(ds.get_operational_sites),
        run_sync(ds.get_sites_with_alerts),
    )
    alert_sites = set(alert_sites_list)

    # Apply stage filter (FC, Pre-FC, or All)
    if stage and stage != "All":
        sites_df = sites_df[sites_df['OPERATIONAL_STAGE'] == stage]

    # Apply filters
    if search:
        search_lower = search.lower()
        mask = (
            sites_df['SITE_ID'].str.lower().str.contains(search_lower, na=False) |
            sites_df['SITE_NAME'].str.lower().str.contains(search_lower, na=False)
        )
        sites_df = sites_df[mask]

    if status == 'healthy':
        sites_df = sites_df[~sites_df['SITE_ID'].isin(alert_sites)]
    elif status == 'alerts':
        sites_df = sites_df[sites_df['SITE_ID'].isin(alert_sites)]

    if das:
        sites_df = sites_df[sites_df['PRIMARY_DAS'] == das]

    # Add alert status
    sites_df = sites_df.head(limit)
    result = sites_df.to_dict('records')

    for site in result:
        site['has_alert'] = site['SITE_ID'] in alert_sites

    return result


@app.get("/api/fleet/das-options")
async def get_das_options() -> List[str]:
    """Get unique DAS providers for filtering."""
    ds = app.state.data_service
    sites_df = await run_sync(ds.get_operational_sites)

    if 'PRIMARY_DAS' in sites_df.columns:
        return sorted(sites_df['PRIMARY_DAS'].dropna().unique().tolist())
    return []


# =============================================================================
# Fleet Matrix - Real-time Inverter Grid (NEW APM FEATURE)
# =============================================================================

@app.get("/api/fleet/matrix")
async def get_fleet_matrix(
    stage: str = Query(default="FC", description="FC, Pre-FC, or All"),
    timestamp: Optional[str] = Query(default=None, description="ISO timestamp for historical view")
) -> Dict[str, Any]:
    """
    Get fleet matrix showing all sites and their inverter production.

    This is the key view for identifying outages across the entire fleet:
    - Rows = Sites
    - Columns = Inverters
    - Values = Production (kWh) with status indicators

    Supports historical playback via the timestamp parameter.
    """
    apm = app.state.apm_analytics

    # Parse timestamp if provided
    query_timestamp = None
    if timestamp:
        try:
            query_timestamp = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid timestamp format. Use ISO format.")

    return await run_sync(apm.get_fleet_matrix, stage=stage, timestamp=query_timestamp)


@app.get("/api/fleet/timestamps")
async def get_available_timestamps(
    hours: int = Query(default=72, description="Number of hours to look back")
) -> Dict[str, Any]:
    """
    Get available timestamps for the fleet matrix time slider.
    Returns a list of hours with available data.
    """
    ds = app.state.data_service
    timestamps = await run_sync(ds.get_available_timestamps, hours=hours)

    return {
        'timestamps': timestamps,
        'count': len(timestamps),
        'hours_requested': hours
    }


# =============================================================================
# Site Endpoints
# =============================================================================

@app.get("/api/sites/{site_id}")
async def get_site_details(site_id: str) -> Dict[str, Any]:
    """Get detailed information for a specific site."""
    ds = app.state.data_service
    details = await run_sync(ds.get_site_details, site_id)

    if not details:
        raise HTTPException(status_code=404, detail="Site not found")

    # Fetch equipment, alerts, and latest values concurrently
    equipment, alerts, latest_values = await asyncio.gather(
        run_sync(ds.get_site_equipment, site_id),
        run_sync(ds.get_site_alerts, site_id),
        run_sync(ds.get_equipment_latest_values, site_id),
    )

    return {
        "site": details,
        "equipment": equipment.to_dict('records') if not equipment.empty else [],
        "alerts": alerts.to_dict('records') if not alerts.empty else [],
        "latest_values": latest_values
    }


@app.get("/api/sites/{site_id}/heatmap")
async def get_site_heatmap(
    site_id: str,
    days: int = Query(default=7, le=30)
) -> Dict[str, Any]:
    """Get inverter heatmap data for a site with capacity factor calculation."""
    ds = app.state.data_service
    df, site_details = await asyncio.gather(
        run_sync(ds.get_inverter_heatmap_data, site_id, days),
        run_sync(ds.get_site_details, site_id),
    )

    if df.empty:
        return {"data": [], "inverters": [], "timestamps": [], "inverter_count": 0}

    # Process for heatmap
    df.columns = [str(c).upper() for c in df.columns]
    inv_cols = [c for c in df.columns if c.startswith('IN') and c.endswith('_VALUE')]

    if not inv_cols:
        return {"data": [], "inverters": [], "timestamps": [], "inverter_count": 0}

    # Calculate rated capacity per inverter (kW DC)
    size_kw_dc = float(site_details.get('SIZE_KW_DC', 0) or 0)
    inverter_count = int(site_details.get('INVERTER_COUNT', len(inv_cols)) or len(inv_cols))
    rated_kw_per_inverter = (size_kw_dc / inverter_count) if (inverter_count > 0 and size_kw_dc > 0) else 1

    # Melt and process
    import pandas as pd
    heatmap_df = df.melt(
        id_vars=['MEASUREMENTTIME'],
        value_vars=inv_cols,
        var_name='inverter',
        value_name='energy'
    )
    heatmap_df['inverter'] = heatmap_df['inverter'].str.replace('_VALUE', '')
    heatmap_df['energy'] = pd.to_numeric(heatmap_df['energy'], errors='coerce').fillna(0)

    # Calculate Capacity Factor
    heatmap_df['capacity_factor'] = (heatmap_df['energy'] / rated_kw_per_inverter * 100).clip(0, 100)
    heatmap_df['timestamp'] = heatmap_df['MEASUREMENTTIME'].dt.strftime('%Y-%m-%d %H:%M')

    # Pivot for response
    pivot_df = heatmap_df.pivot_table(
        index='inverter',
        columns='timestamp',
        values='capacity_factor',
        aggfunc='mean'
    ).fillna(0)

    # Sort inverters naturally
    import re
    def natural_sort_key(s):
        return [int(t) if t.isdigit() else t for t in re.split(r'(\d+)', str(s))]

    sorted_index = sorted(pivot_df.index.tolist(), key=natural_sort_key)
    pivot_df = pivot_df.reindex(sorted_index)

    return {
        "inverters": pivot_df.index.tolist(),
        "timestamps": pivot_df.columns.tolist(),
        "data": pivot_df.values.tolist(),
        "expected_per_inverter": rated_kw_per_inverter,
        "size_kw_dc": size_kw_dc,
        "inverter_count": inverter_count
    }


@app.get("/api/sites/{site_id}/metrics")
async def get_site_metrics(
    site_id: str,
    days: int = Query(default=5, le=30)
) -> Dict[str, Any]:
    """Get site metrics (production, irradiance, etc.)."""
    ds = app.state.data_service
    df = await run_sync(ds.get_site_metrics_data, site_id, days)

    if df.empty:
        return {"data": []}

    df.columns = [str(c).upper() for c in df.columns]
    df['MEASUREMENTTIME'] = df['MEASUREMENTTIME'].dt.strftime('%Y-%m-%d %H:%M')

    return {"data": df.to_dict('records')}


@app.get("/api/sites/{site_id}/performance")
async def get_site_performance(site_id: str) -> Dict[str, Any]:
    """Get site performance ratio data."""
    ds = app.state.data_service
    site_info = await run_sync(ds.get_site_details, site_id)
    pto_date = site_info.get('PTO_ACTUAL_DATE')

    pr_data, daily_pr = await asyncio.gather(
        run_sync(ds.calculate_site_performance_ratio, site_id, pto_date, 30),
        run_sync(ds.get_daily_performance_data, site_id, pto_date, 60),
    )

    daily_data = []
    if not daily_pr.empty:
        daily_pr['DATE'] = daily_pr['DATE'].astype(str)
        daily_data = daily_pr.to_dict('records')

    return {
        "pr_summary": pr_data,
        "daily_data": daily_data
    }


@app.get("/api/sites/{site_id}/full")
async def get_site_full(
    site_id: str,
    metrics_days: int = Query(default=7, le=30),
    heatmap_days: int = Query(default=5, le=30),
    pr_days: int = Query(default=30, le=90),
) -> Dict[str, Any]:
    """Combined site endpoint — returns details, equipment, alerts, metrics,
    heatmap, and performance in a single request.  All Snowflake queries run
    in parallel via per-cursor execution."""
    ds = app.state.data_service
    import re as _re

    # Phase 1: site details (needed for downstream calcs)
    details = await run_sync(ds.get_site_details, site_id)
    if not details:
        raise HTTPException(status_code=404, detail="Site not found")

    pto_date = details.get('PTO_ACTUAL_DATE')

    # Phase 2: everything else in parallel — cursors are independent
    (
        equipment_df, alerts_df, latest_values,
        metrics_df, heatmap_df,
        pr_data, daily_pr_df,
    ) = await asyncio.gather(
        run_sync(ds.get_site_equipment, site_id),
        run_sync(ds.get_site_alerts, site_id),
        run_sync(ds.get_equipment_latest_values, site_id),
        run_sync(ds.get_site_metrics_data, site_id, metrics_days),
        run_sync(ds.get_inverter_heatmap_data, site_id, heatmap_days),
        run_sync(ds.calculate_site_performance_ratio, site_id, pto_date, pr_days),
        run_sync(ds.get_daily_performance_data, site_id, pto_date, 60),
    )

    # --- helper: ensure MEASUREMENTTIME is datetime after cache round-trip ---
    def _ensure_dt(df: 'pd.DataFrame') -> 'pd.DataFrame':
        df = df.copy()
        df.columns = [str(c).upper() for c in df.columns]
        if 'MEASUREMENTTIME' in df.columns:
            df['MEASUREMENTTIME'] = pd.to_datetime(df['MEASUREMENTTIME'], errors='coerce')
        return df

    # --- Build metrics payload ---
    metrics_payload: Dict[str, Any] = {"data": []}
    if not metrics_df.empty:
        mdf = _ensure_dt(metrics_df)
        mdf['MEASUREMENTTIME'] = mdf['MEASUREMENTTIME'].dt.strftime('%Y-%m-%d %H:%M')
        metrics_payload["data"] = mdf.to_dict('records')

    # --- Build heatmap payload ---
    heatmap_payload: Dict[str, Any] = {"data": [], "inverters": [], "timestamps": [], "inverter_count": 0}
    if not heatmap_df.empty:
        import pandas as _pd
        heatmap_df = _ensure_dt(heatmap_df)
        inv_cols = [c for c in heatmap_df.columns if c.startswith('IN') and c.endswith('_VALUE')]
        if inv_cols:
            size_kw_dc = float(details.get('SIZE_KW_DC', 0) or 0)
            inverter_count = int(details.get('INVERTER_COUNT', len(inv_cols)) or len(inv_cols))
            rated_kw = (size_kw_dc / inverter_count) if (inverter_count > 0 and size_kw_dc > 0) else 1
            melted = heatmap_df.melt(
                id_vars=['MEASUREMENTTIME'], value_vars=inv_cols,
                var_name='inverter', value_name='energy',
            )
            melted['inverter'] = melted['inverter'].str.replace('_VALUE', '')
            melted['energy'] = _pd.to_numeric(melted['energy'], errors='coerce').fillna(0)
            melted['capacity_factor'] = (melted['energy'] / rated_kw * 100).clip(0, 100)
            melted['timestamp'] = melted['MEASUREMENTTIME'].dt.strftime('%Y-%m-%d %H:%M')
            pivot = melted.pivot_table(index='inverter', columns='timestamp', values='capacity_factor', aggfunc='mean').fillna(0)
            def _nsort(s):
                return [int(t) if t.isdigit() else t for t in _re.split(r'(\d+)', str(s))]
            sorted_idx = sorted(pivot.index.tolist(), key=_nsort)
            pivot = pivot.reindex(sorted_idx)
            heatmap_payload = {
                "inverters": pivot.index.tolist(),
                "timestamps": pivot.columns.tolist(),
                "data": pivot.values.tolist(),
                "expected_per_inverter": rated_kw,
                "size_kw_dc": size_kw_dc,
                "inverter_count": inverter_count,
            }

    # --- Build performance payload ---
    daily_data: List[Dict] = []
    if not daily_pr_df.empty:
        daily_pr_df['DATE'] = daily_pr_df['DATE'].astype(str)
        daily_data = daily_pr_df.to_dict('records')

    return {
        "site": details,
        "equipment": equipment_df.to_dict('records') if not equipment_df.empty else [],
        "alerts": alerts_df.to_dict('records') if not alerts_df.empty else [],
        "latest_values": latest_values,
        "metrics": metrics_payload,
        "heatmap": heatmap_payload,
        "performance": {"pr_summary": pr_data, "daily_data": daily_data},
    }


# =============================================================================
# Alerts Endpoints
# =============================================================================

@app.get("/api/alerts")
async def get_alerts(
    days: int = Query(default=7, le=30),
    status: Optional[str] = None,
    alert_type: Optional[str] = None,
    verification: Optional[str] = None,
    site_id: Optional[str] = None,
    stage: str = "FC",
    limit: int = Query(default=200, le=500)
) -> Dict[str, Any]:
    """Get alerts with filtering options."""
    ds = app.state.data_service

    df = await run_sync(ds.get_all_alerts,
        days=days,
        status=status,
        alert_type=alert_type,
        verification_status=verification,
        site_id=site_id,
        stage=stage,
        limit=limit
    )

    if df.empty:
        return {"alerts": [], "count": 0}

    # Convert timestamps
    for col in ['DETECTED_AT', 'VERIFIED_AT', 'RESOLVED_AT', 'CREATED_AT']:
        if col in df.columns:
            df[col] = df[col].astype(str)

    return {
        "alerts": df.to_dict('records'),
        "count": len(df)
    }


@app.get("/api/alerts/stats")
async def get_alert_stats(
    days: int = Query(default=7, le=30),
    verification: Optional[str] = None
) -> Dict[str, Any]:
    """Get alert statistics for charts."""
    ds = app.state.data_service

    # Type breakdown
    df = await run_sync(ds.get_all_alerts, days=days, verification_status=verification, limit=1000)

    if df.empty:
        return {
            "by_type": {},
            "by_status": {},
            "timeline": [],
            "top_sites": []
        }

    # Aggregate by type
    type_counts = df['ALERT_TYPE'].value_counts().to_dict()
    status_counts = df['STATUS'].value_counts().to_dict()

    # Timeline
    timeline = await run_sync(ds.get_alert_timeline, days=days, verification_status=verification)
    timeline_data = []
    if not timeline.empty:
        timeline['HOUR'] = timeline['HOUR'].astype(str)
        timeline_data = timeline.to_dict('records')

    # Top sites
    top_sites = await run_sync(ds.get_alerts_by_site, days=days, limit=10, verification_status=verification)
    top_sites_data = top_sites.to_dict('records') if not top_sites.empty else []

    return {
        "by_type": type_counts,
        "by_status": status_counts,
        "timeline": timeline_data,
        "top_sites": top_sites_data
    }


@app.get("/api/alerts/{alert_id}/detail")
async def get_alert_detail(
    alert_id: str,
    site_id: str,
    alert_type: str,
    equipment_id: Optional[str] = None
) -> Dict[str, Any]:
    """Get detailed data for an alert (for expanded view charts)."""
    ds = app.state.data_service

    detail_data = await run_sync(ds.get_alert_detail_data,
        site_id=site_id,
        alert_type=alert_type,
        equipment_id=equipment_id,
        days=7
    )

    if not detail_data or 'main' not in detail_data or detail_data['main'].empty:
        return {"data": []}

    df = detail_data['main']
    df['MEASUREMENTTIME'] = df['MEASUREMENTTIME'].dt.strftime('%Y-%m-%d %H:%M')

    return {"data": df.to_dict('records')}


@app.post("/api/alerts/{alert_id}/verify")
async def verify_alert(
    alert_id: str,
    site_id: str,
    alert_type: str,
    equipment_id: Optional[str] = None
) -> Dict[str, Any]:
    """Verify an alert in real-time using DAS APIs."""
    ds = app.state.data_service

    result = await run_sync(ds.verify_alert_realtime,
        site_id=site_id,
        alert_type=alert_type,
        equipment_id=equipment_id,
    )

    return result


# =============================================================================
# Equipment Endpoints
# =============================================================================

@app.get("/api/equipment/{site_id}")
async def get_site_equipment(site_id: str) -> Dict[str, Any]:
    """Get equipment hierarchy for a site."""
    ds = app.state.data_service

    site_details, equipment, latest_values = await asyncio.gather(
        run_sync(ds.get_site_details, site_id),
        run_sync(ds.get_site_equipment, site_id),
        run_sync(ds.get_equipment_latest_values, site_id),
    )

    if equipment.empty:
        return {"site": site_details, "equipment": [], "latest_values": {}}

    # Group by type
    grouped = {}
    for _, row in equipment.iterrows():
        eq_code = row.get('EQUIPMENT_CODE', 'OTHER')
        if eq_code not in grouped:
            grouped[eq_code] = []
        grouped[eq_code].append(row.to_dict())

    return {
        "site": site_details,
        "equipment_by_type": grouped,
        "latest_values": latest_values
    }


# =============================================================================
# Analytics Endpoints
# =============================================================================

@app.get("/api/analytics/sites")
async def get_sites_analytics(
    stage: str = "FC",
    days: int = Query(default=7, le=30)
) -> Dict[str, Any]:
    """Get site analytics summary for Sites Deep-Dive page."""
    ds = app.state.data_service

    df = await run_sync(ds.get_site_analytics_summary, stage=stage, days=days)

    if df.empty:
        return {"sites": [], "summary": {}}

    # Convert timestamps
    for col in ['PTO_ACTUAL_DATE', 'OLDEST_ALERT_AT']:
        if col in df.columns:
            df[col] = df[col].astype(str)

    # Calculate summary
    total_kw_offline = float(df['ESTIMATED_KW_OFFLINE'].sum()) if 'ESTIMATED_KW_OFFLINE' in df.columns else 0
    total_capacity = float(df['SIZE_KW_DC'].sum()) if 'SIZE_KW_DC' in df.columns else 0
    sites_with_issues = len(df[df['CONFIRMED_ALERTS'] > 0]) if 'CONFIRMED_ALERTS' in df.columns else 0

    return {
        "sites": df.to_dict('records'),
        "summary": {
            "total_sites": len(df),
            "sites_with_issues": sites_with_issues,
            "total_kw_offline": total_kw_offline,
            "total_capacity": total_capacity,
            "offline_pct": (total_kw_offline / total_capacity * 100) if total_capacity > 0 else 0
        }
    }


# =============================================================================
# APM Advanced Analytics Endpoints (NEW)
# =============================================================================

@app.get("/api/apm/anomalies/{site_id}")
async def get_site_anomalies(
    site_id: str,
    hours: int = Query(default=24, le=168)
) -> Dict[str, Any]:
    """
    Detect anomalies for a specific site.

    Returns detected anomalies including:
    - Production drops
    - Underperformance
    - String imbalance
    - Communication loss
    """
    apm = app.state.apm_analytics
    anomalies = await run_sync(apm.detect_anomalies, site_id, hours=hours)

    return {
        "site_id": site_id,
        "period_hours": hours,
        "anomalies": anomalies,
        "count": len(anomalies),
        "generated_at": datetime.now().isoformat()
    }


@app.get("/api/apm/revenue-impact/{site_id}")
async def get_site_revenue_impact(
    site_id: str,
    energy_price: Optional[float] = None,
    hours: int = Query(default=168, le=720)  # Default 7 days
) -> Dict[str, Any]:
    """
    Calculate revenue impact for a site.

    Estimates lost production and revenue based on:
    - Actual vs expected production
    - Weather-adjusted performance
    - Energy price per kWh
    """
    apm = app.state.apm_analytics
    return await run_sync(apm.calculate_revenue_impact, site_id, energy_price=energy_price, hours=hours)


@app.get("/api/apm/revenue-impact")
async def get_fleet_revenue_impact(
    stage: str = "FC",
    energy_price: Optional[float] = None,
    days: int = Query(default=7, le=30)
) -> Dict[str, Any]:
    """
    Calculate total fleet revenue impact.

    Returns aggregated revenue impact across all sites with outages.
    """
    apm = app.state.apm_analytics
    return await run_sync(apm.calculate_fleet_revenue_impact, stage=stage, energy_price=energy_price, days=days)


@app.get("/api/apm/maintenance-score/{site_id}")
async def get_maintenance_score(site_id: str) -> Dict[str, Any]:
    """
    Calculate predictive maintenance score for a site.

    Score from 0-100 based on:
    - Performance ratio
    - Alert history
    - Equipment age
    - Data quality
    - Inverter health
    """
    apm = app.state.apm_analytics
    return await run_sync(apm.calculate_maintenance_score, site_id)


@app.get("/api/apm/maintenance-scores")
async def get_fleet_maintenance_scores(
    stage: str = "FC",
    limit: int = Query(default=100, le=500)
) -> Dict[str, Any]:
    """
    Get simplified maintenance scores for all sites.

    Returns a quick health indicator based on:
    - Confirmed alerts (weighted heavily)
    - kW offline percentage
    - Inverter offline percentage

    This is a lightweight alternative to full maintenance score calculation.
    """
    ds = app.state.data_service
    df = await run_sync(ds.get_site_analytics_summary, stage=stage, days=7)

    if df.empty:
        return {"scores": [], "generated_at": datetime.now().isoformat()}

    scores = []
    for _, row in df.head(limit).iterrows():
        site_id = row['SITE_ID']

        # Calculate quick score based on available data
        score = 100.0

        # Factor 1: Confirmed alerts (weight: 40%)
        confirmed = int(row.get('CONFIRMED_ALERTS', 0) or 0)
        if confirmed == 0:
            alert_score = 100
        elif confirmed <= 1:
            alert_score = 70
        elif confirmed <= 3:
            alert_score = 40
        else:
            alert_score = 10
        score -= (100 - alert_score) * 0.40

        # Factor 2: kW offline percentage (weight: 35%)
        size_dc = float(row.get('SIZE_KW_DC', 0) or 0)
        kw_offline = float(row.get('ESTIMATED_KW_OFFLINE', 0) or 0)
        offline_pct = (kw_offline / size_dc * 100) if size_dc > 0 else 0
        if offline_pct == 0:
            kw_score = 100
        elif offline_pct < 5:
            kw_score = 80
        elif offline_pct < 15:
            kw_score = 50
        elif offline_pct < 30:
            kw_score = 25
        else:
            kw_score = 0
        score -= (100 - kw_score) * 0.35

        # Factor 3: Inverter health (weight: 25%)
        inv_count = int(row.get('INVERTER_COUNT', 0) or 0)
        inv_offline = int(row.get('CONFIRMED_INV_OFFLINE', 0) or 0)
        if inv_count > 0:
            inv_online_pct = ((inv_count - inv_offline) / inv_count) * 100
            inv_score = inv_online_pct
        else:
            inv_score = 100
        score -= (100 - inv_score) * 0.25

        # Determine status
        score = max(0, min(100, score))
        if score >= 85:
            status = 'excellent'
        elif score >= 70:
            status = 'good'
        elif score >= 50:
            status = 'fair'
        elif score >= 30:
            status = 'poor'
        else:
            status = 'critical'

        scores.append({
            'site_id': site_id,
            'score': round(score, 0),
            'status': status,
            'confirmed_alerts': confirmed,
            'kw_offline_pct': round(offline_pct, 1),
            'inv_offline': inv_offline
        })

    # Sort by score (worst first)
    scores.sort(key=lambda x: x['score'])

    return {
        "scores": scores,
        "count": len(scores),
        "generated_at": datetime.now().isoformat()
    }


@app.get("/api/apm/fleet-rankings")
async def get_fleet_rankings(
    stage: str = "FC",
    metric: str = Query(default="performance", description="performance, production, or availability")
) -> Dict[str, Any]:
    """
    Get fleet rankings by various metrics.

    Compares all sites and provides statistics.
    """
    apm = app.state.apm_analytics
    return await run_sync(apm.get_fleet_rankings, stage=stage, metric=metric)


@app.get("/api/apm/fleet-kpis")
async def get_fleet_kpis(
    stage: str = "FC",
    days: int = Query(default=7, le=90),
    start_date: Optional[str] = Query(default=None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(default=None, description="End date (YYYY-MM-DD)")
) -> Dict[str, Any]:
    """
    Get comprehensive KPI table for all sites using DAILY_DATA_LIVE pre-computed columns.

    Returns detailed metrics per site including:
    - WA PR (Weather Adjusted Performance Ratio) - PRIMARY KPI
    - PR (Raw Performance Ratio = actual / expected)
    - Insolation Gap (weather vs forecast)
    - Availability (production-weighted)
    - Production metrics (meter, inverter, smart selection)
    - Revenue metrics (from TE_OPERATING PPA rates)
    - Specific Yield (kWh/kWp)
    - Capacity Factor (%)

    Uses Snowflake DAILY_DATA_LIVE view with pre-computed KPIs for optimal performance.

    Args:
        stage: 'FC' or 'Pre-FC' to filter sites
        days: Number of days (used if start_date/end_date not provided)
        start_date: Custom start date (YYYY-MM-DD)
        end_date: Custom end date (YYYY-MM-DD)
    """
    apm = app.state.apm_analytics
    return await run_sync(apm.get_fleet_kpi_table,
        stage=stage,
        days=days,
        start_date=start_date,
        end_date=end_date
    )


@app.get("/api/apm/string-analysis/{site_id}")
async def get_string_analysis(
    site_id: str,
    days: int = Query(default=7, le=30)
) -> Dict[str, Any]:
    """
    Get detailed string/inverter-level analysis for a site.

    Identifies underperforming inverters and string imbalances.
    """
    apm = app.state.apm_analytics
    return await run_sync(apm.get_string_analysis, site_id, days=days)


# =============================================================================
# Data Quality Diagnostics Endpoints
# =============================================================================

@app.get("/api/apm/data-quality/insolation")
async def get_insolation_quality_diagnostic(
    stage: str = "FC",
    days: int = Query(default=7, le=30)
) -> Dict[str, Any]:
    """
    Diagnostic endpoint to analyze insolation data quality issues.

    Identifies:
    - Sites with WA PR > 120% (likely bad insolation data)
    - Zero onsite insolation when satellite shows valid readings
    - Extreme insolation gaps (-50% or +50%)
    - Onsite vs satellite mismatches

    This helps identify where smart insolation selection is failing.
    """
    ds = app.state.data_service

    # Get site list for stage
    sites_df = await run_sync(ds.get_operational_sites)
    if stage == 'FC':
        sites_df = sites_df[sites_df['DELIVERY_PHASE'].str.upper() == 'FC']
    elif stage == 'Pre-FC':
        sites_df = sites_df[sites_df['DELIVERY_PHASE'].str.upper().isin(['BU', 'PTO', 'SC'])]

    site_ids = sites_df['SITE_ID'].tolist()

    if not site_ids:
        return {"issues": [], "summary": {}, "generated_at": datetime.now().isoformat()}

    # Calculate date range
    end_date = datetime.now().strftime('%Y-%m-%d')
    start_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')

    # Get summary statistics and issue rows concurrently
    summary, issues_df = await asyncio.gather(
        run_sync(ds.get_insolation_quality_summary, site_ids, start_date, end_date),
        run_sync(ds.diagnose_insolation_quality, site_ids, start_date, end_date),
    )

    issues = []
    if not issues_df.empty:
        # Convert DataFrame to list of dicts with proper serialization
        for _, row in issues_df.iterrows():
            issue = {}
            for col in issues_df.columns:
                val = row[col]
                if pd.isna(val):
                    issue[col] = None
                elif hasattr(val, 'isoformat'):
                    issue[col] = val.isoformat()
                elif isinstance(val, (float, int)):
                    issue[col] = round(float(val), 4) if isinstance(val, float) else int(val)
                else:
                    issue[col] = str(val)
            issues.append(issue)

    return {
        "issues": issues,
        "summary": {
            "total_rows_analyzed": summary.get('TOTAL_ROWS', 0),
            "wa_pr_over_120_count": summary.get('WA_PR_OVER_120_COUNT', 0),
            "wa_pr_under_50_count": summary.get('WA_PR_UNDER_50_COUNT', 0),
            "extreme_negative_gap_count": summary.get('EXTREME_NEGATIVE_GAP_COUNT', 0),
            "extreme_positive_gap_count": summary.get('EXTREME_POSITIVE_GAP_COUNT', 0),
            "zero_insolation_with_production": summary.get('ZERO_INSOLATION_WITH_PRODUCTION', 0),
            "using_onsite_count": summary.get('USING_ONSITE', 0),
            "using_satellite_count": summary.get('USING_SATELLITE', 0),
            "total_sites": summary.get('TOTAL_SITES', 0),
            "sites_with_high_wa_pr": summary.get('SITES_WITH_HIGH_WA_PR', 0),
        },
        "period_days": days,
        "stage": stage,
        "start_date": start_date,
        "end_date": end_date,
        "generated_at": datetime.now().isoformat()
    }


# =============================================================================
# Priority Operations Endpoints (Enhanced)
# =============================================================================

@app.get("/api/priority/queue")
async def get_priority_queue(
    stage: str = "FC",
    limit: int = Query(default=20, le=50)
) -> Dict[str, Any]:
    """
    Get prioritized action queue based on urgency and impact.

    Ranks issues by:
    - Revenue impact
    - Duration
    - Severity
    - Site capacity
    """
    ds = app.state.data_service
    apm = app.state.apm_analytics

    # Get analytics summary
    analytics = await run_sync(ds.get_site_analytics_summary, stage=stage, days=7)

    if analytics.empty:
        return {"queue": [], "summary": {}}

    queue_items = []

    for _, row in analytics.iterrows():
        site_id = row['SITE_ID']
        kw_offline = float(row.get('ESTIMATED_KW_OFFLINE', 0) or 0)
        confirmed_alerts = int(row.get('CONFIRMED_ALERTS', 0) or 0)

        if kw_offline <= 0 and confirmed_alerts <= 0:
            continue

        # Calculate urgency score (0-100)
        size_kw = float(row.get('SIZE_KW_DC', 0) or 0)
        offline_pct = (kw_offline / size_kw * 100) if size_kw > 0 else 0

        # Base urgency on percentage offline
        urgency = min(100, offline_pct * 2)

        # Boost for site-level issues
        if int(row.get('CONFIRMED_SITE_OFFLINE', 0) or 0) > 0:
            urgency = min(100, urgency + 30)

        # Estimate daily revenue loss (assume $0.08/kWh, 5 peak sun hours)
        daily_loss = kw_offline * 5 * 0.08

        # Determine issue type
        if int(row.get('CONFIRMED_SITE_OFFLINE', 0) or 0) > 0:
            issue_type = 'Site Offline'
            severity = 'critical'
        elif int(row.get('CONFIRMED_INV_OFFLINE', 0) or 0) > 0:
            inv_count = int(row.get('CONFIRMED_INV_OFFLINE', 0) or 0)
            issue_type = f'{inv_count} Inverter(s) Offline'
            severity = 'high' if inv_count > 2 else 'medium'
        else:
            issue_type = 'Performance Issue'
            severity = 'medium'

        queue_items.append({
            'site_id': site_id,
            'site_name': row.get('SITE_NAME', site_id),
            'primary_das': row.get('PRIMARY_DAS', 'Unknown'),
            'size_kw_dc': size_kw,
            'issue_type': issue_type,
            'severity': severity,
            'kw_offline': round(kw_offline, 2),
            'offline_pct': round(offline_pct, 1),
            'daily_revenue_loss': round(daily_loss, 2),
            'urgency_score': round(urgency, 1),
            'confirmed_alerts': confirmed_alerts,
            'inverters_offline': int(row.get('CONFIRMED_INV_OFFLINE', 0) or 0)
        })

    # Sort by urgency
    queue_items.sort(key=lambda x: x['urgency_score'], reverse=True)
    queue_items = queue_items[:limit]

    # Calculate summary
    total_loss = sum(item['daily_revenue_loss'] for item in queue_items)
    total_kw_offline = sum(item['kw_offline'] for item in queue_items)
    critical_count = len([item for item in queue_items if item['severity'] == 'critical'])

    return {
        "queue": queue_items,
        "summary": {
            "total_issues": len(queue_items),
            "critical_count": critical_count,
            "total_kw_offline": round(total_kw_offline, 2),
            "total_daily_loss": round(total_loss, 2),
            "projected_monthly_loss": round(total_loss * 30, 2)
        },
        "generated_at": datetime.now().isoformat()
    }


@app.get("/api/priority/summary")
async def get_priority_summary(
    stage: str = "FC",
    days: int = Query(default=7, le=30)
) -> Dict[str, Any]:
    """
    Get priority operations summary with KPIs.
    """
    ds = app.state.data_service
    apm = app.state.apm_analytics

    # Get fleet summary
    sites_df = await run_sync(ds.get_operational_sites)
    if stage == 'FC':
        sites_df = sites_df[sites_df['DELIVERY_PHASE'].str.upper() == 'FC']
    elif stage == 'Pre-FC':
        sites_df = sites_df[sites_df['DELIVERY_PHASE'].str.upper().isin(['BU', 'PTO', 'SC'])]

    total_sites = len(sites_df)
    total_capacity = float(sites_df['SIZE_KW_DC'].sum()) if 'SIZE_KW_DC' in sites_df.columns else 0

    # Get alerts and analytics concurrently
    alert_summary, alert_sites_list, analytics = await asyncio.gather(
        run_sync(ds.get_fleet_alert_summary),
        run_sync(ds.get_sites_with_alerts),
        run_sync(ds.get_site_analytics_summary, stage=stage, days=days),
    )
    alert_sites = set(alert_sites_list)
    total_kw_offline = float(analytics['ESTIMATED_KW_OFFLINE'].sum()) if not analytics.empty else 0

    # Calculate revenue impact
    daily_revenue_loss = total_kw_offline * 5 * 0.08  # 5 peak sun hours, $0.08/kWh

    # Fleet health
    sites_with_alerts = len(set(alert_sites) & set(sites_df['SITE_ID'].tolist()))
    fleet_health = ((total_sites - sites_with_alerts) / total_sites * 100) if total_sites > 0 else 100

    # Availability (capacity weighted)
    availability = ((total_capacity - total_kw_offline) / total_capacity * 100) if total_capacity > 0 else 100

    return {
        "kpis": {
            "fleet_health_pct": round(fleet_health, 1),
            "availability_pct": round(availability, 1),
            "total_sites": total_sites,
            "sites_with_issues": sites_with_alerts,
            "total_capacity_mw": round(total_capacity / 1000, 2),
            "capacity_offline_mw": round(total_kw_offline / 1000, 3),
            "total_alerts": alert_summary.get('TOTAL_ALERTS', 0) or 0,
            "confirmed_alerts": alert_summary.get('CONFIRMED', 0) or 0,
            "site_offline_count": alert_summary.get('SITE_OFFLINE', 0) or 0,
            "inverter_offline_count": alert_summary.get('INVERTER_OFFLINE', 0) or 0,
            "daily_revenue_loss_usd": round(daily_revenue_loss, 2),
            "monthly_revenue_loss_usd": round(daily_revenue_loss * 30, 2)
        },
        "period_days": days,
        "stage": stage,
        "generated_at": datetime.now().isoformat()
    }


# =============================================================================
# Run Server
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    print("\n" + "=" * 60)
    print("Chiron APM - Asset Performance Management Platform")
    print("=" * 60)
    print("\nStarting server at http://localhost:8000")
    print("API docs at http://localhost:8000/docs")
    print("Press Ctrl+C to stop\n")

    uvicorn.run(app, host="0.0.0.0", port=8000)
