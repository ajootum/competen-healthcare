import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { recentlyTouched } from "@/lib/practice/search";
import { runSearch, listSavedSearches, recentSearches, quickSearches } from "@/lib/practice/saved-search";
import SearchBox from "./SearchBox";
import SearchSidebar from "./SearchSidebar";
import { practiceDayOf, workspaceClock } from "@/lib/practice/practice-time";

// /practice/search -- CPR-350.
//
// SERVER-RENDERED FROM THE QUERY STRING, not a client component holding results in state. Three reasons,
// and the first is the one that matters: a search result is clinical data, and a page that fetches it
// into browser memory and re-renders on every keystroke is one that leaks it into history, back/forward
// caches and any extension watching the DOM. Second, a search you can bookmark and share with a
// colleague is more useful than one you cannot. Third, the capability filter then runs in exactly one
// place -- the engine, server-side -- with no client copy to drift.
//
// MATCHES ARE NOT HIGHLIGHTED. Highlighting means the server telling the browser which characters
// matched, and doing it by string replacement over clinical prose is how markup ends up rendered inside
// a note. The excerpt shows the surrounding text and the reader finds the word; that is enough.

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: {
  searchParams: Promise<{ q?: string; from?: string; to?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "search.use")) redirect("/practice/home");

  const { q, from: fromDay, to: toDay } = await searchParams;
  const admin = createAdminClient();
  // The practice's own day for every date rendered below. These were UTC slices of timestamptz
  // columns, which name yesterday for the three hours a practice ahead of UTC is already on tomorrow.
  const { timezone } = await workspaceClock(admin, shell.ctx.workspaceId);
  const query = (q ?? "").trim();

  const from = (fromDay ?? "").trim() || null;
  const to = (toDay ?? "").trim() || null;

  // CPR-350 (migration 212). runSearch wraps searchPractice with the date filter, the per-domain count
  // strip and the caller's own history -- the gate itself is unchanged and still lives in the engine.
  const [result, recent, saved, history] = await Promise.all([
    runSearch(admin, shell.ctx, query, { fromDay: from, toDay: to }),
    query ? Promise.resolve(null) : recentlyTouched(admin, shell.ctx),
    listSavedSearches(admin, shell.ctx),
    recentSearches(admin, shell.ctx, 6),
  ]);
  const quick = quickSearches(shell.ctx);

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold text-gray-900">Search</h1>
      <p className="mt-0.5 text-[13px] text-gray-500">
        Everything in this practice you have access to: people, consultations, what was written in them,
        letters, commitments and work.
      </p>

      <SearchBox initial={query} />

      <SearchSidebar
        quick={quick}
        saved={saved}
        history={history}
        query={query}
        fromDay={from}
        toDay={to}
        counts={result.ran ? result.counts : []}
        dateFiltered={result.dateFiltered}
      />

      {result.notSearched.length > 0 && (
        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
          Not searched, because you do not hold the capability: {result.notSearched.join(", ")}. Anything
          there would not appear below &mdash; which is different from there being nothing.
        </p>
      )}

      {/* SEARCHED, BUT PART OF IT COULD NOT RUN. Deliberately louder than the note above it: that one
          says you lack a permission, which is a stable fact about you. This one says the answer on the
          screen may be missing somebody who IS in the register -- and the next thing a person does after
          a search that finds nobody is register them again. */}
      {result.incomplete.length > 0 && (
        <p className="mt-3 rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[11px] text-[var(--cmp-text-warning)]">
          Part of this search could not run: {result.incomplete.join(", ")}. Someone already registered
          may be missing from these results, so do not register a new record on the strength of them.
        </p>
      )}

      {result.ran && result.total === 0 && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-6">
          <p className="text-[13px] font-semibold text-gray-700">Nothing matched &ldquo;{result.query}&rdquo;.</p>
          <p className="mt-1 text-[12px] text-gray-500">
            Words are matched from their start, so a partial word finds the whole one. Notes written in a
            language other than English match exactly but not on variants &mdash; a limitation of the
            index, recorded rather than hidden.
          </p>
        </section>
      )}

      {result.groups.map(group => (
        <section key={group.domain} className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[13px] font-bold text-gray-900">{group.title}</h2>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">
              {group.truncated ? `${group.hits.length}+` : group.hits.length}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-gray-500">{group.note}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {group.hits.map(h => (
              <li key={h.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                <Link href={h.href} className="text-[13px] font-semibold text-gray-900 hover:underline">{h.label}</Link>
                {h.detail && <span className="text-[12px] text-gray-600 truncate">{h.detail}</span>}
                {h.when && <span className="ml-auto shrink-0 font-mono text-[10px] text-gray-400">{String(h.when).slice(0, 10)}</span>}
              </li>
            ))}
          </ul>
          {group.truncated && (
            <p className="mt-1 text-[10px] text-gray-400">
              The first {group.hits.length}. Narrow the search rather than scrolling &mdash; there is no
              page two, deliberately: a clinical search that pages is one somebody reads to the end.
            </p>
          )}
        </section>
      ))}

      {/* Empty state: getting back to what you had is the commonest reason to open a search box. */}
      {!result.ran && recent && (
        <>
          {recent.encounters.length > 0 && (
            <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="text-[13px] font-bold text-gray-900">Recent consultations</h2>
              <ul className="mt-2 flex flex-col gap-1">
                {recent.encounters.map((e: { id: string; patient_name: string; reason_for_visit: string | null; status: string; started_at: string }) => (
                  <li key={e.id} className="flex items-baseline gap-2 text-[12px]">
                    <Link href={`/practice/encounters/${e.id}`} className="font-semibold text-gray-900 hover:underline">
                      {e.patient_name}
                    </Link>
                    <span className="truncate text-gray-600">{e.reason_for_visit}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-gray-400">{practiceDayOf(timezone, e.started_at) ?? "\u2014"}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {recent.patients.length > 0 && (
            <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="text-[13px] font-bold text-gray-900">Recently registered</h2>
              <ul className="mt-2 flex flex-col gap-1">
                {recent.patients.map((p: { id: string; display_name: string; created_at: string }) => (
                  <li key={p.id} className="flex items-baseline gap-2 text-[12px]">
                    <Link href={`/practice/patients/${p.id}`} className="font-semibold text-gray-900 hover:underline">
                      {p.display_name}
                    </Link>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-gray-400">{practiceDayOf(timezone, p.created_at) ?? "\u2014"}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
