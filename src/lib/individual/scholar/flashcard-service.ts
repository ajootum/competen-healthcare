// ── SCHOLAR FLASHCARDS: THE SERVER LOADERS ── SCHOLAR-FLASHCARDS-01 (owner, 31 Oct 2026) ──────────────────────────────
//
// Reads through the store (the only file that reads individual_scholar_*), keyed on the caller, and builds what every
// flashcard surface reads with the pure rules of flashcards.ts. loadCardSelection is THE stable loader the downloads
// (deck, printable cards, revision guide) build on: the learner's own cards only, never anyone else's, never a draft or
// unapproved library item (hydrate drops a library copy whose version is no longer published and approved).

import { loadIndividualPolicy } from "@/lib/individual/policy";
import { competencyLabels, loadLearnerCatalogue, type CompetencyLabel } from "./competency-view";
import type { CatalogueCompetency } from "./catalogue";
import { flashcardRows, flashcardSchema, revisionPool, topicsOfSections } from "./store";
import {
  buildDecks, flashcardView, recallCardOf, selectCards, topicGaps,
  type CardSelection, type CitationMeta, type DeckSummary, type FlashcardView, type PersonalDeck, type TopicGap,
} from "./flashcards";
import { rubricOf } from "./question-intel";
import { CONTENT_STATUS_LABEL, REVISION_FORMATS } from "./config";
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
  // SCHOLAR-FLASHCARDS-QA-01: the approved references a card's rubric cites, named and placed as the catalogue holds them now.
  const refIds = [...new Set(cards.flatMap(c => { const r = rubricOf(c.answer); return r?.source === "references" ? r.referenceIds : []; }))];
  const catalogue = compIds.length || refIds.length ? (await loadLearnerCatalogue(ctx.admin, ctx.userId)).competencies : null;
  const names = compIds.length || refIds.length ? await competencyLabels(ctx.admin, catalogue, [...new Set([...compIds, ...refIds])], new Map()) : new Map();
  const references = referenceCitations(refIds, names, catalogue);
  const views = cards.map(q => flashcardView(q, { ...rows.data.extras.get(q.id)!, competencyTitle: q.competencyId ? names.get(q.competencyId)?.title ?? null : null, references }, today));
  return { ok: true, data: { today, cards: views, decks: buildDecks(views, rows.data.decks), personal: rows.data.decks, schema730: rows.data.schema730 } };
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
