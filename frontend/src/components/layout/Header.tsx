"use client";

import { RefreshCw, Clock } from "lucide-react";
import { useState, useEffect } from "react";

interface HeaderProps {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  isLoading?: boolean;
}

export function Header({ title, subtitle, onRefresh, isLoading }: HeaderProps) {
  const [currentTime, setCurrentTime] = useState<string>("");

  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(
        new Date().toLocaleString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="flex items-center justify-between border-b border-chiron-accent-teal/20 bg-chiron-bg-secondary px-6 py-4">
      <div>
        <h1 className="text-xl font-bold text-chiron-text-primary">{title}</h1>
        {subtitle && (
          <p className="text-sm text-chiron-text-muted">{subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-chiron-text-muted">
          <Clock className="h-4 w-4" />
          <span className="font-mono">{currentTime}</span>
        </div>

        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-lg bg-chiron-bg-tertiary px-3 py-2 text-sm font-medium text-chiron-text-secondary transition-all hover:bg-chiron-accent-teal/20 hover:text-chiron-accent-teal disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        )}
      </div>
    </header>
  );
}
