"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Staffing Engine module tabs (WSE-STAFF-001 §2). Overview / Real-Time Coverage / Staff
// Availability are built here; Requirements, Skills & Competencies, Scenarios and Settings
// cross-link to the engines that own that data (single source of truth — no duplication).
const BASE = "/unit-manager/workforce-management/staffing-engine";
const TABS: { label: string; href: string; own?: boolean }[] = [
  { label: "Overview", href: BASE, own: true },
  { label: "Requirements", href: "/unit-manager/workforce-management/establishment" },
  { label: "Real-Time Coverage", href: `${BASE}/coverage`, own: true },
  { label: "Staff Availability", href: `${BASE}/availability`, own: true },
  { label: "Skills & Competencies", href: "/unit-manager/scheduling-engine/competency-matching" },
  { label: "Scenarios", href: "/unit-manager/scheduling-engine/scenarios" },
  { label: "History & Reports", href: "#" },
  { label: "Settings", href: "/unit-manager/planning-studio" },
];

export default function StaffEngineTabs() {
  const path = usePathname();
  return (
    <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
      {TABS.map(t => {
        if (t.href === "#") return <span key={t.label} className="shrink-0 text-xs px-3 py-2 border-b-2 border-transparent -mb-px font-medium text-gray-300 cursor-default" title="Next phase">{t.label}</span>;
        const active = t.own && (t.href === BASE ? path === BASE : path.startsWith(t.href));
        return <Link key={t.label} href={t.href} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium transition-colors ${active ? "border-emerald-600 text-emerald-700" : "border-transparent text-gray-400 hover:text-gray-600"}`}>{t.label}{!t.own && <span className="text-gray-300 ml-0.5">↗</span>}</Link>;
      })}
    </div>
  );
}
