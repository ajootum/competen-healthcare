import Link from "next/link";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import {
  PAGE_SIZE, SEARCH_TABS, SEARCH_TAB_LABEL, shortDate,
  type CompetencyRef, type DocumentHit, type SearchParams, type SearchResult, type SearchTab, type SectionHit, type SessionHit, type TopicHit,
} from "@/lib/individual/scholar/learn-search";
import { MAX_SCOPE_MATERIALS } from "@/lib/individual/scholar/learn";
import { BookmarkedTopics, SelectionBar, TopicTools } from "./learn-search-client";

// SCH-LEARN-UX-01: the search-first, topic-centred Learn page (owner s3-s5, s10). Server-rendered: one page of each
// list, exact counts, links for tabs and pages. The order on the landing is the owner's -- search, Continue Learning,
// My Topics, Recently Added. Library manages documents; this page discovers topics and learning, and links there.

const accent = SCHOLAR.accent;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const card = "rounded-2xl border border-gray-200 bg-white p-5";
const h2 = "text-[16px] font-bold text-gray-900";
const link = `font-semibold underline-offset-2 hover:underline ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 ${focusRing}`;
const primary = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 ${focusRing}`;
const chip = "inline-block rounded-full bg-[var(--cmp-theme-soft)] px-2.5 py-0.5 text-[11.5px] font-semibold text-[var(--cmp-theme-ink)]";
const governedChip = "inline-block rounded-full border border-gray-300 bg-white px-2.5 py-0.5 text-[11.5px] font-semibold text-gray-700";

export const LEARN = experienceHref("scholar", "study/learn");
export const learnHref = (q: Record<string, string | number | null | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== null && v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `${LEARN}?${s}` : LEARN;
};
const topicView = (name: string) => learnHref({ topicView: name });
// SCHOLAR-SESSION-AI-02 slice B: "Study this" starts (or reopens) a connected study session on the same scope through
// the same Learn start (?study=new), shown only where study sessions are on. Without it this page is unchanged.
const studyLink = `${link} inline-flex min-h-[44px] items-center text-[13.5px]`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The universal search (owner s3): "Search my library" is the default and uses no AI; "Teach me this topic" starts Learn. */
export function LearnSearchBox({ q = "", studyOn = false }: { q?: string; studyOn?: boolean }) {
  return (
    <section aria-labelledby="learn-search-h" className={`${card} mb-5`}>
      <form action={LEARN} method="get" role="search">
        <h2 id="learn-search-h" className="text-[19px] font-bold tracking-tight text-gray-900">What would you like to learn today?</h2>
        <label htmlFor="learn-q" className="sr-only">Search your notes, topics, clinical concepts or ask Scholar a question</label>
        <input id="learn-q" name="q" type="search" defaultValue={q} maxLength={200} autoComplete="off"
          placeholder="Search your notes, topics, clinical concepts or ask Scholar a question..."
          className={`mt-3 block min-h-[48px] w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-[15px] text-gray-900 ${focusRing}`} />
        <div className="mt-3 flex flex-wrap gap-2.5">
          <button type="submit" className={primary} style={{ background: accent }}>Search my library</button>
          <button type="submit" name="teach" value="1" className={ghost}>Teach me this topic</button>
          {studyOn && <button type="submit" name="study" value="new" className={ghost}>Study this topic</button>}
        </div>
        <p className="mt-2 text-[12.5px] text-gray-500">Searching uses no AI and works even when AI help is off or your allowance is used up. Teach me starts a lesson from your own notes.</p>
      </form>
    </section>
  );
}

function sessionStatus(s: SessionHit): string {
  if (s.status === "completed") return "Completed";
  return s.steps > 0 ? `In progress · step ${Math.min(s.currentStep + 1, s.steps)} of ${s.steps}` : "In progress";
}

function SessionCard({ s }: { s: SessionHit }) {
  return (
    <li className="flex flex-col rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="text-[14.5px] font-bold leading-snug text-gray-900">{s.title}</h3>
      <dl className="mt-1.5 space-y-0.5 text-[12.5px] text-gray-600">
        {s.topic && <div><dt className="inline font-semibold">Topic: </dt><dd className="inline">{s.topic}</dd></div>}
        <div><dt className="inline font-semibold">{s.sources.length === 1 ? "Source" : "Sources"}: </dt><dd className="inline">{s.sources.length ? s.sources.slice(0, 2).join(", ") + (s.sources.length > 2 ? ` and ${s.sources.length - 2} more` : "") : "Not recorded"}</dd></div>
        <div><dt className="inline font-semibold">Last activity: </dt><dd className="inline">{shortDate(s.lastActiveAt, true)}</dd></div>
      </dl>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className={chip}>{sessionStatus(s)}</span>
        <Link href={learnHref({ session: s.id })} className={`${link} inline-flex min-h-[44px] items-center text-[14px]`} style={{ color: accent }}>
          {s.status === "completed" ? "Review" : "Continue"}<span className="sr-only"> {s.title}</span> →
        </Link>
      </div>
    </li>
  );
}

/** Continue Learning (owner s3): the three most recent sessions, then "View all learning sessions". */
export function ContinueLearning({ sessions, total, study = null }: { sessions: SessionHit[] | null; total: number | null; study?: { title: string; space: string; href: string } | null }) {
  return (
    <section aria-labelledby="continue-h" className={`${card} mb-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="continue-h" className={h2}>Continue learning</h2>
        {sessions && (total ?? 0) > 0 && <Link href={learnHref({ tab: "sessions" })} className={`${link} text-[13.5px]`} style={{ color: accent }}>View all learning sessions{total ? ` (${total})` : ""}</Link>}
      </div>
      {/* SCHOLAR-SESSION-AI-02: the open study session first, reopened in the stage it was last in. */}
      {study && (
        <p className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--cmp-theme-border)] bg-[var(--cmp-theme-soft)] px-4 py-2.5 text-[13.5px] text-gray-800">
          <span className="min-w-0"><span className="font-semibold">Your study session: </span>{study.title}<span className="text-gray-600"> · last in {study.space}</span></span>
          <Link href={study.href} className={studyLink} style={{ color: accent }}>Continue your study session →</Link>
        </p>
      )}
      {sessions === null ? <p className="mt-2 text-[13.5px] text-gray-600">Learning history is not available here, so sessions cannot be resumed.</p>
        : sessions.length === 0 ? <p className="mt-2 text-[13.5px] text-gray-600">No sessions yet. Search above, choose a topic below, or start from a document.</p>
          : <ul className="mt-3 grid gap-3 md:grid-cols-3">{sessions.map(s => <SessionCard key={s.id} s={s} />)}</ul>}
    </section>
  );
}

/** My Topics (owner s3): subjects (the student's own collections), then topics, then how many sections and documents. */
export function MyTopics({ groups, total }: { groups: { subject: string | null; topics: TopicHit[] }[] | null; total: number }) {
  return (
    <section aria-labelledby="topics-h" className={`${card} mb-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="topics-h" className={h2}>My topics</h2>
        {total > 0 && <Link href={learnHref({ tab: "topics" })} className={`${link} text-[13.5px]`} style={{ color: accent }}>View all topics ({total})</Link>}
      </div>
      <p className="mt-0.5 text-[12.5px] text-gray-500">Topics Scholar found in your notes, with your own corrections. They are yours to rename or bookmark; they are not competencies.</p>
      <div className="mt-3"><BookmarkedTopics /></div>
      {groups === null ? <p className="text-[13.5px] text-gray-600">Your topics could not be read just now.</p>
        : groups.length === 0 ? <p className="text-[13.5px] text-gray-600">No topics yet. Open a document in your Library and find its topics, with AI help on, and they will appear here.</p>
          : (
            <div className="space-y-4">
              {groups.map(g => (
                <div key={g.subject ?? "-"}>
                  {groups.length > 1 && <h3 className="mb-1.5 text-[12px] font-extrabold uppercase tracking-[0.14em] text-gray-500">{g.subject ?? "Not in a collection"}</h3>}
                  <ul className="flex flex-wrap gap-2">
                    {g.topics.map(t => (
                      <li key={t.name}>
                        <Link href={topicView(t.name)} className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-gray-800 hover:border-[var(--cmp-theme-border)] hover:bg-[var(--cmp-theme-soft)] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
                          {t.name}<span className="text-[11.5px] font-normal text-gray-500">{plural(t.documents, "doc")}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
    </section>
  );
}

export type RecentDoc = DocumentHit & { status: string };

/** Recently Added (owner s3): a few documents, then the Library, which manages them. */
export function RecentlyAdded({ docs, studyOn = false }: { docs: RecentDoc[] | null; studyOn?: boolean }) {
  return (
    <section aria-labelledby="recent-h" className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="recent-h" className={h2}>Recently added</h2>
        <Link href={experienceHref("scholar", "study")} className={`${link} text-[13.5px]`} style={{ color: accent }}>Open your Library</Link>
      </div>
      {docs === null ? <p className="mt-2 text-[13.5px] text-gray-600">Your materials could not be read just now.</p>
        : docs.length === 0 ? <p className="mt-2 text-[13.5px] text-gray-600">Nothing uploaded yet. Upload your notes in the Library to start.</p>
          : (
            <ul className="mt-2 divide-y divide-gray-200">
              {docs.map(d => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[14.5px] font-semibold text-gray-900">{d.title}</span>
                    <span className="text-[12.5px] text-gray-600">{[d.format, `added ${shortDate(d.addedAt)}`, d.status, d.topics[0] ? `topic: ${d.topics[0]}` : null].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-4">
                    {studyOn && <Link href={learnHref({ material: d.id, study: "new" })} className={studyLink} style={{ color: accent }}>Study this<span className="sr-only"> {d.title}</span></Link>}
                    <Link href={learnHref({ material: d.id })} className={`${link} inline-flex min-h-[44px] items-center text-[13.5px]`} style={{ color: accent }}>Learn from it<span className="sr-only"> {d.title}</span> →</Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
    </section>
  );
}

// ── RESULTS (owner s4, s5) ──────────────────────────────────────────────────────────────────────────────────

function Pager({ p, total, base }: { p: SearchParams; total: number; base: Record<string, string | number | null> }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
      {p.page > 1 ? <Link href={learnHref({ ...base, page: p.page - 1 })} className={ghost} rel="prev">← Previous</Link> : <span />}
      <span className="text-gray-600">Page {Math.min(p.page, pages)} of {pages}</span>
      {p.page < pages ? <Link href={learnHref({ ...base, page: p.page + 1 })} className={ghost} rel="next">Next →</Link> : <span />}
    </nav>
  );
}

function Check({ name, value, label }: { name: "m" | "s" | "t"; value: string; label: string }) {
  return <input type="checkbox" name={name} value={value} data-source aria-label={`Select ${label}`} className={`mt-1 h-5 w-5 shrink-0 accent-[var(--cmp-theme-accent)] ${focusRing}`} />;
}

function Competencies({ list }: { list: CompetencyRef[] }) {
  if (!list.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {list.map(c => <span key={c.id} className={governedChip}>Competency{c.accepted ? "" : " (suggested)"}: {c.code ? `${c.code} ` : ""}{c.title}</span>)}
    </span>
  );
}

function TopicRow({ t, select }: { t: TopicHit; select: boolean }) {
  return (
    <li className="flex items-start gap-3 py-3">
      {select && <Check name="t" value={t.name} label={t.name} />}
      <span className="min-w-0 flex-1">
        <Link href={topicView(t.name)} className={`${link} text-[14.5px] text-gray-900`}>{t.name}</Link>
        <span className="block text-[12.5px] text-gray-600">{[plural(t.sections, "section"), plural(t.documents, "document"), t.subject].filter(Boolean).join(" · ")}</span>
      </span>
      <Link href={learnHref({ t: t.name })} className={`${link} inline-flex min-h-[44px] items-center text-[13.5px]`} style={{ color: accent }}>Teach me<span className="sr-only"> {t.name}</span></Link>
    </li>
  );
}

function DocumentRow({ d, select }: { d: DocumentHit; select: boolean }) {
  return (
    <li className="flex items-start gap-3 py-3">
      {select && <Check name="m" value={d.id} label={d.title} />}
      <span className="min-w-0 flex-1">
        <Link href={experienceHref("scholar", `study/${d.id}`)} className={`${link} text-[14.5px] text-gray-900`}>{d.title}</Link>
        <span className="block text-[12.5px] text-gray-600">{[d.format, plural(d.sections, "section"), `added ${shortDate(d.addedAt)}`, d.subject].filter(Boolean).join(" · ")}</span>
        <span className="block truncate text-[12px] text-gray-500">File: {d.fileName}</span>
        {d.topics.length > 0 && <span className="mt-1 flex flex-wrap gap-1.5">{d.topics.map(t => <span key={t} className={chip}>{t}</span>)}</span>}
      </span>
      <Link href={learnHref({ material: d.id })} className={`${link} inline-flex min-h-[44px] items-center text-[13.5px]`} style={{ color: accent }}>Teach me<span className="sr-only"> from {d.title}</span></Link>
    </li>
  );
}

function SectionRow({ s, select }: { s: SectionHit; select: boolean }) {
  return (
    <li className="flex items-start gap-3 py-3">
      {select && <Check name="s" value={s.chunkId} label={`${s.materialTitle}, ${s.location}`} />}
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-gray-900">{s.materialTitle}, {s.location}</span>
        <span className="mt-0.5 block text-[13.5px] text-gray-700">{s.extract}</span>
        {s.topics.length > 0 && <span className="mt-1 flex flex-wrap gap-1.5">{s.topics.map(t => <span key={t} className={chip}>{t}</span>)}</span>}
        <Competencies list={s.competencies} />
      </span>
      <Link href={learnHref({ section: s.chunkId })} className={`${link} inline-flex min-h-[44px] items-center text-[13.5px]`} style={{ color: accent }}>Teach me<span className="sr-only"> this section</span></Link>
    </li>
  );
}

function SessionRow({ s }: { s: SessionHit }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="min-w-0 flex-1">
        <Link href={learnHref({ session: s.id })} className={`${link} text-[14.5px] text-gray-900`}>{s.title}</Link>
        <span className="block text-[12.5px] text-gray-600">{[sessionStatus(s), s.topic ? `topic: ${s.topic}` : null, s.sources.length ? `${s.sources.length === 1 ? "source" : "sources"}: ${s.sources.slice(0, 2).join(", ")}${s.sources.length > 2 ? "…" : ""}` : null, `last ${shortDate(s.lastActiveAt, true)}`].filter(Boolean).join(" · ")}</span>
      </span>
    </li>
  );
}

const FORM_ID = "learn-select";

/** The results: tabs with exact counts, one page, multi-select into Teach Me. */
export function SearchResults({ r }: { r: SearchResult }) {
  const p = r.params;
  const base = { q: p.q, tab: p.tab, sort: p.tab === "all" ? null : p.sort, type: p.type, within: p.within, subject: p.subject };
  const count = (t: SearchTab) => t === "all" ? null : r.counts[t];
  const empty = SEARCH_TABS.filter(t => t !== "all").every(t => (r.counts[t as Exclude<SearchTab, "all">] ?? 0) === 0) && !(r.competencies?.length);
  const head = (t: Exclude<SearchTab, "all">, label: string) => (
    <div className="mb-1 flex items-baseline justify-between gap-2">
      <h3 className="text-[13px] font-extrabold uppercase tracking-[0.12em] text-gray-500">{label}</h3>
      {p.tab === "all" && (r.counts[t] ?? 0) > 3 && <Link href={learnHref({ ...base, tab: t, page: null })} className={`${link} text-[13px]`} style={{ color: accent }}>See all {r.counts[t]}</Link>}
    </div>
  );
  const selectable = p.tab !== "sessions";
  return (
    <section aria-labelledby="results-h" className="mb-5">
      <h2 id="results-h" className="sr-only">Results</h2>
      <nav aria-label="Result types" className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1">
        {SEARCH_TABS.map(t => {
          const n = count(t);
          const on = p.tab === t;
          return (
            <Link key={t} href={learnHref({ ...base, tab: t, page: null, sort: null })} aria-current={on ? "page" : undefined}
              className={`inline-flex min-h-[44px] shrink-0 items-center rounded-xl px-3.5 text-[13.5px] font-semibold ${on ? "bg-[var(--cmp-theme-soft)] text-[var(--cmp-theme-ink)]" : "text-gray-700 hover:bg-gray-100"} ${focusRing}`}>
              {SEARCH_TAB_LABEL[t]}{t !== "all" && !(t === "sections" && !p.q) && <span className="ml-1.5 text-[12px] font-normal">({n === null ? "–" : n})</span>}
            </Link>
          );
        })}
      </nav>

      {p.tab !== "all" && <Filters p={p} subjects={r.subjects} />}

      <form id={FORM_ID} action={LEARN} method="get" className={card}>
        {p.q && <input type="hidden" name="about" value={p.q.slice(0, 120)} />}
        {empty ? (
          <p className="text-[14px] text-gray-700">{p.q ? <>Nothing in your library matches “{p.q}”. Try other words, or <Link href={learnHref({ q: p.q, teach: 1 })} className={link} style={{ color: accent }}>ask Scholar to teach you this topic</Link> from your notes.</> : "Nothing here yet."}</p>
        ) : (
          <div className="space-y-5">
            {(p.tab === "all" || p.tab === "topics") && r.topics && (r.topics.items.length > 0 || p.tab === "topics") && (
              <div>{p.tab === "all" && head("topics", "Topics")}
                {r.topics.items.length ? <ul className="divide-y divide-gray-200">{r.topics.items.map(t => <TopicRow key={t.name} t={t} select />)}</ul> : <p className="text-[13.5px] text-gray-600">No topics match.</p>}
                {r.competencies && r.competencies.length > 0 && (
                  <div className="mt-3">
                    <h4 className="text-[12.5px] font-semibold text-gray-700">Competencies your notes are linked to</h4>
                    <ul className="mt-1 divide-y divide-gray-200">
                      {r.competencies.map(c => (
                        <li key={c.id} className="flex items-start justify-between gap-3 py-2.5">
                          <span className="min-w-0"><span className={governedChip}>{c.accepted ? "Competency" : "Competency (suggested)"}</span> <span className="text-[14px] font-semibold text-gray-900">{c.code ? `${c.code} ` : ""}{c.title}</span>
                            <span className="block text-[12.5px] text-gray-600">{plural(c.sections, "linked section")}</span></span>
                          <Link href={learnHref({ competency: c.id })} className={`${link} inline-flex min-h-[44px] items-center text-[13.5px]`} style={{ color: accent }}>Teach me<span className="sr-only"> {c.title}</span></Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {r.counts.topics === null && (p.tab === "all" || p.tab === "topics") && <p className="text-[13.5px] text-gray-600">Your topics could not be read just now.</p>}
            {(p.tab === "all" || p.tab === "documents") && r.documents && (r.documents.items.length > 0 || p.tab === "documents") && (
              <div>{p.tab === "all" && head("documents", "Documents")}
                {r.documents.items.length ? <ul className="divide-y divide-gray-200">{r.documents.items.map(d => <DocumentRow key={d.id} d={d} select />)}</ul> : <p className="text-[13.5px] text-gray-600">No documents match.</p>}
              </div>
            )}
            {(p.tab === "all" || p.tab === "sections") && (
              r.counts.sections === null ? <p className="text-[13.5px] text-gray-600">Your notes could not be searched just now.</p>
                : !p.q && p.tab === "sections" ? <p className="text-[13.5px] text-gray-600">Type what you are looking for to search inside your notes.</p>
                  : r.sections && (r.sections.items.length > 0 || p.tab === "sections") && (
                    <div>{p.tab === "all" && head("sections", "Sections")}
                      {r.sections.items.length ? <ul className="divide-y divide-gray-200">{r.sections.items.map(s => <SectionRow key={s.chunkId} s={s} select />)}</ul> : <p className="text-[13.5px] text-gray-600">No sections match.</p>}
                      {p.tab === "sections" && r.sections.matched > r.sections.total && <p className="mt-2 text-[12.5px] text-gray-500">{r.sections.matched} sections match; the {r.sections.total} most relevant are listed. Add words to narrow it.</p>}
                    </div>
                  )
            )}
            {(p.tab === "all" || p.tab === "sessions") && (
              r.counts.sessions === null ? <p className="text-[13.5px] text-gray-600">Learning history could not be read here.</p>
                : r.sessions && (r.sessions.items.length > 0 || p.tab === "sessions") && (
                  <div>{p.tab === "all" && head("sessions", "Learning sessions")}
                    {r.sessions.items.length ? <ul className="divide-y divide-gray-200">{r.sessions.items.map(s => <SessionRow key={s.id} s={s} />)}</ul> : <p className="text-[13.5px] text-gray-600">No learning sessions match.</p>}
                  </div>
                )
            )}
          </div>
        )}
        {p.tab !== "all" && (
          <Pager p={p} base={base} total={p.tab === "topics" ? r.topics?.total ?? 0 : p.tab === "documents" ? r.documents?.total ?? 0 : p.tab === "sections" ? r.sections?.total ?? 0 : r.sessions?.total ?? 0} />
        )}
      </form>
      {selectable && !empty && <SelectionBar formId={FORM_ID} max={MAX_SCOPE_MATERIALS} />}
    </section>
  );
}

function Filters({ p, subjects }: { p: SearchParams; subjects: { id: string; name: string }[] }) {
  const sel = `min-h-[44px] rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-[13.5px] ${focusRing}`;
  const docs = p.tab === "documents" || p.tab === "sections";
  return (
    <form action={LEARN} method="get" className="mb-3 flex flex-wrap items-end gap-2.5" aria-label="Filter and sort">
      <input type="hidden" name="q" value={p.q} /><input type="hidden" name="tab" value={p.tab} />
      <label className="text-[12.5px] font-semibold text-gray-700">Sort
        <select name="sort" defaultValue={p.sort} className={`${sel} mt-1 block`}>
          {p.q && <option value="relevance">Relevance</option>}
          <option value="recent">Most recent</option>
          {p.tab !== "sections" && <option value="title">Title</option>}
          {(p.tab === "documents" || p.tab === "sessions") && <option value="oldest">Oldest</option>}
        </select>
      </label>
      {docs && (
        <label className="text-[12.5px] font-semibold text-gray-700">Type
          <select name="type" defaultValue={p.type ?? ""} className={`${sel} mt-1 block`}>
            <option value="">Any</option><option value="pdf">PDF</option><option value="docx">Word</option><option value="pptx">PowerPoint</option><option value="text">Text</option>
          </select>
        </label>
      )}
      {p.tab === "documents" && (
        <label className="text-[12.5px] font-semibold text-gray-700">Added
          <select name="within" defaultValue={p.within ?? ""} className={`${sel} mt-1 block`}>
            <option value="">Any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 3 months</option><option value="365">Last year</option>
          </select>
        </label>
      )}
      {subjects.length > 0 && p.tab !== "sessions" && (
        <label className="text-[12.5px] font-semibold text-gray-700">Subject
          <select name="subject" defaultValue={p.subject ?? ""} className={`${sel} mt-1 block`}>
            <option value="">All</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="none">Not in a collection</option>
          </select>
        </label>
      )}
      <button type="submit" className={ghost}>Apply</button>
    </form>
  );
}

/** One topic (owner s3): its sources and sections, what to do with it, and -- apart -- the competencies they are linked to. */
export function TopicDetail(props: {
  name: string; subject: string | null; documents: DocumentHit[]; sections: SectionHit[]; page: number; total: number; competencies: CompetencyRef[];
  studyOn?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(props.total / PAGE_SIZE));
  return (
    <section aria-labelledby="topic-h" className="mb-5 space-y-4">
      <div className={card}>
        <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-gray-500">Topic{props.subject ? ` · ${props.subject}` : ""}</p>
        <h2 id="topic-h" className="mt-0.5 text-[21px] font-bold tracking-tight text-gray-900">{props.name}</h2>
        <p className="mt-0.5 text-[13.5px] text-gray-600">{plural(props.total, "section")} in {plural(props.documents.length, "document")} of your notes.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <Link href={learnHref({ t: props.name })} className={primary} style={{ background: accent }}>Teach me this topic</Link>
          {props.studyOn && <Link href={learnHref({ t: props.name, study: "new" })} className={ghost}>Study this topic</Link>}
          <TopicTools name={props.name} />
        </div>
      </div>
      {props.competencies.length > 0 && (
        <div className={card}>
          <h3 className={h2}>Linked competencies</h3>
          <p className="mt-0.5 text-[12.5px] text-gray-500">Governed competencies your sections on this topic are linked to. They are separate from your own topics and are not changed by renaming.</p>
          <div className="mt-2"><Competencies list={props.competencies} /></div>
          {props.studyOn && (
            <ul className="mt-1 flex flex-wrap gap-x-4">
              {props.competencies.map(c => <li key={c.id}><Link href={learnHref({ competency: c.id, study: "new" })} className={studyLink} style={{ color: accent }}>Study {c.code ? `${c.code} ` : ""}{c.title}</Link></li>)}
            </ul>
          )}
        </div>
      )}
      <form id={FORM_ID} action={LEARN} method="get" className={card}>
        <input type="hidden" name="about" value={props.name.slice(0, 120)} />
        <h3 className={h2}>Sources</h3>
        <ul className="divide-y divide-gray-200">{props.documents.map(d => <DocumentRow key={d.id} d={d} select />)}</ul>
        <h3 className={`${h2} mt-4`}>Sections</h3>
        {props.sections.length === 0 ? <p className="text-[13.5px] text-gray-600">No sections on this page.</p>
          : <ul className="divide-y divide-gray-200">{props.sections.map(s => <SectionRow key={s.chunkId} s={s} select />)}</ul>}
        {pages > 1 && (
          <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
            {props.page > 1 ? <Link href={learnHref({ topicView: props.name, page: props.page - 1 })} className={ghost}>← Previous</Link> : <span />}
            <span className="text-gray-600">Page {props.page} of {pages}</span>
            {props.page < pages ? <Link href={learnHref({ topicView: props.name, page: props.page + 1 })} className={ghost}>Next →</Link> : <span />}
          </nav>
        )}
      </form>
      <SelectionBar formId={FORM_ID} max={MAX_SCOPE_MATERIALS} />
    </section>
  );
}
