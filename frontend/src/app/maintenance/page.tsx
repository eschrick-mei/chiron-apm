"use client";

import { useState, useMemo } from "react";
import { Header } from "@/components/layout/Header";
import { useFleetSites, useMaintenanceScore, useFleetMaintenanceScores } from "@/hooks/useFleetData";
import { formatNumber, cn } from "@/lib/utils";
import {
  Wrench,
  Search,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ChevronRight,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Clock,
  Shield,
  Activity,
} from "lucide-react";
import { Card, Title, Badge, ProgressBar } from "@tremor/react";

const statusConfig = {
  excellent: { color: "emerald", icon: CheckCircle2, label: "Excellent" },
  good: { color: "green", icon: TrendingUp, label: "Good" },
  fair: { color: "amber", icon: Activity, label: "Fair" },
  poor: { color: "orange", icon: AlertTriangle, label: "Poor" },
  critical: { color: "red", icon: AlertCircle, label: "Critical" },
} as const;

export default function MaintenancePage() {
  const [selectedSite, setSelectedSite] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: sitesData } = useFleetSites({ limit: 200 });
  const { data: maintenanceData, isLoading, refetch } = useMaintenanceScore(selectedSite);
  const { data: batchScores } = useFleetMaintenanceScores("FC", 200);

  // Build a map of site_id -> score for quick lookup
  const scoreMap = useMemo(() => {
    const map: Record<string, { score: number; status: string }> = {};
    if (batchScores?.scores) {
      batchScores.scores.forEach((s) => {
        map[s.site_id] = { score: s.score, status: s.status };
      });
    }
    return map;
  }, [batchScores]);

  const filteredSites = (sitesData || []).filter(
    (site) =>
      (site.SITE_ID as string)?.toLowerCase().includes(search.toLowerCase()) ||
      (site.SITE_NAME as string)?.toLowerCase().includes(search.toLowerCase())
  );

  const status = maintenanceData?.status as keyof typeof statusConfig | undefined;
  const statusInfo = status ? statusConfig[status] : null;

  return (
    <div className="flex h-screen flex-col">
      <Header
        title="Maintenance Scores"
        subtitle="Predictive maintenance scoring and recommendations"
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
            {filteredSites.map((site) => {
              const siteId = site.SITE_ID as string;
              const siteScore = scoreMap[siteId];

              const getScoreColor = (status: string | undefined) => {
                switch (status) {
                  case "excellent":
                    return "bg-emerald-500";
                  case "good":
                    return "bg-green-500";
                  case "fair":
                    return "bg-amber-500";
                  case "poor":
                    return "bg-orange-500";
                  case "critical":
                    return "bg-red-500";
                  default:
                    return "bg-chiron-bg-tertiary";
                }
              };

              return (
                <button
                  key={siteId}
                  onClick={() => setSelectedSite(siteId)}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors mb-1",
                    selectedSite === siteId
                      ? "bg-chiron-accent-teal/20 border border-chiron-accent-teal/40"
                      : "hover:bg-chiron-bg-tertiary border border-transparent"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-sm text-chiron-text-primary">
                      {siteId}
                    </span>
                    <p className="text-xs text-chiron-text-muted truncate">
                      {site.SITE_NAME as string}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {siteScore && (
                      <div className="flex items-center gap-1.5">
                        <div
                          className={cn(
                            "w-2 h-2 rounded-full",
                            getScoreColor(siteScore.status)
                          )}
                        />
                        <span
                          className={cn(
                            "text-xs font-semibold",
                            siteScore.status === "excellent" || siteScore.status === "good"
                              ? "text-green-400"
                              : siteScore.status === "fair"
                              ? "text-amber-400"
                              : siteScore.status === "poor"
                              ? "text-orange-400"
                              : siteScore.status === "critical"
                              ? "text-red-400"
                              : "text-chiron-text-muted"
                          )}
                        >
                          {siteScore.score}
                        </span>
                      </div>
                    )}
                    <ChevronRight className="h-4 w-4 text-chiron-text-muted" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedSite ? (
            <div className="flex flex-col items-center justify-center h-full text-chiron-text-muted">
              <Wrench className="h-16 w-16 mb-4" />
              <h3 className="text-lg font-medium">Select a Site</h3>
              <p className="text-sm mt-2">Choose a site from the sidebar to view maintenance score</p>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center h-full">
              <RefreshCw className="h-8 w-8 text-chiron-accent-teal animate-spin" />
            </div>
          ) : maintenanceData ? (
            <div className="max-w-3xl mx-auto space-y-6">
              {/* Header */}
              <div className="text-center">
                <h2 className="text-xl font-semibold text-chiron-text-primary">
                  {maintenanceData.site_id}
                </h2>
                <p className="text-sm text-chiron-text-muted">
                  {maintenanceData.site_name}
                </p>
              </div>

              {/* Score Card */}
              <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
                <div className="flex flex-col items-center py-8">
                  <div
                    className={cn(
                      "w-32 h-32 rounded-full flex items-center justify-center mb-4",
                      maintenanceData.score >= 85
                        ? "bg-emerald-500/20 border-4 border-emerald-500"
                        : maintenanceData.score >= 70
                        ? "bg-green-500/20 border-4 border-green-500"
                        : maintenanceData.score >= 50
                        ? "bg-amber-500/20 border-4 border-amber-500"
                        : maintenanceData.score >= 30
                        ? "bg-orange-500/20 border-4 border-orange-500"
                        : "bg-red-500/20 border-4 border-red-500"
                    )}
                  >
                    <span
                      className={cn(
                        "text-4xl font-bold",
                        maintenanceData.score >= 85
                          ? "text-emerald-400"
                          : maintenanceData.score >= 70
                          ? "text-green-400"
                          : maintenanceData.score >= 50
                          ? "text-amber-400"
                          : maintenanceData.score >= 30
                          ? "text-orange-400"
                          : "text-red-400"
                      )}
                    >
                      {formatNumber(maintenanceData.score, 0)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mb-2">
                    {statusInfo && <statusInfo.icon className="h-5 w-5" />}
                    <Badge
                      color={statusInfo?.color || "gray"}
                      size="lg"
                    >
                      {maintenanceData.status.toUpperCase()}
                    </Badge>
                  </div>

                  <p className="text-chiron-text-secondary text-center max-w-md">
                    {maintenanceData.recommendation}
                  </p>
                </div>
              </Card>

              {/* Factor Breakdown */}
              <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
                <Title className="!text-chiron-text-primary mb-6">Score Breakdown</Title>

                <div className="space-y-4">
                  {maintenanceData.factors.map((factor) => (
                    <div key={factor.name} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-chiron-text-muted" />
                          <span className="font-medium text-chiron-text-primary">
                            {factor.name}
                          </span>
                          <Badge color="gray" size="xs">
                            {(factor.weight * 100).toFixed(0)}% weight
                          </Badge>
                        </div>
                        <span
                          className={cn(
                            "font-bold",
                            factor.score >= 80
                              ? "text-green-400"
                              : factor.score >= 50
                              ? "text-amber-400"
                              : "text-red-400"
                          )}
                        >
                          {formatNumber(factor.score, 0)}
                        </span>
                      </div>
                      <ProgressBar
                        value={factor.score}
                        color={
                          factor.score >= 80
                            ? "emerald"
                            : factor.score >= 50
                            ? "amber"
                            : "red"
                        }
                        className="h-3"
                      />
                      <p className="text-xs text-chiron-text-muted">{factor.details}</p>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Interpretation Guide */}
              <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
                <Title className="!text-chiron-text-primary mb-4">Score Interpretation</Title>

                <div className="grid gap-3 md:grid-cols-5">
                  {Object.entries(statusConfig).map(([key, config]) => (
                    <div
                      key={key}
                      className={cn(
                        "p-3 rounded-lg border text-center",
                        maintenanceData.status === key
                          ? `border-${config.color}-500 bg-${config.color}-500/10`
                          : "border-chiron-accent-teal/20"
                      )}
                    >
                      <config.icon
                        className={cn(
                          "h-5 w-5 mx-auto mb-1",
                          maintenanceData.status === key
                            ? `text-${config.color}-400`
                            : "text-chiron-text-muted"
                        )}
                      />
                      <p className="text-xs font-medium text-chiron-text-primary">
                        {config.label}
                      </p>
                      <p className="text-[10px] text-chiron-text-muted">
                        {key === "excellent"
                          ? "85-100"
                          : key === "good"
                          ? "70-84"
                          : key === "fair"
                          ? "50-69"
                          : key === "poor"
                          ? "30-49"
                          : "0-29"}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Last Calculated */}
              <div className="flex items-center justify-center gap-2 text-xs text-chiron-text-muted">
                <Clock className="h-3 w-3" />
                Last calculated: {new Date(maintenanceData.calculated_at).toLocaleString()}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-chiron-text-muted">
              <AlertTriangle className="h-8 w-8 mr-2" />
              Failed to load maintenance score
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
