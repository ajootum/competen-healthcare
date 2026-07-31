// Shared presentation kit for the Competency Governance & Regulation section (CGR-001..029).
//
// Extracted, not redesigned. `Kpi` below is the implementation that was written out VERBATIM in 22 of this
// section's pages — scripts/pui-find-duplicate-components.ts found them by hashing real function bodies, so
// every one of those pages renders exactly what it rendered before.
//
// It is NOT the platform library's KpiRibbon. That component has its own markup, an overflow rule and a
// seven-tile cap; swapping this for it would change how 22 pages look, which is a redesign decision and not
// something a de-duplication pass should make on its own. This kit is the honest halfway house: one
// implementation instead of 22 copies, and a single place to change when that decision is taken.

export function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3.5">
      <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide leading-tight">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}
