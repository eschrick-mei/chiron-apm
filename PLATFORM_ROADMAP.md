# Chiron APM — Platform Implementation Roadmap

**Date**: 2026-03-27
**Focus**: Performance monitoring platform (separate from detection pipeline)
**Users**: Small team (3-5 concurrent), scaling to 1,000 assets
**Goals**: Minimize loading times, eliminate redundant recalculation, multi-user support

---

## Design Principle: Separation of Concerns

```
DETECTION SYSTEM (pipeline)              PERFORMANCE PLATFORM (web app)
─────────────────────────────            ──────────────────────────────
Runs on schedule (hourly/daily)          Serves real-time dashboard
Writes to CHIRON_ALERTS                  Reads from Snowflake tables
Writes detection logs                    Reads from Redis cache
Calls DAS APIs for verification          Never calls DAS APIs directly*
No user interaction                      Multi-user with auth

         ┌─────────────────────┐
         │    SNOWFLAKE         │
         │  HOURLY_DATA_LIVE    │
         │  DAILY_DATA_LIVE     │
         │  CHIRON_ALERTS       │
         │  SITE_MASTER         │
         │  ASSET_REGISTRY      │
         └─────────────────────┘
                   ▲
                   │ (shared data layer)
                   ▼
         ┌─────────────────────┐
         │      REDIS           │
         │  Fleet summary cache │
         │  Site details cache  │
         │  Alert stats cache   │
         └─────────────────────┘

* Exception: alert verification button still calls DAS API on-demand
```

---

## Priority Implementation Order

### PHASE 1 — Backend Infrastructure (Foundation)
> Goal: Support multiple concurrent users without blocking or stale data

| # | Item | Impact | Effort |
|---|------|--------|--------|
| P1.1 | **Async I/O wrapper** — Wrap all `execute_query()` calls in `asyncio.to_thread()` so one slow query doesn't block all routes | CRITICAL | Small |
| P1.2 | **Query timeouts** — Add `network_timeout=30` to Snowflake connector, FastAPI middleware for 15s route timeout | HIGH | Small |
| P1.3 | **Multi-worker deployment** — gunicorn config, CORS for real domains, startup script | HIGH | Small |
| P1.4 | **Redis shared cache** — Replace per-process `cachetools.TTLCache` with Redis. All workers share one cache | HIGH | Medium |
| P1.5 | **Pre-computed fleet data** — Background refresh task that pre-warms cache every 60s instead of computing on first request | HIGH | Medium |
| P1.6 | **Simple JWT auth** — Login endpoint, JWT middleware, user identity on actions. Roles: viewer/operator/admin | MEDIUM | Medium |

### PHASE 2 — Frontend Core UX
> Goal: Make the platform usable and fast for 1,000 assets

| # | Item | Impact | Effort |
|---|------|--------|--------|
| P2.1 | **Navigation restructure** — Merge Priority+Alerts into "Active Issues", cleaner hierarchy | HIGH | Small |
| P2.2 | **Fleet table view** — Virtual-scrolled table (react-virtual) as primary fleet view. Handles 1,000 sites without DOM bloat | HIGH | Medium |
| P2.3 | **Smart preset filters** — "Needs Attention", "Revenue at Risk", "Stale Data", "Chronic Issues" as one-click presets | MEDIUM | Small |
| P2.4 | **Active Issues view** — Unified alert+priority view with grouped alerts, actions, severity sorting | HIGH | Large |
| P2.5 | **Collapsible sidebar** — Icon-only rail mode to maximize content area | MEDIUM | Small |

### PHASE 3 — Deep Analysis Views
> Goal: Actionable site-level diagnostics

| # | Item | Impact | Effort |
|---|------|--------|--------|
| P3.1 | **Site Deep Dive tabs** — Overview / Inverters / Performance / Alerts / Financials | HIGH | Medium |
| P3.2 | **Performance analyzer integration** — Display root causes, loss waterfall, PR regression from backend analyzer | MEDIUM | Medium |
| P3.3 | **Alert detail enhancement** — Production chart overlay, verification timeline, similar past issues | MEDIUM | Medium |

### PHASE 4 — Collaboration & Reporting
> Goal: Team workflow features

| # | Item | Impact | Effort |
|---|------|--------|--------|
| P4.1 | **CSV/Excel export** — Export from all table views (extend existing Performance export) | MEDIUM | Small |
| P4.2 | **Alert acknowledgment** — "I'm on it" button with user identity, notes field | MEDIUM | Small |
| P4.3 | **In-app notifications** — Bell icon, unread count, toast for new critical alerts | MEDIUM | Medium |
| P4.4 | **Activity feed** — Timeline of user and system actions | LOW | Medium |
| P4.5 | **Executive summary page** — Fleet capacity %, YTD vs forecast, revenue at risk | MEDIUM | Medium |

---

## Backend Architecture After Changes

```
                    ┌───────────────────┐
                    │   NGINX / LB       │
                    └────────┬──────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         ┌─────────┐   ┌─────────┐   ┌─────────┐
         │Worker 1 │   │Worker 2 │   │Worker 3 │
         │(uvicorn)│   │(uvicorn)│   │(uvicorn)│
         └────┬────┘   └────┬────┘   └────┬────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────┴────────┐
                    │   REDIS CACHE    │
                    │  (shared state)  │
                    └────────┬────────┘
                             │ (cache miss)
                    ┌────────┴────────┐
                    │   SNOWFLAKE      │
                    │  (async queries) │
                    └─────────────────┘
```

**Request lifecycle:**
1. Route handler (async) receives request
2. Check Redis cache (shared across all workers)
3. Cache hit → return immediately (~1ms)
4. Cache miss → `asyncio.to_thread(snowflake_query)` (non-blocking)
5. Store result in Redis with TTL
6. Return response

**Cache TTLs:**
| Data | TTL | Reason |
|------|-----|--------|
| Fleet summary | 60s | Changes with each detection run |
| Site list | 300s | Sites rarely added/removed |
| Active alerts | 30s | Must be responsive to new detections |
| Site details | 300s | Metadata rarely changes |
| Equipment | 300s | Equipment rarely changes |
| PPA rates | 86400s | Monthly data |
| Forecasts | 86400s | Monthly data |
| Heatmap data | 120s | Hourly data, moderate freshness needed |
| Fleet matrix | 30s | Real-time view, needs freshness |

---

## File Changes Summary

### New Files
- `backend/cache.py` — Redis cache wrapper
- `backend/auth.py` — JWT auth middleware + user model
- `backend/gunicorn.conf.py` — Multi-worker configuration
- `frontend/src/app/issues/page.tsx` — Active Issues view
- `frontend/src/components/dashboard/FleetTable.tsx` — Virtual-scrolled table

### Modified Files
- `backend/main.py` — Add auth middleware, async wrappers, timeout middleware
- `backend/data_service.py` — Replace cachetools with Redis, add async support
- `backend/requirements.txt` — Add redis, PyJWT, gunicorn
- `frontend/src/components/layout/Sidebar.tsx` — Restructured nav, collapsible
- `frontend/src/app/page.tsx` — Fleet overview with table toggle
- `frontend/src/hooks/useFleetData.ts` — Add auth headers, new hooks
- `frontend/src/lib/api.ts` — Add auth token handling
- `frontend/src/app/sites/page.tsx` — Tabbed deep dive layout
- `frontend/package.json` — Add @tanstack/react-virtual
