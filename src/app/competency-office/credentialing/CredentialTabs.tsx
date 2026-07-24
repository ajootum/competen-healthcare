"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Credential Management sub-module tabs (CMO-003 §4). The Credential Dashboard is the real landing
// surface (with the staff register preview); each sub-module has an honest page that surfaces its
// live status and routes to its authoritative surface or notes its next-phase store.
const TABS: { label: string; href: string }[] = [
  { label: "Credential Dashboard", href: "/competency-office/credentialing" },
  { label: "Staff Register", href: "/competency-office/credentialing/register" },
  { label: "Types & Requirements", href: "/competency-office/credentialing/types" },
  { label: "Verification Queue", href: "/competency-office/credentialing/verification" },
  { label: "Renewals & Expiries", href: "/competency-office/credentialing/renewals" },
  { label: "Privileges & Scope", href: "/competency-office/credentialing/privileges" },
  { label: "Exceptions", href: "/competency-office/credentialing/exceptions" },
  { label: "Document Repository", href: "/competency-office/credentialing/documents" },
  { label: "Reports & Audit", href: "/competency-office/credentialing/reports" },
];

export default function CredentialTabs() {
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
