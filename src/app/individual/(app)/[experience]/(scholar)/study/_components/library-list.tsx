"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageSearchInput } from "@/app/individual/_components/search/PageSearch";
import { matchesSearch } from "@/lib/individual/search/match";
import { scopeLine } from "@/lib/individual/search/registry";
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
        <li key={r.id} className="border-b border-[var(--learn-border)] py-[18px] first:pt-0 last:border-b-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-4">
            <span aria-hidden className="grid h-[54px] w-11 shrink-0 place-items-center rounded-[5px] bg-[var(--cmp-theme-soft)] text-[11px] font-extrabold" style={{ color: SCHOLAR.accent }}>{r.tile}</span>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[16px] font-bold text-gray-900">{r.title}</h3>
              <p className="text-[12px] text-gray-600">{r.meta}</p>
              {r.badge && <span className="mr-1.5 mt-1 inline-block rounded-full bg-[var(--cmp-theme-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--cmp-theme-ink)]">{r.badge}</span>}
              {r.warning && <span className="mt-1 inline-block rounded-full bg-[var(--cmp-role-revision-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--cmp-role-revision-ink)]">{r.warning}</span>}
            </div>
            <Link prefetch={false} href={r.href} className={`inline-flex min-h-[44px] items-center text-[15px] font-semibold underline-offset-2 hover:underline ${focusRing}`} style={{ color: SCHOLAR.accent }}>
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
  const [type, setType] = useState("");
  const [byTitle, setByTitle] = useState(false);
  // The words live in the address too, so opening a material and coming back keeps them, and Global Search can land here.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is known only in the browser, and the server's first paint must match
  useEffect(() => { const asked = new URLSearchParams(window.location.search).get("q"); if (asked) setQ(asked); }, []);
  function search(v: string) {
    setQ(v);
    const u = new URL(window.location.href);
    if (v.trim()) u.searchParams.set("q", v); else u.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", u);
  }
  const shown = groups.map(g => {
    const rows = g.rows.filter(r => matchesSearch(r.title, q) && (!type || r.tile === type));
    return { ...g, rows: byTitle ? [...rows].sort((a, b) => a.title.localeCompare(b.title)) : rows };
  }).filter(g => g.rows.length);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const matched = shown.reduce((n, g) => n + g.rows.length, 0);
  const types = [...new Set(groups.flatMap(g => g.rows.map(r => r.tile)))].sort();
  const narrowed = !!q.trim() || !!type;
  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex w-full min-w-0 flex-wrap items-start gap-2 md:w-auto md:flex-1">
          <div className="min-w-[14rem] flex-1 md:max-w-md">
            <PageSearchInput scope={scopeLine("library")} value={q} onChange={search} placeholder="Search your library…" disabled={!total}
              resultNote={narrowed ? `${matched} of ${total} shown` : null} />
          </div>
          {total > 1 && (
            <>
              <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-700">Type
                <select value={type} onChange={e => setType(e.target.value)} className={`min-h-[44px] rounded-lg border border-gray-300 bg-white px-2 text-[14px] font-normal text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
                  <option value="">All</option>{types.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-700">Sort
                <select value={byTitle ? "title" : "added"} onChange={e => setByTitle(e.target.value === "title")} className={`min-h-[44px] rounded-lg border border-gray-300 bg-white px-2 text-[14px] font-normal text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
                  <option value="added">Newest first</option><option value="title">Title</option>
                </select>
              </label>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2.5">{actions}</div>
      </div>
      {total === 0 ? empty : (
        <section aria-label="Your materials" className="mb-5 cmp-learn-notes cmp-learn-box p-4 sm:p-6">
          {shown.length === 0 ? (
            <p className="text-[15px] text-gray-600">No materials match your search. Try fewer or different words{type ? ", or show all file types" : ""}.</p>
          ) : (
            <div className="space-y-6">
              {shown.map(g => (
                <div key={g.key}>
                  {g.name && <h2 className="cmp-learn-ink mb-3 text-[12px] font-extrabold uppercase tracking-[0.14em]">{g.name}</h2>}
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
