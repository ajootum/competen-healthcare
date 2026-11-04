import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { decideDocumentsReview, submitDocumentsReview, DOCUMENTS_REVIEW_CAP } from "@/lib/hq/documents-review";

export const dynamic = "force-dynamic";

// /api/hq/governance/documents-review -- the two-person review of the Document Template Studio configuration (migration 942, s3).
//   POST { action: "submit", note? }                                  submit the CURRENT draft for review
//   POST { action: "decide", reviewId, decision, note? }              approve it or ask for changes (a different holder)
// Gated by hq.individual.config.manage, held through an appointment (an owner counts through their own). Publishing stays the one
// publish of the Individual policy (/api/hq/individual/config); the database refuses a publish without an independent approval.
// Every refusal is the database's own sentence.

const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const ctx = await withOwnAppointments(await hqApiGate([DOCUMENTS_REVIEW_CAP]), [DOCUMENTS_REVIEW_CAP]);
  if (isHqRefusal(ctx)) return ctx;
  if (!ctx.capabilities.includes(DOCUMENTS_REVIEW_CAP)) return refuse(403, "Reviewing the document templates needs the Competen Individual policy right, held through an appointment.");
  const b = await req.json().catch(() => ({}));
  const note = typeof b?.note === "string" ? b.note : null;
  if (b?.action === "submit") {
    const r = await submitDocumentsReview(ctx.admin, ctx.userId, note);
    return r.ok ? NextResponse.json({ ok: true, reviewId: r.reviewId }, { status: 201 }) : refuse(r.status, r.error);
  }
  if (b?.action === "decide") {
    if (typeof b?.reviewId !== "string" || !UUID.test(b.reviewId)) return refuse(400, "Choose the submission to decide.");
    if (b?.decision !== "approved" && b?.decision !== "changes_requested") return refuse(400, "Approve it, or ask for changes.");
    if (b.decision === "changes_requested" && (note ?? "").trim().length < 3) return refuse(400, "Say what must change.");
    const r = await decideDocumentsReview(ctx.admin, ctx.userId, b.reviewId, b.decision, note);
    return r.ok ? NextResponse.json({ ok: true }) : refuse(r.status, r.error);
  }
  return refuse(400, "Unknown action.");
}
