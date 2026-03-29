// Chiron APM - Type Definitions

// =============================================================================
// Core Site Types
// =============================================================================

export interface Site {
  SITE_ID: string;
  SITE_NAME: string | null;
  SIZE_KW_DC: number | null;
  PRIMARY_DAS: string | null;
  INVERTER_COUNT: number | null;
  LATITUDE: number | null;
  LONGITUDE: number | null;
  DELIVERY_PHASE: string | null;
  TIMEZONE: string | null;
  PTO_ACTUAL_DATE: string | null;
  has_alert?: boolean;
}

export interface FleetSummary {
  total_sites: number;
  total_capacity_mw: number;
  healthy_sites: number;
  sites_with_alerts: number;
  fleet_health_pct: number;
  total_alerts: number;
  site_offline_count: number;
  inverter_offline_count: number;
  confirmed_alerts: number;
}

// =============================================================================
// Fleet Matrix Types (NEW APM FEATURE)
// =============================================================================

export interface InverterStatus {
  index: number;
  value: number;
  status: 'online' | 'offline' | 'night' | 'low_production';
  capacity_factor: number;
  expected_kw: number;
}

export interface FleetMatrixSite {
  site_id: string;
  site_name: string;
  primary_das: string;
  timezone: string;
  local_hour: number | null;
  is_daylight: boolean;
  inverter_count: number;
  size_kw_dc: number;
  size_kw_ac: number;  // Diagnostic: AC capacity used for CF calculation
  expected_kw_per_inv: number;  // Diagnostic: Expected kW per inverter
  inverters: InverterStatus[];
  total_production: number;
  peer_avg_kwh: number;  // Diagnostic: Peer average production
  inverters_online: number;
  inverters_offline: number;
  site_status: 'site_offline' | 'partial_outage' | 'healthy' | 'night' | 'low_production';
  measurement_time: string | null;
  minutes_ago: number | null;
  data_stale: boolean;
  has_data: boolean;  // Diagnostic: True if data was retrieved for this site
  irradiance_poa: number;
  irradiance_ghi: number;
}

export interface FleetMatrixSummary {
  total_sites: number;
  sites_offline: number;
  sites_partial_outage: number;
  sites_healthy: number;
  sites_night: number;
  sites_low_production?: number;
  total_inverters: number;
  inverters_online: number;
  inverters_offline: number;
  fleet_capacity_factor: number;
  total_production_kw: number;
  total_capacity_kw: number;
}

export interface FleetMatrixResponse {
  matrix: FleetMatrixSite[];
  max_inverters: number;
  summary: FleetMatrixSummary;
  query_timestamp: string | null;
  is_historical: boolean;
  generated_at: string;
}

// =============================================================================
// Alert Types
// =============================================================================

export interface Alert {
  ALERT_ID: string;
  SITE_ID: string;
  SITE_NAME: string | null;
  ALERT_TYPE: string;
  EQUIPMENT_ID: string | null;
  EQUIPMENT_NAME: string | null;
  VERIFICATION_STATUS: string | null;
  STATUS: string;
  DURATION_HOURS: number | null;
  DETECTED_AT: string | null;
  DELIVERY_PHASE: string | null;
  SEVERITY: string | null;
}

export interface AlertStats {
  by_type: Record<string, number>;
  by_status: Record<string, number>;
  timeline: Array<{
    HOUR: string;
    ALERT_TYPE: string;
    COUNT: number;
  }>;
  top_sites: Array<{
    SITE_ID: string;
    SITE_NAME: string;
    ALERT_COUNT: number;
    ACTIVE_COUNT: number;
  }>;
}

// =============================================================================
// Equipment Types
// =============================================================================

export interface Equipment {
  EQUIPMENT_ID: string;
  EQUIPMENT_CODE: string;
  EQUIPMENT_TYPE: string;
  DAS_NAME: string | null;
  TYPE_INDEX: number | null;
  COLUMN_MAPPING: string | null;
  CAPACITY_KW: number | null;
}

// =============================================================================
// Heatmap and Metrics Types
// =============================================================================

export interface HeatmapData {
  inverters: string[];
  timestamps: string[];
  data: number[][];
  expected_per_inverter: number;
  size_kw_dc: number;
  inverter_count: number;
}

export interface MetricDataPoint {
  MEASUREMENTTIME: string;
  METER_ENERGY?: number;
  INV_TOTAL_ENERGY?: number;
  INSOLATION_POA?: number;
  INSOLATION_GHI?: number;
  [key: string]: string | number | undefined;
}

// =============================================================================
// Site Analytics Types
// =============================================================================

export interface SiteAnalytics {
  SITE_ID: string;
  SITE_NAME: string;
  SIZE_KW_DC: number;
  PRIMARY_DAS: string;
  INVERTER_COUNT: number;
  CONFIRMED_ALERTS: number;
  ESTIMATED_KW_OFFLINE: number;
  SITE_OFFLINE_COUNT: number;
  INV_OFFLINE_COUNT: number;
  CONFIRMED_SITE_OFFLINE: number;
  CONFIRMED_INV_OFFLINE: number;
}

export interface PerformanceData {
  pr_summary: {
    pr: number | null;
    actual_production_kwh: number;
    weather_adjusted_expected_kwh: number;
    expected_production_kwh: number;
    weather_adjustment_factor: number;
    degradation_factor: number;
    years_since_pto: number;
    data_quality: string;
  };
  daily_data: Array<{
    DATE: string;
    PR_PCT: number | null;
    AVAILABILITY_PCT: number | null;
    ACTUAL_KWH: number;
    EXPECTED_KWH: number;
  }>;
}

// =============================================================================
// APM Analytics Types (NEW)
// =============================================================================

export type AnomalyType =
  | 'production_drop'
  | 'underperformance'
  | 'communication_loss'
  | 'degradation_accelerated'
  | 'weather_mismatch'
  | 'string_imbalance'
  | 'clipping';

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Anomaly {
  type: AnomalyType;
  severity: SeverityLevel;
  confidence: number;
  description: string;
  metrics: Record<string, unknown>;
  estimated_loss_kw: number;
  detected_at: string;
  affected_equipment?: string[];
}

export interface AnomalyResponse {
  site_id: string;
  period_hours: number;
  anomalies: Anomaly[];
  count: number;
  generated_at: string;
}

// =============================================================================
// Revenue Impact Types (NEW)
// =============================================================================

export interface SiteRevenueImpact {
  site_id: string;
  site_name: string;
  size_kw_dc: number;
  period_hours: number;
  actual_kwh: number;
  expected_kwh: number;
  lost_kwh: number;
  lost_revenue_usd: number;
  performance_ratio: number | null;
  energy_price_per_kwh: number;
  projected_annual_loss_usd: number;
  confirmed_alerts: number;
  capacity_factor_actual: number;
  data_quality: string;
}

export interface FleetRevenueImpactSite {
  site_id: string;
  site_name: string;
  size_kw_dc: number;
  kw_offline: number;
  estimated_daily_loss_kwh: number;
  period_loss_kwh: number;
  period_loss_usd: number;
  confirmed_alerts: number;
  site_offline: boolean;
  inverters_offline: number;
}

export interface FleetRevenueImpact {
  sites: FleetRevenueImpactSite[];
  summary: {
    total_sites_impacted: number;
    total_kw_offline: number;
    total_capacity_kw: number;
    offline_percentage: number;
    period_days: number;
    energy_price: number;
    total_lost_kwh: number;
    total_lost_revenue_usd: number;
    projected_annual_loss_usd: number;
  };
}

// =============================================================================
// Maintenance Score Types (NEW)
// =============================================================================

export interface MaintenanceFactor {
  name: string;
  weight: number;
  score: number;
  details: string;
}

export interface MaintenanceScore {
  site_id: string;
  site_name: string;
  score: number;
  status: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  recommendation: string;
  factors: MaintenanceFactor[];
  calculated_at: string;
}

// =============================================================================
// Fleet Rankings Types (NEW)
// =============================================================================

export interface SiteRanking {
  site_id: string;
  site_name: string;
  size_kw_dc: number;
  primary_das: string;
  performance_ratio: number | null;
  kwh_per_kwp: number;
  data_quality: string;
  rank: number;
}

export interface FleetRankingsResponse {
  rankings: SiteRanking[];
  metric: string;
  stage: string;
  statistics: {
    count: number;
    avg_pr: number | null;
    median_pr: number | null;
    min_pr: number | null;
    max_pr: number | null;
    std_pr: number | null;
  };
  generated_at: string;
}

// =============================================================================
// String Analysis Types (NEW)
// =============================================================================

export interface InverterAnalysis {
  inverter: string;
  total_kwh: number;
  avg_kw: number;
  max_kw: number;
  expected_kw: number;
  capacity_factor: number;
  hours_producing: number;
  total_hours: number;
  uptime_pct: number;
  issues: string[];
  status: 'healthy' | 'warning';
  is_outlier: boolean;
}

export interface StringAnalysisResponse {
  site_id: string;
  site_name: string;
  inverter_count: number;
  size_kw_dc: number;
  expected_kw_per_inverter: number;
  analysis_period_days: number;
  inverters: InverterAnalysis[];
  summary: {
    avg_capacity_factor: number;
    best_performer: string | null;
    worst_performer: string | null;
    outliers_count: number;
    total_issues: number;
  };
  generated_at: string;
}

// =============================================================================
// Priority Queue Types (NEW)
// =============================================================================

export interface PriorityQueueItem {
  site_id: string;
  site_name: string;
  primary_das: string;
  size_kw_dc: number;
  issue_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  kw_offline: number;
  offline_pct: number;
  daily_revenue_loss: number;
  urgency_score: number;
  confirmed_alerts: number;
  inverters_offline: number;
}

export interface PriorityQueueResponse {
  queue: PriorityQueueItem[];
  summary: {
    total_issues: number;
    critical_count: number;
    total_kw_offline: number;
    total_daily_loss: number;
    projected_monthly_loss: number;
  };
  generated_at: string;
}

export interface PrioritySummary {
  kpis: {
    fleet_health_pct: number;
    availability_pct: number;
    total_sites: number;
    sites_with_issues: number;
    total_capacity_mw: number;
    capacity_offline_mw: number;
    total_alerts: number;
    confirmed_alerts: number;
    site_offline_count: number;
    inverter_offline_count: number;
    daily_revenue_loss_usd: number;
    monthly_revenue_loss_usd: number;
  };
  period_days: number;
  stage: string;
  generated_at: string;
}

// =============================================================================
// Fleet KPI Table Types (NEW)
// =============================================================================

export interface SiteKPI {
  site_id: string;
  site_name: string;
  size_kw_dc: number;
  size_kw_ac: number;
  primary_das: string;
  years_since_pto: number;
  rank: number;
  is_bess_site: boolean;

  // Production metrics
  meter_production_kwh: number;
  inverter_production_kwh: number;
  smart_production_kwh: number;
  production_source: 'meter' | 'inverter' | 'none';
  expected_production_kwh: number;
  weather_adjusted_expected_kwh: number;

  // Insolation
  actual_insolation: number;
  expected_insolation: number;
  insolation_gap: number; // Percentage: positive = sunnier, negative = cloudier

  // Performance ratios
  pr_raw: number | null;
  pr_weather_adjusted: number | null;

  // Factors
  weather_factor: number;
  degradation_factor: number;

  // Other KPIs
  availability_pct: number | null;
  availability_estimated: boolean; // True if availability was estimated from CF
  specific_yield_kwh_kwp: number;
  capacity_factor_pct: number | null;

  // Revenue metrics (from pre-computed DAILY_DATA_LIVE)
  revenue_rate?: number;
  total_revenue?: number;
  variance_wa_revenue?: number;
  snow_loss_kwh?: number;

  // Data quality
  hours_with_data: number;
  days_with_data?: number;
  data_quality: 'good' | 'partial' | 'no_data';
  data_quality_flags: string[]; // e.g., 'wa_pr_extreme_high', 'insolation_gap_extreme_negative'
  irradiance_type: 'POA' | 'GHI';

  // Statistics inclusion flag (false if data quality issues found)
  wa_pr_valid_for_stats?: boolean;
}

export interface FleetKPIStatistics {
  site_count: number;
  sites_valid_for_stats?: number;  // Sites included in PR calculations
  sites_with_data_quality_issues?: number;  // Sites excluded due to bad data
  wa_pr_avg: number | null;
  wa_pr_median: number | null;
  wa_pr_min: number | null;
  wa_pr_max: number | null;
  raw_pr_avg: number | null;
  availability_avg: number | null;
  total_production_kwh: number;
  total_capacity_kw: number;
  total_revenue?: number;
  total_variance_wa_revenue?: number;
}

export interface FleetKPIResponse {
  kpis: SiteKPI[];
  stage: string;
  period_days: number;
  start_date?: string;
  end_date?: string;
  statistics: FleetKPIStatistics;
  generated_at: string;
}

// =============================================================================
// Verification Types
// =============================================================================

export interface VerificationResult {
  status: "CONFIRMED" | "FALSE_POSITIVE" | "INCONCLUSIVE" | "ERROR" | "PENDING";
  power_kw: number | null;
  minutes_stale: number | null;
  message: string;
  das: string | null;
  is_offline: boolean | null;
}

// =============================================================================
// Enums
// =============================================================================

export type AlertType = "SITE_OFFLINE" | "INVERTER_OFFLINE" | "METER_OFFLINE";
export type AlertStatus = "ACTIVE" | "RESOLVED";
export type VerificationStatus = "CONFIRMED" | "INCONCLUSIVE" | "CLEARED";
