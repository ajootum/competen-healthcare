import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { settingsGetService, settingsService } from "@/lib/individual/scholar/plan-service";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// GET  /api/individual/scholar/plan/settings  the saved settings (goalType, sessionMinutes, ...), exam offers from the learner's own calendar, and the weekly maximum.
// POST /api/individual/scholar/plan/settings  { goalType, sessionMinutes, daysPerWeek, examDate?, examLabel?, goal?, priorities?, confirmIncrease? } (or the old shape),
//   or { applyExamOffer: <occurrence key>, confirm: true } to use an exam in the calendar as the exam date and goal. A raise above scholar_plan_max_weekly_minutes
//   needs confirmIncrease:true (else 409). Logged as a settings change (migration 840). The same service backs POST /api/individual/scholar/study-plan.
// OWN ROWS ONLY (the guard's user id, never a body field), experience "scholar" only. NO AI. The logic and its limits are in plan-service.ts.

const json = (r: { status: number; body: Record<string, unknown> }) => NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  return json(await settingsGetService(ctx, req.headers));
}

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  return json(await settingsService(ctx, body, req.headers));
}
