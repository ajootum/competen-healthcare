"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { STATUS_FILTERS, STATUS_WORD, filterControlled, summaryLine, type ControlledRow, type StatusFilter, type StatusKey } from "../unified";

// UNIFIED-GOVERNANCE-V1 section 5 -- Controlled Content. Rows are cards at phone width and a table from md up. The status is
// always a word (a coloured dot is decoration), and every row has one next action and one link.

export type Section = { id: string; title: string; rows: ControlledRow[]; error: string | null };

const TONE: Record<StatusKey, string> = {
  none: "border-gray-300 bg-gray-50 text-gray-800",
  draft: "border-gray-300 bg-gray-50 text-gray-800",
  in_review: "border-blue-300 bg-blue-50 text-blue-900",
  approved: "border-violet-300 bg-violet-50 text-violet-900",
  published: "border-teal-400 bg-teal-50 text-teal-900",
  retired: "border-gray-300 bg-white text-gray-600",
};
const DOT: Record<StatusKey, string> = { none: "bg-gray-400", draft: "bg-gray-500", in_review: "bg-blue-600", approved: "bg-violet-600", published: "bg-teal-700", retired: "bg-gray-300" };
const btn = "inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]";

function Chip({ status }: { status: StatusKey }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px] font-semibold ${TONE[status]}`}>
      <span aria-hidden className={`h-2 w-2 rounded-full ${DOT[status]}`} />{STATUS_WORD[status]}
    </span>
  );
}

const authorsOf = (r: ControlledRow) => (r.authors.length ? r.authors.join(", ") : "—");

function SectionTable({ section, filter, query }: { section: Section; filter: StatusFilter; query: string }) {
  const shown = useMemo(() => filterControlled(section.rows, filter, query), [section.rows, filter, query]);
  const headingId = `cc-${section.id}`;
  return (
    <section aria-labelledby={headingId} className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={headingId} className="text-[16px] font-bold text-gray-900">{section.title}</h2>
        <p className="text-[12.5px] text-gray-600" aria-live="polite">{section.error ? "" : summaryLine(section.rows)}{!section.error && shown.length !== section.rows.length ? ` · showing ${shown.length}` : ""}</p>
      </div>
      {section.error ? (
        <p role="alert" className="mt-3 rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">{section.error}</p>
      ) : section.rows.length === 0 ? (
        <p className="mt-3 text-[13.5px] text-gray-700">Nothing governed yet.</p>
      ) : shown.length === 0 ? (
        <p className="mt-3 text-[13.5px] text-gray-700">No items match these filters.</p>
      ) : (
        <>
          <ul className="mt-3 space-y-2 md:hidden">
            {shown.map((r) => (
              <li key={r.key} className="rounded-xl border border-gray-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-[14px] font-bold text-gray-900">{r.title}</p>
                    <p className="break-all font-mono text-[12px] text-gray-500">{r.code || "no code"}</p>
                  </div>
                  <Chip status={r.status} />
                </div>
                <p className="mt-1 text-[12.5px] text-gray-600">{r.type} {"·"} {r.scope} {"·"} version {r.version}</p>
                <p className="text-[12.5px] text-gray-600">Author: {authorsOf(r)}</p>
                <p className="mt-2 text-[13px] text-gray-900"><span className="font-semibold">Next:</span> {r.next}</p>
                <Link href={r.href} aria-label={`Open ${r.title}`} className={`${btn} mt-2 w-full`}>Open</Link>
              </li>
            ))}
          </ul>
          <div className="mt-3 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
              <caption className="sr-only">{section.title}</caption>
              <thead>
                <tr className="border-b border-gray-200 text-[11.5px] font-bold uppercase tracking-wide text-gray-600">
                  <th scope="col" className="py-2 pr-3">Item</th><th scope="col" className="py-2 pr-3">Type and scope</th><th scope="col" className="py-2 pr-3">Version</th>
                  <th scope="col" className="py-2 pr-3">Status</th><th scope="col" className="py-2 pr-3">Author</th><th scope="col" className="py-2 pr-3">Next required action</th><th scope="col" className="py-2"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key} className="border-b border-gray-100 align-top">
                    <td className="py-2.5 pr-3"><p className="font-semibold text-gray-900">{r.title}</p><p className="break-all font-mono text-[12px] text-gray-500">{r.code || "no code"}</p></td>
                    <td className="py-2.5 pr-3 text-gray-700">{r.type}<br /><span className="text-[12px] text-gray-500">{r.scope}</span></td>
                    <td className="py-2.5 pr-3 text-gray-700">{r.version}</td>
                    <td className="py-2.5 pr-3"><Chip status={r.status} /></td>
                    <td className="py-2.5 pr-3 text-gray-700">{authorsOf(r)}</td>
                    <td className="py-2.5 pr-3 font-medium text-gray-900">{r.next}</td>
                    <td className="py-2.5 text-right"><Link href={r.href} aria-label={`Open ${r.title}`} className={btn}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export default function ControlledContentView({ sections }: { sections: Section[] }) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  return (
    <div className="max-w-6xl space-y-4">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Governance</p>
        <h1 className="text-xl font-bold text-gray-900">Controlled content</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">Everything that is governed, with its one status and the one next action. Open an item to act on it.</p>
      </header>
      {sections.length === 0 ? (
        <p className="text-[13.5px] text-gray-700">No controlled content is available to your role.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((f) => (
                <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
                  className={`rounded-lg border px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)] ${filter === f.key ? "border-teal-700 bg-teal-700 text-white" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"}`}>
                  {f.label}
                </button>
              ))}
            </div>
            <label className="flex min-w-[220px] flex-1 flex-col text-[12px] font-semibold text-gray-700 sm:max-w-sm">
              Search title or code
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type to search"
                className="mt-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[14px] font-normal text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]" />
            </label>
          </div>
          {sections.map((s) => <SectionTable key={s.id} section={s} filter={filter} query={query} />)}
        </>
      )}
    </div>
  );
}
