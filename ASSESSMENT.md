# CHIRON APM — Enterprise Assessment & Roadmap

**Date**: 2026-03-27
**Scope**: Full platform assessment for scaling to 1,000+ assets with multiple concurrent users

---

## Current State

CHIRON is a monitoring platform with two main components:
1. **Detection Pipeline** (`CHIRON_MONITORING/`) — Autonomous outage detection, verification, alerting
2. **Performance Platform** (`Chiron_APM/`) — Next.js + FastAPI dashboard for fleet monitoring

**Stack**: Next.js 14 (App Router) + FastAPI + Snowflake + React Query + Tremor/Recharts

---

## 1. INFRASTRUCTURE & ARCHITECTURE

### 1A. Database Layer — Snowflake Optimization

| # | Change | Status | Details |
|---|--------|--------|---------|
| 1A.1 | Materialized summary tables (`FLEET_SUMMARY_LIVE`, `SITE_SUMMARY_LIVE`) | [ ] | Create pre-aggregated tables updated every 5-15 min. Dashboard reads these instead of aggregating HOURLY_DATA_LIVE per request |
| 1A.2 | Redis/Valkey shared cache layer | [x] | Replace per-process cachetools with shared Redis. Fleet summary (60s TTL), site details (5min), alerts (30s) |
| 1A.3 | Snowflake connection pooling | [ ] | Use pooling (min=2, max=10). Prevents connection exhaustion under concurrent load |
| 1A.4 | Separate warehouses (detection vs dashboard) | [ ] | `CHIRON_DETECTION_WH` for pipeline, `CHIRON_DASHBOARD_WH` for web app |
| 1A.5 | Query timeouts | [x] | `network_timeout=30`, `socket_timeout=60` on Snowflake. FastAPI middleware to timeout routes at 30s |

### 1B. Backend Architecture

| # | Change | Status | Details |
|---|--------|--------|---------|
| 1B.1 | Async database access | [x] | Wrap `execute_query()` in `asyncio.to_thread()` via `run_sync()` helper |
| 1B.2 | Background task queue (Celery/arq) | [ ] | Long-running pipeline tasks shouldn't block web server |
| 1B.3 | Multi-worker deployment | [x] | `gunicorn -k uvicorn.workers.UvicornWorker -w 4` via gunicorn.conf.py |
| 1B.4 | Authentication & RBAC | [x] | JWT auth with admin/operator/viewer roles. File-based user store, disabled by default |
| 1B.5 | API rate limiting | [ ] | `slowapi` at 100 req/min per user. Frontend stale-while-revalidate instead of hard polling |
| 1B.6 | WebSocket for real-time | [ ] | `/ws/fleet` pushes deltas (new alerts, status changes). Replace polling |

### 1C. Detection Pipeline Scaling

| # | Change | Status | Details |
|---|--------|--------|---------|
| 1C.1 | Parallel site processing | [ ] | ThreadPoolExecutor(max_workers=10) for verification API calls |
| 1C.2 | Bulk detection query | [ ] | Single GROUP BY query instead of 1,000 per-site queries |
| 1C.3 | Incremental detection | [ ] | Only scan sites with anomalous or stale data |
| 1C.4 | DAS API rate management | [ ] | Per-DAS token bucket rate limiter, priority-based verification queue |

### 1D. Deployment & DevOps

| # | Change | Status | Details |
|---|--------|--------|---------|
| 1D.1 | Containerize (Docker) | [ ] | Dockerfiles for pipeline + web backend. docker-compose for local dev |
| 1D.2 | Cloud deployment | [ ] | ECS Fargate / Cloud Run for backend, scheduled Lambda/Cloud Function for detection |
| 1D.3 | CI/CD pipeline | [ ] | GitHub Actions: lint → test → build → deploy |
| 1D.4 | Secrets management | [ ] | AWS Secrets Manager or Vault. No credentials in config.json |
| 1D.5 | Health monitoring | [ ] | Prometheus metrics, Grafana dashboard, PagerDuty for backend failures |
| 1D.6 | Structured logging | [ ] | JSON structured logging with request/correlation IDs |

---

## 2. LOGIC & DETECTION IMPROVEMENTS

### 2A. Detection Quality

| # | Change | Status | Details |
|---|--------|--------|---------|
| 2A.1 | Reduce 94% inconclusive rate | [ ] | Audit DAS credentials, add Snowflake-only fallback verification |
| 2A.2 | Site-level rollup | [ ] | >80% inverters offline → classify as site outage, suppress individual alerts |
| 2A.3 | Chronic vs acute separation | [ ] | `chronic_threshold_hours: 168` (7d). Separate category, lower severity |
| 2A.4 | Nighttime false positive fix | [ ] | Tighten to 8AM-5PM, dynamic irradiance threshold (>100 W/m² for 2+ hours) |
| 2A.5 | Confidence model upgrade | [ ] | Historical frequency, weather, peer comparison, data freshness → 0-100 score |

### 2B. New Detection Modules

| # | Module | Status | Priority | Details |
|---|--------|--------|----------|---------|
| 2B.1 | Underperformance scanner | [ ] | HIGH | Daily: flag sites with 7-day WA_PR < 80% and declining |
| 2B.2 | Communication loss detector | [ ] | HIGH | Flag sites with data > 4 hours old |
| 2B.3 | Meter-inverter divergence | [ ] | MEDIUM | VARIANCE_METER_INV > 15% for 3+ days |
| 2B.4 | String-level analysis | [ ] | MEDIUM | BinData combiner currents for partial failures |
| 2B.5 | Clipping detection | [ ] | LOW-MED | Production plateau at AC nameplate during high irradiance |

### 2C. Alert Lifecycle

| # | Change | Status | Details |
|---|--------|--------|---------|
| 2C.1 | Alert acknowledgment workflow | [ ] | ACKNOWLEDGED status with who/when/notes |
| 2C.2 | Ticket integration | [ ] | Auto-create tickets on confirmed alerts |
| 2C.3 | Escalation rules | [ ] | Unacknowledged CRITICAL > 4h → escalate |
| 2C.4 | Alert grouping | [ ] | Related alerts as single grouped issue |
| 2C.5 | Resolution tracking | [ ] | Calculate downtime, energy loss, revenue loss on resolution |

---

## 3. VISUAL & UX — DASHBOARD

### 3A. Navigation Redesign

| # | Change | Status | Details |
|---|--------|--------|---------|
| 3A.1 | Reorganize sidebar into 3 sections | [x] | OPERATIONS (daily), ANALYSIS (drill-down), MANAGEMENT (admin) |
| 3A.2 | Reduce from 11 pages to ~9 with clear hierarchy | [x] | Merged alerts + priority into "Active Issues" |

### 3B. Fleet Overview Redesign

| # | Change | Status | Details |
|---|--------|--------|---------|
| 3B.1 | Status bar (horizontal segment bar) | [x] | Clickable segments: Healthy / Active Issues / Critical / No Data |
| 3B.2 | Map view (primary) | [ ] | Geographic markers colored by status, clustered at zoom |
| 3B.3 | Table view with virtual scrolling | [x] | @tanstack/react-virtual for 1,000 rows, sortable columns |
| 3B.4 | Replace card grid with map + table toggle | [x] | Table (default) + Grid toggle; card grid kept as secondary view |
| 3B.5 | Smart preset filters | [x] | Needs Attention, Revenue at Risk, Stale Data, Critical presets |

### 3C. Active Issues View

| # | Change | Status | Details |
|---|--------|--------|---------|
| 3C.1 | Unified issues view (alerts + priority merged) | [x] | Merged alerts + priority with enriched data, preset filters |
| 3C.2 | Summary strip with trend arrows | [x] | KPI strip: Fleet Health, Confirmed, Critical, High, Capacity Offline, Revenue Loss |
| 3C.3 | Expandable issue rows | [x] | Detection details, impact metrics, action links |
| 3C.4 | Action buttons | [~] | Verify now implemented; Acknowledge, Ticket, Dismiss pending |
| 3C.5 | Issue detail panel | [ ] | Production chart + verification timeline + past issues + recommended action |

### 3D. Site Deep Dive Enhancement

| # | Change | Status | Details |
|---|--------|--------|---------|
| 3D.1 | Tab-based layout | [x] | Overview / Inverters / Performance / Alerts / Financials tabs |
| 3D.2 | Inverter drill-down with peer comparison | [ ] | Click individual inverter → trend + peer chart |
| 3D.3 | Performance analyzer integration | [ ] | Root cause indicators, loss waterfall, PR regression |
| 3D.4 | Alert history with resolution metrics | [~] | Alert history tab with 30-day history; resolution metrics pending |
| 3D.5 | Financial tab | [x] | Revenue loss, lost energy, projected annual loss |

### 3E. Reporting & Export

| # | Change | Status | Details |
|---|--------|--------|---------|
| 3E.1 | Fleet Health Report (weekly PDF) | [ ] | Fleet PR, availability, top issues, revenue impact |
| 3E.2 | Site Performance Report (monthly) | [ ] | Per-site PR trend, equipment health, loss breakdown |
| 3E.3 | Executive Dashboard page | [ ] | Fleet capacity %, revenue at risk, YTD vs forecast |
| 3E.4 | CSV/Excel export from all views | [x] | Reports page with Fleet KPI, Alert History, Revenue Impact CSV exports |

### 3F. Notifications & Collaboration

| # | Change | Status | Details |
|---|--------|--------|---------|
| 3F.1 | Email digest (daily summary) | [ ] | New alerts, resolved, top revenue-at-risk sites |
| 3F.2 | Slack/Teams integration | [ ] | Post critical alerts, acknowledge from Slack |
| 3F.3 | In-app notifications | [x] | Notifications page with alert feed, severity badges, unread indicators |
| 3F.4 | Alert assignment | [ ] | Assign alerts to team members |
| 3F.5 | Activity feed | [ ] | Timeline of all user/system actions |

### 3G. Mobile & Responsiveness

| # | Change | Status | Details |
|---|--------|--------|---------|
| 3G.1 | Collapsible sidebar | [x] | Toggles between 64px collapsed and 256px expanded with icon rail |
| 3G.2 | Responsive detail panel | [ ] | Full-screen overlay on mobile |
| 3G.3 | PWA support | [ ] | Service worker, push notifications |
| 3G.4 | Mobile-first alert view | [ ] | Simplified cards, swipe to acknowledge |

---

## Implementation Phases

### Phase 1 — Foundation
- [ ] 2A.1 Fix inconclusive rate
- [ ] 2A.2 Site-level rollup
- [ ] 2A.3 Chronic vs acute separation
- [x] 1A.2 Redis cache layer
- [x] 1B.1 Async database I/O

### Phase 2 — Scale
- [ ] 1C.2 Bulk detection query
- [ ] 1C.1 Parallel verification
- [ ] 1B.6 WebSocket push
- [x] 1B.4 Authentication + RBAC
- [ ] 1D.1 Containerize
- [ ] 3B.2 Map view

### Phase 3 — Intelligence
- [ ] 2B.1 Underperformance scanner
- [ ] 2B.2 Communication loss detector
- [ ] 2C.1 Alert acknowledgment workflow
- [ ] 3E.1 Reporting engine
- [ ] 2A.5 Confidence model upgrade
- [ ] 3D.3 Performance analyzer integration

### Phase 4 — Enterprise Polish
- [ ] 3F.1-3F.5 Notification system
- [ ] 3G.1-3G.4 Mobile PWA
- [ ] 2B.4 String-level analysis
- [ ] 3E.3 Executive dashboard
- [ ] 3F.5 Activity feed
