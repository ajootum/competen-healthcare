"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Quality & Safety Command Centre (UMG-QS-001) section tabs — the eleven modules. The Executive Dashboard
// and Patient Safety Centre are real dashboards; CAPA & Improvement routes to its existing authoritative
// surface (/unit-manager/capa); the rest surface their live status and cross-link to the authoritative
// store, or note a next-phase module.
const TABS: { label: string; href: string }[] = [
  { label: "Exec Dashboard", href: "/unit-manager/quality" },
  { label: "Incidents", href: "/unit-manager/quality/incidents" },
  { label: "Audit & Compliance", href: "/unit-manager/quality/audits" },
  { label: "CAPA & Improvement", href: "/unit-manager/capa" },
  { label: "Accreditation", href: "/unit-manager/quality/accreditation" },
  { label: "Risk Register", href: "/unit-manager/quality/risk" },
  { label: "Patient Safety", href: "/unit-manager/quality/patient-safety" },
  { label: "Clinical Indicators", href: "/unit-manager/quality/indicators" },
  { label: "Mortality & Morbidity", href: "/unit-manager/quality/mortality" },
  { label: "Executive Command Centre", href: "/unit-manager/quality/analytics" },
  { label: "AI Quality Intelligence", href: "/unit-manager/quality/ai" },
];

export default function QualityTabs() {
  const path = usePathname();
  return (
    <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
      {TABS.map(t => {
        const active = path === t.href;
        return <Link key={t.href} href={t.href} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium transition-colors ${active ? "border-rose-600 text-[var(--cmp-text-error)]" : "border-transparent text-gray-400 hover:text-gray-600"}`}>{t.label}</Link>;
      })}
    </div>
  );
}
