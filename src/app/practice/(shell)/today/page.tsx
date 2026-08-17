import { redirect } from "next/navigation";
import { primaryNav } from "@/lib/practice/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { dashboardReadModel } from "@/lib/practice/dashboard";
import { formatMinuteOfDay, formatDate } from "@/lib/datetime";
import { zonedDayRange } from "@/lib/practice/practice-time";
import { PATIENT_FLOW_ACTIVITY_TYPES } from "@/lib/practice/activity-constants";
import SessionControls from "./SessionControls";
import SessionTiles from "./SessionTiles";
import CurrentPatientCard from "./CurrentPatientCard";
import QueueWithActions from "./QueueWithActions";
import ExpectedCheckIn from "./ExpectedCheckIn";
import LiveRefresh from "../LiveRefresh";
import OfflineCacheWriter from "../OfflineCacheWriter";
import { offlineCacheGate } from "@/lib/practice/offline-gate";
import { BILLING_CAPTURE_CAPABILITIES } from "@/lib/practice/billing-constants";

// /practice/today -- CPR-CUR-001 "Current Session", the operational cockpit for work happening NOW.
// (Supersedes CPR-V5-004's arrangement of this screen; the lifecycle and engines it built remain.)
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// COMMAND CENTRE = TODAY. CURRENT SESSION = NOW. PLANNER = FUTURE. (CPR-CUR-001 s2)
//
// IT ASSEMBLES NOTHING. Every figure arrives from `dashboardReadModel` -- the same payload
// /api/v1/practice/dashboard serves and the same one the command centre renders -- so the two screens
// cannot disagree about how many people are waiting. CORE-001 s16: "no widget independently calculates a
// conflicting version of a shared metric." This page's whole job is choosing which of those figures the
// session cockpit shows, and in what order. CPR-CUR-001 s20 restates the same rule.
//
// THE s6 HIERARCHY: compact header and progress strip on top; Current Patient then the queue in the
// main column (about two thirds); Immediate Attention and Session Actions in the right rail (about one
// third). No analytics, no historical trends, no planner calendar, no full patient summary -- each of
// those has a canonical home and s6 names this workspace as not it.
//
// ⚠ EVERY NUMBER IS A PAIR OR A COUNT, NEVER A PERCENTAGE. The comp prints "75% Session progress".
// The cards below cannot render it: their props take `value` and `of` separately, `unit` admits only
// "count" | "minutes", and no `goal` prop exists. 6 of 8 tells a practitioner both how the session is
// going AND how much session there is; 75% hides the denominator, which is the actionable half.
//
// ⚠ TWO FIGURES FROM EARLIER COMPS STAY ABSENT ON PURPOSE. Utilisation has no denominator anywhere --
// nothing links an activity to a slot capacity -- and on-time has no metric and no stored lateness
// tolerance. Inventing the tolerance would be authoring the very standard the figure claims to measure
// against. CPR-CUR-001 provides no storage design for either, so both remain out.
//
// ⚠ s11 IS NOT A SECOND TODAY'S BRIEF. The brief's sentences left this page with CPR-CUR-001: the
// Command Centre owns day-level orientation, and the Immediate Attention rail below carries only
// deterministic exceptions about THIS session, computed in session.ts.
//
// BELOW md (CPR-MOB-001 s7, 2026-08-17) the same payload becomes a FOCUSED LIVE-SESSION COCKPIT: a
// compact sticky header (SessionControls' second face), a one-line progress strip, then the same
// current patient, queue, expected strip, attention and actions the desktop grid ALREADY stacks in
// this exact order below lg, and the timeline collapsed behind a disclosure. Desktop edits are
// max-md:*/md:hidden no-ops; at md and up nothing about this page changed. The full mobile doctrine
// sits with the mobile consts, just before the return.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

/** hh:mm in the practice's own zone. The session clock is the practitioner's, never the server's. */
const clock = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });

const railCard = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

export default async function CurrentSessionPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "practice.home.view")) redirect("/practice/home");

  const admin = createAdminClient();
  // ⚠ THE OFFLINE GATE IS RESOLVED ON THE SERVER, BESIDE THE DASHBOARD, AND HANDED DOWN AS PLAIN JSON.
  // CP-OFFLINE-SURVEY-001 s3.7: "the flag resolved server-side and passed into the client component as a
  // prop -- do not build a client evaluator." In parallel because it is a gate on a by-product; a screen
  // that waited for it serially would pay for a feature nobody is looking at.
  const [dash, offline] = await Promise.all([
    dashboardReadModel(admin, shell.ctx),
    offlineCacheGate(admin, shell.ctx, shell.ctx.userId),
  ]);
  const { plan, session, queue, timeline, flow, attention, metrics } = dash;
  const canControl = hasCapability(shell.ctx, "appointment.manage");
  // The practice day's start, for telling a carried-over arrival stamp from today's truth (#4b).
  const dayStartMs = Date.parse(zonedDayRange(plan.date, dash.timezone).startIso);

  // The lifecycle state, derived from the two timestamps and the pause ledger -- never stored.
  const state: "NOT_STARTED" | "RUNNING" | "PAUSED" =
    !session ? "NOT_STARTED" : session.isPaused ? "PAUSED" : "RUNNING";

  // CPR-CUR-001 s3/s15: patient-flow zones render ONLY for activity types that involve patients.
  // A non-clinical session keeps the same shell and fabricates nothing.
  const clinical = session ? PATIENT_FLOW_ACTIVITY_TYPES.has(session.activity.activityType) : false;

  const m = metrics?.metrics;
  /** A metric becomes a tile. `of` stays null unless the pair is genuinely known. */
  const tile = (key: keyof NonNullable<typeof m>, label: string, href: string | null) => {
    const x = m?.[key];
    return {
      key: String(key), label, href,
      value: x?.value ?? null,
      of: null as number | null,
      unit: (x?.unit ?? "count") as "count" | "minutes",
      reason: x?.reason ?? (m ? null : "Today's figures could not be read."),
      observations: x?.observations ?? null,
      basis: x?.formula ?? null,
    };
  };
  const flowReason = flow.unavailable ? "The patient flow could not be read just now." : null;

  // The dominant card shows the patient you are WITH, or failing that the first person waiting.
  const person = flow.current ?? flow.next;
  const flowPerson = person ? {
    role: (flow.current ? "current" : "next") as "current" | "next",
    name: person.name,
    patientId: person.patientId,
    queueEntryId: person.queueEntryId,
    patientNumber: person.patientNumber,
    birthDate: person.birthDate,
    ageEstimateYears: person.ageEstimateYears,
    sex: person.sex,
    queueStatus: person.queueStatus,
    waitingMinutes: person.waitingMinutes,
    arrivedTimeLabel: person.arrivedAtIso ? clock(person.arrivedAtIso, dash.timezone) : null,
    bookedTimeLabel: person.bookedAtIso ? clock(person.bookedAtIso, dash.timezone) : null,
    appointmentType: person.appointmentType,
    appointmentReason: person.appointmentReason,
    encounterId: person.encounterId,
    encounterStatus: person.encounterStatus,
  } : null;

  // Zone F, capability-filtered: a link is offered only to somebody its destination will not bounce.
  const actions = [
    hasCapability(shell.ctx, "patient.list") ? {
      href: "/practice/patients", label: "Add walk-in / find patient",
      note: "Search the register first; attach, never duplicate (s9).",
    } : null,
    canControl ? {
      href: "/practice/calendar", label: "Open the appointment book",
      note: "Expected patients check in right here, one click. The full day's book lives in the Planner.",
    } : null,
    hasCapability(shell.ctx, "task.view") ? {
      href: "/practice/tasks", label: "Create or check a task",
      note: "Tasks stay contextual here -- Current Session has no Tasks submenu (s12).",
    } : null,
  ].filter((a): a is NonNullable<typeof a> => a !== null);

  // ══ CPR-MOB-001 s7: BELOW md, CURRENT SESSION IS A FOCUSED LIVE-SESSION COCKPIT ═════════════════
  //
  // The s7 zones map onto what this page ALREADY renders, in the order it already renders it:
  // the sticky compact header is SessionControls' second face (row 1); the strip below is row 2;
  // Current Patient, the queue cards, the expected strip, Immediate Attention and Session Actions
  // are the desktop grid's own children, which stack in exactly that DOM order below lg with no CSS
  // order utilities anywhere (s17: DOM order = visual order = focus order, kept by construction);
  // and the timeline is the same body behind a disclosure, collapsed by default (row 6). Every
  // figure is the one server payload read once above -- a second presentation, never a second fetch
  // or a second source of truth (s19).
  //
  // ⚠ s7's "remaining" HAS NO PRODUCER. No engine computes a remaining-patients figure, and deriving
  // booked − completed − no-show − cancelled here would be page-side arithmetic -- the exact thing
  // CORE-08/s16 exist to forbid (the page assembles nothing). The strip carries the completed PAIR
  // ("4 of 9"), which says the same thing without a second implementation; walk-ins and emergency
  // render only when non-zero, exactly as their desktop tiles do, because a red nought every morning
  // teaches the eye to skip the tile that will one day matter.
  const stripFigures = [
    // s7 says "seen"; the figure is metrics.ts's completed -- same producer as the desktop tile,
    // paired with booked so the denominator travels with it. Never a percentage.
    { ...tile("completed", "Seen", null), of: m?.booked.value ?? null },
    tile("waiting", "Waiting", null),
    {
      key: "in_progress", label: "In progress", href: null as string | null,
      value: flow.inProgress, of: null as number | null, unit: "count" as const,
      reason: flow.inProgress === null ? (flowReason ?? "Could not be read just now.") : null,
      observations: null, basis: null,
    },
    // s7's "remaining", from its own producer at last (metrics.ts remainingPatients, owner-requested
    // 2026-08-17): still waiting plus booked-not-yet-arrived, composed in the ENGINE -- the figure
    // this strip shipped without rather than doing page-side arithmetic. In-consultation people are
    // deliberately outside it; In progress stands beside it.
    tile("remaining", "Remaining", null),
    ...(m?.walk_in.value ? [tile("walk_in", "Walk-ins", null)] : []),
    ...(m?.emergency.value ? [tile("emergency", "Emergency", null)] : []),
  ];
  const mobileProgress = (
    <section aria-label="Session progress" className="mt-4 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] md:hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {/* THE WINDOW IS ON THE STRIP, same as the desktop card: the same figures mean different
            things either side of the session-start line. */}
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
          {dash.scope.kind === "session" ? "This session" : "Today"}
        </span>
        {stripFigures.map(f => (
          <span key={f.key} className="flex items-baseline gap-1">
            <span className={`text-[15px] font-bold leading-none tabular-nums ${
              f.value === null ? "text-gray-300"
                : f.key === "emergency" ? "text-[var(--cmp-text-danger)]" : "text-gray-900"}`}>
              {/* A NULL COUNT RENDERS AN EM DASH, never a nought -- the reason renders below, in
                  visible words, because hover does not exist on this face (s4). */}
              {f.value === null ? "—" : f.value}
              {f.value !== null && f.of !== null && (
                <span className="text-[10.5px] font-semibold text-gray-500"> of {f.of}</span>
              )}
            </span>
            <span className={`text-[10.5px] ${
              f.key === "emergency" ? "font-semibold text-[var(--cmp-text-danger)]" : "text-gray-600"}`}>
              {f.label}
            </span>
          </span>
        ))}
      </div>
      {stripFigures.some(f => f.value === null) && (
        <p className="mt-1 text-[9.5px] leading-snug text-gray-500">
          — {Array.from(new Set(stripFigures.filter(f => f.value === null)
            .map(f => f.reason ?? "No figure available."))).join(" ")}
        </p>
      )}
    </section>
  );

  // The timeline body, hoisted so the desktop section and the mobile disclosure render the SAME
  // three-state JSX -- unavailable, quiet and populated stay one implementation, and the two faces
  // cannot drift apart about what the day looked like.
  const timelineBody = timeline.unavailable ? (
    <p className="text-[12px] text-gray-500">The day could not be read just now.</p>
  ) : timeline.events.length === 0 ? (
    <p className="text-[12px] text-gray-500">Nothing has happened yet today.</p>
  ) : (
    <ol className="space-y-0.5">
      {timeline.events.map(e => (
        <li key={e.id} className="flex items-center gap-2.5">
          <span className="w-10 shrink-0 text-[11px] tabular-nums text-gray-500">{e.timeLabel}</span>
          <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            e.interruption ? "bg-red-500" : "bg-emerald-500"}`} />
          <span className={`min-w-0 flex-1 truncate text-[12px] ${
            e.interruption ? "font-semibold text-red-700" : "text-gray-800"}`}>
            {e.label}{e.detail ? ` · ${e.detail}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="max-w-6xl">
      {/* ── ZONE A: THE SESSION HEADER AND ITS CONTROLS ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900">Current Session</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            {formatDate(plan.date)} · {dash.scope.kind === "session"
              ? "figures below count this session, not the whole day"
              : "nothing is running — day figures live on the Command Centre, not here (s5.2)"}
          </p>
        </div>
        <LiveRefresh asOf={dash.asOf} timezone={dash.timezone} />
      </div>

      {plan.unavailable && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          Today&rsquo;s plan could not be read just now. Nothing below is a claim that your day is empty —
          it is a claim that this page could not find out.
        </p>
      )}

      {/* ⚠ CPR-MOB-001 s7 row 1: SessionControls is mounted as a DIRECT CHILD of the page root, not
          inside the old mt-4 wrapper, because below md it leads with a position:sticky compact
          header and a sticky element is fenced inside its parent -- wrapped, it could stick only for
          the height of the header card itself. The mt-4 wrapper moved INTO SessionControls around
          the desktop card, byte-for-byte, so at md and up the rendered layout is unchanged. */}
      {session ? (
          <SessionControls
            activityId={session.activity.id}
            header={{
              title: session.activity.title,
              activityLabel: session.activity.label,
              facilityName: session.activity.facilityName,
              room: session.activity.room,
              state,
              startedAtLabel: clock(session.startedAtIso, dash.timezone),
              plannedWindowLabel:
                `${formatMinuteOfDay(session.activity.plannedStartMinute)} – ${formatMinuteOfDay(session.activity.plannedEndMinute)}`,
              elapsedMinutes: session.minutesElapsed,
              // ⚠ THE ELAPSED FIGURE IS ONLY TRUSTWORTHY IF THE PAUSE LEDGER WAS READ. When it was not,
              // `pausedMinutes` is null and this clock has NOT had interruptions taken out of it -- so
              // the header says so rather than showing a number it cannot stand behind.
              elapsedReason: session.pausedMinutes === null
                ? "The pause ledger could not be read, so this is the raw clock and may overstate the session."
                : null,
              pausedMinutes: session.pausedMinutes,
              pausedReason: session.pausedMinutes === null ? "Could not be read." : null,
              pauseCount: null,
              overrunMinutes: session.activity.overrunMinutes,
              canControl,
            }}
            // CPR-CUR-001 s13.2's pre-finish check, from the same engines the rest of the screen reads.
            // Null for non-clinical sessions: there is no patient flow to leave unresolved (s15).
            unresolved={clinical ? {
              waiting: m?.waiting.value ?? null,
              openEncounters: flow.openEncounters ? flow.openEncounters.length : null,
              unregisteredArrivals: flow.unregisteredArrivals,
              expected: flow.expected,
            } : null}
          />
      ) : (
        /* ── CPR-HFE-001 v1.1 s5.2 and CPR-CUR-001 s5.1: THE NO-ACTIVE-SESSION STATE. No zero
              grids, no day-scoped figures wearing session clothes -- a simple statement, the next
              planned activity where one exists, and the two routes onward. Everything
              session-scoped below renders ONLY when a session exists, because "it must not contain
              a large operational dashboard with zero values" (CUR-001 s5.1). CPR-MOB-001 s7 asks
              for exactly this below md too -- a minimal empty state and the next planned activity,
              never a zero-value session dashboard -- so the same card serves both breakpoints; the
              two routes onward grow to thumb size below md and nothing else changes. ──────────── */
        <div className="mt-4">
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="text-[13px] font-bold text-gray-900">No active session</h2>
            <p className="mt-1 text-[12.5px] text-gray-600">
              Nothing is running right now. This page becomes your cockpit the moment you start an
              activity.
            </p>
            {(() => {
              // ⚠ THIS PREDICATE USED TO READ `startedAtIso`/`endedAtIso` -- fields PlannedActivity has
              // NEVER carried (they are startedAt/endedAt), behind an `(a: any)` that hid it. Both reads
              // were always undefined, the predicate was always TRUE, and this card named the day's
              // FIRST activity as "next planned" even when it was already running or finished. The
              // IntelSlice phantom-field class again, found 2026-08-16 by removing the `any` for the CI
              // lint gate. `state` is the engine's own derivation of exactly this question.
              const next = plan.activities.find(a => a.state === "planned") ?? null;
              return next ? (
                <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Next planned</p>
                  <p className="mt-0.5 text-[13px] font-semibold text-gray-900">{next.title ?? next.label}</p>
                  <p className="text-[11px] text-gray-500">
                    {formatMinuteOfDay(next.plannedStartMinute)} – {formatMinuteOfDay(next.plannedEndMinute)}
                    {next.facilityName ? ` · ${next.facilityName}` : ""}
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600">
                  Nothing further is planned for today.
                </p>
              );
            })()}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/practice/home"
                className="rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:opacity-90 max-md:flex max-md:min-h-[var(--cp-touch-primary)] max-md:flex-1 max-md:items-center max-md:justify-center">
                Start from the Command Centre →
              </Link>
              <Link href="/practice/calendar"
                className="rounded-lg border border-gray-200 px-3.5 py-2 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 max-md:flex max-md:min-h-[var(--cp-touch)] max-md:flex-1 max-md:items-center max-md:justify-center">
                Open Planner
              </Link>
            </div>
          </section>
        </div>
      )}


      {/* s5: everything below is the RUNNING session's cockpit, and renders only when one exists. */}
      {session && (<>
      {clinical ? (<>
      {/* ── ZONE B: THE PROGRESS STRIP ────────────────────────────────────────────────────────────
          s5.2's list, verbatim: booked, arrived, waiting, in progress, completed, and no-show or
          cancelled "where relevant" -- rendered only when non-zero, because a red nought every morning
          teaches the eye to skip the tile that will one day matter. Arrived and In progress belong to
          the flow projection (session.ts); the rest are s8 metrics. One owner each, per s16/s20.
          max-md:hidden: the seven-tile grid is the desktop face of this zone; below md the s7 row 2
          STRIP right after this wrapper renders the same producers' figures in one concise line. */}
      <div className="mt-4 max-md:hidden">
        <SessionTiles
          scopeLabel={dash.scope.kind === "session" ? "This session" : "Today"}
          unavailableReason={dash.feeders.glance === "unavailable" && flow.unavailable
            ? "Today's figures could not be read just now, so no number is shown rather than a nought." : null}
          tiles={[
            tile("booked", "Booked", "/practice/calendar"),
            {
              key: "arrived", label: "Arrived", href: "/practice/calendar",
              value: flow.arrived, of: null, unit: "count" as const,
              reason: flow.arrived === null ? (flowReason ?? "Could not be read just now.") : null,
              observations: null,
              basis: "Queue entries recorded today. An entry exists only when somebody actually presented.",
            },
            tile("waiting", "Waiting", "/practice/calendar"),
            {
              key: "in_progress", label: "In progress", href: "/practice/encounters",
              value: flow.inProgress, of: null, unit: "count" as const,
              reason: flow.inProgress === null ? (flowReason ?? "Could not be read just now.") : null,
              observations: null,
              basis: "Encounters open right now (active or paused). A launched-but-unstarted draft is not a patient being seen.",
            },
            // Completed is a PAIR -- six of eight, never "75%". The denominator is what makes it mean
            // anything, and it is the comp's "Session progress" figure rendered honestly.
            { ...tile("completed", "Completed", "/practice/encounters"), of: m?.booked.value ?? null },
            ...(m?.no_show.value ? [tile("no_show", "No-show", "/practice/calendar")] : []),
            ...(m?.cancelled.value ? [tile("cancelled", "Cancelled", "/practice/calendar")] : []),
          ]}
        />
      </div>
      {/* s7 row 2, below md only -- the single concise strip, from the same engines. */}
      {mobileProgress}

      {/* ── THE s6 GRID: current patient + queue dominate; attention + actions in the rail ──────── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* ZONE C: the dominant card. Who decided who is current lives in session.ts. */}
          <CurrentPatientCard
            person={flowPerson}
            canStartEncounter={hasCapability(shell.ctx, "encounter.create")}
            canAttach={hasCapability(shell.ctx, "queue.manage")}
            unavailableReason={flowReason}
          />

          {/* ZONE D. CPR-ADOPT-001 s2's client wrapper supplies the handlers a server component
              cannot -- and now also the Start-encounter handoff (CUR-001 s8). */}
          <QueueWithActions
            href="/practice/calendar"
            unavailableReason={queue.unavailable ? "The queue could not be read just now." : null}
            truncatedNotice={queue.capped
              ? `Showing the first ${queue.groups.reduce((n, g) => n + g.entries.length, 0)} of ${queue.total} waiting.`
                + " The tab counts below are of what is shown here. This is not the whole queue."
              : null}
            canCapture={hasCapability(shell.ctx, "encounter.edit")}
            canStartEncounter={hasCapability(shell.ctx, "encounter.create")}
            canCheckIn={hasCapability(shell.ctx, "queue.manage")}
            people={queue.groups.flatMap(g => g.entries.map(e => ({
              id: e.id,
              name: e.name,
              group: g.key as "booked" | "walk_ins" | "emergency",
              status: e.status,
              waitingMinutes: e.waitingMinutes,
              waitingReason: null,
              // The PRACTICE's clock, not UTC slices -- "b. 15:36" under a card saying "Booked 18:36"
              // was the same instant rendered in two clocks (walkthrough 2026-08-16).
              timeLabel: clock(e.enteredAtIso, dash.timezone),
              bookedTimeLabel: e.bookedAtIso ? clock(e.bookedAtIso, dash.timezone) : null,
              href: null,
              patientId: e.patientId,
              staleArrival: Date.parse(e.enteredAtIso) < dayStartMs,
            })))}
          />

          {/* s7's EXPECTED state. Still never queue rows -- an expected person is not in the corridor.
              But walkthrough 2026-08-16 request #4 moved their ONE action (check in) into the cockpit:
              a reader with appointment.manage gets the strip with inline check-in, server-stamped by
              the arrive transition; anybody else keeps the honest sentence and the Planner pointer. */}
          {canControl && flow.expectedList !== null && flow.expectedList.length > 0 ? (
            <ExpectedCheckIn
              total={flow.expectedListTotal}
              people={flow.expectedList.map(a => ({
                appointmentId: a.appointmentId,
                name: a.name,
                timeLabel: clock(a.scheduledAtIso, dash.timezone),
                status: a.status,
              }))}
            />
          ) : flow.expected !== null && flow.expected > 0 ? (
            <p className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2 text-[12px] text-gray-600">
              {flow.expected === 1 ? "1 booked patient has" : `${flow.expected} booked patients have`}{" "}
              not arrived yet.{" "}
              <Link href="/practice/calendar" className="font-semibold text-[var(--cp-primary)] hover:underline max-md:inline-flex max-md:min-h-[var(--cp-touch)] max-md:items-center">
                Mark arrivals in the Planner →
              </Link>
            </p>
          ) : null}
        </div>

        <div className="space-y-4">
          {/* ── ZONE E: IMMEDIATE ATTENTION (s11) ──────────────────────────────────────────────────
              Deliberately small, deterministic, session-scoped. The rules live in session.ts beside
              the projection they read; two of s11's five are absent for recorded gate failures --
              no stored wait threshold, and sync state is device-local (the offline status line below
              is its honest surface). */}
          <section className={railCard} aria-labelledby="attention-h">
            <h2 id="attention-h" className="text-[13px] font-bold text-gray-900">Immediate attention</h2>
            {attention.length === 0 ? (
              <p className="mt-1 text-[12px] text-gray-500">
                {dash.feeders.flow === "unavailable"
                  ? "The flow behind this panel could not be fully read, so this is not a claim that nothing needs attention."
                  : "Nothing in this session needs intervention right now."}
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {attention.map(a => (
                  <li key={a.key}>
                    <Link href={a.href} className={`block rounded-lg px-2.5 py-1.5 text-[12px] leading-snug hover:opacity-90 max-md:flex max-md:min-h-[var(--cp-touch)] max-md:items-center ${
                      a.tone === "danger" ? "bg-[var(--cmp-surface-danger)] text-[var(--cmp-text-danger)]"
                        : a.tone === "warning" ? "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"
                        : "bg-gray-50 text-gray-700"}`}>
                      {/* s19: status never by colour alone -- the sentence carries the whole claim. */}
                      {a.text}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── ZONE F: SESSION ACTIONS ─────────────────────────────────────────────────────────────
              Pointers to the canonical home of each act -- walk-ins are attached through the Patients
              register's established flow (s9), check-in stays in the Planner, tasks stay contextual
              (s12). Pause/Resume/Finish live in the header above and are not duplicated here (s25:
              duplication between workspaces is a defect, and within one screen no less so). */}
          <section className={railCard} aria-labelledby="actions-h">
            <h2 id="actions-h" className="text-[13px] font-bold text-gray-900">Session actions</h2>
            {actions.length === 0 ? (
              <p className="mt-1 text-[12px] text-gray-500">
                No session actions are available to you here — each needs a permission you do not hold.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {actions.map(a => (
                  <li key={a.href}>
                    <Link href={a.href}
                      className="block rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-1.5 hover:bg-gray-50 max-md:py-2.5">
                      <span className="block text-[12.5px] font-semibold text-gray-800">{a.label} →</span>
                      <span className="block text-[10.5px] text-gray-500">{a.note}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[10.5px] text-gray-400">
              Pause, resume and finish are in the session header above.
            </p>
          </section>
        </div>
      </div>

      {/* ── TODAY'S TIMELINE ──────────────────────────────────────────────────────────────────── */}
      <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 max-md:hidden" aria-labelledby="tl-h">
        <div className="mb-2 flex items-center gap-2">
          <h2 id="tl-h" className="text-[13px] font-bold text-gray-900">Today&rsquo;s timeline</h2>
          {/* PARTIAL IS ITS OWN STATE. One source failing while others succeed is a real but incomplete
              day, and a card that said nothing would claim a quiet morning it never checked. */}
          {timeline.partial && !timeline.unavailable && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
              Incomplete
            </span>
          )}
        </div>
        {timelineBody}
      </section>

      {/* ── s7 row 6, below md: the SAME timeline body, collapsed by default and opened on demand.
             A details element rather than a script: the disclosure is a visible control, not a
             gesture (s17), and it costs nothing the phone did not already download. The summary
             makes NO claim when the day could not be read -- the count renders only from a
             successful read, and the honest sentence waits inside. ─────────────────────────────── */}
      <details className="mt-4 rounded-2xl border border-gray-200 bg-white px-4 py-2 md:hidden">
        <summary className="flex min-h-[var(--cp-touch)] cursor-pointer list-none items-center gap-2 text-[13px] font-bold text-gray-900">
          <span aria-hidden className="text-gray-400">›</span>
          Today&rsquo;s timeline
          {!timeline.unavailable && (
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">
              {timeline.events.length}
            </span>
          )}
          {timeline.partial && !timeline.unavailable && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
              Incomplete
            </span>
          )}
        </summary>
        <div className="pb-2 pt-1">{timelineBody}</div>
      </details>
      </>) : (
        /* ── CPR-CUR-001 s15: THE NON-CLINICAL SESSION SHELL ──────────────────────────────────────
            Administration, Teaching, Meeting, Research, Leave, Travel and Custom Activity get the
            header (with its clock and Pause/Resume/Finish) and pointers -- and NO patient queue, no
            Current Patient, no encounter controls and no patient metrics. Rendering a zeroed queue
            for a meeting would be fabricating a clinic that does not exist. */
        <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-4" aria-labelledby="nc-h">
          <h2 id="nc-h" className="text-[13px] font-bold text-gray-900">Non-clinical activity</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600">
            {session.activity.label} time has no patient flow, so there is no queue, no current patient
            and no patient figures here — that is the design, not a fault. The header above carries the
            clock and the controls; finishing records this activity in the day&rsquo;s history.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {hasCapability(shell.ctx, "task.view") && (
              <Link href="/practice/tasks"
                className="rounded-lg border border-gray-200 px-3.5 py-2 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 max-md:inline-flex max-md:min-h-[var(--cp-touch)] max-md:flex-1 max-md:items-center max-md:justify-center">
                Tasks
              </Link>
            )}
            <Link href="/practice/calendar"
              className="rounded-lg border border-gray-200 px-3.5 py-2 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 max-md:inline-flex max-md:min-h-[var(--cp-touch)] max-md:flex-1 max-md:items-center max-md:justify-center">
              Open Planner
            </Link>
          </div>
        </section>
      )}
      </>)}
      {/* s5.3: the "How this session ran" performance summary left the LIVE state -- its
          figures belong to Session Complete and the governed reports, where the session is
          finished enough to be summarised. CPR-CUR-001 s14 confirms: the summary is closure,
          rendered after Finish, not analytics rendered during. */}

      <p className="mt-4 text-[10.5px] text-gray-400">
        As of {clock(dash.asOf, dash.timezone)} · {dash.timezone}. Every figure above is the same one the
        command centre shows, read once and shared, so the two screens cannot disagree.
      </p>

      {/* The offline copy, written as a BY-PRODUCT of this successful render. Nothing above waits for it,
          and its one line of status says what is held and when it goes. */}
      <OfflineCacheWriter
        workspaceId={shell.ctx.workspaceId}
        userId={shell.ctx.userId}
        gate={{ state: offline.state, reason: offline.reason, purge: offline.purge }}
        nav={primaryNav(shell.ctx.capabilities).map(i => ({ href: i.href, label: i.label, icon: i.icon }))}
        billingCaptureAllowed={BILLING_CAPTURE_CAPABILITIES.every(c => shell.ctx.capabilities.includes(c))}
        showStatus
      />
    </div>
  );
}
