"use client";

import { useState, useMemo } from "react";
import { Header } from "@/components/layout/Header";
import { KpiCard } from "@/components/dashboard/KpiCard";
import {
  useAlerts,
  useAlertStats,
  useAlertDetail,
  usePriorityQueue,
  usePrioritySummary,
} from "@/hooks/useFleetData";
import {
  formatNumber,
  formatDuration,
  formatDateTime,
  getAlertTypeLabel,
  cn,
} from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Search,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Target,
  Filter,
  Zap,
  WifiOff,
  Cpu,
  Activity,
  Download,
  XCircle,
} from "lucide-react";
import {
  Card,
  Title,
  Badge,
  AreaChart,
  LineChart,
} from "@tremor/react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { alertApi } from "@/lib/api";
import Link from "next/link";

type SeverityFilter = "" | "critical" | "high" | "medium" | "low";
type StatusFilter = "" | "ACTIVE" | "RESOLVED";
type PresetFilter = "" | "needs_attention" | "revenue_risk" | "chronic" | "stale_data";

export default function ActiveIssuesPage() {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState("FC");
  const [days, setDays] = useState(7);
  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [typeFilter, setTypeFilter] = useState("");
  const [presetFilter, setPresetFilter] = useState<PresetFilter>("");
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);
  const [expandedAlertData, setExpandedAlertData] = useState<{
    alertId: string;
    siteId: string;
    alertType: string;
    equipmentId?: string;
  } | null>(null);
  const [verifyingAlert, setVerifyingAlert] = useState<string | null>(null);

  // Alert detail chart data
  const { data: alertDetailData, isLoading: detailLoading } = useAlertDetail(
    expandedAlertData?.alertId || null,
    expandedAlertData?.siteId || null,
    expandedAlertData?.alertType || null,
    expandedAlertData?.equipmentId
  );

  // Data
  const { data: alertsData, isLoading: alertsLoading } = useAlerts({
    days,
    stage,
    status: statusFilter || undefined,
    alert_type: typeFilter || undefined,
  });
  const { data: statsData } = useAlertStats(days);
  const { data: queueData } = usePriorityQueue(stage, 50);
  const { data: prioritySummary } = usePrioritySummary(stage, days);

  // Verification mutation
  const verifyMutation = useMutation({
    mutationFn: ({
      alertId,
      siteId,
      alertType,
      equipmentId,
    }: {
      alertId: string;
      siteId: string;
      alertType: string;
      equipmentId?: string;
    }) => alertApi.verify(alertId, siteId, alertType, equipmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });

  const handleVerify = async (alert: Record<string, unknown>) => {
    const id = alert.ALERT_ID as string;
    setVerifyingAlert(id);
    try {
      await verifyMutation.mutateAsync({
        alertId: id,
        siteId: alert.SITE_ID as string,
        alertType: alert.ALERT_TYPE as string,
        equipmentId: alert.EQUIPMENT_ID as string | undefined,
      });
    } finally {
      setVerifyingAlert(null);
    }
  };

  // Merge and enrich alerts with priority data
  const enrichedAlerts = useMemo(() => {
    if (!alertsData?.alerts) return [] as Array<Record<string, unknown>>;

    const priorityMap = new Map<string, Record<string, unknown>>();
    if (queueData?.queue) {
      for (const item of queueData.queue) {
        priorityMap.set(item.site_id as string, item as unknown as Record<string, unknown>);
      }
    }

    return alertsData.alerts.map((alert): Record<string, unknown> => {
      const siteId = alert.SITE_ID as string;
      const priority = priorityMap.get(siteId);
      return {
        ...alert,
        daily_revenue_loss: priority?.daily_revenue_loss ?? null,
        urgency_score: priority?.urgency_score ?? null,
        kw_offline: priority?.kw_offline ?? null,
      };
    });
  }, [alertsData, queueData]);

  // Apply filters
  const filteredAlerts = useMemo(() => {
    let result = enrichedAlerts;

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (a) =>
          (a.SITE_ID as string)?.toLowerCase().includes(q) ||
          (a.SITE_NAME as string)?.toLowerCase().includes(q) ||
          (a.EQUIPMENT_NAME as string)?.toLowerCase().includes(q)
      );
    }

    // Severity
    if (severityFilter) {
      result = result.filter(
        (a) => (a.SEVERITY as string)?.toLowerCase() === severityFilter
      );
    }

    // Preset filters
    if (presetFilter === "needs_attention") {
      result = result.filter(
        (a) =>
          (a.VERIFICATION_STATUS as string)?.toUpperCase() === "CONFIRMED" &&
          (a.STATUS as string)?.toUpperCase() === "ACTIVE"
      );
    } else if (presetFilter === "revenue_risk") {
      result = result.filter((a) => (a.daily_revenue_loss as number) > 0);
      result.sort(
        (a, b) =>
          ((b.daily_revenue_loss as number) || 0) -
          ((a.daily_revenue_loss as number) || 0)
      );
    } else if (presetFilter === "chronic") {
      result = result.filter((a) => ((a.DURATION_HOURS as number) || 0) > 168);
    }

    return result;
  }, [enrichedAlerts, searchQuery, severityFilter, presetFilter]);

  // Summary counts
  const counts = useMemo(() => {
    const all = enrichedAlerts;
    return {
      total: all.length,
      critical: all.filter((a) => (a.SEVERITY as string)?.toLowerCase() === "critical").length,
      high: all.filter((a) => (a.SEVERITY as string)?.toLowerCase() === "high").length,
      medium: all.filter((a) => (a.SEVERITY as string)?.toLowerCase() === "medium").length,
      low: all.filter((a) => (a.SEVERITY as string)?.toLowerCase() === "low").length,
      confirmed: all.filter((a) => (a.VERIFICATION_STATUS as string)?.toUpperCase() === "CONFIRMED").length,
      active: all.filter((a) => (a.STATUS as string)?.toUpperCase() === "ACTIVE").length,
    };
  }, [enrichedAlerts]);

  const kpis = prioritySummary?.kpis;

  const handleExportCSV = () => {
    if (!filteredAlerts.length) return;
    const headers = ["Site ID", "Site Name", "Type", "Equipment", "Severity", "Status", "Verification", "Duration (h)", "Detected At"];
    const rows = filteredAlerts.map((a) => [
      a.SITE_ID, a.SITE_NAME, a.ALERT_TYPE, a.EQUIPMENT_NAME || "",
      a.SEVERITY, a.STATUS, a.VERIFICATION_STATUS, a.DURATION_HOURS, a.DETECTED_AT,
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chiron_issues_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <Header
        title="Active Issues"
        subtitle={`${counts.total} issues across portfolio`}
      />

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <KpiCard
          title="Fleet Health"
          value={`${kpis?.fleet_health_pct?.toFixed(1) ?? "--"}%`}
          status={
            (kpis?.fleet_health_pct ?? 100) >= 90
              ? "success"
              : (kpis?.fleet_health_pct ?? 100) >= 70
              ? "warning"
              : "danger"
          }
          icon={Activity}
        />
        <KpiCard
          title="Confirmed"
          value={counts.confirmed.toString()}
          status={counts.confirmed > 0 ? "danger" : "success"}
          icon={AlertTriangle}
        />
        <KpiCard
          title="Critical"
          value={counts.critical.toString()}
          status={counts.critical > 0 ? "danger" : "success"}
          icon={Zap}
        />
        <KpiCard
          title="High"
          value={counts.high.toString()}
          status={counts.high > 0 ? "warning" : "success"}
          icon={Target}
        />
        <KpiCard
          title="Capacity Offline"
          value={`${((kpis?.capacity_offline_mw ?? 0) * 1000).toFixed(0)} kW`}
          status={(kpis?.capacity_offline_mw ?? 0) > 0 ? "warning" : "success"}
          icon={WifiOff}
        />
        <KpiCard
          title="Daily Revenue Loss"
          value={`$${formatNumber(kpis?.daily_revenue_loss_usd ?? 0)}`}
          status={(kpis?.daily_revenue_loss_usd ?? 0) > 100 ? "danger" : "success"}
          icon={DollarSign}
        />
      </div>

      {/* Filters Bar */}
      <Card className="!bg-chiron-bg-secondary !border-chiron-accent-teal/10">
        <div className="flex flex-wrap items-center gap-3">
          {/* Preset Filters */}
          <div className="flex gap-1">
            {[
              { key: "" as PresetFilter, label: "All" },
              { key: "needs_attention" as PresetFilter, label: "Needs Attention" },
              { key: "revenue_risk" as PresetFilter, label: "Revenue at Risk" },
              { key: "chronic" as PresetFilter, label: "Chronic (>7d)" },
            ].map((preset) => (
              <button
                key={preset.key}
                onClick={() => setPresetFilter(preset.key)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  presetFilter === preset.key
                    ? "bg-chiron-accent-teal/20 text-chiron-accent-teal"
                    : "bg-chiron-bg-tertiary text-chiron-text-secondary hover:text-chiron-text-primary"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="h-6 w-px bg-chiron-accent-teal/20" />

          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-chiron-text-muted" />
            <input
              type="text"
              placeholder="Search by site or equipment..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-chiron-bg-tertiary border border-chiron-accent-teal/10 rounded-md text-chiron-text-primary placeholder:text-chiron-text-muted focus:outline-none focus:border-chiron-accent-teal/40"
            />
          </div>

          {/* Severity filter */}
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
            className="px-3 py-1.5 text-xs bg-chiron-bg-tertiary border border-chiron-accent-teal/10 rounded-md text-chiron-text-secondary"
          >
            <option value="">All Severity</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          {/* Type filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-1.5 text-xs bg-chiron-bg-tertiary border border-chiron-accent-teal/10 rounded-md text-chiron-text-secondary"
          >
            <option value="">All Types</option>
            <option value="SITE_OFFLINE">Site Offline</option>
            <option value="INVERTER_OFFLINE">Inverter Offline</option>
            <option value="METER_OFFLINE">Meter Offline</option>
          </select>

          {/* Days */}
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-3 py-1.5 text-xs bg-chiron-bg-tertiary border border-chiron-accent-teal/10 rounded-md text-chiron-text-secondary"
          >
            <option value={1}>24h</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>

          {/* Stage */}
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="px-3 py-1.5 text-xs bg-chiron-bg-tertiary border border-chiron-accent-teal/10 rounded-md text-chiron-text-secondary"
          >
            <option value="FC">FC</option>
            <option value="Pre-FC">Pre-FC</option>
            <option value="All">All</option>
          </select>

          <div className="ml-auto">
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-chiron-text-secondary hover:text-chiron-text-primary bg-chiron-bg-tertiary rounded-md transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
          </div>
        </div>
      </Card>

      {/* Issues List */}
      <Card className="!bg-chiron-bg-secondary !border-chiron-accent-teal/10 !p-0 overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-[2rem_7rem_1fr_8rem_6rem_5rem_5rem_6rem_5rem] gap-2 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-chiron-text-muted border-b border-chiron-accent-teal/10 bg-chiron-bg-tertiary/50">
          <div />
          <div>Site</div>
          <div>Issue</div>
          <div>Equipment</div>
          <div>Severity</div>
          <div>Status</div>
          <div>Hours</div>
          <div>Revenue Loss</div>
          <div>Actions</div>
        </div>

        {/* Loading */}
        {alertsLoading && (
          <div className="p-8 text-center text-chiron-text-muted">Loading issues...</div>
        )}

        {/* Empty */}
        {!alertsLoading && filteredAlerts.length === 0 && (
          <div className="p-8 text-center text-chiron-text-muted">
            <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
            <p>No issues found matching your filters</p>
          </div>
        )}

        {/* Rows */}
        {filteredAlerts.map((alert) => {
          const alertId = alert.ALERT_ID as string;
          const isExpanded = expandedAlert === alertId;
          const severity = ((alert.SEVERITY as string) || "medium").toLowerCase();
          const verification = ((alert.VERIFICATION_STATUS as string) || "").toUpperCase();
          const status = ((alert.STATUS as string) || "").toUpperCase();
          const hours = (alert.DURATION_HOURS as number) || 0;
          const revLoss = alert.daily_revenue_loss as number;

          const severityColors: Record<string, string> = {
            critical: "text-red-400 bg-red-500/10",
            high: "text-amber-400 bg-amber-500/10",
            medium: "text-yellow-400 bg-yellow-500/10",
            low: "text-blue-400 bg-blue-500/10",
          };

          const verificationBadge: Record<string, { color: string; label: string }> = {
            CONFIRMED: { color: "text-red-400 bg-red-500/10 border-red-500/20", label: "Confirmed" },
            INCONCLUSIVE: { color: "text-amber-400 bg-amber-500/10 border-amber-500/20", label: "Inconclusive" },
            FALSE_POSITIVE: { color: "text-green-400 bg-green-500/10 border-green-500/20", label: "False Positive" },
            PENDING: { color: "text-gray-400 bg-gray-500/10 border-gray-500/20", label: "Pending" },
          };

          const vBadge = verificationBadge[verification] || verificationBadge.PENDING;

          return (
            <div key={alertId} className="border-b border-chiron-accent-teal/5 last:border-0">
              {/* Main row */}
              <div
                className="grid grid-cols-[2rem_7rem_1fr_8rem_6rem_5rem_5rem_6rem_5rem] gap-2 px-4 py-3 items-center hover:bg-chiron-bg-tertiary/30 cursor-pointer transition-colors"
                onClick={() => {
                  if (isExpanded) {
                    setExpandedAlert(null);
                    setExpandedAlertData(null);
                  } else {
                    setExpandedAlert(alertId);
                    setExpandedAlertData({
                      alertId,
                      siteId: alert.SITE_ID as string,
                      alertType: alert.ALERT_TYPE as string,
                      equipmentId: alert.EQUIPMENT_ID as string | undefined,
                    });
                  }
                }}
              >
                {/* Expand icon */}
                <div>
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-chiron-text-muted" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-chiron-text-muted" />
                  )}
                </div>

                {/* Site */}
                <div>
                  <Link
                    href={`/sites?site=${alert.SITE_ID}`}
                    className="text-sm font-medium text-chiron-accent-teal hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {alert.SITE_ID as string}
                  </Link>
                </div>

                {/* Issue description */}
                <div className="min-w-0">
                  <p className="text-sm text-chiron-text-primary truncate">
                    {getAlertTypeLabel((alert.ALERT_TYPE as string) || "")}
                  </p>
                  <p className="text-xs text-chiron-text-muted truncate">
                    {(alert.SITE_NAME as string) || ""}
                  </p>
                </div>

                {/* Equipment */}
                <div className="text-xs text-chiron-text-secondary truncate">
                  {(alert.EQUIPMENT_NAME as string) || (alert.EQUIPMENT_ID as string) || "Site"}
                </div>

                {/* Severity */}
                <div>
                  <span className={cn("text-xs font-medium px-2 py-0.5 rounded capitalize", severityColors[severity])}>
                    {severity}
                  </span>
                </div>

                {/* Verification status */}
                <div>
                  <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", vBadge.color)}>
                    {vBadge.label.substring(0, 4)}
                  </span>
                </div>

                {/* Duration */}
                <div className="text-xs text-chiron-text-secondary">
                  {hours > 0 ? `${hours.toFixed(0)}h` : "--"}
                </div>

                {/* Revenue loss */}
                <div className="text-xs text-chiron-text-secondary">
                  {revLoss && revLoss > 0 ? `$${revLoss.toFixed(0)}/d` : "--"}
                </div>

                {/* Quick actions */}
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() =>
                      verifyMutation.mutate({
                        alertId,
                        siteId: alert.SITE_ID as string,
                        alertType: alert.ALERT_TYPE as string,
                        equipmentId: alert.EQUIPMENT_ID as string,
                      })
                    }
                    disabled={verifyMutation.isPending}
                    className="p-1 rounded text-chiron-text-muted hover:text-chiron-accent-teal hover:bg-chiron-accent-teal/10 transition-colors"
                    title="Verify now"
                  >
                    <Activity className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="px-4 pb-4 pl-8 space-y-4">
                  {/* Info + Actions row */}
                  <div className="flex items-start gap-4">
                    <div className="flex-1 grid grid-cols-3 gap-4 text-xs">
                      <div className="space-y-1">
                        <p className="font-medium text-chiron-text-muted">Detection</p>
                        <p className="text-chiron-text-secondary">
                          Detected: {formatDateTime((alert.DETECTED_AT as string) || "")}
                        </p>
                        <p className="text-chiron-text-secondary">
                          Checks: {(alert.CHECK_COUNT as number) || 0}
                        </p>
                        <p className="text-chiron-text-secondary">
                          Verification: {verification}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="font-medium text-chiron-text-muted">Impact</p>
                        <p className="text-chiron-text-secondary">
                          kW Offline: {alert.kw_offline ? `${(alert.kw_offline as number).toFixed(1)} kW` : "--"}
                        </p>
                        <p className="text-chiron-text-secondary">
                          Daily Loss: {revLoss ? `$${revLoss.toFixed(2)}` : "--"}
                        </p>
                        <p className="text-chiron-text-secondary">
                          Urgency: {alert.urgency_score ? `${(alert.urgency_score as number).toFixed(0)}/100` : "--"}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="font-medium text-chiron-text-muted">Links</p>
                        <Link
                          href={`/sites?site=${alert.SITE_ID}`}
                          className="block text-chiron-accent-teal hover:underline"
                        >
                          View site details
                        </Link>
                        <Link
                          href={`/performance?site=${alert.SITE_ID}`}
                          className="block text-chiron-accent-teal hover:underline"
                        >
                          Performance analysis
                        </Link>
                      </div>
                    </div>

                    {/* Verify button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleVerify(alert);
                      }}
                      disabled={verifyingAlert === alertId}
                      className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-blue-500 disabled:opacity-50 shrink-0"
                    >
                      <Zap
                        className={cn(
                          "h-4 w-4",
                          verifyingAlert === alertId && "animate-pulse"
                        )}
                      />
                      {verifyingAlert === alertId ? "Verifying..." : "Verify Now"}
                    </button>
                  </div>

                  {/* Verification result */}
                  {verifyMutation.data && verifyingAlert === null && expandedAlert === alertId && (
                    <div className="rounded-lg bg-chiron-bg-tertiary p-3">
                      <div className="flex items-center gap-2">
                        <Badge
                          color={
                            (verifyMutation.data as Record<string, unknown>).status === "CONFIRMED"
                              ? "red"
                              : (verifyMutation.data as Record<string, unknown>).status === "FALSE_POSITIVE"
                              ? "green"
                              : "yellow"
                          }
                        >
                          {(verifyMutation.data as Record<string, unknown>).status as string}
                        </Badge>
                        <span className="text-sm text-chiron-text-secondary">
                          {(verifyMutation.data as Record<string, unknown>).message as string}
                        </span>
                      </div>
                      {(verifyMutation.data as Record<string, unknown>).power_kw !== null && (
                        <p className="mt-2 text-sm text-chiron-text-muted">
                          Power:{" "}
                          <span className="text-blue-400">
                            {(verifyMutation.data as Record<string, unknown>).power_kw as number} kW
                          </span>
                        </p>
                      )}
                    </div>
                  )}

                  {/* Issue-Specific Chart */}
                  <div className="rounded-lg border border-chiron-accent-teal/20 bg-chiron-bg-tertiary p-4">
                    <h4 className="mb-2 text-sm font-semibold text-chiron-text-primary">
                      {(alert.ALERT_TYPE as string) === "SITE_OFFLINE"
                        ? "Site Production & Meter vs Solar Irradiance (72h)"
                        : (alert.ALERT_TYPE as string) === "INVERTER_OFFLINE"
                        ? "Affected Inverter vs Peer Average (72h)"
                        : "Meter Values vs Inverter Total (72h)"}
                    </h4>
                    <p className="mb-3 text-xs text-chiron-text-muted">
                      {(alert.ALERT_TYPE as string) === "SITE_OFFLINE"
                        ? "Comparing inverter & meter production with Solcast GHI — production drop during sunny periods confirms outage"
                        : (alert.ALERT_TYPE as string) === "INVERTER_OFFLINE"
                        ? "Red line shows affected inverter, green shows average of peer inverters — gap indicates underperformance"
                        : "Comparing meter readings with inverter totals — divergence indicates meter communication issues"}
                    </p>
                    {detailLoading ? (
                      <div className="flex h-48 items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-chiron-accent-teal" />
                      </div>
                    ) : alertDetailData?.data && alertDetailData.data.length > 0 ? (
                      <>
                        {(alert.ALERT_TYPE as string) === "SITE_OFFLINE" && (
                          <AreaChart
                            className="h-48"
                            data={alertDetailData.data.map((d: Record<string, unknown>) => ({
                              time: d.MEASUREMENTTIME as string,
                              "Inverter (kWh)": Math.max(0, (d.INV_TOTAL_ENERGY as number) || 0),
                              "Meter (kWh)": Math.max(0, (d.METER_ENERGY as number) || 0),
                              "GHI Solcast (W/m²)": Math.max(0, (d.INSOLATION_GHI_SOLCAST as number) || 0),
                            }))}
                            index="time"
                            categories={["Inverter (kWh)", "Meter (kWh)", "GHI Solcast (W/m²)"]}
                            colors={["teal", "blue", "amber"]}
                            valueFormatter={(v) => formatNumber(v, 0)}
                            showLegend={true}
                            curveType="monotone"
                          />
                        )}
                        {(alert.ALERT_TYPE as string) === "INVERTER_OFFLINE" && (
                          <LineChart
                            className="h-48"
                            data={alertDetailData.data.map((d: Record<string, unknown>) => ({
                              time: d.MEASUREMENTTIME as string,
                              "Affected Inverter (kWh)": Math.max(0, (d.AFFECTED as number) || 0),
                              "Peer Average (kWh)": Math.max(0, (d.PEER_AVG as number) || 0),
                            }))}
                            index="time"
                            categories={["Affected Inverter (kWh)", "Peer Average (kWh)"]}
                            colors={["red", "green"]}
                            valueFormatter={(v) => formatNumber(v, 1)}
                            showLegend={true}
                            curveType="monotone"
                          />
                        )}
                        {(alert.ALERT_TYPE as string) === "METER_OFFLINE" &&
                          (() => {
                            const allMeterCols = Object.keys(alertDetailData.data[0] || {}).filter(
                              (k) => k.startsWith("M") && k.endsWith("_VALUE")
                            );
                            const meterCols = allMeterCols.filter((m) =>
                              alertDetailData.data.some((d: Record<string, unknown>) => {
                                const val = d[m] as number | null;
                                return val !== null && val !== undefined && val > 0;
                              })
                            );
                            const categories = [
                              ...meterCols.map((m) => m.replace("_VALUE", "")),
                              "INV Total",
                              "GHI Solcast",
                            ];
                            const colors = ["blue", "indigo", "violet", "purple", "cyan", "teal", "amber"];
                            return (
                              <LineChart
                                className="h-48"
                                data={alertDetailData.data.map((d: Record<string, unknown>) => {
                                  const row: Record<string, unknown> = {
                                    time: d.MEASUREMENTTIME as string,
                                    "INV Total": Math.max(0, (d.INV_TOTAL_ENERGY as number) || 0),
                                    "GHI Solcast": Math.max(0, (d.INSOLATION_GHI_SOLCAST as number) || 0),
                                  };
                                  meterCols.forEach((m) => {
                                    row[m.replace("_VALUE", "")] = Math.max(0, (d[m] as number) || 0);
                                  });
                                  return row;
                                })}
                                index="time"
                                categories={categories}
                                colors={colors.slice(0, categories.length)}
                                valueFormatter={(v) => formatNumber(v, 0)}
                                showLegend={true}
                                curveType="monotone"
                              />
                            );
                          })()}
                      </>
                    ) : (
                      <div className="flex h-48 items-center justify-center text-chiron-text-muted">
                        <p>No recent data available for this alert</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </Card>

      {/* Results count */}
      <div className="text-xs text-chiron-text-muted text-right">
        Showing {filteredAlerts.length} of {enrichedAlerts.length} issues
      </div>
    </div>
  );
}
