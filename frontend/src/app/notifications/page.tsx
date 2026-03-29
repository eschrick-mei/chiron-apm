"use client";

import { useMemo } from "react";
import { Header } from "@/components/layout/Header";
import { useAlerts } from "@/hooks/useFleetData";
import { formatDateTime, getAlertTypeLabel, cn } from "@/lib/utils";
import {
  Bell,
  AlertTriangle,
  CheckCircle,
  Clock,
  Zap,
  WifiOff,
  Cpu,
} from "lucide-react";
import { Card } from "@tremor/react";

export default function NotificationsPage() {
  const { data: alertsData, isLoading } = useAlerts({ days: 7, stage: "FC" });

  // Build notification-like feed from recent alerts
  const notifications = useMemo(() => {
    if (!alertsData?.alerts) return [];

    return alertsData.alerts
      .map((alert) => {
        const verification = ((alert.VERIFICATION_STATUS as string) || "").toUpperCase();
        const alertType = ((alert.ALERT_TYPE as string) || "").toUpperCase();
        const severity = ((alert.SEVERITY as string) || "medium").toLowerCase();

        let icon = AlertTriangle;
        let color = "text-amber-400";
        if (alertType === "SITE_OFFLINE") {
          icon = WifiOff;
          color = "text-red-400";
        } else if (alertType === "INVERTER_OFFLINE") {
          icon = Cpu;
          color = "text-amber-400";
        }

        if (verification === "FALSE_POSITIVE") {
          icon = CheckCircle;
          color = "text-green-400";
        }

        return {
          id: alert.ALERT_ID as string,
          title: `${getAlertTypeLabel(alertType)} - ${alert.SITE_ID}`,
          description: `${alert.SITE_NAME || ""} ${alert.EQUIPMENT_NAME ? `(${alert.EQUIPMENT_NAME})` : ""}`.trim(),
          time: alert.DETECTED_AT as string,
          severity,
          verification,
          icon,
          color,
          read: verification === "FALSE_POSITIVE",
        };
      })
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 50);
  }, [alertsData]);

  return (
    <div className="p-6 space-y-6">
      <Header
        title="Notifications"
        subtitle={`${notifications.filter((n) => !n.read).length} unread`}
      />

      <Card className="!bg-chiron-bg-secondary !border-chiron-accent-teal/10 !p-0 divide-y divide-chiron-accent-teal/5">
        {isLoading && (
          <div className="p-8 text-center text-chiron-text-muted">Loading...</div>
        )}

        {!isLoading && notifications.length === 0 && (
          <div className="p-8 text-center text-chiron-text-muted">
            <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No notifications</p>
          </div>
        )}

        {notifications.map((notif) => {
          const Icon = notif.icon;
          return (
            <div
              key={notif.id}
              className={cn(
                "flex items-start gap-3 px-4 py-3 transition-colors hover:bg-chiron-bg-tertiary/30",
                !notif.read && "bg-chiron-accent-teal/5"
              )}
            >
              <div className={cn("mt-0.5 p-1.5 rounded-lg bg-chiron-bg-tertiary", notif.color)}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn("text-sm", notif.read ? "text-chiron-text-secondary" : "text-chiron-text-primary font-medium")}>
                  {notif.title}
                </p>
                <p className="text-xs text-chiron-text-muted truncate">{notif.description}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-chiron-text-muted flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDateTime(notif.time)}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded capitalize",
                      notif.severity === "critical"
                        ? "text-red-400 bg-red-500/10"
                        : notif.severity === "high"
                        ? "text-amber-400 bg-amber-500/10"
                        : "text-yellow-400 bg-yellow-500/10"
                    )}
                  >
                    {notif.severity}
                  </span>
                </div>
              </div>
              {!notif.read && (
                <div className="h-2 w-2 rounded-full bg-chiron-accent-teal mt-2 shrink-0" />
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
