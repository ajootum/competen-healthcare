"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// PW-014 §5 / PW-AC-05 — active-context indicator for the universal landing. Since every role now lands in the
// Personal Workspace (PW-AC-01), this slim strip names the active role and offers a one-click jump to the user's
// primary functional workspace, so a manager/assessor/admin isn't stranded on the aggregated personal view.
// Shown only on the landing home (/dashboard); the sidebar role switcher + launcher handle the rest.
export default function ActiveContextBanner({ roleLabel, primary }: { roleLabel: string; primary: { label: string; href: string } | null }) {
  const pathname = usePathname();
  if (pathname !== "/dashboard" || !primary) return null; // pure personal-only users (e.g. a clinician) need no jump
  return (
    <div className="hidden md:flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 md:px-6 py-2 bg-blue-50/70 border-b border-blue-100 text-[12px]">
      <span className="text-blue-900 font-medium">🧭 You&apos;re in your Personal Workspace</span>
      <span className="text-blue-700/70">Your work across every entitled workspace is aggregated here · active role: <span className="font-medium capitalize">{roleLabel}</span></span>
      <span className="flex-1" />
      <Link href={primary.href} className="font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md px-2.5 py-1">Open {primary.label} →</Link>
      <Link href="/dashboard/launcher" className="font-medium text-blue-700 hover:underline">All workspaces</Link>
    </div>
  );
}
