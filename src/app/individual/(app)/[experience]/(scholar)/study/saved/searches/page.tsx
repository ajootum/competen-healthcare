import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../../_components/shell-context";
import { PageHeader, StatePanel, Unreadable, focusRing } from "../../../../../../_components/chrome";
import StudyNav from "../../_components/StudyNav";
import { studyHref } from "../../_components/question-view";
import { ClearHistory, HistoryList, type ClientEntry } from "../../_components/search-history-client";
import { countDue, librarySchema, listMaterials } from "@/lib/individual/scholar/store";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { LEARN_ACTION_LABEL, type LearnAction } from "@/lib/individual/scholar/config";
import { displaySessionTitle } from "@/lib/individual/scholar/learn-search";
import { learnerTimeZone } from "@/lib/individual/scholar/learning-definitions";
import {
  ACTIVITY_FILTER_LABEL, HISTORY_ACTIVITIES, HISTORY_PAGE_SIZE, HISTORY_PRIVACY, entryLinks, entryTitle, hasHistoryFilters, historyParams,
  parseHistoryQuery, saveTarget, type HistoryEntry, type HistoryQuery,
} from "@/lib/individual/scholar/search-history";
import { historySchema, historyTopics, listHistory } from "@/lib/individual/scholar/search-history-data";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// MY SEARCH HISTORY -- SCHOLAR-SEARCH-HISTORY-01 (owner directive 4 Nov 2026, P1, SALE learner continuity), migration 992.
// A part of the Personal Learning Library (Saved learning), reachable from Learn's search and the library's search. One private
// list, newest first, of the learner's submitted searches and Ask Scholar questions (from now on) and of what Scholar already
// kept (their saved teaching and lessons, read at request time: nothing invented, nothing regenerated). Full-text search and
// filters for activity, material, topic and date. Every link opens something kept, so opening uses NO AI. Pin, Save for
// revision (the 820 bookmark), Remove one, Clear all (confirmed). Database reads only, keyed on the caller. Policy
// scholar_search_history (default off). Never shown to HQ, employers or educators, never AI memory.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "My search history" });
}

const field = `mt-1 block w-full min-w-0 min-h-[40px] rounded-lg border border-gray-300 bg-white px-2 text-[13.5px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[13.5px] font-semibold text-gray-800 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const base = studyHref("saved/searches");

function FilterForm({ q, materials, topics }: { q: HistoryQuery; materials: { id: string; title: string }[]; topics: string[] }) {
  return (
    <form method="get" action={base} className="mt-3 rounded-2xl border border-gray-200 bg-white p-3" data-testid="history-filters">
      {q.q && <input type="hidden" name="q" value={q.q} />}
      <fieldset className="min-w-0">
        <legend className="text-[12px] font-bold uppercase tracking-[0.1em] text-gray-500">Filter</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="min-w-0 text-[12.5px] font-semibold text-gray-800">Activity
            <select name="activity" defaultValue={q.activity ?? ""} className={field}><option value="">Everything</option>{HISTORY_ACTIVITIES.map(a => <option key={a} value={a}>{ACTIVITY_FILTER_LABEL[a]}</option>)}</select>
          </label>
          <label className="min-w-0 text-[12.5px] font-semibold text-gray-800">Material
            <select name="material" defaultValue={q.material ?? ""} className={field}><option value="">All materials</option>{materials.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
          </label>
          <label className="min-w-0 text-[12.5px] font-semibold text-gray-800">Topic
            <select name="topic" defaultValue={q.topic ?? ""} className={field}><option value="">All topics</option>{topics.map(t => <option key={t} value={t}>{t}</option>)}</select>
          </label>
          <label className="min-w-0 text-[12.5px] font-semibold text-gray-800">From
            <input type="date" name="from" defaultValue={q.from ?? ""} className={field} />
          </label>
          <label className="min-w-0 text-[12.5px] font-semibold text-gray-800">To
            <input type="date" name="to" defaultValue={q.to ?? ""} className={field} />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="inline-flex min-h-[40px] items-center gap-2 text-[13.5px] font-semibold text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">
            <input type="checkbox" name="pinned" value="1" defaultChecked={q.pinned} className="h-4 w-4" /> Pinned only
          </label>
          <button type="submit" className={ghost}>Apply filters</button>
          {hasHistoryFilters(q) && <Link href={base} className={ghost}>Clear filters</Link>}
        </div>
      </fieldset>
    </form>
  );
}

export default async function SearchHistoryPage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const [policy, due] = await Promise.all([loadIndividualPolicy(ctx.admin), countDue(ctx.admin, ctx.userId)]);
  const header = (
    <>
      <PageHeader accent={SCHOLAR.accent} eyebrow="Kept for you" title="My search history"
        intro="Your searches, questions to Scholar, saved teaching and lessons, newest first. Search it, filter it and open what you found before. Opening anything here uses no AI." />
      <StudyNav dueCount={due} study={null} />
      <p className="mb-4 text-[13px]"><Link href={studyHref("saved")} className={`font-semibold underline underline-offset-2 ${focusRing}`}>Back to your learning library</Link></p>
    </>
  );
  if (policy.scholarSearchHistory !== "on") return <>{header}<StatePanel title="My search history is not offered here"><p>Your saved learning and lessons are in your learning library.</p></StatePanel></>;
  if (!(await historySchema(ctx.admin))) return <>{header}<StatePanel title="My search history is not available here yet"><p>Your saved learning and lessons are unchanged in your learning library.</p></StatePanel></>;

  const q = parseHistoryQuery(await searchParams);
  const [list, pinned, materials, topics, notesOn] = await Promise.all([
    listHistory(ctx.admin, ctx.userId, q),
    // The pinned strip: only on the unfiltered first page, so it never repeats what a filter is showing.
    !hasHistoryFilters(q) && q.page === 1 ? listHistory(ctx.admin, ctx.userId, q, { pinnedOnly: true, limit: 20 }) : Promise.resolve(null),
    listMaterials(ctx.admin, ctx.userId), historyTopics(ctx.admin, ctx.userId),
    policy.scholarLearningLibrary === "on" ? librarySchema(ctx.admin, ctx.userId) : Promise.resolve(false),
  ]);
  const mats = materials.ok ? materials.data.map(m => ({ id: m.id, title: m.title })) : [];
  const titles = new Map(mats.map(m => [m.id, m.title]));
  const tz = learnerTimeZone(await headers());
  const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz });
  const toClient = (e: HistoryEntry): ClientEntry => {
    const meta = [
      e.materialId && titles.get(e.materialId) ? titles.get(e.materialId)! : null,
      e.topic ? `Topic: ${e.topic}` : null,
      e.resultCount !== null ? `${e.resultCount} result${e.resultCount === 1 ? "" : "s"}` : null,
      e.step !== null && e.activity !== "lesson" ? `Lesson ${e.step + 1}` : null,
    ].filter((x): x is string => !!x);
    const title = e.activity === "lesson" ? displaySessionTitle(e.label) : entryTitle(e, a => LEARN_ACTION_LABEL[a as LearnAction]);
    return {
      key: e.key, activity: e.activity, title, when: fmt.format(new Date(e.createdAt)), whenIso: e.createdAt, meta, headline: e.headline, pinned: !!e.pinnedAt,
      links: entryLinks(e).map(l => ({ label: l.label, href: studyHref(l.path.replace(/^study\/?/, "")) })),
      save: saveTarget(e), ai: e.activity === "teaching" || e.activity === "research", askNotKept: e.activity === "ask",
    };
  };
  const total = list.ok ? list.data.total : 0;
  const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));

  return (
    <>
      {header}
      <p className="mb-3 text-[13px] text-gray-700">{HISTORY_PRIVACY}</p>

      <form method="get" action={base} role="search" className="flex flex-wrap items-end gap-2">
        {(["activity", "material", "topic", "from", "to"] as const).map(k => (q[k] ? <input key={k} type="hidden" name={k} value={q[k]!} /> : null))}
        {q.pinned && <input type="hidden" name="pinned" value="1" />}
        <label className="min-w-0 flex-1 basis-[16rem] text-[12.5px] font-semibold text-gray-800">Search your history
          <input type="search" name="q" defaultValue={q.q} maxLength={200} className={field} placeholder="for example: preload OR afterload" />
        </label>
        <button type="submit" className={ghost}>Search</button>
        {q.q && <Link href={`${base}${historyParams(q, { q: null })}`} className={ghost}>Clear search</Link>}
      </form>

      {/* The filters: open from md up, behind a disclosure on a phone (the one md breakpoint, CPR-MOB-001). */}
      <details className="mt-3 md:hidden">
        <summary className={`flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-white px-4 text-[14px] font-semibold text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] [&::-webkit-details-marker]:hidden ${focusRing}`}>
          <span>Filter{hasHistoryFilters({ ...q, q: "" }) ? " (on)" : ""}</span><span aria-hidden className="text-gray-500">▾</span>
        </summary>
        <FilterForm q={q} materials={mats} topics={topics} />
      </details>
      <div className="hidden md:block"><FilterForm q={q} materials={mats} topics={topics} /></div>

      <div className="mt-5 space-y-5">
        {pinned?.ok && pinned.data.entries.length > 0 && (
          <HistoryList id="history-pinned" title="Pinned" entries={pinned.data.entries.map(toClient)} notesOn={notesOn} empty="" />
        )}
        {!list.ok ? <Unreadable what="your search history" /> : (
          <HistoryList id="history-list" notesOn={notesOn}
            title={hasHistoryFilters(q) ? `${total} found` : `Everything, newest first (${total})`}
            entries={list.data.entries.map(toClient)}
            empty={hasHistoryFilters(q) ? "Nothing in your history matches. Change the search or the filters." : "Nothing here yet. Your searches in Learn and your library, your questions to Scholar, your saved teaching and your lessons appear here."} />
        )}
        {list.ok && pages > 1 && (
          <nav aria-label="Pages" className="flex flex-wrap items-center gap-2">
            {q.page > 1 && <Link href={`${base}${historyParams(q, { page: q.page > 2 ? String(q.page - 1) : null })}`} className={ghost}>Newer</Link>}
            <span className="text-[13px] text-gray-700">Page {q.page} of {pages}</span>
            {q.page < pages && <Link href={`${base}${historyParams(q, { page: String(q.page + 1) })}`} className={ghost}>Older</Link>}
          </nav>
        )}
        <ClearHistory count={hasHistoryFilters(q) ? 1 : total} />
      </div>
    </>
  );
}
