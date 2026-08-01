// Shared presentation kit for Workforce Management (UMW-WFM-001..009).
//
// Extracted, not redesigned. `Kpi` is the implementation that was written out VERBATIM in 23 of this
// section's pages, reproduced here character for character so every one of them renders what it rendered
// before — scripts/pui-codemod-extract-dupe.ts refuses to migrate a page whose body does not hash-match
// this one, so that equality is enforced rather than hoped for.
//
// NOTE THE CARD STRING. It is "bg-white rounded-xl border border-gray-200" with NO padding — deliberately
// NOT the platform `cardClass`, which ends in p-5. Kpi appends p-4, and using cardClass here would emit
// "p-5 p-4" on 23 pages, where which one wins depends on stylesheet order rather than intent. Stage 1 of
// the migration left these alone for exactly that reason: the strings are not the same string.
//
// This constant is itself repeated in 67 files across the section. Consolidating that is a separate pass;
// it is exported here so those files have somewhere to import it from when it happens.

// The disable is FILE-LEVEL on purpose: an inline one would sit inside the function signature and change
// the body text, and the codemod's guard compares that text character for character.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const card = "bg-white rounded-xl border border-gray-200";

export function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

// The SAME tile with a sub-label, written out verbatim in 14 more pages. Kept as a second export rather than
// folded into `Kpi` with an optional `sub`: that would be a rewrite of both bodies, and the codemod's guard
// can only vouch for a swap it can hash-match. Consumers import it aliased back to their local name, so no
// call site changes. Merging the two into one component is a deliberate edit for another day.
export function KpiWithSub({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

// And a third: the same tile again with a corner annotation. Three near-identical variants in one section
// is the accretion this pass is unwinding, but they are kept SEPARATE for now for the same reason as above
// — collapsing them into one component with optional props is a rewrite the hash guard cannot vouch for.
// All three now live in one file, which is what makes that collapse a small, reviewable edit later.
export function KpiWithFoot({ label, value, sub, tone, foot }: { label: string; value: any; sub?: string; tone?: string; foot?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{foot && <span className="text-[9px] text-gray-300">{foot}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}
