// Shared presentation kit for Platform Operations.
//
// Extracted, not redesigned. `Stat` is the implementation that was written out VERBATIM in 17 of this
// section's pages, reproduced character for character — scripts/pui-codemod-extract-dupe.ts refuses to
// migrate a page whose body does not hash-match this one, so the equality is enforced rather than assumed.
//
// The card string is "bg-white rounded-xl border border-gray-200" with NO padding (Stat appends p-4), which
// is why it is NOT the platform `cardClass` — that one ends in p-5 and would emit "p-5 p-4". It is repeated
// in 54 files across this section; exported here so they have somewhere to import it from when that pass
// happens.
//
// The disable is FILE-LEVEL because an inline one would sit inside the function signature and change the
// body text the codemod compares.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const card = "bg-white rounded-xl border border-gray-200";

export function Stat({ label, value, tone, sub }: { label: string; value: any; tone?: string; sub?: string }) {
  return <div className={`${card} p-4`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>}</div>;
}

// Lifted verbatim from src/app/super-admin/platform-ops/catalogue/page.tsx — written out identically in several
// pages, so this is one implementation replacing N copies, not a redesign.
export function StatWide({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-3.5`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

// Lifted verbatim from src/app/super-admin/platform-ops/collaboration/page.tsx — written out identically in several
// pages, so this is one implementation replacing N copies, not a redesign.
export function KpiTile({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon?: string }) {
  return <div className={`${card} p-3.5`}><div className="flex items-start justify-between"><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>{icon && <span className="text-sm opacity-50">{icon}</span>}</div><p className="text-2xl font-bold tabular-nums mt-0.5 text-gray-900">{value}</p>{sub && <p className="text-[10px] text-gray-500">{sub}</p>}</div>;
}
