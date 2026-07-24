"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Workforce Analytics & Reports tabs (UMW-WFM-008 §4). Live Overview + the domain analytics
// workspaces + Metric Dictionary are real over the WFM-suite loaders; Trends & Forecasts, Report
// Centre and Analytics Settings need dedicated stores → honest next-phase.
const BASE = "/unit-manager/workforce-management/analytics";
const TABS: { label: string; href: string }[] = [
  { label: "Live Overview", href: BASE },
  { label: "Planning & Establishment", href: `${BASE}/planning` },
  { label: "Coverage & Deployment", href: `${BASE}/coverage` },
  { label: "Roster & Attendance", href: `${BASE}/attendance` },
  { label: "Readiness & Development", href: `${BASE}/readiness` },
  { label: "Cost & Utilisation", href: `${BASE}/cost` },
  { label: "Exceptions & Governance", href: `${BASE}/exceptions` },
  { label: "Trends & Forecasts", href: `${BASE}/trends` },
  { label: "Report Centre", href: `${BASE}/reports` },
  { label: "Metric Dictionary", href: `${BASE}/metrics` },
  { label: "Analytics Settings", href: `${BASE}/settings` },
];

export default function AnalyticsTabs() {
  const path = usePathname();
  return (
    <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
      {TABS.map(t => {
        const active = t.href === BASE ? path === BASE : path.startsWith(t.href);
        return <Link key={t.label} href={t.href} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium transition-colors ${active ? "border-emerald-600 text-emerald-700" : "border-transparent text-gray-400 hover:text-gray-600"}`}>{t.label}</Link>;
      })}
    </div>
  );
}
