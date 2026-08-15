"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import type { TodaysPlan } from "@/lib/practice/activity";
// From the CONSTANTS module, never from the engine: activity.ts reaches metrics.ts -> access.ts ->
// next/headers, and importing it here put server-only code in the browser bundle and failed the build.
import { ACTIVITY_LABEL, ACTIVITY_TYPES, type ActivityType } from "@/lib/practice/activity-constants";
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

export default function StartYourDay({ plan, metrics, canPlan }: {
  plan: TodaysPlan;
  metrics: SessionWithFigures | null;
  canPlan: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        <div className="flex items-center gap-2">
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

          <div className="mt-3 flex gap-2">
            <button type="button" disabled={!canPlan || busy !== null}
              onClick={() => post({ action: "end", id: a.id }, "end")}
              className="flex-1 rounded-lg border border-[var(--cp-primary-border)] bg-white px-3 py-2 text-[12.5px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50">
              {busy === "end" ? "Ending…" : "End Session"}
            </button>
            <Link href="/practice/calendar"
              className="flex-1 rounded-lg bg-[var(--cp-primary)] px-3 py-2 text-center text-[12.5px] font-semibold text-white hover:opacity-90">
              View Session
            </Link>
          </div>
          {error && <p role="alert" className="mt-2 text-[12px] text-[var(--cmp-text-danger)]">{error}</p>}
        </div>
      </section>
    );
  }

  // ── NOTHING RUNNING ────────────────────────────────────────────────────────────────────────────
  const planned = plan.activities.filter(x => x.state === "planned");
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4" aria-labelledby="zone1">
      <div className="flex items-center gap-2">
        <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cp-primary)] text-[10px] font-bold text-white">1</span>
        <h2 id="zone1" className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">Start your day</h2>
      </div>

      {plan.unavailable ? (
        <p className="mt-3 text-[13px] text-gray-500">
          Your plan could not be read just now, so nothing here is a claim that your day is empty.
        </p>
      ) : (
        <>
          <p className="mt-2.5 text-[13px] text-gray-600">
            Nothing is running. Everything else on this page counts your whole day until you start
            something — then it counts the session.
          </p>

          {planned.length > 0 && (
            <div className="mt-3 space-y-1.5">
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
            <div className="mt-3 border-t border-gray-100 pt-3">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-gray-500">
                {planned.length > 0 ? "Or start something unplanned" : "Start now"}
              </p>
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
        </>
      )}
      {error && <p role="alert" className="mt-2 text-[12px] text-[var(--cmp-text-danger)]">{error}</p>}
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
