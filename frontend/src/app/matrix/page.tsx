"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Header } from "@/components/layout/Header";
import { useFleetMatrix, useFleetTimestamps, usePrefetchFleetMatrix } from "@/hooks/useFleetData";
import { cn, formatNumber } from "@/lib/utils";
import {
  Grid3X3,
  AlertTriangle,
  CheckCircle2,
  Moon,
  Zap,
  RefreshCw,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  Clock,
  Sun,
  Wifi,
  WifiOff,
  TrendingDown,
  History,
  Play,
  Pause,
  SkipBack,
  Radio,
} from "lucide-react";
import type { FleetMatrixSite, InverterStatus } from "@/types";

// Time slider component - defaults to live, slider moves back in time
function TimeSlider({
  timestamps,
  selectedIndex,
  onSelect,
  isPlaying,
  onTogglePlay,
}: {
  timestamps: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
}) {
  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const hoursAgo = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    return Math.round(diff / (1000 * 60 * 60));
  };

  const selectedTs = timestamps[selectedIndex];
  const isLive = selectedIndex === 0;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-chiron-bg-tertiary/50 rounded-lg border border-chiron-bg-tertiary">
      {/* Live indicator */}
      <div
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
          isLive
            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
            : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
        )}
      >
        {isLive ? (
          <>
            <Radio className="h-3 w-3 animate-pulse" />
            Live
          </>
        ) : (
          <>
            <History className="h-3 w-3" />
            Historical
          </>
        )}
      </div>

      {timestamps.length > 0 && (
        <>
          {/* Playback controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => onSelect(timestamps.length - 1)}
              className="p-1.5 rounded hover:bg-chiron-bg-tertiary text-chiron-text-muted hover:text-chiron-text-primary transition-colors"
              title="Go to oldest"
            >
              <SkipBack className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onTogglePlay}
              className={cn(
                "p-1.5 rounded transition-colors",
                isPlaying
                  ? "bg-amber-500/20 text-amber-400"
                  : "hover:bg-chiron-bg-tertiary text-chiron-text-muted hover:text-chiron-text-primary"
              )}
              title={isPlaying ? "Pause" : "Play through time"}
            >
              {isPlaying ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {/* Time slider */}
          <div className="flex-1 flex items-center gap-3">
            <span className="text-xs text-chiron-text-muted whitespace-nowrap">
              {timestamps.length > 0 ? hoursAgo(timestamps[timestamps.length - 1]) : 0}h ago
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0, timestamps.length - 1)}
              value={selectedIndex}
              onChange={(e) => onSelect(Number(e.target.value))}
              className="flex-1 h-2 bg-chiron-bg-tertiary rounded-lg appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none
                [&::-webkit-slider-thumb]:w-4
                [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:bg-chiron-accent-teal
                [&::-webkit-slider-thumb]:cursor-pointer
                [&::-webkit-slider-thumb]:shadow-md
                [&::-webkit-slider-thumb]:hover:bg-chiron-accent-teal/80"
            />
            <span className="text-xs text-chiron-text-muted">Now</span>
          </div>

          {/* Selected time display */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-chiron-bg-primary rounded-lg border border-chiron-bg-tertiary">
            <Clock className="h-3.5 w-3.5 text-chiron-accent-teal" />
            <span className="text-sm font-medium text-chiron-text-primary whitespace-nowrap">
              {isLive ? "Now (Live)" : selectedTs ? formatTimestamp(selectedTs) : "Select time"}
            </span>
            {!isLive && selectedTs && (
              <span className="text-xs text-chiron-text-muted">
                ({hoursAgo(selectedTs)}h ago)
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Status badge component
function StatusBadge({ status }: { status: FleetMatrixSite["site_status"] }) {
  const config: Record<string, { label: string; className: string; icon: typeof WifiOff }> = {
    site_offline: {
      label: "Site Offline",
      className: "bg-red-500/20 text-red-400 border-red-500/30",
      icon: WifiOff,
    },
    partial_outage: {
      label: "Partial Outage",
      className: "bg-amber-500/20 text-amber-400 border-amber-500/30",
      icon: AlertTriangle,
    },
    healthy: {
      label: "Healthy",
      className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
      icon: CheckCircle2,
    },
    night: {
      label: "Night",
      className: "bg-slate-500/20 text-slate-400 border-slate-500/30",
      icon: Moon,
    },
    low_production: {
      label: "Low Production",
      className: "bg-orange-500/20 text-orange-400 border-orange-500/30",
      icon: TrendingDown,
    },
  };

  const statusConfig = config[status] || config.healthy;
  const { label, className, icon: Icon } = statusConfig;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border",
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

// Inverter cell component - binary mode: producing (green) or not (red/gray)
function InverterCell({ inverter, isExpanded }: { inverter: InverterStatus; isExpanded: boolean }) {
  // Binary status: producing or not producing
  const isProducing = inverter.value > 0 && inverter.status !== "offline" && inverter.status !== "night";
  const isNight = inverter.status === "night";

  const getColor = () => {
    if (isNight) return "bg-slate-700/50";
    if (isProducing) return "bg-emerald-500/50";
    return "bg-red-500/40"; // Not producing
  };

  const getBorderColor = () => {
    if (isNight) return "border-slate-600/50";
    if (isProducing) return "border-emerald-500/50";
    return "border-red-500/50";
  };

  if (!isExpanded) {
    return (
      <div
        className={cn(
          "w-5 h-5 rounded border flex-shrink-0",
          getColor(),
          getBorderColor()
        )}
        title={`IN${inverter.index}: ${inverter.value.toFixed(1)} kW (${inverter.capacity_factor.toFixed(0)}%) - ${isProducing ? "Producing" : isNight ? "Night" : "Not Producing"}`}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-1 rounded border min-w-[44px] flex-shrink-0",
        getColor(),
        getBorderColor()
      )}
    >
      <span className="text-[10px] font-medium text-chiron-text-primary">
        IN{inverter.index}
      </span>
      <span className="text-xs font-bold text-chiron-text-primary">
        {inverter.capacity_factor.toFixed(0)}%
      </span>
    </div>
  );
}

// Site row component
function SiteRow({
  site,
  maxInverters,
  isExpanded,
  onToggle,
}: {
  site: FleetMatrixSite;
  maxInverters: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const inverterSlots = useMemo(() => {
    const slots: (InverterStatus | null)[] = [];
    for (let i = 0; i < maxInverters; i++) {
      slots.push(site.inverters[i] || null);
    }
    return slots;
  }, [site.inverters, maxInverters]);

  return (
    <div
      className={cn(
        "group border-b border-chiron-bg-tertiary hover:bg-chiron-bg-tertiary/50 transition-colors",
        site.site_status === "site_offline" && "bg-red-500/5",
        site.site_status === "partial_outage" && "bg-amber-500/5"
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Expand toggle */}
        <button
          onClick={onToggle}
          className="p-1 rounded hover:bg-chiron-bg-tertiary"
        >
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-chiron-text-muted" />
          ) : (
            <ChevronDown className="h-4 w-4 text-chiron-text-muted" />
          )}
        </button>

        {/* Site info */}
        <div className="w-48 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium text-chiron-text-primary">
              {site.site_id}
            </span>
            <StatusBadge status={site.site_status} />
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-chiron-text-muted truncate max-w-[140px]">
              {site.site_name}
            </span>
          </div>
        </div>

        {/* DAS */}
        <div className="w-20 flex-shrink-0">
          <span className="text-xs text-chiron-text-muted">{site.primary_das}</span>
        </div>

        {/* Capacity */}
        <div className="w-20 flex-shrink-0 text-right">
          <span className="text-xs text-chiron-text-secondary">
            {formatNumber(site.size_kw_dc)} kW
          </span>
        </div>

        {/* Inverter count stats */}
        <div className="w-24 flex-shrink-0">
          <div className="flex items-center gap-1">
            <span className="text-xs text-emerald-400">{site.inverters_online}</span>
            <span className="text-xs text-chiron-text-muted">/</span>
            <span className="text-xs text-chiron-text-muted">{site.inverter_count}</span>
            {site.inverters_offline > 0 && (
              <span className="text-xs text-red-400 ml-1">
                ({site.inverters_offline} off)
              </span>
            )}
          </div>
        </div>

        {/* Production */}
        <div className="w-24 flex-shrink-0 text-right">
          <span className="text-sm font-medium text-chiron-text-primary">
            {formatNumber(site.total_production)} kW
          </span>
        </div>

        {/* Irradiance */}
        <div className="w-20 flex-shrink-0 text-right">
          <div className="flex items-center justify-end gap-1">
            <Sun className="h-3 w-3 text-amber-400" />
            <span className="text-xs text-chiron-text-secondary">
              {site.irradiance_poa > 0 ? `${site.irradiance_poa.toFixed(0)} W/m²` : "-"}
            </span>
          </div>
        </div>

        {/* Data freshness */}
        <div className="w-20 flex-shrink-0">
          {site.minutes_ago !== null && (
            <div
              className={cn(
                "flex items-center gap-1",
                site.data_stale ? "text-red-400" : "text-chiron-text-muted"
              )}
            >
              <Clock className="h-3 w-3" />
              <span className="text-xs">
                {site.minutes_ago < 60
                  ? `${site.minutes_ago.toFixed(0)}m`
                  : `${(site.minutes_ago / 60).toFixed(1)}h`}
              </span>
            </div>
          )}
        </div>

        {/* Local time */}
        <div className="w-16 flex-shrink-0 text-right">
          {site.local_hour !== null && (
            <span className="text-xs text-chiron-text-muted">
              {site.local_hour}:00
            </span>
          )}
        </div>

        {/* Inverter matrix - allow flex growth and scroll */}
        <div className="flex-1 min-w-0 overflow-x-auto scrollbar-thin scrollbar-thumb-chiron-bg-tertiary scrollbar-track-transparent">
          <div className="flex gap-0.5 min-w-max pr-2">
            {inverterSlots.map((inv, i) =>
              inv ? (
                <InverterCell key={i} inverter={inv} isExpanded={isExpanded} />
              ) : (
                <div key={i} className="w-5 h-5 flex-shrink-0" />
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Summary KPI card
function SummaryCard({
  label,
  value,
  subValue,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  subValue?: string;
  icon: React.ElementType;
  color: "red" | "amber" | "emerald" | "blue" | "slate";
}) {
  const colorClasses = {
    red: "text-red-400 bg-red-500/10 border-red-500/20",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    blue: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    slate: "text-slate-400 bg-slate-500/10 border-slate-500/20",
  };

  return (
    <div className={cn("rounded-lg border p-3", colorClasses[color])}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="mt-1">
        <span className="text-2xl font-bold">{value}</span>
        {subValue && (
          <span className="text-xs text-chiron-text-muted ml-2">{subValue}</span>
        )}
      </div>
    </div>
  );
}

export default function FleetMatrixPage() {
  const [stage, setStage] = useState("FC");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());

  // Time slider state - position 0 = live/now, higher = older
  const [selectedTimeIndex, setSelectedTimeIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Fetch available timestamps
  const { data: timestampData } = useFleetTimestamps(72);
  const timestamps = timestampData?.timestamps || [];

  // Position 0 = live (null timestamp), otherwise use historical timestamp
  const isLive = selectedTimeIndex === 0;
  const selectedTimestamp = isLive ? null : timestamps[selectedTimeIndex] || null;

  // Prefetch last 24 hours of data for smooth slider transitions
  usePrefetchFleetMatrix(stage, timestamps, 24);

  const { data, isLoading, error, refetch, isFetching } = useFleetMatrix(
    stage,
    selectedTimestamp
  );

  // Auto-play through history
  const handleTogglePlay = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  // Play animation effect
  useEffect(() => {
    if (!isPlaying || isLive || timestamps.length === 0) return;

    const interval = setInterval(() => {
      setSelectedTimeIndex((prev) => {
        if (prev <= 0) {
          setIsPlaying(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1500); // 1.5 seconds per step

    return () => clearInterval(interval);
  }, [isPlaying, isLive, timestamps.length]);

  const filteredMatrix = useMemo(() => {
    if (!data?.matrix) return [];

    let filtered = data.matrix;

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(
        (site) =>
          site.site_id.toLowerCase().includes(searchLower) ||
          site.site_name.toLowerCase().includes(searchLower)
      );
    }

    // Status filter
    if (statusFilter !== "all") {
      if (statusFilter === "issues") {
        filtered = filtered.filter(
          (site) =>
            site.site_status === "site_offline" ||
            site.site_status === "partial_outage"
        );
      } else {
        filtered = filtered.filter((site) => site.site_status === statusFilter);
      }
    }

    return filtered;
  }, [data?.matrix, search, statusFilter]);

  const toggleSiteExpanded = (siteId: string) => {
    setExpandedSites((prev) => {
      const next = new Set(prev);
      if (next.has(siteId)) {
        next.delete(siteId);
      } else {
        next.add(siteId);
      }
      return next;
    });
  };

  const expandAll = () => {
    if (filteredMatrix) {
      setExpandedSites(new Set(filteredMatrix.map((s) => s.site_id)));
    }
  };

  const collapseAll = () => {
    setExpandedSites(new Set());
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <AlertTriangle className="h-12 w-12 text-red-400 mb-4" />
        <h2 className="text-lg font-semibold text-chiron-text-primary">
          Failed to load fleet matrix
        </h2>
        <p className="text-sm text-chiron-text-muted mt-2">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
        <button
          onClick={() => refetch()}
          className="mt-4 px-4 py-2 bg-chiron-accent-teal/20 text-chiron-accent-teal rounded-lg hover:bg-chiron-accent-teal/30"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Fleet Matrix"
        subtitle={
          isLive
            ? "Real-time inverter production across all sites"
            : `Historical view: ${
                selectedTimestamp
                  ? new Date(selectedTimestamp).toLocaleString()
                  : "Select time"
              }`
        }
        isLoading={isFetching}
        onRefresh={() => refetch()}
      />

      {/* Time Slider */}
      <div className="px-6 py-3 bg-chiron-bg-secondary border-b border-chiron-bg-tertiary">
        <TimeSlider
          timestamps={timestamps}
          selectedIndex={selectedTimeIndex}
          onSelect={setSelectedTimeIndex}
          isPlaying={isPlaying}
          onTogglePlay={handleTogglePlay}
        />
      </div>

      {/* Summary KPIs */}
      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 px-6 py-4 bg-chiron-bg-secondary border-b border-chiron-bg-tertiary">
          <SummaryCard
            label="Total Sites"
            value={data.summary.total_sites}
            icon={Grid3X3}
            color="blue"
          />
          <SummaryCard
            label="Sites Offline"
            value={data.summary.sites_offline}
            icon={WifiOff}
            color="red"
          />
          <SummaryCard
            label="Partial Outage"
            value={data.summary.sites_partial_outage}
            icon={AlertTriangle}
            color="amber"
          />
          <SummaryCard
            label="Healthy"
            value={data.summary.sites_healthy}
            icon={CheckCircle2}
            color="emerald"
          />
          <SummaryCard
            label="Inverters Online"
            value={`${data.summary.inverters_online}/${data.summary.total_inverters}`}
            subValue={`${data.summary.inverters_offline} off`}
            icon={Zap}
            color="emerald"
          />
          <SummaryCard
            label="Fleet CF"
            value={`${data.summary.fleet_capacity_factor.toFixed(1)}%`}
            icon={TrendingDown}
            color={data.summary.fleet_capacity_factor > 50 ? "emerald" : "amber"}
          />
          <SummaryCard
            label="Total Production"
            value={`${(data.summary.total_production_kw / 1000).toFixed(1)} MW`}
            icon={Zap}
            color="blue"
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4 px-6 py-3 bg-chiron-bg-secondary border-b border-chiron-bg-tertiary">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-chiron-text-muted" />
          <input
            type="text"
            placeholder="Search sites..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-chiron-bg-tertiary border border-chiron-bg-tertiary rounded-lg text-sm text-chiron-text-primary placeholder-chiron-text-muted focus:outline-none focus:border-chiron-accent-teal"
          />
        </div>

        {/* Stage filter */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-chiron-text-muted" />
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="bg-chiron-bg-tertiary border border-chiron-bg-tertiary rounded-lg px-3 py-1.5 text-sm text-chiron-text-primary focus:outline-none focus:border-chiron-accent-teal"
          >
            <option value="FC">FC Sites</option>
            <option value="Pre-FC">Pre-FC Sites</option>
            <option value="All">All Sites</option>
          </select>
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-chiron-bg-tertiary border border-chiron-bg-tertiary rounded-lg px-3 py-1.5 text-sm text-chiron-text-primary focus:outline-none focus:border-chiron-accent-teal"
        >
          <option value="all">All Statuses</option>
          <option value="issues">With Issues</option>
          <option value="site_offline">Site Offline</option>
          <option value="partial_outage">Partial Outage</option>
          <option value="healthy">Healthy</option>
          <option value="night">Night</option>
        </select>

        {/* Expand/Collapse buttons */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={expandAll}
            className="px-3 py-1.5 text-xs bg-chiron-bg-tertiary hover:bg-chiron-accent-teal/20 rounded-lg text-chiron-text-secondary transition-colors"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="px-3 py-1.5 text-xs bg-chiron-bg-tertiary hover:bg-chiron-accent-teal/20 rounded-lg text-chiron-text-secondary transition-colors"
          >
            Collapse All
          </button>
        </div>

        {/* Refresh button */}
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="p-2 rounded-lg bg-chiron-bg-tertiary hover:bg-chiron-accent-teal/20 transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={cn(
              "h-4 w-4 text-chiron-text-muted",
              isFetching && "animate-spin"
            )}
          />
        </button>
      </div>

      {/* Legend - Binary status */}
      <div className="flex items-center gap-4 px-6 py-2 bg-chiron-bg-primary border-b border-chiron-bg-tertiary text-xs">
        <span className="text-chiron-text-muted">Inverter Status:</span>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-emerald-500/50 border border-emerald-500/50" />
          <span className="text-chiron-text-secondary">Producing</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-red-500/40 border border-red-500/50" />
          <span className="text-chiron-text-secondary">Not Producing</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-slate-700/50 border border-slate-600/50" />
          <span className="text-chiron-text-secondary">Night</span>
        </div>
        <span className="text-chiron-text-muted ml-4">• Hover for CF% • Scroll right for more inverters</span>
      </div>

      {/* Matrix table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="h-8 w-8 text-chiron-accent-teal animate-spin" />
              <span className="text-sm text-chiron-text-muted">
                Loading fleet matrix...
              </span>
            </div>
          </div>
        ) : filteredMatrix.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3">
              <Grid3X3 className="h-8 w-8 text-chiron-text-muted" />
              <span className="text-sm text-chiron-text-muted">
                No sites match your filters
              </span>
            </div>
          </div>
        ) : (
          <div className="min-w-max">
            {/* Header row */}
            <div className="flex items-center gap-2 px-3 py-2 bg-chiron-bg-tertiary text-xs font-medium text-chiron-text-muted border-b border-chiron-bg-tertiary sticky top-0 z-10">
              <div className="w-6 flex-shrink-0" /> {/* Expand toggle space */}
              <div className="w-48 flex-shrink-0">Site</div>
              <div className="w-20 flex-shrink-0">DAS</div>
              <div className="w-20 flex-shrink-0 text-right">Capacity</div>
              <div className="w-24 flex-shrink-0">Inverters</div>
              <div className="w-24 flex-shrink-0 text-right">Production</div>
              <div className="w-20 flex-shrink-0 text-right">Irradiance</div>
              <div className="w-20 flex-shrink-0">Freshness</div>
              <div className="w-16 flex-shrink-0 text-right">Local</div>
              <div className="flex-1 min-w-0">Inverter Matrix (IN1 → IN{data?.max_inverters}) - scroll for more →</div>
            </div>

            {/* Site rows */}
            {filteredMatrix.map((site) => (
              <SiteRow
                key={site.site_id}
                site={site}
                maxInverters={data?.max_inverters || 20}
                isExpanded={expandedSites.has(site.site_id)}
                onToggle={() => toggleSiteExpanded(site.site_id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer with last update */}
      {data?.generated_at && (
        <div className="px-6 py-2 bg-chiron-bg-secondary border-t border-chiron-bg-tertiary text-xs text-chiron-text-muted flex items-center justify-between">
          <span>
            Showing {filteredMatrix.length} of {data.matrix.length} sites
          </span>
          <span>
            Last updated: {new Date(data.generated_at).toLocaleTimeString()}
          </span>
        </div>
      )}
    </div>
  );
}
