"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Workforce Management section tabs (UMW-WFM-000). Section COMPLETE — all ten
// modules (WFM-001..009 + Overview) are built and link. Keep in sync with the
// Workforce Management group in unit-manager/layout.tsx.
const TABS: { label: string; href: string; built?: boolean }[] = [
  { label: "Overview", href: "/unit-manager/workforce-management", built: true },
  { label: "Unit Workforce Planning", href: "/unit-manager/workforce-management/establishment", built: true },
  { label: "Staffing Engine", href: "/unit-manager/workforce-management/staffing-engine", built: true },
  { label: "Team Assignments", href: "/unit-manager/workforce-management/team-assignments", built: true },
  { label: "Roster Governance", href: "/unit-manager/workforce-management/roster-governance", built: true },
  { label: "Availability & Attendance", href: "/unit-manager/workforce-management/attendance", built: true },
  { label: "Exceptions & Approvals", href: "/unit-manager/workforce-management/exceptions-approvals", built: true },
  { label: "Development & Readiness", href: "/unit-manager/workforce-management/development", built: true },
  { label: "Analytics & Reports", href: "/unit-manager/workforce-management/analytics", built: true },
  { label: "Configuration", href: "/unit-manager/workforce-management/configuration", built: true },
];

export default function WfmTabs() {
  const path = usePathname();
  return (
    <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
      {TABS.map(t => {
        if (!t.built) return <span key={t.href} className="shrink-0 text-xs px-3 py-2 border-b-2 border-transparent -mb-px font-medium text-gray-300 cursor-default" title="Next phase">{t.label}</span>;
        const active = t.href === "/unit-manager/workforce-management" ? path === t.href : path.startsWith(t.href);
        return <Link key={t.href} href={t.href} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium transition-colors ${active ? "border-emerald-600 text-emerald-700" : "border-transparent text-gray-400 hover:text-gray-600"}`}>{t.label}</Link>;
      })}
    </div>
  );
}
