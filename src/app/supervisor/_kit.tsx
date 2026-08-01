// Shared presentation kit — extracted, not redesigned.
/* eslint-disable @typescript-eslint/no-explicit-any */

// The UNPADDED card these tiles compose with. Deliberately not the platform cardClass, which ends
// in p-5 — every tile here adds its own padding, and importing cardClass would emit two.
const card = "bg-white rounded-xl border border-gray-200";

// Lifted verbatim from src/app/supervisor/handover/ai/page.tsx — written out identically in several
// pages, so this is one implementation replacing N copies, not a redesign.
export function KpiTile({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-3.5`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}

// Lifted verbatim from src/app/supervisor/attendance/page.tsx — written out identically in several
// pages, so this is one implementation replacing N copies, not a redesign.
export function KpiTileBare({ label: l, value, tone, sub }: { label: string; value: React.ReactNode; tone?: string; sub?: React.ReactNode }) {
  return (
    <div className={card}>
      <p className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{l}</p>
      {sub != null && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// Lifted verbatim from src/app/supervisor/handover/incoming/page.tsx — written out identically in several
// pages, so this is one implementation replacing N copies, not a redesign.
export function KpiTileDense({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-3`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className={`text-xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}
