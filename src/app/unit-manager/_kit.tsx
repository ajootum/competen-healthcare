/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
// Shared presentation kit — extracted, not redesigned.
 

// The UNPADDED card these tiles compose with. Deliberately not the platform cardClass, which ends
// in p-5 — every tile here adds its own padding, and importing cardClass would emit two.
const card = "bg-white rounded-xl border border-gray-200";

// Lifted verbatim from src/app/unit-manager/capa/page.tsx — written out identically in several
// pages, so this is one implementation replacing N copies, not a redesign.
export function Spark({ series, color }: { series: number[]; color: string }) {
  if (!series || series.length < 2 || series.every(v => v === series[0])) return <div className="h-5" />;
  const max = Math.max(...series), min = Math.min(...series), rng = max - min || 1;
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * 100},${18 - ((v - min) / rng) * 16}`).join(" ");
  return <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="w-full h-5"><polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}

// Lifted verbatim from src/app/unit-manager/learning/development/page.tsx — written out identically in several
// pages, so this is one implementation replacing N copies, not a redesign.
export function KpiTile({ icon, tint, label, value, sub, tone, href }: { icon: string; tint: string; label: string; value: any; sub?: string; tone?: string; href?: string }) {
  const inner = <div className={`${card} p-4 ${href ? "hover:border-[var(--cmp-color-success)] transition-colors" : ""}`}><div className="flex items-center gap-2.5 mb-2"><span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${tint}`}>{icon}</span><span className="text-xs font-medium text-gray-500 leading-tight">{label}</span></div><div className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</div>{sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}</div>;
  return href ? <Link href={href}>{inner}</Link> : inner;
}
