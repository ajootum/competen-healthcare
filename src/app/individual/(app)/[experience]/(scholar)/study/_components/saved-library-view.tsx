import Link from "next/link";
import type { ReactNode } from "react";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import {
  artefactIdsForChunks, artefactVersions, artefactsByIds, chunksForCompetency, earlierVersionCounts, libraryArtefactPage, librarySchema, librarySearch,
  librarySessionPage, lessonsForChunks, listArtefacts, listNotes, osceAttemptMaterials, practiceCounts, sectionTopicRows, sessionFurthest, sessionStepSummaries,
  sessionsByIds, type ArtefactRow, type LearningSessionRow, type NoteRow,
} from "@/lib/individual/scholar/store";
import {
  BASIC_SEARCH_ROWS, LESSON_LINK_LABEL, LIBRARY_PAGE_SIZE, LIBRARY_STATUSES, LIBRARY_VIEWS, PROVENANCE_LABEL, STATUS_LABEL, VIEW_LABEL,
  basicMatches, cardHrefPath, encodeCursor, lessonHrefPath, lessonLinkOf, lessonTitleOf, parseLibraryQuery, provenanceOf, rangeBounds, sectionsHrefPath,
  snippetParts, versionLabel, type Cursor, type LessonLink, type LibraryQuery, type LibraryStatus,
} from "@/lib/individual/scholar/saved-library";
import { coversLesson } from "@/lib/individual/scholar/learn-journey";
import { displaySessionTitle } from "@/lib/individual/scholar/learn-search";
import { referenceSource, relabelReferences } from "@/lib/individual/scholar/learn";
import { AI_LABEL, LEARN_ACTION_LABEL, SOURCE_KIND_LABEL, SUPPLEMENTARY_LABEL, type LearnAction } from "@/lib/individual/scholar/config";
import type { IndividualPolicy } from "@/lib/individual/policy";
import { StatePanel, Unreadable, focusRing } from "../../../../../_components/chrome";
import { sourceHref } from "./question-view";
import { AiFlagList, GovernedReferenceList } from "./learn-kinds";
import { LibraryNotes, type ClientNote } from "./library-notes-client";

// SCHOLAR-LIBRARY-01 (owner instruction 1 Nov 2026): THE PERSONAL LIBRARY on Saved learning. A server component: database
// reads only, keyed on the caller (store.ts), shaped by saved-library.ts. NO AI anywhere: opening a lesson from here is the
// Learn open path, which serves saved teaching without a model call. Private to the learner, never shared.

type Admin = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Params = Record<string, string | string[] | undefined>;
const href = (seg: string) => experienceHref("scholar", seg);
const EXPORT = "/api/individual/scholar/learn/export";
const ukDay = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); };
const pill = "inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[12px] font-semibold text-gray-700";
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[13.5px] font-semibold text-gray-800 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const linkCls = `font-semibold text-gray-900 underline underline-offset-2 ${focusRing}`;
const field = `mt-1 block w-full min-h-[40px] rounded-lg border border-gray-300 bg-white px-2 text-[13.5px] ${focusRing}`;

/** The page's URL with some params changed (null removes one). The cursor is dropped whenever anything else changes. */
function urlWith(q: LibraryQuery, change: Record<string, string | null>): string {
  const p = new URLSearchParams();
  const base: Record<string, string | null> = {
    view: q.view === "recent" ? null : q.view, material: q.material, topic: q.topic, competency: q.competency, from: q.from, to: q.to,
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

export async function SavedLibrary({ admin, userId, params, policy, materials, competencies, notesOn }: {
  admin: Admin; userId: string; params: Params; policy: IndividualPolicy; materials: { id: string; title: string }[];
  competencies: { id: string; title: string }[] | null; notesOn: boolean;
}) {
  const q = parseLibraryQuery(params);
  const v820 = await librarySchema(admin, userId);
  const notes = notesOn && v820;
  const titles = new Map(materials.map(m => [m.id, m.title]));
  const version = typeof params.version === "string" ? params.version : null;
  const topics = await sectionTopicRows(admin, userId);
  const topicList = topics.ok ? [...new Set(topics.data.flatMap(t => t.topics))].sort((a, b) => a.localeCompare(b)).slice(0, 300) : [];

  return (
    <section aria-labelledby="library-h" className="mt-2">
      <h2 id="library-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Your saved lessons</h2>
      <p className="mt-1 text-[13px] text-gray-600">{AI_LABEL}. Private to you and for your own study: never an assessment, never evidence of competence. Opening anything here uses no AI.</p>

      {/* SEARCH: deterministic and private (no AI). */}
      <form method="get" action={href("study/saved")} role="search" className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 basis-[16rem] text-[12.5px] font-semibold text-gray-800">Search your saved lessons, notes and flashcards
          <input type="search" name="q" defaultValue={q.q} maxLength={200} className={field} placeholder="for example: preload OR afterload" />
        </label>
        <button type="submit" className={ghost}>Search</button>
        {q.q && <Link href={urlWith(q, { q: null })} className={ghost}>Clear search</Link>}
      </form>

      {version ? await VersionView({ admin, userId, id: version, titles, policy, notes, q })
        : q.q ? await SearchView({ admin, userId, q, v820, titles })
          : (
            <>
              <nav aria-label="Library views" className="mt-4 flex flex-wrap gap-2">
                {LIBRARY_VIEWS.map(v => (
                  <Link key={v} href={urlWith(q, { view: v === "recent" ? null : v })} aria-current={q.view === v ? "page" : undefined}
                    className={`inline-flex min-h-[40px] items-center rounded-full border px-3.5 text-[13px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${q.view === v ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"}`}
                    style={q.view === v ? { background: SCHOLAR.accent, borderColor: SCHOLAR.accent } : undefined}>{VIEW_LABEL[v]}</Link>
                ))}
              </nav>
              <Filters q={q} materials={materials} topics={topicList} competencies={competencies} statuses={v820 ? LIBRARY_STATUSES : ["any"]} />
              {q.view === "recent" ? await RecentView({ admin, userId, q, titles, policy, notes, topicRows: topics.ok ? topics.data : [] })
                : q.view === "revision" ? await RevisionView({ admin, userId, q, titles, notes, v820 })
                  : await SessionView({ admin, userId, q, status: q.view === "continue" ? "active" : "completed" })}
            </>
          )}
    </section>
  );
}

function Filters({ q, materials, topics, competencies, statuses }: { q: LibraryQuery; materials: { id: string; title: string }[]; topics: string[]; competencies: { id: string; title: string }[] | null; statuses: readonly LibraryStatus[] }) {
  const sessions = q.view === "continue" || q.view === "completed";
  return (
    <form method="get" action={href("study/saved")} className="mt-3 rounded-2xl border border-gray-200 bg-white p-3">
      {q.view !== "recent" && <input type="hidden" name="view" value={q.view} />}
      <fieldset>
        <legend className="text-[12px] font-bold uppercase tracking-[0.1em] text-gray-500">Filter and sort</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {!sessions && (
            <>
              <label className="text-[12.5px] font-semibold text-gray-800">Subject or material
                <select name="material" defaultValue={q.material ?? ""} className={field}><option value="">All materials</option>{materials.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
              </label>
              <label className="text-[12.5px] font-semibold text-gray-800">Topic
                <select name="topic" defaultValue={q.topic ?? ""} className={field}><option value="">All topics</option>{topics.map(t => <option key={t} value={t}>{t}</option>)}</select>
              </label>
              <label className="text-[12.5px] font-semibold text-gray-800">Competency
                <select name="competency" defaultValue={q.competency ?? ""} className={field} disabled={!competencies?.length}>
                  <option value="">{competencies?.length ? "All competencies" : "No programme chosen"}</option>{(competencies ?? []).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </label>
              <label className="text-[12.5px] font-semibold text-gray-800">Status
                <select name="status" defaultValue={q.status} className={field}>{statuses.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
              </label>
            </>
          )}
          <label className="text-[12.5px] font-semibold text-gray-800">From<input type="date" name="from" defaultValue={q.from ?? ""} className={field} /></label>
          <label className="text-[12.5px] font-semibold text-gray-800">To<input type="date" name="to" defaultValue={q.to ?? ""} className={field} /></label>
          <label className="text-[12.5px] font-semibold text-gray-800">Sort
            <select name="sort" defaultValue={q.sort} className={field}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>
          </label>
        </div>
        {sessions && <p className="mt-2 text-[12px] text-gray-600">Material, topic, competency and status filters apply to saved lessons. Sessions filter by when you last studied them.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="submit" className={ghost}>Apply</button>
          <Link href={urlWith({ ...q, material: null, topic: null, competency: null, from: null, to: null, status: "any", sort: "newest" }, {})} className={ghost}>Clear filters</Link>
        </div>
      </fieldset>
    </form>
  );
}

/** Which artefacts the topic, competency and status filters allow (null: no such filter). Intersected, never guessed. */
async function filterIds(admin: Admin, userId: string, q: LibraryQuery, topicRows: { chunkId: string; topics: string[] }[]): Promise<string[] | null> {
  const sets: Set<string>[] = [];
  if (q.topic) {
    const want = q.topic.toLowerCase();
    sets.push(new Set(await artefactIdsForChunks(admin, userId, topicRows.filter(r => r.topics.some(t => t.toLowerCase() === want)).map(r => r.chunkId)) ?? []));
  }
  if (q.competency) sets.push(new Set(await artefactIdsForChunks(admin, userId, await chunksForCompetency(admin, userId, q.competency)) ?? []));
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
const toClient = (n: NoteRow): ClientNote => ({ id: n.id, kind: n.kind, body: n.body, quote: n.quote, createdAt: n.createdAt, step: n.step, artefactId: n.artefactId });

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
  return (
    <li className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start gap-3">
        {c.selectable && <input type="checkbox" name="selected" value={a.id} aria-label={`Choose ${itemTitle(a, c)} to download`} className="mt-1 h-5 w-5 shrink-0" />}
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
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            <Link href={href(live ? lessonHrefPath(live.sessionId, live.step) : sectionsHrefPath(a.sources))} className={linkCls}>Review saved lesson</Link>
            {counts.cards > 0 && <Link href={href("study/revise/flashcards?view=cards")} className={linkCls}>Flashcards on these sections ({counts.cards})</Link>}
            {counts.questions + counts.attempts > 0 && <Link href={href("study/revise")} className={linkCls}>Practice: {counts.questions} question{counts.questions === 1 ? "" : "s"}, {counts.attempts} attempt{counts.attempts === 1 ? "" : "s"}</Link>}
            {c.osce.has(a.materialId) && <Link href={href("study/apply/osce")} className={linkCls}>OSCE practice gaps</Link>}
            {live && <Link href={href(`study/learn?session=${encodeURIComponent(live.sessionId)}`)} className={linkCls}>Open its session</Link>}
            <a href={`${EXPORT}?selected=${a.id}`} download className={linkCls}>Download (PDF)</a>
          </p>
          <details className="mt-2 rounded-xl border border-gray-200" open={open}>
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
    <form method="get" action={EXPORT} className="mt-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="submit" className={ghost}>Download chosen lessons (PDF, up to 100)</button>
        {whole && <a href={`${EXPORT}${whole}`} download className={ghost}>Download everything this filter shows (PDF)</a>}
      </div>
      <ul className="space-y-3">{rows.map(a => <ArtefactItem key={a.id} a={a} c={c} />)}</ul>
      <Pager q={q} next={page.data.next} prevFirst={!!q.cursor} />
    </form>
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
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-gray-200 bg-white px-4 py-3">
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

async function RevisionView({ admin, userId, q, titles, notes, v820 }: { admin: Admin; userId: string; q: LibraryQuery; titles: Map<string, string>; notes: boolean; v820: boolean }) {
  if (!v820 || !notes) return <Empty>Bookmarks are not available here yet.</Empty>;
  const marks = await listNotes(admin, userId, { kinds: ["bookmark"], cursor: q.cursor, limit: LIBRARY_PAGE_SIZE });
  if (!marks.ok) return <div className="mt-3"><Unreadable what="your bookmarks" /></div>;
  const rows = marks.data.rows;
  if (!rows.length) return <Empty>{q.cursor ? "No more bookmarks." : "Nothing bookmarked yet. Choose Bookmark for revision on a lesson or a saved lesson."}</Empty>;
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
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-gray-200 bg-white px-4 py-3">
              <span className="min-w-0 flex-1 basis-[14rem]">
                <span className="block break-words text-[14.5px] font-semibold text-gray-900">{title}</span>
                <span className="block text-[12.5px] text-gray-600">Bookmarked {ukDay(r.createdAt)}{a ? ` · ${titles.get(a.materialId) ?? "Your material"}` : ""}</span>
              </span>
              {to ? <Link href={to} className={ghost}>Open</Link> : <span className="text-[12.5px] text-gray-600">No longer available</span>}
            </li>
          );
        })}
      </ul>
      <Pager q={q} next={marks.data.next} prevFirst={!!q.cursor} />
    </>
  );
}

async function SearchView({ admin, userId, q, v820, titles }: { admin: Admin; userId: string; q: LibraryQuery; v820: boolean; titles: Map<string, string> }) {
  const offset = (q.page - 1) * LIBRARY_PAGE_SIZE;
  const kindLabel: Record<string, string> = { artefact: "Saved lesson", note: "Your note", lesson: "Learning session", flashcard: "Flashcard", card_note: "Your note on a flashcard" };
  if (!v820) {
    // Basic search (820 absent): the newest saved lessons only, matched by every word. Said so.
    const r = await listArtefacts(admin, userId, { limit: BASIC_SEARCH_ROWS });
    if (!r.ok) return <div className="mt-3"><Unreadable what="your saved lessons" /></div>;
    const hits = basicMatches(r.data, q.q, a => a.content);
    const shown = hits.slice(offset, offset + LIBRARY_PAGE_SIZE);
    return (
      <div className="mt-3">
        <p className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-700">Basic search: it looks for every word in your newest {BASIC_SEARCH_ROWS} saved lessons only. Notes and flashcards are not searched here yet.</p>
        <p className="mt-2 text-[13px] text-gray-700" role="status">{hits.length} result{hits.length === 1 ? "" : "s"}</p>
        <ul className="mt-2 space-y-2">{shown.map(h => (
          <li key={h.row.id} className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
            <Link href={urlWithVersion(h.row.id)} className={linkCls}>{lessonTitleOf(h.row.content) || "Saved lesson"}</Link>
            <span className="ml-2 text-[12px] text-gray-600">{kindLabel.artefact} · {titles.get(h.row.materialId) ?? "Your material"} · {ukDay(h.row.createdAt)}</span>
            <Snippet headline={h.headline} />
          </li>
        ))}</ul>
        <SearchPager q={q} more={offset + LIBRARY_PAGE_SIZE < hits.length} />
      </div>
    );
  }
  const r = await librarySearch(admin, userId, q.q, LIBRARY_PAGE_SIZE, offset);
  if (!r.ok) return <div className="mt-3"><Unreadable what="your search" /></div>;
  const sessions = new Map((await sessionsByIds(admin, userId, r.data.rows.flatMap(h => (h.sessionId ? [h.sessionId] : [])))).map(s => [s.id, s]));
  const target = (h: (typeof r.data.rows)[number]): string => {
    if (h.kind === "lesson") return href(`study/learn?session=${encodeURIComponent(h.id)}`);
    if (h.kind === "flashcard" || h.kind === "card_note") return href(cardHrefPath(h.label));
    if (h.sessionId && h.step !== null && sessions.has(h.sessionId)) return href(lessonHrefPath(h.sessionId, h.step));
    if (h.kind === "artefact") return urlWithVersion(h.id);
    if (h.artefactId) return urlWithVersion(h.artefactId);
    if (h.materialId) return href(h.chunkId ? `study/${h.materialId}#c-${h.chunkId}` : `study/${h.materialId}`);
    return href("study/saved");
  };
  const title = (h: (typeof r.data.rows)[number]) => h.kind === "lesson" ? displaySessionTitle(h.label)
    : h.kind === "artefact" ? (h.sessionId && h.step !== null && sessions.has(h.sessionId) ? `${displaySessionTitle(sessions.get(h.sessionId)!.title)} · Lesson ${h.step + 1}` : LEARN_ACTION_LABEL[h.label as LearnAction] ?? "Saved lesson")
      : h.kind === "note" ? (h.label === "highlight" ? "Your highlight" : "Your note") : h.label.slice(0, 120);
  return (
    <div className="mt-3">
      <p className="text-[13px] text-gray-700" role="status">{r.data.total} result{r.data.total === 1 ? "" : "s"} for “{q.q}”, best matches first. Private to you; no AI.</p>
      {r.data.rows.length === 0 ? <Empty>Nothing matches. Try fewer or other words, or OR between them.</Empty> : (
        <ul className="mt-2 space-y-2">{r.data.rows.map(h => (
          <li key={`${h.kind}-${h.id}`} className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
            <Link href={target(h)} className={linkCls}>{title(h)}</Link>
            <span className="ml-2 text-[12px] text-gray-600">{kindLabel[h.kind] ?? "Result"}{h.materialId ? ` · ${titles.get(h.materialId) ?? "Your material"}` : ""} · {ukDay(h.createdAt)}</span>
            <Snippet headline={h.headline} />
          </li>
        ))}</ul>
      )}
      <SearchPager q={q} more={offset + LIBRARY_PAGE_SIZE < r.data.total} />
    </div>
  );
}

function SearchPager({ q, more }: { q: LibraryQuery; more: boolean }) {
  if (!more && q.page <= 1) return null;
  return (
    <nav aria-label="Result pages" className="mt-4 flex flex-wrap gap-2">
      {q.page > 1 && <Link href={urlWith(q, { page: q.page > 2 ? String(q.page - 1) : null })} className={ghost}>Previous {LIBRARY_PAGE_SIZE}</Link>}
      {more && <Link href={urlWith(q, { page: String(q.page + 1) })} className={ghost}>Next {LIBRARY_PAGE_SIZE}</Link>}
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
