"use client";

import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { useFleetSummary, usePrioritySummary } from "@/hooks/useFleetData";
import { formatNumber, cn } from "@/lib/utils";
import {
  FileText,
  Download,
  Calendar,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  Activity,
} from "lucide-react";
import { Card, Title } from "@tremor/react";
import { apmApi, alertApi } from "@/lib/api";

function downloadCSV(data: Array<Record<string, unknown>>, filename: string) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers.map((h) => {
      const val = row[h];
      if (val === null || val === undefined) return "";
      const str = String(val);
      return str.includes(",") ? `"${str}"` : str;
    })
  );
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [exporting, setExporting] = useState<string | null>(null);
  const [stage, setStage] = useState("FC");
  const { data: summary } = useFleetSummary();
  const { data: prioritySummary } = usePrioritySummary(stage);

  const kpis = prioritySummary?.kpis;

  const handleExport = async (reportType: string) => {
    setExporting(reportType);
    try {
      const dateStr = new Date().toISOString().split("T")[0];
      if (reportType === "fleet_kpis") {
        const data = await apmApi.getFleetKPIs(stage, 30);
        if (data?.sites) {
          downloadCSV(data.sites, `fleet_kpis_${dateStr}.csv`);
        }
      } else if (reportType === "alerts") {
        const data = await alertApi.getAlerts({ days: 30, stage, limit: 500 });
        if (data?.alerts) {
          downloadCSV(data.alerts, `alerts_${dateStr}.csv`);
        }
      } else if (reportType === "revenue") {
        const data = await apmApi.getFleetKPIs(stage, 30);
        if (data?.sites) {
          const revenueData = data.sites.map((s: Record<string, unknown>) => ({
            SITE_ID: s.SITE_ID,
            SITE_NAME: s.SITE_NAME,
            WA_PR: s.WA_PR,
            TOTAL_PRODUCTION: s.TOTAL_PRODUCTION,
            TOTAL_WA_EXPECTED: s.TOTAL_WA_EXPECTED,
            VARIANCE_WA_PRODUCTION: s.VARIANCE_WA_PRODUCTION,
            TOTAL_REVENUE: s.TOTAL_REVENUE,
            TOTAL_VARIANCE_WA_REVENUE: s.TOTAL_VARIANCE_WA_REVENUE,
          }));
          downloadCSV(revenueData, `revenue_impact_${dateStr}.csv`);
        }
      }
    } catch (e) {
      console.error("Export error:", e);
    } finally {
      setExporting(null);
    }
  };

  const reports = [
    {
      id: "fleet_kpis",
      title: "Fleet KPI Report",
      description: "All sites with WA PR, availability, production, revenue metrics for the past 30 days",
      icon: TrendingUp,
      period: "30 days",
    },
    {
      id: "alerts",
      title: "Alert History Report",
      description: "All alerts detected in the past 30 days with verification status and duration",
      icon: AlertTriangle,
      period: "30 days",
    },
    {
      id: "revenue",
      title: "Revenue Impact Report",
      description: "Production variance and revenue impact per site for the past 30 days",
      icon: DollarSign,
      period: "30 days",
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <Header title="Reports" subtitle="Export fleet data and generate reports" />

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          title="Total Sites"
          value={summary?.total_sites?.toString() ?? "--"}
          icon={Activity}
        />
        <KpiCard
          title="Fleet Health"
          value={`${kpis?.fleet_health_pct?.toFixed(1) ?? "--"}%`}
          status={(kpis?.fleet_health_pct ?? 100) >= 90 ? "success" : "warning"}
          icon={TrendingUp}
        />
        <KpiCard
          title="Active Alerts"
          value={kpis?.total_alerts?.toString() ?? "--"}
          status={(kpis?.total_alerts ?? 0) > 0 ? "warning" : "success"}
          icon={AlertTriangle}
        />
        <KpiCard
          title="Monthly Loss Est."
          value={`$${formatNumber(kpis?.monthly_revenue_loss_usd ?? 0)}`}
          icon={DollarSign}
        />
      </div>

      {/* Stage selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-chiron-text-muted">Stage:</span>
        {["FC", "Pre-FC", "All"].map((s) => (
          <button
            key={s}
            onClick={() => setStage(s)}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-md transition-colors",
              stage === s
                ? "bg-chiron-accent-teal/20 text-chiron-accent-teal"
                : "bg-chiron-bg-tertiary text-chiron-text-secondary hover:text-chiron-text-primary"
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Report Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reports.map((report) => (
          <Card
            key={report.id}
            className="!bg-chiron-bg-secondary !border-chiron-accent-teal/10 hover:!border-chiron-accent-teal/30 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-chiron-accent-teal/10">
                <report.icon className="h-5 w-5 text-chiron-accent-teal" />
              </div>
              <div className="flex-1">
                <Title className="!text-chiron-text-primary !text-sm">{report.title}</Title>
                <p className="text-xs text-chiron-text-muted mt-1">{report.description}</p>
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-[10px] text-chiron-text-muted flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {report.period}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={() => handleExport(report.id)}
              disabled={exporting === report.id}
              className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-chiron-accent-teal bg-chiron-accent-teal/10 hover:bg-chiron-accent-teal/20 rounded-lg transition-colors disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {exporting === report.id ? "Exporting..." : "Export CSV"}
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
}
