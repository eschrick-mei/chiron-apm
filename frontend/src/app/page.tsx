"use client";

import { useState, useMemo } from "react";
import { Header } from "@/components/layout/Header";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { FleetTable, type FleetSite } from "@/components/dashboard/FleetTable";
import { FleetStatusBar } from "@/components/dashboard/FleetStatusBar";
import { SiteGrid } from "@/components/dashboard/SiteGrid";
import { SiteDetailPanel } from "@/components/dashboard/SiteDetailPanel";
import {
  useFleetSummary,
  useFleetSites,
  useDasOptions,
  useFleetRevenueImpact,
  usePrioritySummary,
  useAlerts,
} from "@/hooks/useFleetData";
import { formatNumber, formatCapacity, cn } from "@/lib/utils";
import {
  Zap,
  AlertTriangle,
  CheckCircle,
  Filter,
  Search,
  DollarSign,
  Grid3X3,
  List,
  Clock,
  ExternalLink,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@tremor/react";
import Link from "next/link";

type ViewMode = "table" | "grid";

interface PresetFilter {
  label: string;
  key: string;
  color: string;
  description: string;
}

const PRESET_FILTERS: PresetFilter[] = [
  { label: "Needs Attention", key: "needs_attention", color: "bg-amber-500", description: "Sites with active alerts" },
  { label: "Revenue at Risk", key: "revenue_risk", color: "bg-red-500", description: "Sites losing revenue" },
  { label: "Stale Data", key: "stale_data", color: "bg-slate-500", description: "No recent data" },
  { label: "Critical", key: "critical", color: "bg-red-600", description: "Critical severity alerts" },
];

export default function FleetDashboard() {
  const queryClient = useQueryClient();
  const [selectedSite, setSelectedSite] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [dasFilter, setDasFilter] = useState<string>("");
  const [stageFilter, setStageFilter] = useState<string>("FC");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [presetFilter, setPresetFilter] = useState<string>("");

  const { data: summary, isLoading: summaryLoading } = useFleetSummary();
  const { data: sites, isLoading: sitesLoading, refetch } = useFleetSites({
    search: searchTerm || undefined,
    status: statusFilter || undefined,
    das: dasFilter || undefined,
    stage: stageFilter || undefined,
  });
  const { data: dasOptions } = useDasOptions();

  const { data: revenueData } = useFleetRevenueImpact(stageFilter, 0.08, 7);
  const { data: priorityData } = usePrioritySummary(stageFilter, 7);
  const { data: alertsData } = useAlerts({ days: 1, status: "active", stage: stageFilter, limit: 5 });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["fleet"] });
    queryClient.invalidateQueries({ queryKey: ["apm"] });
    queryClient.invalidateQueries({ queryKey: ["priority"] });
    queryClient.invalidateQueries({ queryKey: ["alerts"] });
    refetch();
  };

  // Apply preset filters client-side on top of server filters
  const filteredSites = useMemo(() => {
    const allSites = (sites || []) as FleetSite[];
    if (!presetFilter) return allSites;

    switch (presetFilter) {
      case "needs_attention":
        return allSites.filter((s) => s.has_alert || (s.alert_count || 0) > 0);
      case "revenue_risk":
        return allSites.filter((s) => s.has_alert);
      case "critical":
        return allSites.filter((s) => (s.alert_count || 0) > 0 && s.has_alert);
      case "stale_data":
        return allSites.filter((s) => !s.has_alert && !s.SIZE_KW_DC);
      case "healthy":
        return allSites.filter((s) => !s.has_alert && (s.alert_count || 0) === 0);
      case "alerts":
        return allSites.filter((s) => s.has_alert || (s.alert_count || 0) > 0);
      case "no_data":
        return allSites.filter((s) => !s.SIZE_KW_DC);
      default:
        return allSites;
    }
  }, [sites, presetFilter]);

  const handleStatusBarClick = (filter: string) => {
    setPresetFilter((prev) => (prev === filter ? "" : filter));
  };

  // Calculate status bar counts
  const totalSites = (sites || []).length;
  const healthySites = (sites || []).filter(
    (s: Record<string, unknown>) => !s.has_alert && (s.alert_count as number || 0) === 0
  ).length;
  const alertSites = (sites || []).filter(
    (s: Record<string, unknown>) => s.has_alert || (s.alert_count as number || 0) > 0
  ).length;
  const criticalSites = summary?.site_offline_count || 0;
  const noDataSites = Math.max(0, totalSites - healthySites - alertSites);

  const activeFilterCount = [searchTerm, statusFilter, dasFilter, presetFilter].filter(Boolean).length;

  return (
    <div className="flex h-screen flex-col">
      <Header
        title="Fleet Command"
        subtitle={`Monitoring ${formatNumber(summary?.total_sites || 0)} operational sites | ${formatCapacity((summary?.total_capacity_mw || 0) * 1000)} total capacity`}
        onRefresh={handleRefresh}
        isLoading={summaryLoading || sitesLoading}
      />

      <div className="flex-1 overflow-hidden">
        <div className="flex h-full">
          {/* Main content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Primary KPI Grid */}
            <div className="mb-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                title="Fleet Health"
                value={`${formatNumber(summary?.fleet_health_pct || 0, 1)}%`}
                subtitle={`${formatNumber(summary?.healthy_sites || 0)} of ${formatNumber(summary?.total_sites || 0)} sites healthy`}
                icon={CheckCircle}
                status={
                  (summary?.fleet_health_pct || 0) >= 95
                    ? "success"
                    : (summary?.fleet_health_pct || 0) >= 85
                    ? "warning"
                    : "danger"
                }
              />
              <KpiCard
                title="Active Alerts"
                value={formatNumber(summary?.total_alerts || 0)}
                subtitle={`${formatNumber(summary?.confirmed_alerts || 0)} confirmed, ${formatNumber(summary?.sites_with_alerts || 0)} sites affected`}
                icon={AlertTriangle}
                status={
                  (summary?.total_alerts || 0) === 0
                    ? "success"
                    : (summary?.total_alerts || 0) < 10
                    ? "warning"
                    : "danger"
                }
              />
              <KpiCard
                title="Revenue at Risk"
                value={`$${formatNumber(revenueData?.summary?.total_lost_revenue_usd || 0, 0)}`}
                subtitle={`7-day loss | $${formatNumber((revenueData?.summary?.projected_annual_loss_usd || 0), 0)}/yr projected`}
                icon={DollarSign}
                status={
                  (revenueData?.summary?.total_lost_revenue_usd || 0) > 5000
                    ? "danger"
                    : (revenueData?.summary?.total_lost_revenue_usd || 0) > 1000
                    ? "warning"
                    : "success"
                }
              />
              <KpiCard
                title="Capacity Offline"
                value={formatCapacity(revenueData?.summary?.total_kw_offline || 0)}
                subtitle={`${formatNumber(revenueData?.summary?.offline_percentage || 0, 2)}% of fleet capacity`}
                icon={Zap}
                status={
                  (revenueData?.summary?.offline_percentage || 0) > 5
                    ? "danger"
                    : (revenueData?.summary?.offline_percentage || 0) > 2
                    ? "warning"
                    : "success"
                }
              />
            </div>

            {/* Fleet Status Bar (3B.1) */}
            <div className="mb-5">
              <FleetStatusBar
                total={totalSites}
                healthy={healthySites}
                withAlerts={alertSites}
                critical={criticalSites}
                noData={noDataSites}
                onSegmentClick={handleStatusBarClick}
                activeFilter={presetFilter}
              />
            </div>

            {/* Recent Alerts Preview */}
            {alertsData && alertsData.alerts && alertsData.alerts.length > 0 && (
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-chiron-text-primary flex items-center gap-2">
                    <Clock className="h-4 w-4 text-chiron-accent-teal" />
                    Recent Alerts (24h)
                  </h3>
                  <Link
                    href="/issues"
                    className="text-xs text-chiron-accent-teal hover:underline flex items-center gap-1"
                  >
                    View all <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
                <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-5">
                  {(alertsData.alerts.slice(0, 5) as Array<{
                    ALERT_ID: string;
                    SITE_ID: string;
                    ALERT_TYPE: string;
                    SEVERITY: string;
                  }>).map((alert) => (
                    <button
                      key={alert.ALERT_ID}
                      onClick={() => setSelectedSite(alert.SITE_ID)}
                      className="flex items-center gap-2 p-2 rounded-lg border border-chiron-accent-teal/20 bg-chiron-bg-tertiary hover:border-chiron-accent-teal/40 transition-colors text-left"
                    >
                      <div
                        className={cn(
                          "p-1 rounded shrink-0",
                          alert.SEVERITY === "HIGH"
                            ? "bg-red-500/20"
                            : alert.SEVERITY === "MEDIUM"
                            ? "bg-amber-500/20"
                            : "bg-blue-500/20"
                        )}
                      >
                        <AlertTriangle
                          className={cn(
                            "h-3 w-3",
                            alert.SEVERITY === "HIGH"
                              ? "text-red-400"
                              : alert.SEVERITY === "MEDIUM"
                              ? "text-amber-400"
                              : "text-blue-400"
                          )}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-chiron-text-primary truncate">
                          {alert.SITE_ID}
                        </p>
                        <p className="text-[10px] text-chiron-text-muted truncate">
                          {alert.ALERT_TYPE.replace(/_/g, " ")}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Smart Preset Filters (3B.5) + View Toggle + Filters */}
            <div className="mb-4 space-y-3">
              {/* Preset filter row */}
              <div className="flex items-center gap-2 flex-wrap">
                {PRESET_FILTERS.map((pf) => (
                  <button
                    key={pf.key}
                    onClick={() => setPresetFilter((prev) => (prev === pf.key ? "" : pf.key))}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
                      presetFilter === pf.key
                        ? "border-chiron-accent-teal bg-chiron-accent-teal/10 text-chiron-text-primary"
                        : "border-chiron-accent-teal/20 bg-chiron-gradient text-chiron-text-muted hover:text-chiron-text-primary hover:border-chiron-accent-teal/40"
                    )}
                    title={pf.description}
                  >
                    <span className={cn("h-2 w-2 rounded-full", pf.color)} />
                    {pf.label}
                  </button>
                ))}

                <div className="flex-1" />

                {/* View mode toggle */}
                <div className="flex items-center gap-1 rounded-lg border border-chiron-accent-teal/20 bg-chiron-gradient p-0.5">
                  <button
                    onClick={() => setViewMode("table")}
                    className={cn(
                      "p-1.5 rounded transition-all",
                      viewMode === "table"
                        ? "bg-chiron-accent-teal text-white"
                        : "text-chiron-text-muted hover:text-chiron-text-primary"
                    )}
                    title="Table view"
                  >
                    <List className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setViewMode("grid")}
                    className={cn(
                      "p-1.5 rounded transition-all",
                      viewMode === "grid"
                        ? "bg-chiron-accent-teal text-white"
                        : "text-chiron-text-muted hover:text-chiron-text-primary"
                    )}
                    title="Grid view"
                  >
                    <Grid3X3 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Standard filters row */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Stage Filter */}
                <div className="flex items-center gap-1 rounded-lg border border-chiron-accent-teal/20 bg-chiron-gradient p-0.5">
                  {["FC", "Pre-FC", "All"].map((s) => (
                    <button
                      key={s}
                      onClick={() => setStageFilter(s)}
                      className={cn(
                        "px-3 py-1 rounded-md text-xs font-medium transition-all",
                        stageFilter === s
                          ? "bg-chiron-accent-teal text-white"
                          : "text-chiron-text-muted hover:text-chiron-text-primary"
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>

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

                <div className="flex items-center gap-2">
                  <Filter className="h-3.5 w-3.5 text-chiron-text-muted" />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="rounded-lg border border-chiron-accent-teal/20 bg-chiron-bg-tertiary px-2 py-1.5 text-xs text-chiron-text-primary focus:border-chiron-accent-teal focus:outline-none"
                  >
                    <option value="">All Status</option>
                    <option value="healthy">Healthy</option>
                    <option value="alerts">With Alerts</option>
                  </select>

                  <select
                    value={dasFilter}
                    onChange={(e) => setDasFilter(e.target.value)}
                    className="rounded-lg border border-chiron-accent-teal/20 bg-chiron-bg-tertiary px-2 py-1.5 text-xs text-chiron-text-primary focus:border-chiron-accent-teal focus:outline-none"
                  >
                    <option value="">All DAS</option>
                    {dasOptions?.map((das) => (
                      <option key={das} value={das}>
                        {das}
                      </option>
                    ))}
                  </select>
                </div>

                <span className="text-xs text-chiron-text-muted">
                  {filteredSites.length} sites
                </span>

                {activeFilterCount > 0 && (
                  <button
                    onClick={() => {
                      setSearchTerm("");
                      setStatusFilter("");
                      setDasFilter("");
                      setPresetFilter("");
                    }}
                    className="flex items-center gap-1 text-xs text-chiron-accent-teal hover:underline"
                  >
                    <X className="h-3 w-3" />
                    Clear all
                  </button>
                )}
              </div>
            </div>

            {/* Site View - Table or Grid */}
            {viewMode === "table" ? (
              <FleetTable
                sites={filteredSites as FleetSite[]}
                selectedSite={selectedSite}
                onSelectSite={setSelectedSite}
                isLoading={sitesLoading}
              />
            ) : (
              <SiteGrid
                sites={filteredSites as Array<{
                  SITE_ID: string;
                  SITE_NAME: string | null;
                  SIZE_KW_DC: number | null;
                  PRIMARY_DAS: string | null;
                  INVERTER_COUNT: number | null;
                  has_alert?: boolean;
                }>}
                selectedSite={selectedSite}
                onSelectSite={setSelectedSite}
                isLoading={sitesLoading}
              />
            )}
          </div>

          {/* Detail Panel — takes 55% of viewport when open */}
          {selectedSite && (
            <div className="w-[55vw] max-w-[1100px] min-w-[600px] flex-shrink-0 overflow-y-auto border-l border-chiron-accent-teal/20 bg-chiron-bg-secondary p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-chiron-text-primary">
                  Site Details
                </h2>
                <button
                  onClick={() => setSelectedSite(null)}
                  className="rounded-lg p-1 text-chiron-text-muted hover:bg-chiron-bg-tertiary hover:text-chiron-text-primary"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <SiteDetailPanel siteId={selectedSite} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
