"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// AI Scheduling Engine module tabs (WSE-001). Shared across engine pages; built tabs
// link, unbuilt render muted ("next phase").
const TABS: { label: string; href: string; built?: boolean }[] = [
  { label: "Overview", href: "/unit-manager/scheduling-engine", built: true },
  { label: "Demand Optimiser", href: "/unit-manager/scheduling-engine/demand-optimiser", built: true },
  { label: "Scheduling Engine", href: "/unit-manager/scheduling-engine#scheduling" },
  { label: "Constraints & Rules", href: "/unit-manager/scheduling-engine/constraints", built: true },
  { label: "Competency Matching", href: "/unit-manager/scheduling-engine/competency-matching", built: true },
  { label: "Fairness", href: "/unit-manager/scheduling-engine/fairness", built: true },
  { label: "Cost Optimisation", href: "/unit-manager/scheduling-engine/cost", built: true },
  { label: "Scenario Planner", href: "#" },
  { label: "What-if Simulator", href: "#" },
  { label: "Recommendations", href: "#" },
  { label: "Publish & Approve", href: "#" },
  { label: "Analytics", href: "#" },
  { label: "Settings", href: "#" },
];

export default function SchedulingTabs() {
  const path = usePathname();
  return (
    <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
      {TABS.map(t => {
        if (!t.built) return <span key={t.label} className="shrink-0 text-xs px-3 py-2 border-b-2 border-transparent -mb-px font-medium text-gray-300 cursor-default" title="Next phase">{t.label}</span>;
        const active = t.href === "/unit-manager/scheduling-engine" ? path === t.href : path.startsWith(t.href);
        return <Link key={t.label} href={t.href} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium transition-colors ${active ? "border-emerald-600 text-emerald-700" : "border-transparent text-gray-400 hover:text-gray-600"}`}>{t.label}</Link>;
      })}
    </div>
  );
}
