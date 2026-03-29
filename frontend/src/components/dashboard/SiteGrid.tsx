"use client";

import { cn, formatCapacity, truncate } from "@/lib/utils";
import { Sun, AlertTriangle } from "lucide-react";

interface Site {
  SITE_ID: string;
  SITE_NAME: string | null;
  SIZE_KW_DC: number | null;
  PRIMARY_DAS: string | null;
  INVERTER_COUNT: number | null;
  has_alert?: boolean;
}

interface SiteGridProps {
  sites: Site[];
  selectedSite: string | null;
  onSelectSite: (siteId: string) => void;
  isLoading?: boolean;
}

export function SiteGrid({
  sites,
  selectedSite,
  onSelectSite,
  isLoading,
}: SiteGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg bg-chiron-bg-tertiary"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {sites.map((site) => (
        <button
          key={site.SITE_ID}
          onClick={() => onSelectSite(site.SITE_ID)}
          className={cn(
            "relative flex flex-col rounded-lg border p-3 text-left transition-all",
            selectedSite === site.SITE_ID
              ? "border-chiron-accent-teal bg-chiron-accent-teal/10 shadow-chiron-glow"
              : "border-chiron-accent-teal/20 bg-chiron-gradient hover:border-chiron-accent-teal/40",
            site.has_alert && "border-l-4 border-l-amber-500"
          )}
        >
          {/* Status indicator */}
          <div
            className={cn(
              "absolute right-2 top-2 h-2 w-2 rounded-full",
              site.has_alert ? "bg-amber-500" : "bg-green-500 live-dot"
            )}
          />

          {/* Site ID */}
          <div className="flex items-center gap-1.5">
            {site.has_alert ? (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            ) : (
              <Sun className="h-3.5 w-3.5 text-chiron-accent-teal" />
            )}
            <span className="text-sm font-semibold text-chiron-text-primary">
              {site.SITE_ID}
            </span>
          </div>

          {/* Site name */}
          <p className="mt-1 text-xs text-chiron-text-muted">
            {truncate(site.SITE_NAME || "", 20)}
          </p>

          {/* Capacity */}
          <div className="mt-auto flex items-center justify-between pt-2">
            <span className="text-xs text-chiron-text-muted">
              {formatCapacity(site.SIZE_KW_DC || 0)}
            </span>
            <span className="text-xs text-chiron-accent-purple">
              {site.INVERTER_COUNT || 0} inv
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
