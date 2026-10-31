import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { createFlashcardDeck, isUuid, ownedQuestionIds } from "@/lib/individual/scholar/store";
import { flashcardGate } from "@/lib/individual/scholar/flashcard-service";
import { parseDeckFields } from "@/lib/individual/scholar/flashcards";
import { audit } from "@/lib/individual/scholar/http";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/flashcards/decks -- SCHOLAR-FLASHCARDS-01, migration 730.
// { title, organiseBy?, organiseRef?, cardIds? } makes a named deck, optionally organised by module, topic, document or
// competency, holding the cards named (combine selected cards into a deck). A deck REFERENCES cards: their schedules
// and review history stay where they are. At most the policy's deck size. Private to the learner.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const gate = await flashcardGate(ctx, true);
  if ("refusal" in gate) return NextResponse.json({ error: gate.refusal.error }, { status: gate.refusal.status });
  const body = await req.json().catch(() => ({}));
  const fields = parseDeckFields(body, true);
  if (!fields.ok) return NextResponse.json({ error: fields.message }, { status: fields.identifier ? 422 : 400 });
  const cardIds = Array.isArray(body?.cardIds) ? [...new Set((body.cardIds as unknown[]).filter(isUuid))] : [];
  if (cardIds.length > gate.policy.scholarFlashcardDeckMax) return NextResponse.json({ error: `A deck holds at most ${gate.policy.scholarFlashcardDeckMax} cards.` }, { status: 400 });
  // SCHOLAR-FLASHCARDS-QA-01 D1: only the caller's own cards, checked before the deck is made: another's is not found.
  if (cardIds.length) {
    const owned = await ownedQuestionIds(ctx.admin, ctx.userId, cardIds);
    if (!owned) return NextResponse.json({ error: "The deck could not be made just now." }, { status: 503 });
    if (cardIds.some(c => !owned.has(c))) return NextResponse.json({ error: "One or more of those cards could not be found." }, { status: 404 });
  }
  const made = await createFlashcardDeck(ctx.admin, ctx.userId, { title: fields.title!, organiseBy: fields.organiseBy ?? "personal", organiseRef: fields.organiseRef ?? null, cardIds });
  if (!made.ok) return NextResponse.json({ error: made.notProvisioned ? "Decks are not available here yet." : "The deck could not be made just now." }, { status: made.notProvisioned ? 409 : 500 });
  await audit(ctx, "individual_scholar_flashcard_deck_made", "individual_scholar_flashcard_deck", made.id, { organise: fields.organiseBy ?? "personal", cards: cardIds.length });
  return NextResponse.json({ id: made.id });
}
