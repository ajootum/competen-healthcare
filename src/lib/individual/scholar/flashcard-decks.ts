// ── FLASHCARD DECK OPERATIONS (pure, client-safe) ── SCHOLAR-FLASHCARDS-01 follow-up (owner GO, 1 Nov 2026) ──────────────
//
// Archive, copy, merge, search, sort and group for the learner's own decks. No I/O, no clock, and nothing imported at run
// time, so the Flashcards client can use it. Decks REFERENCE cards (730): none of this names a card, a schedule or a
// review. flashcard-service.ts runs the plans; routes under api/individual/scholar/flashcards/decks check ownership.

import type { PersonalDeck } from "./flashcards";

const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export const DECK_TITLE_MAX = 120;
export const DECK_COPY_SUFFIX = " (copy)";

/**
 * Pure. What a copy of a deck is: "<deck> (copy)" (the deck's own name cut so the whole fits 120 characters), organised
 * the same way, holding the same cards in the same order. Cards, their schedules and their history are shared, never
 * duplicated. Refused when the deck holds more than the policy's deck size.
 */
export function copyPlan(src: Pick<PersonalDeck, "title" | "organiseBy" | "organiseRef" | "cardIds">, max: number):
  { ok: true; title: string; organiseBy: PersonalDeck["organiseBy"]; organiseRef: string | null; cardIds: string[] } | { ok: false; message: string } {
  if (src.cardIds.length > max) return { ok: false, message: `A deck holds at most ${max} cards.` };
  const title = `${src.title.slice(0, DECK_TITLE_MAX - DECK_COPY_SUFFIX.length).trimEnd()}${DECK_COPY_SUFFIX}`;
  return { ok: true, title, organiseBy: src.organiseBy, organiseRef: src.organiseBy === "personal" ? null : src.organiseRef, cardIds: [...new Set(src.cardIds)] };
}

/**
 * Pure. Merging deck `from` into deck `into`: the cards of `from` that `into` does not already hold are added after its
 * last card (duplicates skipped), then `from` is deleted. Refused for the same deck, or when the result would pass the
 * policy's deck size. Nothing here names a card, a schedule or a review.
 */
export function mergePlan(into: Pick<PersonalDeck, "id" | "title" | "cardIds">, from: Pick<PersonalDeck, "id" | "cardIds">, max: number):
  { ok: true; add: string[]; skipped: number; total: number } | { ok: false; message: string } {
  if (into.id === from.id) return { ok: false, message: "Choose another of your decks to merge." };
  const have = new Set(into.cardIds);
  const add = [...new Set(from.cardIds)].filter(c => !have.has(c));
  const total = into.cardIds.length + add.length;
  if (total > max) return { ok: false, message: `"${into.title}" would hold ${total} cards. A deck holds at most ${max}.` };
  return { ok: true, add, skipped: new Set(from.cardIds).size - add.length, total };
}

export type DeckSort = "recent" | "due" | "name";
export const DECK_SORT_LABEL: Record<DeckSort, string> = { recent: "Most recent", due: "Most due", name: "Name" };
export const isDeckSort = (v: unknown): v is DeckSort => v === "recent" || v === "due" || v === "name";
type Sortable = { title: string; due: number; fresh: number; lastStudiedAt: string | null; updatedAt?: string | null };

/** Pure. A new array: recent (studied or changed last first), due (due and new first), or name (A to Z). Ties by name. */
export function sortDecks<T extends Sortable>(decks: readonly T[], by: DeckSort): T[] {
  const name = (a: T, b: T) => a.title.localeCompare(b.title);
  const recent = (d: T) => [d.lastStudiedAt, d.updatedAt].filter((x): x is string => !!x).sort().at(-1) ?? "";
  return [...decks].sort((a, b) => by === "name" ? name(a, b)
    : by === "due" ? (b.due + b.fresh) - (a.due + a.fresh) || b.due - a.due || name(a, b)
      : recent(b).localeCompare(recent(a)) || name(a, b));
}

/** Pure. Decks whose title holds every word typed (case and punctuation ignored). Nothing typed: all of them. */
export function searchDecks<T extends { title: string }>(decks: readonly T[], query: string): T[] {
  const words = flat(query).split(" ").filter(Boolean);
  return words.length ? decks.filter(d => words.every(w => flat(d.title).includes(w))) : [...decks];
}

export const ORGANISE_GROUP_LABEL: Record<PersonalDeck["organiseBy"], string> = {
  personal: "My own decks", module: "By module", topic: "By topic", document: "By material", competency: "By competency",
};
/** Pure. The learner's own decks grouped by how they are organised (topic, material, competency, module, personal), in that order, empty groups left out. */
export function groupByOrganise<T extends { organiseBy?: PersonalDeck["organiseBy"] }>(decks: readonly T[]): { by: PersonalDeck["organiseBy"]; label: string; decks: T[] }[] {
  const order: PersonalDeck["organiseBy"][] = ["topic", "document", "competency", "module", "personal"];
  return order.map(by => ({ by, label: ORGANISE_GROUP_LABEL[by], decks: decks.filter(d => (d.organiseBy ?? "personal") === by) })).filter(g => g.decks.length);
}

