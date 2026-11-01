// SCHOLAR FLASHCARDS EXPERIENCE (owner GO "Competen Scholar - Flashcard Learning Experience Redesign").
// Pure helpers behind the three Flashcards experiences: Study cards, Test myself, Create & manage. No I/O, no AI.

export type FlashcardExperience = "study" | "test" | "manage";

/**
 * Which experience a ?view= belongs to. Study is the default (no view, or Revision History); Test is ?view=test;
 * Create & manage holds ?view=manage and the two browsers reached from it (All cards, My Decks).
 */
export function experienceOf(view: string | null | undefined): FlashcardExperience {
  if (view === "test") return "test";
  if (view === "manage" || view === "cards" || view === "decks") return "manage";
  return "study";
}

/**
 * SEPARATION. The ids left once the learner's flashcards are taken out. A test attempt built from `poolIds` must never
 * move a card's spaced-review schedule or appear in the flashcard review history, so every id that is one of the learner's
 * flashcards (their own cards, AI cards from their notes, and governed library questions offered as recall cards) is
 * removed. `cardIds` is always derived on the server; never an id from a request body.
 */
export function withoutFlashcards<T extends string>(poolIds: readonly T[], cardIds: Iterable<string>): T[] {
  const cards = new Set(cardIds);
  return poolIds.filter(id => !cards.has(id));
}

type CardLike = { id: string; chunkId: string; material: { id: string } };

/** The cards of one material (a lesson), narrowed to one section when given. Order is the caller's. */
export function cardsOfMaterial<T extends CardLike>(cards: readonly T[], materialId: string, chunkId?: string | null): T[] {
  return cards.filter(c => c.material.id === materialId && (!chunkId || c.chunkId === chunkId));
}

/** Most sections (24, learn.ts TOPIC_SECTIONS) and materials (10, MAX_SCOPE_MATERIALS) one revision scope may name. */
export const TEST_SCOPE_SECTIONS = 24;
export const TEST_SCOPE_MATERIALS = 10;

/**
 * The existing "sources" scope that covers the topics of these cards: their sections, or, when the cards span more sections
 * than a scope may name, their materials. Null when there are no cards.
 */
export function testScopeOf(cards: readonly CardLike[]): { kind: "sources"; materialIds: string[]; chunkIds: string[] } | null {
  if (!cards.length) return null;
  const chunkIds = [...new Set(cards.map(c => c.chunkId))];
  const materialIds = [...new Set(cards.map(c => c.material.id))];
  if (chunkIds.length <= TEST_SCOPE_SECTIONS) return { kind: "sources", materialIds: [], chunkIds };
  if (materialIds.length <= TEST_SCOPE_MATERIALS) return { kind: "sources", materialIds, chunkIds: [] };
  return { kind: "sources", materialIds: [], chunkIds: chunkIds.slice(0, TEST_SCOPE_SECTIONS) };
}

type SessionLike = { id: string; mode: string; status: string; lastActiveAt: string };

/** The learner's newest unfinished flashcards session (the list is newest first, but the order is not trusted). */
export function unfinishedFlashcardSession<T extends SessionLike>(sessions: readonly T[]): T | null {
  const open = sessions.filter(s => s.mode === "flashcards" && s.status !== "completed");
  return open.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))[0] ?? null;
}
