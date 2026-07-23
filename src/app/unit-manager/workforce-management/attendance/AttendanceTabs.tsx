"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Workforce Availability & Attendance tabs (UMW-WFM-005 §5). All eleven tabs are owned by this
// module and navigable — no sidebar placeholders. Built tabs render real data over
// op_shift_staff (attendance state) + roster; store-less tabs render honest next-phase surfaces.
const BASE = "/unit-manager/workforce-management/attendance";
const TABS: { label: string; href: string }[] = [
  { label: "Live Overview", href: BASE },
  { label: "Today's Attendance", href: `${BASE}/today` },
  { label: "Staff Availability", href: `${BASE}/availability` },
  { label: "Absence & Leave", href: `${BASE}/absence` },
  { label: "Late & Early Departure", href: `${BASE}/late-early` },
  { label: "Replacement & Redeployment", href: `${BASE}/replacement` },
  { label: "Attendance Exceptions", href: `${BASE}/exceptions` },
  { label: "Future Availability", href: `${BASE}/future` },
  { label: "Attendance History", href: `${BASE}/history` },
  { label: "Reports & Analytics", href: `${BASE}/reports` },
  { label: "Rules & Settings", href: `${BASE}/settings` },
];

export default function AttendanceTabs() {
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
