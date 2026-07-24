"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Validation Queue sub-module tabs (CMO-005 §2). The Validation Dashboard is the real landing
// surface; each sub-module has an honest page that surfaces its live status and routes to the
// authoritative validation workflow, or notes its next-phase store.
const TABS: { label: string; href: string }[] = [
  { label: "Validation Dashboard", href: "/competency-office/validation" },
  { label: "Evidence Inbox", href: "/competency-office/validation/inbox" },
  { label: "Pending Validation", href: "/competency-office/validation/pending" },
  { label: "AI Evidence Review", href: "/competency-office/validation/ai" },
  { label: "Committee Review", href: "/competency-office/validation/committee" },
  { label: "Appeals", href: "/competency-office/validation/appeals" },
  { label: "Bulk Validation", href: "/competency-office/validation/bulk" },
  { label: "Validation History", href: "/competency-office/validation/history" },
  { label: "Audit & Reports", href: "/competency-office/validation/audit" },
];

export default function ValidationTabs() {
  const path = usePathname();
  return (
    <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
      {TABS.map(t => {
        const active = path === t.href;
        return <Link key={t.href} href={t.href} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium transition-colors ${active ? "border-teal-600 text-teal-700" : "border-transparent text-gray-400 hover:text-gray-600"}`}>{t.label}</Link>;
      })}
    </div>
  );
}
