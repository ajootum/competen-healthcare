"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Unit Command module tabs (UMW-003) — Unit Dashboard · Unit Operations Centre ·
// Shift Intelligence · Executive Action Centre.
const TABS = [
  { label: "Overview Dashboard", href: "/unit-manager" },
  { label: "Unit Operations Centre", href: "/unit-manager/operations-centre" },
  { label: "Shift Intelligence", href: "/unit-manager/shift-intelligence" },
  { label: "Executive Actions", href: "/unit-manager/action-centre" },
];

export default function UnitCommandTabs() {
  const path = usePathname();
  return (
    <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
      {TABS.map(t => {
        const active = t.href === "/unit-manager" ? path === "/unit-manager" : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href}
            className={`shrink-0 text-sm px-4 py-2.5 border-b-2 -mb-px font-medium transition-colors ${active ? "border-teal-600 text-teal-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
