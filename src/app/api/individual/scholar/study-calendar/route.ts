import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { audit } from "@/lib/individual/scholar/http";
import { calendarSchema, putCalendarEntry, removeCalendarEntry } from "@/lib/individual/scholar/store";
import { CALENDAR_REACH_DAYS, validateMove } from "@/lib/individual/scholar/study-calendar";
import { OPTOUT_REF, addDays, dayNum, isDay, isMonth, recommendedDate } from "@/lib/individual/scholar/monthly-review";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/individual/scholar/study-calendar -- SCHOLAR-MONTHLY-REVIEW-01, migration 830.
//
// POST { action: "reschedule", kind: "plan_activity" | "monthly_review", ref, originalDate?, scheduledDate }
//        moves a planned activity or a monthly review to a day from today to 60 days on. (A review original date is worked out here.)
//      { action: "restore", kind, ref }   puts it back where the plan had it.
//      { action: "optout", value: boolean }   stops (true) or restores (false) monthly review suggestions, where policy lets the learner.
// OWN ROWS ONLY, keyed on the caller. NEVER A CARD DATE: nothing here reads or writes a card schedule. A move is a scheduling
// choice for the plan and the review only. Without 830 every action answers 409 and the calendar offers no Move button.

const PLAN_REF = /^(learn|revise|apply|evaluate)\|[a-z0-9-]{0,60}\|[0-9]{1,3}$/;

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const policy = await loadIndividualPolicy(ctx.admin);
  const today = new Date().toISOString().slice(0, 10);
  const action = body?.action;
  const notReady = () => NextResponse.json({ error: "Moving things on the calendar is not available here yet." }, { status: 409 });
  if (!(await calendarSchema(ctx.admin, ctx.userId))) return notReady();
  const failed = () => NextResponse.json({ error: "That could not be saved just now. Try again shortly." }, { status: 500 });

  if (action === "optout") {
    if (policy.scholarMonthlyReview !== "on") return NextResponse.json({ error: "The monthly review is not offered here." }, { status: 403 });
    if (body?.value === true) {
      if (policy.scholarMonthlyReviewOptout !== "allowed") return NextResponse.json({ error: "Monthly review suggestions cannot be turned off here." }, { status: 403 });
      const r = await putCalendarEntry(ctx.admin, ctx.userId, "preference", OPTOUT_REF, { originalDate: null, scheduledDate: null, value: { optedOutAt: new Date().toISOString() } });
      if (r === "not_provisioned") return notReady();
      if (r !== "ok") return failed();
    } else {
      const r = await removeCalendarEntry(ctx.admin, ctx.userId, "preference", OPTOUT_REF);
      if (r === "not_provisioned") return notReady();
      if (r !== "ok") return failed();
    }
    await audit(ctx, "individual_scholar_monthly_review_optout", "individual_scholar_calendar_entry", null, { optedOut: body?.value === true });
    return NextResponse.json({ ok: true });
  }

  if (policy.scholarStudyCalendar !== "on") return NextResponse.json({ error: "The study calendar is not offered here." }, { status: 403 });
  const kind = body?.kind;
  const ref = typeof body?.ref === "string" ? body.ref : "";
  if (kind !== "plan_activity" && kind !== "monthly_review") return NextResponse.json({ error: "Choose a planned activity or the monthly review." }, { status: 400 });
  if (kind === "plan_activity" ? !PLAN_REF.test(ref) : !isMonth(ref)) return NextResponse.json({ error: "That item could not be found." }, { status: 400 });

  if (action === "reschedule") {
    const to = validateMove(body?.scheduledDate, today);
    if (!to.ok) return NextResponse.json({ error: to.message }, { status: 400 });
    // The review own date is the recommended one (policy), worked out here. A planned activity date must be near today.
    let from: string;
    if (kind === "monthly_review") from = recommendedDate(ref, policy.scholarMonthlyReviewRecommendDays);
    else {
      if (!isDay(body?.originalDate) || Math.abs(dayNum(body.originalDate) - dayNum(today)) > CALENDAR_REACH_DAYS) return NextResponse.json({ error: "That item could not be found." }, { status: 400 });
      from = body.originalDate;
    }
    const r = await putCalendarEntry(ctx.admin, ctx.userId, kind, ref, { originalDate: from, scheduledDate: to.date });
    if (r === "not_provisioned") return notReady();
    if (r !== "ok") return failed();
    await audit(ctx, "individual_scholar_calendar_rescheduled", "individual_scholar_calendar_entry", null, { kind, from, to: to.date, days: dayNum(to.date) - dayNum(from) });
    return NextResponse.json({ ok: true, scheduledDate: to.date, horizon: addDays(today, CALENDAR_REACH_DAYS) });
  }

  if (action === "restore") {
    const r = kind === "plan_activity"
      ? await removeCalendarEntry(ctx.admin, ctx.userId, kind, ref)
      : await putCalendarEntry(ctx.admin, ctx.userId, kind, ref, { originalDate: null, scheduledDate: null });
    if (r === "not_provisioned") return notReady();
    if (r !== "ok") return failed();
    await audit(ctx, "individual_scholar_calendar_restored", "individual_scholar_calendar_entry", null, { kind });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
