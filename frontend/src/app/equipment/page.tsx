"use client";

import { useState, useMemo } from "react";
import { Header } from "@/components/layout/Header";
import { useFleetSites, useSiteDetails } from "@/hooks/useFleetData";
import { formatNumber, formatCapacity, cn, truncate } from "@/lib/utils";
import {
  Search,
  Cpu,
  Zap,
  Sun,
  Thermometer,
  ChevronRight,
  GitBranch,
  List,
  ChevronDown,
} from "lucide-react";
import { Card, Title, Badge, Text, TabGroup, TabList, Tab, TabPanels, TabPanel } from "@tremor/react";
import { useQueryClient } from "@tanstack/react-query";
import { equipmentApi } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

// Equipment type icons
const equipmentIcons: Record<string, React.ReactNode> = {
  PV: <Zap className="h-4 w-4 text-indigo-400" />,
  PM: <Cpu className="h-4 w-4 text-green-400" />,
  WS: <Thermometer className="h-4 w-4 text-amber-400" />,
  SR: <Sun className="h-4 w-4 text-purple-400" />,
  MD: <Sun className="h-4 w-4 text-cyan-400" />,
};

const equipmentLabels: Record<string, string> = {
  PV: "Inverters",
  PM: "Meters",
  WS: "Weather Stations",
  SR: "Strings",
  MD: "Modules",
};

// 2D Digital Twin Component - Visual equipment layout
function DigitalTwinView({
  equipmentByType,
  latestValues,
  getValue,
}: {
  equipmentByType: Record<string, Array<Record<string, unknown>>>;
  latestValues: Record<string, number>;
  getValue: (eq: Record<string, unknown>) => number | null;
}) {
  // Build hierarchical structure with proper parent-child relationships
  const { inverterBlocks, weatherStations, meters, orphanStrings } = useMemo(() => {
    const inverters = (equipmentByType["PV"] || []) as Array<Record<string, unknown>>;
    const strings = (equipmentByType["SR"] || []) as Array<Record<string, unknown>>;
    const ws = (equipmentByType["WS"] || []) as Array<Record<string, unknown>>;
    const pm = (equipmentByType["PM"] || []) as Array<Record<string, unknown>>;

    // Sort inverters by TYPE_INDEX
    const sortedInverters = [...inverters].sort((a, b) =>
      ((a.TYPE_INDEX as number) || 0) - ((b.TYPE_INDEX as number) || 0)
    );

    // Map strings to their parent inverters using multiple matching strategies
    const stringAssignments = new Map<string, string>(); // stringId -> inverterId

    // Build a lookup of HARDWARE_ID -> EQUIPMENT_ID for inverters
    const hardwareToEquipment = new Map<string, string>();
    sortedInverters.forEach(inv => {
      const hwId = inv.HARDWARE_ID as string | number;
      if (hwId) {
        hardwareToEquipment.set(String(hwId), inv.EQUIPMENT_ID as string);
      }
    });

    strings.forEach((s) => {
      const stringId = s.EQUIPMENT_ID as string;
      const parentId = s.PARENT_EQUIPMENT_ID as string;
      const dasName = (s.DAS_NAME as string || "").toUpperCase();
      const eqCode = (s.EQUIPMENT_CODE as string || "").toUpperCase();
      const configKey = (s.EQUIPMENT_ID as string || "").toUpperCase();

      // Strategy 1: Use source_inverter_ids from ATTRIBUTES JSON (most reliable)
      const attributes = s.ATTRIBUTES as Record<string, unknown> | string | null;
      if (attributes) {
        let attrObj: Record<string, unknown> | null = null;
        if (typeof attributes === 'string') {
          try { attrObj = JSON.parse(attributes); } catch { /* ignore */ }
        } else {
          attrObj = attributes;
        }
        if (attrObj && Array.isArray(attrObj.source_inverter_ids) && attrObj.source_inverter_ids.length > 0) {
          const sourceInvId = String(attrObj.source_inverter_ids[0]);
          const matchingInvEqId = hardwareToEquipment.get(sourceInvId);
          if (matchingInvEqId) {
            stringAssignments.set(stringId, matchingInvEqId);
            return;
          }
        }
      }

      // Strategy 2: Extract inverter index from configuration_key in EQUIPMENT_ID
      // e.g., SR-39849-IN1_19mod_325W_180az_25tilt -> IN1
      const invMatch = configKey.match(/IN(\d+)[_-]/);
      if (invMatch) {
        const invIndex = parseInt(invMatch[1], 10);
        const matchingInv = sortedInverters.find(inv => (inv.TYPE_INDEX as number) === invIndex);
        if (matchingInv) {
          stringAssignments.set(stringId, matchingInv.EQUIPMENT_ID as string);
          return;
        }
      }

      // Strategy 3: Direct PARENT_EQUIPMENT_ID match
      if (parentId) {
        const matchingInv = sortedInverters.find(inv =>
          (inv.EQUIPMENT_ID as string) === parentId ||
          String(inv.HARDWARE_ID) === parentId
        );
        if (matchingInv) {
          stringAssignments.set(stringId, matchingInv.EQUIPMENT_ID as string);
          return;
        }
      }

      // Strategy 4: Match by naming convention in DAS_NAME or EQUIPMENT_CODE
      for (const inv of sortedInverters) {
        const invIndex = inv.TYPE_INDEX as number;
        const invId = inv.EQUIPMENT_ID as string;
        const invDasName = (inv.DAS_NAME as string || "").toUpperCase();

        const patterns = [
          `INV${invIndex}`,
          `IN${invIndex}_`,
          `IN${invIndex}-`,
          `_IN${invIndex}_`,
        ];

        const stringText = `${parentId || ""} ${dasName} ${eqCode}`;
        const matchFound = patterns.some(p => stringText.includes(p));

        if (matchFound) {
          stringAssignments.set(stringId, invId);
          break;
        }
      }
    });

    // Build inverter blocks with their strings
    const blocks = sortedInverters.map((inv) => {
      const invId = inv.EQUIPMENT_ID as string;
      const invStrings = strings.filter(s =>
        stringAssignments.get(s.EQUIPMENT_ID as string) === invId
      ).sort((a, b) =>
        ((a.TYPE_INDEX as number) || 0) - ((b.TYPE_INDEX as number) || 0)
      );

      return {
        inverter: inv,
        value: getValue(inv),
        strings: invStrings.map(s => ({
          equipment: s,
          value: getValue(s),
        })),
      };
    });

    // Find orphan strings
    const assignedIds = new Set(stringAssignments.keys());
    const orphans = strings.filter(s => !assignedIds.has(s.EQUIPMENT_ID as string));

    return {
      inverterBlocks: blocks,
      weatherStations: ws,
      meters: pm,
      orphanStrings: orphans,
    };
  }, [equipmentByType, getValue]);

  // Determine grid columns based on number of inverters
  const gridCols = inverterBlocks.length <= 4 ? 2 :
                   inverterBlocks.length <= 9 ? 3 :
                   inverterBlocks.length <= 16 ? 4 : 5;

  return (
    <div className="space-y-6">
      {/* Site Layout Title */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-chiron-accent-teal" />
          <h3 className="text-lg font-semibold text-chiron-text-primary">
            2D Digital Twin - Equipment Layout
          </h3>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-emerald-500" />
            <span className="text-chiron-text-muted">Producing</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-red-500" />
            <span className="text-chiron-text-muted">Offline</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-slate-600" />
            <span className="text-chiron-text-muted">No Data</span>
          </div>
        </div>
      </div>

      {/* Main Grid Layout */}
      <div className="relative">
        {/* Inverter Array - 2D Grid */}
        <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-5 w-5 text-indigo-400" />
            <Title className="!text-chiron-text-primary">
              Inverter Array ({inverterBlocks.length} inverters, {inverterBlocks.reduce((sum, b) => sum + b.strings.length, 0)} strings)
            </Title>
          </div>

          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}
          >
            {inverterBlocks.map((block) => {
              const invIndex = block.inverter.TYPE_INDEX as number || 1;
              const isProducing = block.value !== null && block.value > 0;
              const totalStringPower = block.strings.reduce((sum, s) => sum + (s.value || 0), 0);

              return (
                <div
                  key={block.inverter.EQUIPMENT_ID as string}
                  className={cn(
                    "rounded-lg border-2 p-3 transition-all",
                    isProducing
                      ? "border-emerald-500/50 bg-emerald-500/10"
                      : block.value === null
                      ? "border-slate-600/50 bg-slate-600/10"
                      : "border-red-500/50 bg-red-500/10"
                  )}
                >
                  {/* Inverter Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Zap className={cn(
                        "h-5 w-5",
                        isProducing ? "text-emerald-400" : block.value === null ? "text-slate-400" : "text-red-400"
                      )} />
                      <span className="font-bold text-chiron-text-primary">
                        INV {invIndex}
                      </span>
                    </div>
                    <span className={cn(
                      "font-mono text-lg font-bold",
                      isProducing ? "text-emerald-400" : block.value === null ? "text-slate-400" : "text-red-400"
                    )}>
                      {block.value !== null ? `${formatNumber(block.value, 0)}` : "-"}
                      <span className="text-xs ml-1">kW</span>
                    </span>
                  </div>

                  {/* Strings Grid - Visual representation */}
                  {block.strings.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs text-chiron-text-muted flex items-center gap-1">
                        <GitBranch className="h-3 w-3 rotate-180" />
                        {block.strings.length} strings connected
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {block.strings.map((s, idx) => {
                          const stringProducing = s.value !== null && s.value > 0;
                          const stringIndex = (s.equipment.TYPE_INDEX as number) || idx + 1;

                          return (
                            <div
                              key={s.equipment.EQUIPMENT_ID as string}
                              className={cn(
                                "relative rounded p-1.5 text-center transition-all cursor-default",
                                stringProducing
                                  ? "bg-purple-500/30 border border-purple-500/50"
                                  : s.value === null
                                  ? "bg-slate-600/30 border border-slate-600/50"
                                  : "bg-red-500/30 border border-red-500/50"
                              )}
                              title={`String ${stringIndex}: ${s.value !== null ? formatNumber(s.value, 1) : "No data"}`}
                            >
                              <span className="text-[10px] font-mono text-chiron-text-secondary">
                                S{stringIndex}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-chiron-text-muted italic">
                      No strings mapped
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Weather Station Area - Separate zone */}
        {weatherStations.length > 0 && (
          <Card className="!bg-chiron-gradient !border-amber-500/30 mt-4">
            <div className="flex items-center gap-2 mb-4">
              <Thermometer className="h-5 w-5 text-amber-400" />
              <Title className="!text-chiron-text-primary">
                Weather Station Zone
              </Title>
            </div>
            <div className="flex flex-wrap gap-3">
              {weatherStations.map((ws) => {
                const value = getValue(ws);
                return (
                  <div
                    key={ws.EQUIPMENT_ID as string}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10"
                  >
                    <Thermometer className="h-6 w-6 text-amber-400" />
                    <div>
                      <div className="text-sm font-medium text-chiron-text-primary">
                        {ws.DAS_NAME as string || `WS ${ws.TYPE_INDEX || 1}`}
                      </div>
                      <div className="text-lg font-bold text-amber-400 font-mono">
                        {value !== null ? `${formatNumber(value, 0)} W/m²` : "No data"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Meters Area */}
        {meters.length > 0 && (
          <Card className="!bg-chiron-gradient !border-green-500/30 mt-4">
            <div className="flex items-center gap-2 mb-4">
              <Cpu className="h-5 w-5 text-green-400" />
              <Title className="!text-chiron-text-primary">
                Meter Zone
              </Title>
            </div>
            <div className="flex flex-wrap gap-3">
              {meters.map((meter) => {
                const value = getValue(meter);
                const isOnline = value !== null && value !== 0;
                return (
                  <div
                    key={meter.EQUIPMENT_ID as string}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-lg border",
                      isOnline
                        ? "border-green-500/30 bg-green-500/10"
                        : "border-red-500/30 bg-red-500/10"
                    )}
                  >
                    <Cpu className={cn("h-6 w-6", isOnline ? "text-green-400" : "text-red-400")} />
                    <div>
                      <div className="text-sm font-medium text-chiron-text-primary">
                        {meter.DAS_NAME as string || `Meter ${meter.TYPE_INDEX || 1}`}
                      </div>
                      <div className={cn(
                        "text-lg font-bold font-mono",
                        isOnline ? "text-green-400" : "text-red-400"
                      )}>
                        {value !== null ? `${formatNumber(value, 0)} kW` : "Offline"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Orphan Strings - if any couldn't be mapped */}
        {orphanStrings.length > 0 && (
          <Card className="!bg-chiron-gradient !border-purple-500/30 mt-4">
            <div className="flex items-center gap-2 mb-4">
              <Sun className="h-5 w-5 text-purple-400" />
              <Title className="!text-chiron-text-primary">
                Unmapped Strings ({orphanStrings.length})
              </Title>
              <span className="text-xs text-chiron-text-muted">
                (Could not determine parent inverter)
              </span>
            </div>
            <div className="grid grid-cols-6 gap-2">
              {orphanStrings.map((s, idx) => {
                const value = getValue(s);
                const isProducing = value !== null && value > 0;
                return (
                  <div
                    key={s.EQUIPMENT_ID as string}
                    className={cn(
                      "rounded p-2 text-center border",
                      isProducing
                        ? "bg-purple-500/20 border-purple-500/40"
                        : value === null
                        ? "bg-slate-600/20 border-slate-600/40"
                        : "bg-red-500/20 border-red-500/40"
                    )}
                    title={`${s.DAS_NAME || `String ${idx + 1}`}: ${value !== null ? formatNumber(value, 1) : "No data"}`}
                  >
                    <Sun className={cn(
                      "h-4 w-4 mx-auto",
                      isProducing ? "text-purple-400" : value === null ? "text-slate-400" : "text-red-400"
                    )} />
                    <span className="text-[10px] text-chiron-text-muted block mt-1">
                      {(s.DAS_NAME as string || `S${idx + 1}`).slice(0, 8)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function EquipmentPage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSite, setSelectedSite] = useState<string | null>(null);

  const { data: sites, isLoading: sitesLoading, refetch } = useFleetSites({
    search: searchTerm || undefined,
    limit: 100,
  });

  const { data: equipmentData, isLoading: equipmentLoading } = useQuery({
    queryKey: ["equipment", selectedSite],
    queryFn: () => equipmentApi.getSiteEquipment(selectedSite!),
    enabled: !!selectedSite,
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["fleet"] });
    queryClient.invalidateQueries({ queryKey: ["equipment"] });
    refetch();
  };

  const site = equipmentData?.site as Record<string, unknown>;
  const equipmentByType = equipmentData?.equipment_by_type || {};
  const latestValues = (equipmentData?.latest_values || {}) as Record<string, number>;

  // Get equipment value from latest values
  const getValue = (equipment: Record<string, unknown>): number | null => {
    const colMapping = equipment.COLUMN_MAPPING as string;
    if (colMapping && latestValues[colMapping] !== undefined) {
      return latestValues[colMapping];
    }
    return null;
  };

  return (
    <div className="flex h-screen flex-col">
      <Header
        title="Equipment Registry"
        subtitle="Explore equipment hierarchy and live values"
        onRefresh={handleRefresh}
        isLoading={sitesLoading || equipmentLoading}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Site selector */}
        <div className="w-72 flex-shrink-0 overflow-y-auto border-r border-chiron-accent-teal/20 bg-chiron-bg-secondary p-4">
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-chiron-text-muted" />
              <input
                type="text"
                placeholder="Search sites..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-chiron-accent-teal/20 bg-chiron-bg-tertiary py-2 pl-10 pr-4 text-sm text-chiron-text-primary placeholder:text-chiron-text-muted focus:border-chiron-accent-teal focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-1">
            {(sites || []).map((s: Record<string, unknown>) => {
              const siteId = s.SITE_ID as string;
              const isSelected = selectedSite === siteId;

              return (
                <button
                  key={siteId}
                  onClick={() => setSelectedSite(siteId)}
                  className={cn(
                    "w-full rounded-lg border p-3 text-left transition-all",
                    isSelected
                      ? "border-chiron-accent-teal bg-chiron-accent-teal/10"
                      : "border-transparent hover:bg-chiron-bg-tertiary"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-chiron-text-primary">{siteId}</span>
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 text-chiron-text-muted transition-transform",
                        isSelected && "rotate-90"
                      )}
                    />
                  </div>
                  <p className="mt-1 truncate text-xs text-chiron-text-muted">
                    {truncate((s.SITE_NAME as string) || "", 25)}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-chiron-text-muted">
                    <span>{(s.INVERTER_COUNT as number) || 0} inv</span>
                    <span>•</span>
                    <span>{formatCapacity((s.SIZE_KW_DC as number) || 0)}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <p className="mt-4 text-center text-xs text-chiron-text-muted">
            {(sites || []).length} sites
          </p>
        </div>

        {/* Right: Equipment details */}
        <div className="flex-1 overflow-y-auto p-6">
          {selectedSite && site ? (
            <div className="space-y-6">
              {/* Site header */}
              <div className="rounded-xl border border-chiron-accent-teal/20 bg-chiron-gradient p-4">
                <div className="flex items-center gap-3">
                  <Cpu className="h-6 w-6 text-chiron-accent-teal" />
                  <div>
                    <h2 className="text-xl font-bold text-chiron-accent-teal">
                      {selectedSite}
                    </h2>
                    <p className="text-sm text-chiron-text-secondary">
                      {site.SITE_NAME as string}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-4 gap-4">
                  <div className="text-center">
                    <p className="text-xs text-chiron-text-muted">Capacity</p>
                    <p className="font-semibold text-chiron-text-primary">
                      {formatCapacity((site.SIZE_KW_DC as number) || 0)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-chiron-text-muted">Inverters</p>
                    <p className="font-semibold text-chiron-text-primary">
                      {site.INVERTER_COUNT as number || 0}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-chiron-text-muted">DAS</p>
                    <p className="font-semibold text-chiron-text-primary">
                      {site.PRIMARY_DAS as string || "N/A"}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-chiron-text-muted">Total Equipment</p>
                    <p className="font-semibold text-chiron-text-primary">
                      {Object.values(equipmentByType).reduce(
                        (sum, list) => sum + (list as Array<unknown>).length,
                        0
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Tabbed View: List vs Digital Twin */}
              <TabGroup defaultIndex={1}>
                <TabList className="!border-chiron-accent-teal/20">
                  <Tab className="!text-chiron-text-muted data-[selected]:!text-chiron-accent-teal data-[selected]:!border-chiron-accent-teal flex items-center gap-2">
                    <List className="h-4 w-4" />
                    List View
                  </Tab>
                  <Tab className="!text-chiron-text-muted data-[selected]:!text-chiron-accent-teal data-[selected]:!border-chiron-accent-teal flex items-center gap-2">
                    <GitBranch className="h-4 w-4" />
                    2D Digital Twin
                  </Tab>
                </TabList>

                <TabPanels className="mt-4">
                  {/* List View */}
                  <TabPanel>
                    <div className="space-y-6">
                      {Object.entries(equipmentByType).map(([type, equipment]) => {
                        const equipList = equipment as Array<Record<string, unknown>>;
                        if (equipList.length === 0) return null;

                        return (
                          <Card
                            key={type}
                            className="!bg-chiron-gradient !border-chiron-accent-teal/20"
                          >
                            <div className="flex items-center gap-2">
                              {equipmentIcons[type] || <Cpu className="h-4 w-4" />}
                              <Title className="!text-chiron-text-primary">
                                {equipmentLabels[type] || type} ({equipList.length})
                              </Title>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                              {equipList.map((eq, i) => {
                                const value = getValue(eq);
                                const isOffline = value === 0 || value === null;
                                const typeIndex = (eq.TYPE_INDEX as number) || i + 1;

                                return (
                                  <div
                                    key={eq.EQUIPMENT_ID as string}
                                    className={cn(
                                      "rounded-lg border p-3 transition-all",
                                      isOffline
                                        ? "border-red-500/30 bg-red-500/5"
                                        : "border-chiron-accent-teal/20 bg-chiron-bg-primary/50"
                                    )}
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        {type === "PV" && (
                                          <Zap
                                            className={cn(
                                              "h-4 w-4",
                                              isOffline ? "text-red-400" : "text-indigo-400"
                                            )}
                                          />
                                        )}
                                        <span className="font-medium text-chiron-text-primary">
                                          {type === "PV" ? `INV ${typeIndex}` : (eq.DAS_NAME as string) || `${type} ${typeIndex}`}
                                        </span>
                                      </div>
                                      {value !== null && (
                                        <span
                                          className={cn(
                                            "font-mono text-sm font-semibold",
                                            isOffline ? "text-red-400" : "text-chiron-accent-teal"
                                          )}
                                        >
                                          {value >= 1000
                                            ? `${(value / 1000).toFixed(1)}k`
                                            : formatNumber(value, 0)}
                                        </span>
                                      )}
                                    </div>

                                    <div className="mt-2 space-y-1 text-xs">
                                      {(eq.COLUMN_MAPPING as string) ? (
                                        <p className="font-mono text-chiron-accent-purple">
                                          {eq.COLUMN_MAPPING as string}
                                        </p>
                                      ) : null}
                                      {(eq.CAPACITY_KW as number) > 0 ? (
                                        <p className="text-chiron-text-muted">
                                          {formatCapacity((eq.CAPACITY_KW as number) || 0)} capacity
                                        </p>
                                      ) : null}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </Card>
                        );
                      })}

                      {Object.keys(equipmentByType).length === 0 && (
                        <Card className="!bg-chiron-gradient !border-chiron-accent-teal/20">
                          <div className="flex h-48 flex-col items-center justify-center text-chiron-text-muted">
                            <Cpu className="h-12 w-12 opacity-30" />
                            <p className="mt-4">No equipment found in registry</p>
                          </div>
                        </Card>
                      )}
                    </div>
                  </TabPanel>

                  {/* 2D Digital Twin */}
                  <TabPanel>
                    <DigitalTwinView
                      equipmentByType={equipmentByType as Record<string, Array<Record<string, unknown>>>}
                      latestValues={latestValues}
                      getValue={getValue}
                    />
                  </TabPanel>
                </TabPanels>
              </TabGroup>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-chiron-text-muted">
              <Cpu className="h-20 w-20 opacity-20" />
              <p className="mt-6 text-lg">Select a site to explore equipment</p>
              <p className="mt-2 text-sm">
                View inverters, meters, weather stations, strings, and modules
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
