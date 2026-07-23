"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Workforce Development & Readiness tabs (UMW-WFM-007 §6). Live Overview / Workforce Readiness /
// Competency Coverage / Credentials / Analytics / History are real over the Competency system;
// learning, orientation, supervision, plans, cross-training and succession need dedicated stores
// → honest next-phase.
const BASE = "/unit-manager/workforce-management/development";
const TABS: { label: string; href: string }[] = [
  { label: "Live Overview", href: BASE },
  { label: "Workforce Readiness", href: `${BASE}/readiness` },
  { label: "Competency Coverage", href: `${BASE}/coverage` },
  { label: "Mandatory Learning", href: `${BASE}/learning` },
  { label: "Credentials & Expiry", href: `${BASE}/credentials` },
  { label: "Orientation", href: `${BASE}/orientation` },
  { label: "Supervision", href: `${BASE}/supervision` },
  { label: "Development Plans", href: `${BASE}/plans` },
  { label: "Cross-Training", href: `${BASE}/cross-training` },
  { label: "Succession", href: `${BASE}/succession` },
  { label: "Readiness Exceptions", href: `${BASE}/exceptions` },
  { label: "Development Actions", href: `${BASE}/actions` },
  { label: "History & Audit", href: `${BASE}/history` },
  { label: "Analytics", href: `${BASE}/analytics` },
  { label: "Rules & Settings", href: `${BASE}/rules` },
];

export default function DevTabs() {
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
