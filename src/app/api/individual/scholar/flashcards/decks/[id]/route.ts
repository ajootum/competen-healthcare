import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { addDeckCards, deleteFlashcardDeck, flashcardDecks, isUuid, removeDeckCards, updateFlashcardDeck } from "@/lib/individual/scholar/store";
import { flashcardGate } from "@/lib/individual/scholar/flashcard-service";
import { parseDeckFields } from "@/lib/individual/scholar/flashcards";
import { audit } from "@/lib/individual/scholar/http";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/flashcards/decks/[id] -- SCHOLAR-FLASHCARDS-01, migration 730. Owner-keyed throughout.
// PATCH { title?, organiseBy?, organiseRef?, add?: [cardId], remove?: [cardId], moveTo?: deckId }
//   add     cards into this deck (after its last card), up to the policy's deck size
//   remove  cards out of it; with moveTo, into that deck first (a MOVE). A deck references cards, so a move never
//           copies or resets a card's schedule or review history.
// DELETE removes the deck. Its cards and their history stay.

const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter(isUuid))].slice(0, 1000) : []);

export async function PATCH(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const gate = await flashcardGate(ctx, true);
  if ("refusal" in gate) return NextResponse.json({ error: gate.refusal.error }, { status: gate.refusal.status });
  const { id } = await ctx2.params;
  const decks = await flashcardDecks(ctx.admin, ctx.userId);
  const deck = decks.find(d => d.id === id);
  if (!deck) return NextResponse.json({ error: "That deck could not be found." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const max = gate.policy.scholarFlashcardDeckMax;

  const fields = parseDeckFields(body, false);
  if (!fields.ok) return NextResponse.json({ error: fields.message }, { status: fields.identifier ? 422 : 400 });
  if ((fields.title !== undefined || fields.organiseBy !== undefined) && !(await updateFlashcardDeck(ctx.admin, ctx.userId, id, fields)))
    return NextResponse.json({ error: "The deck could not be changed just now." }, { status: 500 });

  const add = ids(body?.add).filter(c => !deck.cardIds.includes(c));
  if (add.length) {
    if (deck.cardIds.length + add.length > max) return NextResponse.json({ error: `A deck holds at most ${max} cards. This one has ${deck.cardIds.length}.` }, { status: 400 });
    if (!(await addDeckCards(ctx.admin, ctx.userId, id, add))) return NextResponse.json({ error: "Those cards could not be added just now." }, { status: 500 });
  }
  const remove = ids(body?.remove).filter(c => deck.cardIds.includes(c));
  if (remove.length) {
    if (body?.moveTo !== undefined) {
      const to = decks.find(d => d.id === body.moveTo && d.id !== id);
      if (!to) return NextResponse.json({ error: "Choose another of your decks to move the cards to." }, { status: 404 });
      const fresh = remove.filter(c => !to.cardIds.includes(c));
      if (to.cardIds.length + fresh.length > max) return NextResponse.json({ error: `"${to.title}" holds at most ${max} cards.` }, { status: 400 });
      if (fresh.length && !(await addDeckCards(ctx.admin, ctx.userId, to.id, fresh))) return NextResponse.json({ error: "Those cards could not be moved just now." }, { status: 500 });
    }
    if (!(await removeDeckCards(ctx.admin, ctx.userId, id, remove))) return NextResponse.json({ error: "Those cards could not be taken out just now." }, { status: 500 });
  }
  await audit(ctx, "individual_scholar_flashcard_deck_changed", "individual_scholar_flashcard_deck", id, { added: add.length, removed: remove.length, moved: body?.moveTo !== undefined && remove.length > 0, renamed: fields.title !== undefined });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const gate = await flashcardGate(ctx, true);
  if ("refusal" in gate) return NextResponse.json({ error: gate.refusal.error }, { status: gate.refusal.status });
  const { id } = await ctx2.params;
  if (!(await deleteFlashcardDeck(ctx.admin, ctx.userId, id))) return NextResponse.json({ error: "That deck could not be found." }, { status: 404 });
  await audit(ctx, "individual_scholar_flashcard_deck_deleted", "individual_scholar_flashcard_deck", id, {});
  return NextResponse.json({ ok: true });
}
