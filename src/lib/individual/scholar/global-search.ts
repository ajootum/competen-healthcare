/* eslint-disable @typescript-eslint/no-explicit-any */
import { allowedSearchModules, moduleSearchPath, type SearchAccess, type SearchModuleKey } from "../search/registry";
import { matchesSearch, searchWords } from "../search/match";
import { listEntries } from "../learning-plan/entry-store";
import { loadPracticeRows } from "./apply-context-data";
import { loadLearnerCatalogue } from "./competency-view";
import { displayTitle, parseSearchParams, searchLibrary } from "./learn-search";
import { expandText, expandWebsearch } from "../search/tolerant";
import { learningEnabled } from "@/lib/learning/policy";
import { myRecords } from "@/lib/learning/record";
import { loadLearningRecords } from "@/lib/learning/products";
import { filterCompleted, filterCourses, filterProgrammes, completedView, myCoursesView, programmesView } from "@/app/individual/(app)/[experience]/(scholar)/courses/courses-view";
import { GLOBAL_SEARCH_MAX, GLOBAL_SEARCH_MIN, type GlobalGroup, type GlobalType } from "./global-search-types";
import { materialTopics } from "./library";
import { cardHrefPath, lessonHrefPath } from "./saved-library";
import { getStudyPlan, learnerProgramme, libraryTopics, librarySearch, listEvaluations, listMaterials, listProgrammes, type LibraryHit, type MaterialRow } from "./store";

// COMPETEN UNIVERSAL SEARCH STANDARD: Global Search across Scholar. Each registered module the person may see is searched through
// the reads its own page uses, and always for the signed-in person's own records. No AI. A module the registry refuses is never
// read, so it sends back no result, count or preview.
//
// A result opens the record itself and never starts anything: a section opens in its material, not in a new lesson, because a
// lesson start is a session and AI use. Paths are below /individual/scholar. A source that fails says so and is never shown as zero.

const PER_TYPE = 4;

/** What is typed, tidied, or null where there is too little to search. */
export function parseGlobalQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.replace(/\s+/g, " ").trim().slice(0, GLOBAL_SEARCH_MAX);
  return q.length >= GLOBAL_SEARCH_MIN && searchWords(q).length > 0 ? q : null;
}

/** Pure. Where a saved hit opens. */
export function savedHitPath(h: Pick<LibraryHit, "kind" | "id" | "label" | "sessionId" | "step" | "materialId" | "chunkId" | "artefactId">): string {
  if (h.kind === "lesson") return `study/learn?session=${encodeURIComponent(h.id)}`;
  if (h.kind === "flashcard" || h.kind === "card_note") return cardHrefPath(h.label);
  if (h.sessionId && h.step !== null) return lessonHrefPath(h.sessionId, h.step);
  if (h.materialId) return h.chunkId ? `study/${h.materialId}#c-${h.chunkId}` : `study/${h.materialId}`;
  // COMPETEN-NOTEBOOK-001: a free-standing note has no lesson or material. It opens in My Notebook.
  if (h.kind === "note" && !h.artefactId) return `study/notebook/${encodeURIComponent(h.id)}`;
  return "study/saved";
}

type Ctx = { admin: any; userId: string };
const date = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); };
/** The saved-library search marks what matched with {{hl}} and {{/hl}}, and a page draws them. These results are plain lines. */
export const plainHit = (s: string) => s.replace(/\{\{\/?hl\}\}/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const SAVED_KIND: Record<LibraryHit["kind"], string> = { artefact: "Saved lesson", note: "Your note", lesson: "Learning session", flashcard: "Flashcard", card_note: "Your note on a flashcard" };

type Source = (q: string, shared: { materials: readonly MaterialRow[] | null }) => Promise<GlobalType[] | null>;

function sources(ctx: Ctx): Partial<Record<SearchModuleKey, Source>> {
  const { admin, userId } = ctx;
  return {
    library: async (q, { materials }) => {
      if (!materials) return null;
      const hits = materials.filter(m => matchesSearch([m.title, m.fileName], q));
      return [{ label: "Materials", results: hits.slice(0, PER_TYPE).map(m => ({ id: m.id, title: displayTitle(m.title), detail: m.fileName, path: `study/${m.id}` })) }];
    },
    learn: async (q, { materials }) => {
      if (!materials) return null;
      // Synonyms only: Global Search never corrects spelling, so a misspelling finds nothing rather than quietly showing another term.
      const r = await searchLibrary(admin, userId, { ...parseSearchParams({ q }), q: expandText(q) }, materials);
      if (!r.topics && !r.sections && !r.sessions) return null;
      return [
        { label: "Topics", results: (r.topics?.items ?? []).slice(0, PER_TYPE).map(t => ({ id: t.name, title: t.name, detail: `${t.sections} section${t.sections === 1 ? "" : "s"}`, path: `study/learn?topicView=${encodeURIComponent(t.name)}` })) },
        { label: "Sections of your notes", results: (r.sections?.items ?? []).slice(0, PER_TYPE).map(s => ({ id: s.chunkId, title: s.topics[0] ?? s.materialTitle, detail: `${s.materialTitle}, ${s.location}`, path: `study/${s.materialId}#c-${s.chunkId}` })) },
        { label: "Learning sessions", results: (r.sessions?.items ?? []).slice(0, PER_TYPE).map(s => ({ id: s.id, title: s.title, detail: s.status === "completed" ? "Completed" : "In progress", path: `study/learn?session=${s.id}` })) },
      ];
    },
    // Revise: the same rows its All Topics page lists (a material, with its topics), matched by title and topic. Two reads beyond the
    // shared materials read: libraryTopics (the analysis rows and the learner's topic corrections). Opens the catalogue on that material.
    revise: async (q, { materials }) => {
      if (!materials) return null;
      const topics = await libraryTopics(admin, userId);
      if (topics === null) return null;
      const rows = materials.map(m => ({ m, topics: materialTopics(topics.get(m.id) ?? []).map(t => t.topic) })).filter(r => matchesSearch([r.m.title, ...r.topics], q));
      return [{ label: "Topics to revise", results: rows.slice(0, PER_TYPE).map(r => ({ id: r.m.id, title: displayTitle(r.m.title), detail: r.topics.slice(0, 3).join(", ") || null, path: `study/revise?view=topics&m=${r.m.id}` })) }];
    },
    courses: async q => {
      // My Programmes does not depend on Learning being on, so it is searched either way; the two course lists are read only when it is.
      const on = await learningEnabled(admin);
      const [open, done, chosen, offered] = await Promise.all([
        on ? myRecords(admin, userId).catch(() => null) : Promise.resolve([]), on ? loadLearningRecords(admin, userId).catch(() => null) : Promise.resolve([]),
        learnerProgramme(admin, userId), listProgrammes(admin),
      ]);
      const mine = myCoursesView(on, open), completed = completedView(on, done), programmes = programmesView(chosen, offered);
      // Any one of the three failing means this source could not be searched: it is never shown as having fewer results.
      if (mine.kind === "unreadable" || completed.kind === "unreadable" || programmes.kind === "unreadable") return null;
      const programmeList = programmes.kind === "none" ? programmes.offered : programmes.kind === "chosen" ? [programmes.programme, ...programmes.others] : [];
      return [
        { label: "Courses you are taking", results: (mine.kind === "items" ? filterCourses(mine.items, q) : []).slice(0, PER_TYPE).map(c => ({ id: c.id, title: c.title, detail: `${c.code} · ${c.statusLabel}`, path: `courses/mine?q=${encodeURIComponent(c.title)}` })) },
        { label: "Completed courses", results: (completed.kind === "items" ? filterCompleted(completed.items, q) : []).slice(0, PER_TYPE).map(c => ({ id: c.recordId, title: c.title, detail: c.outcomeLabel, path: `courses/progress?q=${encodeURIComponent(c.title)}` })) },
        { label: "Programmes", results: filterProgrammes(programmeList, q).slice(0, PER_TYPE).map(p => ({ id: p.code, title: p.label, detail: p.profession, path: `courses/programmes?q=${encodeURIComponent(p.label)}` })) },
      ];
    },
    saved: async q => {
      const r = await librarySearch(admin, userId, expandWebsearch(q), PER_TYPE, 0);
      if (!r.ok) return null;
      return [{ label: "Saved lessons, notes and cards", results: r.data.rows.map(h => {
        // An artefact's label is the action that made it ("teach"): its kind says more. The others are labelled by their own words.
        const label = plainHit(h.label);
        return { id: `${h.kind}-${h.id}`, title: h.kind === "note" ? (label === "highlight" ? "Your highlight" : "Your note") : h.kind === "artefact" || !label ? SAVED_KIND[h.kind] : label, detail: plainHit(h.headline).slice(0, 110) || null, path: savedHitPath(h) };
      }) }];
    },
    apply: async q => {
      const catalogue = (await loadLearnerCatalogue(admin, userId)).competencies ?? [];
      const rows = await loadPracticeRows(ctx as never, { competencyTitle: id => catalogue.find(c => c.id === id)?.title ?? null });
      const hits = rows.filter(r => matchesSearch([r.title, ...r.concepts, ...r.competencies, ...r.sources, ...r.gaps], q));
      return [{ label: "Cases, OSCE stations and papers", results: hits.slice(0, PER_TYPE).map(r => ({ id: r.key, title: r.title, detail: date(r.lastAt), path: r.href.replace(/^\/individual\/scholar\//, "") })) }];
    },
    evaluate: async q => {
      const r = await listEvaluations(admin, userId, 100);
      if (!r.ok) return null;
      const hits = r.data.filter(e => matchesSearch((e.scope as { label?: string } | null)?.label ?? "", q));
      return [{ label: "Evaluations", results: hits.slice(0, PER_TYPE).map(e => ({ id: e.id, title: (e.scope as { label?: string } | null)?.label ?? "An evaluation", detail: date(e.createdAt), path: `study/evaluate/${e.id}` })) }];
    },
    plan: async q => {
      const [plan, entries] = await Promise.all([getStudyPlan(admin, userId), listEntries(admin, userId, "scholar", "9999-12-31")]);
      if (!plan.ok && !entries.ok) return null;
      const rows = planSearchRows(plan.ok ? plan.data : null, entries.ok ? entries.data.entries : [], q);
      return [{ label: "Goals, priorities and calendar entries", results: rows.slice(0, PER_TYPE).map(r => ({ id: r.id, title: r.title, detail: r.detail, path: r.path })) }];
    },
    competencies: async q => {
      const list = (await loadLearnerCatalogue(admin, userId)).competencies;
      if (!list) return null;
      const hits = list.filter(c => matchesSearch([c.title, c.code ?? ""], q));
      return [{ label: "Competencies", results: hits.slice(0, PER_TYPE).map(c => ({ id: c.id, title: c.title, detail: c.code ?? null, path: `my-competencies?q=${encodeURIComponent(c.title)}` })) }];
    },
  };
}

export type PlanSearchRow = { id: string; title: string; detail: string | null; path: string; kind: string };

/** Pure. What in My Plan answers a search: the learner's goal, exam and priorities, then their own calendar entries, soonest first. */
export function planSearchRows(
  plan: { goal: string | null; examLabel: string | null; examDate: string | null; priorities: readonly string[] } | null,
  entries: readonly { id: string; title: string; description?: string | null; entryDate: string; status?: string }[],
  q: string,
): PlanSearchRow[] {
  const rows: PlanSearchRow[] = [];
  if (plan?.goal && matchesSearch(plan.goal, q)) rows.push({ id: "goal", title: plan.goal, detail: "Your goal", path: "study/plan?view=today", kind: "Goal" });
  if (plan?.examLabel && matchesSearch(plan.examLabel, q)) rows.push({ id: "exam", title: plan.examLabel, detail: plan.examDate ? `Exam, ${date(`${plan.examDate}T00:00:00Z`)}` : "Exam", path: "study/plan?view=today", kind: "Exam" });
  for (const [i, p] of (plan?.priorities ?? []).entries()) if (matchesSearch(p, q)) rows.push({ id: `priority-${i}`, title: p, detail: "Your priority", path: "study/plan?view=today", kind: "Priority" });
  const kept = entries.filter(e => e.status !== "cancelled" && matchesSearch([e.title, e.description ?? ""], q)).sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  for (const e of kept) rows.push({ id: e.id, title: e.title, detail: date(`${e.entryDate}T00:00:00Z`), path: `study/plan?view=calendar&date=${e.entryDate}`, kind: "Calendar entry" });
  return rows;
}

/** Every module this person may see, in the registry's order, with what matched. Modules with nothing are left out, except as a way to look there. */
export async function globalSearch(ctx: Ctx, access: SearchAccess, q: string): Promise<GlobalGroup[]> {
  const allowed = allowedSearchModules(access);
  const list = await listMaterials(ctx.admin, ctx.userId);
  const shared = { materials: list.ok ? list.data : null };
  const from = sources(ctx);
  return Promise.all(allowed.map(async (m): Promise<GlobalGroup> => {
    const base = { module: m.key, product: m.product, label: m.label, morePath: moduleSearchPath(m.key, q) };
    const source = from[m.key];
    if (!source) return { ...base, types: [], unreadable: false };
    try {
      const types = await source(q, shared);
      return types ? { ...base, types: types.filter(t => t.results.length > 0), unreadable: false } : { ...base, types: [], unreadable: true };
    } catch {
      return { ...base, types: [], unreadable: true };
    }
  }));
}
