import Link from "next/link";
// Shared presentation kit — extracted, not redesigned.
/* eslint-disable @typescript-eslint/no-explicit-any */

// The UNPADDED card these tiles compose with. Deliberately not the platform cardClass, which ends
// in p-5 — every tile here adds its own padding, and importing cardClass would emit two.
const card = "bg-white rounded-xl border border-gray-200";

// Lifted verbatim from src/app/competency-office/assessments/page.tsx — written out identically in several
// pages, so this is one implementation replacing N copies, not a redesign.
export function KpiTile({ icon, tint, label, value, sub, tone, href }: { icon: string; tint: string; label: string; value: any; sub?: string; tone?: string; href: string }) {
  return (
    <Link href={href} className={`${card} p-4 hover:border-teal-300 transition-colors block`}>
      <div className="flex items-center gap-2.5 mb-2"><span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${tint}`}>{icon}</span><span className="text-xs font-medium text-gray-500 leading-tight">{label}</span></div>
      <div className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </Link>
  );
}
