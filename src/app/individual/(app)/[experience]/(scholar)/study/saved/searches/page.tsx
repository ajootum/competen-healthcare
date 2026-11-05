import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { experienceModulePage, gatedMetadata } from "../../../../../../_components/shell-context";
import { StatePanel, Unreadable, focusRing } from "../../../../../../_components/chrome";
import StudyNav from "../../_components/StudyNav";
import { studyHref } from "../../_components/question-view";
import { HistoryHeader, HistoryList, type ClientEntry } from "../../_components/search-history-client";
import { SearchHistorySetting } from "../../_components/search-history-setting";
import { readSearchHistoryChoice } from "@/lib/individual/scholar/search-history-choice";
import { consentDocuments } from "@/lib/individual/scholar/consent-gate";
import { LearningIcon } from "@/components/ui/scholar-learning";
import { ASK_SOURCE_LABEL } from "@/lib/individual/scholar/ask-sources";
import { countDue, historySchema, librarySchema, listMaterials, listSearchHistory, withHistorySources, searchHistoryTopics, sessionsByIds } from "@/lib/individual/scholar/store";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { LEARN_ACTION_LABEL, type LearnAction } from "@/lib/individual/scholar/config";
import { displaySessionTitle } from "@/lib/individual/scholar/learn-search";
import { learnerTimeZone } from "@/lib/individual/scholar/learning-definitions";
import {
  ASK_NOT_KEPT, CONTINUE_NOTE, HISTORY_EMPTY, HISTORY_PAGE_SIZE, HISTORY_PRIVACY, HISTORY_SHOWS, SHOW_LABEL, entryLinks, entryTitle, hasHistoryFilters, historyParams,
  panelFilterCount, parseHistoryQuery, saveTarget, splitEntryLinks, type HistoryEntry, type HistoryQuery,
} from "@/lib/individual/scholar/search-history";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// MY SEARCH HISTORY -- SCHOLAR-SEARCH-HISTORY-01 (owner directive 4 Nov 2026, P1, SALE learner continuity), migration 992. The owner's
// mock-up: one card, a search box, chips, icon-tile rows with a chevron. Date, material and topic sit behind a Filters control.
// A part of the Personal Learning Library (Saved learning), reachable from Learn's search and the library's search. One private
// list, newest first, of the learner's submitted searches and Ask Scholar questions (from now on) and of what Scholar already
// kept (their saved teaching and lessons, read at request time: nothing invented, nothing regenerated, never a sample). Opening a saved
// answer or a lesson's saved teaching uses NO AI; continuing in Learn is a separate, plainly worded link in the row's menu. Database reads
// only, keyed on the caller. Policy scholar_search_history (default off), and the learner's own setting (on by default once they have seen the notice, 994): with it off
// nothing new is kept, and everything already here can still be opened, removed or cleared. No HQ surface reads it, never AI memory.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "My search history" });
}

const field = `mt-1 block w-full min-w-0 min-h-[40px] rounded-lg border border-gray-300 bg-white px-2 text-[13.5px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[13.5px] font-semibold text-gray-800 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const chip = `inline-flex min-h-[40px] items-center rounded-full border px-4 text-[13.5px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const chipOn = "border-gray-900 bg-gray-900 text-white";
const chipOff = "border-gray-300 bg-white text-gray-800 hover:bg-gray-50";
const base = studyHref("saved/searches");

/** Date, material, topic and pinned: behind one control, so the chip row stays as the mock-up has it. Open while any of them is on. */
function Filters({ q, materials, topics }: { q: HistoryQuery; materials: { id: string; title: string }[]; topics: string[] }) {
  const on = panelFilterCount(q);
  return (
    <details open={on > 0} className="group open:w-full" data-testid="history-filters">
      <summary className={`${chip} ${on ? chipOn : chipOff} cursor-pointer list-none gap-1.5 [&::-webkit-details-marker]:hidden`}>
        Filters{on ? ` (${on})` : ""}<span aria-hidden className="text-[10px] motion-safe:transition-transform group-open:rotate-180">▾</span>
      </summary>
      <form method="get" action={base} className="mt-2 w-full rounded-2xl border border-gray-200 bg-white p-3">
        {q.q && <input type="hidden" name="q" value={q.q} />}
        {q.show && <input type="hidden" name="show" value={q.show} />}
        <div className="grid gap-2 sm:grid-cols-2">
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
          {on > 0 && <Link href={`${base}${historyParams(q, { material: null, topic: null, from: null, to: null, pinned: null })}`} className={ghost}>Clear filters</Link>}
        </div>
      </form>
    </details>
  );
}

export default async function SearchHistoryPage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const [policy, due] = await Promise.all([loadIndividualPolicy(ctx.admin), countDue(ctx.admin, ctx.userId)]);
  const nav = (
    <>
      <StudyNav dueCount={due} study={null} />
      <p className="mb-4 text-[13px]"><Link href={studyHref("saved")} className={`inline-flex items-center font-semibold underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Back to My learning library</Link></p>
    </>
  );
  if (policy.scholarSearchHistory !== "on") return <>{nav}<StatePanel title="My search history is not offered here"><p>Your saved learning and lessons are in My learning library.</p></StatePanel></>;
  if (!(await historySchema(ctx.admin))) return <>{nav}<StatePanel title="My search history is not available here yet"><p>Your saved learning and lessons are unchanged in My learning library.</p></StatePanel></>;

  const q = parseHistoryQuery(await searchParams);
  const choice = await readSearchHistoryChoice(ctx.admin, ctx.userId, policy);
  const documents = consentDocuments();
  const [list, pinned, materials, topics, notesOn] = await Promise.all([
    listSearchHistory(ctx.admin, ctx.userId, q),
    // Pinned rows, above the list: only on the unfiltered first page, so it never repeats what a filter is showing.
    !hasHistoryFilters(q) && q.page === 1 ? listSearchHistory(ctx.admin, ctx.userId, q, { pinnedOnly: true, limit: 20 }) : Promise.resolve(null),
    listMaterials(ctx.admin, ctx.userId), searchHistoryTopics(ctx.admin, ctx.userId),
    policy.scholarLearningLibrary === "on" ? librarySchema(ctx.admin, ctx.userId) : Promise.resolve(false),
  ]);
  const mats = materials.ok ? materials.data.map(m => ({ id: m.id, title: m.title })) : [];
  const titles = new Map(mats.map(m => [m.id, m.title]));
  const shown = [...(list.ok ? list.data.entries : []), ...(pinned?.ok ? pinned.data.entries : [])];
  // A saved teaching's title says what it taught: its action and its lesson (or material). Titles only, never the AI's words.
  const sessions = new Map((await sessionsByIds(ctx.admin, ctx.userId, shown.filter(e => e.activity !== "lesson" && e.sessionId).map(e => e.sessionId!))).map(s => [s.id, displaySessionTitle(s.title)]));
  const tz = learnerTimeZone(await headers());
  const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz });
  const toClient = (e: HistoryEntry): ClientEntry => {
    const material = e.materialId ? titles.get(e.materialId) ?? null : null;
    const about = e.sessionId ? sessions.get(e.sessionId) ?? null : null;
    const action = entryTitle(e, a => LEARN_ACTION_LABEL[a as LearnAction]);
    const teaching = e.activity === "teaching" || e.activity === "research";
    const title = e.activity === "lesson" ? displaySessionTitle(e.label) : teaching && (about ?? material) ? `${action}: ${about ?? material}` : action;
    const meta = [
      material && !title.includes(material) ? material : null,
      e.topic ? `Topic: ${e.topic}` : null,
      e.resultCount !== null ? `${e.resultCount} result${e.resultCount === 1 ? "" : "s"}` : null,
      e.step !== null && e.activity !== "lesson" ? `Lesson ${e.step + 1}` : null,
      e.sources?.length ? `Searched: ${e.sources.map(s => ASK_SOURCE_LABEL[s]).join(", ")}` : null,
    ].filter((x): x is string => !!x);
    const { primary, rest } = splitEntryLinks(entryLinks(e).map(l => ({ label: l.label, href: studyHref(l.path.replace(/^study\/?/, "")), kind: l.kind })));
    return {
      key: e.key, activity: e.activity, title, when: fmt.format(new Date(e.createdAt)), whenIso: e.createdAt, meta, headline: e.headline, pinned: !!e.pinnedAt,
      primary, rest, save: saveTarget(e), ai: teaching, askNotKept: e.activity === "ask",
    };
  };
  const total = list.ok ? list.data.total : 0;
  const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  const entries = list.ok ? (await withHistorySources(ctx.admin, ctx.userId, list.data.entries)).map(toClient) : [];
  const pins = pinned?.ok ? pinned.data.entries.map(toClient) : [];

  return (
    <>
      {nav}
      <section aria-label="My Search History" className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <HistoryHeader count={hasHistoryFilters(q) ? 1 : total} />
        <SearchHistorySetting state={choice.state} unreadable={choice.unreadable} published={documents.published} grantedAt={choice.grantedAt} revokedAt={choice.revokedAt} notifiedAt={choice.notifiedAt} legal={documents.links} />

        <form method="get" action={base} role="search" className="relative mt-4">
          {q.show && <input type="hidden" name="show" value={q.show} />}
          {(["material", "topic", "from", "to"] as const).map(k => (q[k] ? <input key={k} type="hidden" name={k} value={q[k]!} /> : null))}
          {q.pinned && <input type="hidden" name="pinned" value="1" />}
          <label htmlFor="history-q" className="sr-only">Search your history</label>
          <input id="history-q" type="search" name="q" defaultValue={q.q} maxLength={200} placeholder="Search your history..."
            className={`block min-h-[48px] w-full rounded-full border border-gray-300 bg-white py-2.5 pl-5 pr-14 text-[15px] text-gray-900 ${focusRing}`} />
          <button type="submit" aria-label="Search" className={`absolute right-1 top-1 inline-flex h-10 w-10 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100 pointer-coarse:h-[var(--cmp-touch-min)] pointer-coarse:w-[var(--cmp-touch-min)] ${focusRing}`}>
            <LearningIcon name="search" className="h-5 w-5" />
          </button>
        </form>
        {q.q && <p className="mt-1.5 text-[13px]"><Link href={`${base}${historyParams(q, { q: null })}`} className={`inline-flex min-h-[40px] items-center font-semibold underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Clear search</Link></p>}

        <div className="mt-3 flex flex-wrap items-start gap-2">
          <nav aria-label="Show" className="contents">
            <Link href={`${base}${historyParams(q, { show: null })}`} aria-current={!q.show ? "page" : undefined} className={`${chip} ${!q.show ? chipOn : chipOff}`}>All</Link>
            {HISTORY_SHOWS.map(s => (
              <Link key={s} href={`${base}${historyParams(q, { show: s })}`} aria-current={q.show === s ? "page" : undefined} className={`${chip} ${q.show === s ? chipOn : chipOff}`}>{SHOW_LABEL[s]}</Link>
            ))}
          </nav>
          <Filters q={q} materials={mats} topics={topics} />
        </div>

        {pins.length > 0 && <HistoryList id="history-pinned" heading="Pinned" entries={pins} notesOn={notesOn} />}
        {!list.ok ? <div className="mt-4"><Unreadable what="your search history" /></div> : (
          <>
            {hasHistoryFilters(q) && <p className="mt-4 text-[13px] font-semibold text-gray-700" role="status" data-testid="history-count">{total} found</p>}
            {!hasHistoryFilters(q) && <p className="sr-only" data-testid="history-count">{total} entries</p>}
            {pins.length > 0 && <h2 className="mt-4 text-[12px] font-bold uppercase tracking-[0.1em] text-gray-500">Everything</h2>}
            <HistoryList id="history-list" entries={entries} notesOn={notesOn} />
            {entries.length === 0 && <p className="mt-3 rounded-xl bg-gray-50 p-4 text-[14px] text-gray-700" data-testid="history-empty">{hasHistoryFilters(q) ? "Nothing in your history matches. Change the search or the filters." : HISTORY_EMPTY}</p>}
          </>
        )}
        {list.ok && pages > 1 && (
          <nav aria-label="Pages" className="mt-3 flex flex-wrap items-center gap-2">
            {q.page > 1 && <Link href={`${base}${historyParams(q, { page: q.page > 2 ? String(q.page - 1) : null })}`} className={ghost}>Newer</Link>}
            <span className="text-[13px] text-gray-700">Page {q.page} of {pages}</span>
            {q.page < pages && <Link href={`${base}${historyParams(q, { page: String(q.page + 1) })}`} className={ghost}>Older</Link>}
          </nav>
        )}
        <div className="mt-4 space-y-1 border-t border-gray-100 pt-3 text-[12.5px] text-gray-600">
          <p>{HISTORY_PRIVACY}</p>
          <p>{CONTINUE_NOTE}</p>
          <p>{ASK_NOT_KEPT}</p>
        </div>
      </section>
    </>
  );
}
