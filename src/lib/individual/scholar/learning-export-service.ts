import { citeChunk } from "./extract";
import { LEARN_ACTION_LABEL, type LearnAction } from "./config";
import { displayTitle, displaySessionTitle } from "./learn-search";
import { lessonOutline, sectionProfiles, sessionTopics } from "./learn";
import { loadCardSelection } from "./flashcard-service";
import {
  artefactIdsForChunks, artefactsByIds, chunksByIds, getConnectedSession, getLearningSession, isUuid, libraryArtefactPage, listLearningSessions, listMaterials, listNotes,
  sectionRefs, sectionTopicRows, type ArtefactRow, type LearningStep, type NoteRow, type SectionRef,
} from "./store";
import { rangeBounds, type Cursor, type ExportScopeRequest } from "./saved-library";
import type {
  ExportCitation, ExportExternal, ExportGoverned, ExportLesson, ExportNote, ExportTeaching, LearningExportInput,
} from "./learning-export";

// ── SAVED LEARNING: THE EXPORT LOADER ── owner instruction 1 Nov 2026 (item 2) ───────────────────────────────────────────
//
// Reads, through the store only and keyed on the caller's own id, what a learner has SAVED -- never anything anyone
// else saved -- and arranges it as the input of learning-export.ts. No AI and no write: every word is already stored.
// A saved teaching (individual_scholar_artefact) belongs to a lesson when every section it was built on is one of the
// lesson's sections; a lesson is a step of a learning session (414), titled by the same deterministic rule Learn uses
// (learn.lessonOutline). Learner-authored text is the learner's own flashcards and card notes on those sections.

type Ctx = { admin: any; userId: string; profile?: { fullName?: string | null } | null }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** SCHOLAR-LIBRARY-01: also selected (at most 100 saved teachings), topic and a date range (saved-library parseExportScope). */
export type ExportRequest = ExportScopeRequest;

export type ExportLoad =
  | { ok: true; input: LearningExportInput; counts: { lessons: number; teachings: number; notes: number } }
  | { ok: false; status: number; error: string };

const MAX_SESSIONS = 40;
const MAX_SECTIONS_LISTED = 12;

const asExternal = (r: any): ExportExternal | null => (r && r.kind === "external" && typeof r.title === "string" // eslint-disable-line @typescript-eslint/no-explicit-any
  ? {
    title: r.title, journal: typeof r.journal === "string" ? r.journal : null, year: typeof r.year === "number" || typeof r.year === "string" ? r.year : null,
    authors: Array.isArray(r.authors) ? r.authors.filter((a: unknown): a is string => typeof a === "string") : [],
    doi: typeof r.doi === "string" ? r.doi : null, pmid: typeof r.pmid === "string" ? r.pmid : null, url: typeof r.url === "string" ? r.url : null,
    excerpt: typeof r.excerpt === "string" ? r.excerpt : null,
  } : null);
const asGoverned = (r: any): ExportGoverned | null => (r && r.kind !== "external" && typeof r.title === "string" // eslint-disable-line @typescript-eslint/no-explicit-any
  ? { title: r.title, code: typeof r.code === "string" ? r.code : null, outcome: typeof r.outcome === "string" ? r.outcome : null, library: !!r.library } : null);

const citationOf = (s: SectionRef) => `${displayTitle(s.materialTitle)}, ${citeChunk(s, s.unit)}`;

function teachingOf(a: ArtefactRow, cites: ReadonlyMap<string, SectionRef>): ExportTeaching {
  const citations: ExportCitation[] = a.sources.flatMap((chunkId, i) => { const s = cites.get(chunkId); return s ? [{ tag: `S${i + 1}`, text: citationOf(s) }] : []; });
  return {
    actionLabel: LEARN_ACTION_LABEL[a.action as LearnAction] ?? a.action, depth: a.depth || null, savedAt: a.createdAt, content: a.content, background: a.background,
    flags: a.flags.map(f => f.text).filter(t => typeof t === "string" && t.trim()), model: a.model || null, promptVersion: a.promptVersion || null,
    citations, governed: a.refs.map(asGoverned).filter((x): x is ExportGoverned => !!x), external: a.refs.map(asExternal).filter((x): x is ExportExternal => !!x),
  };
}

/** Everything the lessons need, read once: the saved teachings, their section citations, the materials and the learner's own cards. */
/** At most this many saved teachings in one file (a material, a topic or a date range, read a page at a time). */
const MAX_TEACHINGS = 1000;
/** Every current saved teaching of one material or date range, page by page (SCHOLAR-LIBRARY-01: no 500-row cap). */
async function allArtefacts(ctx: Ctx, o: { materialId?: string; fromIso?: string | null; toIso?: string | null }): Promise<ArtefactRow[]> {
  const out: ArtefactRow[] = [];
  let cursor: Cursor | null = null;
  do {
    const r = await libraryArtefactPage(ctx.admin, ctx.userId, { materialId: o.materialId ?? null, fromIso: o.fromIso ?? null, toIso: o.toIso ?? null, versions: "current", sort: "newest", cursor, limit: 200 });
    if (!r.ok) break;
    out.push(...r.data.rows);
    cursor = r.data.next;
  } while (cursor && out.length < MAX_TEACHINGS);
  return out.slice(0, MAX_TEACHINGS);
}
/** The current saved teaching built on these sections. */
async function artefactsOn(ctx: Ctx, chunkIds: readonly string[]): Promise<ArtefactRow[]> {
  const ids = await artefactIdsForChunks(ctx.admin, ctx.userId, chunkIds);
  if (!ids?.length) return [];
  const r = await artefactsByIds(ctx.admin, ctx.userId, ids, { currentOnly: true });
  return r.ok ? r.data : [];
}

async function gather(ctx: Ctx, chunkIds: readonly string[], opts: { materialId?: string; artefacts?: ArtefactRow[]; sessionIds?: string[] } = {}) {
  const [arts, mats, cards] = await Promise.all([
    opts.artefacts ? Promise.resolve(opts.artefacts) : opts.materialId ? allArtefacts(ctx, { materialId: opts.materialId }) : artefactsOn(ctx, chunkIds),
    listMaterials(ctx.admin, ctx.userId),
    loadCardSelection(ctx, {}).catch(() => null),
  ]);
  const artefacts = arts.filter(a => a.sources.length);
  // SCHOLAR-LIBRARY-01 (820): the learner's own notes and highlights on these teachings, their materials and lessons.
  const own = await listNotes(ctx.admin, ctx.userId, { artefactIds: artefacts.map(a => a.id), materialIds: [...new Set(artefacts.map(a => a.materialId))], sessionIds: opts.sessionIds ?? [], limit: 1000 });
  const ids = [...new Set([...chunkIds, ...artefacts.flatMap(a => a.sources)])];
  const read = ids.length ? await chunksByIds(ctx.admin, ctx.userId, ids, false) : null;
  const refs = read?.ok ? await sectionRefs(ctx.admin, ctx.userId, read.data) : [];
  return {
    artefacts, cites: new Map(refs.map(r => [r.chunkId, r])),
    materials: new Map((mats.ok ? mats.data : []).map(m => [m.id, { title: displayTitle(m.title), uploadedAt: m.createdAt }])),
    cards: cards && cards.ok ? cards.cards : [],
    own: own.ok ? own.data.rows.filter(n => n.kind !== "bookmark") : ([] as NoteRow[]),
  };
}
type Gathered = Awaited<ReturnType<typeof gather>>;

/** The learner's own words on these sections: the cards they wrote, and the notes they added to any card. */
function notesFor(g: Gathered, chunkIds: ReadonlySet<string>, artefactIds: ReadonlySet<string> = new Set(), lesson: { sessionId: string; step: number } | null = null): ExportNote[] {
  const out: ExportNote[] = [];
  // SCHOLAR-LIBRARY-01 (820): what the learner wrote in Learn and the library, on these teachings, this lesson or sections.
  for (const n of g.own) {
    const mine = (n.artefactId && artefactIds.has(n.artefactId)) || (lesson && n.sessionId === lesson.sessionId && n.step === lesson.step) || (n.targetKind === "section" && n.chunkId && chunkIds.has(n.chunkId));
    if (!mine) continue;
    if (n.kind === "highlight") out.push({ kind: "highlight", text: n.quote ?? "", savedAt: n.updatedAt ?? n.createdAt, detail: n.body ? `Your comment: ${n.body}` : null });
    else out.push({ kind: "note", text: n.body ?? "", savedAt: n.updatedAt ?? n.createdAt, detail: null });
  }
  for (const c of g.cards) {
    if (!chunkIds.has(c.chunkId) && !c.sources.some(s => s.chunkId && chunkIds.has(s.chunkId))) continue;
    if (c.origin === "learner") out.push({ kind: "flashcard", text: `${c.front} — ${c.back}`, savedAt: c.createdAt, detail: c.explanation });
    if (c.note?.trim()) out.push({ kind: "note", text: c.note, savedAt: c.updatedAt ?? c.createdAt, detail: `Your note on a ${c.origin === "learner" ? "card you wrote" : "card"} about: ${c.front}` });
  }
  return out;
}

function lessonOf(step: LearningStep, outline: { title: string; objective: string }, sessionTitle: string | null, g: Gathered, used: Set<string>, onlyWithTeaching = false, sessionId: string | null = null): ExportLesson | null {
  const chunkIds = new Set(step.sections.map(s => s.chunkId));
  const mine = g.artefacts.filter(a => !used.has(a.id) && a.sources.length > 0 && a.sources.every(id => chunkIds.has(id)));
  if (onlyWithTeaching && !mine.length) return null;
  mine.forEach(a => used.add(a.id));
  const matIds = [...new Set(step.sections.map(s => s.materialId))];
  const sections = step.sections.map(citationOf);
  return {
    title: outline.title, objective: outline.objective, step: step.step, sessionTitle,
    material: matIds.map(id => g.materials.get(id) ?? { title: displayTitle(step.sections.find(s => s.materialId === id)?.materialTitle ?? ""), uploadedAt: null }),
    sections: sections.length > MAX_SECTIONS_LISTED ? [...sections.slice(0, MAX_SECTIONS_LISTED), `and ${sections.length - MAX_SECTIONS_LISTED} more`] : sections,
    teachings: mine.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(a => teachingOf(a, g.cites)),
    notes: notesFor(g, chunkIds, new Set(mine.map(a => a.id)), sessionId ? { sessionId, step: step.step } : null),
  };
}

const counts = (lessons: ExportLesson[]) => ({ lessons: lessons.length, teachings: lessons.reduce((n, l) => n + l.teachings.length, 0), notes: lessons.reduce((n, l) => n + l.notes.length, 0) });
const wrap = (ctx: Ctx, scope: LearningExportInput["scope"], title: string, lessons: ExportLesson[], extra: { objective?: string | null } = {}): ExportLoad => ({
  ok: true, counts: counts(lessons),
  input: { scope, title, learner: ctx.profile?.fullName ?? null, generatedAt: new Date().toISOString(), objective: extra.objective ?? null, lessons },
});

async function outlines(ctx: Ctx, steps: readonly LearningStep[]) {
  const ids = steps.flatMap(s => s.sections.map(x => x.chunkId));
  const [topics, profiles] = await Promise.all([sessionTopics(ctx.admin, ctx.userId, ids), sectionProfiles(ctx.admin, ctx.userId, ids)]);
  return new Map(steps.map(s => [s, lessonOutline(s, topics, profiles)]));
}

/** The caller's own saved lessons the request names. 404 (non-disclosing) for anything that is not the caller's. */
export async function loadLearningExport(ctx: Ctx, req: ExportRequest): Promise<ExportLoad> {
  const notFound: ExportLoad = { ok: false, status: 404, error: "Nothing to export was found." };
  if (req.kind === "selected" || req.kind === "topic" || req.kind === "range") return loadChosen(ctx, req);

  if (req.kind === "lesson" || req.kind === "study") {
    const id = req.kind === "lesson" ? req.session : req.study;
    if (!isUuid(id)) return notFound;
    const study = req.kind === "study" ? await getConnectedSession(ctx.admin, ctx.userId, id) : null;
    if (req.kind === "study" && !study) return notFound;
    const r = await getLearningSession(ctx.admin, ctx.userId, id);
    if (!r.ok) return { ok: false, status: r.notProvisioned ? 409 : 503, error: r.notProvisioned ? "Learning history is not available here." : "Your saved learning could not be read just now." };
    if (!r.data) return notFound;
    const steps = req.kind === "lesson" ? r.data.steps.filter(s => s.step === req.step) : r.data.steps;
    if (!steps.length) return notFound;
    const [g, outline] = await Promise.all([gather(ctx, steps.flatMap(s => s.sections.map(x => x.chunkId)), { sessionIds: [id] }), outlines(ctx, steps)]);
    const sessionTitle = displaySessionTitle(r.data.session.title);
    const used = new Set<string>();
    const lessons = steps.map(s => lessonOf(s, outline.get(s)!, sessionTitle, g, used, false, id)!).filter(Boolean);
    return wrap(ctx, req.kind, req.kind === "lesson" ? `Saved lesson: ${lessons[0]?.title ?? sessionTitle}` : `Study session: ${sessionTitle}`, lessons,
      { objective: study ? (study.objectiveText ?? null) : null });
  }

  // material: every saved teaching on it, arranged under the lessons (steps of the caller's sessions) it belongs to.
  if (!isUuid(req.material)) return notFound;
  const g = await gather(ctx, [], { materialId: req.material });
  const mat = g.materials.get(req.material);
  if (!mat) return notFound;
  const sessions = await listLearningSessions(ctx.admin, ctx.userId, MAX_SESSIONS);
  const used = new Set<string>();
  const lessons: ExportLesson[] = [];
  for (const s of sessions.ok ? sessions.data : []) {
    if (used.size >= g.artefacts.length) break;
    const r = await getLearningSession(ctx.admin, ctx.userId, s.id);
    if (!r.ok || !r.data) continue;
    const steps = r.data.steps.filter(st => st.sections.some(x => x.materialId === req.material));
    if (!steps.length) continue;
    const outline = await outlines(ctx, steps);
    for (const st of steps) { const l = lessonOf(st, outline.get(st)!, displaySessionTitle(s.title), g, used, true, s.id); if (l) lessons.push(l); }
  }
  // Teaching whose lesson is no longer in a session: kept, under the sections it was built on.
  const orphans = g.artefacts.filter(a => !used.has(a.id));
  if (orphans.length) {
    const sections = [...new Set(orphans.flatMap(a => a.sources).map(id => g.cites.get(id)).filter((x): x is SectionRef => !!x).map(citationOf))];
    lessons.push({
      title: "Other saved teaching", objective: null, step: null, sessionTitle: null, material: [mat],
      sections: sections.length > MAX_SECTIONS_LISTED ? [...sections.slice(0, MAX_SECTIONS_LISTED), `and ${sections.length - MAX_SECTIONS_LISTED} more`] : sections,
      teachings: orphans.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(a => teachingOf(a, g.cites)),
      notes: notesFor(g, new Set(orphans.flatMap(a => a.sources)), new Set(orphans.map(a => a.id))),
    });
  }
  return wrap(ctx, "material", `Saved lessons: ${mat.title}`, lessons);
}

/**
 * SCHOLAR-LIBRARY-01: chosen saved teachings (selected, any version), a topic's or a date range's (current versions),
 * arranged one lesson per material, oldest first, each with the learner's own notes on them. Stored words only.
 */
async function loadChosen(ctx: Ctx, req: Extract<ExportRequest, { kind: "selected" | "topic" | "range" }>): Promise<ExportLoad> {
  let arts: ArtefactRow[] = [];
  let title: string;
  if (req.kind === "selected") {
    const r = await artefactsByIds(ctx.admin, ctx.userId, req.ids);
    if (!r.ok) return { ok: false, status: r.notProvisioned ? 409 : 503, error: "Your saved learning could not be read just now." };
    arts = r.data; title = `Selected saved lessons (${arts.length})`;
  } else if (req.kind === "topic") {
    const rows = await sectionTopicRows(ctx.admin, ctx.userId);
    const want = req.topic.toLowerCase();
    const chunks = rows.ok ? rows.data.filter(r => r.topics.some(t => t.toLowerCase() === want)).map(r => r.chunkId) : [];
    arts = (await artefactsOn(ctx, chunks)).slice(0, MAX_TEACHINGS); title = `Saved lessons on ${req.topic}`;
  } else {
    const b = rangeBounds(req.from, req.to);
    arts = await allArtefacts(ctx, { fromIso: b.fromIso, toIso: b.toIso }); title = `Saved lessons, ${req.from} to ${req.to}`;
  }
  if (!arts.length) return { ok: false, status: 404, error: "Nothing to export was found." };
  const g = await gather(ctx, [], { artefacts: arts });
  const byMat = new Map<string, ArtefactRow[]>();
  for (const a of g.artefacts) byMat.set(a.materialId, [...(byMat.get(a.materialId) ?? []), a]);
  const lessons: ExportLesson[] = [...byMat].map(([materialId, list]) => {
    const sections = [...new Set(list.flatMap(a => a.sources).map(id => g.cites.get(id)).filter((x): x is SectionRef => !!x).map(citationOf))];
    const mat = g.materials.get(materialId) ?? { title: "Your material", uploadedAt: null };
    return {
      title: mat.title, objective: null, step: null, sessionTitle: null, material: [mat],
      sections: sections.length > MAX_SECTIONS_LISTED ? [...sections.slice(0, MAX_SECTIONS_LISTED), `and ${sections.length - MAX_SECTIONS_LISTED} more`] : sections,
      teachings: list.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(a => teachingOf(a, g.cites)),
      notes: notesFor(g, new Set(list.flatMap(a => a.sources)), new Set(list.map(a => a.id))),
    };
  });
  return wrap(ctx, req.kind, title, lessons);
}
