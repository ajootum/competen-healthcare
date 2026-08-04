"use client";

import { useState } from "react";
import Link from "next/link";

// CPR-350's quick searches, filters, count strip, saved searches and history.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// NO COUNT IS SHOWN BESIDE A SAVED SEARCH.
//
// The comp prints "High risk follow-ups 12". That 12 would have been computed for whoever saved the
// search, and every later reader would see a count of records they may have no right to open -- and on a
// SHARED search it would be a side channel telling a delegate how many referrals are pending. So a saved
// search is a name and a query; the count appears when YOU run it, computed against YOUR permissions.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// QUICK SEARCHES ARE LINKS TO SURFACES, not text queries. "Follow-ups overdue" is not a phrase to match
// against a record -- it is a question the follow-up board answers exactly, with the overdue derivation
// and the ordering it already has.

const input = "rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function SearchSidebar({
  quick, saved, history, query, fromDay, toDay, counts, dateFiltered,
}: {
  quick: any[]; saved: any[]; history: any[];
  query: string; fromDay: string | null; toDay: string | null;
  counts: any[]; dateFiltered: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);

  async function save() {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/saved-searches", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, query, shared, filters: { fromDay, toDay } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setNotice(data?.error?.message ?? "That did not work."); setBusy(false); return; }
    window.location.reload();
  }

  async function remove(id: string) {
    setBusy(true);
    await fetch(`/api/v1/practice/saved-searches?id=${id}`, { method: "DELETE" });
    window.location.reload();
  }

  async function clearHistory() {
    setBusy(true);
    await fetch("/api/v1/practice/saved-searches?history=1", { method: "DELETE" });
    window.location.reload();
  }

  const href = (q: string, f?: string | null, t?: string | null) => {
    const p = new URLSearchParams({ q });
    if (f) p.set("from", f);
    if (t) p.set("to", t);
    return `/practice/search?${p}`;
  };

  return (
    <>
      {notice && (
        <p className="mt-3 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">
          {notice}
        </p>
      )}

      {/* Quick searches — links, not queries */}
      {quick.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {quick.map(q => (
            <Link key={q.key} href={q.href}
              className="rounded-full border border-gray-200 px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">
              {q.label}
            </Link>
          ))}
        </div>
      )}

      {/* Advanced filters. A date range only -- the module filter is the count strip below, which is
          both the filter and the answer to "how much is there". */}
      <form className="mt-3 flex flex-wrap items-end gap-2" action="/practice/search">
        <input type="hidden" name="q" value={query} />
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold text-gray-500">From</span>
          <input type="date" name="from" defaultValue={fromDay ?? ""} className={input} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold text-gray-500">To</span>
          <input type="date" name="to" defaultValue={toDay ?? ""} className={input} />
        </label>
        <button type="submit" disabled={!query}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">
          Apply dates
        </button>
        {dateFiltered && (
          <Link href={href(query)} className="text-[11px] text-gray-500 hover:underline">Clear dates</Link>
        )}
        {query && !naming && (
          <button type="button" onClick={() => { setNaming(true); setName(query); }}
            className="ml-auto text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
            Save this search
          </button>
        )}
      </form>

      {naming && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Call it what?" className={`${input} w-56`} />
          <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
            <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} />
            Share with the practice
          </label>
          <button type="button" disabled={busy || !name.trim()} onClick={save}
            className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
            Save
          </button>
          <button type="button" onClick={() => setNaming(false)} className="text-[11px] text-gray-500 hover:underline">Cancel</button>
          <p className="w-full text-[10px] text-gray-500">
            {/* Said where somebody is deciding whether to share. */}
            Sharing is safe: a saved search stores the question, never the answers. A colleague who opens
            it sees only what they are allowed to see.
          </p>
        </div>
      )}

      {/* The per-module count strip, computed for this reader */}
      {counts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {counts.map(c => (
            <span key={c.domain} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[11px]">
              <span className="font-semibold text-gray-700">{c.title}</span>{" "}
              <span className="font-bold text-gray-900">{c.total}</span>
              {c.truncated && <span className="text-gray-400"> of more</span>}
            </span>
          ))}
        </div>
      )}

      {(saved.length > 0 || history.length > 0) && (
        <div className="mt-4 grid sm:grid-cols-2 gap-4">
          {saved.length > 0 && (
            <section className="rounded-xl border border-gray-200 bg-white p-3">
              <h2 className="text-[12px] font-bold text-gray-900">Saved searches</h2>
              <ul className="mt-1.5 flex flex-col">
                {saved.map(s => (
                  <li key={s.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
                    <Link href={href(s.query, s.filters?.fromDay, s.filters?.toDay)}
                      className="min-w-0 truncate text-[12px] text-gray-800 hover:underline">
                      {s.favourite && <span aria-label="favourite" className="text-amber-500">★ </span>}
                      {s.name}
                    </Link>
                    <span className="ml-auto shrink-0 text-[10px] text-gray-400">
                      {s.mine ? (s.shared ? "shared" : "yours") : "from the practice"}
                    </span>
                    {s.mine && (
                      <button type="button" disabled={busy} onClick={() => remove(s.id)}
                        aria-label={`Delete ${s.name}`}
                        className="shrink-0 text-[11px] text-gray-400 hover:text-[var(--cmp-text-critical)]">
                        &times;
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[10px] text-gray-500">
                No counts here on purpose: a saved search stores the question, not the answers. Open one
                to see what you can see.
              </p>
            </section>
          )}

          {history.length > 0 && (
            <section className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[12px] font-bold text-gray-900">Your recent searches</h2>
                <button type="button" disabled={busy} onClick={clearHistory}
                  className="text-[11px] text-gray-500 hover:underline">Clear</button>
              </div>
              <ul className="mt-1.5 flex flex-col">
                {history.map(h => (
                  <li key={h.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
                    <Link href={href(h.query, h.filters?.fromDay, h.filters?.toDay)}
                      className="min-w-0 truncate text-[12px] text-gray-800 hover:underline">
                      {h.query}
                    </Link>
                    {/* What they saw THEN, labelled as such -- it is not re-run and is not a count now. */}
                    <span className="ml-auto shrink-0 text-[10px] text-gray-400">
                      {h.foundThen === 0 ? "found nothing then" : `${h.foundThen} then`}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[10px] text-gray-500">
                Yours alone. Nobody else in this practice can see what you searched for.
              </p>
            </section>
          )}
        </div>
      )}
    </>
  );
}
