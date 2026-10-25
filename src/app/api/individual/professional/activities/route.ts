import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { isUuid } from "@/lib/individual/professional/validate";
import { parseActivityForm } from "@/lib/individual/professional/plan-form";
import {
  attachRecordToActivity, createActivity, deleteActivity, detachRecordFromActivity, moveActivity, updateActivity,
} from "@/lib/individual/professional/plan-store";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/activities -- COMPETEN-PROFESSIONAL-PLAN-01 P2 (migration 480).
//
//   POST            a planned activity, optionally under a goal (goalId). No plan is needed first.
//   PUT ?id=        revise it. Only the fields the form sent are written. 480's trigger keeps its history.
//   PATCH           { id, status } (never completed by hand), { id, attachCpdId | attachLearningRecordId }: it happened,
//                   { id, detach: "cpd" | "learning" }, or { id, goalId, move: "up" | "down" } within a goal.
//   DELETE ?id=     remove it from the plan. The CPD entry or learning record it pointed at is untouched.
//
// ⚠ THE STAGE 3/4 CONTRACT. An activity references the record of what happened and never copies it. Completed exists
// only with that reference, which 480 enforces. Every write is the caller's own: composite keys refuse anything else.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const form = parseActivityForm(fields, (await loadIndividualPolicy(ctx.admin)).professionalPlan);
  if (!form.ok) return refuse(form.error);
  const goalId = isUuid(fields.goalId) ? fields.goalId : null;
  const made = await createActivity(ctx.admin, ctx.userId, form.value, goalId);
  if (!made.ok) return refuse(made.error, made.status);
  await audit(ctx, "individual_professional_activity_create", "individual_professional_activity", made.id, { goal: goalId, suggested: fields.suggested === "ai" ? "ai" : fields.suggested === "rule" ? "rule" : null });
  return NextResponse.json({ ok: true, id: made.id }, { status: 201 });
}

export async function PUT(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return refuse("Choose an activity.");
  const { fields } = await readBody(req);
  const form = parseActivityForm(fields, (await loadIndividualPolicy(ctx.admin)).professionalPlan, true);
  if (!form.ok) return refuse(form.error);
  const out = await updateActivity(ctx.admin, ctx.userId, id, form.value);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_activity_update", "individual_professional_activity", id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  if (!isUuid(fields.id)) return refuse("Choose an activity.");
  if (fields.attachCpdId !== undefined || fields.attachLearningRecordId !== undefined) {
    const ref = isUuid(fields.attachCpdId) ? { cpdId: fields.attachCpdId } : isUuid(fields.attachLearningRecordId) ? { learningRecordId: fields.attachLearningRecordId } : null;
    if (!ref) return refuse("Choose the CPD entry or learning record.");
    const out = await attachRecordToActivity(ctx.admin, ctx.userId, fields.id, ref);
    if (!out.ok) return refuse(out.error, out.status);
    await audit(ctx, "individual_professional_activity_record", "individual_professional_activity", fields.id, { kind: "cpdId" in ref ? "cpd" : "learning" });
    return NextResponse.json({ ok: true });
  }
  if (fields.detach === "cpd" || fields.detach === "learning") {
    const out = await detachRecordFromActivity(ctx.admin, ctx.userId, fields.id, fields.detach);
    if (!out.ok) return refuse(out.error, out.status);
    await audit(ctx, "individual_professional_activity_record_removed", "individual_professional_activity", fields.id, { kind: fields.detach });
    return NextResponse.json({ ok: true });
  }
  if (fields.move === "up" || fields.move === "down") {
    if (!isUuid(fields.goalId)) return refuse("Choose the goal.");
    const out = await moveActivity(ctx.admin, ctx.userId, fields.goalId, fields.id, fields.move);
    if (!out.ok) return refuse(out.error, out.status);
    return NextResponse.json({ ok: true });
  }
  const form = parseActivityForm({ status: fields.status }, (await loadIndividualPolicy(ctx.admin)).professionalPlan, true);
  if (!form.ok || fields.status === undefined) return refuse(form.ok ? "Choose a status." : form.error);
  const out = await updateActivity(ctx.admin, ctx.userId, fields.id, form.value);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_activity_status", "individual_professional_activity", fields.id, { status: form.value.status });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return refuse("Choose an activity.");
  const out = await deleteActivity(ctx.admin, ctx.userId, id);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_activity_delete", "individual_professional_activity", id);
  return NextResponse.json({ ok: true });
}
