"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import type { TodaysPlan } from "@/lib/practice/activity";
// From the CONSTANTS module, never from the engine: activity.ts reaches metrics.ts -> access.ts ->
// next/headers, and importing it here put server-only code in the browser bundle and failed the build.
import {
  ACTIVITY_LABEL, ACTIVITY_TYPES, PRIMARY_ACTIVITY_TYPES, SECONDARY_ACTIVITY_TYPES, type ActivityType,
} from "@/lib/practice/activity-constants";
import type { SessionWithFigures } from "@/lib/practice/session";
import { formatMinuteOfDay } from "@/lib/datetime";

// CPR-V5-001 Zone 1: START YOUR DAY / CURRENT ACTIVITY.
//
// ⚠ THIS CARD IS THE WHOLE POINT OF V5-001. "Once the practitioner taps Start Outpatient Clinic, Begin
// Ward Round or Emergency Consult, the entire workspace should reconfigure automatically." Everything
// else on this dashboard reads from the session this card starts, so it is the only control on the page
// that changes what the other twelve cards mean.
//
// THREE STATES, AND THE MIDDLE ONE IS THE ONE THAT MATTERED:
//   running   the comp's card -- what, where, since when, how it is going, End / View Session
//   planned   the day HAS activities but none is running: one button per planned activity
//   empty     nothing planned: pick a type and start it now, which is "start the day in ONE CLICK"
//             (s10) rather than "go to setup, plan a session, come back and start it"
//
// The empty state is why this posts a plan-and-start pair rather than only a start. A dashboard that can
// only start what somebody planned yesterday cannot open a clinic on a morning nobody planned -- and an
// emergency consult is never planned.
//
// CPR-MOB-001 s6 (2026-08-17): below md this card plays TWO roles in the mobile story. The running
// state is row 1's current-session card, whose one mobile action is Open Session; the idle state is
// row 3's What's Next -- one next activity, one Start. Same component, same payload, same posts; only
// the hierarchy changes by breakpoint, which is s19's single-component-model rule. At md and up every
// mobile element is hidden and the desktop render is untouched.

export default function StartYourDay({ plan, metrics, canPlan }: {
  plan: TodaysPlan;
  metrics: SessionWithFigures | null;
  canPlan: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // MCC-02: the More activities sheet. Closed on every render of a fresh page, so a practitioner who
  // opened it yesterday does not find it open today.
  const [moreOpen, setMoreOpen] = useState(false);

  const post = async (body: Record<string, unknown>, tag: string) => {
    setBusy(tag); setError(null);
    try {
      const r = await fetch("/api/v1/practice/current-activity", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? "That did not work."); return false; }
      // HFE-001 v1.1 s6: ending routes to the Session Complete state; everything else re-renders here.
      if (body.action === "end" && body.id) {
        router.push(`/practice/today/complete?activity=${body.id}`);
        return true;
      }
      router.refresh();
      return true;
    } catch {
      setError("That did not reach the server.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  // Plan it and start it in the same gesture. Two requests rather than one because the engine keeps
  // planning and starting separate -- and it should: they are different permissions and different refusals.
  const startNow = async (type: ActivityType) => {
    setBusy(type); setError(null);
    try {
      const r = await fetch("/api/v1/practice/current-activity", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "plan", activityType: type, title: ACTIVITY_LABEL[type], planDate: plan.date,
          // The session runs from NOW to the end of the working day rather than a guessed length. A
          // two-hour default would put "1h 36m remaining" on a clinic nobody said would take two hours.
          plannedStartMinute: nowMinute(), plannedEndMinute: Math.max(nowMinute() + 30, 17 * 60),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? "That did not work."); setBusy(null); return; }
      await post({ action: "start", id: j.id }, type);
    } catch {
      setError("That did not reach the server."); setBusy(null);
    }
  };

  // ── RUNNING ────────────────────────────────────────────────────────────────────────────────────
  if (metrics) {
    const a = metrics.activity;
    const row = (label: string, value: string | null) => (
      <div className="flex items-baseline justify-between gap-3 border-t border-[var(--cp-primary-border)]/60 py-1.5">
        <span className="text-[12px] text-gray-600">{label}</span>
        <span className="text-[12.5px] font-bold tabular-nums text-gray-900">{value ?? "—"}</span>
      </div>
    );
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-4" aria-labelledby="zone1">
        {/* Hidden below md: the tinted card announces itself ("Current Activity" + ACTIVE), and the
            desktop zone chrome would only push it further down a phone screen. */}
        <div className="flex items-center gap-2 max-md:hidden">
          <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cp-primary)] text-[10px] font-bold text-white">1</span>
          <h2 id="zone1" className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">Start your day</h2>
        </div>

        <div className="mt-3 rounded-xl bg-[var(--cp-primary-soft)] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-gray-600">Current Activity</span>
            <span className="rounded-full bg-[var(--cmp-surface-success)] px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[var(--cmp-text-success)]">
              Active
            </span>
          </div>
          <p className="mt-1.5 text-[17px] font-bold leading-tight text-gray-900">{a.title}</p>
          <p className="mt-0.5 text-[12px] text-gray-600">
            {[a.label, a.facilityName, a.room].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-1 text-[12.5px] font-semibold tabular-nums text-[var(--cp-primary-deep)]">
            {formatMinuteOfDay(a.plannedStartMinute)} – {formatMinuteOfDay(a.plannedEndMinute)}
          </p>

          <div className="mt-2.5">
            {row("Session started", new Date(metrics.startedAtIso).toISOString().slice(11, 16))}
            {row("Time remaining", metrics.minutesRemaining === null
              ? "Past its planned end"
              : `${Math.floor(metrics.minutesRemaining / 60)}h ${metrics.minutesRemaining % 60}m`)}
            {/* NULL RENDERS AS AN EM DASH, NOT A ZERO. No completed encounter means no average and no
                estimate; "0 remaining" and "not yet knowable" are opposite claims. */}
            {row("Patients remaining (est.)", metrics.patientsRemaining === null ? null : String(metrics.patientsRemaining))}
            {row("Average time per patient", metrics.averageMinutesPerPatient === null
              ? null : `${metrics.averageMinutesPerPatient} min`)}
          </div>

          <div className="mt-3 hidden gap-2 md:flex">
            <button type="button" disabled={!canPlan || busy !== null}
              onClick={() => post({ action: "end", id: a.id }, "end")}
              className="flex-1 rounded-lg border border-[var(--cp-primary-border)] bg-white px-3 py-2 text-[12.5px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50">
              {busy === "end" ? "Ending…" : "End Session"}
            </button>
            {/* ⚠ SAYS SESSION, GOES TO THE SESSION. This primary said "View Session" and opened the
                Planner -- a wrong door on the page's one running-state action (caught during the
                MOB 3a review, 2026-08-17). The cockpit is the session's canonical home. */}
            <Link href="/practice/today"
              className="flex-1 rounded-lg bg-[var(--cp-primary)] px-3 py-2 text-center text-[12.5px] font-semibold text-white hover:opacity-90">
              View Session
            </Link>
          </div>
          {/* CPR-MOB-001 s6 row 1: the card's ONE mobile action is Open Session, into the cockpit --
              where the queue, the controls and End all live. End is deliberately not a one-tap control
              on a phone dashboard (s4 caps a viewport at one dominant action, and a mis-tap here would
              close a live clinic); it waits one screen away, behind a confirm, in Current Session. */}
          {/* CPR-CC-MOB-001 s9: the primary CTA is "Resume Session" when one is active. It read "Open
              Session", which is the right door and the wrong verb: opening is what you do to a thing
              you have not started, and this session is running with patients in it. Resume says there
              is something already underway to go back to, which is the fact that makes this the
              dominant action on the screen. */}
          <Link href="/practice/today"
            className="mt-3 flex min-h-[var(--cp-touch-primary)] w-full items-center justify-center rounded-xl bg-[var(--cp-primary)] px-4 text-[15px] font-semibold text-white hover:opacity-90 md:hidden">
            Resume Session
          </Link>
          {error && <p role="alert" className="mt-2 text-[12px] text-[var(--cmp-text-critical)]">{error}</p>}
        </div>
      </section>
    );
  }

  // ── NOTHING RUNNING ────────────────────────────────────────────────────────────────────────────
  const planned = plan.activities.filter(x => x.state === "planned");
  // s6 row 3's data, from the engine that already computed it: plan.next is "the next thing that has
  // not started, by planned start" (activity.ts). NOT re-derived from `planned` here -- a second
  // definition of "next" would be one sort away from disagreeing with the first.
  const next = plan.next;
  const morePlanned = next ? planned.filter(a => a.id !== next.id).length : 0;
  // The one-tap unplanned grid at thumb size (s4's 44px floor). Built once because it renders in two
  // mobile places: as the whole module when nothing is planned, behind a disclosure when something is.
  //
  // ── CPR-CC-MOB-001 MCC-02 / s8: FOUR, THEN THE REST ON REQUEST ─────────────────────────────────
  //
  // ⚠ THIRTEEN BUTTONS AT ONE WEIGHT MADE THE COMMON CASE PAY FOR THE RARE ONE. The block filled a
  // phone screen, and "Outpatient Clinic" cost the same to find as "Travel". The four primaries are
  // s8's, in s8's order, and NOTHING IS DELETED -- s16 forbids removing an activity type, so the other
  // nine are one control away rather than gone.
  //
  // The sheet reuses the dismissal idiom PlannerFilters already uses below md: a backdrop that closes
  // on tap, a bottom panel, Escape to dismiss. Reused rather than reinvented, so one product does not
  // grow two ways of getting out of a sheet.
  const activityButton = (t: ActivityType) => (
    <button key={t} type="button" disabled={busy !== null} onClick={() => startNow(t)}
      className="min-h-[var(--cp-touch)] rounded-lg border border-gray-200 px-2 text-[12.5px] font-semibold text-gray-700 hover:border-[var(--cp-primary-border)] hover:bg-[var(--cp-primary-soft)] hover:text-[var(--cp-primary-deep)] disabled:opacity-50">
      {busy === t ? "Starting…" : ACTIVITY_LABEL[t]}
    </button>
  );

  const typeGrid = (
    <>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {PRIMARY_ACTIVITY_TYPES.map(activityButton)}
      </div>
      {/* The count is on the control because "More" alone does not say whether it hides two things or
          twenty, and a practitioner deciding whether to open it deserves to know. */}
      <button type="button" onClick={() => setMoreOpen(true)} disabled={busy !== null}
        aria-expanded={moreOpen} aria-haspopup="dialog"
        className="mt-1.5 flex min-h-[var(--cp-touch)] w-full items-center justify-center rounded-lg border border-dashed border-gray-300 text-[12.5px] font-semibold text-gray-600 disabled:opacity-50">
        More activities ({SECONDARY_ACTIVITY_TYPES.length})
      </button>

      {moreOpen && (
        <>
          <button type="button" aria-label="Close the activity list" onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-black/40" />
          <div role="dialog" aria-modal="true" aria-label="More activities"
            onKeyDown={e => { if (e.key === "Escape") setMoreOpen(false); }}
            /* s9's safe area: the sheet sits on the bottom edge, where the browser chrome and the
               home indicator both live. Padding the inset means the last row is tappable rather than
               half under the navigation. */
            className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-bold text-gray-900">More activities</h3>
              <button type="button" onClick={() => setMoreOpen(false)}
                className="min-h-[var(--cp-touch)] px-2 text-[13px] font-semibold text-[var(--cp-primary-deep)]">
                Close
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {SECONDARY_ACTIVITY_TYPES.map(activityButton)}
            </div>
          </div>
        </>
      )}
    </>
  );
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4" aria-labelledby="zone1">
      <div className="flex items-center gap-2 max-md:hidden">
        <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cp-primary)] text-[10px] font-bold text-white">1</span>
        <h2 id="zone1" className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">Start your day</h2>
      </div>
      {/* The phone's heading for the same section: below md this card is the story's What's Next
          module (s6 row 3), and "Start your day" would be the wrong sentence over a card whose day
          may simply have a next clinic in it. */}
      <h2 className="text-[13px] font-bold text-gray-900 md:hidden">What&apos;s next</h2>

      {plan.unavailable ? (
        <p className="mt-3 text-[13px] text-gray-500">
          Your plan could not be read just now, so nothing here is a claim that your day is empty.
        </p>
      ) : (
        <>
          <p className="mt-2.5 text-[13px] text-gray-600 max-md:hidden">
            Nothing is running. Everything else on this page counts your whole day until you start
            something — then it counts the session.
          </p>

          {planned.length > 0 && (
            <div className="mt-3 space-y-1.5 max-md:hidden">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-gray-500">Planned for today</p>
              {planned.map(a => (
                <div key={a.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-gray-800">{a.title}</span>
                    <span className="block truncate text-[11px] text-gray-500">
                      {formatMinuteOfDay(a.plannedStartMinute)} · {[a.label, a.facilityName].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {canPlan && (
                    <button type="button" disabled={busy !== null} onClick={() => post({ action: "start", id: a.id }, a.id)}
                      className="shrink-0 rounded-lg bg-[var(--cp-primary)] px-2.5 py-1.5 text-[11.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
                      {busy === a.id ? "Starting…" : "Start"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {canPlan && (
            <div className="mt-3 border-t border-gray-100 pt-3 max-md:hidden">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-gray-500">
                {planned.length > 0 ? "Or start something unplanned" : "Start now"}
              </p>
              {/* ⚠ ALL THIRTEEN, ON PURPOSE, AND THIS BLOCK IS max-md:hidden. MCC-02 is a MOBILE defect:
                  thirteen equal buttons fill a phone and cost the common case as much as the rare one. On a
                  desktop the same thirteen are two short columns beside everything else, s10 permits the
                  wider arrangement, and hiding nine of them behind a sheet would add a click to a screen
                  that had no problem. The mobile grid above is where the four-plus-More rule applies. */}
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {ACTIVITY_TYPES.map(t => (
                  <button key={t} type="button" disabled={busy !== null} onClick={() => startNow(t)}
                    className="rounded-lg border border-gray-200 px-2 py-2 text-[11.5px] font-semibold text-gray-700 hover:border-[var(--cp-primary-border)] hover:bg-[var(--cp-primary-soft)] hover:text-[var(--cp-primary-deep)] disabled:opacity-50">
                    {busy === t ? "Starting…" : ACTIVITY_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── BELOW md THIS CARD IS THE STORY'S WHAT'S NEXT (CPR-MOB-001 s6 row 3) ────────────────
              ONE next activity and ONE primary Start -- not the desktop's full planned list, which is
              day orientation for a wide screen. The rest of the plan is a COUNT THAT ROUTES to the
              Planner (s6: summary counts deep-link to their canonical workspace). Starting unplanned
              stays one tap away behind a disclosure -- an emergency consult is never planned, and a
              phone is exactly where that morning happens -- without competing as a second dominant
              action (s4). When there is no next, no plan-write capability and nothing running, the
              page hides this whole section below md (empty modules do not occupy space). */}
          <div className="md:hidden">
            {next ? (
              <>
                <div className="mt-2.5 rounded-xl border border-gray-200 p-3">
                  <p className="text-[14px] font-semibold leading-snug text-gray-900">{next.title}</p>
                  <p className="mt-0.5 text-[12px] text-gray-600">
                    {formatMinuteOfDay(next.plannedStartMinute)} – {formatMinuteOfDay(next.plannedEndMinute)}
                    {" · "}{[next.label, next.facilityName].filter(Boolean).join(" · ")}
                  </p>
                  {/* s6 row 3 promises a Start OR Open action. A caller without the plan-write
                      capability cannot start, so their action is the Open -- the same unconditional
                      planner door the desktop handoff card already offers everyone. */}
                  {/* CPR-CC-MOB-001 s9: "Start Planned Session", not "Start". The bare verb sat under a
                      title, a time and a location and could plausibly have started any of them, or
                      something new -- on the one control that begins clinical state. Naming what it
                      starts is what makes it safe to tap without re-reading the card above it. */}
                  {canPlan ? (
                    <button type="button" disabled={busy !== null}
                      onClick={() => post({ action: "start", id: next.id }, next.id)}
                      className="mt-2.5 flex min-h-[var(--cp-touch-primary)] w-full items-center justify-center rounded-xl bg-[var(--cp-primary)] px-4 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
                      {busy === next.id ? "Starting…" : "Start Planned Session"}
                    </button>
                  ) : (
                    <Link href="/practice/calendar"
                      className="mt-2.5 flex min-h-[var(--cp-touch)] w-full items-center justify-center rounded-lg border border-gray-200 text-[13px] font-semibold text-[var(--cp-primary-deep)]">
                      Open in Planner →
                    </Link>
                  )}
                  {morePlanned > 0 && (
                    <Link href="/practice/calendar"
                      className="mt-1.5 flex min-h-[var(--cp-touch)] items-center text-[12.5px] font-semibold text-[var(--cp-primary-deep)]">
                      and {morePlanned} more planned today — open the Planner →
                    </Link>
                  )}
                </div>
                {canPlan && (
                  <details className="mt-2">
                    <summary className="flex min-h-[var(--cp-touch)] cursor-pointer list-none items-center text-[12.5px] font-semibold text-gray-600">
                      <span aria-hidden className="mr-1 text-gray-400">›</span> Start something unplanned
                    </summary>
                    {typeGrid}
                  </details>
                )}
              </>
            ) : canPlan ? (
              <>
                <p className="mt-2.5 text-[13px] text-gray-600">
                  Nothing is planned for today. Starting a session scopes the workspace to it.
                </p>
                {typeGrid}
              </>
            ) : null}
          </div>
        </>
      )}
      {error && <p role="alert" className="mt-2 text-[12px] text-[var(--cmp-text-critical)]">{error}</p>}
    </section>
  );
}

/** Minutes since local midnight, in the BROWSER's zone -- which is the practitioner's, and the only zone
 *  available to a click handler. The engine re-checks the date against the PRACTICE's clock and refuses
 *  if they disagree, so a traveller cannot accidentally open yesterday's clinic. */
function nowMinute(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
