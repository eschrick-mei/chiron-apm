// Chiron Analytics v2 - Utility Functions

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatCapacity(kw: number): string {
  if (kw >= 1000) {
    return `${formatNumber(kw / 1000, 1)} MW`;
  }
  return `${formatNumber(kw, 0)} kW`;
}

export function formatDuration(hours: number): string {
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours.toFixed(0)}h`;
  }
  return `${hours.toFixed(1)}h`;
}

export function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getStatusColor(status: string): string {
  const normalized = status.toUpperCase();
  switch (normalized) {
    case "ACTIVE":
    case "CONFIRMED":
    case "SITE_OFFLINE":
      return "text-red-500";
    case "INCONCLUSIVE":
    case "INVERTER_OFFLINE":
    case "WARNING":
      return "text-amber-500";
    case "RESOLVED":
    case "CLEARED":
    case "FALSE_POSITIVE":
    case "HEALTHY":
      return "text-green-500";
    default:
      return "text-slate-400";
  }
}

export function getStatusBgColor(status: string): string {
  const normalized = status.toUpperCase();
  switch (normalized) {
    case "ACTIVE":
    case "CONFIRMED":
    case "SITE_OFFLINE":
      return "bg-red-500/20 text-red-400";
    case "INCONCLUSIVE":
    case "INVERTER_OFFLINE":
    case "WARNING":
      return "bg-amber-500/20 text-amber-400";
    case "RESOLVED":
    case "CLEARED":
    case "FALSE_POSITIVE":
    case "HEALTHY":
      return "bg-green-500/20 text-green-400";
    default:
      return "bg-slate-500/20 text-slate-400";
  }
}

export function getAlertTypeLabel(type: string): string {
  return type
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + "...";
}
