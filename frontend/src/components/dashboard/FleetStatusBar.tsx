"use client";

import { cn } from "@/lib/utils";

interface StatusSegment {
  label: string;
  count: number;
  color: string;
  bgColor: string;
}

interface FleetStatusBarProps {
  total: number;
  healthy: number;
  withAlerts: number;
  critical: number;
  noData: number;
  onSegmentClick?: (filter: string) => void;
  activeFilter?: string;
}

export function FleetStatusBar({
  total,
  healthy,
  withAlerts,
  critical,
  noData,
  onSegmentClick,
  activeFilter,
}: FleetStatusBarProps) {
  const segments: StatusSegment[] = [
    { label: "Healthy", count: healthy, color: "bg-green-500", bgColor: "bg-green-500/20" },
    { label: "Active Issues", count: withAlerts, color: "bg-amber-500", bgColor: "bg-amber-500/20" },
    { label: "Critical", count: critical, color: "bg-red-500", bgColor: "bg-red-500/20" },
    { label: "No Data", count: noData, color: "bg-slate-500", bgColor: "bg-slate-500/20" },
  ];

  const filterMap: Record<string, string> = {
    Healthy: "healthy",
    "Active Issues": "alerts",
    Critical: "critical",
    "No Data": "no_data",
  };

  return (
    <div className="space-y-2">
      {/* Segment bar */}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-chiron-bg-tertiary">
        {segments.map((seg) => {
          const pct = total > 0 ? (seg.count / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <button
              key={seg.label}
              onClick={() => onSegmentClick?.(filterMap[seg.label])}
              className={cn(
                seg.color,
                "h-full transition-all hover:opacity-80",
                activeFilter === filterMap[seg.label] && "ring-2 ring-white/50"
              )}
              style={{ width: `${pct}%` }}
              title={`${seg.label}: ${seg.count} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4">
        {segments.map((seg) => (
          <button
            key={seg.label}
            onClick={() => onSegmentClick?.(filterMap[seg.label])}
            className={cn(
              "flex items-center gap-1.5 text-xs transition-colors",
              activeFilter === filterMap[seg.label]
                ? "text-chiron-text-primary font-medium"
                : "text-chiron-text-muted hover:text-chiron-text-secondary"
            )}
          >
            <span className={cn("h-2.5 w-2.5 rounded-full", seg.color)} />
            {seg.label}: {seg.count}
          </button>
        ))}
        {activeFilter && (
          <button
            onClick={() => onSegmentClick?.("")}
            className="text-xs text-chiron-accent-teal hover:underline"
          >
            Clear filter
          </button>
        )}
      </div>
    </div>
  );
}
