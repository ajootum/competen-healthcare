import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { deleteLearnerCard, flashcardFronts, isUuid, setFlashcardMark, updateLearnerCard } from "@/lib/individual/scholar/store";
import { flashcardGate } from "@/lib/individual/scholar/flashcard-service";
import { checkCardNote, checkPersonalCard } from "@/lib/individual/scholar/flashcards";
import { FEEDBACK_REASONS } from "@/lib/ai/outcomes";
import { audit } from "@/lib/individual/scholar/http";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/flashcards/[id] -- SCHOLAR-FLASHCARDS-01. Migration 730. Owner-keyed throughout.
//
// PATCH { front, back }      edit a card the learner wrote (only theirs: a card from notes or the library is never
//                            rewritten). Its content version goes up; its schedule and review history are untouched.
// PATCH { bookmarked }       bookmark or unbookmark any of their cards.
// PATCH { note }             a private note on a card (null clears it). Screened for patient identifiers.
// PATCH { issue }            report an issue with a card, as a CODE (the five codes of the feedback path), or null to
//                            withdraw it. It is the learner's own list: nothing is published or moderated.
// DELETE                     remove a card the learner wrote, with its schedule, history and deck places.

export async function PATCH(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const gate = await flashcardGate(ctx, true);
  if ("refusal" in gate) return NextResponse.json({ error: gate.refusal.error }, { status: gate.refusal.status });
  const { id } = await ctx2.params;
  if (!isUuid(id)) return NextResponse.json({ error: "That card could not be found." }, { status: 404 });
  const body = await req.json().catch(() => ({}));

  if (typeof body?.front === "string" || typeof body?.back === "string") {
    const fronts = await flashcardFronts(ctx.admin, ctx.userId);
    fronts.delete(id);
    const check = checkPersonalCard(body, new Set(fronts.values()));
    if (!check.ok) return NextResponse.json({ error: check.message, reason: check.reason }, { status: check.reason === "identifier" ? 422 : check.reason === "duplicate" ? 409 : 400 });
    const r = await updateLearnerCard(ctx.admin, ctx.userId, id, { front: check.front, back: check.back });
    if (r !== "ok") return NextResponse.json({ error: r === "not_found" ? "Only cards you wrote can be edited. Cards from your notes or the library stay as they are." : "Your card could not be saved just now." }, { status: r === "not_found" ? 404 : 500 });
    await audit(ctx, "individual_scholar_flashcard_edited", "individual_scholar_question", id, {});
    return NextResponse.json({ ok: true });
  }

  const patch: { bookmarked?: boolean; note?: string | null; issue?: string | null } = {};
  if (typeof body?.bookmarked === "boolean") patch.bookmarked = body.bookmarked;
  if ("note" in (body ?? {})) {
    const n = checkCardNote(body.note);
    if (!n.ok) return NextResponse.json({ error: n.message }, { status: 422 });
    patch.note = n.note;
  }
  if ("issue" in (body ?? {})) {
    if (body.issue !== null && !(FEEDBACK_REASONS as readonly string[]).includes(body.issue)) return NextResponse.json({ error: "Choose what is wrong with the card." }, { status: 400 });
    patch.issue = body.issue;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  if (!(await setFlashcardMark(ctx.admin, ctx.userId, id, patch))) return NextResponse.json({ error: "That could not be saved just now." }, { status: 500 });
  // Codes only: never a note's words.
  if (patch.issue !== undefined) await audit(ctx, "individual_scholar_flashcard_issue", "individual_scholar_question", id, { issue: patch.issue });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const gate = await flashcardGate(ctx, true);
  if ("refusal" in gate) return NextResponse.json({ error: gate.refusal.error }, { status: gate.refusal.status });
  const { id } = await ctx2.params;
  const r = await deleteLearnerCard(ctx.admin, ctx.userId, id);
  if (r !== "ok") return NextResponse.json({ error: r === "not_found" ? "Only cards you wrote can be removed. Cards from your notes and the library stay with your revision history." : "Your card could not be removed just now." }, { status: r === "not_found" ? 404 : 500 });
  await audit(ctx, "individual_scholar_flashcard_deleted", "individual_scholar_question", id, {});
  return NextResponse.json({ ok: true });
}
