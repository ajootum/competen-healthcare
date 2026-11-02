import { PDF_MIME, PPTX_MIME } from "./config";
import { searchTerms } from "./retrieval";
import { HL_START, HL_STOP, type LibraryQuery } from "./saved-library";

// ── SCHOLAR-CE-2026 CE-02: THE LIBRARY, ORGANISED ── one search, filters, actions from a saved item, note provenance ──────
//
// Pure and client-safe: no I/O, no clock, no AI. The library page (study/saved) reads what it needs through store.ts and shapes
// it through this file, so each rule is tested in library-organise.test.ts:
//
//   OWNERSHIP   a filter id the learner does not own is DROPPED (`ownedQuery`): learner B naming learner A's material or session
//               gets the same page as naming nothing. The store reads are all keyed on the caller as well.
//   FILTERS     material / topic / study session / competency, URL-driven. Each filter becomes a scope (`FilterScope`); a saved
//               lesson, note, question, card or section is kept only if it passes EVERY active filter (`itemAllowed`).
//   SEARCH      saved lessons, notes, sessions and cards come from the 820 RPC; "From your materials" is the learner's own section
//               text (first SECTION_FIRST, then SECTION_PAGE more at a time). Hits are grouped, never re-ranked across groups.
//   ACTIONS     Ask / Revise / Practise / Open source from any item that has a section or a material (links only, no AI).

export const SECTION_FIRST = 10;
export const SECTION_PAGE = 10;
/** Search hits read before filters are applied (the RPC returns 50 at most per call). */
export const FILTERED_SEARCH_READ = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

// ── OWNERSHIP AND CHIPS ──

export type Owned = { materialIds: ReadonlySet<string>; sessionIds: ReadonlySet<string>; competencyIds: ReadonlySet<string> | null };
/** Pure. The request with every id the learner does not own removed (a competency is checked only when the catalogue was read). */
export function ownedQuery(q: LibraryQuery, owned: Owned): LibraryQuery {
  return {
    ...q,
    material: q.material && owned.materialIds.has(q.material) ? q.material : null,
    session: q.session && owned.sessionIds.has(q.session) ? q.session : null,
    competency: q.competency && (owned.competencyIds === null || owned.competencyIds.has(q.competency)) ? q.competency : null,
  };
}

export type FilterKey = "material" | "topic" | "session" | "competency";
export type FilterChip = { key: FilterKey; label: string; text: string };
export const FILTER_LABEL: Record<FilterKey, string> = { material: "Material", topic: "Topic", session: "Study session", competency: "Competency" };

/** Pure. The active filters as removable chips, in a fixed order. An id with no known name still shows (as "Chosen"). */
export function filterChips(q: Pick<LibraryQuery, FilterKey>, names: { materials: ReadonlyMap<string, string>; sessions: ReadonlyMap<string, string>; competencies: ReadonlyMap<string, string> }): FilterChip[] {
  const out: FilterChip[] = [];
  if (q.material) out.push({ key: "material", label: FILTER_LABEL.material, text: names.materials.get(q.material) ?? "Chosen material" });
  if (q.topic) out.push({ key: "topic", label: FILTER_LABEL.topic, text: q.topic });
  if (q.session) out.push({ key: "session", label: FILTER_LABEL.session, text: names.sessions.get(q.session) ?? "Chosen session" });
  if (q.competency) out.push({ key: "competency", label: FILTER_LABEL.competency, text: names.competencies.get(q.competency) ?? "Chosen competency" });
  return out;
}
export const hasLibraryFilters = (q: Pick<LibraryQuery, FilterKey>) => !!(q.material || q.topic || q.session || q.competency);

// ── THE FILTER SCOPE: WHICH ITEMS PASS ──

/** What the store resolved for the active filters (null: that filter is not active). Every set is the caller's own. */
export type FilterScope = {
  material: string | null;
  session: string | null;
  /** Sections allowed by the topic and/or competency filters (intersected). */
  chunkSet: ReadonlySet<string> | null;
  /** Saved lessons built on those sections. */
  chunkArtefacts: ReadonlySet<string> | null;
  /** The session's own sections (its steps). */
  sessionChunks: ReadonlySet<string> | null;
  /** Saved lessons that belong to the session. */
  sessionArtefacts: ReadonlySet<string> | null;
  /** Looked up for the items shown: a lesson's material, and the materials a session teaches from. */
  artefactMaterial: ReadonlyMap<string, string>;
  sessionMaterials: ReadonlyMap<string, ReadonlySet<string>>;
};
export const NO_SCOPE: FilterScope = {
  material: null, session: null, chunkSet: null, chunkArtefacts: null, sessionChunks: null, sessionArtefacts: null, artefactMaterial: new Map(), sessionMaterials: new Map(),
};
export const scopeActive = (s: FilterScope) => !!(s.material || s.session || s.chunkSet);

export type ItemRef = { materialId: string | null; sessionId: string | null; artefactId: string | null; chunkId: string | null };

/** Pure. The materials an item belongs to: its own, else its saved lesson's, else the ones its session teaches from. */
export function materialsOf(i: ItemRef, s: Pick<FilterScope, "artefactMaterial" | "sessionMaterials">): string[] {
  if (i.materialId) return [i.materialId];
  const a = i.artefactId ? s.artefactMaterial.get(i.artefactId) : null;
  if (a) return [a];
  return i.sessionId ? [...(s.sessionMaterials.get(i.sessionId) ?? [])] : [];
}

/** Pure. Whether a saved lesson, note, question, card or session passes every active filter. */
export function itemAllowed(i: ItemRef, s: FilterScope): boolean {
  if (s.material && !materialsOf(i, s).includes(s.material)) return false;
  if (s.session && !(i.sessionId === s.session || (i.artefactId !== null && !!s.sessionArtefacts?.has(i.artefactId)) || (i.chunkId !== null && !!s.sessionChunks?.has(i.chunkId)))) return false;
  if (s.chunkSet && !((i.chunkId !== null && s.chunkSet.has(i.chunkId)) || (i.artefactId !== null && !!s.chunkArtefacts?.has(i.artefactId)))) return false;
  return true;
}

/** Pure. Whether one of the learner's sections passes every active filter. */
export function chunkAllowed(c: { id: string; materialId: string }, s: FilterScope): boolean {
  if (s.material && c.materialId !== s.material) return false;
  if (s.session && !s.sessionChunks?.has(c.id)) return false;
  if (s.chunkSet && !s.chunkSet.has(c.id)) return false;
  return true;
}

// ── SEARCH RESULTS: GROUPS ──

export type HitKind = "artefact" | "note" | "lesson" | "flashcard" | "card_note";
export type HitGroupKey = "lessons" | "notes" | "cards" | "sessions";
export const HIT_GROUP_LABEL: Record<HitGroupKey, string> = {
  lessons: "Saved lessons", notes: "Your notes", cards: "Flashcards and questions", sessions: "Learning sessions",
};
const GROUP_OF: Record<HitKind, HitGroupKey> = { artefact: "lessons", note: "notes", card_note: "notes", flashcard: "cards", lesson: "sessions" };
const GROUP_ORDER: HitGroupKey[] = ["lessons", "notes", "cards", "sessions"];

/** Pure. Hits grouped by what they are, the groups in a fixed order, each group keeping the search's own rank order. Empty groups are left out. */
export function groupHits<T extends { kind: HitKind }>(hits: readonly T[]): { key: HitGroupKey; label: string; hits: T[] }[] {
  const by = new Map<HitGroupKey, T[]>();
  for (const h of hits) { const k = GROUP_OF[h.kind]; by.set(k, [...(by.get(k) ?? []), h]); }
  return GROUP_ORDER.filter(k => by.has(k)).map(k => ({ key: k, label: HIT_GROUP_LABEL[k], hits: by.get(k)! }));
}

/** Pure. With filters active the search is read wide (up to FILTERED_SEARCH_READ best matches), filtered, and paged here. */
export function pageFiltered<T>(rows: readonly T[], allow: (r: T) => boolean, page: number, size: number): { items: T[]; total: number } {
  const kept = rows.filter(allow);
  return { items: kept.slice((page - 1) * size, page * size), total: kept.length };
}

// ── "FROM YOUR MATERIALS" ──

export type SectionRow = { id: string; materialId: string; ordinal: number; pageFrom: number | null; pageTo: number | null; content: string };
export type MaterialName = { title: string; mime: string | null; unit: "page" | "slide" | "section" };
export type SectionHit = {
  chunkId: string; materialId: string; materialTitle: string;
  /** "Slide 4", "Pages 3-4" or "Section 7". */
  location: string;
  /** The excerpt with {{hl}} marks (render with snippetParts). */
  headline: string;
  openInLearn: string; original: OriginalLink | null; sourceHref: string;
};

/** Pure. "Slide 4" / "Pages 3-4" / "Section 7", capitalised, from the section's own citation fields. */
export function locationLabel(c: { ordinal: number; pageFrom: number | null; pageTo: number | null }, unit: MaterialName["unit"]): string {
  if (c.pageFrom === null) return `Section ${c.ordinal}`;
  const word = unit === "slide" ? "Slide" : "Page";
  return c.pageTo !== null && c.pageTo !== c.pageFrom ? `${word}s ${c.pageFrom}-${c.pageTo}` : `${word} ${c.pageFrom}`;
}

/**
 * Pure. A short excerpt of a section around the first search term, with every word that starts like a term marked. The terms are
 * the retrieval terms (letters and digits, stop words and "OR" removed), so nothing odd is matched. Marks are {{hl}} text markers,
 * rendered as <mark> by splitting text (snippetParts), never as HTML.
 */
export function markExcerpt(content: string, query: string, width = 240): string {
  const text = String(content ?? "").replace(/\{\{\/?hl\}\}/g, "").replace(/\s+/g, " ").trim();
  const terms = searchTerms(query).map(t => (t.length > 5 ? t.slice(0, 5) : t));
  if (!terms.length) return text.slice(0, width) + (text.length > width ? " …" : "");
  const low = text.toLowerCase();
  const at = terms.map(t => low.indexOf(t)).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 80);
  const piece = text.slice(start, start + width);
  const re = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[a-z0-9]*`, "gi");
  return `${start > 0 ? "… " : ""}${piece.replace(re, m => `${HL_START}${m}${HL_STOP}`)}${start + width < text.length ? " …" : ""}`;
}

/**
 * Pure. The sections of one search page: the learner's candidates (already ranked), those that pass the filters, and the slice
 * asked for -- SECTION_FIRST on the first page, SECTION_PAGE more on each later one. `more` says there are sections beyond the slice.
 */
export function sectionHits(ranked: readonly SectionRow[], q: string, names: ReadonlyMap<string, MaterialName>, scope: FilterScope, msec: number): { hits: SectionHit[]; total: number; more: boolean } {
  const kept = ranked.filter(c => chunkAllowed(c, scope));
  const end = SECTION_FIRST + (Math.max(1, msec) - 1) * SECTION_PAGE;
  const hits = kept.slice(0, end).map(c => {
    const n = names.get(c.materialId) ?? { title: "Your material", mime: null, unit: "page" as const };
    return {
      chunkId: c.id, materialId: c.materialId, materialTitle: n.title, location: locationLabel(c, n.unit), headline: markExcerpt(c.content, q),
      openInLearn: learnSectionPath(c.id), original: originalLink(c.materialId, n.mime, c.pageFrom, n.unit), sourceHref: sectionSourcePath(c.materialId, c.id),
    };
  });
  return { hits, total: kept.length, more: kept.length > end };
}

// ── LINKS (relative to the Scholar study area) ──

/** Learn on one section (opens its saved teaching where it has one, no AI on open). */
export const learnSectionPath = (chunkId: string) => `study/learn?section=${encodeURIComponent(chunkId)}`;
/** The section as written in the learner's material. */
export const sectionSourcePath = (materialId: string, chunkId: string) => `study/${encodeURIComponent(materialId)}#c-${encodeURIComponent(chunkId)}`;
/** The Flashcards landing for a material, and a section of it where there is one (the page reads ?material= and ?section=). */
export const reviseCardsPath = (materialId: string, chunkId: string | null) =>
  `study/revise/flashcards?material=${encodeURIComponent(materialId)}${chunkId ? `&section=${encodeURIComponent(chunkId)}` : ""}`;
/** Practice: the section in Learn (which has its own quiz), else the material's questions in Revise. */
export const practisePath = (materialId: string | null, chunkId: string | null): string | null =>
  chunkId ? learnSectionPath(chunkId) : materialId ? `study/revise?material=${encodeURIComponent(materialId)}` : null;

export type OriginalLink = { href: string; label: string; newTab: boolean };
/**
 * Pure. Where the original page or slide can be seen, where the file keeps pages: a PowerPoint's own slide picture, or the PDF opened at
 * that page (the routes the material page already uses, private to the learner). Anything else has no original page: null.
 */
export function originalLink(materialId: string, mime: string | null, pageFrom: number | null, unit: MaterialName["unit"]): OriginalLink | null {
  if (pageFrom === null || !isId(materialId) || !Number.isInteger(pageFrom) || pageFrom < 1) return null;
  if (mime === PPTX_MIME) return { href: `/api/individual/scholar/materials/${materialId}/slides?slide=${pageFrom}`, label: `View original slide ${pageFrom}`, newTab: true };
  if (mime === PDF_MIME) return { href: `/api/individual/scholar/materials/${materialId}#page=${pageFrom}`, label: `View original ${unit === "slide" ? "slide" : "page"} ${pageFrom}`, newTab: true };
  return null;
}

export type ItemAction = { key: "revise" | "practise" | "source"; label: string; path: string };
/** Pure. Revise / Practise / Open source for an item, whichever of material and section it has. Nothing when it has neither. */
export function itemActions(i: { materialId: string | null; chunkId: string | null }): ItemAction[] {
  const out: ItemAction[] = [];
  if (i.materialId) out.push({ key: "revise", label: i.chunkId ? "Revise (flashcards)" : "Revise this material", path: reviseCardsPath(i.materialId, i.chunkId) });
  const p = practisePath(i.materialId, i.chunkId);
  if (p) out.push({ key: "practise", label: i.chunkId ? "Practise (in Learn)" : "Practise this material", path: p });
  if (i.materialId) out.push({ key: "source", label: i.chunkId ? "Open source" : "Open material", path: i.chunkId ? sectionSourcePath(i.materialId, i.chunkId) : `study/${encodeURIComponent(i.materialId)}` });
  return out;
}

// ── NOTES: PROVENANCE ──

const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); };

/** Pure. "Written 2 Nov 2026" or "Written 2 Nov 2026 · edited 3 Nov 2026" (edited only when it was changed on a later day, UTC). */
export function noteDatesLabel(createdAt: string, updatedAt?: string | null): string {
  const made = day(createdAt);
  const edited = updatedAt && !Number.isNaN(new Date(updatedAt).getTime()) && day(updatedAt) !== made && new Date(updatedAt).getTime() > new Date(createdAt).getTime() ? day(updatedAt) : null;
  return edited ? `Written ${made} · edited ${edited}` : `Written ${made}`;
}

export type NoteAttach = { targetKind: "artefact" | "lesson" | "material" | "section"; materialTitle?: string | null; lessonTitle?: string | null; sessionTitle?: string | null; step?: number | null; location?: string | null };
/** Pure. What a note is attached to, in words: "Saved lesson: X", "Lesson 3 of Y", "Material: Z, Slide 4". */
export function noteAttachedTo(n: NoteAttach): string {
  const mat = n.materialTitle ? `${n.materialTitle}` : "your material";
  switch (n.targetKind) {
    case "artefact": return `Saved lesson${n.lessonTitle ? `: ${n.lessonTitle}` : ""}${n.materialTitle ? ` (${n.materialTitle})` : ""}`;
    case "lesson": return `${n.sessionTitle ? `${n.sessionTitle} · ` : ""}Lesson ${(n.step ?? 0) + 1}${n.location ? ` · ${n.location}` : ""}`;
    case "section": return `${mat}${n.location ? `, ${n.location}` : ", one section"}`;
    default: return `Material: ${mat}`;
  }
}
