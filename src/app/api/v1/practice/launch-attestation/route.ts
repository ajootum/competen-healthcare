import { NextRequest, NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import {
  recordLaunchAttestation, CAP_LAUNCH_ATTEST, ATTESTABLE_CONTROLS, ATTESTATION_VERDICTS,
} from "@/lib/hq/pd-launch-attestation";

// POST /api/v1/practice/launch-attestation -- CPR-IAM-001 s14.1, the write path Launch Readiness said
// was pending.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// !! hqApiGate, NOT requireHqCapability. This is a fetch, and a redirect is not a status a caller can
// act on -- it arrives as an opaque 200 from wherever it was bounced to. Same reasoning as the flags
// and provisioning routes next door.
//
// !! IT GATES ON hq.practice.launch.attest AND NOTHING WIDER. Migration 344 created that code precisely
// so this act could not borrow flags.manage (which flips the launch flags -- the doer attesting their
// own doing) or change.approve (the checker half of PD-012 s21's maker-checker, deliberately held by
// nobody). An attestation states what was observed and authorises nothing.
//
// !! THE CAPABILITY IS RECORDED AS HELD AT THE TIME, from the gate that just admitted this caller
// rather than from a constant. Migration 340 asks for that on purpose: a grant can be revoked later,
// and an audit asks what was true when the attestation was made.
//
// !! POST, NEVER PATCH OR DELETE. The ledger is append-only (migration 340's trigger refuses both), so
// changing a verdict means appending a superseding row and naming what it supersedes. A route offering
// an edit would be advertising something the database will refuse.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const bad = (message: string) =>
  NextResponse.json({ error: { code: "VALIDATION_ERROR", message } }, { status: 400 });

export async function POST(req: NextRequest) {
  const gate = await hqApiGate([CAP_LAUNCH_ATTEST]);
  if (isHqRefusal(gate)) return gate;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return bad("invalid JSON"); }

  const controlId = String(body.controlId ?? "");
  const verdict = String(body.verdict ?? "");
  const releaseRef = String(body.releaseRef ?? "");
  if (!controlId) return bad(`controlId is required, one of: ${ATTESTABLE_CONTROLS.join(", ")}`);
  if (!verdict) return bad(`verdict is required, one of: ${ATTESTATION_VERDICTS.join(", ")}`);

  const result = await recordLaunchAttestation(gate.admin, {
    controlId, verdict, releaseRef,
    attestedBy: gate.userId,
    // !! WHAT THIS CALLER ACTUALLY HELD. An owner short-circuits the capability check and arrives with
    // an empty capabilities array (decideHq returns capabilities: [] for allow_owner), so the code is
    // named explicitly rather than read back out of the context -- otherwise a break-glass attestation
    // would record an empty string as the authority behind it.
    attestedByCapability: CAP_LAUNCH_ATTEST,
    evidenceRef: body.evidenceRef === undefined ? null : String(body.evidenceRef),
    note: body.note === undefined ? null : String(body.note),
    expiresAt: body.expiresAt === undefined ? null : String(body.expiresAt),
    supersedesId: body.supersedesId === undefined ? null : String(body.supersedesId),
  });

  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ id: result.id, controlId, verdict }, { status: 201 });
}
