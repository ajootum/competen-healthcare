import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { addDeckCards, chunkMappings, flashcardDecks, flashcardFronts, insertLearnerCard, isUuid } from "@/lib/individual/scholar/store";
import { flashcardGate, loadCardSelection } from "@/lib/individual/scholar/flashcard-service";
import { checkPersonalCard } from "@/lib/individual/scholar/flashcards";
import { leadingCompetency } from "@/lib/competency/mapping";
import { audit } from "@/lib/individual/scholar/http";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/flashcards -- SCHOLAR-FLASHCARDS-01 (owner, 31 Oct 2026).
//
// GET  ?deck=<id or key>&deck=...&card=<id>&topic=&competency=&material= -- the caller's own cards a selection names,
//      as loadCardSelection returns them (flashcard-service.ts): what the downloads read. Nothing named: every card.
//      &bookmarked=true narrows to the caller's own bookmarked cards (the Bookmarked entry in the deck list).
// POST { materialId, chunkId?, front, back, deckId? } -- a card the learner writes by hand. No AI. Checked (length,
//      a recall prompt, no patient identifier, not a repeat of a card they have), filed under their material, labelled
//      as their own and never as clinically reviewed (730 binds it), on the spaced review schedule from today.
// Policy scholar_flashcards off: 403. Hand-written cards need migration 730: without it, 409.

export async function GET(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const u = new URL(req.url);
  const r = await loadCardSelection(ctx, {
    deckIds: u.searchParams.getAll("deck").slice(0, 20), cardIds: u.searchParams.getAll("card").filter(isUuid).slice(0, 500),
    topic: u.searchParams.get("topic"), competencyId: u.searchParams.get("competency"), materialId: u.searchParams.get("material"),
    bookmarked: ["true", "1"].includes(u.searchParams.get("bookmarked") ?? ""),
  });
  if (!r.ok) return NextResponse.json({ error: r.reason === "off" ? "Flashcards are not offered here." : "Your cards could not be read just now." }, { status: r.reason === "off" ? 403 : 503 });
  return NextResponse.json(r);
}

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const gate = await flashcardGate(ctx, true);
  if ("refusal" in gate) return NextResponse.json({ error: gate.refusal.error }, { status: gate.refusal.status });
  const body = await req.json().catch(() => ({}));
  if (!isUuid(body?.materialId)) return NextResponse.json({ error: "Choose the material this card belongs to." }, { status: 400 });
  const check = checkPersonalCard(body, new Set((await flashcardFronts(ctx.admin, ctx.userId)).values()));
  if (!check.ok) return NextResponse.json({ error: check.message, reason: check.reason }, { status: check.reason === "identifier" ? 422 : check.reason === "duplicate" ? 409 : 400 });
  const competencyId = isUuid(body?.chunkId) ? leadingCompetency(await chunkMappings(ctx.admin, ctx.userId, body.chunkId)) : null;
  const made = await insertLearnerCard(ctx.admin, ctx.userId, { materialId: body.materialId, chunkId: isUuid(body?.chunkId) ? body.chunkId : null, front: check.front, back: check.back, competencyId });
  if (!made.ok) return NextResponse.json({ error: made.error === "not_found" ? "That material could not be found, or it has no readable sections." : made.error === "not_provisioned" ? "Cards you write yourself are not available here yet." : "Your card could not be saved just now." }, { status: made.error === "not_found" ? 404 : made.error === "not_provisioned" ? 409 : 500 });
  let note: string | null = null;
  if (isUuid(body?.deckId)) {
    const deck = (await flashcardDecks(ctx.admin, ctx.userId)).find(d => d.id === body.deckId);
    if (!deck) note = "Your card is saved. That deck could not be found, so it was not added to one.";
    else if (deck.cardIds.length >= gate.policy.scholarFlashcardDeckMax) note = `Your card is saved. The deck holds at most ${gate.policy.scholarFlashcardDeckMax} cards, so it was not added.`;
    else if (!(await addDeckCards(ctx.admin, ctx.userId, deck.id, [made.id]))) note = "Your card is saved, but it could not be added to the deck just now.";
  }
  // Codes only: never the card's words.
  await audit(ctx, "individual_scholar_flashcard_written", "individual_scholar_question", made.id, { deck: isUuid(body?.deckId), competency: !!competencyId });
  return NextResponse.json({ id: made.id, note });
}
