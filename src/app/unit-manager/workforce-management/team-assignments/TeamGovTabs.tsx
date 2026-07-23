"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Team Assignment Governance tabs (TAG-001 §3.1). All seven tabs are owned by this module.
// Live Overview / Assignment Exceptions / Workload Oversight / Competency Matching /
// History & Audit are built over live op_* + audit data; Cross-Unit Deployments and
// Rules & Templates render honest next-phase surfaces (no deployment/rules store yet).
const BASE = "/unit-manager/workforce-management/team-assignments";
const TABS: { label: string; href: string }[] = [
  { label: "Live Overview", href: BASE },
  { label: "Assignment Exceptions", href: `${BASE}/exceptions` },
  { label: "Workload Oversight", href: `${BASE}/workload` },
  { label: "Competency Matching", href: `${BASE}/competency` },
  { label: "Cross-Unit Deployments", href: `${BASE}/deployments` },
  { label: "Rules & Templates", href: `${BASE}/rules` },
  { label: "History & Audit", href: `${BASE}/history` },
];

export default function TeamGovTabs() {
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
