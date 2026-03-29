"use client";

import { useState } from "react";
import { Header } from "@/components/layout/Header";
import {
  Settings,
  Bell,
  DollarSign,
  Clock,
  RefreshCw,
  Zap,
  Globe,
  Save,
  CheckCircle2,
} from "lucide-react";
import { Card, Title, Badge } from "@tremor/react";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  const [saved, setSaved] = useState(false);

  // Settings state
  const [settings, setSettings] = useState({
    // Revenue Settings
    energyPrice: 0.08,
    peakSunHours: 5,

    // Alert Settings
    refreshInterval: 30,
    autoVerify: true,
    showNightSites: false,

    // Display Settings
    defaultStage: "FC",
    defaultDays: 7,
    timezone: "America/New_York",

    // Thresholds
    underperformanceThreshold: 85,
    staleDataMinutes: 60,
    stringImbalanceThreshold: 15,
  });

  const handleSave = () => {
    // In a real app, this would save to localStorage or backend
    localStorage.setItem("chiron-apm-settings", JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex h-screen flex-col">
      <Header
        title="Settings"
        subtitle="Configure Chiron APM preferences and thresholds"
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Revenue Settings */}
          <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="h-5 w-5 text-green-400" />
              <Title className="!text-chiron-text-primary">Revenue Calculation</Title>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-chiron-text-primary">Energy Price ($/kWh)</p>
                  <p className="text-xs text-chiron-text-muted">Average PPA rate for revenue calculations</p>
                </div>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="1"
                  value={settings.energyPrice}
                  onChange={(e) => setSettings({ ...settings, energyPrice: parseFloat(e.target.value) || 0.08 })}
                  className="w-24 px-3 py-1.5 rounded bg-chiron-bg-tertiary border border-chiron-accent-teal/20 text-sm text-chiron-text-primary focus:outline-none focus:border-chiron-accent-teal text-right"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-chiron-text-primary">Peak Sun Hours</p>
                  <p className="text-xs text-chiron-text-muted">Average daily peak sun hours for estimates</p>
                </div>
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max="10"
                  value={settings.peakSunHours}
                  onChange={(e) => setSettings({ ...settings, peakSunHours: parseFloat(e.target.value) || 5 })}
                  className="w-24 px-3 py-1.5 rounded bg-chiron-bg-tertiary border border-chiron-accent-teal/20 text-sm text-chiron-text-primary focus:outline-none focus:border-chiron-accent-teal text-right"
                />
              </div>
            </div>
          </Card>

          {/* Alert Settings */}
          <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
            <div className="flex items-center gap-2 mb-4">
              <Bell className="h-5 w-5 text-amber-400" />
              <Title className="!text-chiron-text-primary">Monitoring Settings</Title>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-chiron-text-primary">Refresh Interval (seconds)</p>
                  <p className="text-xs text-chiron-text-muted">How often to refresh real-time data</p>
                </div>
                <select
                  value={settings.refreshInterval}
                  onChange={(e) => setSettings({ ...settings, refreshInterval: parseInt(e.target.value) })}
                  className="px-3 py-1.5 rounded bg-chiron-bg-tertiary border border-chiron-accent-teal/20 text-sm text-chiron-text-primary focus:outline-none focus:border-chiron-accent-teal"
                >
                  <option value="15">15 seconds</option>
                  <option value="30">30 seconds</option>
                  <option value="60">60 seconds</option>
                  <option value="120">2 minutes</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-chiron-text-primary">Show Night Sites</p>
                  <p className="text-xs text-chiron-text-muted">Include sites outside daylight hours in matrix</p>
                </div>
                <button
                  onClick={() => setSettings({ ...settings, showNightSites: !settings.showNightSites })}
                  className={cn(
                    "w-12 h-6 rounded-full transition-colors relative",
                    settings.showNightSites ? "bg-chiron-accent-teal" : "bg-chiron-bg-tertiary"
                  )}
                >
                  <div
                    className={cn(
                      "w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform",
                      settings.showNightSites ? "translate-x-6" : "translate-x-0.5"
                    )}
                  />
                </button>
              </div>
            </div>
          </Card>

          {/* Display Settings */}
          <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
            <div className="flex items-center gap-2 mb-4">
              <Settings className="h-5 w-5 text-blue-400" />
              <Title className="!text-chiron-text-primary">Display Settings</Title>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-chiron-text-primary">Default Stage</p>
                  <p className="text-xs text-chiron-text-muted">Default site filter on page load</p>
                </div>
                <select
                  value={settings.defaultStage}
                  onChange={(e) => setSettings({ ...settings, defaultStage: e.target.value })}
                  className="px-3 py-1.5 rounded bg-chiron-bg-tertiary border border-chiron-accent-teal/20 text-sm text-chiron-text-primary focus:outline-none focus:border-chiron-accent-teal"
                >
                  <option value="FC">FC Sites</option>
                  <option value="Pre-FC">Pre-FC Sites</option>
                  <option value="All">All Sites</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-chiron-text-primary">Default Analysis Period</p>
                  <p className="text-xs text-chiron-text-muted">Default time range for analytics</p>
                </div>
                <select
                  value={settings.defaultDays}
                  onChange={(e) => setSettings({ ...settings, defaultDays: parseInt(e.target.value) })}
                  className="px-3 py-1.5 rounded bg-chiron-bg-tertiary border border-chiron-accent-teal/20 text-sm text-chiron-text-primary focus:outline-none focus:border-chiron-accent-teal"
                >
                  <option value="1">24 hours</option>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                </select>
              </div>
            </div>
          </Card>

          {/* Threshold Settings */}
          <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-5 w-5 text-purple-400" />
              <Title className="!text-chiron-text-primary">Anomaly Detection Thresholds</Title>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-chiron-text-primary">Underperformance Threshold (%)</p>
                  <p className="text-xs text-chiron-text-muted">PR below this is flagged as underperforming</p>
                </div>
                <input
                  type="number"
                  min="50"
                  max="100"
                  value={settings.underperformanceThreshold}
                  onChange={(e) => setSettings({ ...settings, underperformanceThreshold: parseInt(e.target.value) || 85 })}
                  className="w-24 px-3 py-1.5 rounded bg-chiron-bg-tertiary border border-chiron-accent-teal/20 text-sm text-chiron-text-primary focus:outline-none focus:border-chiron-accent-teal text-right"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-chiron-text-primary">Stale Data Threshold (minutes)</p>
                  <p className="text-xs text-chiron-text-muted">Data older than this is considered stale</p>
                </div>
                <input
                  type="number"
                  min="15"
                  max="240"
                  value={settings.staleDataMinutes}
                  onChange={(e) => setSettings({ ...settings, staleDataMinutes: parseInt(e.target.value) || 60 })}
                  className="w-24 px-3 py-1.5 rounded bg-chiron-bg-tertiary border border-chiron-accent-teal/20 text-sm text-chiron-text-primary focus:outline-none focus:border-chiron-accent-teal text-right"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-chiron-text-primary">String Imbalance Threshold (%)</p>
                  <p className="text-xs text-chiron-text-muted">Deviation from average to flag imbalance</p>
                </div>
                <input
                  type="number"
                  min="5"
                  max="50"
                  value={settings.stringImbalanceThreshold}
                  onChange={(e) => setSettings({ ...settings, stringImbalanceThreshold: parseInt(e.target.value) || 15 })}
                  className="w-24 px-3 py-1.5 rounded bg-chiron-bg-tertiary border border-chiron-accent-teal/20 text-sm text-chiron-text-primary focus:outline-none focus:border-chiron-accent-teal text-right"
                />
              </div>
            </div>
          </Card>

          {/* Save Button */}
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              className={cn(
                "flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-colors",
                saved
                  ? "bg-green-500 text-white"
                  : "bg-chiron-accent-teal text-white hover:bg-chiron-accent-teal/80"
              )}
            >
              {saved ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Saved!
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Settings
                </>
              )}
            </button>
          </div>

          {/* Version Info */}
          <div className="text-center text-xs text-chiron-text-muted pt-4 border-t border-chiron-accent-teal/20">
            <p>Chiron APM v3.0.0</p>
            <p className="mt-1">Asset Performance Management Platform</p>
          </div>
        </div>
      </div>
    </div>
  );
}
