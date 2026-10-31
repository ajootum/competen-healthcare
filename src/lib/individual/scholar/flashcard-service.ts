// ── SCHOLAR FLASHCARDS: THE SERVER LOADERS ── SCHOLAR-FLASHCARDS-01 (owner, 31 Oct 2026) ──────────────────────────────
//
// Reads through the store (the only file that reads individual_scholar_*), keyed on the caller, and builds what every
// flashcard surface reads with the pure rules of flashcards.ts. loadCardSelection is THE stable loader the downloads
// (deck, printable cards, revision guide) build on: the learner's own cards only, never anyone else's, never a draft or
// unapproved library item (hydrate drops a library copy whose version is no longer published and approved).

import { loadIndividualPolicy } from "@/lib/individual/policy";
import { competencyLabels, loadLearnerCatalogue } from "./competency-view";
import { flashcardRows, flashcardSchema, revisionPool, topicsOfSections } from "./store";
import {
  buildDecks, flashcardView, recallCardOf, selectCards, topicGaps,
  type CardSelection, type DeckSummary, type FlashcardView, type PersonalDeck, type TopicGap,
} from "./flashcards";
import { REVISION_FORMATS } from "./config";
import { FORMATIVE_NOTICE } from "./spaces";

type Ctx = { admin: any; userId: string }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type FlashcardLibrary = {
  today: string; cards: FlashcardView[]; decks: DeckSummary[]; personal: PersonalDeck[];
  /** Migration 730 is applied here: hand-written cards, decks, bookmarks, notes and issue reports are available. */
  schema730: boolean;
};

const todayOf = () => new Date().toISOString().slice(0, 10);

/** Every card of the caller, as FlashcardView, and every deck (their own and the ones their cards make). */
export async function loadFlashcards(ctx: Ctx): Promise<{ ok: true; data: FlashcardLibrary } | { ok: false; notProvisioned: boolean }> {
  const rows = await flashcardRows(ctx.admin, ctx.userId);
  if (!rows.ok) return rows;
  const today = todayOf();
  const cards = rows.data.questions.map(recallCardOf).filter((q): q is NonNullable<typeof q> => !!q);
  const compIds = [...new Set(cards.map(c => c.competencyId).filter((x): x is string => !!x))];
  const names = compIds.length ? await competencyLabels(ctx.admin, (await loadLearnerCatalogue(ctx.admin, ctx.userId)).competencies, compIds, new Map()) : new Map();
  const views = cards.map(q => flashcardView(q, { ...rows.data.extras.get(q.id)!, competencyTitle: q.competencyId ? names.get(q.competencyId)?.title ?? null : null }, today));
  return { ok: true, data: { today, cards: views, decks: buildDecks(views, rows.data.decks), personal: rows.data.decks, schema730: rows.data.schema730 } };
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
 * once, grouped by topic, most missed first, with the key points and misconceptions its rubric records. [] when none.
 */
export async function loadFlashcardGaps(ctx: Ctx, limit = 6): Promise<TopicGap[]> {
  const pool = await revisionPool(ctx.admin, ctx.userId, { kinds: [...REVISION_FORMATS, "case"] });
  if (!pool.ok) return [];
  const items = pool.data.questions.map(q => ({ q, misses: pool.data.stats.get(q.id)?.misses ?? 0 })).filter(x => x.misses > 0);
  if (!items.length) return [];
  const topics = await topicsOfSections(ctx.admin, ctx.userId, [...new Set(items.map(x => x.q.chunkId))]);
  return topicGaps(items, topics, limit);
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
