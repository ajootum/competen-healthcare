import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isStudyPlanOn, loadIndividualPolicy } from "@/lib/individual/policy";
import { clearStudyPlan, saveStudyPlan, studyPlanSchema } from "@/lib/individual/scholar/store";
import { cleanStudyPlanInput } from "@/lib/individual/scholar/study-plan-input";
import { audit } from "@/lib/individual/scholar/http";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/study-plan -- SCHOLAR-COMPANION-01, migration 780.
//
// POST { examDate?, examLabel?, weeklyMinutes, daysPerWeek, goal?, priorities? } saves the caller's study plan settings
// (one row each, replaced). DELETE clears them. Nothing here calls AI, and the plan itself is never stored: it is worked out
// on the Progress page from these settings and the learner's own practice. A study plan is not an assessment.
//
// Gated like the other 7xx features: the policy scholar_study_plan must be on AND 780 present (isStudyPlanOn), else 403 / 409.

async function gate(ctx: { admin: unknown; userId: string }): Promise<{ refusal: NextResponse } | null> {
  const policy = await loadIndividualPolicy(ctx.admin);
  if (!policy.scholarStudyPlan) return { refusal: NextResponse.json({ error: "The study plan is not offered here." }, { status: 403 }) };
  if (!isStudyPlanOn(policy, await studyPlanSchema(ctx.admin, ctx.userId)))
    return { refusal: NextResponse.json({ error: "The study plan is not available here yet." }, { status: 409 }) };
  return null;
}

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const refused = await gate(ctx);
  if (refused) return refused.refusal;
  const body = await req.json().catch(() => ({}));
  const clean = cleanStudyPlanInput(body, new Date().toISOString().slice(0, 10));
  if (!clean.ok) return NextResponse.json({ error: clean.message }, { status: clean.identifier ? 422 : 400 });
  const saved = await saveStudyPlan(ctx.admin, ctx.userId, clean.value);
  if (!saved.ok) {
    return saved.error === "not_provisioned"
      ? NextResponse.json({ error: "The study plan is not available here yet." }, { status: 409 })
      : NextResponse.json({ error: "Your study plan could not be saved just now. Try again shortly." }, { status: 500 });
  }
  await audit(ctx, "individual_scholar_study_plan_saved", "individual_scholar_study_plan", ctx.userId, {
    dated: clean.value.examDate !== null, weeklyMinutes: clean.value.weeklyMinutes, daysPerWeek: clean.value.daysPerWeek, priorities: clean.value.priorities.length,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const refused = await gate(ctx);
  if (refused) return refused.refusal;
  const r = await clearStudyPlan(ctx.admin, ctx.userId);
  if (r === "not_provisioned") return NextResponse.json({ error: "The study plan is not available here yet." }, { status: 409 });
  if (r === "failed") return NextResponse.json({ error: "Your study plan could not be cleared just now. Try again shortly." }, { status: 500 });
  await audit(ctx, "individual_scholar_study_plan_cleared", "individual_scholar_study_plan", ctx.userId, {});
  return NextResponse.json({ ok: true });
}
