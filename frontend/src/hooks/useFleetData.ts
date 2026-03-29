"use client";

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fleetApi,
  siteApi,
  alertApi,
  analyticsApi,
  equipmentApi,
  apmApi,
  priorityApi,
} from "@/lib/api";

// =============================================================================
// Fleet Hooks
// =============================================================================

export function useFleetSummary() {
  return useQuery({
    queryKey: ["fleet", "summary"],
    queryFn: fleetApi.getSummary,
    refetchInterval: 60000,
    staleTime: 45000,
  });
}

export function useFleetSites(params?: {
  search?: string;
  status?: string;
  das?: string;
  stage?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["fleet", "sites", params],
    queryFn: () => fleetApi.getSites(params),
    refetchInterval: 120000,
    staleTime: 60000,
  });
}

export function useDasOptions() {
  return useQuery({
    queryKey: ["fleet", "das-options"],
    queryFn: fleetApi.getDasOptions,
    staleTime: 300000, // 5 minutes
  });
}

// Fleet Matrix for real-time/historical inverter grid
export function useFleetMatrix(stage: string = "FC", timestamp?: string | null) {
  return useQuery({
    queryKey: ["fleet", "matrix", stage, timestamp],
    queryFn: () => fleetApi.getMatrix(stage, timestamp || undefined),
    // Only auto-refresh for real-time view (no timestamp)
    refetchInterval: timestamp ? false : 30000,
    staleTime: timestamp ? 60000 : 15000,
  });
}

// Get available timestamps for historical slider
export function useFleetTimestamps(hours: number = 72) {
  return useQuery({
    queryKey: ["fleet", "timestamps", hours],
    queryFn: () => fleetApi.getTimestamps(hours),
    staleTime: 300000, // 5 minutes - timestamps don't change often
  });
}

// Prefetch fleet matrix data for multiple timestamps (for smooth slider)
export function usePrefetchFleetMatrix(
  stage: string,
  timestamps: string[],
  maxPrefetch: number = 24
) {
  const queryClient = useQueryClient();

  // Prefetch the first N timestamps for smooth slider transitions
  useEffect(() => {
    if (!timestamps || timestamps.length === 0) return;

    // Prefetch up to maxPrefetch timestamps (usually last 24 hours)
    const toPrefetch = timestamps.slice(0, maxPrefetch);

    toPrefetch.forEach((ts) => {
      // Only prefetch if not already in cache
      const cached = queryClient.getQueryData(["fleet", "matrix", stage, ts]);
      if (!cached) {
        queryClient.prefetchQuery({
          queryKey: ["fleet", "matrix", stage, ts],
          queryFn: () => fleetApi.getMatrix(stage, ts),
          staleTime: 120000, // Cache for 2 minutes
        });
      }
    });
  }, [queryClient, stage, timestamps, maxPrefetch]);
}

// =============================================================================
// Site Hooks
// =============================================================================

export function useSiteDetails(siteId: string | null) {
  return useQuery({
    queryKey: ["site", siteId, "details"],
    queryFn: () => siteApi.getDetails(siteId!),
    enabled: !!siteId,
    staleTime: 120000,
    gcTime: 300000,
  });
}

export function useSiteHeatmap(siteId: string | null, days: number = 7) {
  return useQuery({
    queryKey: ["site", siteId, "heatmap", days],
    queryFn: () => siteApi.getHeatmap(siteId!, days),
    enabled: !!siteId,
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

export function useSiteMetrics(siteId: string | null, days: number = 5) {
  return useQuery({
    queryKey: ["site", siteId, "metrics", days],
    queryFn: () => siteApi.getMetrics(siteId!, days),
    enabled: !!siteId,
    staleTime: 60000,
  });
}

export function useSitePerformance(siteId: string | null) {
  return useQuery({
    queryKey: ["site", siteId, "performance"],
    queryFn: () => siteApi.getPerformance(siteId!),
    enabled: !!siteId,
    staleTime: 120000,
  });
}

/** Single combined hook — fetches all site data in one API call */
export function useSiteFull(siteId: string | null) {
  return useQuery({
    queryKey: ["site", siteId, "full"],
    queryFn: () => siteApi.getFull(siteId!),
    enabled: !!siteId,
    staleTime: 120000,
    gcTime: 300000,
  });
}

// =============================================================================
// Alert Hooks
// =============================================================================

export function useAlerts(params?: {
  days?: number;
  status?: string;
  alert_type?: string;
  verification?: string;
  site_id?: string;
  stage?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["alerts", params],
    queryFn: () => alertApi.getAlerts(params),
    refetchInterval: 30000,
    staleTime: 15000,
  });
}

export function useAlertStats(days: number = 7, verification?: string) {
  return useQuery({
    queryKey: ["alerts", "stats", days, verification],
    queryFn: () => alertApi.getStats(days, verification),
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

export function useAlertDetail(
  alertId: string | null,
  siteId: string | null,
  alertType: string | null,
  equipmentId?: string | null
) {
  return useQuery({
    queryKey: ["alert", alertId, "detail", siteId, alertType, equipmentId],
    queryFn: () => alertApi.getDetail(alertId!, siteId!, alertType!, equipmentId || undefined),
    enabled: !!alertId && !!siteId && !!alertType,
    staleTime: 30000,
  });
}

export function useVerifyAlert() {
  const queryClient = useQueryClient();

  return useMutation({
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
}

// =============================================================================
// Analytics Hooks
// =============================================================================

export function useSitesAnalytics(stage: string = "FC", days: number = 7) {
  return useQuery({
    queryKey: ["analytics", "sites", stage, days],
    queryFn: () => analyticsApi.getSitesAnalytics(stage, days),
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

// =============================================================================
// Equipment Hooks
// =============================================================================

export function useSiteEquipment(siteId: string | null) {
  return useQuery({
    queryKey: ["equipment", siteId],
    queryFn: () => equipmentApi.getSiteEquipment(siteId!),
    enabled: !!siteId,
    staleTime: 60000,
  });
}

// =============================================================================
// APM Analytics Hooks (NEW)
// =============================================================================

export function useAnomalies(siteId: string | null, hours: number = 24) {
  return useQuery({
    queryKey: ["apm", "anomalies", siteId, hours],
    queryFn: () => apmApi.getAnomalies(siteId!, hours),
    enabled: !!siteId,
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

export function useSiteRevenueImpact(
  siteId: string | null,
  energyPrice?: number,
  hours: number = 168
) {
  return useQuery({
    queryKey: ["apm", "revenue-impact", siteId, energyPrice, hours],
    queryFn: () => apmApi.getSiteRevenueImpact(siteId!, energyPrice, hours),
    enabled: !!siteId,
    staleTime: 120000,
  });
}

export function useFleetRevenueImpact(
  stage: string = "FC",
  energyPrice?: number,
  days: number = 7
) {
  return useQuery({
    queryKey: ["apm", "fleet-revenue-impact", stage, energyPrice, days],
    queryFn: () => apmApi.getFleetRevenueImpact(stage, energyPrice, days),
    refetchInterval: 120000,
    staleTime: 60000,
  });
}

export function useMaintenanceScore(siteId: string | null) {
  return useQuery({
    queryKey: ["apm", "maintenance-score", siteId],
    queryFn: () => apmApi.getMaintenanceScore(siteId!),
    enabled: !!siteId,
    staleTime: 300000, // 5 minutes
  });
}

export function useFleetMaintenanceScores(stage: string = "FC", limit: number = 100) {
  return useQuery({
    queryKey: ["apm", "maintenance-scores", stage, limit],
    queryFn: () => apmApi.getFleetMaintenanceScores(stage, limit),
    staleTime: 120000, // 2 minutes
    refetchInterval: 300000, // 5 minutes
  });
}

export function useFleetRankings(stage: string = "FC", metric: string = "performance") {
  return useQuery({
    queryKey: ["apm", "fleet-rankings", stage, metric],
    queryFn: () => apmApi.getFleetRankings(stage, metric),
    refetchInterval: 120000,
    staleTime: 60000,
  });
}

export function useStringAnalysis(siteId: string | null, days: number = 7) {
  return useQuery({
    queryKey: ["apm", "string-analysis", siteId, days],
    queryFn: () => apmApi.getStringAnalysis(siteId!, days),
    enabled: !!siteId,
    staleTime: 120000,
  });
}

// Fleet KPI Table - comprehensive performance metrics for all sites
export function useFleetKPIs(
  stage: string = "FC",
  days: number = 7,
  startDate?: string,
  endDate?: string
) {
  return useQuery({
    queryKey: ["apm", "fleet-kpis", stage, days, startDate, endDate],
    queryFn: () => apmApi.getFleetKPIs(stage, days, startDate, endDate),
    refetchInterval: 120000, // 2 minutes
    staleTime: 60000, // 1 minute
  });
}

// =============================================================================
// Priority Operations Hooks (Enhanced)
// =============================================================================

export function usePriorityQueue(stage: string = "FC", limit: number = 20) {
  return useQuery({
    queryKey: ["priority", "queue", stage, limit],
    queryFn: () => priorityApi.getQueue(stage, limit),
    refetchInterval: 30000,
    staleTime: 15000,
  });
}

export function usePrioritySummary(stage: string = "FC", days: number = 7) {
  return useQuery({
    queryKey: ["priority", "summary", stage, days],
    queryFn: () => priorityApi.getSummary(stage, days),
    refetchInterval: 30000,
    staleTime: 15000,
  });
}
