"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  AlertTriangle,
  MapPin,
  Cpu,
  Activity,
  Target,
  Grid3X3,
  TrendingUp,
  DollarSign,
  Wrench,
  Settings,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  FileText,
  Bell,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { useState } from "react";
import { authStore } from "@/lib/api";

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  highlight?: boolean;
  badge?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navigation: NavSection[] = [
  {
    title: "Operations",
    items: [
      { name: "Fleet Overview", href: "/", icon: LayoutDashboard },
      { name: "Fleet Matrix", href: "/matrix", icon: Grid3X3, highlight: true, badge: "Live" },
      { name: "Active Issues", href: "/issues", icon: AlertTriangle, badge: "New" },
    ],
  },
  {
    title: "Analysis",
    items: [
      { name: "Sites", href: "/sites", icon: MapPin },
      { name: "Performance", href: "/performance", icon: TrendingUp },
      { name: "Equipment", href: "/equipment", icon: Cpu },
      { name: "Strings", href: "/strings", icon: BarChart3 },
    ],
  },
  {
    title: "Business",
    items: [
      { name: "Revenue Impact", href: "/revenue", icon: DollarSign },
      { name: "Maintenance", href: "/maintenance", icon: Wrench },
      { name: "Reports", href: "/reports", icon: FileText },
    ],
  },
  {
    title: "System",
    items: [
      { name: "Notifications", href: "/notifications", icon: Bell },
      { name: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const user = authStore.getUser();

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-chiron-accent-teal/20 bg-chiron-bg-secondary transition-all duration-200",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-chiron-accent-teal/20 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-chiron-accent-teal/30 to-chiron-accent-purple/30">
          <Activity className="h-5 w-5 text-chiron-accent-teal" />
        </div>
        {!collapsed && (
          <div>
            <h1 className="text-lg font-bold gradient-text">Chiron APM</h1>
            <p className="text-xs text-chiron-text-muted">Asset Performance</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-4">
        {navigation.map((section) => (
          <div key={section.title}>
            {!collapsed && (
              <h3 className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-chiron-text-muted">
                {section.title}
              </h3>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    title={collapsed ? item.name : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all",
                      collapsed && "justify-center px-2",
                      isActive
                        ? "bg-chiron-accent-teal/20 text-chiron-accent-teal"
                        : item.highlight
                        ? "text-chiron-accent-purple hover:bg-chiron-accent-purple/10 border border-chiron-accent-purple/30"
                        : "text-chiron-text-secondary hover:bg-chiron-bg-tertiary hover:text-chiron-text-primary"
                    )}
                  >
                    <item.icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        item.highlight && !isActive && "text-chiron-accent-purple"
                      )}
                    />
                    {!collapsed && (
                      <>
                        <span className="flex-1">{item.name}</span>
                        {item.badge && !isActive && (
                          <span
                            className={cn(
                              "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                              item.highlight
                                ? "text-chiron-accent-purple bg-chiron-accent-purple/10"
                                : "text-emerald-400 bg-emerald-500/10"
                            )}
                          >
                            {item.badge}
                          </span>
                        )}
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User + Collapse */}
      <div className="border-t border-chiron-accent-teal/20 p-3 space-y-2">
        {/* User info */}
        {!collapsed && user && (
          <div className="flex items-center gap-2 px-1">
            <div className="h-6 w-6 rounded-full bg-chiron-accent-teal/20 flex items-center justify-center">
              <User className="h-3.5 w-3.5 text-chiron-accent-teal" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-chiron-text-primary truncate">
                {user.display_name}
              </p>
              <p className="text-[10px] text-chiron-text-muted capitalize">{user.role}</p>
            </div>
          </div>
        )}

        {/* Live status + collapse toggle */}
        <div className="flex items-center justify-between">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500 live-dot" />
              <span className="text-xs text-chiron-text-muted">v4.0.0</span>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 rounded-md text-chiron-text-muted hover:bg-chiron-bg-tertiary hover:text-chiron-text-primary transition-colors"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}
