"use client";

import Link from "next/link";
import { useState } from "react";
import { SCHOLAR } from "@/lib/individual/experiences";

// The Library's materials, searchable by title (Scholar HFE redesign). The server page decides every row and
// every word on it; this only filters what is already shown, in the browser, and sends nothing anywhere.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

export type LibraryRow = {
  id: string; title: string; href: string;
  /** The format, as the book tile shows it: PDF, DOCX, PPTX, TXT. */
  tile: string;
  meta: string;
  /** e.g. "Partly read: 2 pages without readable text". */
  warning: string | null;
  /** e.g. "Examination paper": what the student is studying it as. */
  badge?: string | null;
};
export type LibraryGroup = { key: string; name: string; rows: LibraryRow[] };

export function LibraryRows({ rows }: { rows: LibraryRow[] }) {
  return (
    <ul>
      {rows.map(r => (
        <li key={r.id} className="border-b border-gray-200 py-[18px] first:pt-0 last:border-b-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-4">
            <span aria-hidden className="grid h-[54px] w-11 shrink-0 place-items-center rounded-[5px] bg-[#e5f1f3] text-[11px] font-extrabold" style={{ color: SCHOLAR.accent }}>{r.tile}</span>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[16px] font-bold text-gray-900">{r.title}</h3>
              <p className="text-[12px] text-gray-600">{r.meta}</p>
              {r.badge && <span className="mr-1.5 mt-1 inline-block rounded-full bg-[#e9f7f8] px-2.5 py-1 text-[11px] font-semibold text-[#086b7b]">{r.badge}</span>}
              {r.warning && <span className="mt-1 inline-block rounded-full bg-[#fff3d9] px-2.5 py-1 text-[11px] font-semibold text-[#805a19]">{r.warning}</span>}
            </div>
            <Link href={r.href} className={`inline-flex min-h-[44px] items-center text-[15px] font-semibold underline-offset-2 hover:underline ${focusRing}`} style={{ color: SCHOLAR.accent }}>
              Open<span className="sr-only"> {r.title}</span> →
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The search box and the materials card. `actions`: the server-rendered buttons beside the search. */
export function LibraryBrowser({ groups, actions, empty }: { groups: LibraryGroup[]; actions: React.ReactNode; empty: React.ReactNode }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = groups.map(g => ({ ...g, rows: needle ? g.rows.filter(r => r.title.toLowerCase().includes(needle)) : g.rows })).filter(g => g.rows.length);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <input type="search" aria-label="Search materials" placeholder="Search your library…" value={q} onChange={e => setQ(e.target.value)} disabled={!total}
          className={`min-h-[44px] w-full max-w-sm rounded-lg border border-gray-300 bg-white px-2.5 py-2.5 text-[15px] text-gray-900 disabled:opacity-60 sm:w-auto ${focusRing}`} />
        <div className="flex flex-wrap gap-2.5">{actions}</div>
      </div>
      {total === 0 ? empty : (
        <section aria-label="Your materials" className="mb-5 rounded-2xl border border-gray-200 bg-white p-6">
          {shown.length === 0 ? <p className="text-[15px] text-gray-600">No materials match your search.</p> : (
            <div className="space-y-6">
              {shown.map(g => (
                <div key={g.key}>
                  {g.name && <h2 className="mb-3 text-[12px] font-extrabold uppercase tracking-[0.14em] text-gray-500">{g.name}</h2>}
                  <LibraryRows rows={g.rows} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
