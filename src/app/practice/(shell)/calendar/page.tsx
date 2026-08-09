import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { plannerForPeriod, scheduleSearch } from "@/lib/practice/planner";
import {
  plannerPeriod, isPlannerView, isPlannerDate, isPlannerShow,
  DEFAULT_PLANNER_VIEW, NO_PLANNER_FILTERS, APPOINTMENT_TYPE_LABEL, APPOINTMENT_STATUS_LABEL,
  type PlannerFilters,
} from "@/lib/practice/planner-constants";
import { ACTIVITY_TYPES } from "@/lib/practice/activity-constants";
import { listFollowUps } from "@/lib/practice/follow-ups";
import { loadDay } from "@/lib/practice/scheduling";
import { calendarDay, SLOT_KINDS } from "@/lib/practice/calendar";
import { bookingLocations, locationDay } from "@/lib/practice/hospital-booking";
import { timelineDay } from "@/lib/practice/timeline";
import { workspaceClock, zonedDayRange } from "@/lib/practice/practice-time";
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

/** Every parameter the planner reads. Named as a type so an unknown one is a compile error, not a bug. */
type PlannerParams = {
  view?: string; date?: string; from?: string; to?: string; sel?: string;
  show?: string; location?: string; activityType?: string; appointmentType?: string;
  status?: string; q?: string;
};

export default async function CalendarPage({ searchParams }: { searchParams: Promise<PlannerParams> }) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  // ⚠ REAL CAPABILITY CODES ONLY -- these two are seeded by migrations 191 and 192. A code invented here
  // would compile perfectly and lock every user out of this route, including the practice owner.
  if (!hasCapability(shell.ctx, "practice.calendar.view")) redirect("/practice/home");

  const params = await searchParams;
  const admin = createAdminClient();
  const canManage = hasCapability(shell.ctx, "appointment.manage");

  // ⚠ THE PRACTICE'S TODAY, BEFORE ANYTHING ELSE. "This week" and "Today" are computed from the
  // practice's own calendar day, not the server's: in Kampala they are different days for three hours
  // every morning, and those are the three hours somebody opens this screen to see what is on.
  const { today } = await workspaceClock(admin, shell.ctx.workspaceId);

  // ---- CP-PLAN-002 s3: WHICH DAYS ARE BEING LOOKED AT ----
  //
  // ⚠ plannerPeriod() IS THE SAME FUNCTION THE HEADER CALLS. The days read here and the days drawn
  // there come out of one import-free module, so the label over a grid can never describe a different
  // fortnight from the one underneath it.
  const view = isPlannerView(params.view) ? params.view : DEFAULT_PLANNER_VIEW;
  const anchor = isPlannerDate(params.date) ? params.date : today;
  const period = plannerPeriod(view, anchor, { from: params.from ?? null, to: params.to ?? null });

  // A failed read comes back as every day flagged unavailable, with the database's own words in
  // `detail` -- never as a confident empty period. The screen renders that state rather than smoothing
  // it over.
  const range = await plannerForPeriod(admin, shell.ctx, period);

  const selectedDate =
    isPlannerDate(params.date) && range.days.some(d => d.date === params.date) ? params.date
      : range.days.some(d => d.date === range.todayDate) ? range.todayDate
        : range.days[0].date;
  const selectedDay = range.days.find(d => d.date === selectedDate) ?? range.days[0];
  // A selection that is not on the day being shown is not a selection. Silently keeping it would leave
  // the contextual panel describing a session on a date nobody is looking at.
  const selectedSessionId = params.sel && selectedDay.sessions.some(s => s.id === params.sel)
    ? params.sel : null;

  // ---- s4: CONTENT CONTROLS. Validated against the real vocabularies, never trusted from the URL. ----
  const filters: PlannerFilters = {
    show: isPlannerShow(params.show) ? params.show : NO_PLANNER_FILTERS.show,
    locationId: params.location || null,
    activityType: (ACTIVITY_TYPES as readonly string[]).includes(params.activityType ?? "")
      ? params.activityType! : null,
    appointmentType: params.appointmentType && APPOINTMENT_TYPE_LABEL[params.appointmentType]
      ? params.appointmentType : null,
    status: params.status && APPOINTMENT_STATUS_LABEL[params.status] ? params.status : null,
    query: typeof params.q === "string" ? params.q : "",
  };

  const urlState = {
    view, date: selectedDate,
    from: view === "agenda" ? period.fromDate : null,
    to: view === "agenda" ? period.toDate : null,
    sel: selectedSessionId,
    show: filters.show, location: filters.locationId, activityType: filters.activityType,
    appointmentType: filters.appointmentType, status: filters.status, q: filters.query,
  };

  // ---- s4's SEARCH. The WHOLE diary, not the period on screen. See scheduleSearch's header. ----
  const searchResult = filters.query.trim().length > 0
    ? await scheduleSearch(admin, shell.ctx, filters.query)
    : null;
  // THREE ANSWERS AGAIN: not searched, searched and found nothing, could not search.
  const searchUnavailable = searchResult?.unavailable
    ? `Your schedule could not be searched just now, so this is NOT a statement that nothing matches. ${searchResult.detail ?? ""}`.trim()
    : null;

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
          range={range}
          period={period}
          selectedDate={selectedDate}
          selectedSessionId={selectedSessionId}
          filters={filters}
          urlState={urlState}
          canManage={canManage}
          locations={locations.map(l => ({ id: l.id, name: l.name, facility: l.facility?.name ?? null }))}
          followUps={followUps}
          followUpsUnavailable={followUpsUnavailable}
          // ⚠ PLAIN DATA ONLY ACROSS THIS BOUNDARY. A function on a payload handed to a client component
          // compiles, passes tsc and kills the page at render. Every field below is a string, a number,
          // a boolean or an array of those.
          search={searchResult && !searchResult.unavailable
            ? { query: searchResult.query, hits: searchResult.hits }
            : null}
          searchUnavailable={searchUnavailable}
          searchTruncated={searchResult?.truncated ?? false}
        />

        {/* ── THE APPOINTMENT BOOK. Still here, still doing everything it did. ─────────────────── */}
        <section id="appointment-book" className="rounded-2xl border border-gray-200 bg-white p-4">
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
