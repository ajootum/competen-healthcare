// ── SCHOLAR FLASHCARDS: THE SERVER LOADERS ── SCHOLAR-FLASHCARDS-01 (owner, 31 Oct 2026) ──────────────────────────────
//
// Reads through the store (the only file that reads individual_scholar_*), keyed on the caller, and builds what every
// flashcard surface reads with the pure rules of flashcards.ts. loadCardSelection is THE stable loader the downloads
// (deck, printable cards, revision guide) build on: the learner's own cards only, never anyone else's, never a draft or
// unapproved library item (hydrate drops a library copy whose version is no longer published and approved).

import { loadIndividualPolicy } from "@/lib/individual/policy";
import { competencyLabels, loadLearnerCatalogue, type CompetencyLabel } from "./competency-view";
import type { CatalogueCompetency } from "./catalogue";
import {
  addDeckCards, chunksByIds, competencyChunks, createFlashcardDeck, deckArchiveSchema, deleteFlashcardDeck, flashcardDecks, flashcardRows, flashcardSchema,
  learningStepsOfSections, listOsceAttempts, listOsceStations, osceSchema, revisionPool, studySessionsOfDecks, topicsOfSections,
} from "./store";
import {
  buildDecks, cardLinksOf, flashcardView, mergeGaps, osceGapTopics, recallCardOf, recentOsceAttempts, selectCards, topicGaps,
  type CardLinks, type CardSelection, type CitationMeta, type DeckSummary, type FlashcardView, type OsceGapAttempt, type PersonalDeck, type TopicGap,
} from "./flashcards";
import { copyPlan, mergePlan } from "./flashcard-decks";
import { displaySessionTitle } from "./learn-search";
import { rubricOf } from "./question-intel";
import { CONTENT_STATUS_LABEL, REVISION_FORMATS } from "./config";
import { loadContentReviewPolicy } from "@/lib/ai/content-review";
import { cardSensitiveFlag } from "./flashcard-sensitive";
import { FORMATIVE_NOTICE } from "./spaces";

type Ctx = { admin: any; userId: string }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type FlashcardLibrary = {
  today: string; cards: FlashcardView[]; decks: DeckSummary[]; personal: PersonalDeck[];
  /** Migration 730 is applied here: hand-written cards, decks, bookmarks, notes and issue reports are available. */
  schema730: boolean;
  /** Migration 820 is applied here (archived_at on decks): archive controls are offered. Absent: they are hidden, nothing errors. */
  archive820: boolean;
};

const todayOf = () => new Date().toISOString().slice(0, 10);

/** Every card of the caller, as FlashcardView, and every deck (their own and the ones their cards make). */
export async function loadFlashcards(ctx: Ctx): Promise<{ ok: true; data: FlashcardLibrary } | { ok: false; notProvisioned: boolean }> {
  const rows = await flashcardRows(ctx.admin, ctx.userId);
  if (!rows.ok) return rows;
  const today = todayOf();
  const cards = rows.data.questions.map(recallCardOf).filter((q): q is NonNullable<typeof q> => !!q);
  const compIds = [...new Set(cards.map(c => c.competencyId).filter((x): x is string => !!x))];
  // SCHOLAR-FLASHCARDS-QA-01: the approved references a card's rubric cites, named and placed as the catalogue holds them now.
  const refIds = [...new Set(cards.flatMap(c => { const r = rubricOf(c.answer); return r?.source === "references" ? r.referenceIds : []; }))];
  const catalogue = compIds.length || refIds.length ? (await loadLearnerCatalogue(ctx.admin, ctx.userId)).competencies : null;
  const names = compIds.length || refIds.length ? await competencyLabels(ctx.admin, catalogue, [...new Set([...compIds, ...refIds])], new Map()) : new Map();
  const references = referenceCitations(refIds, names, catalogue);
  const views = cards.map(q => flashcardView(q, { ...rows.data.extras.get(q.id)!, competencyTitle: q.competencyId ? names.get(q.competencyId)?.title ?? null : null, references }, today));
  const archive820 = rows.data.schema730 && await deckArchiveSchema(ctx.admin, ctx.userId);
  return { ok: true, data: { today, cards: views, decks: buildDecks(views, rows.data.decks, { alwaysBookmarked: rows.data.schema730 }), personal: rows.data.decks, schema730: rows.data.schema730, archive820 } };
}

/**
 * Pure. A governed reference (a competency of the reference catalogue a card's rubric cites) as a citation: its title
 * and code, the catalogue (framework) and catalogue version it is read from, and its clinical review standing NOW
 * (395: approval is lost the moment the content changes). No DOI, PMID or URL: the governed catalogue records none,
 * so none is printed. An id the catalogue no longer holds is not given a citation here (the card says so).
 */
export function referenceCitations(ids: readonly string[], names: ReadonlyMap<string, CompetencyLabel>, catalogue: readonly CatalogueCompetency[] | null): Map<string, CitationMeta> {
  const byId = new Map((catalogue ?? []).map(c => [c.id, c]));
  const out = new Map<string, CitationMeta>();
  for (const id of ids) {
    const n = names.get(id), c = byId.get(id);
    // competency-view.ts names an id no framework holds any more with a placeholder: that is no citation.
    if (!n || (!c && !n.catalogue && /no longer in your programme/i.test(n.title))) continue;
    const status = c?.contentStatus ?? n.contentStatus ?? null;
    out.set(id, {
      title: c?.title ?? n.title, kind: "framework", code: c?.code ?? n.code ?? null, publisher: c?.catalogue ?? n.catalogue ?? null,
      version: c?.catalogueVersion ?? null, status: status ? CONTENT_STATUS_LABEL[status] : null,
      access: "Competency framework reference in Competen Scholar",
    });
  }
  return out;
}

/**
 * SCHOLAR-FLASHCARDS-QA-01 (c): each card's clinical educational content review flag, by the rules PUBLISHED on the AI
 * Fair Use page (the built-in defaults where none are), for the learner's programme profession. Flags only: the
 * cards' words are unchanged. `formatDate` writes a library card's reviewed date as the surface shows dates.
 */
export async function applyContentReview<T extends FlashcardView>(ctx: Ctx, cards: readonly T[], formatDate: (iso: string) => string): Promise<T[]> {
  if (!cards.length) return [...cards];
  const [policy, learner] = await Promise.all([loadContentReviewPolicy(ctx.admin, "scholar"), loadLearnerCatalogue(ctx.admin, ctx.userId).catch(() => null)]);
  const professions = learner?.programme?.profession ? [learner.programme.profession] : null;
  return cards.map(c => ({ ...c, sensitive: cardSensitiveFlag(c, { policy, professions, formatDate }) }));
}

/** One card of a selection, exactly as the downloads receive it. */
export type SelectedCard = FlashcardView;
export type CardSelectionResult =
  | { ok: true; cards: SelectedCard[]; decks: { id: string | null; key: string; title: string; total: number }[]; generatedAt: string; formative: string }
  | { ok: false; reason: "off" | "unreadable" | "not_provisioned" };

/**
 * THE LOADER THE DOWNLOADS BUILD ON. The caller's own cards a selection names: the cards of the decks named (a 730 deck
 * id, or a deck key such as doc:<materialId>, topic:<label>, comp:<competencyId>, bookmarked), and the cards named, in
 * that order, each once; narrowed by topic, competency and document where given. Nothing named: every card, narrowed
 * the same way. Each card carries front, back, explanation, topic, learning objective, key points, its sources with
 * their origin (notes, library, external), its competency, difficulty, created date, content version and its review
 * state and history. Refused (reason off) where policy scholar_flashcards is off.
 */
export async function loadCardSelection(ctx: Ctx, sel: CardSelection): Promise<CardSelectionResult> {
  const policy = await loadIndividualPolicy(ctx.admin);
  if (policy.scholarFlashcards !== "on") return { ok: false, reason: "off" };
  const lib = await loadFlashcards(ctx);
  if (!lib.ok) return { ok: false, reason: lib.notProvisioned ? "not_provisioned" : "unreadable" };
  const cards = selectCards(lib.data.cards, lib.data.decks, sel);
  const named = (sel.deckIds ?? []).map(id => lib.data.decks.find(d => d.key === id || d.id === id)).filter((d): d is DeckSummary => !!d);
  return {
    ok: true, cards, decks: named.map(d => ({ id: d.id, key: d.key, title: d.title, total: d.total })), generatedAt: new Date().toISOString(),
    formative: FORMATIVE_NOTICE,
  };
}

/**
 * Topic-level learning gaps: every revision question or card the caller answered wrongly (or did not remember) at least
 * once, grouped by topic, most missed first, with the key points and misconceptions its rubric records; and (owner, 1 Nov
 * 2026) the gaps of the learner's own recent OSCE practice runs, mapped to their own sections. [] when none.
 */
export async function loadFlashcardGaps(ctx: Ctx, limit = 6): Promise<TopicGap[]> {
  return (await loadFlashcardGapsDetailed(ctx, limit)).gaps;
}

/** The same gaps, and how many OSCE gaps were left out because they map to none of the learner's own sections (said in the UI). */
export async function loadFlashcardGapsDetailed(ctx: Ctx, limit = 6): Promise<{ gaps: TopicGap[]; osceSkipped: number }> {
  const [questions, osce] = await Promise.all([questionGaps(ctx, limit), osceGaps(ctx)]);
  return { gaps: mergeGaps(questions, osce.gaps, limit), osceSkipped: osce.skipped };
}

async function questionGaps(ctx: Ctx, limit: number): Promise<TopicGap[]> {
  const pool = await revisionPool(ctx.admin, ctx.userId, { kinds: [...REVISION_FORMATS, "case"] });
  if (!pool.ok) return [];
  const items = pool.data.questions.map(q => ({ q, misses: pool.data.stats.get(q.id)?.misses ?? 0 })).filter(x => x.misses > 0);
  if (!items.length) return [];
  const topics = await topicsOfSections(ctx.admin, ctx.userId, [...new Set(items.map(x => x.q.chunkId))]);
  return topicGaps(items, topics, limit);
}

/**
 * OSCE practice gaps (720/721) as gap focus. The learner's own finished runs of the last 90 days (at most five), their
 * missed and partly done checklist items, mapped to their own sections (osceGapTopics). Nothing new is generated here:
 * the existing gap path writes the cards, metered as ever, grounded in those sections. Unreadable or absent: none.
 */
async function osceGaps(ctx: Ctx): Promise<{ gaps: TopicGap[]; skipped: number }> {
  const none = { gaps: [] as TopicGap[], skipped: 0 };
  try {
    if (!(await osceSchema(ctx.admin, ctx.userId))) return none;
    const attempts = await listOsceAttempts(ctx.admin, ctx.userId, null, 30);
    if (!attempts.ok) return none;
    const recent = recentOsceAttempts(attempts.data, new Date().toISOString());
    if (!recent.length) return none;
    const stations = await listOsceStations(ctx.admin, ctx.userId);
    if (!stations.ok) return none;
    const byStation = new Map(stations.data.map(s => [s.id, s]));
    const inputs: OsceGapAttempt[] = recent.flatMap(a => {
      const s = byStation.get(a.stationId);
      if (!s) return [];
      const list = Array.isArray(a.snapshot?.checklist) ? (a.snapshot!.checklist as unknown[]) : s.checklist;
      const itemChunks = new Map<string, string>();
      for (const raw of list) { const i = raw as { id?: unknown; chunkId?: unknown } | null; if (i && typeof i.id === "string" && typeof i.chunkId === "string") itemChunks.set(i.id, i.chunkId); }
      return [{
        id: a.id, finishedAt: a.finishedAt, status: a.status, gaps: a.gaps, revisionSuggestions: a.revisionSuggestions, itemChunks,
        station: { title: s.title, topic: s.topic ?? null, materialId: s.materialId, chunkId: s.chunkId, competencyId: s.competencyId },
      }];
    });
    const compIds = [...new Set(inputs.filter(i => !i.station.chunkId && i.station.competencyId).map(i => i.station.competencyId!))].slice(0, 6);
    const competencySections = new Map<string, { chunkId: string; materialId: string }[]>();
    await Promise.all(compIds.map(async id => {
      const r = await competencyChunks(ctx.admin, ctx.userId, id, 12);
      if (r.ok) competencySections.set(id, r.data.map(c => ({ chunkId: c.id, materialId: c.materialId })));
    }));
    const mapped = osceGapTopics(inputs, competencySections);
    // Only sections that are the learner's own and still stored are given to the generator.
    const owned = await chunksByIds(ctx.admin, ctx.userId, mapped.gaps.flatMap(g => g.chunkIds), false);
    if (!owned.ok) return none;
    const have = new Set(owned.data.map(c => c.id));
    let skipped = mapped.skipped;
    const gaps: TopicGap[] = [];
    for (const g of mapped.gaps) {
      const chunkIds = g.chunkIds.filter(c => have.has(c));
      if (chunkIds.length) gaps.push({ ...g, chunkIds }); else skipped += g.missed;
    }
    return { gaps, skipped };
  } catch { return none; }
}

/** Why OSCE gaps were left out, in plain words (null: none were). */
export const osceSkippedNote = (n: number) =>
  n > 0 ? `${n} gap${n === 1 ? "" : "s"} from your OSCE practice ${n === 1 ? "was" : "were"} left out: not linked to any section of your notes, so no card can be checked against them.` : null;

/**
 * Deck copy (owner, 1 Nov 2026): a new deck "<deck> (copy)" holding the same cards. Cards, their schedules and their review
 * history are shared, not duplicated: only deck and deck-card rows are written. The source deck is looked up among the
 * caller's own decks, so another learner's deck is simply not found.
 */
export async function copyDeck(ctx: Ctx, deckId: string, max: number): Promise<
  { ok: true; id: string; title: string; cards: number } | { ok: false; reason: "not_found" | "invalid" | "not_provisioned" | "failed"; message: string }> {
  const src = (await flashcardDecks(ctx.admin, ctx.userId)).find(d => d.id === deckId);
  if (!src) return { ok: false, reason: "not_found", message: "That deck could not be found." };
  const plan = copyPlan(src, max);
  if (!plan.ok) return { ok: false, reason: "invalid", message: plan.message };
  const made = await createFlashcardDeck(ctx.admin, ctx.userId, { title: plan.title, organiseBy: plan.organiseBy, organiseRef: plan.organiseRef, cardIds: plan.cardIds });
  if (!made.ok) return { ok: false, reason: made.notProvisioned ? "not_provisioned" : "failed", message: made.notProvisioned ? "Decks are not available here yet." : "The deck could not be copied just now." };
  return { ok: true, id: made.id, title: plan.title, cards: plan.cardIds.length };
}

/**
 * Merge deck `fromId` into deck `intoId`: its cards that the other deck does not hold are added after the last one
 * (duplicates skipped), then `fromId` is deleted. Both decks must be the caller's own. Cards, schedules and review history
 * are untouched: only deck and deck-card rows are written. If adding fails nothing is deleted.
 */
export async function mergeDecks(ctx: Ctx, intoId: string, fromId: string, max: number): Promise<
  { ok: true; added: number; skipped: number; total: number } | { ok: false; reason: "not_found" | "invalid" | "failed"; message: string }> {
  const decks = await flashcardDecks(ctx.admin, ctx.userId);
  const into = decks.find(d => d.id === intoId), from = decks.find(d => d.id === fromId);
  if (!into || !from) return { ok: false, reason: "not_found", message: "That deck could not be found." };
  const plan = mergePlan(into, from, max);
  if (!plan.ok) return { ok: false, reason: "invalid", message: plan.message };
  if (plan.add.length && !(await addDeckCards(ctx.admin, ctx.userId, into.id, plan.add))) return { ok: false, reason: "failed", message: "The decks could not be merged just now." };
  if (!(await deleteFlashcardDeck(ctx.admin, ctx.userId, from.id))) return { ok: false, reason: "failed", message: "The cards were added, but the other deck could not be removed just now." };
  return { ok: true, added: plan.add.length, skipped: plan.skipped, total: plan.total };
}

/**
 * "From lesson" and "study session" links for cards (exact only): the saved Learn lesson whose step holds the card's own
 * section, and the study session (740) one of its decks is linked to. Database reads only, keyed on the caller. Cards with
 * neither are absent. Unreadable: none (the card then shows no link, never a guessed one).
 */
export async function loadCardLinks(ctx: Ctx, cards: readonly { id: string; chunkId: string; deckIds: readonly string[] }[]): Promise<Map<string, CardLinks>> {
  if (!cards.length) return new Map();
  try {
    const [lessons, deckStudy] = await Promise.all([
      learningStepsOfSections(ctx.admin, ctx.userId, [...new Set(cards.map(c => c.chunkId))]),
      studySessionsOfDecks(ctx.admin, ctx.userId, [...new Set(cards.flatMap(c => c.deckIds))]),
    ]);
    return cardLinksOf(cards, lessons.map(l => ({ ...l, title: displaySessionTitle(l.title) })), new Map([...deckStudy].map(([k, v]) => [k, { sessionId: v.sessionId, title: displaySessionTitle(v.title) }])));
  } catch { return new Map(); }
}

/**
 * The gate every flashcard route passes: policy scholar_flashcards on, and (for hand-written cards, decks and marks)
 * migration 730 applied. A refusal is { error, status } to send as it is; otherwise the policy, for its limits.
 */
export async function flashcardGate(ctx: Ctx, needs730: boolean): Promise<{ refusal: { error: string; status: number } } | { policy: Awaited<ReturnType<typeof loadIndividualPolicy>> }> {
  const policy = await loadIndividualPolicy(ctx.admin);
  if (policy.scholarFlashcards !== "on") return { refusal: { error: "Flashcards are not offered here.", status: 403 } };
  if (needs730 && !(await flashcardSchema(ctx.admin, ctx.userId)))
    return { refusal: { error: "Decks, cards you write yourself, bookmarks and notes are not available here yet. Flashcards from your notes still work.", status: 409 } };
  return { policy };
}
