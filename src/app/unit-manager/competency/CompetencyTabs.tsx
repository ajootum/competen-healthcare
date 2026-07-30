"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Competency Management (UMG-CM) sub-module tabs. The Command Centre is the unit-scoped manager lens;
// Coverage/Expiries/Deliveries are dedicated unit surfaces; Validation Queue + Assessment Status reuse the
// existing unit surfaces; deep org-wide governance (analytics/frameworks) cross-links to the Competency Office
// (marked ↗) rather than being duplicated here.
const TABS: { label: string; href: string; ext?: boolean }[] = [
  { label: "Command Centre", href: "/unit-manager/competency" },
  { label: "Coverage & Gaps", href: "/unit-manager/competency/coverage" },
  { label: "Expiries & Recert", href: "/unit-manager/competency/recertification" },
  { label: "Delivered Assignments", href: "/unit-manager/competency/assignments" },
  { label: "Validation Queue", href: "/unit-manager/competency-validations" },
  { label: "Assessment Status", href: "/unit-manager/assessment" },
  { label: "Analytics", href: "/competency-office/analytics", ext: true },
];

export default function CompetencyTabs() {
  const path = usePathname();
  return (
    <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
      {TABS.map(t => {
        const active = !t.ext && (t.href === "/unit-manager/competency" ? path === t.href : path === t.href || path.startsWith(t.href + "/"));
        return (
          <Link key={t.href} href={t.href} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium transition-colors ${active ? "border-teal-600 text-teal-700" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
            {t.label}{t.ext ? " ↗" : ""}
          </Link>
        );
      })}
    </div>
  );
}
