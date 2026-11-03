"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { HISTORY_TYPE_LABEL, filterHistory, type HistoryItem, type HistoryType } from "../unified";

// UNIFIED-GOVERNANCE-V1 section 7 -- Governance History. Reverse-chronological; a card per entry at phone width, a table from md up.

const TYPE_TONE: Record<HistoryType, string> = {
  checklist: "border-teal-300 bg-teal-50 text-teal-900", clinical: "border-violet-300 bg-violet-50 text-violet-900",
  framework: "border-blue-300 bg-blue-50 text-blue-900", organisation: "border-amber-300 bg-amber-50 text-amber-950",
};
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const link = "font-semibold text-teal-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700";

function When({ iso }: { iso: string }) {
  // the viewer's own time zone, so the server render may differ from the first client render
  return <time dateTime={iso} suppressHydrationWarning>{when(iso)}</time>;
}
function Type({ t }: { t: HistoryType }) {
  return <span className={`inline-flex rounded-md border px-2 py-0.5 text-[12px] font-semibold ${TYPE_TONE[t]}`}>{HISTORY_TYPE_LABEL[t]}</span>;
}
function Item({ i }: { i: HistoryItem }) {
  if (!i.item) return <>{"—"}</>;
  return i.href ? <Link href={i.href} className={link}>{i.item}</Link> : <>{i.item}</>;
}

export default function HistoryView({ items, notices, types }: { items: HistoryItem[]; notices: string[]; types: HistoryType[] }) {
  const [type, setType] = useState<HistoryType | "all">("all");
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterHistory(items, type, query), [items, type, query]);
  return (
    <div className="max-w-6xl space-y-4">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Governance</p>
        <h1 className="text-xl font-bold text-gray-900">Governance history</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">What happened, who did it and when, newest first. Up to the latest 200 entries across the records you may see.</p>
      </header>
      {notices.map((n) => (
        <p key={n} role="alert" className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">{n}</p>
      ))}
      {types.length === 0 ? (
        <p className="text-[13.5px] text-gray-700">No governance history is available to your role.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-[12px] font-semibold text-gray-700">
              Type
              <select value={type} onChange={(e) => setType(e.target.value as HistoryType | "all")}
                className="mt-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[14px] font-normal text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]">
                <option value="all">All types</option>
                {types.map((t) => <option key={t} value={t}>{HISTORY_TYPE_LABEL[t]}</option>)}
              </select>
            </label>
            <label className="flex min-w-[220px] flex-1 flex-col text-[12px] font-semibold text-gray-700 sm:max-w-sm">
              Search person, item or what happened
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type to search"
                className="mt-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[14px] font-normal text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]" />
            </label>
            <p className="pb-2 text-[12.5px] text-gray-600" aria-live="polite">{shown.length === items.length ? `${items.length} entr${items.length === 1 ? "y" : "ies"}` : `Showing ${shown.length} of ${items.length}`}</p>
          </div>
          {items.length === 0 ? (
            <p className="text-[13.5px] text-gray-700">{notices.length ? "Nothing could be shown from the sources above." : "Nothing has been recorded yet."}</p>
          ) : shown.length === 0 ? (
            <p className="text-[13.5px] text-gray-700">No entries match these filters.</p>
          ) : (
            <>
              <ul className="space-y-2 md:hidden">
                {shown.map((i) => (
                  <li key={i.id} className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[12.5px] text-gray-600"><When iso={i.at} /></p><Type t={i.type} /></div>
                    <p className="mt-1 text-[14px] font-semibold text-gray-900">{i.what}</p>
                    <p className="text-[13px] text-gray-700">{i.who} {"·"} <Item i={i} /></p>
                    {i.detail && <p className="mt-1 break-words text-[12.5px] text-gray-600">{i.detail}</p>}
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto rounded-2xl border border-gray-200 bg-white p-4 md:block">
                <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
                  <caption className="sr-only">Governance history, newest first</caption>
                  <thead>
                    <tr className="border-b border-gray-200 text-[11.5px] font-bold uppercase tracking-wide text-gray-600">
                      <th scope="col" className="py-2 pr-3">When</th><th scope="col" className="py-2 pr-3">Who</th><th scope="col" className="py-2 pr-3">What happened</th>
                      <th scope="col" className="py-2 pr-3">Item</th><th scope="col" className="py-2">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((i) => (
                      <tr key={i.id} className="border-b border-gray-100 align-top">
                        <td className="whitespace-nowrap py-2.5 pr-3 text-gray-700"><When iso={i.at} /></td>
                        <td className="py-2.5 pr-3 text-gray-900">{i.who}</td>
                        <td className="py-2.5 pr-3 text-gray-900">{i.what}{i.detail && <p className="mt-0.5 break-words text-[12px] text-gray-600">{i.detail}</p>}</td>
                        <td className="py-2.5 pr-3 text-gray-700"><Item i={i} /></td>
                        <td className="py-2.5"><Type t={i.type} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
