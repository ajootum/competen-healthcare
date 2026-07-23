"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Workforce Exceptions & Approvals tabs (UMW-WFM-006 §6). All fourteen tabs owned by this
// module. Live Overview / My Approval Queue / All Exceptions + the category views are real over
// approval_requests + the workforce exception stores; Rules & Delegated Authority is honest.
const BASE = "/unit-manager/workforce-management/exceptions-approvals";
const TABS: { label: string; href: string }[] = [
  { label: "Live Overview", href: BASE },
  { label: "My Approval Queue", href: `${BASE}/queue` },
  { label: "All Exceptions", href: `${BASE}/all` },
  { label: "Staffing", href: `${BASE}/staffing` },
  { label: "Roster & Shift", href: `${BASE}/roster` },
  { label: "Overtime & Hours", href: `${BASE}/overtime` },
  { label: "Attendance & Leave", href: `${BASE}/attendance` },
  { label: "Redeployment", href: `${BASE}/redeployment` },
  { label: "Competency & Credential", href: `${BASE}/competency` },
  { label: "Emergency & Retrospective", href: `${BASE}/emergency` },
  { label: "Escalations", href: `${BASE}/escalations` },
  { label: "History & Audit", href: `${BASE}/history` },
  { label: "Analytics", href: `${BASE}/analytics` },
  { label: "Rules & Authority", href: `${BASE}/rules` },
];

export default function WfmExcTabs() {
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
