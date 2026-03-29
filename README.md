# Chiron Analytics v2

A modern, high-performance solar portfolio monitoring dashboard built with Next.js 14, FastAPI, and Tremor.

## Architecture

```
chiron_analytics_v2/
├── backend/                 # FastAPI server
│   ├── main.py             # API endpoints
│   ├── data_service.py     # Data access layer with caching
│   └── requirements.txt    # Python dependencies
│
├── frontend/               # Next.js 14 application
│   ├── src/
│   │   ├── app/           # App Router pages
│   │   │   ├── page.tsx   # Fleet Command dashboard
│   │   │   ├── sites/     # Sites Deep-Dive
│   │   │   ├── alerts/    # Alert Monitoring
│   │   │   └── equipment/ # Equipment Explorer
│   │   ├── components/    # React components
│   │   ├── hooks/         # Custom React hooks
│   │   ├── lib/           # Utilities and API client
│   │   └── types/         # TypeScript definitions
│   ├── package.json
│   └── tailwind.config.ts
│
└── README.md
```

## Technology Stack

### Frontend
- **Next.js 14** - React framework with App Router
- **TypeScript** - Type safety
- **Tailwind CSS** - Utility-first styling
- **Tremor** - Beautiful dashboard components & charts
- **TanStack Query** - Data fetching with caching
- **Lucide React** - Modern icons

### Backend
- **FastAPI** - High-performance Python API
- **ORjson** - Fast JSON serialization
- **Cachetools** - TTL-based caching
- **Snowflake Connector** - Database connection

## Features

### Fleet Command (Dashboard)
- Real-time fleet health KPIs
- Interactive site grid with status indicators
- Site detail panel with charts and alerts
- Search and filter by DAS provider/status

### Sites Deep-Dive
- Sites ranked by estimated kW offline
- Performance Ratio tracking with weather adjustment
- PR and Availability trend charts
- Active alerts summary

### Alert Monitoring
- Alert statistics with charts (by type, timeline, top sites)
- Advanced filtering (days, status, type, verification)
- Expandable alert rows with details
- Real-time verification button

### Equipment Explorer
- Hierarchical equipment view by type
- Live equipment values from DAS
- Visual status indicators (online/offline)
- Search across all sites

## Quick Start

### Backend

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run server
python main.py
# Server starts at http://localhost:8000
# API docs at http://localhost:8000/docs
```

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local

# Run development server
npm run dev
# Opens at http://localhost:3000
```

## API Endpoints

### Fleet
- `GET /api/fleet/summary` - Fleet KPIs
- `GET /api/fleet/sites` - List sites with filters
- `GET /api/fleet/das-options` - DAS providers

### Sites
- `GET /api/sites/{site_id}` - Site details + equipment + alerts
- `GET /api/sites/{site_id}/heatmap` - Inverter heatmap data
- `GET /api/sites/{site_id}/metrics` - Production metrics
- `GET /api/sites/{site_id}/performance` - Performance ratio

### Alerts
- `GET /api/alerts` - Alerts with filters
- `GET /api/alerts/stats` - Alert statistics
- `GET /api/alerts/{alert_id}/detail` - Alert detail data
- `POST /api/alerts/{alert_id}/verify` - Real-time verification

### Analytics
- `GET /api/analytics/sites` - Site analytics summary

### Equipment
- `GET /api/equipment/{site_id}` - Site equipment hierarchy

## Design Principles

### Performance
- **Server-side rendering** for fast initial load
- **Client-side caching** with TanStack Query
- **TTL caching** in backend for expensive queries
- **Optimistic updates** for better UX

### User Experience
- **Dark theme** optimized for monitoring
- **Real-time updates** with auto-refresh
- **Responsive design** for all screen sizes
- **Smooth animations** and transitions

### Code Quality
- **TypeScript** throughout for type safety
- **Component-based** architecture
- **Consistent styling** with Tailwind
- **Clean API** design with FastAPI

## Comparison with v1 (Dash)

| Feature | v1 (Dash) | v2 (Next.js) |
|---------|-----------|--------------|
| Framework | Python Dash | Next.js 14 |
| Rendering | Server-only | SSR + Client |
| Caching | None | TanStack Query + Backend TTL |
| Charts | Plotly | Tremor/Recharts |
| Styling | Custom CSS | Tailwind CSS |
| Type Safety | No | Yes (TypeScript) |
| Bundle Size | Large | Optimized |
| Hot Reload | Slow | Instant |

## Development

### Adding a new page

1. Create route folder in `src/app/{route}/`
2. Add `page.tsx` with the page component
3. Add navigation link in `Sidebar.tsx`
4. Create necessary hooks in `hooks/`
5. Add API endpoint in backend `main.py`

### Code Style

- Use functional components with hooks
- Prefer `const` over `let`
- Use TypeScript strict mode
- Follow Tailwind class ordering

## License

Proprietary - MEI Internal Use Only
