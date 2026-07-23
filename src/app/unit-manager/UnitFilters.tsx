"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

// Universal filters (UMW-001 §Implementation / UMW-003 §Global filters) — Department
// scopes the operational data; Period windows the historical trend. State lives in
// the URL (?dept=&period=) so the server components re-read and re-scope.
const PERIODS: [string, string][] = [["shift", "Current Shift"], ["today", "Today"], ["7d", "7 Days"], ["30d", "30 Days"], ["90d", "90 Days"]];

export default function UnitFilters({ departments, showPeriod = false }: { departments: { id: string; name: string }[]; showPeriod?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const dept = sp.get("dept") ?? "";
  const period = sp.get("period") ?? "7d";

  function set(key: string, val: string) {
    const p = new URLSearchParams(sp.toString());
    if (val) p.set(key, val); else p.delete(key);
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const sel = "text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:border-teal-400";
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select value={dept} onChange={e => set("dept", e.target.value)} className={sel} aria-label="Department">
        <option value="">All units</option>
        {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      {showPeriod && (
        <select value={period} onChange={e => set("period", e.target.value)} className={sel} aria-label="Period">
          {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      )}
    </div>
  );
}
