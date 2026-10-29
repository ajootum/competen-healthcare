import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { requestAssessmentFor } from "@/lib/competency/verification";
import { loadClassifications, typeOf } from "@/lib/hq/account-classification";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/hq/competency-requests -- CCHU Competency Assessment Implementation (owner GO 29 Oct 2026), phase 2 item 6,
// migration 690. A Competency Programme Lead asks for an assessment for an eligible person.
//
//   POST { action: "request_for", userId, competencyId, methodVersionId, targetLevelId?, context?, note?, renewsDecisionId? }
//
// ⚠ GATED BY hq.competency.verification.request. The DATABASE checks the requester again (690), the published,
// clinically approved method and its pinned criteria, and every 510 rule of a request. Eligible: an account confirmed
// as a real person (650), never the lead themself. The person adds the evidence, may withdraw, and nobody decides
// their own assessment.
// ⚠ The audit row names the request, the person and the competency, never the note.

const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.competency.verification.request"]);
  if (isHqRefusal(ctx)) return ctx;
  const b = await req.json().catch(() => ({}));
  if (b?.action !== "request_for") return refuse(400, "Unknown action.");
  const out = await requestAssessmentFor(ctx.admin, ctx.userId, b, async (admin, userId) => {
    const m = await loadClassifications(admin);
    return m.available && typeOf(m, userId) === "human";
  });
  if (!out.ok) return refuse(out.status, out.error);
  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName,
    action: "competency_assessment_request_for", entity_type: "competency_verification_request", entity_id: out.requestId,
    new_value: { person: b.userId, competency: b.competencyId, renews: b.renewsDecisionId ?? null },
  }).then((r: unknown) => r, () => {});
  return NextResponse.json({ ok: true, requestId: out.requestId }, { status: 201 });
}
