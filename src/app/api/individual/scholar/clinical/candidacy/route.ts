import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { candidacyStatus, grantCaseCandidacy, myCaseOffers, revokeCaseCandidacy } from "@/lib/cases/candidates";
import { ATTESTATION_TEXT, caseLibraryEnabled, loadCasePolicy } from "@/lib/cases/policy";
import { audit } from "@/lib/individual/scholar/http";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/clinical/candidacy -- the student's own, separate, revocable permission for their cases to be
// considered for the shared library (owner Stage 5 approval; candidates.ts). Separate from AI consent.
//   GET     where they stand, the CURRENT attestation text to read, and their offers with status and reasons
//   POST    { attestation: "own_notes" | "licensed_to_share", attestationVersion } -- grant, on the text they read
//   DELETE  revoke: every case not yet taken into the library is withdrawn and its content purged. Never gated.

export async function GET() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const [on, policy, status, offers] = await Promise.all([caseLibraryEnabled(ctx.admin), loadCasePolicy(ctx.admin), candidacyStatus(ctx.admin, ctx.userId), myCaseOffers(ctx.admin, ctx.userId)]);
  return NextResponse.json({ libraryOn: on, attestationVersion: policy.attestationVersion, text: ATTESTATION_TEXT[policy.attestationVersion] ?? null, status, offers: offers ?? [] });
}

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const r = await grantCaseCandidacy(ctx.admin, { userId: ctx.userId, attestation: body?.attestation, attestationVersion: String(body?.attestationVersion ?? "") });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  await audit(ctx, "individual_scholar_case_candidacy_granted", "case_candidacy", null, { attestation: body.attestation, version: body.attestationVersion });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const r = await revokeCaseCandidacy(ctx.admin, { userId: ctx.userId });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  await audit(ctx, "individual_scholar_case_candidacy_revoked", "case_candidacy", null, { withdrawn: r.withdrawn });
  return NextResponse.json(r);
}
