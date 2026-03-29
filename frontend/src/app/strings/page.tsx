"use client";

import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { useFleetSites, useStringAnalysis } from "@/hooks/useFleetData";
import { formatNumber, cn } from "@/lib/utils";
import {
  BarChart3,
  Search,
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  Zap,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import { Card, Title, BarChart, Badge, ProgressBar } from "@tremor/react";

export default function StringAnalysisPage() {
  const [selectedSite, setSelectedSite] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [days, setDays] = useState(7);

  const { data: sitesData } = useFleetSites({ limit: 200 });
  const { data: stringData, isLoading, refetch } = useStringAnalysis(selectedSite, days);

  const filteredSites = (sitesData || []).filter(
    (site) =>
      (site.SITE_ID as string)?.toLowerCase().includes(search.toLowerCase()) ||
      (site.SITE_NAME as string)?.toLowerCase().includes(search.toLowerCase())
  );

  const chartData =
    stringData?.inverters.map((inv) => ({
      name: inv.inverter,
      "Capacity Factor (%)": inv.capacity_factor,
      "Uptime (%)": inv.uptime_pct,
    })) || [];

  return (
    <div className="flex h-screen flex-col">
      <Header
        title="String Analysis"
        subtitle="Detailed inverter-level performance analysis"
        onRefresh={() => refetch()}
        isLoading={isLoading}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Site Selector Sidebar */}
        <div className="w-72 border-r border-chiron-accent-teal/20 bg-chiron-bg-secondary flex flex-col">
          <div className="p-4 border-b border-chiron-accent-teal/20">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-chiron-text-muted" />
              <input
                type="text"
                placeholder="Search sites..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-chiron-bg-tertiary border border-chiron-accent-teal/20 rounded-lg text-sm text-chiron-text-primary placeholder-chiron-text-muted focus:outline-none focus:border-chiron-accent-teal"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {filteredSites.map((site) => (
              <button
                key={site.SITE_ID as string}
                onClick={() => setSelectedSite(site.SITE_ID as string)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors mb-1",
                  selectedSite === site.SITE_ID
                    ? "bg-chiron-accent-teal/20 border border-chiron-accent-teal/40"
                    : "hover:bg-chiron-bg-tertiary border border-transparent"
                )}
              >
                <div>
                  <span className="font-mono text-sm text-chiron-text-primary">
                    {site.SITE_ID as string}
                  </span>
                  <p className="text-xs text-chiron-text-muted truncate max-w-[180px]">
                    {(site.INVERTER_COUNT as number) || 0} inverters
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-chiron-text-muted" />
              </button>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedSite ? (
            <div className="flex flex-col items-center justify-center h-full text-chiron-text-muted">
              <BarChart3 className="h-16 w-16 mb-4" />
              <h3 className="text-lg font-medium">Select a Site</h3>
              <p className="text-sm mt-2">Choose a site from the sidebar to view string analysis</p>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center h-full">
              <RefreshCw className="h-8 w-8 text-chiron-accent-teal animate-spin" />
            </div>
          ) : stringData ? (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-chiron-text-primary">
                    {stringData.site_id}
                  </h2>
                  <p className="text-sm text-chiron-text-muted">
                    {stringData.site_name} • {stringData.inverter_count} inverters •{" "}
                    {formatNumber(stringData.size_kw_dc)} kW DC
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {[3, 7, 14, 30].map((d) => (
                    <button
                      key={d}
                      onClick={() => setDays(d)}
                      className={cn(
                        "px-3 py-1 rounded text-sm transition-colors",
                        days === d
                          ? "bg-chiron-accent-teal text-white"
                          : "text-chiron-text-muted hover:bg-chiron-bg-tertiary"
                      )}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>

              {/* Summary Cards */}
              <div className="grid gap-4 md:grid-cols-4">
                <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20 !p-4">
                  <div className="flex items-center gap-2 text-chiron-text-muted text-sm">
                    <TrendingUp className="h-4 w-4" />
                    Avg Capacity Factor
                  </div>
                  <p className="text-2xl font-bold text-chiron-text-primary mt-1">
                    {formatNumber(stringData.summary.avg_capacity_factor, 1)}%
                  </p>
                </Card>
                <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20 !p-4">
                  <div className="flex items-center gap-2 text-chiron-text-muted text-sm">
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                    Best Performer
                  </div>
                  <p className="text-2xl font-bold text-green-400 mt-1">
                    {stringData.summary.best_performer || "-"}
                  </p>
                </Card>
                <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20 !p-4">
                  <div className="flex items-center gap-2 text-chiron-text-muted text-sm">
                    <TrendingDown className="h-4 w-4 text-red-400" />
                    Worst Performer
                  </div>
                  <p className="text-2xl font-bold text-red-400 mt-1">
                    {stringData.summary.worst_performer || "-"}
                  </p>
                </Card>
                <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20 !p-4">
                  <div className="flex items-center gap-2 text-chiron-text-muted text-sm">
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                    Outliers / Issues
                  </div>
                  <p className="text-2xl font-bold text-amber-400 mt-1">
                    {stringData.summary.outliers_count} / {stringData.summary.total_issues}
                  </p>
                </Card>
              </div>

              {/* Chart */}
              <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
                <Title className="!text-chiron-text-primary">Inverter Capacity Factor Comparison</Title>
                {chartData.length > 0 ? (
                  <BarChart
                    className="h-64 mt-4"
                    data={chartData}
                    index="name"
                    categories={["Capacity Factor (%)"]}
                    colors={["teal"]}
                    valueFormatter={(v) => `${formatNumber(v, 1)}%`}
                  />
                ) : (
                  <div className="h-64 flex items-center justify-center text-chiron-text-muted">
                    No data available
                  </div>
                )}
              </Card>

              {/* Inverter Details Table */}
              <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
                <Title className="!text-chiron-text-primary mb-4">Inverter Details</Title>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-chiron-text-muted border-b border-chiron-accent-teal/20">
                        <th className="pb-3 font-medium">Inverter</th>
                        <th className="pb-3 font-medium text-right">Total kWh</th>
                        <th className="pb-3 font-medium text-right">Avg kW</th>
                        <th className="pb-3 font-medium text-right">Max kW</th>
                        <th className="pb-3 font-medium text-right">CF %</th>
                        <th className="pb-3 font-medium text-right">Uptime %</th>
                        <th className="pb-3 font-medium">Status</th>
                        <th className="pb-3 font-medium">Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stringData.inverters.map((inv) => (
                        <tr
                          key={inv.inverter}
                          className={cn(
                            "border-b border-chiron-accent-teal/10",
                            inv.is_outlier && "bg-amber-500/5"
                          )}
                        >
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <Zap
                                className={cn(
                                  "h-4 w-4",
                                  inv.status === "healthy" ? "text-green-400" : "text-amber-400"
                                )}
                              />
                              <span className="font-mono text-chiron-text-primary">
                                {inv.inverter}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 text-right text-chiron-text-secondary">
                            {formatNumber(inv.total_kwh, 0)}
                          </td>
                          <td className="py-3 text-right text-chiron-text-secondary">
                            {formatNumber(inv.avg_kw, 1)}
                          </td>
                          <td className="py-3 text-right text-chiron-text-secondary">
                            {formatNumber(inv.max_kw, 1)}
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <ProgressBar
                                value={Math.min(100, inv.capacity_factor)}
                                color={inv.capacity_factor >= 50 ? "emerald" : inv.capacity_factor >= 20 ? "amber" : "red"}
                                className="w-16 h-2"
                              />
                              <span className="w-12 text-chiron-text-secondary">
                                {formatNumber(inv.capacity_factor, 1)}%
                              </span>
                            </div>
                          </td>
                          <td className="py-3 text-right">
                            <span
                              className={cn(
                                inv.uptime_pct >= 90
                                  ? "text-green-400"
                                  : inv.uptime_pct >= 50
                                  ? "text-amber-400"
                                  : "text-red-400"
                              )}
                            >
                              {formatNumber(inv.uptime_pct, 1)}%
                            </span>
                          </td>
                          <td className="py-3">
                            <Badge
                              color={inv.status === "healthy" ? "emerald" : "amber"}
                              size="xs"
                            >
                              {inv.status}
                            </Badge>
                          </td>
                          <td className="py-3">
                            {inv.issues.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {inv.issues.map((issue, i) => (
                                  <Badge key={i} color="red" size="xs">
                                    {issue}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <span className="text-chiron-text-muted">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-chiron-text-muted">
              <AlertTriangle className="h-8 w-8 mr-2" />
              Failed to load string analysis data
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
