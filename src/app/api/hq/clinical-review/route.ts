/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { decideReview } from "@/lib/competency/clinical-review";
import { approveMany } from "@/lib/competency/review-decide-batch";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/clinical-review -- owner decision D2, migration 395.
//
// Body: { versionId, appointmentId, decision: "approved" | "rejected", comment? }
//
// ⚠ GATED BY hqApiGate(["hq.quality.clinical.approve"]) -- the Clinical Content Reviewer position. The gate
// decides who may knock. The 395 trigger decides whether THIS decision is valid: the reviewer must not have
// authored, edited or put forward the version, the appointment must be their own, active and in scope, and the
// content must not have changed since. The route never re-implements those rules, so they cannot drift.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.quality.clinical.approve"]);
  if (isHqRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  // Framework-level approval (owner, 29 Oct 2026): one decision per competency version, each re-checked against the
  // reviewer's own queue at decision time (src/lib/competency/review-decide-batch.ts). Approval only.
  if (body?.action === "approve_many") {
    const items = Array.isArray(body.items) ? body.items.filter((i: any) => isId(i?.versionId) && isId(i?.competencyId)).slice(0, 500) : [];
    if (!items.length) return refuse(400, "Choose the competencies to approve.");
    if (body.acknowledged !== true) return refuse(422, "Confirm that you reviewed each competency at the version shown.");
    const note = typeof body.comment === "string" && body.comment.trim() ? body.comment.trim().slice(0, 2000) : null;
    const results = await approveMany(ctx.admin, ctx.userId, items, note);
    if (!results) return refuse(503, "Your review queue could not be read just now. Nothing was recorded.");
    await ctx.admin.from("audit_log").insert({
      trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null,
      action: "clinical_review_decided_many", entity_type: "clinical_content_version", entity_id: null,
      new_value: { decision: "approved", items: results.map(r => ({ version_id: r.versionId, outcome: r.outcome })) },
    }).then((x: unknown) => x, () => {});
    return NextResponse.json({ results });
  }
  if (!isId(body?.versionId) || !isId(body?.appointmentId)) return refuse(400, "Choose a content version and your appointment.");
  if (body.decision !== "approved" && body.decision !== "rejected") return refuse(400, "Approve or reject.");
  const comment = typeof body.comment === "string" && body.comment.trim() ? body.comment.trim().slice(0, 2000) : null;
  if (body.decision === "rejected" && !comment) return refuse(422, "Say what needs to change.");

  const r = await decideReview(ctx.admin, body.versionId, ctx.userId, body.appointmentId, body.decision, comment);
  if (!r.ok) return refuse(409, r.error);
  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null,
    action: "clinical_review_decided", entity_type: "clinical_content_version", entity_id: body.versionId,
    new_value: { decision: body.decision, appointment_id: body.appointmentId },
  }).then((x: unknown) => x, () => {});
  return NextResponse.json({ ok: true });
}
