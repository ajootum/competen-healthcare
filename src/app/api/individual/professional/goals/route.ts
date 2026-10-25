import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid, parseGoal, parseGoalStatus } from "@/lib/individual/professional/validate";
import { ORIGIN } from "@/lib/individual/professional/vocabulary";
import { audit, readBody, refuse, writeFailed } from "@/lib/individual/professional/api";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { checkGoalStatusChange, parseGoalForm, parseGoalSource } from "@/lib/individual/professional/plan-form";
import { createGoal, linkPlanCompetency, setGoalStatus, updateGoal } from "@/lib/individual/professional/plan-store";
import { loadCatalogueFor } from "@/lib/individual/catalogue";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/goals -- COMPETEN-IND-007 s3, the learning plan.
//
// A goal has a target date and may serve one development need. Migration 373's composite foreign key
// (need_id, user_id) makes a link to another person's need unrepresentable. The check before the insert
// is only there to answer with a sentence instead of a constraint error.
//
// COMPETEN-PROFESSIONAL-PLAN-01 (Stage 3, migration 480). A body with `stage3` set uses the Stage 3 form: only the
// description is required, the target date is optional, every other field is configured and optional, and it may say
// where the goal came from (a need, a competency, a learning opportunity, an aspiration, a reflection, an evaluation).
// PUT revises only the fields the form sent (480's trigger keeps the earlier version). PATCH with `stage3` takes any
// offered status, subject to the reopen rule. Without `stage3` everything below behaves exactly as the MVP did.

const isStage3 = (f: Record<string, unknown>) => f.stage3 === true || f.stage3 === "true";

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  if (isStage3(fields)) {
    const policy = (await loadIndividualPolicy(ctx.admin)).professionalPlan;
    const form = parseGoalForm(fields, policy);
    if (!form.ok) return refuse(form.error);
    const src = parseGoalSource(fields);
    if (!src.ok) return refuse(src.error);
    const offered = src.value.competencyId ? await loadCatalogueFor(ctx.admin, "professional") : null;
    if (src.value.competencyId && !offered?.some(c => c.competencyId === src.value.competencyId)) return refuse("That competency is not one Competen Professional offers.");
    const made = await createGoal(ctx.admin, ctx.userId, form.value, src.value);
    if (!made.ok) return refuse(made.error, made.status);
    if (src.value.competencyId && offered && policy.competencyLinks === "offered") await linkPlanCompetency(ctx.admin, ctx.userId, { goalId: made.id! }, src.value.competencyId, offered, null);
    await audit(ctx, "individual_professional_goal_create", "individual_professional_goal", made.id, { stage3: true, from: src.value.createdFrom });
    return NextResponse.json({ ok: true, id: made.id }, { status: 201 });
  }
  const parsed = parseGoal(fields);
  if (!parsed.ok) return refuse(parsed.error);
  if (parsed.value.need_id) {
    const { data: need } = await ctx.admin.from("individual_professional_need").select("id").eq("id", parsed.value.need_id).eq("user_id", ctx.userId).maybeSingle();
    if (!need) return refuse("That need is not on your record.");
  }
  const { data, error } = await ctx.admin.from("individual_professional_goal")
    .insert({ ...parsed.value, user_id: ctx.userId, experience_code: ORIGIN }).select("id").single();
  if (error || !data) return writeFailed("goal");
  await audit(ctx, "individual_professional_goal_create", "individual_professional_goal", data.id);
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  if (isStage3(fields)) {
    if (!isUuid(fields.id)) return refuse("Choose a goal.");
    const { data: before } = await ctx.admin.from("individual_professional_goal").select("id, status").eq("id", fields.id).eq("user_id", ctx.userId).maybeSingle();
    if (!before) return refuse("That goal is not on your record.", 404);
    const ch = checkGoalStatusChange(before.status, fields.status, (await loadIndividualPolicy(ctx.admin)).professionalPlan);
    if (!ch.ok) return refuse(ch.error);
    const out = await setGoalStatus(ctx.admin, ctx.userId, before.id, ch.value);
    if (!out.ok) return refuse(out.error, out.status);
    await audit(ctx, "individual_professional_goal_status", "individual_professional_goal", before.id, { from: before.status, to: ch.value, stage3: true });
    return NextResponse.json({ ok: true });
  }
  const status = parseGoalStatus(fields.status);
  if (!isUuid(fields.id) || !status) return refuse("Choose a goal and a status.");
  const now = new Date().toISOString();
  const { data, error } = await ctx.admin.from("individual_professional_goal")
    .update({ status, completed_at: status === "done" ? now : null, updated_at: now })
    .eq("id", fields.id).eq("user_id", ctx.userId).select("id").maybeSingle();
  if (error) return writeFailed("goal");
  if (!data) return refuse("That goal is not on your record.", 404);
  await audit(ctx, "individual_professional_goal_status", "individual_professional_goal", data.id, { status });
  return NextResponse.json({ ok: true });
}

/** PUT ?id= -- edit a goal's title, detail, target date and need: the same checks as adding one. Status is PATCH. */
export async function PUT(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return refuse("Choose a goal.");
  const { fields } = await readBody(req);
  if (isStage3(fields)) {
    const form = parseGoalForm(fields, (await loadIndividualPolicy(ctx.admin)).professionalPlan, true);
    if (!form.ok) return refuse(form.error);
    const out = await updateGoal(ctx.admin, ctx.userId, id, { ...form.value, reviewed: true });
    if (!out.ok) return refuse(out.error, out.status);
    await audit(ctx, "individual_professional_goal_update", "individual_professional_goal", id, { stage3: true });
    return NextResponse.json({ ok: true });
  }
  const parsed = parseGoal(fields);
  if (!parsed.ok) return refuse(parsed.error);
  if (parsed.value.need_id) {
    const { data: need } = await ctx.admin.from("individual_professional_need").select("id").eq("id", parsed.value.need_id).eq("user_id", ctx.userId).maybeSingle();
    if (!need) return refuse("That need is not on your record.");
  }
  const { data, error } = await ctx.admin.from("individual_professional_goal")
    .update({ ...parsed.value, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", ctx.userId).select("id").maybeSingle();
  if (error) return writeFailed("goal");
  if (!data) return refuse("That goal is not on your record.", 404);
  await audit(ctx, "individual_professional_goal_update", "individual_professional_goal", id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return refuse("Choose a goal.");
  const { data, error } = await ctx.admin.from("individual_professional_goal")
    .delete().eq("id", id).eq("user_id", ctx.userId).select("id").maybeSingle();
  if (error) return writeFailed("goal");
  if (!data) return refuse("That goal is not on your record.", 404);
  await audit(ctx, "individual_professional_goal_delete", "individual_professional_goal", id);
  return NextResponse.json({ ok: true });
}
