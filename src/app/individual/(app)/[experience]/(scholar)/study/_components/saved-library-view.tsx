import Link from "next/link";
import { PageSearch } from "@/app/individual/_components/search/PageSearch";
import { scopeLine } from "@/lib/individual/search/registry";
import { correctQuery, expandText, expandWebsearch, vocabularyOf } from "@/lib/individual/search/tolerant";
import type { ReactNode } from "react";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import {
  artefactIdsForChunks, artefactIdsForSession, artefactVersions, artefactsByIds, chunksByIds, chunksForCompetency, earlierVersionCounts, libraryArtefactPage, librarySchema, librarySearch,
  librarySessionPage, lessonsForChunks, listArtefacts, listNotes, osceAttemptMaterials, practiceCounts, searchSectionRows, sectionTopicRows, sessionFurthest, sessionStepSummaries,
  sessionsByIds, sessionsWithSavedItems, type ArtefactRow, type LearningSessionRow, type LibraryHit, type NoteRow,
} from "@/lib/individual/scholar/store";
import {
  BASIC_SEARCH_ROWS, LESSON_LINK_LABEL, LIBRARY_PAGE_SIZE, LIBRARY_STATUSES, LIBRARY_VIEWS, PROVENANCE_LABEL, STATUS_LABEL, VIEW_LABEL,
  basicMatches, cardHrefPath, encodeCursor, savedNothing, lessonHrefPath, lessonLinkOf, lessonTitleOf, parseLibraryQuery, provenanceOf, rangeBounds, sectionsHrefPath,
  snippetParts, versionLabel, type Cursor, type LessonLink, type LibraryQuery, type LibraryStatus,
} from "@/lib/individual/scholar/saved-library";
import {
  FILTERED_SEARCH_READ, SECTION_PAGE, filterChips, groupHits, hasLibraryFilters, itemActions, itemAllowed, locationLabel, noteAttachedTo, ownedQuery, pageFiltered, sectionHits,
  type FilterChip, type FilterScope, type ItemRef, type MaterialName,
} from "@/lib/individual/scholar/library-organise";
import { resolveFilterScope } from "@/lib/individual/scholar/library-scope";
import { rankChunks, toTsQuery } from "@/lib/individual/scholar/retrieval";
import { UNIT_OF } from "@/lib/individual/scholar/config";
import { coversLesson } from "@/lib/individual/scholar/learn-journey";
import { displaySessionTitle } from "@/lib/individual/scholar/learn-search";
import { referenceSource, relabelReferences } from "@/lib/individual/scholar/learn";
import { AI_LABEL, LEARN_ACTION_LABEL, SOURCE_KIND_LABEL, SUPPLEMENTARY_LABEL, type LearnAction } from "@/lib/individual/scholar/config";
import type { IndividualPolicy } from "@/lib/individual/policy";
import { StatePanel, Unreadable, focusRing } from "../../../../../_components/chrome";
import { sourceHref } from "./question-view";
import { AiFlagList, GovernedReferenceList } from "./learn-kinds";
import { LibraryNotes, NewNoteForm, StandaloneNote, type ClientNote } from "./library-notes-client";
import { askPrefill } from "@/lib/individual/scholar/ask-context";
import { ReadAloudButton } from "@/app/individual/_components/speech/speech-buttons";
import { savedLessonChunkIds } from "@/lib/individual/scholar/ask-grounding";
import { AskAbout } from "./ask-panel";
// SALE-2026-11 R3 / SALE-12: the active Notebook view (policy scholar_active_notebook, default off).
import { NotebookView } from "./notebook-view";
import { workspaceSchema } from "@/lib/individual/scholar/store";
// SCHOLAR-SEARCH-HISTORY-01: My search history (policy scholar_search_history, default off), its entry here and its capture.
import { HistoryKeyInput, RecordSearch } from "./search-history-client";
import { HistoryNotice } from "../../../../../_components/SearchHistoryChoice";

// SCHOLAR-LIBRARY-01 (owner instruction 1 Nov 2026): THE PERSONAL LIBRARY on Saved learning. A server component: database
// reads only, keyed on the caller (store.ts), shaped by saved-library.ts. NO AI anywhere: opening a lesson from here is the
// Learn open path, which serves saved teaching without a model call. Private to the learner, never shared.

type Admin = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Params = Record<string, string | string[] | undefined>;
const href = (seg: string) => experienceHref("scholar", seg);
const EXPORT = "/api/individual/scholar/learn/export";
const EXPORT_FORM = "saved-lessons-export";
const ukDay = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); };
const pill = "inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[12px] font-semibold text-gray-700";
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[13.5px] font-semibold text-gray-800 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const linkCls = `pointer-coarse:inline-flex pointer-coarse:min-h-[var(--cmp-touch-min)] pointer-coarse:items-center font-semibold text-gray-900 underline underline-offset-2 ${focusRing}`;
const field = `mt-1 block w-full min-w-0 min-h-[40px] rounded-lg border border-gray-300 bg-white px-2 text-[13.5px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const actionCls = `inline-flex min-h-[40px] items-center px-1 font-semibold text-gray-900 underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

/** The page's URL with some params changed (null removes one). The cursor is dropped whenever anything else changes. */
function urlWith(q: LibraryQuery, change: Record<string, string | null>): string {
  const p = new URLSearchParams();
  const base: Record<string, string | null> = {
    view: q.view === "recent" ? null : q.view, material: q.material, topic: q.topic, session: q.session, competency: q.competency, from: q.from, to: q.to,
    status: q.status === "any" ? null : q.status, sort: q.sort === "newest" ? null : q.sort, q: q.q || null,
  };
  for (const [k, v] of Object.entries({ ...base, ...change })) if (v) p.set(k, v);
  const s = p.toString();
  return `${href("study/saved")}${s ? `?${s}` : ""}`;
}

/** The text and <mark> parts of a snippet: text nodes only, never HTML. */
function Snippet({ headline }: { headline: string }) {
  return <p className="mt-1 break-words text-[13.5px] leading-relaxed text-gray-800">{snippetParts(headline).map((p, i) => (p.mark ? <mark key={i} className="rounded bg-amber-100 px-0.5 text-gray-900">{p.text}</mark> : <span key={i}>{p.text}</span>))}</p>;
}

function Pager({ q, next, prevFirst }: { q: LibraryQuery; next: Cursor | null; prevFirst: boolean }) {
  if (!next && !prevFirst) return null;
  return (
    <nav aria-label="Pages" className="mt-4 flex flex-wrap gap-2">
      {prevFirst && <Link href={urlWith(q, {})} className={ghost}>Back to the first page</Link>}
      {next && <Link href={urlWith(q, { after: encodeCursor(next) })} className={ghost}>Next {LIBRARY_PAGE_SIZE}</Link>}
    </nav>
  );
}

const FILTER_KEYS = ["material", "topic", "session", "competency"] as const;

export async function SavedLibrary({ admin, userId, params, policy, materials, competencies, notesOn }: {
  admin: Admin; userId: string; params: Params; policy: IndividualPolicy; materials: { id: string; title: string; mime?: string | null }[];
  competencies: { id: string; title: string }[] | null; notesOn: boolean;
}) {
  const notebookOn = policy.scholarActiveNotebook === "on";
  const historyOn = policy.scholarSearchHistory === "on";
  const historyKey = typeof params.hk === "string" ? params.hk : null;
  const asked0 = parseLibraryQuery(params);
  // The Notebook view only where HQ offers it; anywhere else the address falls back to the default view.
  const parsed = asked0.view === "notebook" && !notebookOn ? { ...asked0, view: "recent" as const } : asked0;
  const v820 = await librarySchema(admin, userId);
  const notes = notesOn && v820;
  const titles = new Map(materials.map(m => [m.id, m.title]));
  const names = new Map<string, MaterialName>(materials.map(m => [m.id, { title: m.title, mime: m.mime ?? null, unit: m.mime ? UNIT_OF(m.mime) : "page" }]));
  const version = typeof params.version === "string" ? params.version : null;
  const [topics, withItems, asked] = await Promise.all([
    sectionTopicRows(admin, userId), sessionsWithSavedItems(admin, userId), parsed.session ? sessionsByIds(admin, userId, [parsed.session]) : Promise.resolve([] as LearningSessionRow[]),
  ]);
  const topicRows = topics.ok ? topics.data : [];
  const topicList = [...new Set(topicRows.flatMap(t => t.topics))].sort((a, b) => a.localeCompare(b)).slice(0, 300);
  // CE-02: an id the learner does not own is dropped here, so another learner's material or session id gives the unfiltered page.
  const sessionRows = [...withItems, ...asked.filter(s => !withItems.some(w => w.id === s.id))];
  const q = ownedQuery(parsed, { materialIds: new Set(materials.map(m => m.id)), sessionIds: new Set(sessionRows.map(s => s.id)), competencyIds: new Set((competencies ?? []).map(c => c.id)) });
  const sessionOptions = sessionRows.map(s => ({ id: s.id, label: `${displaySessionTitle(s.title)} · ${ukDay(s.lastActiveAt)}` }));
  const chips = filterChips(q, { materials: titles, sessions: new Map(sessionOptions.map(s => [s.id, s.label])), competencies: new Map((competencies ?? []).map(c => [c.id, c.title])) });

  return (
    <section aria-labelledby="library-h" className="mt-2">
      <h2 id="library-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Your saved lessons</h2>
      <p className="mt-1 text-[13px] text-gray-600">{AI_LABEL}. Private to you and for your own study: never an assessment, never evidence of competence. Opening anything here uses no AI.</p>

      {/* SEARCH: deterministic and private (no AI). One search over saved lessons, notes, questions and your materials. */}
      <PageSearch scope={scopeLine("saved")} action={href("study/saved")} value={q.q} placeholder="for example: preload OR afterload" className="mt-3"
        hidden={Object.fromEntries(FILTER_KEYS.map(k => [k, q[k]]))} clearHref={urlWith(q, { q: null })} extra={historyOn ? <HistoryKeyInput /> : undefined} />
      <HistoryNotice />
      {historyOn && q.q && <RecordSearch activity="library_search" query={q.q} requestKey={historyKey} resultCount={null} materialId={q.material} />}

      {version ? await VersionView({ admin, userId, id: version, titles, policy, notes, q })
        : (
          <>
            {!q.q && (
              <nav aria-label="Library views" className="mt-4 flex flex-wrap gap-2">
                {LIBRARY_VIEWS.filter(v => v !== "notebook" || (notebookOn && notes)).map(v => (
                  <Link key={v} href={urlWith(q, { view: v === "recent" ? null : v })} aria-current={q.view === v ? "page" : undefined}
                    className={`inline-flex min-h-[40px] items-center rounded-full border px-3.5 text-[13px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${q.view === v ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"}`}
                    style={q.view === v ? { background: SCHOLAR.accent, borderColor: SCHOLAR.accent } : undefined}>{VIEW_LABEL[v]}</Link>
                ))}
                {historyOn && (
                  <Link href={href("study/saved/searches")} data-testid="library-history-link"
                    className={`inline-flex min-h-[40px] items-center rounded-full border border-gray-300 bg-white px-3.5 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>My search history</Link>
                )}
              </nav>
            )}
            {(q.view !== "notebook" || !!q.q) && (
              <>
                <FilterPanel q={q} materials={materials} topics={topicList} sessions={sessionOptions} competencies={competencies} statuses={v820 ? LIBRARY_STATUSES : ["any"]} count={chips.length} />
                <FilterChips q={q} chips={chips} />
              </>
            )}
            {q.q ? await SearchView({ admin, userId, q, v820, titles, names, topicRows })
              : q.view === "recent" ? await RecentView({ admin, userId, q, titles, policy, notes, topicRows })
                : q.view === "revision" ? await RevisionView({ admin, userId, q, titles, notes, v820, topicRows })
                  : q.view === "notes" ? await NotesView({ admin, userId, q, titles, names, notes, v820, topicRows, materials })
                    : q.view === "notebook" ? (notes ? await NotebookView({ admin, userId, materials, summariesOn: await workspaceSchema(admin) }) : <Empty>The Notebook is not available here yet.</Empty>)
                    : await SessionView({ admin, userId, q, status: q.view === "continue" ? "active" : "completed" })}
          </>
        )}
    </section>
  );
}

type FilterProps = {
  q: LibraryQuery; materials: { id: string; title: string }[]; topics: string[]; sessions: { id: string; label: string }[];
  competencies: { id: string; title: string }[] | null; statuses: readonly LibraryStatus[];
};

/** CE-02: the filters, always open from `md` up, behind a "Filter" disclosure on a phone (the one md breakpoint). */
function FilterPanel(props: FilterProps & { count: number }) {
  return (
    <>
      <details className="mt-3 md:hidden">
        <summary className={`flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-white px-4 text-[14px] font-semibold text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] [&::-webkit-details-marker]:hidden ${focusRing}`}>
          <span>Filter{props.count > 0 ? ` (${props.count} on)` : ""}</span><span aria-hidden className="text-gray-500">▾</span>
        </summary>
        <FilterForm {...props} />
      </details>
      <div className="hidden md:block"><FilterForm {...props} /></div>
    </>
  );
}

function FilterChips({ q, chips }: { q: LibraryQuery; chips: FilterChip[] }) {
  if (!chips.length) return null;
  return (
    <ul aria-label="Active filters" className="mt-3 flex flex-wrap gap-2">
      {chips.map(c => (
        <li key={c.key} className="min-w-0 max-w-full">
          <Link href={urlWith(q, { [c.key]: null })} aria-label={`Remove the ${c.label} filter: ${c.text}`}
            className={`inline-flex min-h-[40px] max-w-full items-center gap-2 rounded-full border border-gray-300 bg-white px-3 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
            <span className="min-w-0 break-words"><span className="font-normal text-gray-600">{c.label}: </span>{c.text}</span><span aria-hidden>×</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function FilterForm({ q, materials, topics, sessions, competencies, statuses }: FilterProps) {
  const sessionViews = q.view === "continue" || q.view === "completed";
  const noStatus = q.view === "notes" || q.view === "revision" || !!q.q;
  return (
    <form method="get" action={href("study/saved")} className="mt-3 rounded-2xl border border-gray-200 bg-white p-3">
      {q.view !== "recent" && !q.q && <input type="hidden" name="view" value={q.view} />}
      {q.q && <input type="hidden" name="q" value={q.q} />}
      <fieldset className="min-w-0">
        <legend className="text-[12px] font-bold uppercase tracking-[0.1em] text-gray-500">Filter and sort</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {!sessionViews && (
            <>
              <label className="min-w-0 text-[12.5px] font-semibold text-gray-800">Material
                <select name="material" defaultValue={q.material ?? ""} className={field}><option value="">All materials</option>{materials.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
              </label>
              <label className="min-w-0 text-[12.5px] font-semibold text-gray-800">Topic
                <select name="topic" defaultValue={q.topic ?? ""} className={field}><option value="">All topics</option>{topics.map(t => <option key={t} value={t}>{t}</option>)}</select>
              </label>
              <label className="min-w-0 text-[12.5px] font-semibold text-gray-800">Study session
                <select name="session" defaultValue={q.session ?? ""} className={field} disabled={!sessions.length}>
                  <option value="">{sessions.length ? "All study sessions" : "No session has saved items"}</option>{sessions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <label className="min-w-0 text-[12.5px] font-semibold text-gray-800">Competency
                <select name="competency" defaultValue={q.competency ?? ""} className={field} disabled={!competencies?.length}>
                  <option value="">{competencies?.length ? "All competencies" : "No programme chosen"}</option>{(competencies ?? []).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </label>
              {!noStatus && (
                <label className="min-w-0 text-[12.5px] font-semibold text-gray-800">Status
                  <select name="status" defaultValue={q.status} className={field}>{statuses.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
                </label>
              )}
            </>
          )}
          {!q.q && (
            <>
              <label className="min-w-0 text-[12.5px] font-semibold text-gray-800">From<input type="date" name="from" defaultValue={q.from ?? ""} className={field} /></label>
              <label className="min-w-0 text-[12.5px] font-semibold text-gray-800">To<input type="date" name="to" defaultValue={q.to ?? ""} className={field} /></label>
              <label className="min-w-0 text-[12.5px] font-semibold text-gray-800">Sort
                <select name="sort" defaultValue={q.sort} className={field}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>
              </label>
            </>
          )}
        </div>
        {sessionViews && <p className="mt-2 text-[12px] text-gray-600">Material, topic, study session and competency filters apply to saved lessons, notes and search. Sessions filter by when you last studied them.</p>}
        {!!q.q && <p className="mt-2 text-[12px] text-gray-600">Filters apply to your saved lessons, notes, questions and materials in the search below.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="submit" className={ghost}>Apply</button>
          <Link href={urlWith({ ...q, material: null, topic: null, session: null, competency: null, from: null, to: null, status: "any", sort: "newest" }, {})} className={ghost}>Clear filters</Link>
        </div>
      </fieldset>
    </form>
  );
}

/** Which artefacts the topic, competency, study session and status filters allow (null: no such filter). Intersected, never guessed. */
async function filterIds(admin: Admin, userId: string, q: LibraryQuery, topicRows: { chunkId: string; topics: string[] }[]): Promise<string[] | null> {
  const sets: Set<string>[] = [];
  if (q.topic) {
    const want = q.topic.toLowerCase();
    sets.push(new Set(await artefactIdsForChunks(admin, userId, topicRows.filter(r => r.topics.some(t => t.toLowerCase() === want)).map(r => r.chunkId)) ?? []));
  }
  if (q.competency) sets.push(new Set(await artefactIdsForChunks(admin, userId, await chunksForCompetency(admin, userId, q.competency, { acceptedOnly: true })) ?? []));
  if (q.session) sets.push(new Set(await artefactIdsForSession(admin, userId, q.session) ?? []));
  if (q.status === "noted" || q.status === "bookmarked") {
    const n = await listNotes(admin, userId, { kinds: q.status === "noted" ? ["note", "highlight"] : ["bookmark"], limit: 1000 });
    // Without 820 there are no notes: the status is ignored, never read as "none match".
    if (n.ok || !n.notProvisioned) sets.push(new Set(n.ok ? n.data.rows.map(r => r.artefactId).filter((x): x is string => !!x) : []));
  }
  if (!sets.length) return null;
  return [...sets.reduce((a, b) => new Set([...a].filter(x => b.has(x))))];
}

type ItemCtx = {
  titles: Map<string, string>; sessions: Map<string, LearningSessionRow>; links: Map<string, LessonLink | null>; counts: Map<string, { cards: number; questions: number; attempts: number }>;
  osce: Set<string>; notes: Map<string, ClientNote[]>; earlier: Map<string, number>; notesOn: boolean;
  refSource: Awaited<ReturnType<typeof referenceSource>>; selectable: boolean;
};

/** Everything a page of saved teaching shows beside each item, read once for the page. */
async function itemContext(admin: Admin, userId: string, rows: ArtefactRow[], titles: Map<string, string>, policy: IndividualPolicy, notesOn: boolean, selectable: boolean): Promise<ItemCtx> {
  const chunks = [...new Set(rows.flatMap(a => a.sources))];
  const [lessons, counts, osce, own, earlier] = await Promise.all([
    lessonsForChunks(admin, userId, chunks), practiceCounts(admin, userId, chunks), osceAttemptMaterials(admin, userId).catch(() => new Set<string>()),
    notesOn ? listNotes(admin, userId, { artefactIds: rows.map(r => r.id), limit: 1000 }) : Promise.resolve(null), earlierVersionCounts(admin, userId, rows),
  ]);
  const links = new Map(rows.map(a => [a.id, lessonLinkOf(a, lessons, coversLesson)]));
  const sessions = new Map((await sessionsByIds(admin, userId, [...links.values()].flatMap(l => (l ? [l.sessionId] : [])))).map(s => [s.id, s]));
  const notes = new Map<string, ClientNote[]>();
  for (const n of own?.ok ? own.data.rows : []) if (n.artefactId) notes.set(n.artefactId, [...(notes.get(n.artefactId) ?? []), toClient(n)]);
  const refSource = rows.some(a => a.refs.length) ? await referenceSource(admin, policy, null) : { collections: true as const, catalogue: [] };
  return { titles, sessions, links, counts, osce, notes, earlier, notesOn, refSource, selectable };
}
const toClient = (n: NoteRow): ClientNote => ({ id: n.id, kind: n.kind, body: n.body, quote: n.quote, createdAt: n.createdAt, updatedAt: n.updatedAt, step: n.step, artefactId: n.artefactId });

function itemTitle(a: ArtefactRow, c: ItemCtx): string {
  const l = c.links.get(a.id), s = l ? c.sessions.get(l.sessionId) : null;
  if (l && s) return `${displaySessionTitle(s.title)} · Lesson ${l.step + 1}`;
  return lessonTitleOf(a.content) || (LEARN_ACTION_LABEL[a.action as LearnAction] ?? "Saved lesson");
}

function ArtefactItem({ a, c, open = false }: { a: ArtefactRow; c: ItemCtx; open?: boolean }) {
  const l = c.links.get(a.id) ?? null;
  const live = l && c.sessions.has(l.sessionId) ? l : null;
  const counts = a.sources.reduce((t, id) => { const x = c.counts.get(id); return x ? { cards: t.cards + x.cards, questions: t.questions + x.questions, attempts: t.attempts + x.attempts } : t; }, { cards: 0, questions: 0, attempts: 0 });
  const mine = c.notes.get(a.id) ?? [];
  const earlier = c.earlier.get(a.id) ?? 0;
  const domId = `saved-${a.id}`;
  const acts = itemActions({ materialId: a.materialId, chunkId: a.sources[0] ?? null });
  return (
    <li className="cmp-learn-notes cmp-learn-box p-4">
      <div className="flex flex-wrap items-start gap-3">
        {c.selectable && (
          <label className="-m-1 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center pointer-coarse:min-h-[var(--cmp-touch-min)] pointer-coarse:min-w-[var(--cmp-touch-min)]">
            <input type="checkbox" form={EXPORT_FORM} name="selected" value={a.id} aria-label={`Choose ${itemTitle(a, c)} to download`} className="h-5 w-5" />
          </label>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-[15px] font-bold text-gray-900">{itemTitle(a, c)}</h3>
          <p className="mt-0.5 text-[12.5px] text-gray-600">
            {c.titles.get(a.materialId) ?? "Your material"} · {LEARN_ACTION_LABEL[a.action as LearnAction] ?? a.action} · saved {ukDay(a.createdAt)} · {versionLabel(a)}
            {earlier > 0 && <> · <Link href={urlWithVersion(a.id)} className={linkCls}>Earlier versions ({earlier})</Link></>}
          </p>
          <p className="mt-1.5 flex flex-wrap gap-1.5">
            {provenanceOf(a, mine.length).map(p => <span key={p} className={pill}>{PROVENANCE_LABEL[p]}</span>)}
            {live && <span className={pill}>{LESSON_LINK_LABEL[live.kind]}</span>}
          </p>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0 text-[13px]">
            <Link href={href(live ? lessonHrefPath(live.sessionId, live.step) : sectionsHrefPath(a.sources))} className={actionCls}>Review saved lesson</Link>
            {/* CE-02: Revise (flashcards, scoped to the lesson's first section), Practise, Open source -- links only, no AI. */}
            {acts.map(x => (
              <Link key={x.key} href={href(x.path)} className={actionCls}>
                {x.key === "revise" && counts.cards > 0 ? `${x.label} (${counts.cards} card${counts.cards === 1 ? "" : "s"})` : x.key === "practise" && counts.questions + counts.attempts > 0 ? `${x.label}: ${counts.questions} question${counts.questions === 1 ? "" : "s"}, ${counts.attempts} attempt${counts.attempts === 1 ? "" : "s"}` : x.label}
              </Link>
            ))}
            {c.osce.has(a.materialId) && <Link href={href("study/apply/osce")} className={actionCls}>OSCE practice gaps</Link>}
            {live && <Link href={href(`study/learn?session=${encodeURIComponent(live.sessionId)}`)} className={actionCls}>Open its session</Link>}
            <a href={`${EXPORT}?selected=${a.id}`} download className={actionCls}>Download (PDF)</a>
          </p>
          {/* SCHOLAR-CE-2026 CE-01: ask about this lesson in place -- its session's step where it still has one, else the sections it was taught from. */}
          <AskAbout className="mt-2" surface="library" chunkIds={savedLessonChunkIds(a.sources)} materialId={a.materialId} sessionId={live?.sessionId ?? null} step={live?.step ?? null}
            refLabel={`Saved lesson: ${itemTitle(a, c)}`} prefill={askPrefill("library", { title: itemTitle(a, c) })} />
          <details className="mt-2 rounded-xl bg-[var(--cmp-app-surface)] ring-1 ring-[var(--learn-border)]" open={open}>
            <summary className={`cursor-pointer list-none px-3 py-2 text-[13.5px] font-semibold text-gray-900 ${focusRing}`}>Read it here</summary>
            <div id={domId} className="border-t border-gray-100 px-3 py-3"><ArtefactBody a={a} c={c} /></div>
          </details>
          {c.notesOn && <LibraryNotes target={{ targetKind: "artefact", artefactId: a.id, ...(l?.kind === "linked" ? { sessionId: l.sessionId, step: l.step } : {}) }} initial={mine} containerId={domId} />}
        </div>
      </div>
    </li>
  );
}
const urlWithVersion = (id: string) => `${href("study/saved")}?version=${encodeURIComponent(id)}`;

function ArtefactBody({ a, c }: { a: ArtefactRow; c: Pick<ItemCtx, "refSource"> }) {
  return (
    <>
      <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-gray-500">{SOURCE_KIND_LABEL.notes}</p>
      <ReadAloudButton text={a.content} about="this saved lesson" className="mt-1" />
      <div className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-gray-800">{a.content}</div>
      <ul className="mt-2 space-y-0.5">
        {a.sources.map((chunkId, i) => (
          <li key={chunkId} className="text-[12.5px]"><span className="font-mono font-bold" style={{ color: SCHOLAR.accent }}>[S{i + 1}]</span>{" "}
            <Link href={sourceHref(a.materialId, chunkId)} className={`underline underline-offset-2 ${focusRing}`}>the section in your notes</Link></li>
        ))}
      </ul>
      {a.refs.length > 0 && <GovernedReferenceList refs={relabelReferences(a.refs, c.refSource)} />}
      {a.background && (
        <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2 text-[13px] text-gray-800">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-sky-900">{SUPPLEMENTARY_LABEL}</p>
          <p className="mt-1">{a.background}</p>
        </div>
      )}
      {a.flags.length > 0 && <AiFlagList flags={a.flags} />}
      <p className="mt-2 text-[11px] text-gray-500">Private, formative · model {a.model} · prompt {a.promptVersion}</p>
    </>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-[14px] text-gray-600">{children}</p>;
}

async function RecentView({ admin, userId, q, titles, policy, notes, topicRows }: {
  admin: Admin; userId: string; q: LibraryQuery; titles: Map<string, string>; policy: IndividualPolicy; notes: boolean; topicRows: { chunkId: string; topics: string[] }[];
}) {
  const ids = await filterIds(admin, userId, q, topicRows);
  const { fromIso, toIso } = rangeBounds(q.from, q.to);
  const page = await libraryArtefactPage(admin, userId, { materialId: q.material, ids, fromIso, toIso, versions: q.status === "earlier" ? "earlier" : "current", sort: q.sort, cursor: q.cursor, limit: LIBRARY_PAGE_SIZE });
  if (!page.ok) return page.notProvisioned
    ? <div className="mt-3"><StatePanel title="Saving explanations is not available here yet"><p>Explanations are still given in Learn; they are not kept here.</p></StatePanel></div>
    : <div className="mt-3"><Unreadable what="saved lessons" /></div>;
  const rows = page.data.rows;
  if (!rows.length) return <Empty>{q.cursor ? "No more saved lessons." : "Nothing saved matches yet. Lessons you study in Learn are kept here."}</Empty>;
  const c = await itemContext(admin, userId, rows, titles, policy, notes, true);
  // One whole-filter download, where the filter is exactly one export scope.
  const only = !q.competency && q.status === "any";
  const whole = !only ? null : q.material && !q.topic && !q.from ? `?material=${q.material}` : q.topic && !q.material && !q.from ? `?topic=${encodeURIComponent(q.topic)}` : q.from && q.to && !q.material && !q.topic ? `?from=${q.from}&to=${q.to}` : null;
  return (
    <div className="mt-3">
      {/* The list sits outside the form: each row holds an Ask panel with its own form, and forms cannot nest. The tick boxes join it by id. */}
      <form id={EXPORT_FORM} method="get" action={EXPORT} className="mb-2 flex flex-wrap items-center gap-2">
        <button type="submit" className={ghost}>Download chosen lessons (PDF, up to 100)</button>
        {whole && <a href={`${EXPORT}${whole}`} download className={ghost}>Download everything this filter shows (PDF)</a>}
      </form>
      <ul className="space-y-3">{rows.map(a => <ArtefactItem key={a.id} a={a} c={c} />)}</ul>
      <Pager q={q} next={page.data.next} prevFirst={!!q.cursor} />
    </div>
  );
}

async function SessionView({ admin, userId, q, status }: { admin: Admin; userId: string; q: LibraryQuery; status: "active" | "completed" }) {
  const { fromIso, toIso } = rangeBounds(q.from, q.to);
  const page = await librarySessionPage(admin, userId, { status, sort: q.sort, cursor: q.cursor, limit: LIBRARY_PAGE_SIZE, fromIso, toIso });
  if (!page.ok) return page.notProvisioned ? <Empty>Learning sessions are not kept here.</Empty> : <div className="mt-3"><Unreadable what="your learning sessions" /></div>;
  const rows = page.data.rows;
  if (!rows.length) return <Empty>{status === "active" ? "Nothing to continue. Start learning from Learn." : "No finished sessions yet. A session is completed when you choose Finish session."}</Empty>;
  const [steps, far] = await Promise.all([sessionStepSummaries(admin, userId, rows.map(s => s.id)), sessionFurthest(admin, userId, rows.map(s => s.id))]);
  return (
    <>
      <ul className="mt-3 space-y-2">
        {rows.map(s => {
          const n = steps.get(s.id)?.steps ?? 0;
          const at = Math.min(Math.max(far.get(s.id) ?? s.currentStep, s.currentStep), Math.max(0, n - 1));
          return (
            <li key={s.id} className="cmp-learn-next flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-[var(--learn-border)] bg-[var(--cmp-app-surface)] px-4 py-3">
              <span className="min-w-0 flex-1 basis-[14rem]">
                <span className="block break-words text-[14.5px] font-semibold text-gray-900">{displaySessionTitle(s.title)}</span>
                <span className="block text-[12.5px] text-gray-600">{n ? `Lesson ${at + 1} of ${n}` : "No lessons left"} · last studied {ukDay(s.lastActiveAt)}{status === "completed" ? " · Completed" : ""}</span>
              </span>
              <Link href={href(`study/learn?session=${encodeURIComponent(s.id)}`)} className={ghost}>{status === "active" ? "Continue learning" : "Review"}</Link>
            </li>
          );
        })}
      </ul>
      <Pager q={q} next={page.data.next} prevFirst={!!q.cursor} />
    </>
  );
}

const refOf = (n: { materialId: string | null; sessionId: string | null; artefactId: string | null; chunkId: string | null }): ItemRef => ({ materialId: n.materialId, sessionId: n.sessionId, artefactId: n.artefactId, chunkId: n.chunkId });
/** A date test on real instants (the database's offset text and the range's Z text do not compare as strings). */
const inRange = (iso: string, fromIso: string | null, toIso: string | null) => {
  const t = Date.parse(iso);
  return !(fromIso && t < Date.parse(fromIso)) && !(toIso && t >= Date.parse(toIso));
};

/** CE-02: Revise / Practise / Open source for an item that has a material (and a section where it has one). Links only, no AI. */
function ActionLinks({ item, extra }: { item: { materialId: string | null; chunkId: string | null }; extra?: ReactNode }) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0 text-[13px]">
      {extra}
      {itemActions(item).map(a => <Link key={a.key} href={href(a.path)} className={actionCls}>{a.label}</Link>)}
    </p>
  );
}

async function RevisionView({ admin, userId, q, titles, notes, v820, topicRows }: {
  admin: Admin; userId: string; q: LibraryQuery; titles: Map<string, string>; notes: boolean; v820: boolean; topicRows: { chunkId: string; topics: string[] }[];
}) {
  if (!v820 || !notes) return <Empty>Bookmarks are not available here yet.</Empty>;
  const marks = await listNotes(admin, userId, { kinds: ["bookmark"], limit: 1000 });
  if (!marks.ok) return <div className="mt-3"><Unreadable what="your bookmarks" /></div>;
  const { fromIso, toIso } = rangeBounds(q.from, q.to);
  const dated = marks.data.rows.filter(r => inRange(r.createdAt, fromIso, toIso));
  const scope = await resolveFilterScope(admin, userId, q, topicRows, dated.map(refOf));
  const ordered = q.sort === "oldest" ? [...dated].reverse() : dated;
  const { items: rows, total } = pageFiltered(ordered, r => itemAllowed(refOf(r), scope), q.page, LIBRARY_PAGE_SIZE);
  if (!rows.length) return <Empty>{hasLibraryFilters(q) || q.from || q.to || q.page > 1 ? "No bookmarks match." : "Nothing bookmarked yet. Choose Bookmark for revision on a lesson or a saved lesson."}</Empty>;
  const [arts, sessions] = await Promise.all([
    artefactsByIds(admin, userId, rows.flatMap(r => (r.artefactId ? [r.artefactId] : []))),
    sessionsByIds(admin, userId, rows.flatMap(r => (r.sessionId ? [r.sessionId] : []))),
  ]);
  const byId = new Map((arts.ok ? arts.data : []).map(a => [a.id, a]));
  const ses = new Map(sessions.map(s => [s.id, s]));
  return (
    <>
      <ul className="mt-3 space-y-2">
        {rows.map(r => {
          const a = r.artefactId ? byId.get(r.artefactId) : null, s = r.sessionId ? ses.get(r.sessionId) : null;
          const title = a ? lessonTitleOf(a.content) || "Saved lesson" : s && r.step !== null ? `${displaySessionTitle(s.title)} · Lesson ${r.step + 1}` : r.materialId ? titles.get(r.materialId) ?? "Your material" : "Bookmarked";
          const to = a ? urlWithVersion(a.id) : s && r.step !== null ? href(lessonHrefPath(s.id, r.step)) : r.materialId ? href(r.chunkId ? `study/${r.materialId}#c-${r.chunkId}` : `study/${r.materialId}`) : null;
          return (
            <li key={r.id} className="cmp-learn-next flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-[var(--learn-border)] bg-[var(--cmp-app-surface)] px-4 py-3">
              <span className="min-w-0 flex-1 basis-[14rem]">
                <span className="block break-words text-[14.5px] font-semibold text-gray-900">{title}</span>
                <span className="block text-[12.5px] text-gray-600">Bookmarked {ukDay(r.createdAt)}{a ? ` · ${titles.get(a.materialId) ?? "Your material"}` : ""}</span>
              </span>
              {to ? <Link href={to} className={ghost}>Open</Link> : <span className="text-[12.5px] text-gray-600">No longer available</span>}
            </li>
          );
        })}
      </ul>
      <SearchPager q={q} more={q.page * LIBRARY_PAGE_SIZE < total} />
    </>
  );
}

/**
 * CE-02: YOUR NOTES. The learner's notes and highlights (bookmarks are in "Saved for revision"), filtered by material, topic, study
 * session and competency, each with where it is attached, when it was written and edited, Edit / Remove, and Ask / Revise / Practise /
 * Open source where it has a section or a material. Beside them, the form to write a new note on a material (and a section of it).
 * The newest 1000 are read and filtered here; a note beyond that says so.
 */
async function NotesView({ admin, userId, q, titles, names, notes, v820, topicRows, materials }: {
  admin: Admin; userId: string; q: LibraryQuery; titles: Map<string, string>; names: Map<string, MaterialName>; notes: boolean; v820: boolean;
  topicRows: { chunkId: string; topics: string[] }[]; materials: { id: string; title: string }[];
}) {
  if (!v820 || !notes) return <Empty>Notes are not available here yet.</Empty>;
  const r = await listNotes(admin, userId, { kinds: ["note", "highlight"], limit: 1000 });
  if (!r.ok) return <div className="mt-3"><Unreadable what="your notes" /></div>;
  const { fromIso, toIso } = rangeBounds(q.from, q.to);
  const dated = r.data.rows.filter(n => inRange(n.createdAt, fromIso, toIso));
  const scope = await resolveFilterScope(admin, userId, q, topicRows, dated.map(refOf));
  const ordered = q.sort === "oldest" ? [...dated].reverse() : dated;
  const { items: rows, total } = pageFiltered(ordered, n => itemAllowed(refOf(n), scope), q.page, LIBRARY_PAGE_SIZE);
  const form = <NewNoteForm materials={materials} initialMaterial={q.material} />;
  if (!rows.length) return <>{form}<Empty>{hasLibraryFilters(q) || q.from || q.to || q.page > 1 ? "No notes match these filters." : "No notes yet. Write one above, or add notes while you read a saved lesson."}</Empty></>;
  const [arts, sessions, chunks] = await Promise.all([
    artefactsByIds(admin, userId, rows.flatMap(n => (n.artefactId ? [n.artefactId] : []))),
    sessionsByIds(admin, userId, rows.flatMap(n => (n.sessionId ? [n.sessionId] : []))),
    chunksByIds(admin, userId, rows.flatMap(n => (n.chunkId ? [n.chunkId] : [])), false),
  ]);
  const artById = new Map((arts.ok ? arts.data : []).map(a => [a.id, a]));
  const sesById = new Map(sessions.map(s => [s.id, s]));
  const chunkById = new Map((chunks.ok ? chunks.data : []).map(c => [c.id, c]));
  return (
    <>
      {form}
      <p className="mt-3 text-[13px] text-gray-700" role="status">{total} note{total === 1 ? "" : "s"}{hasLibraryFilters(q) ? " match these filters" : ""}. Written by you, private to you.{r.data.next ? " Only your newest 1000 are read here." : ""}</p>
      <ul className="mt-2 space-y-3">
        {rows.map(n => {
          const art = n.artefactId ? artById.get(n.artefactId) : undefined, ses = n.sessionId ? sesById.get(n.sessionId) : undefined, ch = n.chunkId ? chunkById.get(n.chunkId) : undefined;
          const materialId = n.materialId ?? art?.materialId ?? ch?.materialId ?? null;
          const chunkId = n.chunkId ?? art?.sources[0] ?? null;
          const chunkIds = n.chunkId ? [n.chunkId] : savedLessonChunkIds(art?.sources);
          const unit = materialId ? names.get(materialId)?.unit ?? "page" : "page";
          const attached = noteAttachedTo({
            targetKind: n.targetKind, materialTitle: materialId ? titles.get(materialId) ?? null : null, lessonTitle: art ? lessonTitleOf(art.content) || null : null,
            sessionTitle: ses ? displaySessionTitle(ses.title) : null, step: n.step, location: ch ? locationLabel(ch, unit) : null,
          });
          const title = art ? lessonTitleOf(art.content) || "Saved lesson" : ses && n.step !== null ? `${displaySessionTitle(ses.title)} · Lesson ${n.step + 1}` : materialId ? titles.get(materialId) ?? "Your material" : "Your note";
          const open = art ? urlWithVersion(art.id) : ses && n.step !== null ? href(lessonHrefPath(ses.id, n.step)) : null;
          return (
            <li key={n.id}>
              <StandaloneNote note={toClient(n)} attached={attached}>
                <ActionLinks item={{ materialId, chunkId }} extra={open ? <Link href={open} className={actionCls}>{art ? "Open saved lesson" : "Open lesson"}</Link> : null} />
                {chunkIds.length > 0 && (
                  <AskAbout className="mt-1" surface="library" chunkIds={chunkIds} materialId={materialId} sessionId={ses?.id ?? null} step={ses ? n.step : null}
                    refLabel={`Your note: ${title}`} prefill={askPrefill("library", { title })} />
                )}
              </StandaloneNote>
            </li>
          );
        })}
      </ul>
      <SearchPager q={q} more={q.page * LIBRARY_PAGE_SIZE < total} />
    </>
  );
}

/**
 * CE-02: ONE SEARCH. Saved lessons, notes, questions and cards, and learning sessions (the 820 search), then "From your materials": the
 * learner's own uploaded sections, found by the same words (the first SECTION_FIRST, then SECTION_PAGE more at a time). The filters apply to
 * every group. With filters on, the best FILTERED_SEARCH_READ matches are read, filtered and paged here. Deterministic, private, no AI.
 */
async function SearchView({ admin, userId, q, v820, titles, names, topicRows, mode = "first", fixed = "" }: {
  admin: Admin; userId: string; q: LibraryQuery; v820: boolean; titles: Map<string, string>; names: Map<string, MaterialName>; topicRows: { chunkId: string; topics: string[] }[];
  /** first: as typed with the closed synonyms. corrected: the one-slip spelling fix (only when first found nothing). plain: as typed, when the fix found nothing too. */
  mode?: "first" | "corrected" | "plain"; fixed?: string;
}) {
  const words = mode === "corrected" ? fixed : q.q ?? "";
  const synonyms = mode !== "plain";
  const offset = (q.page - 1) * LIBRARY_PAGE_SIZE;
  const filtered = hasLibraryFilters(q);
  const kindLabel: Record<string, string> = { artefact: "Saved lesson", note: "Your note", lesson: "Learning session", flashcard: "Flashcard", card_note: "Your note on a flashcard" };
  const hitRef = (h: LibraryHit): ItemRef => refOf(h);
  let hits: LibraryHit[] = [], total = 0, unreadable = false, capped = false, scope: FilterScope | null = null;
  const arts = new Map<string, ArtefactRow>();

  if (!v820) {
    // Basic search (820 absent): the newest saved lessons only, matched by every word. Said so.
    const r = await listArtefacts(admin, userId, { limit: BASIC_SEARCH_ROWS });
    if (!r.ok) unreadable = true;
    else {
      const matches = basicMatches(r.data, q.q, a => a.content);
      for (const m of matches) arts.set(m.row.id, m.row);
      const all: LibraryHit[] = matches.map(m => ({ kind: "artefact", id: m.row.id, materialId: m.row.materialId, sessionId: null, step: null, artefactId: m.row.id, chunkId: null, label: m.row.action, headline: m.headline, rank: 0, createdAt: m.row.createdAt }));
      scope = await resolveFilterScope(admin, userId, q, topicRows, all.map(hitRef));
      const page = pageFiltered(all, h => itemAllowed(hitRef(h), scope!), q.page, LIBRARY_PAGE_SIZE);
      hits = page.items; total = page.total;
    }
  } else if (!filtered) {
    const r = await librarySearch(admin, userId, synonyms ? expandWebsearch(words) : words, LIBRARY_PAGE_SIZE, offset);
    if (!r.ok) unreadable = true; else { hits = r.data.rows; total = r.data.total; }
  } else {
    const pool: LibraryHit[] = [];
    let all = 0;
    for (let o = 0; o < FILTERED_SEARCH_READ; o += 50) {
      const r = await librarySearch(admin, userId, synonyms ? expandWebsearch(words) : words, 50, o);
      if (!r.ok) { unreadable = true; break; }
      pool.push(...r.data.rows); all = r.data.total;
      if (r.data.rows.length < 50 || pool.length >= all) break;
    }
    capped = all > pool.length;
    if (!unreadable) {
      scope = await resolveFilterScope(admin, userId, q, topicRows, pool.map(hitRef));
      const page = pageFiltered(pool, h => itemAllowed(hitRef(h), scope!), q.page, LIBRARY_PAGE_SIZE);
      hits = page.items; total = page.total;
    }
  }
  scope ??= await resolveFilterScope(admin, userId, q, topicRows, []);

  const [sessions, artRead] = await Promise.all([
    sessionsByIds(admin, userId, hits.flatMap(h => (h.sessionId ? [h.sessionId] : []))),
    artefactsByIds(admin, userId, hits.flatMap(h => (h.artefactId && !arts.has(h.artefactId) ? [h.artefactId] : []))),
  ]);
  const ses = new Map(sessions.map(s => [s.id, s]));
  for (const a of artRead.ok ? artRead.data : []) arts.set(a.id, a);

  // From your materials: the learner's own sections, ranked by the same words (no AI).
  const sectionWords = synonyms ? expandText(words) : words;
  const tsq = toTsQuery(sectionWords);
  const found = tsq ? await searchSectionRows(admin, userId, tsq, 200) : null;
  const sec = found?.ok ? sectionHits(rankChunks(sectionWords, found.data.rows, found.data.rows.length), sectionWords, names, scope, q.msec) : null;

  const target = (h: LibraryHit): string => {
    if (h.kind === "lesson") return href(`study/learn?session=${encodeURIComponent(h.id)}`);
    if (h.kind === "flashcard" || h.kind === "card_note") return href(cardHrefPath(h.label));
    if (h.sessionId && h.step !== null && ses.has(h.sessionId)) return href(lessonHrefPath(h.sessionId, h.step));
    if (h.kind === "artefact") return urlWithVersion(h.id);
    if (h.artefactId) return urlWithVersion(h.artefactId);
    if (h.materialId) return href(h.chunkId ? `study/${h.materialId}#c-${h.chunkId}` : `study/${h.materialId}`);
    // COMPETEN-NOTEBOOK-001: a free-standing note has no lesson or material. It opens in My Notebook.
    if (h.kind === "note") return href(`study/notebook/${encodeURIComponent(h.id)}`);
    return href("study/saved");
  };
  const title = (h: LibraryHit) => h.kind === "lesson" ? displaySessionTitle(h.label)
    : h.kind === "artefact" ? (h.sessionId && h.step !== null && ses.has(h.sessionId) ? `${displaySessionTitle(ses.get(h.sessionId)!.title)} · Lesson ${h.step + 1}` : LEARN_ACTION_LABEL[h.label as LearnAction] ?? "Saved lesson")
      : h.kind === "note" ? (h.label === "highlight" ? "Your highlight" : "Your note") : h.label.slice(0, 120);
  const groups = groupHits(hits);
  const secTotal = sec?.total ?? 0;
  const sectionsFailed = found !== null && !found.ok;
  const nothing = savedNothing({ unreadable, sectionsRead: found ? found.ok : null, hits: hits.length, sectionHits: sec?.hits.length ?? 0 });
  // Nothing found as typed: one slip of spelling against the learner's own topics and material titles, said plainly. Never for a filtered or basic search.
  if (nothing && mode === "first" && v820 && !filtered) {
    const fix = correctQuery(words, vocabularyOf([...topicRows.flatMap(t => t.topics), ...titles.values()]));
    if (fix.changed) return SearchView({ admin, userId, q, v820, titles, names, topicRows, mode: "corrected", fixed: fix.text });
  }
  if (nothing && mode === "corrected") return SearchView({ admin, userId, q, v820, titles, names, topicRows, mode: "plain" });
  return (
    <div className="mt-3">
      {!v820 && <p className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-700">Basic search: it looks for every word in your newest {BASIC_SEARCH_ROWS} saved lessons only. Notes and flashcards are not searched here yet. Your materials are searched below.</p>}
      {mode === "corrected" && <p className="mt-2 text-[14px] text-gray-800" role="status" data-testid="showing-results-for">Showing results for <span className="font-semibold">{fixed}</span>. You searched for “{q.q}”.</p>}
      <p className="mt-2 text-[13px] text-gray-700" role="status">
        {total + secTotal} result{total + secTotal === 1 ? "" : "s"} for “{q.q}”{filtered ? ", with your filters" : ""}: {total} in your library, {secTotal} in your materials. Best matches first. Private to you; no AI.
        {capped ? ` Filters apply to your best ${FILTERED_SEARCH_READ} library matches.` : ""}
      </p>
      {unreadable && <div className="mt-2"><Unreadable what="your saved lessons and notes" /></div>}
      {sectionsFailed && <div className="mt-2"><Unreadable what="the sections of your materials" /></div>}
      {nothing && <Empty>Nothing matches. Try fewer or other words, or OR between them{filtered ? ", or remove a filter" : ""}.</Empty>}
      {groups.map(g => (
        <section key={g.key} aria-labelledby={`grp-${g.key}`} className="mt-4">
          <h3 id={`grp-${g.key}`} className="text-[13px] font-bold uppercase tracking-[0.12em] text-gray-500">{g.label}</h3>
          <ul className="mt-2 space-y-2">
            {g.hits.map(h => {
              const art = h.artefactId ? arts.get(h.artefactId) : undefined;
              const materialId = h.materialId ?? art?.materialId ?? null;
              const chunkIds = h.chunkId ? [h.chunkId] : savedLessonChunkIds(art?.sources);
              const t = title(h);
              return (
                <li key={`${h.kind}-${h.id}`} className="cmp-learn-record rounded-2xl border border-[var(--learn-border)] bg-[var(--cmp-app-surface)] px-4 py-3">
                  <Link href={target(h)} className={linkCls}>{t}</Link>
                  <span className="ml-2 text-[12px] text-gray-600">{kindLabel[h.kind] ?? "Result"}{materialId ? ` · ${titles.get(materialId) ?? "Your material"}` : ""} · {ukDay(h.createdAt)}</span>
                  <Snippet headline={h.headline} />
                  {h.kind !== "lesson" && (
                    <>
                      <ActionLinks item={{ materialId, chunkId: chunkIds[0] ?? null }} />
                      {chunkIds.length > 0 && <AskAbout className="mt-1" surface="library" chunkIds={chunkIds} materialId={materialId} refLabel={`${kindLabel[h.kind] ?? "Result"}: ${t}`} prefill={askPrefill("library", { title: t })} />}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <SearchPager q={q} more={offset + LIBRARY_PAGE_SIZE < total} />
      {sec && sec.hits.length > 0 && (
        <section aria-labelledby="grp-materials" className="mt-6">
          <h3 id="grp-materials" className="text-[13px] font-bold uppercase tracking-[0.12em] text-gray-500">From your materials</h3>
          <p className="mt-1 text-[12.5px] text-gray-600">Sections of the files you uploaded, found by the same words. Showing {sec.hits.length} of {sec.total}.</p>
          <ul className="mt-2 space-y-2">
            {sec.hits.map(s => (
              <li key={s.chunkId} className="cmp-learn-sources rounded-2xl border border-[var(--learn-border)] bg-[var(--cmp-app-surface)] px-4 py-3">
                <p className="break-words text-[14px] font-semibold text-gray-900">{s.materialTitle} <span className="font-normal text-gray-600">· {s.location}</span></p>
                <Snippet headline={s.headline} />
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0 text-[13px]">
                  <Link href={href(s.openInLearn)} className={actionCls}>Open in Learn</Link>
                  {s.original && <a href={s.original.href} target="_blank" rel="noreferrer" className={actionCls}>{s.original.label}<span className="sr-only"> (opens in a new tab)</span></a>}
                  <Link href={href(s.sourceHref)} className={actionCls}>Open source</Link>
                  {itemActions({ materialId: s.materialId, chunkId: s.chunkId }).filter(a => a.key === "revise").map(a => <Link key={a.key} href={href(a.path)} className={actionCls}>{a.label}</Link>)}
                </p>
                <AskAbout className="mt-1" surface="library" chunkIds={[s.chunkId]} materialId={s.materialId} refLabel={`${s.materialTitle}, ${s.location}`} prefill={askPrefill("library", { title: `${s.materialTitle}, ${s.location}` })} />
              </li>
            ))}
          </ul>
          {sec.more && (
            <nav aria-label="More from your materials" className="mt-3">
              <Link href={urlWith(q, { page: q.page > 1 ? String(q.page) : null, msec: String(q.msec + 1) })} className={ghost}>More from your materials (next {SECTION_PAGE})</Link>
            </nav>
          )}
        </section>
      )}
    </div>
  );
}

function SearchPager({ q, more }: { q: LibraryQuery; more: boolean }) {
  if (!more && q.page <= 1) return null;
  return (
    <nav aria-label="Result pages" className="mt-4 flex flex-wrap gap-2">
      {q.page > 1 && <Link href={urlWith(q, { page: q.page > 2 ? String(q.page - 1) : null, msec: q.msec > 1 ? String(q.msec) : null })} className={ghost}>Previous {LIBRARY_PAGE_SIZE}</Link>}
      {more && <Link href={urlWith(q, { page: String(q.page + 1), msec: q.msec > 1 ? String(q.msec) : null })} className={ghost}>Next {LIBRARY_PAGE_SIZE}</Link>}
    </nav>
  );
}

async function VersionView({ admin, userId, id, titles, policy, notes, q }: { admin: Admin; userId: string; id: string; titles: Map<string, string>; policy: IndividualPolicy; notes: boolean; q: LibraryQuery }) {
  const versions = await artefactVersions(admin, userId, id);
  const back = <Link href={urlWith(q, {})} className={ghost}>Back to your library</Link>;
  if (!versions.length) return <div className="mt-3"><StatePanel title="That saved lesson could not be found" actions={back}><p>It may have been removed with its material.</p></StatePanel></div>;
  const c = await itemContext(admin, userId, versions, titles, policy, notes, false);
  const current = versions.find(v => !v.supersededAt) ?? null;
  return (
    <div className="mt-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">{back}
        {versions.length > 1 && <a href={`${EXPORT}?selected=${versions.map(v => v.id).join(",")}`} download className={ghost}>Download every version (PDF)</a>}
      </div>
      <p className="mb-2 text-[13px] text-gray-700">{versions.length === 1 ? "One version is kept." : `${versions.length} versions are kept. A refresh never overwrites the earlier teaching.`}</p>
      <ul className="space-y-3">
        {(current ? [current] : []).map(a => <ArtefactItem key={a.id} a={a} c={{ ...c, earlier: new Map() }} open />)}
      </ul>
      {versions.some(v => v.supersededAt) && (
        <section aria-labelledby="earlier-h" className="mt-4">
          <h3 id="earlier-h" className="text-[13px] font-bold uppercase tracking-[0.12em] text-gray-500">Earlier versions</h3>
          <ul className="mt-2 space-y-3">
            {versions.filter(v => v.supersededAt).map(a => <ArtefactItem key={a.id} a={a} c={{ ...c, earlier: new Map(), notesOn: false }} open={a.id === id} />)}
          </ul>
        </section>
      )}
    </div>
  );
}
