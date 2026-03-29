"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { KpiCard } from "@/components/dashboard/KpiCard";
import {
  useSitesAnalytics,
  useSiteDetails,
  useSitePerformance,
  useSiteHeatmap,
  useAnomalies,
  useSiteRevenueImpact,
  useMaintenanceScore,
  useStringAnalysis,
  useAlerts,
} from "@/hooks/useFleetData";
import { formatNumber, formatCapacity, formatDateTime, cn } from "@/lib/utils";
import {
  Building2,
  AlertTriangle,
  Zap,
  TrendingDown,
  Search,
  DollarSign,
  Activity,
  Wrench,
  BarChart3,
  ExternalLink,
  Sparkles,
  LayoutDashboard,
  Cpu,
  LineChart as LineChartIcon,
  Bell,
  Wallet,
  Clock,
  CheckCircle,
} from "lucide-react";
import {
  Card,
  Title,
  LineChart,
  Badge,
  ProgressBar,
} from "@tremor/react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

type SiteTab = "overview" | "inverters" | "performance" | "alerts" | "financials";

const TABS: { key: SiteTab; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "inverters", label: "Inverters", icon: Cpu },
  { key: "performance", label: "Performance", icon: LineChartIcon },
  { key: "alerts", label: "Alerts", icon: Bell },
  { key: "financials", label: "Financials", icon: Wallet },
];

export default function SitesPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-chiron-text-muted">Loading...</div>}>
      <SitesPageContent />
    </Suspense>
  );
}

function SitesPageContent() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [stage, setStage] = useState<string>("FC");
  const [searchTerm, setSearchTerm] = useState("");
  const [showFilter, setShowFilter] = useState<string>("issues");
  const [selectedSite, setSelectedSite] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SiteTab>("overview");

  useEffect(() => {
    const siteParam = searchParams.get("site");
    if (siteParam) setSelectedSite(siteParam);
  }, [searchParams]);

  const { data: analyticsData, isLoading, refetch } = useSitesAnalytics(stage, 7);
  const { data: siteDetails } = useSiteDetails(selectedSite);
  const { data: performanceData } = useSitePerformance(selectedSite);
  const { data: heatmapData } = useSiteHeatmap(selectedSite, 5);
  const { data: anomalyData } = useAnomalies(selectedSite, 24);
  const { data: revenueImpact } = useSiteRevenueImpact(selectedSite, 0.08, 168);
  const { data: maintenanceScore } = useMaintenanceScore(selectedSite);
  const { data: stringData } = useStringAnalysis(selectedSite, 7);
  const { data: siteAlerts } = useAlerts({
    site_id: selectedSite || undefined,
    days: 30,
    limit: 50,
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["analytics"] });
    queryClient.invalidateQueries({ queryKey: ["site"] });
    queryClient.invalidateQueries({ queryKey: ["apm"] });
    queryClient.invalidateQueries({ queryKey: ["alerts"] });
    refetch();
  };

  let filteredSites = analyticsData?.sites || [];
  if (showFilter === "issues") {
    filteredSites = filteredSites.filter(
      (s: Record<string, unknown>) => ((s.ESTIMATED_KW_OFFLINE as number) || 0) > 0
    );
  }
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filteredSites = filteredSites.filter(
      (s: Record<string, unknown>) =>
        (s.SITE_ID as string)?.toLowerCase().includes(term) ||
        (s.SITE_NAME as string)?.toLowerCase().includes(term)
    );
  }
  filteredSites = [...filteredSites].sort(
    (a, b) => ((b.ESTIMATED_KW_OFFLINE as number) || 0) - ((a.ESTIMATED_KW_OFFLINE as number) || 0)
  );

  const summary = analyticsData?.summary;
  const site = siteDetails?.site as Record<string, unknown>;

  const prChartData = (performanceData?.daily_data || [])
    .map((d: Record<string, unknown>) => ({
      date: d.DATE as string,
      "PR %": d.PR_PCT as number || null,
      "Availability %": d.AVAILABILITY_PCT !== null && d.AVAILABILITY_PCT !== undefined
        ? ((d.AVAILABILITY_PCT as number) || 0) * 100
        : null,
    }))
    .filter((d: Record<string, unknown>) => d["PR %"] !== null || d["Availability %"] !== null);

  const getMaintenanceStatus = (score: number) => {
    if (score >= 80) return { label: "Excellent", color: "green" as const };
    if (score >= 60) return { label: "Good", color: "emerald" as const };
    if (score >= 40) return { label: "Fair", color: "yellow" as const };
    if (score >= 20) return { label: "Needs Attention", color: "orange" as const };
    return { label: "Critical", color: "red" as const };
  };

  const alertCount = siteDetails?.alerts?.length || 0;

  return (
    <div className="flex h-screen flex-col">
      <Header
        title="Sites Deep-Dive"
        subtitle="Investigate site performance, outages, and APM analytics"
        onRefresh={handleRefresh}
        isLoading={isLoading}
      />

      <div className="flex-1 overflow-hidden p-6">
        {/* KPI Row */}
        <div className="mb-5 grid gap-4 md:grid-cols-4">
          <KpiCard
            title="Sites with Issues"
            value={formatNumber(summary?.sites_with_issues || 0)}
            subtitle={`of ${formatNumber(summary?.total_sites || 0)} sites`}
            icon={AlertTriangle}
            status={(summary?.sites_with_issues || 0) > 0 ? "danger" : "success"}
          />
          <KpiCard
            title="Est. kW Offline"
            value={formatCapacity(summary?.total_kw_offline || 0)}
            subtitle={`${formatNumber(summary?.offline_pct || 0, 2)}% of fleet`}
            icon={TrendingDown}
            status={(summary?.offline_pct || 0) > 1 ? "danger" : (summary?.offline_pct || 0) > 0.5 ? "warning" : "success"}
          />
          <KpiCard
            title="Total Capacity"
            value={formatCapacity(summary?.total_capacity || 0)}
            subtitle="Monitored fleet"
            icon={Zap}
            status="neutral"
          />
          <KpiCard
            title="Total Sites"
            value={formatNumber(summary?.total_sites || 0)}
            subtitle={`Stage: ${stage}`}
            icon={Building2}
            status="neutral"
          />
        </div>

        {/* Filter Bar */}
        <div className="mb-4 flex items-center gap-4 rounded-xl border border-chiron-accent-teal/20 bg-chiron-gradient p-3">
          <div className="flex items-center gap-1 rounded-lg border border-chiron-accent-teal/20 bg-chiron-bg-tertiary p-0.5">
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

          <select
            value={showFilter}
            onChange={(e) => setShowFilter(e.target.value)}
            className="rounded-lg border border-chiron-accent-teal/20 bg-chiron-bg-tertiary px-2 py-1.5 text-xs text-chiron-text-primary focus:border-chiron-accent-teal focus:outline-none"
          >
            <option value="issues">With Issues</option>
            <option value="all">All Sites</option>
          </select>

          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-chiron-text-muted" />
            <input
              type="text"
              placeholder="Search sites..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-chiron-accent-teal/20 bg-chiron-bg-tertiary py-1.5 pl-9 pr-4 text-xs text-chiron-text-primary placeholder:text-chiron-text-muted focus:border-chiron-accent-teal focus:outline-none"
            />
          </div>

          <span className="text-xs text-chiron-text-muted">
            {filteredSites.length} sites
          </span>
        </div>

        {/* Two-column layout */}
        <div className="flex h-[calc(100%-220px)] gap-5">
          {/* Left: Site list */}
          <div className="w-80 flex-shrink-0 overflow-y-auto rounded-xl border border-chiron-accent-teal/20 bg-chiron-gradient p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-chiron-text-muted">
              Sites by kW Offline
            </h3>
            <div className="space-y-1.5">
              {filteredSites.map((s: Record<string, unknown>) => {
                const siteId = s.SITE_ID as string;
                const kwOffline = (s.ESTIMATED_KW_OFFLINE as number) || 0;
                const sizeKw = (s.SIZE_KW_DC as number) || 0;
                const offlinePct = sizeKw > 0 ? (kwOffline / sizeKw) * 100 : 0;
                const hasIssue = kwOffline > 0;

                return (
                  <button
                    key={siteId}
                    onClick={() => { setSelectedSite(siteId); setActiveTab("overview"); }}
                    className={cn(
                      "w-full rounded-lg border p-2.5 text-left transition-all",
                      selectedSite === siteId
                        ? "border-chiron-accent-teal bg-chiron-accent-teal/10"
                        : "border-chiron-accent-teal/10 hover:border-chiron-accent-teal/30"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={cn("w-2 h-2 rounded-full", hasIssue ? "bg-red-500" : "bg-green-500")} />
                        <span className="text-sm font-semibold text-chiron-text-primary">{siteId}</span>
                      </div>
                      <span className={cn("text-xs font-medium", hasIssue ? "text-red-400" : "text-green-400")}>
                        {hasIssue ? `${formatNumber(kwOffline, 0)} kW` : "OK"}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-chiron-text-muted">{s.SITE_NAME as string}</p>
                    <div className="mt-1.5 flex items-center gap-2 text-[10px] text-chiron-text-muted">
                      <span>{formatCapacity(sizeKw)}</span>
                      <span>|</span>
                      <span>{s.PRIMARY_DAS as string}</span>
                      {(s.INV_OFFLINE_COUNT as number) > 0 && (
                        <>
                          <span>|</span>
                          <span className="text-amber-400">
                            {s.INV_OFFLINE_COUNT as number}/{s.INVERTER_COUNT as number} inv
                          </span>
                        </>
                      )}
                    </div>
                    {hasIssue && (
                      <div className="mt-1.5 h-1 w-full rounded-full bg-chiron-bg-primary">
                        <div className="h-full rounded-full bg-red-500" style={{ width: `${Math.min(offlinePct, 100)}%` }} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Site detail panel with tabs */}
          <div className="flex-1 overflow-hidden rounded-xl border border-chiron-accent-teal/20 bg-chiron-gradient flex flex-col">
            {selectedSite && site ? (
              <>
                {/* Site header */}
                <div className="flex items-center justify-between px-6 pt-5 pb-3">
                  <div>
                    <h2 className="text-xl font-bold text-chiron-accent-teal">{selectedSite}</h2>
                    <p className="text-sm text-chiron-text-secondary">{site.SITE_NAME as string}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge color="teal" size="lg">{formatCapacity((site.SIZE_KW_DC as number) || 0)}</Badge>
                    {maintenanceScore && (
                      <Badge color={getMaintenanceStatus(maintenanceScore.score).color} size="lg">
                        Score: {maintenanceScore.score}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Tab navigation */}
                <div className="flex items-center gap-1 px-6 border-b border-chiron-accent-teal/10">
                  {TABS.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.key;
                    return (
                      <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-all -mb-px",
                          isActive
                            ? "border-chiron-accent-teal text-chiron-accent-teal"
                            : "border-transparent text-chiron-text-muted hover:text-chiron-text-primary"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {tab.label}
                        {tab.key === "alerts" && alertCount > 0 && (
                          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-red-500/20 text-red-400">
                            {alertCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Tab content */}
                <div className="flex-1 overflow-y-auto p-6">
                  {/* ===== OVERVIEW TAB ===== */}
                  {activeTab === "overview" && (
                    <div className="space-y-4">
                      {/* Quick Stats */}
                      <div className="grid grid-cols-5 gap-3 rounded-lg bg-chiron-bg-primary/50 p-4">
                        <div className="text-center">
                          <p className="text-[10px] text-chiron-text-muted">DAS</p>
                          <p className="text-sm font-semibold text-chiron-text-primary">{site.PRIMARY_DAS as string || "N/A"}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] text-chiron-text-muted">Inverters</p>
                          <p className="text-sm font-semibold text-chiron-text-primary">{site.INVERTER_COUNT as number || 0}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] text-chiron-text-muted">Phase</p>
                          <p className="text-sm font-semibold text-chiron-text-primary">{site.DELIVERY_PHASE as string || "N/A"}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] text-chiron-text-muted">Alerts</p>
                          <p className={cn("text-sm font-semibold", alertCount > 0 ? "text-red-400" : "text-green-400")}>{alertCount}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] text-chiron-text-muted">7d Loss</p>
                          <p className="text-sm font-semibold text-red-400">${formatNumber(revenueImpact?.lost_revenue_usd || 0, 0)}</p>
                        </div>
                      </div>

                      {/* Anomalies + Maintenance Score */}
                      <div className="grid grid-cols-2 gap-3">
                        {(anomalyData?.anomalies?.length ?? 0) > 0 && (
                          <Card className="!bg-chiron-bg-primary/50 !border-amber-500/30 !p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <Sparkles className="h-4 w-4 text-amber-400" />
                              <span className="text-sm font-semibold text-chiron-text-primary">Anomalies (24h)</span>
                              <Badge color="amber" size="xs">{anomalyData?.anomalies?.length ?? 0}</Badge>
                            </div>
                            <div className="space-y-1 max-h-24 overflow-y-auto">
                              {(anomalyData?.anomalies ?? []).slice(0, 3).map(
                                (anomaly: { type: string; severity: string; description: string }, i: number) => (
                                  <div key={i} className="flex items-center gap-2 text-xs">
                                    <div className={cn("w-1.5 h-1.5 rounded-full", anomaly.severity === "high" ? "bg-red-500" : anomaly.severity === "medium" ? "bg-amber-500" : "bg-blue-500")} />
                                    <span className="text-chiron-text-secondary truncate">{anomaly.description}</span>
                                  </div>
                                )
                              )}
                            </div>
                          </Card>
                        )}

                        {maintenanceScore && (
                          <Card className="!bg-chiron-bg-primary/50 !border-chiron-accent-teal/20 !p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <Wrench className="h-4 w-4 text-chiron-accent-teal" />
                              <span className="text-sm font-semibold text-chiron-text-primary">Maintenance Score</span>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className={cn("text-3xl font-bold", maintenanceScore.score >= 80 ? "text-green-400" : maintenanceScore.score >= 60 ? "text-emerald-400" : maintenanceScore.score >= 40 ? "text-yellow-400" : "text-red-400")}>
                                {maintenanceScore.score}
                              </div>
                              <div className="flex-1">
                                <ProgressBar value={maintenanceScore.score} color={getMaintenanceStatus(maintenanceScore.score).color} className="h-2" />
                                <p className="text-[10px] text-chiron-text-muted mt-1">{getMaintenanceStatus(maintenanceScore.score).label}</p>
                              </div>
                            </div>
                          </Card>
                        )}
                      </div>

                      {/* PR Summary Chart */}
                      {prChartData.length > 0 && (
                        <Card className="!bg-chiron-bg-primary/50 !border-chiron-accent-teal/20">
                          <div className="flex items-center justify-between mb-2">
                            <Title className="!text-chiron-text-primary !text-sm">Performance Trend</Title>
                            <button onClick={() => setActiveTab("performance")} className="text-xs text-chiron-accent-teal hover:underline">
                              Full analysis
                            </button>
                          </div>
                          <LineChart
                            className="h-36"
                            data={prChartData}
                            index="date"
                            categories={["PR %", "Availability %"]}
                            colors={["teal", "orange"]}
                            valueFormatter={(v) => `${formatNumber(v, 1)}%`}
                            showLegend={true}
                            curveType="monotone"
                            minValue={0}
                            maxValue={120}
                            connectNulls={true}
                          />
                        </Card>
                      )}
                    </div>
                  )}

                  {/* ===== INVERTERS TAB ===== */}
                  {activeTab === "inverters" && (
                    <div className="space-y-4">
                      <Card className="!bg-chiron-bg-primary/50 !border-chiron-accent-teal/20">
                        <div className="flex items-center justify-between mb-4">
                          <Title className="!text-chiron-text-primary">Equipment Status</Title>
                          {siteDetails?.alerts && (siteDetails.alerts as Array<Record<string, unknown>>).length > 0 && (
                            <Badge color="red">
                              {(siteDetails.alerts as Array<Record<string, unknown>>).filter((a) => a.ALERT_TYPE === "INVERTER_OFFLINE").length} inverter(s) offline
                            </Badge>
                          )}
                        </div>

                        {/* Site offline banner */}
                        {siteDetails?.alerts && (siteDetails.alerts as Array<Record<string, unknown>>).some((a) => a.ALERT_TYPE === "SITE_OFFLINE") && (
                          <div className="mb-4 p-3 rounded-lg bg-red-500/20 border border-red-500/50">
                            <div className="flex items-center gap-2 text-red-400">
                              <AlertTriangle className="h-5 w-5" />
                              <span className="font-semibold">SITE OFFLINE</span>
                            </div>
                          </div>
                        )}

                        {/* Inverter Grid */}
                        <div className="mt-2">
                          <p className="text-xs text-chiron-text-muted mb-2">Inverters ({(site.INVERTER_COUNT as number) || 0})</p>
                          <div className="flex flex-wrap gap-1.5">
                            {Array.from({ length: (site.INVERTER_COUNT as number) || 0 }, (_, i) => {
                              const invId = `IN${i + 1}_VALUE`;
                              const alerts = (siteDetails?.alerts as Array<Record<string, unknown>>) || [];
                              const isOffline = alerts.some((a) => a.ALERT_TYPE === "INVERTER_OFFLINE" && ((a.EQUIPMENT_ID as string)?.toUpperCase() === invId || (a.EQUIPMENT_NAME as string)?.includes(`${i + 1}`)));
                              const isSiteOffline = alerts.some((a) => a.ALERT_TYPE === "SITE_OFFLINE");
                              return (
                                <div
                                  key={invId}
                                  className={cn(
                                    "w-10 h-10 rounded-md flex items-center justify-center text-xs font-mono font-semibold transition-all",
                                    isSiteOffline ? "bg-red-900/50 text-red-300 border border-red-500/50"
                                      : isOffline ? "bg-red-500 text-white animate-pulse"
                                      : "bg-green-500/20 text-green-400 border border-green-500/30"
                                  )}
                                  title={`Inverter ${i + 1}${isOffline ? " - OFFLINE" : isSiteOffline ? " - Site Offline" : " - OK"}`}
                                >
                                  {i + 1}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </Card>

                      {/* Heatmap */}
                      {heatmapData && heatmapData.inverters && heatmapData.inverters.length > 0 && (
                        <Card className="!bg-chiron-bg-primary/50 !border-chiron-accent-teal/20">
                          <div className="flex items-center justify-between mb-3">
                            <Title className="!text-chiron-text-primary">Inverter Heatmap (5 Days)</Title>
                            <Badge color="teal" size="sm">CF by Hour</Badge>
                          </div>
                          <div className="overflow-x-auto">
                            <div style={{ minWidth: "fit-content" }}>
                              <div className="flex mb-1 ml-14">
                                {(heatmapData.timestamps as string[]).map((ts: string, i: number) => (
                                  <div key={i} className="w-[10px] text-center">
                                    {i % 12 === 0 && (
                                      <span className="text-[8px] text-chiron-text-muted whitespace-nowrap" style={{ marginLeft: "-12px" }}>
                                        {new Date(ts).toLocaleString("en-US", { month: "numeric", day: "numeric" })}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                              {(heatmapData.inverters as string[]).map((inv: string, i: number) => {
                                const values = (heatmapData.data as number[][])[i] || [];
                                const avgVal = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
                                return (
                                  <div key={inv} className="flex items-center mb-[2px]">
                                    <div className="w-14 flex-shrink-0 text-[10px] text-chiron-text-secondary font-mono pr-2 text-right">
                                      {inv.replace("_VALUE", "").replace("IN", "")}
                                    </div>
                                    <div className="flex gap-[1px]">
                                      {values.map((val: number, j: number) => {
                                        const getHeatColor = (cf: number) => {
                                          if (cf < 1) return "bg-slate-900";
                                          if (cf < 10) return "bg-indigo-900";
                                          if (cf < 20) return "bg-blue-600";
                                          if (cf < 30) return "bg-teal-400";
                                          if (cf < 40) return "bg-green-400";
                                          if (cf < 50) return "bg-yellow-400";
                                          return "bg-orange-500";
                                        };
                                        return (
                                          <div
                                            key={j}
                                            className={`w-[9px] h-[14px] rounded-sm ${getHeatColor(val)}`}
                                            title={`${inv.replace("_VALUE", "")} @ ${(heatmapData.timestamps as string[])[j]}: ${val.toFixed(1)}% CF`}
                                          />
                                        );
                                      })}
                                    </div>
                                    <div className="ml-2 text-[10px] text-chiron-text-muted w-8 text-right">{avgVal.toFixed(0)}%</div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </Card>
                      )}

                      {/* String Analysis */}
                      {stringData?.inverters && stringData.inverters.length > 0 && (
                        <Card className="!bg-chiron-bg-primary/50 !border-chiron-accent-teal/20">
                          <div className="flex items-center justify-between mb-3">
                            <Title className="!text-chiron-text-primary">String Analysis</Title>
                            <Link href={`/strings?site=${selectedSite}`} className="text-xs text-chiron-accent-teal hover:underline flex items-center gap-1">
                              Full Analysis <ExternalLink className="h-3 w-3" />
                            </Link>
                          </div>
                          <div className="space-y-2">
                            {stringData.inverters.slice(0, 8).map((inv, i) => {
                              const cf = inv.capacity_factor * 100;
                              const hasIssues = inv.is_outlier || (inv.issues?.length ?? 0) > 0;
                              return (
                                <div key={inv.inverter || `inv-${i}`} className="flex items-center gap-3">
                                  <span className="w-14 text-xs text-chiron-text-muted font-mono">{inv.inverter?.replace("_VALUE", "") || `INV${i + 1}`}</span>
                                  <div className="flex-1">
                                    <ProgressBar value={cf} color={hasIssues ? "red" : cf >= 30 ? "green" : cf >= 20 ? "yellow" : "orange"} className="h-2" />
                                  </div>
                                  <span className="w-12 text-xs text-chiron-text-primary text-right">{formatNumber(cf, 1)}%</span>
                                  {hasIssues && <AlertTriangle className="h-3 w-3 text-red-400" />}
                                </div>
                              );
                            })}
                          </div>
                        </Card>
                      )}
                    </div>
                  )}

                  {/* ===== PERFORMANCE TAB ===== */}
                  {activeTab === "performance" && (
                    <div className="space-y-4">
                      {performanceData?.pr_summary && (
                        <Card className="!bg-chiron-bg-primary/50 !border-chiron-accent-teal/20">
                          <div className="flex items-center justify-between">
                            <Title className="!text-chiron-text-primary">Performance Ratio</Title>
                            {performanceData.pr_summary.pr !== null && (
                              <Badge
                                color={(performanceData.pr_summary.pr as number) >= 95 ? "green" : (performanceData.pr_summary.pr as number) >= 85 ? "yellow" : "red"}
                                size="lg"
                              >
                                {formatNumber(performanceData.pr_summary.pr as number, 1)}%
                              </Badge>
                            )}
                          </div>
                          {performanceData.pr_summary.data_quality === "good" && (
                            <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
                              <div>
                                <p className="text-chiron-text-muted">Actual</p>
                                <p className="font-medium text-chiron-text-primary">{formatNumber(performanceData.pr_summary.actual_production_kwh as number, 0)} kWh</p>
                              </div>
                              <div>
                                <p className="text-chiron-text-muted">Expected</p>
                                <p className="font-medium text-chiron-text-primary">{formatNumber(performanceData.pr_summary.weather_adjusted_expected_kwh as number, 0)} kWh</p>
                              </div>
                              <div>
                                <p className="text-chiron-text-muted">Weather Adj.</p>
                                <p className="font-medium text-amber-400">{formatNumber(performanceData.pr_summary.weather_adjustment_factor as number, 2)}x</p>
                              </div>
                            </div>
                          )}
                          {prChartData.length > 0 && (
                            <LineChart
                              className="mt-4 h-48"
                              data={prChartData}
                              index="date"
                              categories={["PR %", "Availability %"]}
                              colors={["teal", "orange"]}
                              valueFormatter={(v) => `${formatNumber(v, 1)}%`}
                              showLegend={true}
                              curveType="monotone"
                              minValue={0}
                              maxValue={120}
                              connectNulls={true}
                            />
                          )}
                          {prChartData.length === 0 && (
                            <div className="mt-4 flex h-40 items-center justify-center text-chiron-text-muted">No performance data available</div>
                          )}
                        </Card>
                      )}
                    </div>
                  )}

                  {/* ===== ALERTS TAB ===== */}
                  {activeTab === "alerts" && (
                    <div className="space-y-4">
                      <Card className="!bg-chiron-bg-primary/50 !border-chiron-accent-teal/20">
                        <div className="flex items-center justify-between mb-4">
                          <Title className="!text-chiron-text-primary">Alert History (30 Days)</Title>
                          <Link href={`/issues?site=${selectedSite}`} className="text-xs text-chiron-accent-teal hover:underline flex items-center gap-1">
                            View in Issues <ExternalLink className="h-3 w-3" />
                          </Link>
                        </div>

                        {(!siteAlerts?.alerts || siteAlerts.alerts.length === 0) ? (
                          <div className="flex h-32 items-center justify-center text-chiron-text-muted">
                            <CheckCircle className="h-6 w-6 mr-2 opacity-50" />
                            No alerts in the last 30 days
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {(siteAlerts.alerts as Array<Record<string, unknown>>).map((alert, i) => {
                              const severity = ((alert.SEVERITY as string) || "").toUpperCase();
                              const verification = ((alert.VERIFICATION_STATUS as string) || "").toUpperCase();
                              return (
                                <div
                                  key={`${alert.ALERT_ID}-${i}`}
                                  className="flex items-center gap-3 p-3 rounded-lg bg-chiron-bg-tertiary/50 border border-chiron-accent-teal/5"
                                >
                                  <div className={cn(
                                    "p-1.5 rounded",
                                    severity === "HIGH" || severity === "CRITICAL" ? "bg-red-500/20" : severity === "MEDIUM" ? "bg-amber-500/20" : "bg-blue-500/20"
                                  )}>
                                    <AlertTriangle className={cn(
                                      "h-3.5 w-3.5",
                                      severity === "HIGH" || severity === "CRITICAL" ? "text-red-400" : severity === "MEDIUM" ? "text-amber-400" : "text-blue-400"
                                    )} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-chiron-text-primary">
                                      {((alert.ALERT_TYPE as string) || "").replace(/_/g, " ")}
                                      {alert.EQUIPMENT_NAME && <span className="text-chiron-text-muted"> ({alert.EQUIPMENT_NAME as string})</span>}
                                    </p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      <span className="text-[10px] text-chiron-text-muted flex items-center gap-1">
                                        <Clock className="h-3 w-3" />
                                        {alert.DETECTED_AT ? formatDateTime(alert.DETECTED_AT as string) : "Unknown"}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge
                                      color={severity === "HIGH" || severity === "CRITICAL" ? "red" : severity === "MEDIUM" ? "amber" : "blue"}
                                      size="xs"
                                    >
                                      {severity || "N/A"}
                                    </Badge>
                                    {verification && (
                                      <Badge
                                        color={verification === "CONFIRMED" ? "red" : verification === "FALSE_POSITIVE" ? "green" : "gray"}
                                        size="xs"
                                      >
                                        {verification}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </Card>
                    </div>
                  )}

                  {/* ===== FINANCIALS TAB ===== */}
                  {activeTab === "financials" && (
                    <div className="space-y-4">
                      {revenueImpact ? (
                        <Card className="!bg-chiron-bg-primary/50 !border-chiron-accent-teal/20">
                          <div className="flex items-center justify-between mb-4">
                            <Title className="!text-chiron-text-primary">Revenue Impact (7 Days)</Title>
                            <Link href="/revenue" className="text-xs text-chiron-accent-teal hover:underline flex items-center gap-1">
                              Fleet View <ExternalLink className="h-3 w-3" />
                            </Link>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 rounded-lg bg-chiron-bg-tertiary text-center">
                              <DollarSign className="h-6 w-6 text-red-400 mx-auto mb-2" />
                              <p className="text-2xl font-bold text-red-400">${formatNumber(revenueImpact.lost_revenue_usd || 0, 0)}</p>
                              <p className="text-xs text-chiron-text-muted">Total Loss</p>
                            </div>
                            <div className="p-4 rounded-lg bg-chiron-bg-tertiary text-center">
                              <Activity className="h-6 w-6 text-amber-400 mx-auto mb-2" />
                              <p className="text-2xl font-bold text-chiron-text-primary">{formatNumber(revenueImpact.lost_kwh || 0, 0)} kWh</p>
                              <p className="text-xs text-chiron-text-muted">Lost Energy</p>
                            </div>
                          </div>
                          {revenueImpact.projected_annual_loss_usd > 0 && (
                            <div className="mt-4 p-3 rounded-lg bg-chiron-bg-tertiary">
                              <p className="text-xs text-chiron-text-muted mb-1">Projected Annual Loss</p>
                              <p className="text-xl font-bold text-red-400">${formatNumber(revenueImpact.projected_annual_loss_usd, 0)}</p>
                            </div>
                          )}
                        </Card>
                      ) : (
                        <div className="flex h-40 items-center justify-center text-chiron-text-muted">
                          <DollarSign className="h-8 w-8 mr-2 opacity-50" />
                          No revenue data available
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-chiron-text-muted">
                <Building2 className="h-16 w-16 opacity-30" />
                <p className="mt-4">Select a site to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
