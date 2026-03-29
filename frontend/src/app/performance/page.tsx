"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/Header";
import {
  useFleetKPIs,
  useSitePerformance,
  useStringAnalysis,
  useSiteHeatmap,
  useSiteMetrics,
} from "@/hooks/useFleetData";
import { formatNumber, cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  Award,
  BarChart3,
  Search,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Zap,
  Sun,
  Calendar,
  Activity,
  Target,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Thermometer,
  Table2,
  LineChart,
  Grid3X3,
  X,
  Filter,
  Download,
  Gauge,
  Battery,
  CloudSun,
  ScatterChart as ScatterChartIcon,
  FileSpreadsheet,
  PieChart,
  ExternalLink,
} from "lucide-react";
import {
  Card,
  Title,
  BarChart,
  Badge,
  ProgressBar,
  AreaChart,
  DonutChart,
} from "@tremor/react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import type { SiteKPI } from "@/types";

// =============================================================================
// KPI Table Column Configuration
// =============================================================================

type SortField = keyof SiteKPI | null;
type SortDirection = "asc" | "desc";

interface KPIColumn {
  key: string;
  label: string;
  width: string;
  sortable: boolean;
  highlight?: boolean;
}

// =============================================================================
// Export Utility Functions
// =============================================================================

function exportToCSV(data: SiteKPI[], filename: string) {
  const headers = [
    "Rank", "Site ID", "Site Name", "Size (kW DC)", "WA PR (%)", "Raw PR (%)",
    "Insol Gap (%)", "Availability (%)", "Rev Impact ($)", "Smart Prod (kWh)",
    "Meter (kWh)", "Inverter (kWh)", "Specific Yield (kWh/kWp)", "Data Quality",
    "Capacity Factor (%)", "BESS Site", "Data Quality Flags"
  ];

  const rows = data.map(site => [
    site.rank,
    site.site_id,
    `"${site.site_name || ''}"`,
    site.size_kw_dc,
    site.pr_weather_adjusted != null ? site.pr_weather_adjusted.toFixed(1) : '',
    site.pr_raw != null ? site.pr_raw.toFixed(1) : '',
    site.insolation_gap != null ? site.insolation_gap.toFixed(1) : '',
    site.availability_pct != null ? site.availability_pct.toFixed(1) : '',
    site.variance_wa_revenue != null ? site.variance_wa_revenue.toFixed(2) : '',
    site.smart_production_kwh != null ? site.smart_production_kwh.toFixed(0) : '',
    site.meter_production_kwh != null ? site.meter_production_kwh.toFixed(0) : '',
    site.inverter_production_kwh != null ? site.inverter_production_kwh.toFixed(0) : '',
    site.specific_yield_kwh_kwp != null ? site.specific_yield_kwh_kwp.toFixed(2) : '',
    site.data_quality,
    site.capacity_factor_pct != null ? site.capacity_factor_pct.toFixed(1) : '',
    site.is_bess_site ? 'Yes' : 'No',
    `"${site.data_quality_flags?.join('; ') || ''}"`
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// =============================================================================
// Fleet Distribution Component (Histogram)
// =============================================================================

function FleetDistributionChart({ kpis, onBucketClick }: {
  kpis: SiteKPI[];
  onBucketClick?: (min: number, max: number) => void;
}) {
  const distribution = useMemo(() => {
    const buckets = [
      { range: '< 50%', min: 0, max: 50, count: 0, color: 'red' },
      { range: '50-60%', min: 50, max: 60, count: 0, color: 'red' },
      { range: '60-70%', min: 60, max: 70, count: 0, color: 'orange' },
      { range: '70-80%', min: 70, max: 80, count: 0, color: 'amber' },
      { range: '80-85%', min: 80, max: 85, count: 0, color: 'yellow' },
      { range: '85-90%', min: 85, max: 90, count: 0, color: 'lime' },
      { range: '90-95%', min: 90, max: 95, count: 0, color: 'emerald' },
      { range: '95-100%', min: 95, max: 100, count: 0, color: 'green' },
      { range: '> 100%', min: 100, max: 150, count: 0, color: 'teal' },
    ];

    kpis.forEach(site => {
      const pr = site.pr_weather_adjusted;
      if (pr === null || pr === undefined) return;
      const bucket = buckets.find(b => pr >= b.min && pr < b.max);
      if (bucket) bucket.count++;
      else if (pr >= 150) buckets[buckets.length - 1].count++; // overflow to > 100%
    });

    return buckets;
  }, [kpis]);

  const maxCount = Math.max(...distribution.map(d => d.count), 1);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <PieChart className="h-4 w-4 text-chiron-accent-purple" />
        <span className="text-sm font-medium text-chiron-text-secondary">WA PR Distribution</span>
        <span className="text-xs text-chiron-text-muted ml-auto">
          {kpis.filter(k => k.pr_weather_adjusted !== null).length} sites with data
        </span>
      </div>
      <div className="space-y-1.5">
        {distribution.map((bucket) => {
          const pct = (bucket.count / maxCount) * 100;
          const colorClass =
            bucket.color === 'red' ? 'bg-red-500' :
            bucket.color === 'orange' ? 'bg-orange-500' :
            bucket.color === 'amber' ? 'bg-amber-500' :
            bucket.color === 'yellow' ? 'bg-yellow-500' :
            bucket.color === 'lime' ? 'bg-lime-500' :
            bucket.color === 'emerald' ? 'bg-emerald-500' :
            bucket.color === 'green' ? 'bg-green-500' : 'bg-teal-500';

          return (
            <div
              key={bucket.range}
              className="flex items-center gap-2 cursor-pointer hover:bg-chiron-bg-tertiary/30 rounded px-1 py-0.5"
              onClick={() => onBucketClick?.(bucket.min, bucket.max)}
              title={`Click to filter: ${bucket.range}`}
            >
              <span className="w-16 text-xs text-chiron-text-muted text-right">{bucket.range}</span>
              <div className="flex-1 h-4 bg-chiron-bg-tertiary/50 rounded-sm overflow-hidden">
                <div
                  className={cn(colorClass, "h-full transition-all")}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-8 text-xs text-chiron-text-secondary text-right font-mono">
                {bucket.count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const KPI_COLUMNS: KPIColumn[] = [
  { key: "rank", label: "#", width: "w-10", sortable: true },
  { key: "site_id", label: "Site ID", width: "w-28", sortable: true },
  { key: "site_name", label: "Name", width: "w-36", sortable: true },
  { key: "size_kw_dc", label: "DC kW", width: "w-18", sortable: true },
  { key: "pr_weather_adjusted", label: "WA PR%", width: "w-20", sortable: true, highlight: true },
  { key: "pr_raw", label: "PR%", width: "w-14", sortable: true },
  { key: "insolation_gap", label: "Insol Gap", width: "w-20", sortable: true },
  { key: "availability_pct", label: "Avail%", width: "w-16", sortable: true },
  { key: "variance_wa_revenue", label: "Rev Impact", width: "w-20", sortable: true },
  { key: "smart_production_kwh", label: "Prod kWh", width: "w-22", sortable: true },
  { key: "meter_production_kwh", label: "Meter", width: "w-20", sortable: true },
  { key: "inverter_production_kwh", label: "Inv", width: "w-20", sortable: true },
  { key: "specific_yield_kwh_kwp", label: "kWh/kWp", width: "w-18", sortable: true },
  { key: "data_quality", label: "Quality", width: "w-18", sortable: true },
];

// =============================================================================
// Inverter Heatmap Component
// =============================================================================

function InverterHeatmap({ siteId }: { siteId: string }) {
  const { data: heatmapData, isLoading } = useSiteHeatmap(siteId, 7);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <RefreshCw className="h-6 w-6 text-chiron-accent-teal animate-spin" />
      </div>
    );
  }

  if (!heatmapData || heatmapData.inverters.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-chiron-text-muted">
        <span>No heatmap data available</span>
      </div>
    );
  }

  // Only show last 48 hours for readability
  const timestamps = heatmapData.timestamps.slice(-48);
  const startIdx = heatmapData.timestamps.length - 48;

  const getColor = (cf: number) => {
    if (cf >= 80) return "bg-emerald-500";
    if (cf >= 60) return "bg-emerald-400/80";
    if (cf >= 40) return "bg-amber-400";
    if (cf >= 20) return "bg-amber-500/80";
    if (cf > 0) return "bg-orange-500/60";
    return "bg-slate-700/50";
  };

  return (
    <div className="overflow-x-auto">
      <div className="min-w-max">
        {/* Header row with timestamps */}
        <div className="flex gap-0.5 mb-1 pl-16">
          {timestamps.map((ts, i) => (
            <div
              key={ts}
              className="w-3 h-6 flex items-end justify-center"
              title={ts}
            >
              {i % 6 === 0 && (
                <span className="text-[8px] text-chiron-text-muted rotate-[-60deg] origin-bottom-left whitespace-nowrap">
                  {ts.split(" ")[1]?.slice(0, 5) || ""}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Heatmap rows */}
        {heatmapData.inverters.map((inv, invIdx) => (
          <div key={inv} className="flex gap-0.5 mb-0.5">
            <div className="w-14 flex-shrink-0 text-xs text-chiron-text-secondary text-right pr-2 py-0.5">
              {inv}
            </div>
            {timestamps.map((ts, tsIdx) => {
              const cfValue = heatmapData.data[invIdx]?.[startIdx + tsIdx] || 0;
              return (
                <div
                  key={`${inv}-${ts}`}
                  className={cn(
                    "w-3 h-4 rounded-sm transition-colors",
                    getColor(cfValue)
                  )}
                  title={`${inv} @ ${ts}: ${cfValue.toFixed(0)}% CF`}
                />
              );
            })}
          </div>
        ))}

        {/* Legend */}
        <div className="flex items-center gap-4 mt-4 text-xs text-chiron-text-muted">
          <span>Capacity Factor:</span>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-emerald-500" />
            <span>≥80%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-amber-400" />
            <span>40-60%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-orange-500/60" />
            <span>1-20%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-slate-700/50" />
            <span>0%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Site Performance Chart Component
// =============================================================================

function SitePerformanceChart({ siteId }: { siteId: string }) {
  const { data: metricsData, isLoading } = useSiteMetrics(siteId, 7);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <RefreshCw className="h-6 w-6 text-chiron-accent-teal animate-spin" />
      </div>
    );
  }

  const metrics = metricsData?.data || [];
  if (metrics.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-chiron-text-muted">
        <span>No metrics data available</span>
      </div>
    );
  }

  // Format data for chart - show production, insolation
  const chartData = metrics.slice(-168).map((d) => ({
    time: String(d.MEASUREMENTTIME).slice(5, 16),
    Production: Number(d.METER_ENERGY || d.INV_TOTAL_ENERGY || 0),
    Insolation: Number(d.INSOLATION_POA || d.INSOLATION_GHI || 0) / 10, // Scale down for visibility
  }));

  return (
    <div>
      <AreaChart
        className="h-64"
        data={chartData}
        index="time"
        categories={["Production", "Insolation"]}
        colors={["teal", "amber"]}
        valueFormatter={(v) => `${formatNumber(v, 0)}`}
        showLegend={true}
        curveType="monotone"
      />
      <p className="text-xs text-chiron-text-muted mt-2 text-center">
        Production (kWh) and Insolation (W/m² ÷ 10) - Last 7 days
      </p>
    </div>
  );
}

// =============================================================================
// Site Detail Panel Component
// =============================================================================

function SiteDetailPanel({ site, onClose }: { site: SiteKPI; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<"overview" | "heatmap" | "chart">("overview");
  const { data: stringData, isLoading: stringLoading } = useStringAnalysis(site.site_id);

  const inverters = stringData?.inverters || [];

  // PR gauge color
  const prValue = site.pr_weather_adjusted || 0;
  const prColorClass = prValue >= 90 ? "text-emerald-400" : prValue >= 70 ? "text-amber-400" : "text-red-400";

  // Insolation gap color
  const insolGap = site.insolation_gap || 0;
  const insolGapColorClass = insolGap >= 5 ? "text-emerald-400" : insolGap >= 0 ? "text-green-400" : insolGap >= -5 ? "text-amber-400" : "text-red-400";

  return (
    <div className="h-full flex flex-col bg-chiron-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-chiron-accent-teal/20">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-chiron-accent-teal">{site.site_id}</h2>
            {site.is_bess_site && (
              <Badge color="purple" size="xs">BESS</Badge>
            )}
          </div>
          <p className="text-sm text-chiron-text-muted">{site.site_name}</p>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-chiron-bg-tertiary rounded-lg transition-colors"
        >
          <X className="h-5 w-5 text-chiron-text-muted" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-chiron-accent-teal/20">
        {[
          { key: "overview", label: "Overview", icon: Target },
          { key: "heatmap", label: "Inverter Heatmap", icon: Grid3X3 },
          { key: "chart", label: "Production Chart", icon: LineChart },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as typeof activeTab)}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
              activeTab === key
                ? "border-b-2 border-chiron-accent-teal text-chiron-accent-teal"
                : "text-chiron-text-muted hover:text-chiron-text-primary"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "overview" && (
          <div className="space-y-4">
            {/* KPI Summary Cards */}
            <div className="grid grid-cols-5 gap-3">
              <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20 !p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Gauge className="h-4 w-4 text-chiron-accent-teal" />
                  <span className="text-xs text-chiron-text-muted">WA PR</span>
                </div>
                <p className={cn("text-2xl font-bold", prColorClass)}>
                  {site.pr_weather_adjusted !== null ? `${formatNumber(site.pr_weather_adjusted, 1)}%` : "-"}
                </p>
              </Card>
              <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20 !p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Target className="h-4 w-4 text-blue-400" />
                  <span className="text-xs text-chiron-text-muted">Raw PR</span>
                </div>
                <p className="text-2xl font-bold text-blue-400">
                  {site.pr_raw !== null ? `${formatNumber(site.pr_raw, 1)}%` : "-"}
                </p>
              </Card>
              <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20 !p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Battery className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs text-chiron-text-muted">Availability</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <p className="text-2xl font-bold text-emerald-400">
                    {site.availability_pct !== null ? `${formatNumber(site.availability_pct, 1)}%` : "-"}
                  </p>
                  {site.availability_estimated && (
                    <span className="text-xs text-amber-400" title="Estimated from Capacity Factor">*</span>
                  )}
                </div>
              </Card>
              <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20 !p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Sun className="h-4 w-4 text-amber-400" />
                  <span className="text-xs text-chiron-text-muted">Insol Gap</span>
                </div>
                <p className={cn("text-2xl font-bold", insolGapColorClass)}>
                  {insolGap >= 0 ? "+" : ""}{formatNumber(insolGap, 0)}%
                </p>
                <p className="text-[10px] text-chiron-text-muted">
                  {insolGap >= 0 ? "Sunnier" : "Cloudier"}
                </p>
              </Card>
              <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20 !p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="h-4 w-4 text-purple-400" />
                  <span className="text-xs text-chiron-text-muted">Cap Factor</span>
                </div>
                <p className="text-2xl font-bold text-purple-400">
                  {site.capacity_factor_pct !== null ? `${formatNumber(site.capacity_factor_pct, 1)}%` : "-"}
                </p>
              </Card>
            </div>

            {/* Data Quality Flags */}
            {site.data_quality_flags && site.data_quality_flags.length > 0 && (
              <Card className="!bg-amber-900/20 !border-amber-500/30 !p-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  <span className="text-sm font-medium text-amber-400">Data Quality Flags</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {site.data_quality_flags.map((flag, idx) => (
                    <Badge key={idx} color="amber" size="xs">
                      {flag.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>
              </Card>
            )}

            {/* Production Details */}
            <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
              <Title className="!text-chiron-text-primary mb-4">Production Summary</Title>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-2 rounded bg-chiron-bg-tertiary/50">
                    <span className="text-sm text-chiron-text-secondary">Smart Production</span>
                    <span className="font-mono font-semibold text-chiron-accent-teal">
                      {formatNumber(site.smart_production_kwh, 0)} kWh
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded bg-chiron-bg-tertiary/50">
                    <span className="text-sm text-chiron-text-secondary">Meter Production</span>
                    <span className="font-mono text-chiron-text-primary">
                      {formatNumber(site.meter_production_kwh, 0)} kWh
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded bg-chiron-bg-tertiary/50">
                    <span className="text-sm text-chiron-text-secondary">Inverter Production</span>
                    <span className="font-mono text-chiron-text-primary">
                      {formatNumber(site.inverter_production_kwh, 0)} kWh
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded bg-chiron-bg-tertiary/50">
                    <span className="text-sm text-chiron-text-secondary">Production Source</span>
                    <Badge color={site.production_source === 'meter' ? 'blue' : site.production_source === 'inverter' ? 'purple' : 'slate'}>
                      {site.production_source}
                    </Badge>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-2 rounded bg-chiron-bg-tertiary/50">
                    <span className="text-sm text-chiron-text-secondary">Expected (Forecast)</span>
                    <span className="font-mono text-chiron-text-primary">
                      {formatNumber(site.expected_production_kwh, 0)} kWh
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded bg-chiron-bg-tertiary/50">
                    <span className="text-sm text-chiron-text-secondary">WA Expected</span>
                    <span className="font-mono text-chiron-text-primary">
                      {formatNumber(site.weather_adjusted_expected_kwh, 0)} kWh
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded bg-chiron-bg-tertiary/50">
                    <span className="text-sm text-chiron-text-secondary">Specific Yield</span>
                    <span className="font-mono text-chiron-text-primary">
                      {formatNumber(site.specific_yield_kwh_kwp, 2)} kWh/kWp
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded bg-chiron-bg-tertiary/50">
                    <span className="text-sm text-chiron-text-secondary">Capacity Factor</span>
                    <span className="font-mono text-chiron-text-primary">
                      {site.capacity_factor_pct !== null ? `${formatNumber(site.capacity_factor_pct, 1)}%` : "-"}
                    </span>
                  </div>
                </div>
              </div>
            </Card>

            {/* Factors */}
            <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
              <Title className="!text-chiron-text-primary mb-4">Adjustment Factors & Settings</Title>
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center p-3 rounded bg-chiron-bg-tertiary/50">
                  <Sun className="h-6 w-6 mx-auto mb-2 text-amber-400" />
                  <p className="text-xs text-chiron-text-muted">Insolation Gap</p>
                  <p className={cn("text-lg font-bold", insolGapColorClass)}>
                    {insolGap >= 0 ? "+" : ""}{formatNumber(insolGap, 1)}%
                  </p>
                  <p className="text-[10px] text-chiron-text-muted mt-1">
                    {insolGap >= 0 ? "Sunnier than forecast" : "Cloudier than forecast"}
                  </p>
                </div>
                <div className="text-center p-3 rounded bg-chiron-bg-tertiary/50">
                  <TrendingDown className="h-6 w-6 mx-auto mb-2 text-purple-400" />
                  <p className="text-xs text-chiron-text-muted">Degradation</p>
                  <p className="text-lg font-bold text-purple-400">
                    {formatNumber(site.degradation_factor * 100, 2)}%
                  </p>
                  <p className="text-[10px] text-chiron-text-muted mt-1">0.5%/year</p>
                </div>
                <div className="text-center p-3 rounded bg-chiron-bg-tertiary/50">
                  <Calendar className="h-6 w-6 mx-auto mb-2 text-cyan-400" />
                  <p className="text-xs text-chiron-text-muted">Years Since PTO</p>
                  <p className="text-lg font-bold text-cyan-400">
                    {formatNumber(site.years_since_pto, 1)} yrs
                  </p>
                </div>
                <div className="text-center p-3 rounded bg-chiron-bg-tertiary/50">
                  <Thermometer className="h-6 w-6 mx-auto mb-2 text-blue-400" />
                  <p className="text-xs text-chiron-text-muted">Irradiance Type</p>
                  <p className="text-lg font-bold text-blue-400">
                    {site.irradiance_type || "POA"}
                  </p>
                  <p className="text-[10px] text-chiron-text-muted mt-1">Preferred source</p>
                </div>
              </div>
            </Card>

            {/* Inverter Summary */}
            {!stringLoading && inverters.length > 0 && (
              <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
                <div className="flex items-center justify-between mb-4">
                  <Title className="!text-chiron-text-primary">Inverter Performance</Title>
                  <div className="flex gap-2">
                    <Badge color="emerald">{stringData?.summary?.best_performer} best</Badge>
                    <Badge color="red">{stringData?.summary?.worst_performer} worst</Badge>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <div className="text-center p-2 rounded bg-chiron-bg-tertiary/50">
                    <p className="text-xs text-chiron-text-muted">Avg CF</p>
                    <p className="text-lg font-bold text-chiron-accent-teal">
                      {formatNumber(stringData?.summary?.avg_capacity_factor || 0, 1)}%
                    </p>
                  </div>
                  <div className="text-center p-2 rounded bg-chiron-bg-tertiary/50">
                    <p className="text-xs text-chiron-text-muted">Inverters</p>
                    <p className="text-lg font-bold text-chiron-text-primary">{inverters.length}</p>
                  </div>
                  <div className="text-center p-2 rounded bg-chiron-bg-tertiary/50">
                    <p className="text-xs text-chiron-text-muted">Outliers</p>
                    <p className={cn("text-lg font-bold", (stringData?.summary?.outliers_count || 0) > 0 ? "text-amber-400" : "text-emerald-400")}>
                      {stringData?.summary?.outliers_count || 0}
                    </p>
                  </div>
                  <div className="text-center p-2 rounded bg-chiron-bg-tertiary/50">
                    <p className="text-xs text-chiron-text-muted">Issues</p>
                    <p className={cn("text-lg font-bold", (stringData?.summary?.total_issues || 0) > 0 ? "text-red-400" : "text-emerald-400")}>
                      {stringData?.summary?.total_issues || 0}
                    </p>
                  </div>
                </div>
                <BarChart
                  className="h-40"
                  data={inverters.slice(0, 20).map((inv) => ({
                    name: inv.inverter,
                    CF: inv.capacity_factor,
                  }))}
                  index="name"
                  categories={["CF"]}
                  colors={["indigo"]}
                  valueFormatter={(v) => `${formatNumber(v, 0)}%`}
                />
              </Card>
            )}
          </div>
        )}

        {activeTab === "heatmap" && (
          <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
            <div className="flex items-center gap-2 mb-4">
              <Grid3X3 className="h-5 w-5 text-chiron-accent-purple" />
              <Title className="!text-chiron-text-primary">Inverter Capacity Factor Heatmap (Last 48h)</Title>
            </div>
            <InverterHeatmap siteId={site.site_id} />
          </Card>
        )}

        {activeTab === "chart" && (
          <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
            <div className="flex items-center gap-2 mb-4">
              <LineChart className="h-5 w-5 text-chiron-accent-teal" />
              <Title className="!text-chiron-text-primary">Production & Insolation Trend</Title>
            </div>
            <SitePerformanceChart siteId={site.site_id} />
          </Card>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// KPI Table Row Component
// =============================================================================

function KPITableRow({
  site,
  isSelected,
  onClick,
  onDeepDive,
}: {
  site: SiteKPI;
  isSelected: boolean;
  onClick: () => void;
  onDeepDive: () => void;
}) {
  const waPR = site.pr_weather_adjusted;
  const rawPR = site.pr_raw;
  const avail = site.availability_pct;
  const insolGap = site.insolation_gap;

  const getPRColor = (pr: number | null) => {
    if (pr === null) return "text-chiron-text-muted";
    if (pr >= 95) return "text-emerald-400";
    if (pr >= 85) return "text-green-400";
    if (pr >= 70) return "text-amber-400";
    return "text-red-400";
  };

  // Insolation gap color: positive (sunnier) = green, negative (cloudier) = amber/red
  const getInsolGapColor = (gap: number | undefined) => {
    if (gap === undefined) return "text-chiron-text-muted";
    if (gap >= 10) return "text-emerald-400";
    if (gap >= 0) return "text-green-400";
    if (gap >= -10) return "text-amber-400";
    return "text-red-400";
  };

  // Check for data quality issues
  const hasDataIssues = site.data_quality_flags && site.data_quality_flags.length > 0;

  // Check if excluded from stats due to extreme values (only extreme HIGH is excluded now)
  const excludedFromStats = site.wa_pr_valid_for_stats === false;
  const hasExtremeHighWaPR = site.data_quality_flags?.some(f => f.includes('wa_pr_extreme_high'));

  return (
    <tr
      onClick={onClick}
      className={cn(
        "cursor-pointer transition-colors border-b border-chiron-bg-tertiary/50",
        isSelected
          ? "bg-chiron-accent-teal/10"
          : "hover:bg-chiron-bg-tertiary/50"
      )}
    >
      <td className="px-2 py-2 text-center">
        <span className={cn(
          "inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold",
          site.rank === 1 ? "bg-amber-500 text-white" :
          site.rank === 2 ? "bg-slate-400 text-white" :
          site.rank === 3 ? "bg-amber-700 text-white" :
          "bg-chiron-bg-tertiary text-chiron-text-secondary"
        )}>
          {site.rank <= 3 ? <Award className="h-3 w-3" /> : site.rank}
        </span>
      </td>
      <td className="px-2 py-2 font-mono text-xs text-chiron-text-primary">
        <div className="flex items-center gap-1">
          {site.site_id}
          {site.is_bess_site && (
            <span title="BESS Hybrid Site">
              <Battery className="h-3 w-3 text-purple-400" />
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeepDive();
            }}
            className="ml-1 p-0.5 rounded hover:bg-chiron-accent-teal/20 text-chiron-text-muted hover:text-chiron-accent-teal transition-colors"
            title="Open full performance analysis"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      </td>
      <td className="px-2 py-2 text-xs text-chiron-text-secondary truncate max-w-[140px]">{site.site_name}</td>
      <td className="px-2 py-2 text-xs text-chiron-text-primary text-right font-mono">
        {formatNumber(site.size_kw_dc, 0)}
      </td>
      <td className="px-2 py-2 text-right">
        <span
          className={cn(
            "font-mono font-bold text-sm",
            hasExtremeHighWaPR ? "text-amber-400/70 line-through" : getPRColor(waPR)
          )}
          title={excludedFromStats ? "Excluded from stats: " + (site.data_quality_flags?.join(", ") || "data quality issue") : undefined}
        >
          {waPR !== null ? `${formatNumber(waPR, 1)}%` : "-"}
          {hasExtremeHighWaPR && <span className="text-amber-400 no-underline ml-1">!</span>}
        </span>
      </td>
      <td className="px-2 py-2 text-right">
        <span className={cn("font-mono text-xs", getPRColor(rawPR))}>
          {rawPR !== null ? `${formatNumber(rawPR, 0)}%` : "-"}
        </span>
      </td>
      <td className="px-2 py-2 text-right">
        <span
          className={cn("font-mono text-xs cursor-help", getInsolGapColor(insolGap))}
          title="Insolation Gap: positive = sunnier, negative = cloudier"
        >
          {insolGap !== undefined ? `${insolGap >= 0 ? "+" : ""}${formatNumber(insolGap, 0)}%` : "-"}
        </span>
      </td>
      <td className="px-2 py-2 text-right">
        <span
          className={cn(
            "font-mono text-xs",
            avail !== null && avail >= 95 ? "text-emerald-400" : avail !== null && avail >= 85 ? "text-amber-400" : "text-red-400"
          )}
          title={site.availability_estimated ? "Estimated from Capacity Factor" : undefined}
        >
          {avail !== null ? `${formatNumber(avail, 0)}%` : "-"}
          {site.availability_estimated && <span className="text-[8px]">*</span>}
        </span>
      </td>
      <td className="px-2 py-2 text-right">
        <span
          className={cn(
            "font-mono text-xs",
            site.variance_wa_revenue === undefined ? "text-chiron-text-muted" :
            site.variance_wa_revenue >= 0 ? "text-emerald-400" :
            site.variance_wa_revenue >= -100 ? "text-amber-400" : "text-red-400"
          )}
          title={site.variance_wa_revenue !== undefined
            ? `Revenue variance from weather-adjusted expectation: $${formatNumber(site.variance_wa_revenue, 2)}`
            : "Revenue impact not available"}
        >
          {site.variance_wa_revenue !== undefined
            ? `${site.variance_wa_revenue >= 0 ? '+' : ''}$${formatNumber(site.variance_wa_revenue, 0)}`
            : "-"}
        </span>
      </td>
      <td className="px-2 py-2 text-right font-mono text-xs text-chiron-accent-teal">
        {formatNumber(site.smart_production_kwh, 0)}
      </td>
      <td className="px-2 py-2 text-right font-mono text-xs text-chiron-text-secondary">
        {formatNumber(site.meter_production_kwh, 0)}
      </td>
      <td className="px-2 py-2 text-right font-mono text-xs text-chiron-text-secondary">
        {formatNumber(site.inverter_production_kwh, 0)}
      </td>
      <td className="px-2 py-2 text-right font-mono text-xs text-chiron-text-primary">
        {formatNumber(site.specific_yield_kwh_kwp, 1)}
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1">
          <Badge
            size="xs"
            color={site.data_quality === "good" ? "emerald" : site.data_quality === "partial" ? "amber" : "red"}
          >
            {site.data_quality}
          </Badge>
          {hasDataIssues && (
            <span title={site.data_quality_flags?.join(", ")}>
              <AlertTriangle className="h-3 w-3 text-amber-400" />
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

// =============================================================================
// Main Performance Page
// =============================================================================

// Date utility to format for input
const formatDateForInput = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

// Get default dates (last 7 days ending yesterday)
const getDefaultDates = (daysBack: number) => {
  const end = new Date();
  end.setDate(end.getDate() - 1); // Yesterday
  const start = new Date(end);
  start.setDate(start.getDate() - daysBack + 1);
  return {
    start: formatDateForInput(start),
    end: formatDateForInput(end)
  };
};

export default function PerformancePage() {
  const router = useRouter();
  const [stage, setStage] = useState("FC");
  const [days, setDays] = useState(7);
  const [useCustomDates, setUseCustomDates] = useState(false);
  const [startDate, setStartDate] = useState<string>(() => getDefaultDates(7).start);
  const [endDate, setEndDate] = useState<string>(() => getDefaultDates(7).end);
  const [search, setSearch] = useState("");
  const [selectedSite, setSelectedSite] = useState<SiteKPI | null>(null);
  const [sortField, setSortField] = useState<SortField>("rank");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [showScatterPlot, setShowScatterPlot] = useState(true);
  const [showDistribution, setShowDistribution] = useState(true);
  const [prRangeFilter, setPrRangeFilter] = useState<{ min: number; max: number } | null>(null);

  // Use custom dates if enabled, otherwise use days preset
  const { data, isLoading, refetch, isFetching } = useFleetKPIs(
    stage,
    days,
    useCustomDates ? startDate : undefined,
    useCustomDates ? endDate : undefined
  );

  // Update dates when days preset changes (only if not using custom dates)
  const handleDaysChange = (newDays: number) => {
    setDays(newDays);
    if (!useCustomDates) {
      const dates = getDefaultDates(newDays);
      setStartDate(dates.start);
      setEndDate(dates.end);
    }
  };

  // Filter and sort
  const filteredKPIs = useMemo(() => {
    let kpis = data?.kpis || [];

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      kpis = kpis.filter(
        (s) =>
          s.site_id.toLowerCase().includes(searchLower) ||
          s.site_name.toLowerCase().includes(searchLower)
      );
    }

    // PR range filter (from distribution chart click)
    if (prRangeFilter) {
      kpis = kpis.filter(s => {
        const pr = s.pr_weather_adjusted;
        if (pr === null) return false;
        return pr >= prRangeFilter.min && pr < prRangeFilter.max;
      });
    }

    // Sort
    if (sortField) {
      kpis = [...kpis].sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];

        if (aVal === null && bVal === null) return 0;
        if (aVal === null) return sortDirection === "asc" ? 1 : -1;
        if (bVal === null) return sortDirection === "asc" ? -1 : 1;

        if (typeof aVal === "string" && typeof bVal === "string") {
          return sortDirection === "asc"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        }

        return sortDirection === "asc"
          ? (aVal as number) - (bVal as number)
          : (bVal as number) - (aVal as number);
      });
    }

    return kpis;
  }, [data?.kpis, search, sortField, sortDirection, prRangeFilter]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const stats = data?.statistics;

  return (
    <div className="flex h-screen flex-col">
      <Header
        title="Performance Analytics"
        subtitle={`Fleet KPI analysis - ${stats?.site_count || 0} sites`}
        onRefresh={() => refetch()}
        isLoading={isFetching}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - KPI Table */}
        <div className={cn(
          "flex flex-col overflow-hidden border-r border-chiron-accent-teal/20 bg-chiron-bg-secondary transition-all",
          selectedSite ? "w-[55%]" : "flex-1"
        )}>
          {/* Controls */}
          <div className="p-3 border-b border-chiron-accent-teal/20 space-y-2">
            <div className="flex items-center gap-3">
              {/* Stage Filter */}
              <div className="flex items-center gap-1 rounded-lg border border-chiron-accent-teal/20 bg-chiron-gradient p-0.5">
                {["FC", "Pre-FC", "All"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setStage(s)}
                    className={cn(
                      "px-3 py-1 rounded-md text-xs font-medium transition-all",
                      stage === s
                        ? "bg-chiron-accent-teal text-white"
                        : "text-chiron-text-muted hover:text-chiron-text-primary"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* Days Filter / Custom Dates */}
              <div className="flex items-center gap-2">
                {/* Preset buttons */}
                <div className="flex items-center gap-1 rounded-lg border border-chiron-accent-teal/20 bg-chiron-gradient p-0.5">
                  {[7, 14, 30, 60, 90].map((d) => (
                    <button
                      key={d}
                      onClick={() => {
                        setUseCustomDates(false);
                        handleDaysChange(d);
                      }}
                      className={cn(
                        "px-2 py-1 rounded-md text-xs font-medium transition-all",
                        !useCustomDates && days === d
                          ? "bg-chiron-accent-purple text-white"
                          : "text-chiron-text-muted hover:text-chiron-text-primary"
                      )}
                    >
                      {d}d
                    </button>
                  ))}
                  <button
                    onClick={() => setUseCustomDates(true)}
                    className={cn(
                      "px-2 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1",
                      useCustomDates
                        ? "bg-chiron-accent-purple text-white"
                        : "text-chiron-text-muted hover:text-chiron-text-primary"
                    )}
                  >
                    <Calendar className="h-3 w-3" />
                    Custom
                  </button>
                </div>

                {/* Date inputs (shown when custom is selected) */}
                {useCustomDates && (
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="px-2 py-1 bg-chiron-bg-tertiary border border-chiron-accent-teal/20 rounded-md text-xs text-chiron-text-primary focus:outline-none focus:border-chiron-accent-teal"
                    />
                    <span className="text-chiron-text-muted text-xs">to</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="px-2 py-1 bg-chiron-bg-tertiary border border-chiron-accent-teal/20 rounded-md text-xs text-chiron-text-primary focus:outline-none focus:border-chiron-accent-teal"
                    />
                  </div>
                )}
              </div>

              {/* Search */}
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-chiron-text-muted" />
                <input
                  type="text"
                  placeholder="Search sites..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-chiron-bg-tertiary border border-chiron-accent-teal/20 rounded-lg text-sm text-chiron-text-primary placeholder-chiron-text-muted focus:outline-none focus:border-chiron-accent-teal"
                />
              </div>

              {/* Export Button */}
              <button
                onClick={() => {
                  const dateStr = new Date().toISOString().split('T')[0];
                  exportToCSV(filteredKPIs, `fleet_kpi_${stage}_${dateStr}`);
                }}
                disabled={filteredKPIs.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-chiron-accent-purple/20 border border-chiron-accent-purple/40 rounded-lg text-xs font-medium text-chiron-accent-purple hover:bg-chiron-accent-purple/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Export current filtered data to CSV"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Export CSV
              </button>
            </div>

            {/* Active Filters Indicator */}
            {prRangeFilter && (
              <div className="flex items-center gap-2">
                <Badge color="purple" size="xs">
                  Filtered: {prRangeFilter.min}-{prRangeFilter.max}% WA PR
                </Badge>
                <button
                  onClick={() => setPrRangeFilter(null)}
                  className="text-xs text-chiron-text-muted hover:text-red-400"
                >
                  Clear filter
                </button>
              </div>
            )}

            {/* Stats Summary */}
            {stats && (
              <div className="flex items-center gap-4 text-xs">
                <span className="text-chiron-text-muted">
                  {stats.sites_valid_for_stats || stats.site_count} sites
                  {stats.sites_with_data_quality_issues && stats.sites_with_data_quality_issues > 0 && (
                    <span className="ml-1 text-amber-400" title={`${stats.sites_with_data_quality_issues} sites excluded from stats due to data quality issues`}>
                      ({stats.sites_with_data_quality_issues} flagged)
                    </span>
                  )}
                  {data?.start_date && data?.end_date && (
                    <span className="ml-1">
                      ({data.start_date} to {data.end_date})
                    </span>
                  )}
                   |
                </span>
                <span className="text-chiron-text-muted">
                  WA PR: <span className="font-bold text-chiron-accent-teal">{formatNumber(stats.wa_pr_avg || 0, 1)}%</span> avg
                </span>
                <span className="text-chiron-text-muted">
                  <span className="text-emerald-400">{formatNumber(stats.wa_pr_max || 0, 0)}%</span> max
                </span>
                <span className="text-chiron-text-muted">
                  <span className="text-red-400">{formatNumber(stats.wa_pr_min || 0, 0)}%</span> min
                </span>
                <span className="text-chiron-text-muted">|</span>
                <span className="text-chiron-text-muted">
                  Avail: <span className="font-bold text-emerald-400">{formatNumber(stats.availability_avg || 0, 1)}%</span>
                </span>
                <span className="text-chiron-text-muted">|</span>
                <span className="text-chiron-text-muted">
                  Prod: <span className="font-bold text-chiron-accent-teal">{formatNumber(stats.total_production_kwh / 1000, 0)} MWh</span>
                </span>
                {stats.total_revenue !== undefined && stats.total_revenue > 0 && (
                  <>
                    <span className="text-chiron-text-muted">|</span>
                    <span className="text-chiron-text-muted">
                      Rev: <span className="font-bold text-green-400">${formatNumber(stats.total_revenue / 1000, 1)}k</span>
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* KPI Table */}
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <RefreshCw className="h-8 w-8 text-chiron-accent-teal animate-spin" />
              </div>
            ) : (
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-chiron-bg-tertiary z-10">
                  <tr>
                    {KPI_COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        onClick={() => col.sortable && handleSort(col.key as SortField)}
                        className={cn(
                          "px-2 py-2 text-xs font-medium text-chiron-text-muted whitespace-nowrap",
                          col.width,
                          col.sortable && "cursor-pointer hover:text-chiron-text-primary",
                          col.highlight && "text-chiron-accent-teal"
                        )}
                      >
                        <div className="flex items-center gap-1">
                          {col.label}
                          {col.sortable && sortField === col.key && (
                            sortDirection === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredKPIs.map((site) => (
                    <KPITableRow
                      key={site.site_id}
                      site={site}
                      isSelected={selectedSite?.site_id === site.site_id}
                      onClick={() => setSelectedSite(site)}
                      onDeepDive={() => router.push(`/performance/site?site=${site.site_id}`)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Scatter Plot Section */}
          {!isLoading && filteredKPIs.length > 0 && (
            <div className="mt-4 border-t border-chiron-bg-tertiary/50 pt-4">
              <button
                onClick={() => setShowScatterPlot(!showScatterPlot)}
                className="flex items-center gap-2 text-sm text-chiron-text-secondary hover:text-chiron-text-primary mb-3"
              >
                <ScatterChartIcon className="h-4 w-4" />
                <span className="font-medium">WA PR vs System Size</span>
                {showScatterPlot ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>

              {showScatterPlot && (
                <div className="bg-chiron-bg-secondary/30 rounded-lg p-4">
                  <ResponsiveContainer width="100%" height={300}>
                    <ScatterChart margin={{ top: 20, right: 30, bottom: 40, left: 50 }}>
                      <XAxis
                        type="number"
                        dataKey="x"
                        name="Size (kW)"
                        domain={['dataMin - 100', 'dataMax + 100']}
                        tick={{ fill: '#8b9cb8', fontSize: 11 }}
                        axisLine={{ stroke: '#374151' }}
                        tickLine={{ stroke: '#374151' }}
                        label={{ value: 'System Size (kW DC)', position: 'bottom', fill: '#8b9cb8', fontSize: 12, offset: 0 }}
                      />
                      <YAxis
                        type="number"
                        dataKey="y"
                        name="WA PR"
                        domain={[0, 120]}
                        tick={{ fill: '#8b9cb8', fontSize: 11 }}
                        axisLine={{ stroke: '#374151' }}
                        tickLine={{ stroke: '#374151' }}
                        label={{ value: 'WA PR (%)', angle: -90, position: 'left', fill: '#8b9cb8', fontSize: 12, offset: 10 }}
                      />
                      <ZAxis type="number" dataKey="z" range={[30, 200]} name="Revenue" />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const d = payload[0].payload;
                            return (
                              <div className="bg-chiron-bg-primary border border-chiron-bg-tertiary rounded-lg p-3 shadow-lg text-xs">
                                <p className="font-bold text-chiron-text-primary mb-1">{d.name}</p>
                                <p className="text-chiron-text-secondary">Size: {formatNumber(d.x, 0)} kW</p>
                                <p className={cn(
                                  d.y >= 90 ? "text-emerald-400" : d.y >= 70 ? "text-amber-400" : "text-red-400"
                                )}>WA PR: {formatNumber(d.y, 1)}%</p>
                                {d.revenue !== undefined && (
                                  <p className={d.revenue >= 0 ? "text-emerald-400" : "text-red-400"}>
                                    Rev Impact: ${formatNumber(d.revenue, 0)}
                                  </p>
                                )}
                                {d.excluded && (
                                  <p className="text-amber-400 mt-1">Data quality flagged</p>
                                )}
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      {/* Reference lines for performance bands */}
                      <ReferenceLine y={90} stroke="#10b981" strokeDasharray="3 3" label={{ value: '90% Target', fill: '#10b981', fontSize: 10, position: 'right' }} />
                      <ReferenceLine y={70} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: '70% Warning', fill: '#f59e0b', fontSize: 10, position: 'right' }} />
                      <ReferenceLine y={stats?.wa_pr_avg || 0} stroke="#06b6d4" strokeDasharray="5 5" label={{ value: `Avg ${formatNumber(stats?.wa_pr_avg || 0, 1)}%`, fill: '#06b6d4', fontSize: 10, position: 'right' }} />
                      <Scatter
                        data={filteredKPIs
                          .filter(s => s.pr_weather_adjusted !== null && s.pr_weather_adjusted <= 150)
                          .map(s => ({
                            x: s.size_kw_dc,
                            y: s.pr_weather_adjusted,
                            z: Math.abs(s.variance_wa_revenue || 0) + 50,
                            name: s.site_name || s.site_id,
                            siteId: s.site_id,
                            revenue: s.variance_wa_revenue,
                            excluded: s.wa_pr_valid_for_stats === false
                          }))}
                        fill="#06b6d4"
                      >
                        {filteredKPIs
                          .filter(s => s.pr_weather_adjusted !== null && s.pr_weather_adjusted <= 150)
                          .map((s, index) => {
                            const pr = s.pr_weather_adjusted || 0;
                            const excluded = s.wa_pr_valid_for_stats === false;
                            let color = '#10b981'; // green for >= 90
                            if (excluded) color = '#f59e0b'; // amber for excluded
                            else if (pr < 70) color = '#ef4444'; // red
                            else if (pr < 90) color = '#f59e0b'; // amber
                            return (
                              <Cell
                                key={`cell-${index}`}
                                fill={color}
                                fillOpacity={excluded ? 0.5 : 0.8}
                                stroke={selectedSite?.site_id === s.site_id ? '#fff' : 'none'}
                                strokeWidth={selectedSite?.site_id === s.site_id ? 2 : 0}
                                onClick={() => setSelectedSite(s)}
                                cursor="pointer"
                              />
                            );
                          })}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                  <div className="flex items-center justify-center gap-6 mt-2 text-xs text-chiron-text-muted">
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
                      WA PR &ge; 90%
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded-full bg-amber-500"></span>
                      70-90% or Flagged
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded-full bg-red-500"></span>
                      WA PR &lt; 70%
                    </span>
                  </div>
                </div>
              )}

              {/* Distribution Chart */}
              <button
                onClick={() => setShowDistribution(!showDistribution)}
                className="flex items-center gap-2 text-sm text-chiron-text-secondary hover:text-chiron-text-primary mt-4"
              >
                <PieChart className="h-4 w-4" />
                <span className="font-medium">Fleet Distribution</span>
                {showDistribution ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>

              {showDistribution && (
                <div className="bg-chiron-bg-secondary/30 rounded-lg p-4 mt-2">
                  <FleetDistributionChart
                    kpis={data?.kpis || []}
                    onBucketClick={(min, max) => setPrRangeFilter({ min, max })}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Panel - Site Detail */}
        {selectedSite && (
          <div className="w-[45%] overflow-hidden">
            <SiteDetailPanel
              site={selectedSite}
              onClose={() => setSelectedSite(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
