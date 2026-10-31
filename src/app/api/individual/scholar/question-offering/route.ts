import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { audit } from "@/lib/individual/scholar/http";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import {
  QUESTION_OFFER_ATTESTATION, QUESTION_OFFER_ATTESTATION_VERSION, QUESTION_OFFERING_OFF, grantQuestionOffering, myQuestionOffers, questionOfferingOn,
  questionOfferingStatus, revokeQuestionOffering,
} from "@/lib/question-offers/offers";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/individual/scholar/question-offering -- SQIE-LIBRARY-EXPANSION-01 (owner GO 31 Oct 2026, item F), migration 802.
// The learner's own, SEPARATE, revocable permission for their practice questions to be considered for the governed
// Competen question library (src/lib/question-offers/offers.ts). Separate from AI consent and from case candidacy.
//   GET     where they stand, the CURRENT attestation text to read, and their offers with status
//   POST    { attestation: "own_notes" | "licensed_to_share", attestationVersion } -- grant (refused while scholar_question_offering is off)
//   DELETE  revoke: every offer not yet taken in is withdrawn and its content purged. NEVER gated.

export async function GET() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const [status, offers, policy] = await Promise.all([questionOfferingStatus(ctx.admin, ctx.userId), myQuestionOffers(ctx.admin, ctx.userId), loadIndividualPolicy(ctx.admin)]);
  return NextResponse.json({ offeringOn: questionOfferingOn(policy), attestationVersion: QUESTION_OFFER_ATTESTATION_VERSION, text: QUESTION_OFFER_ATTESTATION[QUESTION_OFFER_ATTESTATION_VERSION], status, offers: offers ?? [] });
}

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  // Granting has its own switch (scholar_question_offering, default off). Revoking below is never gated.
  if (!questionOfferingOn(await loadIndividualPolicy(ctx.admin))) return NextResponse.json({ error: QUESTION_OFFERING_OFF }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const r = await grantQuestionOffering(ctx.admin, { userId: ctx.userId, attestation: body?.attestation, attestationVersion: body?.attestationVersion });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  await audit(ctx, "individual_scholar_question_offering_granted", "question_offer_permission", null, { attestation: body.attestation, version: QUESTION_OFFER_ATTESTATION_VERSION });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const r = await revokeQuestionOffering(ctx.admin, { userId: ctx.userId });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  await audit(ctx, "individual_scholar_question_offering_revoked", "question_offer_permission", null, { withdrawn: r.withdrawn });
  return NextResponse.json(r);
}
