// ── COMPETEN-NOTEBOOK-001 P1 + SCHOLAR-NOTEBOOK-UX-002: THE PERSONAL NOTEBOOK MODEL ── owner instructions 6 Nov 2026 ──────
//
// Pure and client-safe: no I/O, no clock of its own, no AI. The notes are the 820 table widened by migration 1000, never a second
// store. The route, the store and the pages read and shape their requests through this file only, so every rule is tested here.
//
//   CAPTURE   a note needs only its words. Title, tags and links are optional and offered after writing starts.
//   CONTEXT   inside material the lesson, section and source attach by themselves. Anywhere else the note is free-standing.
//   SAFETY    a client key makes a retried first save find the same note, and a revision refuses a save from an old copy.
//   PRIVACY   a note is the learner's own. Nothing here sends it anywhere: no model, no employer, no other learner, no other product.

export const NOTEBOOK_BODY_MAX = 50_000;
export const NOTEBOOK_TITLE_MAX = 200;
export const NOTEBOOK_TAGS_MAX = 12;
export const NOTEBOOK_TAG_MAX = 32;
export const NOTEBOOK_LABEL_MAX = 200;
/** The bounds migration 1001 keeps, the same as a 414 session topic. */
export const NOTEBOOK_TOPIC_MIN = 2;
export const NOTEBOOK_TOPIC_MAX = 120;
export const NOTEBOOK_PAGE = 25;

export const CAPTURED_IN = ["home", "learn", "revise", "apply", "evaluate", "library", "plan", "progress", "notebook", "other"] as const;
export type CapturedIn = (typeof CAPTURED_IN)[number];

/** The owner's words for the capture box. One place, so the box, the panel and the page cannot disagree. */
export const IDEAS = {
  title: "My Ideas & Notes",
  privacy: "Personal · Private",
  linkedLine: "Capture a thought while it is fresh. It will be linked to this lesson automatically.",
  freeLine: "Capture a thought while it is fresh. It stays in My Notebook.",
  placeholder: "An idea, question, reflection or something to explore...",
  patientWarning: "Do not write anything that could identify a patient.",
  never: "Only you can see this. It is not shared with employers or other learners, and it is not sent to AI unless you choose to ask.",
} as const;

export const NOTE_IDENTIFIER_REFUSAL = "That looks like it could identify a patient. Remove it to keep saving. Until then your words stay on this device only.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const ANCHOR = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const stepOk = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 200;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Pure. Learner text with line endings made one and control characters gone. Never trimmed inside: their layout is theirs. */
export const cleanBody = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\r\n?/g, "\n").replace(CONTROL, "");
  return t.trim() ? t : null;
};
const oneLine = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/** Pure. Tags as the learner meant them: no leading #, one space inside, once each whatever the case, at most NOTEBOOK_TAGS_MAX. */
export function cleanTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const t = oneLine(typeof item === "string" ? item.replace(/^#+/, "").replace(/,/g, " ") : null, NOTEBOOK_TAG_MAX);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= NOTEBOOK_TAGS_MAX) break;
  }
  return out;
}

// ── WHAT A NOTE IS ATTACHED TO ──

export type NoteLink =
  | { targetKind: "free" }
  /** Owner, 6 Nov 2026: "Permit optional topic-linked and free-standing notebook entries." A topic is a label in this product, so it is its words. */
  | { targetKind: "topic"; topic: string }
  | { targetKind: "material"; materialId: string }
  | { targetKind: "section"; materialId: string; chunkId: string }
  | { targetKind: "lesson"; sessionId: string; step: number; materialId: string | null; chunkId: string | null };

/** A link as the fields of the link form, so a restored draft shows the link it will save. */
export function linkFields(link: NoteLink): { kind: "none" | "lesson" | "section" | "topic"; topic: string; sessionId: string; step: string; materialId: string; chunkId: string } {
  const none = { topic: "", sessionId: "", step: "", materialId: "", chunkId: "" };
  switch (link.targetKind) {
    case "topic": return { ...none, kind: "topic", topic: link.topic };
    case "lesson": return { ...none, kind: "lesson", sessionId: link.sessionId, step: String(link.step) };
    case "section": return { ...none, kind: "section", materialId: link.materialId, chunkId: link.chunkId };
    case "material": return { ...none, kind: "section", materialId: link.materialId };
    default: return { ...none, kind: "none" };
  }
}

/** What a capture knows about where it happens. Every id is read again on the server by the caller's id. */
export type NoteContext = {
  link: NoteLink;
  sectionLabel: string | null;
  sectionAnchor: string | null;
  capturedIn: CapturedIn;
  studyId: string | null;
};
export const FREE_CONTEXT: NoteContext = { link: { targetKind: "free" }, sectionLabel: null, sectionAnchor: null, capturedIn: "other", studyId: null };

/** Pure. A link from a request, or null when it is not exactly one valid shape. Anything half-formed is refused, never guessed. */
export function parseNoteLink(raw: unknown): NoteLink | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  switch (r.targetKind) {
    case "free": return { targetKind: "free" };
    case "topic": {
      const topic = oneLine(r.topic, NOTEBOOK_TOPIC_MAX + 1);
      return topic && topic.length >= NOTEBOOK_TOPIC_MIN && topic.length <= NOTEBOOK_TOPIC_MAX ? { targetKind: "topic", topic } : null;
    }
    case "material": return isId(r.materialId) ? { targetKind: "material", materialId: r.materialId } : null;
    case "section": return isId(r.materialId) && isId(r.chunkId) ? { targetKind: "section", materialId: r.materialId, chunkId: r.chunkId } : null;
    case "lesson": {
      if (!isId(r.sessionId) || !stepOk(r.step)) return null;
      const materialId = isId(r.materialId) ? r.materialId : null;
      return { targetKind: "lesson", sessionId: r.sessionId, step: r.step, materialId, chunkId: materialId && isId(r.chunkId) ? r.chunkId : null };
    }
    default: return null;
  }
}

/** Pure. The 820 columns a link writes. Every column is named, so moving a note between targets leaves nothing behind. */
export const linkColumns = (l: NoteLink) => ({
  target_kind: l.targetKind,
  artefact_id: null,
  material_id: l.targetKind === "free" || l.targetKind === "topic" ? null : l.materialId,
  chunk_id: l.targetKind === "section" || l.targetKind === "lesson" ? l.chunkId : null,
  session_id: l.targetKind === "lesson" ? l.sessionId : null,
  step: l.targetKind === "lesson" ? l.step : null,
  topic: l.targetKind === "topic" ? l.topic : null,
});

// ── REQUESTS ──

export type CreateInput = { clientKey: string; body: string; title: string | null; tags: string[]; context: NoteContext };
export type Problem = "key" | "body" | "target";
export const PROBLEM: Record<Problem, string> = {
  key: "That note could not be saved. Reload the page and try again. Your words are kept on this device.",
  body: `A note needs some words, and at most ${NOTEBOOK_BODY_MAX.toLocaleString("en-GB")} characters.`,
  target: "That lesson or section could not be found.",
};

const contextOf = (r: Record<string, unknown>, link: NoteLink): NoteContext => {
  const anchor = typeof r.sectionAnchor === "string" && ANCHOR.test(r.sectionAnchor) ? r.sectionAnchor : null;
  return {
    link,
    sectionLabel: oneLine(r.sectionLabel, NOTEBOOK_LABEL_MAX),
    sectionAnchor: anchor,
    capturedIn: (CAPTURED_IN as readonly unknown[]).includes(r.capturedIn) ? (r.capturedIn as CapturedIn) : "other",
    studyId: isId(r.studyId) ? r.studyId : null,
  };
};

/** Pure. The first save of a note: its key, its words, and where it was written (free-standing when nothing valid is said). */
export function validateCreate(raw: unknown): { ok: true; note: CreateInput } | { ok: false; problem: Problem; message: string } {
  const no = (problem: Problem) => ({ ok: false as const, problem, message: PROBLEM[problem] });
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!isId(r.clientKey)) return no("key");
  const body = cleanBody(r.body);
  if (!body || body.length > NOTEBOOK_BODY_MAX) return no("body");
  const ctx = (r.context && typeof r.context === "object" ? r.context : {}) as Record<string, unknown>;
  const link = ctx.link === undefined ? { targetKind: "free" as const } : parseNoteLink(ctx.link);
  if (!link) return no("target");
  return { ok: true, note: { clientKey: r.clientKey.toLowerCase(), body, title: oneLine(r.title, NOTEBOOK_TITLE_MAX), tags: cleanTags(r.tags), context: contextOf(ctx, link) } };
}

export type PatchInput = {
  expectedRevision: number;
  body?: string | null; title?: string | null; tags?: string[]; pinned?: boolean;
  link?: NoteLink; sectionLabel?: string | null; sectionAnchor?: string | null;
  competencyId?: string | null; studyId?: string | null;
};

/** Pure. A change to a note: only the fields that are present. A revision is required, so a save is always made from a known copy. */
export function validatePatch(raw: unknown): { ok: true; patch: PatchInput } | { ok: false; message: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!Number.isInteger(r.expectedRevision) || (r.expectedRevision as number) < 1) return { ok: false, message: PROBLEM.key };
  const patch: PatchInput = { expectedRevision: r.expectedRevision as number };
  if ("body" in r) {
    if (r.body === null) patch.body = null; // a highlight's comment may be removed: the store refuses it on a note
    else { const b = cleanBody(r.body); if (!b || b.length > NOTEBOOK_BODY_MAX) return { ok: false, message: PROBLEM.body }; patch.body = b; }
  }
  if ("title" in r) patch.title = oneLine(r.title, NOTEBOOK_TITLE_MAX);
  if ("tags" in r) patch.tags = cleanTags(r.tags);
  if ("pinned" in r) { if (typeof r.pinned !== "boolean") return { ok: false, message: PROBLEM.key }; patch.pinned = r.pinned; }
  if ("link" in r) {
    const link = parseNoteLink(r.link);
    if (!link) return { ok: false, message: PROBLEM.target };
    patch.link = link;
    patch.sectionLabel = oneLine(r.sectionLabel, NOTEBOOK_LABEL_MAX);
    patch.sectionAnchor = typeof r.sectionAnchor === "string" && ANCHOR.test(r.sectionAnchor) ? r.sectionAnchor : null;
  }
  if ("competencyId" in r) { if (r.competencyId !== null && !isId(r.competencyId)) return { ok: false, message: PROBLEM.target }; patch.competencyId = r.competencyId as string | null; }
  if ("studyId" in r) { if (r.studyId !== null && !isId(r.studyId)) return { ok: false, message: PROBLEM.target }; patch.studyId = r.studyId as string | null; }
  return { ok: true, patch };
}

// ── THE SPACE A CAPTURE HAPPENS IN ──

/** Pure. The Scholar space of a path below /individual/scholar, in the words migration 1000 accepts. */
export function capturedInOf(pathname: string): CapturedIn {
  const p = pathname.replace(/^\/individual\/scholar\/?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  if (!p) return "home";
  if (p === "study/notebook" || p.startsWith("study/notebook/")) return "notebook";
  for (const [seg, space] of [["study/learn", "learn"], ["study/revise", "revise"], ["study/apply", "apply"], ["study/evaluate", "evaluate"], ["study/plan", "plan"], ["study/progress", "progress"], ["study/library", "library"], ["study/saved", "library"]] as const) {
    if (p === seg || p.startsWith(`${seg}/`)) return space;
  }
  return p === "study" || p.startsWith("study/") ? "library" : "other";
}

// ── WHICH SECTION THE LEARNER IS READING, WHEN THEY OPEN QUICK NOTE ──

/**
 * Pure. The capture boxes on the page, in reading order, each with where it ends on screen. A box closes its section, so the section being
 * read is the first box whose bottom is at or below the reading band. Past the last box, the last one. Null when the page has none.
 * Read once, when the learner opens Quick Note: no scroll listener, and nothing on the page moves.
 */
export function pickReadingBox<T extends { bottom: number }>(boxes: readonly T[], bandY: number): T | null {
  if (!boxes.length) return null;
  return boxes.find(b => b.bottom >= bandY) ?? boxes[boxes.length - 1];
}

// ── WORDS ABOUT A NOTE ──

/** Pure. What a note is called in a list: its title, else its first line, shortened at a word. */
export function noteHeading(n: { title?: string | null; body?: string | null; quote?: string | null }, max = 80): string {
  const t = (n.title ?? "").trim() || (n.body ?? "").split("\n").find(l => l.trim())?.trim() || (n.quote ?? "").trim();
  if (!t) return "Untitled note";
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${sp > max / 2 ? cut.slice(0, sp) : cut}…`;
}

/** Pure. The question offered to Ask, built from the learner's own words. It sits in the box to edit, and goes nowhere until they press Ask. */
export const askPrefill = (kind: "develop" | "research", body: string, max: number): string => {
  const lead = kind === "develop" ? "Help me develop this idea: " : "What do my materials say about this question: ";
  const words = body.replace(/\s+/g, " ").trim();
  return `${lead}${words}`.slice(0, max);
};

/** Pure. A study goal's first draft from a note: its title or first line, which the learner edits before anything is added. */
export const goalTitleOf = (n: { title?: string | null; body?: string | null }, max = 120) => noteHeading(n, max);

// ── EXPORT ──

export type ExportNote = { title: string | null; body: string | null; quote: string | null; tags: readonly string[]; where: string | null; createdAt: string; updatedAt: string };
const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : d.toISOString().slice(0, 16).replace("T", " "); };

/** Pure. The learner's notes as one Markdown file, newest first, with their words exactly as written. */
export function notesToMarkdown(notes: readonly ExportNote[], exportedAt: string): string {
  const parts = [`# My Notebook\n\nExported ${day(exportedAt)} UTC. ${notes.length} note${notes.length === 1 ? "" : "s"}. Private to you.\n`];
  for (const n of notes) {
    const head = [`Written ${day(n.createdAt)} UTC`, ...(n.updatedAt !== n.createdAt ? [`edited ${day(n.updatedAt)} UTC`] : []), ...(n.where ? [`on ${n.where}`] : [])].join(", ");
    parts.push([
      `## ${noteHeading(n)}`, "", head,
      ...(n.tags.length ? [`Tags: ${n.tags.join(", ")}`] : []),
      ...(n.quote ? ["", ...n.quote.split("\n").map(l => `> ${l}`)] : []),
      ...(n.body ? ["", n.body] : []),
      "",
    ].join("\n"));
  }
  return parts.join("\n");
}

// ── A DRAFT ON THIS DEVICE ──
// Only words the server has not yet confirmed are kept here, under the signed-in learner's id, and gone as soon as they are saved.

export const DRAFT_PREFIX = "cmp-scholar-note-draft:v1:";
export const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type NoteDraft = {
  clientKey: string; noteId: string | null; revision: number | null; body: string; title: string; tags: string[];
  context: NoteContext; savedAt: number;
};
export const draftKeyOf = (userId: string, clientKey: string) => `${DRAFT_PREFIX}${userId}:${clientKey}`;
export const draftPrefixOf = (userId: string) => `${DRAFT_PREFIX}${userId}:`;

/** Pure. A stored draft, or null for anything that is not one, is empty, or is too old to offer. */
export function parseDraft(raw: string | null, now: number): NoteDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<NoteDraft> & { context?: Partial<NoteContext> };
    if (!isId(d.clientKey) || typeof d.body !== "string" || !d.body.trim() || typeof d.savedAt !== "number" || now - d.savedAt > DRAFT_MAX_AGE_MS) return null;
    const ctx = (d.context ?? {}) as Record<string, unknown>;
    const link = parseNoteLink(ctx.link) ?? { targetKind: "free" as const };
    return {
      clientKey: d.clientKey, noteId: isId(d.noteId) ? d.noteId : null, revision: Number.isInteger(d.revision) ? d.revision as number : null,
      body: d.body, title: typeof d.title === "string" ? d.title : "", tags: cleanTags(d.tags), context: contextOf(ctx, link), savedAt: d.savedAt,
    };
  } catch { return null; }
}
