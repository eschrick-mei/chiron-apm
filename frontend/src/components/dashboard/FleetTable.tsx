"use client";

import { useRef, useMemo, useState, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQueryClient } from "@tanstack/react-query";
import { siteApi } from "@/lib/api";
import { cn, formatCapacity, truncate } from "@/lib/utils";
import {
  Sun,
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
} from "lucide-react";

export interface FleetSite {
  SITE_ID: string;
  SITE_NAME: string | null;
  SIZE_KW_DC: number | null;
  PRIMARY_DAS: string | null;
  INVERTER_COUNT: number | null;
  has_alert?: boolean;
  alert_count?: number;
  STAGE?: string | null;
}

type SortKey = "SITE_ID" | "SITE_NAME" | "SIZE_KW_DC" | "INVERTER_COUNT" | "PRIMARY_DAS" | "alert_count";
type SortDir = "asc" | "desc";

interface FleetTableProps {
  sites: FleetSite[];
  selectedSite: string | null;
  onSelectSite: (siteId: string) => void;
  isLoading?: boolean;
}

const ROW_HEIGHT = 44;

export function FleetTable({
  sites,
  selectedSite,
  onSelectSite,
  isLoading,
}: FleetTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const [sortKey, setSortKey] = useState<SortKey>("SITE_ID");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Prefetch full site data on hover so clicking the row feels instant
  const handleRowHover = useCallback((siteId: string) => {
    queryClient.prefetchQuery({
      queryKey: ["site", siteId, "full"],
      queryFn: () => siteApi.getFull(siteId),
      staleTime: 120000,
    });
  }, [queryClient]);

  const sortedSites = useMemo(() => {
    const sorted = [...sites].sort((a, b) => {
      let aVal = a[sortKey];
      let bVal = b[sortKey];

      // Handle nulls
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      // Numeric comparison
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }

      // String comparison
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      return sortDir === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
    return sorted;
  }, [sites, sortKey, sortDir]);

  const rowVirtualizer = useVirtualizer({
    count: sortedSites.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    return sortDir === "asc" ? (
      <ChevronUp className="h-3 w-3 text-chiron-accent-teal" />
    ) : (
      <ChevronDown className="h-3 w-3 text-chiron-accent-teal" />
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-1">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="h-11 animate-pulse rounded bg-chiron-bg-tertiary"
          />
        ))}
      </div>
    );
  }

  const columns: { key: SortKey; label: string; width: string; align?: string }[] = [
    { key: "SITE_ID", label: "Site ID", width: "w-[140px]" },
    { key: "SITE_NAME", label: "Name", width: "flex-1 min-w-[180px]" },
    { key: "SIZE_KW_DC", label: "Capacity", width: "w-[100px]", align: "text-right" },
    { key: "INVERTER_COUNT", label: "Inverters", width: "w-[90px]", align: "text-right" },
    { key: "PRIMARY_DAS", label: "DAS", width: "w-[110px]" },
    { key: "alert_count", label: "Alerts", width: "w-[80px]", align: "text-right" },
  ];

  return (
    <div className="rounded-lg border border-chiron-accent-teal/20 bg-chiron-bg-secondary overflow-hidden">
      {/* Header */}
      <div className="flex items-center border-b border-chiron-accent-teal/10 bg-chiron-bg-tertiary px-3 py-2">
        <div className="w-8" /> {/* status dot column */}
        {columns.map((col) => (
          <button
            key={col.key}
            onClick={() => handleSort(col.key)}
            className={cn(
              "flex items-center gap-1 px-2 text-xs font-medium text-chiron-text-muted hover:text-chiron-text-primary transition-colors",
              col.width,
              col.align
            )}
          >
            {col.label}
            <SortIcon col={col.key} />
          </button>
        ))}
      </div>

      {/* Virtualized rows */}
      <div
        ref={parentRef}
        className="overflow-auto"
        style={{ maxHeight: "calc(100vh - 480px)", minHeight: "300px" }}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const site = sortedSites[virtualRow.index];
            const isSelected = selectedSite === site.SITE_ID;
            const hasAlert = site.has_alert || (site.alert_count || 0) > 0;

            return (
              <button
                key={site.SITE_ID}
                onClick={() => onSelectSite(site.SITE_ID)}
                onMouseEnter={() => handleRowHover(site.SITE_ID)}
                className={cn(
                  "absolute left-0 w-full flex items-center px-3 text-left transition-colors border-b border-chiron-accent-teal/5",
                  isSelected
                    ? "bg-chiron-accent-teal/10"
                    : "hover:bg-chiron-bg-tertiary/50"
                )}
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {/* Status dot */}
                <div className="w-8 flex justify-center">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      hasAlert ? "bg-amber-500" : "bg-green-500"
                    )}
                  />
                </div>

                {/* Site ID */}
                <div className="w-[140px] px-2 flex items-center gap-1.5">
                  {hasAlert ? (
                    <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                  ) : (
                    <Sun className="h-3 w-3 text-chiron-accent-teal shrink-0" />
                  )}
                  <span className="text-sm font-medium text-chiron-text-primary truncate">
                    {site.SITE_ID}
                  </span>
                </div>

                {/* Name */}
                <div className="flex-1 min-w-[180px] px-2">
                  <span className="text-sm text-chiron-text-secondary truncate block">
                    {truncate(site.SITE_NAME || "—", 30)}
                  </span>
                </div>

                {/* Capacity */}
                <div className="w-[100px] px-2 text-right">
                  <span className="text-sm text-chiron-text-secondary">
                    {formatCapacity(site.SIZE_KW_DC || 0)}
                  </span>
                </div>

                {/* Inverters */}
                <div className="w-[90px] px-2 text-right">
                  <span className="text-sm text-chiron-accent-purple">
                    {site.INVERTER_COUNT || 0}
                  </span>
                </div>

                {/* DAS */}
                <div className="w-[110px] px-2">
                  <span className="text-xs text-chiron-text-muted">
                    {site.PRIMARY_DAS || "—"}
                  </span>
                </div>

                {/* Alerts */}
                <div className="w-[80px] px-2 text-right">
                  {hasAlert ? (
                    <span className="text-xs font-medium text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                      {site.alert_count || "!"}
                    </span>
                  ) : (
                    <span className="text-xs text-chiron-text-muted">—</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-chiron-accent-teal/10 bg-chiron-bg-tertiary px-4 py-2">
        <span className="text-xs text-chiron-text-muted">
          {sortedSites.length} sites
          {sortedSites.length !== sites.length && ` (filtered from ${sites.length})`}
        </span>
      </div>
    </div>
  );
}
