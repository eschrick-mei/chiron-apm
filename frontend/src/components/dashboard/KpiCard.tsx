"use client";

import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: {
    value: number;
    label: string;
    positive?: boolean;
  };
  status?: "success" | "warning" | "danger" | "neutral";
  className?: string;
}

export function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  status = "neutral",
  className,
}: KpiCardProps) {
  const statusColors = {
    success: "border-l-green-500",
    warning: "border-l-amber-500",
    danger: "border-l-red-500",
    neutral: "border-l-chiron-accent-teal",
  };

  const statusBgColors = {
    success: "bg-green-500/10",
    warning: "bg-amber-500/10",
    danger: "bg-red-500/10",
    neutral: "bg-chiron-accent-teal/10",
  };

  const valueColors = {
    success: "text-green-500",
    warning: "text-amber-500",
    danger: "text-red-500",
    neutral: "text-chiron-accent-teal",
  };

  return (
    <div
      className={cn(
        "relative rounded-xl bg-chiron-gradient border border-chiron-accent-teal/20 p-4 card-hover",
        statusColors[status],
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-chiron-text-muted">
            {title}
          </p>
          <p className={cn("mt-2 text-2xl font-bold", valueColors[status])}>
            {value}
          </p>
          {subtitle && (
            <p className="mt-1 text-sm text-chiron-text-muted">{subtitle}</p>
          )}
          {trend && (
            <div className="mt-2 flex items-center gap-1">
              <span
                className={cn(
                  "text-xs font-medium",
                  trend.positive ? "text-green-500" : "text-red-500"
                )}
              >
                {trend.positive ? "+" : ""}
                {trend.value}%
              </span>
              <span className="text-xs text-chiron-text-muted">
                {trend.label}
              </span>
            </div>
          )}
        </div>

        {Icon && (
          <div className={cn("rounded-lg p-2", statusBgColors[status])}>
            <Icon className={cn("h-5 w-5", valueColors[status])} />
          </div>
        )}
      </div>
    </div>
  );
}
