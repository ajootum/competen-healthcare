import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { assignRequest, confirmDecision, declineAssignment, evidenceDocumentPath, recordAssessorEvidence, recordDecision, saveDecisionDraft } from "@/lib/competency/verification";
import { signDocument } from "@/lib/individual/professional/documents";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/hq/competency-assessment -- COMPETEN-PROFESSIONAL-COMPETENCY-01 C5 (migration 510), the Competency Assessor.
//
//   POST { action: "decide", requestId, outcomeCode, levelId?, rationale, criteria[], checklist[], evidenceReviewed[], componentResults[]? }
//        { action: "record_evidence", requestId, kind, ... }  (680) an assessor observation or exam result, by the assigned assessor
//        { action: "claim", requestId, appointmentId }   only where the method lets an assessor claim (self_claim)
//        { action: "decline", requestId, reason }        hand an assignment back
//        { action: "save_draft", requestId, draft }      (690) the assigned assessor working draft, resumed on any device
//        { action: "confirm", requestId, decisionId, appointmentId, result, rationale }  (690) a second assessor, neither the
//                                                         person nor the first assessor, confirms or does not confirm
//   GET  ?evidence=<id>  a five-minute link to a document of submitted evidence, for the assigned assessor only
//
// ⚠ GATED BY hq.competency.verification.assess, held only by the Competency Assessor position (510), which nobody holds
// until the owner appoints someone. NOT the Clinical Content Reviewer: approving content authorises no verification, and
// 511 keeps the two rights off one position. The DATABASE refuses a decision unless the actor is the ASSIGNED assessor,
// under their own ACTIVE appointment, in a live scope, and is not the person -- and pins the method version, its content
// hash and the competency content to the decision, which is never rewritten.
// ⚠ The audit row carries the outcome class and the request, never the rationale or the person's evidence.

const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.competency.verification.assess"]);
  if (isHqRefusal(ctx)) return ctx;
  const b = await req.json().catch(() => ({}));
  const requestId = typeof b?.requestId === "string" && UUID.test(b.requestId) ? b.requestId : null;
  if (!requestId) return refuse(400, "Choose a request.");
  let out: { ok: true; decisionId?: string; evidenceId?: string; savedAt?: string } | { ok: false; status: number; error: string };
  if (b.action === "decide") out = await recordDecision(ctx.admin, ctx.userId, requestId, b);
  else if (b.action === "claim") out = await assignRequest(ctx.admin, ctx.userId, requestId, typeof b.appointmentId === "string" ? b.appointmentId : "");
  else if (b.action === "decline") out = await declineAssignment(ctx.admin, ctx.userId, requestId, b.reason);
  else if (b.action === "record_evidence") out = await recordAssessorEvidence(ctx.admin, ctx.userId, requestId, b);
  else if (b.action === "save_draft") {
    // A draft is a working copy, not a record: saved often, so it is not audited. The decision it becomes is.
    const r = await saveDecisionDraft(ctx.admin, ctx.userId, requestId, b.draft);
    return r.ok ? NextResponse.json({ ok: true, savedAt: r.savedAt }) : refuse(r.status, r.error);
  }
  else if (b.action === "confirm") out = await confirmDecision(ctx.admin, ctx.userId, b);
  else return refuse(400, "Unknown action.");
  if (!out.ok) return refuse(out.status, out.error);
  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName,
    action: `competency_assessment_${b.action}`, entity_type: "competency_verification_request", entity_id: requestId,
    new_value: b.action === "decide" ? { decision: out.decisionId, outcome: b.outcomeCode } : b.action === "record_evidence" ? { evidence: out.evidenceId, kind: b.kind }
      : b.action === "confirm" ? { decision: b.decisionId, result: b.result } : {},
  }).then((r: unknown) => r, () => {});
  return NextResponse.json({ ok: true, ...(out.decisionId ? { decisionId: out.decisionId } : {}) });
}

export async function GET(req: Request) {
  const ctx = await hqApiGate(["hq.competency.verification.assess"]);
  if (isHqRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("evidence") ?? "";
  const out = await evidenceDocumentPath(ctx.admin, ctx.userId, id);
  if (!out.ok) return refuse(out.status, out.error);
  // Signed by Professional's documents module, which owns the private bucket. Five minutes, never stored.
  const url = await signDocument(ctx.admin, out.path);
  if (!url) return refuse(404, "The document is no longer available.");
  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName,
    action: "competency_assessment_document_view", entity_type: "competency_verification_evidence", entity_id: id, new_value: {},
  }).then((r: unknown) => r, () => {});
  return NextResponse.redirect(url, { status: 303 });
}
