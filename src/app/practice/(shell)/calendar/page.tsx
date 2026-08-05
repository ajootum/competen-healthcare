import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { plannerWeek } from "@/lib/practice/planner";
import { listFollowUps } from "@/lib/practice/follow-ups";
import { loadDay } from "@/lib/practice/scheduling";
import { calendarDay, SLOT_KINDS } from "@/lib/practice/calendar";
import { bookingLocations, locationDay } from "@/lib/practice/hospital-booking";
import { timelineDay } from "@/lib/practice/timeline";
import { zonedDayRange } from "@/lib/practice/practice-time";
import PlannerWorkspace from "./PlannerWorkspace";
import CalendarConsole from "./CalendarConsole";
import OperationsHeader from "./OperationsHeader";
import AvailabilityRibbon from "./AvailabilityRibbon";
import CalendarFooter from "./CalendarFooter";
import WhereYouAre from "./WhereYouAre";
import Timeline from "./Timeline";

// /practice/calendar -- CPR-V5-005, THE PRACTICE PLANNER.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT CHANGED, AND WHAT DELIBERATELY DID NOT.
//
// s1: "Replace the traditional appointment calendar with a Practice Planner. Activities -- not
// appointments -- are the primary planning object." So the seven-day planner is now the top of this
// route and the first thing on it.
//
// ⚠ THE APPOINTMENT BOOK IS KEPT, MOUNTED BELOW THE PLANNER, AND NOTHING IT DOES WAS DROPPED. The
// console beneath books appointments, checks patients in, moves them through the queue and STARTS
// ENCOUNTERS; the timeline drags an appointment to a new time or a different hospital; the ribbon shows
// the day's slots and the footer its totals. All of that is real, is used, and has no equivalent in the
// planner -- an activity is a BLOCK OF THE PRACTITIONER'S TIME, and a patient's 08:20 appointment is a
// different object with a different lifecycle. "Appointments are no longer the primary planning object"
// is a statement about hierarchy, not a licence to delete the half of this screen that sees patients.
//
// BOTH HALVES READ THE SAME ?date=. The planner selects its day through the URL rather than through
// client state precisely so that the book below always shows the day the planner is showing. Two ideas
// of "the day I am looking at" on one screen is how somebody edits Thursday while reading Wednesday.
//
// THE WEEK ANCHOR IS THE SAME PARAMETER: plannerWeek() takes any date inside the week it should return,
// so choosing a day in another week moves the week with no second parameter to keep in step.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  // ⚠ REAL CAPABILITY CODES ONLY -- these two are seeded by migrations 191 and 192. A code invented here
  // would compile perfectly and lock every user out of this route, including the practice owner.
  if (!hasCapability(shell.ctx, "practice.calendar.view")) redirect("/practice/home");

  const { date } = await searchParams;
  const admin = createAdminClient();
  const canManage = hasCapability(shell.ctx, "appointment.manage");

  // THE SEVEN-DAY WEEK. A failed read comes back as seven days each flagged unavailable, with the
  // database's own words in `detail` -- never as a confident empty week. The screen renders that state
  // rather than smoothing it over.
  const week = await plannerWeek(admin, shell.ctx, { date });
  const selectedDate =
    date && week.days.some(d => d.date === date) ? date
      : week.days.some(d => d.date === week.todayDate) ? week.todayDate
        : week.days[0].date;

  // The appointment book's own day. calendarDay() is on the practice's clock, like everything here.
  const c = await calendarDay(admin, shell.ctx, selectedDate);
  const initial = await loadDay(admin, shell.ctx.workspaceId, c.day);

  const dayRange = zonedDayRange(c.day, c.timezone);
  const [locations, route, timeline] = await Promise.all([
    bookingLocations(admin, shell.ctx),
    locationDay(admin, shell.ctx, dayRange.startIso, dayRange.endIso),
    timelineDay(admin, shell.ctx, c.day, c.timezone),
  ]);

  // s3's Upcoming Follow-ups. Gated on the capability that actually guards them, and ABSENT rather than
  // empty when the caller does not hold it -- "no follow-ups" and "you cannot see follow-ups" are
  // different sentences.
  //
  // listFollowUps now REPORTS a failed read instead of returning an empty list for it, so this panel can
  // finally tell "nothing open or scheduled" apart from "could not find out" -- the distinction the
  // comment here used to describe as a limitation it had to live with.
  const canSeeFollowUps = hasCapability(shell.ctx, "followup.view");
  const followUpResult = canSeeFollowUps
    ? await listFollowUps(admin, shell.ctx.workspaceId, { status: ["OPEN", "SCHEDULED"], limit: 50 })
    : { items: [], unavailable: false, detail: null };
  // THREE ANSWERS, NOT TWO. "You are not permitted to see this", "it could not be read" and "there is
  // nothing" are different things, and the panel below renders the third only when the first two are
  // ruled out. This is the whole reason listFollowUps changed shape.
  const followUpsUnavailable = !canSeeFollowUps
    ? "You do not hold followup.view, so this panel is not showing you anything."
    : followUpResult.unavailable
      ? `Your follow-ups could not be read just now. ${followUpResult.detail ?? ""}`.trim()
      : null;
  const followUps = followUpResult.items.slice(0, 6).map(f => ({
    id: String(f.id),
    patientName: (f.patient_name as string | null) ?? null,
    dueOn: String(f.due_on),
    kind: (f.kind as string | null) ?? null,
    overdue: Boolean(f.overdue),
  }));

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5">
        <PlannerWorkspace
          week={week}
          selectedDate={selectedDate}
          canManage={canManage}
          locations={locations.map(l => ({ id: l.id, name: l.name, facility: l.facility?.name ?? null }))}
          followUps={followUps}
          followUpsUnavailable={followUpsUnavailable}
        />

        {/* ── THE APPOINTMENT BOOK. Still here, still doing everything it did. ─────────────────── */}
        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-[15px] font-bold text-gray-900">Appointment book</h2>
          <p className="text-[12px] text-gray-500">
            {c.day} — the patients booked into this day, their arrival and the encounters started from it.
            Activities are what you plan; appointments are who is coming.
          </p>
        </section>

        <OperationsHeader c={c} />
        <AvailabilityRibbon c={{ ...c, kinds: SLOT_KINDS }} />
        <WhereYouAre route={JSON.parse(JSON.stringify(route))} timezone={c.timezone} />

        <Timeline
          timeline={JSON.parse(JSON.stringify(timeline))}
          canManage={canManage}
        />

        <CalendarConsole
          date={c.day}
          canManage={canManage}
          canQueue={hasCapability(shell.ctx, "queue.manage")}
          canStartEncounter={hasCapability(shell.ctx, "encounter.create")}
          initial={JSON.parse(JSON.stringify(initial))}
          locations={locations.map(l => ({ id: l.id, name: l.name, type: l.type, facility: l.facility }))}
        />

        <CalendarFooter c={c} />
      </div>
    </div>
  );
}
