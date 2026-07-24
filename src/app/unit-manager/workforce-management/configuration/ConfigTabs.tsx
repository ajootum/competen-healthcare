"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Workforce Configuration tabs (UMW-WFM-009 §5). Configuration Dashboard, Change Management and
// Audit History are mandatory. The live config (establishment/shift/leave/cost parameters) is
// real over wps_config (WPS-001); the full governance model + remaining domain editors need
// dedicated stores → honest next-phase.
const BASE = "/unit-manager/workforce-management/configuration";
const TABS: { label: string; href: string }[] = [
  { label: "Dashboard", href: BASE },
  { label: "Organisation & Structure", href: `${BASE}/structure` },
  { label: "Establishment & Staffing", href: `${BASE}/establishment` },
  { label: "Shift & Roster Rules", href: `${BASE}/shift-rules` },
  { label: "Availability, Leave & Attendance", href: `${BASE}/availability` },
  { label: "Competency & Readiness", href: `${BASE}/competency` },
  { label: "Approvals & Escalations", href: `${BASE}/approvals` },
  { label: "Alerts & Notifications", href: `${BASE}/alerts` },
  { label: "Analytics & Reports", href: `${BASE}/analytics-config` },
  { label: "AI & Optimisation", href: `${BASE}/ai` },
  { label: "Integrations", href: `${BASE}/integrations` },
  { label: "Security & Delegation", href: `${BASE}/security` },
  { label: "Versions & Releases", href: `${BASE}/releases` },
  { label: "Audit History", href: `${BASE}/audit` },
];

export default function ConfigTabs() {
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
