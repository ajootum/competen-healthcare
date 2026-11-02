import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { settingsClearService, settingsService } from "@/lib/individual/scholar/plan-service";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/study-plan -- SCHOLAR-COMPANION-01, migration 780; PLP-01..04, migration 840.
//
// POST saves the caller's study plan settings (one row each, replaced), in the OLD shape { examDate?, examLabel?, weeklyMinutes, daysPerWeek, goal?,
// priorities? } or the new three-question shape { goalType: learn | exam | revise, sessionMinutes, daysPerWeek, examDate? (an exam), examLabel?, goal?,
// priorities?, confirmIncrease? } where weekly minutes = session minutes x days. A raise above scholar_plan_max_weekly_minutes needs confirmIncrease:true
// (else 409). DELETE clears them. Nothing here calls AI, and the plan itself is never stored: it is worked out from these settings and the learner's own
// practice. A study plan is not an assessment. The same logic answers POST /api/individual/scholar/plan/settings (plan-service.ts).
//
// Gated like the other 7xx features: the policy scholar_study_plan must be on AND 780 present (isStudyPlanOn), else 403 / 409.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const r = await settingsService(ctx, body, req.headers);
  return NextResponse.json(r.body, { status: r.status });
}

export async function DELETE() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const r = await settingsClearService(ctx);
  return NextResponse.json(r.body, { status: r.status });
}
