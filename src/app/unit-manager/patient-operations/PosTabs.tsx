"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Patient Operations section tabs (POS-001 §2). Shared across the section. Built
// tabs link; the two operational data-entry surfaces (POS-106 Operations Centre,
// POS-109 Documentation) render muted "next phase" instead of dead-linking. Keep
// in sync with POS_MODULES in lib/operations/patient-operations.ts and the Patient
// Operations group in unit-manager/layout.tsx.
const TABS: { label: string; href: string; built?: boolean }[] = [
  { label: "Dashboard", href: "/unit-manager/patient-operations", built: true },
  { label: "Census & Registry", href: "/unit-manager/patient-operations/census", built: true },
  { label: "Patient Flow", href: "/unit-manager/patient-operations/flow", built: true },
  { label: "Bed & Capacity", href: "/unit-manager/patient-operations/beds", built: true },
  { label: "Ward Map", href: "/unit-manager/patient-operations/ward-map", built: true },
  { label: "Operations Centre", href: "/unit-manager/patient-operations/operations-centre", built: true },
  { label: "Clinical Safety", href: "/unit-manager/patient-operations/safety", built: true },
  { label: "Patient Card", href: "/unit-manager/patient-operations/patient-card", built: true },
  { label: "Documentation", href: "/unit-manager/patient-operations/documentation", built: true },
  { label: "Timeline", href: "/unit-manager/patient-operations/timeline", built: true },
  { label: "Analytics", href: "/unit-manager/patient-operations/analytics", built: true },
  { label: "Configuration", href: "/unit-manager/patient-operations/configuration", built: true },
];

export default function PosTabs() {
  const path = usePathname();
  return (
    <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
      {TABS.map(t => {
        if (!t.built) return <span key={t.href} className="shrink-0 text-xs px-3 py-2 border-b-2 border-transparent -mb-px font-medium text-gray-300 cursor-default" title="Next phase">{t.label}</span>;
        const active = t.href === "/unit-manager/patient-operations" ? path === t.href : path.startsWith(t.href);
        return <Link key={t.href} href={t.href} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium transition-colors ${active ? "border-emerald-600 text-emerald-700" : "border-transparent text-gray-400 hover:text-gray-600"}`}>{t.label}</Link>;
      })}
    </div>
  );
}
