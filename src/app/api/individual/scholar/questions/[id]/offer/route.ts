import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { getPassage, questionsByIds } from "@/lib/individual/scholar/store";
import { audit } from "@/lib/individual/scholar/http";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { QUESTION_OFFERING_OFF, offerQuestion, questionOfferingOn, withdrawQuestionOffer } from "@/lib/question-offers/offers";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/individual/scholar/questions/[id]/offer -- SQIE-LIBRARY-EXPANSION-01 (owner GO 31 Oct 2026, item F), migration 802.
//
// POST { includeQuote?: boolean, rightsConfirmed?: boolean } offers ONE of the learner's own practice questions to the
// governed Competen question library: an explicit, per-question action, only with their separate permission granted and
// scholar_question_offering on. Scholar reads the question (owner-keyed) and the section of their notes it came from,
// and hands both to src/lib/question-offers/offers.ts, which builds the structured snapshot, screens it (identifiers,
// text copied from the notes) and refuses it, keeping nothing, on any finding. The notes themselves are never sent or
// kept. A governed library copy and a case step are not the learner's own and cannot be offered. No AI, no charge.
// DELETE { offerId } withdraws an offer not yet taken in -- NEVER gated: a privacy right does not wait on a switch.

export async function POST(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const id = (await ctx2.params).id;
  if (!questionOfferingOn(await loadIndividualPolicy(ctx.admin))) return NextResponse.json({ error: QUESTION_OFFERING_OFF }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const read = await questionsByIds(ctx.admin, ctx.userId, [id]);
  const q = read.ok ? read.data[0] : null;
  if (!q) return NextResponse.json({ error: "That question could not be found." }, { status: 404 });
  if (q.library || q.kind === "case") return NextResponse.json({ error: "Only a practice question of your own can be offered." }, { status: 409 });
  const passage = await getPassage(ctx.admin, ctx.userId, q.chunkId);
  const r = await offerQuestion(ctx.admin, {
    userId: ctx.userId, questionId: q.id,
    input: { question: q, sources: passage ? [passage.content] : [], includeQuote: body?.includeQuote === true, rightsConfirmed: body?.rightsConfirmed === true },
    // A rule writes cloze items from the notes (no model). Every other stored question was written by AI from the notes.
    aiWritten: !/^rule|^competen-/.test(q.model),
  });
  if (!r.ok) return NextResponse.json({ error: r.error, blocks: r.blocks ?? [] }, { status: 409 });
  await audit(ctx, "individual_scholar_question_offered", "question_offer", r.offerId, { duplicate: r.duplicate, quote: body?.includeQuote === true });
  return NextResponse.json(r);
}

export async function DELETE(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const r = await withdrawQuestionOffer(ctx.admin, { userId: ctx.userId, offerId: String(body?.offerId ?? "") });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  await audit(ctx, "individual_scholar_question_offer_withdrawn", "question_offer", String(body?.offerId ?? "") || null, { withdrawn: r.withdrawn });
  return NextResponse.json(r);
}
