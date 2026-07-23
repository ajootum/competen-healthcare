"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Roster Governance submodule tabs (UMW-WFM-004 §5). All twelve submodules are owned by this
// module and navigable — no sidebar placeholders (spec §31). Built submodules render real
// data over the roster store + engines; the store-less ones render honest next-phase surfaces.
const BASE = "/unit-manager/workforce-management/roster-governance";
const TABS: { label: string; href: string }[] = [
  { label: "Governance Overview", href: BASE },
  { label: "Roster Review", href: `${BASE}/review` },
  { label: "Coverage & Safety", href: `${BASE}/coverage` },
  { label: "Compliance & Constraints", href: `${BASE}/compliance` },
  { label: "Skill Mix & Supervisor", href: `${BASE}/skill-mix` },
  { label: "Fairness, Fatigue & Cost", href: `${BASE}/fairness` },
  { label: "Exceptions & Resolutions", href: `${BASE}/exceptions` },
  { label: "Approval & Publication", href: `${BASE}/approval` },
  { label: "Amendments & Swaps", href: `${BASE}/amendments` },
  { label: "Planned vs Actual", href: `${BASE}/planned-vs-actual` },
  { label: "History & Reports", href: `${BASE}/history` },
  { label: "Governance Settings", href: `${BASE}/settings` },
];

export default function RosterGovTabs() {
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
