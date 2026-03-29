"use client";

import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { useFleetRevenueImpact } from "@/hooks/useFleetData";
import { formatNumber, formatCapacity, cn } from "@/lib/utils";
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  Building2,
  Zap,
  Calendar,
  RefreshCw,
  ExternalLink,
  WifiOff,
  BarChart3,
} from "lucide-react";
import { Card, Title, BarChart, Badge, ProgressBar } from "@tremor/react";
import Link from "next/link";

export default function RevenueImpactPage() {
  const [stage, setStage] = useState("FC");
  const [days, setDays] = useState(7);
  const [energyPrice, setEnergyPrice] = useState(0.08);

  const { data, isLoading, refetch, isFetching } = useFleetRevenueImpact(
    stage,
    energyPrice,
    days
  );

  const chartData =
    data?.sites.slice(0, 15).map((site) => {
      const siteName = site.site_name || "";
      const truncatedName = siteName.length > 12 ? siteName.substring(0, 12) + "..." : siteName;
      return {
        name: `${site.site_id}${truncatedName ? ` (${truncatedName})` : ""}`,
        "Revenue Loss ($)": Math.round(site.period_loss_usd),
        "kW Offline": site.kw_offline,
      };
    }) || [];

  return (
    <div className="flex h-screen flex-col">
      <Header
        title="Revenue Impact"
        subtitle="Financial impact analysis of fleet outages and underperformance"
        onRefresh={() => refetch()}
        isLoading={isFetching}
      />

      <div className="flex-1 overflow-y-auto p-6">
        {/* Controls */}
        <div className="mb-6 flex items-center gap-4 flex-wrap">
          {/* Stage Filter */}
          <div className="flex items-center gap-2 rounded-lg border border-chiron-accent-teal/20 bg-chiron-gradient p-1">
            {["FC", "Pre-FC", "All"].map((s) => (
              <button
                key={s}
                onClick={() => setStage(s)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                  stage === s
                    ? "bg-chiron-accent-teal text-white"
                    : "text-chiron-text-muted hover:text-chiron-text-primary"
                )}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Days Filter */}
          <div className="flex items-center gap-2 rounded-lg border border-chiron-accent-teal/20 bg-chiron-gradient p-1">
            {[1, 7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                  days === d
                    ? "bg-chiron-accent-purple text-white"
                    : "text-chiron-text-muted hover:text-chiron-text-primary"
                )}
              >
                {d}d
              </button>
            ))}
          </div>

          {/* Energy Price */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-chiron-text-muted">$/kWh:</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max="1"
              value={energyPrice}
              onChange={(e) => setEnergyPrice(parseFloat(e.target.value) || 0.08)}
              className="w-20 px-2 py-1.5 rounded-md bg-chiron-bg-tertiary border border-chiron-accent-teal/20 text-sm text-chiron-text-primary focus:outline-none focus:border-chiron-accent-teal"
            />
          </div>
        </div>

        {/* KPIs */}
        {data?.summary && (
          <div className="mb-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title="Total Revenue Loss"
              value={`$${formatNumber(data.summary.total_lost_revenue_usd, 0)}`}
              subtitle={`Over ${data.summary.period_days} days`}
              icon={DollarSign}
              status={data.summary.total_lost_revenue_usd > 5000 ? "danger" : "warning"}
            />
            <KpiCard
              title="Projected Annual Loss"
              value={`$${formatNumber(data.summary.projected_annual_loss_usd, 0)}`}
              subtitle="If current issues persist"
              icon={TrendingDown}
              status={data.summary.projected_annual_loss_usd > 100000 ? "danger" : "warning"}
            />
            <KpiCard
              title="Capacity Offline"
              value={formatCapacity(data.summary.total_kw_offline)}
              subtitle={`${formatNumber(data.summary.offline_percentage, 2)}% of fleet`}
              icon={Zap}
              status={data.summary.offline_percentage > 5 ? "danger" : "warning"}
            />
            <KpiCard
              title="Sites Impacted"
              value={formatNumber(data.summary.total_sites_impacted)}
              subtitle="With revenue loss"
              icon={Building2}
              status={data.summary.total_sites_impacted > 10 ? "danger" : "warning"}
            />
          </div>
        )}

        {/* Main Content */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Chart */}
          <div className="lg:col-span-2">
            <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
              <div className="flex items-center justify-between mb-4">
                <Title className="!text-chiron-text-primary flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-red-400" />
                  Revenue Loss by Site
                </Title>
                <Badge color="gray">{data?.sites?.length || 0} sites impacted</Badge>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center h-80">
                  <RefreshCw className="h-8 w-8 text-chiron-accent-teal animate-spin" />
                </div>
              ) : chartData.length > 0 ? (
                <BarChart
                  className="h-80"
                  data={chartData}
                  index="name"
                  categories={["Revenue Loss ($)"]}
                  colors={["red"]}
                  layout="vertical"
                  valueFormatter={(v) => `$${formatNumber(v, 0)}`}
                  showLegend={false}
                />
              ) : (
                <div className="flex items-center justify-center h-80 text-chiron-text-muted">
                  <TrendingUp className="h-8 w-8 mr-2 text-green-500" />
                  No revenue impact detected
                </div>
              )}
            </Card>
          </div>

          {/* Detailed List */}
          <div>
            <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
              <Title className="!text-chiron-text-primary mb-4">Impacted Sites</Title>

              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-6 w-6 text-chiron-accent-teal animate-spin" />
                  </div>
                ) : !data?.sites || data.sites.length === 0 ? (
                  <p className="text-center text-chiron-text-muted py-8">
                    No impacted sites
                  </p>
                ) : (
                  data.sites.map((site, idx) => (
                    <Link
                      href={`/sites?site=${site.site_id}`}
                      key={site.site_id}
                      className="flex items-center justify-between p-3 rounded-lg border border-chiron-accent-teal/20 bg-chiron-bg-tertiary hover:border-chiron-accent-teal/50 transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                            idx < 3
                              ? "bg-red-500 text-white"
                              : "bg-chiron-bg-primary text-chiron-text-secondary"
                          )}
                        >
                          {idx + 1}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-chiron-text-primary">
                              {site.site_id}
                            </span>
                            {site.site_offline && (
                              <WifiOff className="h-3 w-3 text-red-400" />
                            )}
                          </div>
                          {site.site_name && (
                            <p className="text-xs text-chiron-text-secondary truncate max-w-[120px]">
                              {site.site_name}
                            </p>
                          )}
                          <span className="text-xs text-chiron-text-muted">
                            {formatCapacity(site.kw_offline)} offline
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-semibold text-red-400">
                          ${formatNumber(site.period_loss_usd, 0)}
                        </span>
                        <ExternalLink className="h-3 w-3 ml-2 text-chiron-text-muted opacity-0 group-hover:opacity-100 inline" />
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
