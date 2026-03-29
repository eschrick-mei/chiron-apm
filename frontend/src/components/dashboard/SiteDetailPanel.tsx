"use client";

import { useSiteFull } from "@/hooks/useFleetData";
import { formatCapacity, formatNumber, cn } from "@/lib/utils";
import { Card, Title, AreaChart, LineChart, Badge, Text } from "@tremor/react";
import { ExternalLink, Zap, Sun, Activity, TrendingUp, AlertTriangle, Cpu, CheckCircle } from "lucide-react";
import Link from "next/link";

interface SiteDetailPanelProps {
  siteId: string;
}

export function SiteDetailPanel({ siteId }: SiteDetailPanelProps) {
  const { data: fullData, isLoading } = useSiteFull(siteId);

  // Destructure sub-payloads from the combined response
  const siteData = fullData ? { site: fullData.site, alerts: fullData.alerts, equipment: fullData.equipment, latest_values: fullData.latest_values } : undefined;
  const metricsData = fullData?.metrics;
  const performanceData = fullData?.performance;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-24 animate-pulse rounded-xl bg-chiron-bg-tertiary" />
        <div className="h-48 animate-pulse rounded-xl bg-chiron-bg-tertiary" />
        <div className="h-32 animate-pulse rounded-xl bg-chiron-bg-tertiary" />
      </div>
    );
  }

  if (!siteData) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-chiron-accent-teal/20 bg-chiron-gradient">
        <p className="text-chiron-text-muted">Site not found</p>
      </div>
    );
  }

  const site = siteData.site as Record<string, unknown>;
  const alerts = siteData.alerts as Array<Record<string, unknown>>;
  const equipment = siteData.equipment as Array<Record<string, unknown>> | undefined;
  const primaryDas = (site.PRIMARY_DAS as string)?.toUpperCase() || "";

  // Build DAS link
  let dasLink: string | null = null;
  if (primaryDas === "ALSOENERGY" || primaryDas === "AE" || primaryDas === "LOCUS") {
    const aeId = site.ALSOENERGY_SITE_ID;
    if (aeId) dasLink = `https://apps.alsoenergy.com/powertrack/S${aeId}/overview/dashboard`;
  } else if (primaryDas === "SOLAREDGE" || primaryDas === "SE") {
    const seId = site.SOLAREDGE_SITE_ID;
    if (seId) dasLink = `https://monitoring.solaredge.com/one#/commercial/dashboard?siteId=${seId}`;
  }

  // Production chart data
  const chartData = metricsData?.data?.map((d: Record<string, unknown>) => ({
    time: new Date(d.MEASUREMENTTIME as string).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "2-digit",
    }),
    "Inverter": Math.max(0, (d.INV_TOTAL_ENERGY as number) || 0),
    "Meter": Math.max(0, (d.METER_ENERGY as number) || 0),
  })) || [];

  // PR data
  const prSummary = performanceData?.pr_summary as Record<string, unknown> | undefined;
  const prValue = prSummary?.pr as number | null;

  const prChartData = performanceData?.daily_data?.map((d: Record<string, unknown>) => ({
    date: d.DATE as string,
    "PR %": d.PR_PCT as number || null,
    "Availability %": ((d.AVAILABILITY_PCT as number) || 0) * 100,
  })).filter((d: Record<string, unknown>) => d["PR %"] !== null) || [];

  // Build inverter list from equipment or from count
  const inverterCount = (site.INVERTER_COUNT as number) || 0;
  const offlineInverters = new Set(
    alerts
      .filter((a) => a.ALERT_TYPE === "INVERTER_OFFLINE")
      .map((a) => (a.EQUIPMENT_ID as string)?.toUpperCase() || (a.EQUIPMENT_NAME as string) || "")
  );
  const hasSiteOffline = alerts.some((a) => a.ALERT_TYPE === "SITE_OFFLINE");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-chiron-accent-teal/20 bg-chiron-gradient p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-chiron-accent-teal">{siteId}</h2>
              <Badge color={alerts.length > 0 ? "red" : "green"}>
                {alerts.length > 0 ? `${alerts.length} Alert${alerts.length > 1 ? "s" : ""}` : "Healthy"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-chiron-text-secondary">{site.SITE_NAME as string}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/sites?site=${siteId}`}
              className="flex items-center gap-1 rounded-lg border border-chiron-accent-teal/30 px-3 py-1.5 text-xs text-chiron-accent-teal transition-all hover:bg-chiron-accent-teal/10"
            >
              Deep Dive <ExternalLink className="h-3 w-3" />
            </Link>
            {dasLink && (
              <a
                href={dasLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 rounded-lg border border-chiron-accent-purple/30 px-3 py-1.5 text-xs text-chiron-accent-purple transition-all hover:bg-chiron-accent-purple/10"
              >
                DAS <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>

        {/* Quick stats - 5 columns */}
        <div className="mt-4 grid grid-cols-5 gap-3">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-chiron-text-muted">
              <Zap className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase">Capacity</span>
            </div>
            <p className="mt-0.5 text-base font-semibold text-chiron-text-primary">
              {formatCapacity((site.SIZE_KW_DC as number) || 0)}
            </p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-chiron-text-muted">
              <Cpu className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase">Inverters</span>
            </div>
            <p className="mt-0.5 text-base font-semibold text-chiron-text-primary">
              {formatNumber(inverterCount)}
            </p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-chiron-text-muted">
              <Sun className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase">DAS</span>
            </div>
            <p className="mt-0.5 text-base font-semibold text-chiron-text-primary">
              {site.PRIMARY_DAS as string || "N/A"}
            </p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-chiron-text-muted">
              <Activity className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase">Phase</span>
            </div>
            <p className="mt-0.5 text-base font-semibold text-chiron-text-primary">
              {site.DELIVERY_PHASE as string || "N/A"}
            </p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-chiron-text-muted">
              <TrendingUp className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase">30d PR</span>
            </div>
            <p className={cn("mt-0.5 text-base font-semibold",
              prValue === null ? "text-chiron-text-muted" :
              prValue >= 95 ? "text-green-500" :
              prValue >= 85 ? "text-amber-500" : "text-red-500"
            )}>
              {prValue !== null ? `${formatNumber(prValue, 1)}%` : "N/A"}
            </p>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase text-red-400">Active Alerts</h3>
          <div className="space-y-1.5">
            {alerts.slice(0, 5).map((alert, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-chiron-bg-primary/50 px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <span className={alert.VERIFICATION_STATUS === "CONFIRMED" ? "text-red-400" : "text-amber-400"}>
                    {alert.ALERT_TYPE === "SITE_OFFLINE" ? "🔴" : "🟡"}
                  </span>
                  <span className="text-xs text-chiron-text-primary">
                    {(alert.ALERT_TYPE as string)?.replace(/_/g, " ")}
                  </span>
                  {(alert.EQUIPMENT_NAME as string) && (
                    <span className="text-xs text-chiron-text-muted">- {alert.EQUIPMENT_NAME as string}</span>
                  )}
                </div>
                <Badge color={alert.VERIFICATION_STATUS === "CONFIRMED" ? "red" : "amber"} size="xs">
                  {alert.VERIFICATION_STATUS as string}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts — side by side in the wider pane */}
      <div className="grid grid-cols-2 gap-4">
        {/* Production Chart */}
        <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20 !p-4">
          <Title className="!text-chiron-text-primary !text-sm">Production (7 Days)</Title>
          {chartData.length > 0 ? (
            <AreaChart
              className="mt-2 h-44"
              data={chartData}
              index="time"
              categories={["Inverter", "Meter"]}
              colors={["teal", "indigo"]}
              valueFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k kWh` : `${formatNumber(v, 0)} kWh`}
              showLegend={true}
              curveType="monotone"
              autoMinValue={true}
              minValue={0}
            />
          ) : (
            <div className="flex h-32 items-center justify-center"><Text>No production data</Text></div>
          )}
        </Card>

        {/* PR Trend */}
        <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20 !p-4">
          <div className="flex items-center justify-between">
            <Title className="!text-chiron-text-primary !text-sm">PR Trend</Title>
            {prSummary && (
              <div className="text-right text-[10px] text-chiron-text-muted">
                <div>Actual: {formatNumber((prSummary.actual_production_kwh as number) || 0, 0)} kWh</div>
                <div>Expected: {formatNumber((prSummary.weather_adjusted_expected_kwh as number) || 0, 0)} kWh</div>
              </div>
            )}
          </div>
          {prChartData.length > 0 ? (
            <LineChart
              className="mt-2 h-44"
              data={prChartData}
              index="date"
              categories={["PR %", "Availability %"]}
              colors={["teal", "orange"]}
              valueFormatter={(v) => `${formatNumber(v, 1)}%`}
              showLegend={true}
              curveType="monotone"
              minValue={0}
              maxValue={120}
            />
          ) : (
            <div className="flex h-32 items-center justify-center"><Text>No PR data</Text></div>
          )}
        </Card>
      </div>

      {/* Equipment List */}
      <div className="rounded-xl border border-chiron-accent-teal/20 bg-chiron-gradient p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-chiron-text-primary flex items-center gap-2">
            <Cpu className="h-4 w-4 text-chiron-accent-teal" />
            Equipment ({inverterCount} inverters)
          </h3>
          {hasSiteOffline && (
            <Badge color="red" size="sm">Site Offline</Badge>
          )}
          {!hasSiteOffline && offlineInverters.size > 0 && (
            <Badge color="amber" size="sm">{offlineInverters.size} offline</Badge>
          )}
        </div>

        {/* Inverter grid tiles */}
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: inverterCount }, (_, i) => {
            const invId = `IN${i + 1}_VALUE`;
            const isOffline = offlineInverters.has(invId) ||
              alerts.some((a) =>
                a.ALERT_TYPE === "INVERTER_OFFLINE" &&
                (a.EQUIPMENT_NAME as string)?.includes(`${i + 1}`)
              );

            return (
              <div
                key={invId}
                className={cn(
                  "w-9 h-9 rounded-md flex items-center justify-center text-[11px] font-mono font-semibold transition-all",
                  hasSiteOffline
                    ? "bg-red-900/50 text-red-300 border border-red-500/50"
                    : isOffline
                    ? "bg-red-500 text-white"
                    : "bg-green-500/20 text-green-400 border border-green-500/30"
                )}
                title={`INV ${i + 1}${isOffline ? " — OFFLINE" : hasSiteOffline ? " — Site Offline" : " — OK"}`}
              >
                {i + 1}
              </div>
            );
          })}
        </div>

        {/* Meter alerts */}
        {alerts.some((a) => a.ALERT_TYPE === "METER_OFFLINE") && (
          <div className="mt-3 pt-3 border-t border-chiron-accent-teal/10">
            <p className="text-[10px] text-chiron-text-muted mb-1.5">Meters</p>
            <div className="flex gap-2">
              {alerts.filter((a) => a.ALERT_TYPE === "METER_OFFLINE").map((alert, i) => (
                <div key={i} className="px-2 py-1 rounded-md bg-amber-500/20 border border-amber-500/50 text-amber-400 text-xs">
                  {(alert.EQUIPMENT_NAME as string) || `Meter ${i + 1}`} — Offline
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Additional equipment from API */}
        {equipment && equipment.length > 0 && (
          <div className="mt-3 pt-3 border-t border-chiron-accent-teal/10">
            <p className="text-[10px] text-chiron-text-muted mb-1.5">All Equipment</p>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {equipment.map((eq, i) => {
                const eqType = (eq.EQUIPMENT_TYPE as string) || "Unknown";
                const eqName = (eq.EQUIPMENT_NAME as string) || (eq.EQUIPMENT_ID as string) || `Equipment ${i + 1}`;
                const eqStatus = (eq.STATUS as string)?.toUpperCase();
                const isOnline = !eqStatus || eqStatus === "ONLINE" || eqStatus === "ACTIVE";
                return (
                  <div key={i} className="flex items-center justify-between px-2 py-1 rounded bg-chiron-bg-primary/30 text-xs">
                    <div className="flex items-center gap-2">
                      <div className={cn("w-1.5 h-1.5 rounded-full", isOnline ? "bg-green-500" : "bg-red-500")} />
                      <span className="text-chiron-text-secondary">{eqName}</span>
                    </div>
                    <span className="text-chiron-text-muted">{eqType}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
