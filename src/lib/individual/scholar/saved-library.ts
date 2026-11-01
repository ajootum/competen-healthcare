// ── SCHOLAR-LIBRARY-01: THE PERSONAL LIBRARY MODEL ── owner instruction 1 Nov 2026, "Persistent Learning Library and Search" ──
//
// Pure and client-safe: no I/O, no clock of its own, no AI. The Saved learning page (study/saved), the notes route and the
// export route read their requests and shape their rows through this file only, so every rule here is tested in
// saved-library.test.ts:
//
//   VIEWS        recent (newest saved teaching) · continue (active sessions) · completed (finished sessions) · revision
//                (what the learner bookmarked). One view at a time, 25 a page, keyset paginated on (created_at, id).
//   FILTERS      material, topic, competency, a date range, a status (any / has your notes / bookmarked / earlier
//                versions), and the sort (newest / oldest). Unknown values are dropped, never guessed.
//   SEARCH       deterministic full text (migration 820 individual_scholar_library_search, websearch syntax), snippets
//                marked {{hl}} ... {{/hl}} and rendered as <mark> by splitting TEXT, never as HTML. Without 820, a basic
//                match over the newest saved teaching (basicMatches), said so on the page.
//   LESSONS      a saved teaching is LINKED to a lesson when 820 recorded session and step at save; an older one is
//                MATCHED BY SECTIONS only when its chunk set is exactly a lesson's (learn-journey coversLesson). Never guessed.
//   VERSIONS     a refresh keeps the earlier teaching (820 superseded_at, key rewritten to key:superseded:id).
//   NOTES        the learner's own words: note (1-4000), bookmark (no text), highlight (a quote of 1-500, optional comment).
//   EXPORT       exactly one scope per request: lesson, material, study, selected (at most 100 ids), topic, or a date range.

export const LIBRARY_PAGE_SIZE = 25;
export const NOTE_BODY_MAX = 4000;
export const NOTE_QUOTE_MAX = 500;
export const EXPORT_SELECTED_MAX = 100;
export const SEARCH_QUERY_MAX = 200;
/** Basic search (no 820) looks at this many of the newest saved teachings, and says so. */
export const BASIC_SEARCH_ROWS = 500;
export const HL_START = "{{hl}}";
export const HL_STOP = "{{/hl}}";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// ── VIEWS AND FILTERS ──

export const LIBRARY_VIEWS = ["recent", "continue", "completed", "revision"] as const;
export type LibraryView = (typeof LIBRARY_VIEWS)[number];
export const VIEW_LABEL: Record<LibraryView, string> = {
  recent: "Recently studied", continue: "Continue learning", completed: "Completed learning", revision: "Saved for revision",
};
export const LIBRARY_STATUSES = ["any", "noted", "bookmarked", "earlier"] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];
export const STATUS_LABEL: Record<LibraryStatus, string> = { any: "Any", noted: "Has your notes", bookmarked: "Bookmarked", earlier: "Earlier versions" };

export type Cursor = { at: string; id: string };
export type LibraryQuery = {
  view: LibraryView; material: string | null; topic: string | null; competency: string | null;
  from: string | null; to: string | null; status: LibraryStatus; sort: "newest" | "oldest";
  cursor: Cursor | null; q: string; page: number;
};

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Pure. The page's own request, from its search params. Anything unknown or malformed is dropped. */
export function parseLibraryQuery(p: Params): LibraryQuery {
  const view = (LIBRARY_VIEWS as readonly string[]).includes(one(p.view)) ? one(p.view) as LibraryView : "recent";
  const status = (LIBRARY_STATUSES as readonly string[]).includes(one(p.status)) ? one(p.status) as LibraryStatus : "any";
  const topic = one(p.topic).replace(/\s+/g, " ").trim().slice(0, 120);
  const from = DAY.test(one(p.from)) ? one(p.from) : null, to = DAY.test(one(p.to)) ? one(p.to) : null;
  const page = Number(one(p.page));
  return {
    view, status, sort: one(p.sort) === "oldest" ? "oldest" : "newest",
    material: isId(one(p.material)) ? one(p.material) : null, competency: isId(one(p.competency)) ? one(p.competency) : null,
    topic: topic.length >= 2 ? topic : null,
    // A range that ends before it starts is read the right way round, never refused.
    ...(from && to && from > to ? { from: to, to: from } : { from, to }),
    cursor: decodeCursor(one(p.after)), q: one(p.q).replace(/\s+/g, " ").trim().slice(0, SEARCH_QUERY_MAX),
    page: Number.isInteger(page) && page >= 1 && page <= 200 ? page : 1,
  };
}

/** Pure. The date range as ISO bounds: from the start of `from` (UTC) to the end of `to` (exclusive next day). */
export function rangeBounds(from: string | null, to: string | null): { fromIso: string | null; toIso: string | null } {
  const next = (d: string) => { const t = new Date(`${d}T00:00:00.000Z`); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString(); };
  return { fromIso: from ? `${from}T00:00:00.000Z` : null, toIso: to ? next(to) : null };
}

// ── KEYSET PAGINATION ──

/** The database's own timestamp text (microseconds and offset kept): a cursor never rounds, so no row is skipped. */
const STAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;
export function encodeCursor(c: Cursor): string {
  return `${c.at}~${c.id}`.replace(/\+/g, "p").replace(/:/g, "c").replace(/ /g, "T");
}
/** Pure. A cursor from the URL, or null for anything that is not exactly one. */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw || raw.length > 80) return null;
  const [atRaw, id, extra] = raw.split("~");
  if (extra !== undefined || !atRaw || !isId(id)) return null;
  const at = atRaw.replace(/c/g, ":").replace(/p/g, "+");
  return STAMP.test(at) ? { at, id: id.toLowerCase() } : null;
}
/** Pure. One page from `limit + 1` rows read: the page, and the cursor after its last row when there is more. */
export function pageOf<T extends { id: string }>(rows: readonly T[], limit: number, at: (r: T) => string): { items: T[]; next: Cursor | null } {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, next: rows.length > limit && last ? { at: at(last), id: last.id } : null };
}
/** Pure. The PostgREST filter for rows after the cursor in the order (created_at, id) newest or oldest first. */
export function keysetFilter(c: Cursor, sort: "newest" | "oldest", col = "created_at"): string {
  const op = sort === "oldest" ? "gt" : "lt";
  return `${col}.${op}."${c.at}",and(${col}.eq."${c.at}",id.${op}.${c.id})`;
}

// ── SNIPPETS: {{hl}} MARKS AS TEXT PARTS, NEVER HTML ──

export type SnippetPart = { text: string; mark: boolean };
/** Pure. A headline as parts to render as text and <mark>. Unbalanced or stray markers never leak, control characters go. */
export function snippetParts(headline: string | null | undefined, max = 400): SnippetPart[] {
  const s = String(headline ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  const out: SnippetPart[] = [];
  let mark = false, used = 0;
  for (const piece of s.split(/(\{\{\/?hl\}\})/)) {
    if (piece === HL_START) { mark = true; continue; }
    if (piece === HL_STOP) { mark = false; continue; }
    if (!piece || used >= max) continue;
    const text = piece.slice(0, max - used);
    used += text.length;
    const prev = out[out.length - 1];
    if (prev && prev.mark === mark) prev.text += text; else out.push({ text, mark });
  }
  if (used >= max && out.length) out[out.length - 1].text += "…";
  return out;
}

/** Pure. A basic (no 820) match: every term in the text, case-insensitive. Terms are letters and digits only. */
export function basicTerms(q: string): string[] {
  return [...new Set(q.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(t => t.length >= 2))].slice(0, 8);
}
/** Pure. Rows whose text holds every term, newest first as given, each with a marked snippet around the first term. */
export function basicMatches<T extends { id: string }>(rows: readonly T[], q: string, text: (r: T) => string): { row: T; headline: string }[] {
  const terms = basicTerms(q);
  if (!terms.length) return [];
  const out: { row: T; headline: string }[] = [];
  for (const r of rows) {
    const t = text(r) ?? "", low = t.toLowerCase();
    if (!terms.every(x => low.includes(x))) continue;
    const at = Math.max(0, low.indexOf(terms[0]) - 80);
    let piece = t.slice(at, at + 240);
    const re = new RegExp(`(${terms.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    piece = piece.replace(/\{\{\/?hl\}\}/g, "").replace(re, `${HL_START}$1${HL_STOP}`);
    out.push({ row: r, headline: `${at > 0 ? "… " : ""}${piece}${at + 240 < t.length ? " …" : ""}` });
  }
  return out;
}

// ── ITEMS: TITLE, VERSION, PROVENANCE, LESSON ──

/** Pure. A saved teaching's title: its first markdown heading, else its first line, plain and clipped. */
export function lessonTitleOf(content: string, max = 90): string {
  const lines = String(content ?? "").replace(/\r/g, "").split("\n").map(l => l.trim()).filter(Boolean);
  const heading = lines.find(l => /^#{1,6}\s+\S/.test(l));
  const raw = (heading ?? lines[0] ?? "").replace(/^#{1,6}\s+/, "").replace(/\*\*|__|`/g, "").replace(/^(overview|title)\s*:\s*/i, "").trim();
  return raw.length <= max ? raw : `${raw.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

export type Provenance = "notes" | "ai" | "research" | "yours";
export const PROVENANCE_LABEL: Record<Provenance, string> = {
  notes: "From your notes", ai: "AI-generated", research: "Includes research", yours: "Your notes",
};
/** Pure. The provenance chips of a saved teaching: from the learner's sections, AI-written, research where it has some. */
export function provenanceOf(a: { content: string; refs: readonly unknown[]; sources: readonly string[] }, notes = 0): Provenance[] {
  const research = /^[\s*_#>-]*FROM RESEARCH:?/im.test(a.content) || a.refs.some(r => !!r && typeof r === "object" && (r as { kind?: unknown }).kind === "external");
  return [...(a.sources.length ? ["notes" as const] : []), "ai" as const, ...(research ? ["research" as const] : []), ...(notes > 0 ? ["yours" as const] : [])];
}

/** Pure. "Current version" or "Earlier version, saved 3 October 2026" (UTC, so the server and the browser agree). */
export function versionLabel(v: { createdAt: string; supersededAt?: string | null }): string {
  if (!v.supersededAt) return "Current version";
  const d = new Date(v.createdAt);
  const day = Number.isNaN(d.getTime()) ? String(v.createdAt).slice(0, 10) : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return `Earlier version, saved ${day}`;
}

/** The base key of a saved teaching (the 820 superseded suffix removed). */
export const baseKey = (dedupeKey: string) => dedupeKey.replace(/:superseded:[0-9a-f-]{36}$/, "");
/** The key a superseded version keeps: key:superseded:id, so the unique (user_id, dedupe_key) still holds. */
export const supersededKey = (dedupeKey: string, id: string) => `${baseKey(dedupeKey)}:superseded:${id}`;
/** Pure. Versions of one teaching, newest first, the current one (not superseded) first of all. */
export function orderVersions<T extends { createdAt: string; supersededAt?: string | null }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.supersededAt ? 1 : 0) - (b.supersededAt ? 1 : 0) || b.createdAt.localeCompare(a.createdAt));
}

export type LessonLink = { kind: "linked" | "matched"; sessionId: string; step: number };
export const LESSON_LINK_LABEL: Record<LessonLink["kind"], string> = { linked: "Linked to its lesson", matched: "Matched by sections" };
/**
 * Pure. The lesson a saved teaching belongs to: the one 820 recorded at save (linked), else -- for an older row only -- a
 * lesson whose chunk set its sources begin with EXACTLY (matched by sections), and only when exactly one most specific lesson does.
 * `coversLesson` is learn-journey's rule, passed in so this file stays free of it.
 */
export function lessonLinkOf(
  a: { sessionId?: string | null; step?: number | null; sources: readonly string[] },
  lessons: readonly { sessionId: string; step: number; chunkIds: readonly string[] }[],
  coversLesson: (sources: readonly string[], chunkIds: readonly string[]) => boolean,
): LessonLink | null {
  if (a.sessionId && Number.isInteger(a.step)) return { kind: "linked", sessionId: a.sessionId, step: a.step as number };
  // The most specific lesson wins (its whole chunk set leads the sources): a teaching on [B, C] is lesson [C, B], not
  // lesson [B]. Two lessons equally specific are ambiguous, and nothing is linked.
  const hits = lessons.filter(l => coversLesson(a.sources, l.chunkIds));
  const most = Math.max(0, ...hits.map(l => new Set(l.chunkIds).size));
  const best = hits.filter(l => new Set(l.chunkIds).size === most);
  return best.length === 1 ? { kind: "matched", sessionId: best[0].sessionId, step: best[0].step } : null;
}

// ── NOTES ──

export type NoteKind = "note" | "bookmark" | "highlight";
export type NoteTarget =
  | { targetKind: "artefact"; artefactId: string; sessionId?: string | null; step?: number | null }
  | { targetKind: "lesson"; sessionId: string; step: number; materialId?: string | null; chunkId?: string | null }
  | { targetKind: "material"; materialId: string }
  | { targetKind: "section"; materialId: string; chunkId: string };
export type NoteInput = NoteTarget & { kind: NoteKind; body: string | null; quote: string | null };
export type NoteProblem = "kind" | "target" | "body" | "quote";
export const NOTE_PROBLEM: Record<NoteProblem, string> = {
  kind: "Choose a note, a bookmark or a highlight.",
  target: "Choose what this note is about.",
  body: `Write your note in 1 to ${NOTE_BODY_MAX} characters.`,
  quote: `Select 1 to ${NOTE_QUOTE_MAX} characters of the lesson to highlight.`,
};

const text = (v: unknown, max: number): string | null | false => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return false;
  const t = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return !t ? null : t.length > max ? false : t;
};
const stepOk = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 200;

/** Pure. A note request checked into exactly one 820 shape (the database CHECKs say the same), or the first problem. */
export function validateNote(raw: unknown): { ok: true; note: NoteInput } | { ok: false; problem: NoteProblem; message: string } {
  const no = (problem: NoteProblem) => ({ ok: false as const, problem, message: NOTE_PROBLEM[problem] });
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = r.kind;
  if (kind !== "note" && kind !== "bookmark" && kind !== "highlight") return no("kind");
  let target: NoteTarget;
  switch (r.targetKind) {
    case "artefact":
      if (!isId(r.artefactId)) return no("target");
      target = { targetKind: "artefact", artefactId: r.artefactId, ...(isId(r.sessionId) && stepOk(r.step) ? { sessionId: r.sessionId, step: r.step } : {}) };
      break;
    case "lesson":
      if (!isId(r.sessionId) || !stepOk(r.step)) return no("target");
      target = { targetKind: "lesson", sessionId: r.sessionId, step: r.step, ...(isId(r.materialId) ? { materialId: r.materialId } : {}), ...(isId(r.materialId) && isId(r.chunkId) ? { chunkId: r.chunkId } : {}) };
      break;
    case "material":
      if (!isId(r.materialId)) return no("target");
      target = { targetKind: "material", materialId: r.materialId };
      break;
    case "section":
      if (!isId(r.materialId) || !isId(r.chunkId)) return no("target");
      target = { targetKind: "section", materialId: r.materialId, chunkId: r.chunkId };
      break;
    default: return no("target");
  }
  const body = text(r.body, NOTE_BODY_MAX), quote = text(r.quote, NOTE_QUOTE_MAX);
  if (body === false) return no("body");
  if (quote === false) return no("quote");
  if (kind === "note" && !body) return no("body");
  if (kind === "highlight" && !quote) return no("quote");
  return { ok: true, note: { ...target, kind, body: kind === "bookmark" ? null : body, quote: kind === "highlight" ? quote : null } };
}

// ── EXPORT SCOPE ──

export type ExportScopeRequest =
  | { kind: "lesson"; session: string; step: number }
  | { kind: "material"; material: string }
  | { kind: "study"; study: string }
  | { kind: "selected"; ids: string[] }
  | { kind: "topic"; topic: string }
  | { kind: "range"; from: string; to: string };

const STEP_MAX = 500;
/** Pure. Exactly one scope per request (lesson, material, study, selected, topic or a date range), or null. */
export function parseExportScope(u: URLSearchParams): ExportScopeRequest | null {
  // selected: one comma list, or one value per ticked box (a plain form), joined.
  const session = u.get("session"), material = u.get("material"), study = u.get("study"), selected = u.getAll("selected").join(",") || null, topic = u.get("topic");
  const from = u.get("from"), to = u.get("to");
  const range = from !== null || to !== null;
  if ([session, material, study, selected, topic].filter(Boolean).length + (range ? 1 : 0) !== 1) return null;
  if (session) {
    const step = Number(u.get("step"));
    return Number.isInteger(step) && step >= 0 && step <= STEP_MAX ? { kind: "lesson", session, step } : null;
  }
  if (material) return { kind: "material", material };
  if (study) return { kind: "study", study };
  if (selected) {
    const parts = selected.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const ids = [...new Set(parts)];
    return ids.length >= 1 && ids.length <= EXPORT_SELECTED_MAX && ids.every(isId) ? { kind: "selected", ids } : null;
  }
  if (topic) { const t = topic.replace(/\s+/g, " ").trim(); return t.length >= 2 && t.length <= 120 ? { kind: "topic", topic: t } : null; }
  if (!from || !to || !DAY.test(from) || !DAY.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return null;
  return from <= to ? { kind: "range", from, to } : { kind: "range", from: to, to: from };
}

// ── LINKS (relative to the Scholar study area) ──

/** The Learn deep link for a lesson: the session, scrolled to the lesson (no AI on open: saved teaching opens as saved). */
export const lessonHrefPath = (sessionId: string, step: number) => `study/learn?session=${encodeURIComponent(sessionId)}#lesson-${step}`;
/** Learn started on a saved teaching's own sections (the open:true path finds the saved teaching, no AI). */
export const sectionsHrefPath = (chunkIds: readonly string[]) => `study/learn?${chunkIds.slice(0, 24).map(c => `s=${encodeURIComponent(c)}`).join("&")}`;
/** A flashcard, found in All cards by the start of its front. */
export const cardHrefPath = (front: string) => `study/revise/flashcards?view=cards&q=${encodeURIComponent(front.replace(/\s+/g, " ").trim().slice(0, 60))}`;
