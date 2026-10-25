import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { isUuid } from "@/lib/individual/professional/validate";
import { parseReview } from "@/lib/individual/professional/plan-form";
import { addReview } from "@/lib/individual/professional/plan-store";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// POST /api/individual/professional/goal-reviews -- COMPETEN-PROFESSIONAL-PLAN-01 P6 (migration 480).
//
// { goalId, undertaken?, learned?, evidence?, changed?, next?, decision, priority? } records a private, append-only
// review and the decision taken: keep going, revise, reprioritise, addressed, defer, retire or reopen. Addressed is
// the person's own judgement: the goal becomes done, and nothing is verified, certified or shared.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  if (!isUuid(fields.goalId)) return refuse("Choose a goal.");
  const { data: goal } = await ctx.admin.from("individual_professional_goal").select("id, status").eq("id", fields.goalId).eq("user_id", ctx.userId).maybeSingle();
  if (!goal) return refuse("That goal is not on your record.", 404);
  const r = parseReview(fields, goal.status, (await loadIndividualPolicy(ctx.admin)).professionalPlan);
  if (!r.ok) return refuse(r.error);
  const out = await addReview(ctx.admin, ctx.userId, goal, r.value);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_goal_review", "individual_professional_goal_review", out.id, { decision: r.value.decision });
  return NextResponse.json({ ok: true, id: out.id }, { status: 201 });
}
