"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { RANGE_PRESETS, RANGE_MEMORY_KEY } from "@/lib/practice/intelligence-constants";

// CPR-PI-001 s7.1's global date-range selector: 7 / 30 / 90 / a year / custom.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE RANGE LIVES IN THE QUERY STRING, AND THE TAB TRAVELS WITH IT.
//
// Two reasons, and the second is the one that matters. A window in the URL is bookmarkable and can be
// handed to a colleague -- "look at this month" is a link rather than an instruction. And every figure
// on the page is computed on the SERVER from that window, once, logged once, so a client-held range
// would mean either a second computation or a payload the log does not describe.
//
// ⚠ THE TAB IS PRESERVED ON EVERY CHANGE. Losing the tab when the range changes is the bug that makes a
// tabbed workspace feel broken, and it is invisible in review because the default tab looks fine.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// s6: "The suite shall remember the practitioner's last selected date range." Remembered in this
// browser, per practitioner's device, and applied ONLY when the URL says nothing -- a link somebody was
// sent must show what it says, not what this browser last looked at.

const input = "rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

export default function RangePicker({ fromDay, toDay, days }: {
  fromDay: string; toDay: string; days: number | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [from, setFrom] = useState(fromDay);
  const [to, setTo] = useState(toDay);

  const tab = params.get("tab");
  const cohortBy = params.get("cohortBy");

  const go = (extra: Record<string, string>) => {
    const next = new URLSearchParams();
    if (tab) next.set("tab", tab);
    if (cohortBy) next.set("cohortBy", cohortBy);
    for (const [k, v] of Object.entries(extra)) next.set(k, v);
    try { window.localStorage.setItem(RANGE_MEMORY_KEY, JSON.stringify(extra)); } catch { /* private mode */ }
    router.push(`/practice/intelligence?${next.toString()}`);
  };

  // ⚠ ONLY WHEN THE URL IS SILENT. A remembered range that overrode an explicit one would rewrite a
  // link the moment it was opened, and the recipient would see different numbers from the sender.
  useEffect(() => {
    if (params.get("days") || params.get("from") || params.get("to")) return;
    let stored: Record<string, string> | null = null;
    try { stored = JSON.parse(window.localStorage.getItem(RANGE_MEMORY_KEY) ?? "null"); } catch { stored = null; }
    if (!stored || Object.keys(stored).length === 0) return;
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(stored)) next.set(k, v);
    router.replace(`/practice/intelligence?${next.toString()}`);
    // Once, on mount. The dependency list is deliberately empty: re-running this on every params change
    // would fight the user's own clicks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {RANGE_PRESETS.map(p => (
        <button key={p.days} type="button" onClick={() => go({ days: String(p.days) })}
          aria-pressed={days === p.days}
          className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
            days === p.days
              ? "border-[var(--cp-primary)] bg-[var(--cp-primary)] text-white"
              : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
          }`}>
          {p.label}
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-gray-200" aria-hidden />
      <label className="flex items-center gap-1 text-[10px] text-gray-500">
        <span className="sr-only sm:not-sr-only">From</span>
        <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className={input} />
      </label>
      <label className="flex items-center gap-1 text-[10px] text-gray-500">
        <span className="sr-only sm:not-sr-only">To</span>
        <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className={input} />
      </label>
      <button type="button" onClick={() => go({ from, to })}
        aria-pressed={days === null}
        className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
          days === null
            ? "border-[var(--cp-primary)] bg-[var(--cp-primary)] text-white"
            : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
        }`}>
        Custom
      </button>
    </div>
  );
}
