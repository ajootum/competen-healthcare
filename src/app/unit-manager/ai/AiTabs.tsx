"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// AI & Intelligence (UMG-AI) tabs. The Command Centre + Executive Recommendations are the unit-scoped hub;
// the domain intelligence lenses (Operational / Workforce / Quality / Predictive) already exist as their own
// authoritative surfaces and are cross-linked (↗) rather than duplicated here.
const TABS: { label: string; href: string; ext?: boolean }[] = [
  { label: "Command Centre", href: "/unit-manager/ai" },
  { label: "Executive Recommendations", href: "/unit-manager/ai/recommendations" },
  { label: "Operational", href: "/unit-manager/ops-performance", ext: true },
  { label: "Workforce", href: "/unit-manager/workforce-intelligence", ext: true },
  { label: "Quality", href: "/unit-manager/quality/ai", ext: true },
  { label: "Predictive", href: "/unit-manager/performance/predictive", ext: true },
];

export default function AiTabs() {
  const path = usePathname();
  return (
    <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
      {TABS.map(t => {
        const active = !t.ext && (t.href === "/unit-manager/ai" ? path === t.href : path.startsWith(t.href));
        return (
          <Link key={t.href} href={t.href} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium transition-colors ${active ? "border-violet-600 text-violet-700" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
            {t.label}{t.ext ? " ↗" : ""}
          </Link>
        );
      })}
    </div>
  );
}
