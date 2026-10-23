import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid, parseGoal, parseGoalStatus } from "@/lib/individual/professional/validate";
import { ORIGIN } from "@/lib/individual/professional/vocabulary";
import { audit, readBody, refuse, writeFailed } from "@/lib/individual/professional/api";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/goals -- COMPETEN-IND-007 s3, the learning plan.
//
// A goal has a target date and may serve one development need. Migration 373's composite foreign key
// (need_id, user_id) makes a link to another person's need unrepresentable. The check before the insert
// is only there to answer with a sentence instead of a constraint error.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
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
