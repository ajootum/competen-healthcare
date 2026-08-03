"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// The reporting window, in the query string so a report can be bookmarked and handed to somebody.
// Server-rendered from it, for the same reasons the search page is: the numbers are a read of the whole
// practice and belong on the server, once, logged.

const input = "rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

export default function PeriodPicker({ fromDay, toDay }: { fromDay: string; toDay: string }) {
  const router = useRouter();
  const [from, setFrom] = useState(fromDay);
  const [to, setTo] = useState(toDay);

  const go = (params: string) => router.push(`/practice/reports?${params}`);

  return (
    <div className="mt-3 flex items-end gap-2 flex-wrap rounded-lg bg-gray-50 p-2">
      <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
        From
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={input} />
      </label>
      <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
        To
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={input} />
      </label>
      <button type="button" onClick={() => go(`from=${from}&to=${to}`)}
        className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
        Show
      </button>
      <span className="ml-auto flex gap-1.5">
        {[["7 days", 7], ["30 days", 30], ["90 days", 90], ["A year", 365]].map(([label, n]) => (
          <button key={label as string} type="button" onClick={() => go(`days=${n}`)}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
            {label as string}
          </button>
        ))}
      </span>
    </div>
  );
}
