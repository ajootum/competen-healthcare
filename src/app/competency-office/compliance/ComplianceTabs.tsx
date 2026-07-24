"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Compliance Centre sub-module tabs (CMO-002 §3). The Compliance Dashboard is the real landing
// surface; each domain sub-module has an honest page that surfaces its live status and routes to its
// authoritative surface (or notes its next-phase store). Global context is preserved across tabs.
const TABS: { label: string; href: string }[] = [
  { label: "Compliance Dashboard", href: "/competency-office/compliance" },
  { label: "Mandatory Competencies", href: "/competency-office/compliance/mandatory" },
  { label: "Professional Credentials", href: "/competency-office/compliance/credentials" },
  { label: "Learning Compliance", href: "/competency-office/compliance/learning" },
  { label: "Assessment Compliance", href: "/competency-office/compliance/assessment" },
  { label: "Framework Compliance", href: "/competency-office/compliance/framework" },
  { label: "Regulatory Compliance", href: "/competency-office/compliance/regulatory" },
  { label: "Accreditation", href: "/competency-office/compliance/accreditation" },
  { label: "Exceptions", href: "/competency-office/compliance/exceptions" },
  { label: "Remediation Plans", href: "/competency-office/compliance/remediation" },
  { label: "AI Intelligence", href: "/competency-office/compliance/ai" },
  { label: "Reports", href: "/competency-office/compliance/reports" },
];

export default function ComplianceTabs() {
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
