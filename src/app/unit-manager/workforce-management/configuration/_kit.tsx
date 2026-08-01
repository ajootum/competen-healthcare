// Shared presentation kit — extracted, not redesigned.
/* eslint-disable @typescript-eslint/no-explicit-any */

// Lifted verbatim from src/app/unit-manager/workforce-management/configuration/availability/page.tsx — written out identically in several
// pages, so this is one implementation replacing N copies, not a redesign.
export function Param({ label, value, unit }: { label: string; value: any; unit?: string }) {
  return <div className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"><span className="text-xs text-gray-600">{label}</span><span className="text-sm font-semibold text-gray-800 tabular-nums">{value}{unit ? <span className="text-[10px] text-gray-400 ml-0.5">{unit}</span> : null}</span></div>;
}
