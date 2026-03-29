"use client";

import { useState, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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
  ArrowLeft,
  Search,
  RefreshCw,
  Zap,
  Sun,
  Calendar,
  Target,
  AlertTriangle,
  ChevronRight,
  Thermometer,
  LineChart,
  Grid3X3,
  TrendingUp,
  TrendingDown,
  Gauge,
  Battery,
  DollarSign,
  Activity,
  Database,
  BarChart3,
  FileWarning,
} from "lucide-react";
import {
  Card,
  Title,
  Badge,
  ProgressBar,
  AreaChart,
  BarChart,
  TabGroup,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
} from "@tremor/react";
import type { SiteKPI, InverterAnalysis } from "@/types";

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

  const timestamps = heatmapData.timestamps.slice(-72);
  const startIdx = heatmapData.timestamps.length - 72;

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
        <div className="flex gap-0.5 mb-1 pl-16">
          {timestamps.map((ts, i) => (
            <div key={ts} className="w-3 h-6 flex items-end justify-center" title={ts}>
              {i % 8 === 0 && (
                <span className="text-[8px] text-chiron-text-muted rotate-[-60deg] origin-bottom-left whitespace-nowrap">
                  {ts.split(" ")[1]?.slice(0, 5) || ""}
                </span>
              )}
            </div>
          ))}
        </div>

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
                  className={cn("w-3 h-4 rounded-sm transition-colors", getColor(cfValue))}
                  title={`${inv} @ ${ts}: ${cfValue.toFixed(0)}% CF`}
                />
              );
            })}
          </div>
        ))}

        <div className="flex items-center gap-4 mt-4 text-xs text-chiron-text-muted">
          <span>Capacity Factor:</span>
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-emerald-500" /><span>≥80%</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-amber-400" /><span>40-60%</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-orange-500/60" /><span>1-20%</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-slate-700/50" /><span>0%</span></div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Production Trend Chart
// =============================================================================

function ProductionTrendChart({ siteId }: { siteId: string }) {
  const { data: metricsData, isLoading } = useSiteMetrics(siteId, 14);

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

  const chartData = metrics.slice(-336).map((d) => ({
    time: String(d.MEASUREMENTTIME).slice(5, 16),
    Production: Number(d.METER_ENERGY || d.INV_TOTAL_ENERGY || 0),
    Insolation: Number(d.INSOLATION_POA || d.INSOLATION_GHI || 0) / 10,
  }));

  return (
    <AreaChart
      className="h-80"
      data={chartData}
      index="time"
      categories={["Production", "Insolation"]}
      colors={["teal", "amber"]}
      valueFormatter={(v) => `${formatNumber(v, 0)}`}
      showLegend={true}
      curveType="monotone"
    />
  );
}

// =============================================================================
// Inverter Analysis Grid
// =============================================================================

function InverterAnalysisGrid({ siteId }: { siteId: string }) {
  const { data: stringData, isLoading } = useStringAnalysis(siteId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <RefreshCw className="h-6 w-6 text-chiron-accent-teal animate-spin" />
      </div>
    );
  }

  const inverters = stringData?.inverters || [];
  if (inverters.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-chiron-text-muted">
        <span>No inverter analysis available</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4 mb-4">
        <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20 !p-3">
          <p className="text-xs text-chiron-text-muted">Avg Capacity Factor</p>
          <p className="text-2xl font-bold text-chiron-accent-teal">
            {formatNumber(stringData?.summary?.avg_capacity_factor || 0, 1)}%
          </p>
        </Card>
        <Card className="!bg-chiron-gradient !border-emerald-500/20 !p-3">
          <p className="text-xs text-chiron-text-muted">Best Performer</p>
          <p className="text-lg font-bold text-emerald-400">
            {stringData?.summary?.best_performer || "-"}
          </p>
        </Card>
        <Card className="!bg-chiron-gradient !border-red-500/20 !p-3">
          <p className="text-xs text-chiron-text-muted">Worst Performer</p>
          <p className="text-lg font-bold text-red-400">
            {stringData?.summary?.worst_performer || "-"}
          </p>
        </Card>
        <Card className="!bg-chiron-gradient !border-amber-500/20 !p-3">
          <p className="text-xs text-chiron-text-muted">Outliers / Issues</p>
          <p className="text-lg font-bold text-amber-400">
            {stringData?.summary?.outliers_count || 0} / {stringData?.summary?.total_issues || 0}
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {inverters.map((inv: InverterAnalysis) => {
          const isOutlier = inv.is_outlier;
          const hasIssues = inv.issues && inv.issues.length > 0;
          const cf = inv.capacity_factor || 0;

          return (
            <div
              key={inv.inverter}
              className={cn(
                "rounded-lg border p-3",
                isOutlier ? "border-amber-500/50 bg-amber-500/10" :
                hasIssues ? "border-red-500/50 bg-red-500/10" :
                "border-chiron-accent-teal/20 bg-chiron-gradient"
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-chiron-text-primary">{inv.inverter}</span>
                {(isOutlier || hasIssues) && (
                  <AlertTriangle className={cn("h-4 w-4", isOutlier ? "text-amber-400" : "text-red-400")} />
                )}
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-chiron-text-muted">Capacity Factor</span>
                  <span className={cn(
                    "font-mono",
                    cf >= 80 ? "text-emerald-400" : cf >= 60 ? "text-green-400" : cf >= 40 ? "text-amber-400" : "text-red-400"
                  )}>
                    {formatNumber(cf, 1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-chiron-text-muted">Total kWh</span>
                  <span className="font-mono text-chiron-text-primary">{formatNumber(inv.total_kwh, 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-chiron-text-muted">Uptime</span>
                  <span className="font-mono text-chiron-text-primary">{formatNumber(inv.uptime_pct, 0)}%</span>
                </div>
                {hasIssues && (
                  <div className="mt-2 pt-2 border-t border-red-500/30">
                    {inv.issues.map((issue, idx) => (
                      <Badge key={idx} color="red" size="xs" className="mr-1 mb-1">{issue}</Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <BarChart
        className="h-48 mt-4"
        data={inverters.map((inv: InverterAnalysis) => ({
          name: inv.inverter,
          CF: inv.capacity_factor,
        }))}
        index="name"
        categories={["CF"]}
        colors={["indigo"]}
        valueFormatter={(v) => `${formatNumber(v, 0)}%`}
      />
    </div>
  );
}

// =============================================================================
// Site Selector Sidebar
// =============================================================================

function SiteSelector({
  sites,
  selectedSite,
  onSelect,
  search,
  onSearchChange,
}: {
  sites: SiteKPI[];
  selectedSite: string | null;
  onSelect: (site: SiteKPI) => void;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  const filteredSites = useMemo(() => {
    if (!search) return sites;
    const lower = search.toLowerCase();
    return sites.filter(s =>
      s.site_id.toLowerCase().includes(lower) ||
      s.site_name.toLowerCase().includes(lower)
    );
  }, [sites, search]);

  return (
    <div className="w-64 flex-shrink-0 overflow-hidden flex flex-col border-r border-chiron-accent-teal/20 bg-chiron-bg-secondary">
      <div className="p-3 border-b border-chiron-accent-teal/20">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-chiron-text-muted" />
          <input
            type="text"
            placeholder="Search sites..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-chiron-bg-tertiary border border-chiron-accent-teal/20 rounded-lg text-sm text-chiron-text-primary placeholder-chiron-text-muted focus:outline-none focus:border-chiron-accent-teal"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredSites.map((site) => {
          const isSelected = selectedSite === site.site_id;
          const waPR = site.pr_weather_adjusted;
          const prColor = waPR === null ? "text-chiron-text-muted" :
            waPR >= 90 ? "text-emerald-400" : waPR >= 70 ? "text-amber-400" : "text-red-400";

          return (
            <button
              key={site.site_id}
              onClick={() => onSelect(site)}
              className={cn(
                "w-full text-left rounded-lg p-2 transition-all",
                isSelected ? "bg-chiron-accent-teal/20 border border-chiron-accent-teal/50" : "hover:bg-chiron-bg-tertiary border border-transparent"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm text-chiron-text-primary">{site.site_id}</span>
                <span className={cn("font-mono text-sm font-bold", prColor)}>
                  {waPR !== null ? `${formatNumber(waPR, 0)}%` : "-"}
                </span>
              </div>
              <p className="text-xs text-chiron-text-muted truncate">{site.site_name}</p>
              <div className="flex items-center gap-2 mt-1 text-xs text-chiron-text-muted">
                <span>{formatNumber(site.size_kw_dc, 0)} kW</span>
                {site.data_quality_flags && site.data_quality_flags.length > 0 && (
                  <AlertTriangle className="h-3 w-3 text-amber-400" />
                )}
              </div>
            </button>
          );
        })}
      </div>
      <div className="p-2 border-t border-chiron-accent-teal/20 text-center text-xs text-chiron-text-muted">
        {filteredSites.length} sites
      </div>
    </div>
  );
}

// =============================================================================
// Main Site Detail Page Content
// =============================================================================

function SitePerformanceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const siteIdParam = searchParams.get("site");

  const [stage] = useState("FC");
  const [search, setSearch] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(siteIdParam);

  const { data: kpiData, isLoading, refetch, isFetching } = useFleetKPIs(stage, 7);
  const sites = kpiData?.kpis || [];
  const selectedSite = sites.find(s => s.site_id === selectedSiteId) || null;

  const handleSelectSite = (site: SiteKPI) => {
    setSelectedSiteId(site.site_id);
    router.replace(`/performance/site?site=${site.site_id}`, { scroll: false });
  };

  const prValue = selectedSite?.pr_weather_adjusted || 0;
  const prColorClass = prValue >= 90 ? "text-emerald-400" : prValue >= 70 ? "text-amber-400" : "text-red-400";
  const insolGap = selectedSite?.insolation_gap || 0;
  const insolGapColorClass = insolGap >= 5 ? "text-emerald-400" : insolGap >= 0 ? "text-green-400" : insolGap >= -5 ? "text-amber-400" : "text-red-400";

  return (
    <div className="flex h-screen flex-col">
      <Header
        title="Site Performance Deep-Dive"
        subtitle={selectedSite ? `${selectedSite.site_id} - ${selectedSite.site_name}` : "Select a site"}
        onRefresh={() => refetch()}
        isLoading={isFetching}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Site Selector */}
        {isLoading ? (
          <div className="w-64 flex items-center justify-center bg-chiron-bg-secondary">
            <RefreshCw className="h-6 w-6 text-chiron-accent-teal animate-spin" />
          </div>
        ) : (
          <SiteSelector
            sites={sites}
            selectedSite={selectedSiteId}
            onSelect={handleSelectSite}
            search={search}
            onSearchChange={setSearch}
          />
        )}

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-chiron-bg-primary">
          {selectedSite ? (
            <div className="space-y-6">
              {/* Header Cards */}
              <div className="flex items-center gap-3 mb-6">
                <button
                  onClick={() => router.push("/performance")}
                  className="p-2 rounded-lg hover:bg-chiron-bg-tertiary text-chiron-text-muted hover:text-chiron-text-primary transition-colors"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold text-chiron-accent-teal">{selectedSite.site_id}</h1>
                    {selectedSite.is_bess_site && <Badge color="purple">BESS</Badge>}
                    <Badge color={selectedSite.data_quality === "good" ? "emerald" : selectedSite.data_quality === "partial" ? "amber" : "red"}>
                      {selectedSite.data_quality}
                    </Badge>
                  </div>
                  <p className="text-chiron-text-secondary">{selectedSite.site_name}</p>
                </div>
              </div>

              {/* KPI Summary Row */}
              <div className="grid grid-cols-6 gap-4">
                <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20 !p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Gauge className="h-5 w-5 text-chiron-accent-teal" />
                    <span className="text-xs text-chiron-text-muted">WA PR</span>
                  </div>
                  <p className={cn("text-3xl font-bold", prColorClass)}>
                    {selectedSite.pr_weather_adjusted !== null ? `${formatNumber(selectedSite.pr_weather_adjusted, 1)}%` : "-"}
                  </p>
                </Card>
                <Card className="!bg-chiron-gradient !border-blue-500/20 !p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="h-5 w-5 text-blue-400" />
                    <span className="text-xs text-chiron-text-muted">Raw PR</span>
                  </div>
                  <p className="text-3xl font-bold text-blue-400">
                    {selectedSite.pr_raw !== null ? `${formatNumber(selectedSite.pr_raw, 1)}%` : "-"}
                  </p>
                </Card>
                <Card className="!bg-chiron-gradient !border-emerald-500/20 !p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Battery className="h-5 w-5 text-emerald-400" />
                    <span className="text-xs text-chiron-text-muted">Availability</span>
                  </div>
                  <p className="text-3xl font-bold text-emerald-400">
                    {selectedSite.availability_pct !== null ? `${formatNumber(selectedSite.availability_pct, 1)}%` : "-"}
                  </p>
                </Card>
                <Card className="!bg-chiron-gradient !border-amber-500/20 !p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sun className="h-5 w-5 text-amber-400" />
                    <span className="text-xs text-chiron-text-muted">Insol Gap</span>
                  </div>
                  <p className={cn("text-3xl font-bold", insolGapColorClass)}>
                    {insolGap >= 0 ? "+" : ""}{formatNumber(insolGap, 0)}%
                  </p>
                </Card>
                <Card className="!bg-chiron-gradient !border-purple-500/20 !p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="h-5 w-5 text-purple-400" />
                    <span className="text-xs text-chiron-text-muted">Cap Factor</span>
                  </div>
                  <p className="text-3xl font-bold text-purple-400">
                    {selectedSite.capacity_factor_pct !== null ? `${formatNumber(selectedSite.capacity_factor_pct, 1)}%` : "-"}
                  </p>
                </Card>
                <Card className="!bg-chiron-gradient !border-green-500/20 !p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="h-5 w-5 text-green-400" />
                    <span className="text-xs text-chiron-text-muted">Rev Impact</span>
                  </div>
                  <p className={cn(
                    "text-3xl font-bold",
                    selectedSite.variance_wa_revenue === undefined ? "text-chiron-text-muted" :
                    selectedSite.variance_wa_revenue >= 0 ? "text-green-400" : "text-red-400"
                  )}>
                    {selectedSite.variance_wa_revenue !== undefined
                      ? `${selectedSite.variance_wa_revenue >= 0 ? '+' : ''}$${formatNumber(selectedSite.variance_wa_revenue, 0)}`
                      : "-"}
                  </p>
                </Card>
              </div>

              {/* Data Quality Flags */}
              {selectedSite.data_quality_flags && selectedSite.data_quality_flags.length > 0 && (
                <Card className="!bg-amber-900/20 !border-amber-500/30 !p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <FileWarning className="h-5 w-5 text-amber-400" />
                    <span className="font-medium text-amber-400">Data Quality Flags</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedSite.data_quality_flags.map((flag, idx) => (
                      <Badge key={idx} color="amber">{flag.replace(/_/g, " ")}</Badge>
                    ))}
                  </div>
                </Card>
              )}

              {/* Tabbed Content */}
              <TabGroup>
                <TabList className="!border-chiron-accent-teal/20">
                  <Tab className="!text-chiron-text-muted data-[selected]:!text-chiron-accent-teal data-[selected]:!border-chiron-accent-teal flex items-center gap-2">
                    <LineChart className="h-4 w-4" />
                    Trends
                  </Tab>
                  <Tab className="!text-chiron-text-muted data-[selected]:!text-chiron-accent-teal data-[selected]:!border-chiron-accent-teal flex items-center gap-2">
                    <Grid3X3 className="h-4 w-4" />
                    Heatmap
                  </Tab>
                  <Tab className="!text-chiron-text-muted data-[selected]:!text-chiron-accent-teal data-[selected]:!border-chiron-accent-teal flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Inverters
                  </Tab>
                  <Tab className="!text-chiron-text-muted data-[selected]:!text-chiron-accent-teal data-[selected]:!border-chiron-accent-teal flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Data
                  </Tab>
                </TabList>

                <TabPanels className="mt-4">
                  {/* Trends Tab */}
                  <TabPanel>
                    <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
                      <div className="flex items-center gap-2 mb-4">
                        <LineChart className="h-5 w-5 text-chiron-accent-teal" />
                        <Title className="!text-chiron-text-primary">Production & Insolation (14 days)</Title>
                      </div>
                      <ProductionTrendChart siteId={selectedSite.site_id} />
                      <p className="text-xs text-chiron-text-muted mt-3 text-center">
                        Production (kWh) and Insolation (W/m² ÷ 10)
                      </p>
                    </Card>
                  </TabPanel>

                  {/* Heatmap Tab */}
                  <TabPanel>
                    <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
                      <div className="flex items-center gap-2 mb-4">
                        <Grid3X3 className="h-5 w-5 text-chiron-accent-purple" />
                        <Title className="!text-chiron-text-primary">Inverter Capacity Factor Heatmap (72h)</Title>
                      </div>
                      <InverterHeatmap siteId={selectedSite.site_id} />
                    </Card>
                  </TabPanel>

                  {/* Inverters Tab */}
                  <TabPanel>
                    <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
                      <div className="flex items-center gap-2 mb-4">
                        <Activity className="h-5 w-5 text-indigo-400" />
                        <Title className="!text-chiron-text-primary">Inverter Analysis (7 days)</Title>
                      </div>
                      <InverterAnalysisGrid siteId={selectedSite.site_id} />
                    </Card>
                  </TabPanel>

                  {/* Data Tab */}
                  <TabPanel>
                    <div className="grid grid-cols-2 gap-6">
                      <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
                        <Title className="!text-chiron-text-primary mb-4">Production Summary</Title>
                        <div className="space-y-3">
                          <div className="flex justify-between items-center p-2 rounded bg-chiron-bg-tertiary/50">
                            <span className="text-sm text-chiron-text-secondary">Smart Production</span>
                            <span className="font-mono font-semibold text-chiron-accent-teal">
                              {formatNumber(selectedSite.smart_production_kwh, 0)} kWh
                            </span>
                          </div>
                          <div className="flex justify-between items-center p-2 rounded bg-chiron-bg-tertiary/50">
                            <span className="text-sm text-chiron-text-secondary">Meter Production</span>
                            <span className="font-mono text-chiron-text-primary">
                              {formatNumber(selectedSite.meter_production_kwh, 0)} kWh
                            </span>
                          </div>
                          <div className="flex justify-between items-center p-2 rounded bg-chiron-bg-tertiary/50">
                            <span className="text-sm text-chiron-text-secondary">Inverter Production</span>
                            <span className="font-mono text-chiron-text-primary">
                              {formatNumber(selectedSite.inverter_production_kwh, 0)} kWh
                            </span>
                          </div>
                          <div className="flex justify-between items-center p-2 rounded bg-chiron-bg-tertiary/50">
                            <span className="text-sm text-chiron-text-secondary">Production Source</span>
                            <Badge color={selectedSite.production_source === 'meter' ? 'blue' : selectedSite.production_source === 'inverter' ? 'purple' : 'slate'}>
                              {selectedSite.production_source}
                            </Badge>
                          </div>
                          <div className="flex justify-between items-center p-2 rounded bg-chiron-bg-tertiary/50">
                            <span className="text-sm text-chiron-text-secondary">Specific Yield</span>
                            <span className="font-mono text-chiron-text-primary">
                              {formatNumber(selectedSite.specific_yield_kwh_kwp, 2)} kWh/kWp
                            </span>
                          </div>
                        </div>
                      </Card>
                      <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
                        <Title className="!text-chiron-text-primary mb-4">System Information</Title>
                        <div className="space-y-3">
                          <div className="flex justify-between items-center p-2 rounded bg-chiron-bg-tertiary/50">
                            <span className="text-sm text-chiron-text-secondary">DC Capacity</span>
                            <span className="font-mono text-chiron-text-primary">
                              {formatNumber(selectedSite.size_kw_dc, 0)} kW
                            </span>
                          </div>
                          <div className="flex justify-between items-center p-2 rounded bg-chiron-bg-tertiary/50">
                            <span className="text-sm text-chiron-text-secondary">AC Capacity</span>
                            <span className="font-mono text-chiron-text-primary">
                              {formatNumber(selectedSite.size_kw_ac, 0)} kW
                            </span>
                          </div>
                          <div className="flex justify-between items-center p-2 rounded bg-chiron-bg-tertiary/50">
                            <span className="text-sm text-chiron-text-secondary">Years Since PTO</span>
                            <span className="font-mono text-chiron-text-primary">
                              {formatNumber(selectedSite.years_since_pto, 1)} yrs
                            </span>
                          </div>
                          <div className="flex justify-between items-center p-2 rounded bg-chiron-bg-tertiary/50">
                            <span className="text-sm text-chiron-text-secondary">Degradation Factor</span>
                            <span className="font-mono text-chiron-text-primary">
                              {formatNumber(selectedSite.degradation_factor * 100, 2)}%
                            </span>
                          </div>
                          <div className="flex justify-between items-center p-2 rounded bg-chiron-bg-tertiary/50">
                            <span className="text-sm text-chiron-text-secondary">Irradiance Type</span>
                            <Badge color="blue">{selectedSite.irradiance_type || "POA"}</Badge>
                          </div>
                        </div>
                      </Card>
                    </div>
                  </TabPanel>
                </TabPanels>
              </TabGroup>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-chiron-text-muted">
              <BarChart3 className="h-20 w-20 opacity-20" />
              <p className="mt-6 text-lg">Select a site to view performance details</p>
              <p className="mt-2 text-sm">Choose a site from the sidebar to see KPIs, trends, and analysis</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main Page Export with Suspense
// =============================================================================

export default function SitePerformancePage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center bg-chiron-bg-primary">
        <RefreshCw className="h-8 w-8 text-chiron-accent-teal animate-spin" />
      </div>
    }>
      <SitePerformanceContent />
    </Suspense>
  );
}
