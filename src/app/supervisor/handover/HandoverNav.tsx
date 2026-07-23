"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Handover Centre sub-navigation (SSW-HC-002) — the 10 modules of the section as a
// horizontal tab bar shared across every handover page. Active tab from the pathname.
// `built:false` tabs render muted ("soon") instead of dead-linking to a 404 — flipped
// to true as each module ships.
const TABS: { label: string; href: string; built?: boolean }[] = [
  { label: "Dashboard", href: "/supervisor/handover", built: true },
  { label: "Outgoing Shift", href: "/supervisor/handover/outgoing" },
  { label: "Incoming Shift", href: "/supervisor/handover/incoming" },
  { label: "Patient Handover Board", href: "/supervisor/handover/board", built: true },
  { label: "SBAR Builder", href: "/supervisor/handover/sbar", built: true },
  { label: "JBI Audit", href: "/supervisor/handover/jbi", built: true },
  { label: "Handover Tasks", href: "/supervisor/handover/tasks", built: true },
  { label: "Acceptance", href: "/supervisor/handover/acceptance" },
  { label: "AI Assistant", href: "/supervisor/handover/ai", built: true },
  { label: "Reports", href: "/supervisor/handover/reports", built: true },
];

export default function HandoverNav() {
  const path = usePathname();
  return (
    <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
      {TABS.map(t => {
        if (!t.built) return <span key={t.href} className="shrink-0 text-xs px-3 py-2 border-b-2 border-transparent -mb-px font-medium text-gray-300 cursor-default" title="Coming soon">{t.label}</span>;
        const active = t.href === "/supervisor/handover" ? path === t.href : path.startsWith(t.href);
        return <Link key={t.href} href={t.href} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium transition-colors ${active ? "border-emerald-600 text-emerald-700" : "border-transparent text-gray-400 hover:text-gray-600"}`}>{t.label}</Link>;
      })}
    </div>
  );
}
