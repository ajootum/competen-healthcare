// ── SCHOLAR-SEARCH-HISTORY-01: MY SEARCH HISTORY, THE MODEL ── owner directive 4 Nov 2026 (P1, SALE learner continuity) ──
//
// Pure and client-safe: no I/O, no clock of its own, no AI. The history page, the history route and the capture points
// read their requests and shape their entries through this file only, so every rule here is tested in
// search-history.test.ts. The store is migration 992 (individual_scholar_search_history) inside the Personal Learning
// Library (820): never a parallel store, never a copy of an answer.
//
//   ACTIVITIES   captured from now on: a Learn material search, a library search, an Ask Scholar question (the learner's
//                own submitted words and references). Recovered from what Scholar already keeps: every current saved
//                teaching (a teaching, or research where it includes research) and every lesson. Nothing is invented.
//   CAPTURE      only a SUBMITTED search or question of 2 to 300 characters with a letter or digit: never a keystroke, an
//                empty query or a click. One client request key per submission, so a retry is the same entry. The same
//                words again within two minutes are one entry (a double submit), never two.
//   OPENING      a saved answer reopens as saved (the library's version view) and a lesson's saved teaching through the library:
//                no AI call. Ask answers were never kept (owner ruling D10), so an Ask entry says so and offers where it was
//                asked. Continuing a lesson in Learn is a separate, plainly worded link (CONTINUE_NOTE).
//   PRIVACY      learner owned. Never shown to HQ, employers or educators, never Personal AI memory. Removing an entry or
//                clearing never deletes saved teaching, lessons, attempts, learning evidence or materials.

export const HISTORY_ACTIVITIES = ["material_search", "library_search", "ask", "teaching", "research", "lesson"] as const;
export type HistoryActivity = (typeof HISTORY_ACTIVITIES)[number];
export const CAPTURED_ACTIVITIES = ["material_search", "library_search", "ask"] as const;
export type CapturedActivity = (typeof CAPTURED_ACTIVITIES)[number];

/** Each row's second line says what it is, in the owner's mock-up words. Research is saved teaching that includes research (the keywords were never kept). */
export const ACTIVITY_LABEL: Record<HistoryActivity, string> = {
  material_search: "Materials search", library_search: "Library search", ask: "Ask Scholar",
  teaching: "Saved teaching", research: "Teaching with research", lesson: "Previous lesson",
};
/** The chips (All is no chip value). A saved teaching is a saved lesson to the learner, so it sits under Lessons. */
export const HISTORY_SHOWS = ["searches", "ask", "lessons", "research"] as const;
export type HistoryShow = (typeof HISTORY_SHOWS)[number];
export const SHOW_LABEL: Record<HistoryShow, string> = { searches: "Searches", ask: "Ask Scholar", lessons: "Lessons", research: "Research" };
export const SHOW_ACTIVITIES: Record<HistoryShow, readonly HistoryActivity[]> = {
  searches: ["material_search", "library_search"], ask: ["ask"], lessons: ["lesson", "teaching"], research: ["research"],
};

export const HISTORY_PAGE_SIZE = 25;
export const QUERY_MIN = 2;
export const QUERY_MAX = 300;
export const TOPIC_MAX = 120;
/** The same words of the same activity again within this window are one submission (a double click or a resend). */
export const COLLAPSE_MS = 120_000;
/** On each Ask row, and in full under the list. */
export const ASK_ROW_NOTE = "Answer not kept";
export const ASK_NOT_KEPT = "Scholar does not keep Ask answers, so an answer cannot be reopened. Your question and where you asked it are kept.";
/** The empty history, honestly: nothing is invented, and what came before this page was not kept. */
export const HISTORY_EMPTY = "Nothing here yet. Your searches, your questions to Scholar, your saved teaching and your lessons appear here. Searches and questions from before this page was offered were not kept, so they cannot be shown.";
export const CONTINUE_NOTE = "Opening a saved answer or a saved lesson uses no AI. Continue the lesson carries on in Learn, which writes new teaching only for a part you have not reached yet.";
export const HISTORY_PRIVACY = "Private to you. Never shown to HQ, employers or educators, and never used as AI memory. Removing something here never deletes your saved learning, lessons, answers or materials.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const REQUEST_KEY = /^c:[A-Za-z0-9_-]{16,64}$/;

/** A fresh request key for ONE submission (browser or server). Kept with the form or the call, reused by its retries. */
export function newRequestKey(rand: () => string = () => globalThis.crypto.randomUUID()): string {
  return `c:${rand().replace(/[^A-Za-z0-9]/g, "").slice(0, 64)}`;
}

/** Pure. The learner's words as kept: control characters and runs of space collapsed, at most 300 characters on a word
 *  boundary. Null for anything that is not a meaningful submission (empty, one character, no letter or digit). */
export function normaliseQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
  if (t.length < QUERY_MIN || !/[\p{L}\p{N}]/u.test(t)) return null;
  if (t.length <= QUERY_MAX) return t;
  const cut = t.slice(0, QUERY_MAX - 1);
  return `${cut.replace(/\s+\S*$/, "") || cut}…`;
}

const topicOf = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, TOPIC_MAX).trim();
  return t.length >= 2 ? t : null;
};

export type CaptureInput = {
  activity: CapturedActivity; query: string; requestKey: string;
  materialId: string | null; chunkId: string | null; artefactId: string | null; sessionId: string | null; step: number | null;
  topic: string | null; resultCount: number | null;
};
export type CaptureProblem = "activity" | "query" | "key";

/** Pure. A capture request checked into the one 992 shape, or the first problem. Unknown references are dropped, never guessed. */
export function validateCapture(raw: unknown): { ok: true; entry: CaptureInput } | { ok: false; problem: CaptureProblem } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!(CAPTURED_ACTIVITIES as readonly unknown[]).includes(r.activity)) return { ok: false, problem: "activity" };
  const query = normaliseQuery(r.query);
  if (!query) return { ok: false, problem: "query" };
  if (typeof r.requestKey !== "string" || !REQUEST_KEY.test(r.requestKey)) return { ok: false, problem: "key" };
  const step = Number.isInteger(r.step) && (r.step as number) >= 0 && (r.step as number) < 200 ? (r.step as number) : null;
  const sessionId = isId(r.sessionId) ? r.sessionId.toLowerCase() : null;
  const count = Number.isInteger(r.resultCount) && (r.resultCount as number) >= 0 ? Math.min(r.resultCount as number, 100000) : null;
  return {
    ok: true,
    entry: {
      activity: r.activity as CapturedActivity, query, requestKey: r.requestKey,
      materialId: isId(r.materialId) ? r.materialId.toLowerCase() : null, chunkId: isId(r.chunkId) ? r.chunkId.toLowerCase() : null,
      artefactId: isId(r.artefactId) ? r.artefactId.toLowerCase() : null, sessionId, step: sessionId ? step : null,
      topic: topicOf(r.topic), resultCount: r.activity === "ask" ? null : count,
    },
  };
}

/** Pure. True when `next` repeats the learner's latest entry (same activity, same words ignoring case) within the window. */
export function repeatsLatest(latest: { activity: string; query: string | null; createdAt: string } | null, next: { activity: string; query: string }, nowIso: string, windowMs = COLLAPSE_MS): boolean {
  if (!latest || latest.activity !== next.activity || !latest.query) return false;
  const age = Date.parse(nowIso) - Date.parse(latest.createdAt);
  return Number.isFinite(age) && age >= 0 && age <= windowMs && latest.query.toLocaleLowerCase() === next.query.toLocaleLowerCase();
}

// ── ENTRY KEYS ──

export type EntryRef = { kind: "captured"; id: string } | { kind: "artefact"; id: string } | { kind: "lesson"; id: string };
/** Pure. The list's entry key (h:id, artefact:id, lesson:id), or null for anything else. */
export function parseEntryKey(raw: unknown): EntryRef | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^(h|artefact|lesson):([0-9a-f-]{36})$/i);
  if (!m || !isId(m[2])) return null;
  const id = m[2].toLowerCase();
  return m[1] === "h" ? { kind: "captured", id } : { kind: m[1] as "artefact" | "lesson", id };
}
/** The 992 request key of a mark on a recovered record. */
export const markKey = (ref: { kind: "artefact" | "lesson"; id: string }) => `${ref.kind}:${ref.id}`;

// ── THE PAGE'S QUERY ──

export type HistoryQuery = {
  q: string; show: HistoryShow | null; material: string | null; topic: string | null;
  from: string | null; to: string | null; pinned: boolean; page: number;
};
type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Pure. The history page's request, from its search params. Anything unknown or malformed is dropped. */
export function parseHistoryQuery(p: Params): HistoryQuery {
  const show = (HISTORY_SHOWS as readonly string[]).includes(one(p.show)) ? one(p.show) as HistoryShow : null;
  const from = DAY.test(one(p.from)) ? one(p.from) : null, to = DAY.test(one(p.to)) ? one(p.to) : null;
  const page = Number(one(p.page));
  return {
    q: one(p.q).replace(/\s+/g, " ").trim().slice(0, 200), show,
    material: isId(one(p.material)) ? one(p.material).toLowerCase() : null, topic: topicOf(one(p.topic)),
    ...(from && to && from > to ? { from: to, to: from } : { from, to }),
    pinned: one(p.pinned) === "1", page: Number.isInteger(page) && page >= 1 && page <= 200 ? page : 1,
  };
}
export const hasHistoryFilters = (q: HistoryQuery) => !!(q.q || q.show || q.material || q.topic || q.from || q.to || q.pinned);
/** Pure. How many of the filters behind the Filters control are on (the search box and the chips show themselves). */
export const panelFilterCount = (q: HistoryQuery) => [q.material, q.topic, q.from || q.to, q.pinned].filter(Boolean).length;

/** Pure. The page's own address with some params changed (null removes one). The page is dropped whenever anything else changes. */
export function historyParams(q: HistoryQuery, change: Record<string, string | null> = {}): string {
  const base: Record<string, string | null> = { q: q.q || null, show: q.show, material: q.material, topic: q.topic, from: q.from, to: q.to, pinned: q.pinned ? "1" : null };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...change })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ── ENTRIES AND THEIR LINKS ──

export type HistoryEntry = {
  key: string; origin: "captured" | "recovered"; activity: HistoryActivity; query: string | null; topic: string | null;
  materialId: string | null; chunkId: string | null; artefactId: string | null; sessionId: string | null; step: number | null;
  resultCount: number | null; label: string; headline: string | null; pinnedAt: string | null; createdAt: string;
};
export type EntryLink = { label: string; path: string; kind: "open" | "continue" };

const enc = encodeURIComponent;
/**
 * Pure. Where an entry leads, as paths in the Scholar area. "open" links open something kept and can never call an AI: a saved
 * answer through the library's version view, a lesson's saved teaching through the library filtered to it, a section of the
 * notes, a search run again (full text). An Ask entry has no answer to open (ASK_NOT_KEPT). "continue" is the one exception and
 * says so: it carries on in Learn, whose saved teaching opens as saved, but which writes teaching for a part not yet reached,
 * and records the visit. It is always the learner's click, never where an entry opens first.
 */
export function entryLinks(e: Pick<HistoryEntry, "activity" | "query" | "materialId" | "chunkId" | "artefactId" | "sessionId" | "step">): EntryLink[] {
  const out: EntryLink[] = [];
  if (e.artefactId) out.push({ label: "Open the saved answer", path: `study/saved?version=${enc(e.artefactId)}`, kind: "open" });
  if (e.activity === "lesson" && e.sessionId) out.push({ label: "Open its saved lessons", path: `study/saved?session=${enc(e.sessionId)}`, kind: "open" });
  if (e.activity === "ask" && e.materialId && e.chunkId) out.push({ label: "Open the section", path: `study/${enc(e.materialId)}#c-${e.chunkId}`, kind: "open" });
  if (e.activity === "material_search" && e.query) out.push({ label: "Search again", path: `study/learn?q=${enc(e.query.slice(0, 200))}`, kind: "open" });
  if (e.activity === "library_search" && e.query) out.push({ label: "Search again", path: `study/saved?q=${enc(e.query.slice(0, 200))}`, kind: "open" });
  if (e.sessionId) out.push({ label: "Continue the lesson", path: `study/learn?session=${enc(e.sessionId)}${e.step !== null ? `#lesson-${e.step}` : ""}`, kind: "continue" });
  return out;
}

/**
 * Pure. One newest-first page across several activities' own newest-first lists (a chip that spans two). Same order as 992's list:
 * time, newest first, then the entry key. Every list must hold at least offset + limit rows, or all it has.
 */
export function mergeHistoryPages(lists: readonly (readonly HistoryEntry[])[], offset: number, limit: number): HistoryEntry[] {
  const at = (e: HistoryEntry) => { const t = Date.parse(e.createdAt); return Number.isNaN(t) ? 0 : t; };
  return lists.flat().sort((a, b) => at(b) - at(a) || a.key.localeCompare(b.key)).slice(offset, offset + limit);
}

/** Pure. The row's chevron: its first "open" link. None for an Ask with nothing to open. Everything else goes in the row's menu. */
export function splitEntryLinks<T extends { kind: "open" | "continue" }>(links: readonly T[]): { primary: T | null; rest: T[] } {
  const primary = links.find(l => l.kind === "open") ?? null;
  return { primary, rest: links.filter(l => l !== primary) };
}

/** Pure. The 820 bookmark ("Save for revision") an entry can take, when it points at a saved teaching or one lesson. */
export function saveTarget(e: Pick<HistoryEntry, "artefactId" | "sessionId" | "step">): { targetKind: "artefact"; artefactId: string } | { targetKind: "lesson"; sessionId: string; step: number } | null {
  if (e.artefactId) return { targetKind: "artefact", artefactId: e.artefactId };
  if (e.sessionId && e.step !== null) return { targetKind: "lesson", sessionId: e.sessionId, step: e.step };
  return null;
}

/** Pure. An entry's heading: the learner's words for a capture, the lesson title, or the teaching action's label. */
export function entryTitle(e: Pick<HistoryEntry, "activity" | "query" | "label">, actionLabel: (action: string) => string | undefined): string {
  if (e.query) return e.query;
  if (e.activity === "teaching" || e.activity === "research") return actionLabel(e.label) ?? "Saved teaching";
  return e.label || ACTIVITY_LABEL[e.activity];
}
