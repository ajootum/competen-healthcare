/* eslint-disable @typescript-eslint/no-explicit-any */
// ── SCH-LEARN-UX-01: SEARCH-FIRST, TOPIC-CENTRED LEARN (owner GO 2026-10-28) ─────────────────────────────────
//
// "Students learn topics. Documents provide the supporting knowledge and evidence." This file finds things in the
// student's own library -- topics, documents, sections, learning sessions -- and names learning sessions. It reuses
// what Stages 2 and 3 already built (the chunks' full-text index, the titles, topic finding with the student's
// corrections, the competency links, the session record) through the Scholar store, and nothing else.
//
// ⚠ NO AI. Nothing here calls a model: not for a search, not per result, not on page load, not for a title. Search
// works the same with AI help off, limited or exhausted. Teach Me is an explicit request through the Learn engine.
// ⚠ OWNER-SCOPED. Every read is the store's, keyed on the caller's own id from the gate-3 guard.
// ⚠ NEVER THE WHOLE LIBRARY IN THE BROWSER. One page of each list is sent, with exact counts.
// ⚠ NEVER AN INVENTED LOCATION. A section's place is citeChunk's (its page, slide or section as stored).

import { citeChunk } from "./extract";
import { FORMAT_LABEL, FORMAT_OF, UNIT_OF, type MaterialMime } from "./config";
import { rankChunks, searchTerms, toTsQuery } from "./retrieval";
import { competencyLabels, loadLearnerCatalogue } from "./competency-view";
import {
  chunksByIds, listCollections, listMappings, materialExtras, searchLearningSessionRows, searchMaterialRows, searchSectionRows, sectionLinks, sectionRefs,
  sectionTopicRows, sessionStepSummaries, type LearningSessionRow, type MaterialRow, type SectionRef,
} from "./store";

export const SEARCH_TABS = ["all", "topics", "documents", "sections", "sessions"] as const;
export type SearchTab = (typeof SEARCH_TABS)[number];
export const SEARCH_TAB_LABEL: Record<SearchTab, string> = { all: "All", topics: "Topics", documents: "Documents", sections: "Sections", sessions: "Learning Sessions" };
export const PAGE_SIZE = 10;
/** On the All tab, how many of each kind. */
export const ALL_TAB_EACH = 3;
/** Full-text candidates ranked per search, at most (the count is exact either way). */
export const SECTION_CANDIDATES = 200;
export const MAX_PAGE = 200;

const norm = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// ── NAMING (owner s7) ─────────────────────────────────────────────────────────────────────────────────────

/** Pure. Does this read like a file name rather than a title: no spaces and joined by hyphens, underscores or dots? */
export function looksLikeFileName(t: string): boolean {
  const s = t.trim();
  return !/\s/.test(s) && /[-_.]/.test(s) && /[a-z]/i.test(s);
}

/** Pure. A title for people: a file-like name ("recognising-deterioration-notes.pdf") becomes "Recognising Deterioration Notes". */
export function displayTitle(t: string): string {
  const s = (t ?? "").trim();
  if (!s) return "Untitled material";
  // A label with spaces (a topic, a typed title) keeps its own words and hyphens: all lower case gets a capital first letter only.
  if (!looksLikeFileName(s)) return s === s.toLowerCase() && /^[a-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s;
  const words = s.replace(/\.(pdf|docx|pptx|txt)$/i, "").replace(/[-_.]+/g, " ").replace(/\s+/g, " ").trim().split(" ");
  return words.map(w => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w)).join(" ") || "Untitled material";
}

/** Pure. A topic as topic finding or the student wrote it: never split on hyphens; all lower case gets a capital first letter only. */
export function topicLabel(t: string): string {
  const s = (t ?? "").replace(/\s+/g, " ").trim();
  return s === s.toLowerCase() && /^[a-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Pure. The topic most of these sections share (first seen breaks a tie), as written. Null when none is known. */
export function leadingTopic(chunkIds: readonly string[], topics: ReadonlyMap<string, readonly string[]>): string | null {
  const counts = new Map<string, { name: string; n: number; first: number }>();
  let i = 0;
  for (const id of chunkIds) for (const t of topics.get(id) ?? []) {
    const k = norm(t); if (!k) continue;
    const c = counts.get(k) ?? { name: t.trim(), n: 0, first: i++ };
    c.n++; counts.set(k, c);
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n || a.first - b.first)[0];
  return best ? topicLabel(best.name) : null;
}

/**
 * Pure. THE session title (owner s3, s7): deterministic, never an AI call, never a raw file name. The topic it teaches,
 * then its source: "Recognising Clinical Deterioration · Source: Recognising Deterioration Notes". The original file
 * name stays on the document. At most 160 characters (414).
 */
export function sessionTitle(input: {
  kind: "section" | "document" | "documents" | "topic" | "competency"; sections: readonly SectionRef[];
  topics: ReadonlyMap<string, readonly string[]>; topic?: string | null; competencyTitle?: string | null;
}): string {
  const sources = [...new Set(input.sections.map(s => s.materialId))].map(id => displayTitle(input.sections.find(s => s.materialId === id)!.materialTitle));
  const subject = input.kind === "topic" && input.topic ? topicLabel(input.topic)
    : input.kind === "competency" && input.competencyTitle ? input.competencyTitle
      : leadingTopic(input.sections.map(s => s.chunkId), input.topics);
  const first = input.sections[0];
  const where = input.kind === "section" && first ? `, ${citeChunk(first, first.unit)}` : "";
  const source = sources.length === 1 ? `Source: ${sources[0]}${where}` : sources.length > 1 ? `${sources.length} sources` : null;
  const title = subject && source ? `${subject} · ${source}` : subject ?? (sources.length === 1 ? `${sources[0]}${where}` : source) ?? "Learning session";
  return title.length > 160 ? `${title.slice(0, 159)}…` : title;
}

/** Pure. A stored title shown safely: sessions named before this used the file-like material title. History is not rewritten. */
export function displaySessionTitle(stored: string): string {
  return stored.split(" · ").map((part, i) => (i === 0 ? displayTitle(part.replace(/^(\d+ materials: )/, "")) : part)).join(" · ");
}

/** Pure. Sessions that would look alike are told apart by when they started (owner s7). */
export function distinguishTitles<T extends { id: string; title: string; createdAt: string }>(rows: readonly T[]): Map<string, string> {
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(displaySessionTitle(r.title), (seen.get(displaySessionTitle(r.title)) ?? 0) + 1);
  return new Map(rows.map(r => {
    const t = displaySessionTitle(r.title);
    return [r.id, (seen.get(t) ?? 0) > 1 ? `${t} · started ${shortDate(r.createdAt, true)}` : t];
  }));
}

export const shortDate = (iso: string, withTime = false) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });

// ── SEARCH (owner s3-s5) ──────────────────────────────────────────────────────────────────────────────────

/** Pure. A short extract around the first matched term -- the student's own words, never more than ~220 characters. */
export function snippet(content: string, terms: readonly string[], width = 220): string {
  const text = content.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const at = terms.map(t => lower.indexOf(t.length > 5 ? t.slice(0, 5) : t)).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - Math.floor(width / 3));
  const out = text.slice(start, start + width).trim();
  return `${start > 0 ? "…" : ""}${out}${start + width < text.length ? "…" : ""}`;
}

/** Pure. How many distinct terms a text matches (by the same 5-letter prefix rankChunks uses). */
export function termScore(text: string, terms: readonly string[]): number {
  const words = norm(text).split(" ");
  return terms.filter(t => { const p = t.length > 5 ? t.slice(0, 5) : t; return words.some(w => w.startsWith(p)); }).length;
}

export type TopicEntry = { key: string; name: string; sections: number; chunkIds: string[]; materialIds: string[] };

/** Pure. The library's topics: each distinct topic (case- and punctuation-blind) with its sections and documents. */
export function topicIndex(rows: readonly { chunkId: string; materialId: string; topics: readonly string[] }[]): TopicEntry[] {
  const by = new Map<string, TopicEntry>();
  for (const r of rows) for (const t of r.topics) {
    const key = norm(t); if (key.length < 2) continue;
    const e = by.get(key) ?? { key, name: t.trim(), sections: 0, chunkIds: [], materialIds: [] };
    if (!e.chunkIds.includes(r.chunkId)) { e.chunkIds.push(r.chunkId); e.sections++; }
    if (!e.materialIds.includes(r.materialId)) e.materialIds.push(r.materialId);
    by.set(key, e);
  }
  return [...by.values()].sort((a, b) => b.sections - a.sections || a.name.localeCompare(b.name));
}

export const topicKey = norm;

/** Pure. One document's topics, those on most of its own sections first (first seen breaks a tie). */
export function materialTopics(rows: readonly { materialId: string; topics: readonly string[] }[], materialId: string, limit: number): string[] {
  const n = new Map<string, { name: string; c: number; at: number }>();
  let i = 0;
  for (const r of rows) if (r.materialId === materialId) for (const t of r.topics) {
    const k = norm(t); if (!k) continue;
    const e = n.get(k) ?? { name: t.trim(), c: 0, at: i++ };
    e.c++; n.set(k, e);
  }
  return [...n.values()].sort((a, b) => b.c - a.c || a.at - b.at).slice(0, limit).map(e => topicLabel(e.name));
}

export type SearchParams = {
  q: string; tab: SearchTab; page: number;
  sort: "relevance" | "title" | "recent" | "oldest"; type: string | null; within: number | null; subject: string | null;
};

/** Pure. The search's query string as given (anything unrecognised falls back). */
export function parseSearchParams(raw: Record<string, string | string[] | undefined>): SearchParams {
  const one = (k: string) => { const v = raw[k]; return typeof v === "string" ? v : Array.isArray(v) ? v[0] ?? "" : ""; };
  const tab = (SEARCH_TABS as readonly string[]).includes(one("tab")) ? (one("tab") as SearchTab) : "all";
  const page = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(one("page")) || 1)));
  const sort = (["relevance", "title", "recent", "oldest"] as const).find(s => s === one("sort")) ?? (one("q").trim() ? "relevance" : "recent");
  const type = ["pdf", "docx", "pptx", "text"].includes(one("type")) ? one("type") : null;
  const within = [7, 30, 90, 365].includes(Number(one("within"))) ? Number(one("within")) : null;
  const subject = one("subject") && /^[0-9a-f-]{36}$|^none$/i.test(one("subject")) ? one("subject") : null;
  return { q: one("q").replace(/\s+/g, " ").trim().slice(0, 200), tab, page, sort, type, within, subject };
}

const MIME_OF: Record<string, MaterialMime> = Object.fromEntries(Object.entries(FORMAT_OF).map(([mime, f]) => [f, mime as MaterialMime]));

export type DocumentHit = { id: string; title: string; fileName: string; format: string; unit: string; addedAt: string; sections: number; topics: string[]; subject: string | null };
export type CompetencyRef = { id: string; title: string; code: string | null; accepted: boolean };
export type SectionHit = { chunkId: string; materialId: string; materialTitle: string; location: string; extract: string; topics: string[]; competencies: CompetencyRef[] };
/** A governed competency the student's own sections are linked to (388) -- shown apart from their personal topics. */
export type CompetencyHit = CompetencyRef & { sections: number };
export type TopicHit = { name: string; sections: number; documents: number; subject: string | null };
export type SessionHit = { id: string; title: string; topic: string | null; status: "active" | "completed"; steps: number; currentStep: number; sources: string[]; lastActiveAt: string; createdAt: string };
export type Paged<T> = { total: number; items: T[] };
export type SearchResult = {
  params: SearchParams; terms: string[];
  topics: Paged<TopicHit> | null; documents: Paged<DocumentHit> | null; sections: (Paged<SectionHit> & { matched: number }) | null; sessions: Paged<SessionHit> | null;
  /** On All and Topics, with a query: the competencies the student's notes are linked to whose names match. */
  competencies: CompetencyHit[] | null;
  /** Exact counts per tab (null where that source could not be read: said so, never shown as zero). */
  counts: Record<Exclude<SearchTab, "all">, number | null>;
  subjects: { id: string; name: string }[];
};

/** The topics' subjects: the student's own collections (407), by where most of each topic's documents are shelved. */
function subjectOf(materialIds: readonly string[], shelf: ReadonlyMap<string, string | null>): string | null {
  const n = new Map<string, number>();
  for (const id of materialIds) { const s = shelf.get(id); if (s) n.set(s, (n.get(s) ?? 0) + 1); }
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * The search itself: every tab's exact count, and one page of the tab asked for (a few of each on All). Reads only,
 * no AI. `materials` is the person's library as the page already read it (for titles and filters).
 */
export async function searchLibrary(admin: any, userId: string, params: SearchParams, materials: readonly MaterialRow[]): Promise<SearchResult> {
  const terms = searchTerms(params.q);
  const tsq = toTsQuery(params.q);
  const [topicRows, collections, extras] = await Promise.all([
    sectionTopicRows(admin, userId), listCollections(admin, userId), materialExtras(admin, userId, materials.map(m => m.id)),
  ]);
  const shelf = new Map(materials.map(m => [m.id, extras.collectionsOn ? extras.byId.get(m.id)?.collectionId ?? null : null]));
  const subjects = collections.ok ? collections.data.map(c => ({ id: c.id, name: c.name })) : [];
  const subjectName = new Map(subjects.map(s => [s.id, s.name]));
  const topicsByChunk = new Map((topicRows.ok ? topicRows.data : []).map(r => [r.chunkId, r.topics]));
  const index = topicRows.ok ? topicIndex(topicRows.data) : null;
  const want = (t: SearchTab) => params.tab === "all" || params.tab === t;
  const slice = <T,>(list: readonly T[]) => params.tab === "all" ? list.slice(0, ALL_TAB_EACH) : list.slice((params.page - 1) * PAGE_SIZE, params.page * PAGE_SIZE);
  const inSubject = (materialIds: readonly string[]) => !params.subject || materialIds.some(id => (params.subject === "none" ? !shelf.get(id) : shelf.get(id) === params.subject));

  // Topics: names matching the terms (all of them, most-covered first, when there are none).
  const topicMatches = index === null ? null : index
    .map(e => ({ e, score: terms.length ? termScore(e.name, terms) : 1 }))
    .filter(x => x.score > 0 && inSubject(x.e.materialIds))
    .sort((a, b) => b.score - a.score || (params.sort === "title" ? a.e.name.localeCompare(b.e.name) : b.e.sections - a.e.sections))
    .map(x => x.e);
  const topicHits = (list: readonly TopicEntry[]): TopicHit[] => list.map(e => {
    const s = subjectOf(e.materialIds, shelf);
    return { name: topicLabel(e.name), sections: e.sections, documents: e.materialIds.length, subject: s ? subjectName.get(s) ?? null : null };
  });

  // Documents: title or file name, or a topic of theirs, matching; filtered by type, date and subject.
  const since = params.within ? new Date(Date.now() - params.within * 86_400_000).toISOString() : null;
  const docRows = await searchMaterialRows(admin, userId, { terms: [], mime: params.type ? MIME_OF[params.type] ?? null : null, sinceIso: since, limit: 2000 });
  const topicDocScore = new Map<string, number>();
  for (const e of topicMatches ?? []) if (terms.length) for (const id of e.materialIds) topicDocScore.set(id, Math.max(topicDocScore.get(id) ?? 0, termScore(e.name, terms)));
  const docTopics = (id: string) => materialTopics(topicRows.ok ? topicRows.data : [], id, 4);
  const docMatches = !docRows.ok ? null : docRows.data
    .map(m => ({ m, score: terms.length ? Math.max(termScore(`${m.title} ${m.fileName}`, terms) * 2, topicDocScore.get(m.id) ?? 0) : 1 }))
    .filter(x => x.score > 0 && inSubject([x.m.id]))
    .sort((a, b) => params.sort === "title" ? displayTitle(a.m.title).localeCompare(displayTitle(b.m.title))
      : params.sort === "oldest" ? a.m.createdAt.localeCompare(b.m.createdAt)
        : params.sort === "recent" ? b.m.createdAt.localeCompare(a.m.createdAt)
          : b.score - a.score || b.m.createdAt.localeCompare(a.m.createdAt))
    .map(x => x.m);
  const documentHits = (list: readonly MaterialRow[]): DocumentHit[] => list.map(m => {
    const s = shelf.get(m.id) ?? null;
    return { id: m.id, title: displayTitle(m.title), fileName: m.fileName, format: FORMAT_LABEL[FORMAT_OF[m.mimeType]], unit: UNIT_OF(m.mimeType), addedAt: m.createdAt, sections: m.chunkCount, topics: docTopics(m.id), subject: s ? subjectName.get(s) ?? null : null };
  });

  // Sections: full-text search on the student's own sections, ranked. With many matches, sections holding EVERY
  // term are gathered first, so the ranked candidates are the most relevant ones, not the first the database found.
  let sections: SearchResult["sections"] = null, sectionCount: number | null = 0;
  const learner = want("sections") || want("topics") ? await loadLearnerCatalogue(admin, userId) : null;
  if (tsq) {
    const found = await searchSectionRows(admin, userId, tsq, SECTION_CANDIDATES);
    if (!found.ok) sectionCount = null;
    else {
      let pool = found.data.rows;
      if (found.data.total > pool.length && terms.length > 1) {
        const every = await searchSectionRows(admin, userId, terms.join(" & "), SECTION_CANDIDATES);
        if (every.ok) pool = [...new Map([...every.data.rows, ...pool].map(c => [c.id, c])).values()];
      }
      const filtered = !!params.type || !!params.subject;
      const allowed = pool.filter(c => inSubject([c.materialId]) && (!params.type || materials.find(m => m.id === c.materialId)?.mimeType === MIME_OF[params.type]));
      const ranked = rankChunks(params.q, allowed, allowed.length);
      sectionCount = filtered ? ranked.length : found.data.total;
      if (want("sections")) {
        const page = slice(ranked);
        const [refs, links] = await Promise.all([sectionRefs(admin, userId, page), sectionLinks(admin, userId, page.map(c => c.id))]);
        const names = await competencyLabels(admin, learner?.competencies ?? null, links.map(l => l.competencyId), new Map());
        sections = {
          total: ranked.length, matched: sectionCount,
          items: page.map((c, i) => ({
            chunkId: c.id, materialId: c.materialId, materialTitle: displayTitle(refs[i].materialTitle), location: citeChunk(c, refs[i].unit),
            extract: snippet(c.content, terms), topics: (topicsByChunk.get(c.id) ?? []).slice(0, 3).map(topicLabel),
            competencies: [...new Map(links.filter(l => l.chunkId === c.id).map(l => [l.competencyId, {
              id: l.competencyId, title: names.get(l.competencyId)?.title ?? "A competency", code: names.get(l.competencyId)?.code ?? null, accepted: l.accepted,
            }])).values()].slice(0, 3),
          })),
        };
      }
    }
  }

  // Competency links (388): only with a query, and only competencies the student's own sections are linked to (not rejected).
  let competencies: CompetencyHit[] | null = null;
  if (terms.length && want("topics")) {
    const maps = await listMappings(admin, userId);
    if (maps.ok) {
      const live = maps.data.mappings.filter(m => m.state !== "rejected");
      const names = await competencyLabels(admin, learner?.competencies ?? null, live.map(m => m.competencyId), new Map(live.map(m => [m.competencyId, m.layer])));
      const by = new Map<string, CompetencyHit>();
      for (const m of live) {
        const n = names.get(m.competencyId);
        const h = by.get(m.competencyId) ?? { id: m.competencyId, title: n?.title ?? "A competency", code: n?.code ?? null, accepted: false, sections: 0 };
        h.sections++; h.accepted ||= m.state === "accepted"; by.set(m.competencyId, h);
      }
      competencies = [...by.values()].filter(h => termScore(`${h.code ?? ""} ${h.title}`, terms) > 0)
        .sort((a, b) => termScore(b.title, terms) - termScore(a.title, terms) || b.sections - a.sections).slice(0, params.tab === "all" ? ALL_TAB_EACH : PAGE_SIZE);
    }
  }

  // Learning sessions: title and topic; the count is exact.
  const sessionSort = params.sort === "title" ? "title" : params.sort === "oldest" ? "oldest" : "recent";
  const sess = want("sessions") || params.tab === "all"
    ? await searchLearningSessionRows(admin, userId, { terms, sort: sessionSort, offset: params.tab === "all" ? 0 : (params.page - 1) * PAGE_SIZE, limit: params.tab === "all" ? ALL_TAB_EACH : PAGE_SIZE })
    : null;
  const sessions = sess?.ok ? { total: sess.data.total, items: await sessionHits(admin, userId, sess.data.rows, materials, topicsByChunk) } : null;

  return {
    params, terms, subjects, competencies,
    topics: want("topics") && topicMatches ? { total: topicMatches.length, items: topicHits(slice(topicMatches)) } : null,
    documents: want("documents") && docMatches ? { total: docMatches.length, items: documentHits(slice(docMatches)) } : null,
    sections, sessions,
    counts: { topics: topicMatches?.length ?? null, documents: docMatches?.length ?? null, sections: sectionCount, sessions: sess ? (sess.ok ? sess.data.total : null) : null },
  };
}

/** Sessions as cards: a distinguishable title, the topic, the sources, the real status (step count, never a percentage). */
export async function sessionHits(admin: any, userId: string, rows: readonly LearningSessionRow[], materials: readonly MaterialRow[], topicsByChunk?: ReadonlyMap<string, readonly string[]>): Promise<SessionHit[]> {
  const summaries = await sessionStepSummaries(admin, userId, rows.map(r => r.id));
  const titles = distinguishTitles(rows);
  const name = new Map(materials.map(m => [m.id, displayTitle(m.title)]));
  const topicMap = topicsByChunk ?? new Map((await sectionTopicRowsFor(admin, userId)).map(r => [r.chunkId, r.topics]));
  return rows.map(r => {
    const s = summaries.get(r.id);
    return {
      id: r.id, title: titles.get(r.id) ?? displaySessionTitle(r.title), status: r.status, steps: s?.steps ?? 0, currentStep: r.currentStep,
      topic: r.topic ? topicLabel(r.topic) : leadingTopic(s?.chunkIds ?? [], topicMap),
      sources: (s?.materialIds ?? []).map(id => name.get(id)).filter((t): t is string => !!t),
      lastActiveAt: r.lastActiveAt, createdAt: r.createdAt,
    };
  });
}

async function sectionTopicRowsFor(admin: any, userId: string) {
  const r = await sectionTopicRows(admin, userId);
  return r.ok ? r.data : [];
}

// ── THE LANDING (owner s3) AND ONE TOPIC ────────────────────────────────────────────────────────────────────

export const LANDING_SESSIONS = 3;
export const LANDING_TOPICS = 12;
export const LANDING_RECENT = 4;

export type Landing = {
  sessions: SessionHit[] | null; sessionTotal: number | null;
  topicGroups: { subject: string | null; topics: TopicHit[] }[] | null; topicTotal: number;
  recent: (DocumentHit & { status: string })[] | null;
};

/** Pure. A material's state in words: read (and how well), and whether its topics have been found yet. Never invented. */
export function processingStatus(partial: boolean, analysed: boolean): string {
  return `${partial ? "Partly read" : "Ready"}${analysed ? "" : " · topics not found yet"}`;
}

/** What the landing shows, read once, no AI: three sessions, the most-covered topics by subject, the newest documents. */
export async function learnLanding(admin: any, userId: string, materials: readonly MaterialRow[] | null): Promise<Landing> {
  const list = materials ?? [];
  const [sess, topicRows, collections, extras] = await Promise.all([
    searchLearningSessionRows(admin, userId, { terms: [], sort: "recent", offset: 0, limit: LANDING_SESSIONS }),
    sectionTopicRows(admin, userId), listCollections(admin, userId), materialExtras(admin, userId, list.map(m => m.id)),
  ]);
  const topicsByChunk = new Map((topicRows.ok ? topicRows.data : []).map(r => [r.chunkId, r.topics]));
  const shelf = new Map(list.map(m => [m.id, extras.collectionsOn ? extras.byId.get(m.id)?.collectionId ?? null : null]));
  const names = new Map((collections.ok ? collections.data : []).map(c => [c.id, c.name]));
  const index = topicRows.ok ? topicIndex(topicRows.data) : null;
  let topicGroups: Landing["topicGroups"] = null;
  if (index) {
    const groups = new Map<string, TopicHit[]>();
    for (const e of index.slice(0, LANDING_TOPICS)) {
      const s = subjectOf(e.materialIds, shelf);
      const key = s && names.has(s) ? s : "";
      groups.set(key, [...(groups.get(key) ?? []), { name: topicLabel(e.name), sections: e.sections, documents: e.materialIds.length, subject: key ? names.get(key)! : null }]);
    }
    topicGroups = [...groups.entries()].sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || (names.get(a[0]) ?? "").localeCompare(names.get(b[0]) ?? ""))
      .map(([k, topics]) => ({ subject: k ? names.get(k)! : null, topics }));
  }
  const analysed = new Set((topicRows.ok ? topicRows.data : []).map(r => r.materialId));
  const recent = materials === null ? null : list.slice(0, LANDING_RECENT).map(m => {
    const q = extras.qualityOn ? extras.byId.get(m.id)?.quality ?? null : null;
    const s = shelf.get(m.id) ?? null;
    return {
      id: m.id, title: displayTitle(m.title), fileName: m.fileName, format: FORMAT_LABEL[FORMAT_OF[m.mimeType]], unit: UNIT_OF(m.mimeType), addedAt: m.createdAt, sections: m.chunkCount,
      topics: materialTopics(topicRows.ok ? topicRows.data : [], m.id, 3), subject: s ? names.get(s) ?? null : null,
      status: processingStatus(!!q && q.emptyUnits.length > 0, analysed.has(m.id)),
    };
  });
  return {
    sessions: sess.ok ? await sessionHits(admin, userId, sess.data.rows, list, topicsByChunk) : null, sessionTotal: sess.ok ? sess.data.total : null,
    topicGroups, topicTotal: index?.length ?? 0, recent,
  };
}

export type TopicView = { name: string; subject: string | null; documents: DocumentHit[]; sections: SectionHit[]; total: number; competencies: CompetencyRef[] } | null;

/** One of the student's topics: its documents, one page of its sections (in document order), and its linked competencies apart. */
export async function topicDetail(admin: any, userId: string, name: string, page: number, materials: readonly MaterialRow[]): Promise<TopicView | "unreadable"> {
  const [rows, collections, extras] = await Promise.all([sectionTopicRows(admin, userId), listCollections(admin, userId), materialExtras(admin, userId, materials.map(m => m.id))]);
  if (!rows.ok) return "unreadable";
  const entry = topicIndex(rows.data).find(e => e.key === topicKey(name));
  if (!entry) return null;
  const shelf = new Map(materials.map(m => [m.id, extras.collectionsOn ? extras.byId.get(m.id)?.collectionId ?? null : null]));
  const names = new Map((collections.ok ? collections.data : []).map(c => [c.id, c.name]));
  const topicsByChunk = new Map(rows.data.map(r => [r.chunkId, r.topics]));
  const docs = materials.filter(m => entry.materialIds.includes(m.id));
  const rank = new Map(docs.map((m, i) => [m.id, i]));
  const all = await chunksForTopic(admin, userId, entry.chunkIds);
  const ordered = all.sort((a, b) => (rank.get(a.materialId) ?? 99) - (rank.get(b.materialId) ?? 99) || a.ordinal - b.ordinal);
  const pageIds = new Set(ordered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(c => c.id));
  const text = await chunksByIds(admin, userId, [...pageIds]);
  const pageRows = ordered.filter(c => pageIds.has(c.id)).map(c => ({ ...c, content: (text.ok ? text.data.find(t => t.id === c.id)?.content : null) ?? "" }));
  const [refs, links] = await Promise.all([sectionRefs(admin, userId, pageRows), sectionLinks(admin, userId, entry.chunkIds.slice(0, 500))]);
  const learner = await loadLearnerCatalogue(admin, userId);
  const labels = await competencyLabels(admin, learner.competencies, links.map(l => l.competencyId), new Map());
  const comp = [...new Map(links.map(l => [l.competencyId, { id: l.competencyId, title: labels.get(l.competencyId)?.title ?? "A competency", code: labels.get(l.competencyId)?.code ?? null, accepted: l.accepted }])).values()];
  const s = subjectOf(entry.materialIds, shelf);
  return {
    name: topicLabel(entry.name), subject: s ? names.get(s) ?? null : null, total: entry.sections,
    competencies: comp.sort((a, b) => Number(b.accepted) - Number(a.accepted)).slice(0, 8),
    documents: docs.map(m => ({ id: m.id, title: displayTitle(m.title), fileName: m.fileName, format: FORMAT_LABEL[FORMAT_OF[m.mimeType]], unit: UNIT_OF(m.mimeType), addedAt: m.createdAt, sections: m.chunkCount, topics: [], subject: shelf.get(m.id) ? names.get(shelf.get(m.id)!) ?? null : null })),
    sections: pageRows.map((c, i) => ({
      chunkId: c.id, materialId: c.materialId, materialTitle: displayTitle(refs[i].materialTitle), location: citeChunk(c, refs[i].unit),
      extract: snippet(c.content, searchTerms(name)), topics: (topicsByChunk.get(c.id) ?? []).slice(0, 3).map(topicLabel),
      competencies: [],
    })),
  };
}

async function chunksForTopic(admin: any, userId: string, ids: readonly string[]) {
  const out = [];
  for (let i = 0; i < ids.length && i < 2000; i += 500) {
    const r = await chunksByIds(admin, userId, ids.slice(i, i + 500), false);
    if (r.ok) out.push(...r.data);
  }
  return out;
}
