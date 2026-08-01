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

// Lifted verbatim from src/app/unit-manager/competency-validations/page.tsx — written out identically in several
// pages, so this is one implementation replacing N copies, not a redesign.
export function DonutRing({ segs, total }: { segs: { n: number; color: string }[]; total: number }) {
  const sum = segs.reduce((s, x) => s + x.n, 0) || 1; let acc = 0;
  const stops = segs.map(s => { const a = (acc / sum) * 100; acc += s.n; return `${s.color} ${a}% ${(acc / sum) * 100}%`; }).join(", ");
  return <div className="relative w-24 h-24 shrink-0"><div className="w-24 h-24 rounded-full" style={{ background: sum > 0 ? `conic-gradient(${stops})` : "#f1f5f9" }} /><div className="absolute inset-[22%] rounded-full bg-white flex flex-col items-center justify-center"><span className="text-lg font-bold text-gray-900">{total}</span><span className="text-[8px] text-gray-400">Total</span></div></div>;
}

// Lifted verbatim from src/app/unit-manager/administration/_ui.tsx — written out identically in several
// pages, so this is one implementation replacing N copies, not a redesign.
export function DonutMid({ segs, total, centre, sub, size = 120 }: { segs: { n: number; color: string }[]; total: number; centre: any; sub?: string; size?: number }) {
  const R = size * 0.38, C = 2 * Math.PI * R, t = total || 1, mid = size / 2;
  const arr = segs.map((s, i) => ({ ...s, len: (s.n / t) * C, off: segs.slice(0, i).reduce((a, x) => a + (x.n / t) * C, 0) }));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={mid} cy={mid} r={R} fill="none" stroke="#f1f5f9" strokeWidth="12" />
      {arr.map((s, i) => <circle key={i} cx={mid} cy={mid} r={R} fill="none" stroke={s.color} strokeWidth="12" strokeDasharray={`${s.len} ${C - s.len}`} strokeDashoffset={-s.off} transform={`rotate(-90 ${mid} ${mid})`} />)}
      <text x={mid} y={mid - 1} textAnchor="middle" className="fill-gray-900 font-bold" fontSize={size * 0.2}>{centre}</text>
      {sub && <text x={mid} y={mid + 15} textAnchor="middle" className="fill-gray-400" fontSize="9">{sub}</text>}
    </svg>
  );
}
