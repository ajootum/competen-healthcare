"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Workforce Management section tabs (UMW-WFM-000). Shared across the section; built
// tabs link, unbuilt render muted ("next phase") instead of dead-linking.
const TABS: { label: string; href: string; built?: boolean }[] = [
  { label: "Overview", href: "/unit-manager/workforce-management", built: true },
  { label: "Staffing Engine", href: "/unit-manager/workforce-management/staffing-engine", built: true },
  { label: "Team Assignments", href: "/unit-manager/workforce-management/team-assignments" },
  { label: "Roster & Scheduling", href: "/unit-manager/workforce-management/roster" },
  { label: "Competency Readiness", href: "/unit-manager/workforce-management/competency-readiness" },
  { label: "Break Management", href: "/unit-manager/workforce-management/breaks" },
  { label: "Supervisor Notes", href: "/unit-manager/workforce-management/supervisor-notes" },
  { label: "Analytics", href: "/unit-manager/workforce-management/analytics" },
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
