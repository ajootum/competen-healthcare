"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Learning Oversight & Development Centre sub-module tabs (UMG-005). The Learning Dashboard is the
// real landing surface; each sub-module has an honest page that surfaces its live status and routes
// to its authoritative surface (educator / competency office) or notes its next-phase store.
const TABS: { label: string; href: string }[] = [
  { label: "Learning Dashboard", href: "/unit-manager/learning" },
  { label: "Mandatory Learning", href: "/unit-manager/learning/mandatory" },
  { label: "Professional Development", href: "/unit-manager/learning/development" },
  { label: "Career Pathways", href: "/unit-manager/learning/pathways" },
  { label: "Education Schedule", href: "/unit-manager/learning/schedule" },
  { label: "Learning Analytics", href: "/unit-manager/learning/analytics" },
];

export default function LearningTabs() {
  const path = usePathname();
  return (
    <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
      {TABS.map(t => {
        const active = path === t.href;
        return <Link key={t.href} href={t.href} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium transition-colors ${active ? "border-emerald-600 text-emerald-700" : "border-transparent text-gray-400 hover:text-gray-600"}`}>{t.label}</Link>;
      })}
    </div>
  );
}
