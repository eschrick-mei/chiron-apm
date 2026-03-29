// Chiron APM v4.0 - API Client
// Supports JWT auth tokens and multi-user sessions

import type {
  FleetSummary,
  FleetMatrixResponse,
  HeatmapData,
  PerformanceData,
  AlertStats,
  VerificationResult,
  AnomalyResponse,
  SiteRevenueImpact,
  FleetRevenueImpact,
  MaintenanceScore,
  FleetRankingsResponse,
  StringAnalysisResponse,
  PriorityQueueResponse,
  PrioritySummary,
  FleetKPIResponse,
} from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

// =============================================================================
// Auth Token Management
// =============================================================================

const TOKEN_KEY = "chiron_token";
const USER_KEY = "chiron_user";

export interface AuthUser {
  username: string;
  display_name: string;
  role: string;
  email?: string;
}

export const authStore = {
  getToken: (): string | null => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(TOKEN_KEY);
  },

  setToken: (token: string) => {
    localStorage.setItem(TOKEN_KEY, token);
  },

  getUser: (): AuthUser | null => {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },

  setUser: (user: AuthUser) => {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },

  isLoggedIn: (): boolean => {
    return !!authStore.getToken();
  },
};

// =============================================================================
// Fetch Wrapper with Auth
// =============================================================================

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const token = authStore.getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    // Token expired or invalid — clear auth state
    authStore.clear();
    // Don't throw for auth endpoints to avoid loops
    if (!endpoint.includes("/auth/")) {
      throw new Error("Session expired. Please log in again.");
    }
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error: ${response.status} ${response.statusText} - ${body}`);
  }

  return response.json();
}

// =============================================================================
// Auth Endpoints
// =============================================================================

export const authApi = {
  login: async (username: string, password: string) => {
    const result = await fetchApi<{
      token: string;
      user: AuthUser;
      expires_at: string;
    }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    authStore.setToken(result.token);
    authStore.setUser(result.user);
    return result;
  },

  logout: () => {
    authStore.clear();
  },

  getMe: () =>
    fetchApi<{ user: AuthUser; auth_enabled: boolean }>("/api/auth/me"),

  getUsers: () =>
    fetchApi<Array<AuthUser>>("/api/auth/users"),

  createUser: (username: string, password: string, displayName: string, role = "viewer") =>
    fetchApi<{ user: AuthUser }>("/api/auth/users", {
      method: "POST",
      body: JSON.stringify({ username, password, display_name: displayName, role }),
    }),
};

// =============================================================================
// Fleet Endpoints
// =============================================================================

export const fleetApi = {
  getSummary: () => fetchApi<FleetSummary>("/api/fleet/summary"),

  getSites: (params?: {
    search?: string;
    status?: string;
    das?: string;
    stage?: string;
    limit?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.append("search", params.search);
    if (params?.status) searchParams.append("status", params.status);
    if (params?.das) searchParams.append("das", params.das);
    if (params?.stage) searchParams.append("stage", params.stage);
    if (params?.limit) searchParams.append("limit", params.limit.toString());
    const query = searchParams.toString();
    return fetchApi<Array<Record<string, unknown>>>(`/api/fleet/sites${query ? `?${query}` : ""}`);
  },

  getDasOptions: () => fetchApi<string[]>("/api/fleet/das-options"),

  getMatrix: (stage: string = "FC", timestamp?: string) => {
    const params = new URLSearchParams({ stage });
    if (timestamp) params.append("timestamp", timestamp);
    return fetchApi<FleetMatrixResponse>(`/api/fleet/matrix?${params}`);
  },

  getTimestamps: (hours: number = 72) =>
    fetchApi<{ timestamps: string[]; count: number; hours_requested: number }>(
      `/api/fleet/timestamps?hours=${hours}`
    ),
};

// =============================================================================
// Site Endpoints
// =============================================================================

export const siteApi = {
  getDetails: (siteId: string) =>
    fetchApi<{
      site: Record<string, unknown>;
      equipment: Array<Record<string, unknown>>;
      alerts: Array<Record<string, unknown>>;
      latest_values: Record<string, unknown>;
    }>(`/api/sites/${siteId}`),

  getHeatmap: (siteId: string, days = 7) =>
    fetchApi<HeatmapData>(`/api/sites/${siteId}/heatmap?days=${days}`),

  getMetrics: (siteId: string, days = 5) =>
    fetchApi<{ data: Array<Record<string, unknown>> }>(`/api/sites/${siteId}/metrics?days=${days}`),

  getPerformance: (siteId: string) =>
    fetchApi<PerformanceData>(`/api/sites/${siteId}/performance`),

  /** Combined endpoint — all site data in a single request */
  getFull: (siteId: string, metricsDays = 7, heatmapDays = 5) =>
    fetchApi<{
      site: Record<string, unknown>;
      equipment: Array<Record<string, unknown>>;
      alerts: Array<Record<string, unknown>>;
      latest_values: Record<string, unknown>;
      metrics: { data: Array<Record<string, unknown>> };
      heatmap: HeatmapData;
      performance: PerformanceData;
    }>(`/api/sites/${siteId}/full?metrics_days=${metricsDays}&heatmap_days=${heatmapDays}`),
};

// =============================================================================
// Alert Endpoints
// =============================================================================

export const alertApi = {
  getAlerts: (params?: {
    days?: number;
    status?: string;
    alert_type?: string;
    verification?: string;
    site_id?: string;
    stage?: string;
    limit?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.days) searchParams.append("days", params.days.toString());
    if (params?.status) searchParams.append("status", params.status);
    if (params?.alert_type) searchParams.append("alert_type", params.alert_type);
    if (params?.verification) searchParams.append("verification", params.verification);
    if (params?.site_id) searchParams.append("site_id", params.site_id);
    if (params?.stage) searchParams.append("stage", params.stage);
    if (params?.limit) searchParams.append("limit", params.limit.toString());
    const query = searchParams.toString();
    return fetchApi<{
      alerts: Array<Record<string, unknown>>;
      count: number;
    }>(`/api/alerts${query ? `?${query}` : ""}`);
  },

  getStats: (days = 7, verification?: string) => {
    const searchParams = new URLSearchParams();
    searchParams.append("days", days.toString());
    if (verification) searchParams.append("verification", verification);
    return fetchApi<AlertStats>(`/api/alerts/stats?${searchParams.toString()}`);
  },

  getDetail: (alertId: string, siteId: string, alertType: string, equipmentId?: string) => {
    const searchParams = new URLSearchParams();
    searchParams.append("site_id", siteId);
    searchParams.append("alert_type", alertType);
    if (equipmentId) searchParams.append("equipment_id", equipmentId);
    return fetchApi<{ data: Array<Record<string, unknown>> }>(
      `/api/alerts/${alertId}/detail?${searchParams.toString()}`
    );
  },

  verify: (alertId: string, siteId: string, alertType: string, equipmentId?: string) => {
    const searchParams = new URLSearchParams();
    searchParams.append("site_id", siteId);
    searchParams.append("alert_type", alertType);
    if (equipmentId) searchParams.append("equipment_id", equipmentId);
    return fetchApi<VerificationResult>(`/api/alerts/${alertId}/verify?${searchParams.toString()}`, {
      method: "POST",
    });
  },
};

// =============================================================================
// Analytics Endpoints
// =============================================================================

export const analyticsApi = {
  getSitesAnalytics: (stage = "FC", days = 7) =>
    fetchApi<{
      sites: Array<Record<string, unknown>>;
      summary: {
        total_sites: number;
        sites_with_issues: number;
        total_kw_offline: number;
        total_capacity: number;
        offline_pct: number;
      };
    }>(`/api/analytics/sites?stage=${stage}&days=${days}`),
};

// =============================================================================
// Equipment Endpoints
// =============================================================================

export const equipmentApi = {
  getSiteEquipment: (siteId: string) =>
    fetchApi<{
      site: Record<string, unknown>;
      equipment_by_type: Record<string, Array<Record<string, unknown>>>;
      latest_values: Record<string, unknown>;
    }>(`/api/equipment/${siteId}`),
};

// =============================================================================
// APM Analytics Endpoints
// =============================================================================

export const apmApi = {
  getAnomalies: (siteId: string, hours = 24) =>
    fetchApi<AnomalyResponse>(`/api/apm/anomalies/${siteId}?hours=${hours}`),

  getSiteRevenueImpact: (siteId: string, energyPrice?: number, hours = 168) => {
    const params = new URLSearchParams();
    params.append("hours", hours.toString());
    if (energyPrice) params.append("energy_price", energyPrice.toString());
    return fetchApi<SiteRevenueImpact>(`/api/apm/revenue-impact/${siteId}?${params.toString()}`);
  },

  getFleetRevenueImpact: (stage = "FC", energyPrice?: number, days = 7) => {
    const params = new URLSearchParams();
    params.append("stage", stage);
    params.append("days", days.toString());
    if (energyPrice) params.append("energy_price", energyPrice.toString());
    return fetchApi<FleetRevenueImpact>(`/api/apm/revenue-impact?${params.toString()}`);
  },

  getMaintenanceScore: (siteId: string) =>
    fetchApi<MaintenanceScore>(`/api/apm/maintenance-score/${siteId}`),

  getFleetMaintenanceScores: (stage = "FC", limit = 100) =>
    fetchApi<{
      scores: Array<{
        site_id: string;
        score: number;
        status: string;
        confirmed_alerts: number;
        kw_offline_pct: number;
        inv_offline: number;
      }>;
      count: number;
      generated_at: string;
    }>(`/api/apm/maintenance-scores?stage=${stage}&limit=${limit}`),

  getFleetRankings: (stage = "FC", metric = "performance") =>
    fetchApi<FleetRankingsResponse>(`/api/apm/fleet-rankings?stage=${stage}&metric=${metric}`),

  getStringAnalysis: (siteId: string, days = 7) =>
    fetchApi<StringAnalysisResponse>(`/api/apm/string-analysis/${siteId}?days=${days}`),

  getFleetKPIs: (stage = "FC", days = 7, startDate?: string, endDate?: string) => {
    const params = new URLSearchParams();
    params.append("stage", stage);
    params.append("days", days.toString());
    if (startDate) params.append("start_date", startDate);
    if (endDate) params.append("end_date", endDate);
    return fetchApi<FleetKPIResponse>(`/api/apm/fleet-kpis?${params.toString()}`);
  },
};

// =============================================================================
// Priority Operations Endpoints
// =============================================================================

export const priorityApi = {
  getQueue: (stage = "FC", limit = 20) =>
    fetchApi<PriorityQueueResponse>(`/api/priority/queue?stage=${stage}&limit=${limit}`),

  getSummary: (stage = "FC", days = 7) =>
    fetchApi<PrioritySummary>(`/api/priority/summary?stage=${stage}&days=${days}`),
};

// =============================================================================
// Cache Management (admin)
// =============================================================================

export const cacheApi = {
  getStats: () =>
    fetchApi<Record<string, unknown>>("/api/cache/stats"),

  flush: () =>
    fetchApi<{ status: string; by: string }>("/api/cache/flush", { method: "POST" }),
};
