"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { fleetApi, siteApi, alertApi, apmApi, priorityApi } from "@/lib/api";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Keep data fresh longer — monitoring data is cached server-side anyway
            staleTime: 60000,       // 1 min before considered stale
            gcTime: 300000,         // Keep unused data for 5 min
            retry: 2,
            refetchOnWindowFocus: false, // Don't refetch on tab switch — polling handles it
          },
        },
      })
  );

  // Prefetch core fleet data on app mount so first render is instant
  useEffect(() => {
    queryClient.prefetchQuery({
      queryKey: ["fleet", "summary"],
      queryFn: fleetApi.getSummary,
      staleTime: 60000,
    });
    queryClient.prefetchQuery({
      queryKey: ["fleet", "sites", { stage: "FC" }],
      queryFn: () => fleetApi.getSites({ stage: "FC" }),
      staleTime: 60000,
    });
    queryClient.prefetchQuery({
      queryKey: ["fleet", "das-options"],
      queryFn: fleetApi.getDasOptions,
      staleTime: 600000,
    });
    queryClient.prefetchQuery({
      queryKey: ["alerts", { days: 1, status: "active", stage: "FC", limit: 5 }],
      queryFn: () => alertApi.getAlerts({ days: 1, status: "active", stage: "FC", limit: 5 }),
      staleTime: 30000,
    });
    queryClient.prefetchQuery({
      queryKey: ["apm", "fleet-revenue-impact", "FC", 0.08, 7],
      queryFn: () => apmApi.getFleetRevenueImpact("FC", 0.08, 7),
      staleTime: 120000,
    });
    queryClient.prefetchQuery({
      queryKey: ["priority", "summary", "FC", 7],
      queryFn: () => priorityApi.getSummary("FC", 7),
      staleTime: 60000,
    });
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
