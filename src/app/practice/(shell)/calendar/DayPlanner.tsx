"use client";

import type { PlannerActivity, PlannerDay, PlannerWeek } from "@/lib/practice/planner";
import { PLANNER_STATE_LABEL } from "@/lib/practice/planner-constants";
import { hhmm, hoursMinutes, longDate, toneFor, STATE_CHIP, type LocationOption, type Notice, type RunAction } from "./planner-ui";
import ActivityActions from "./ActivityActions";

// s3's CENTRE COLUMN -- the Daily Planner for whichever day the week panel has selected.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// DRAG AND DROP (s5) IS NOT BUILT, AND IS NOT HALF-BUILT EITHER.
//
// The engine behind it exists -- moveActivity() takes a date and a start minute and preserves the
// duration exactly as a drag would -- and the appointment Timeline on this same route already drags
// APPOINTMENTS. What is missing is the planner's own pointer surface: a block that follows the finger,
// snaps back when the engine refuses, and reads its position from server-supplied minutes rather than
// from the browser's clock. A dragging surface that silently leaves a block where it was dropped after
// a refusal is worse than none, because the practitioner walks away believing the day moved.
//
// So every s5 action is here as an EXPLICIT CONTROL instead, which is one or two interactions (s10) and
// tells the truth about what happened either way.
//
// THE DAY IS A FLOW, NOT AN ABSOLUTE-POSITIONED RAIL. Blocks are drawn in clock order with the unspoken
// -for time between them named. Absolute positioning would stack two overlapping blocks on top of one
// another -- and an overlap is exactly the thing the practitioner most needs to SEE.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function DayPlanner({ day, week, canManage, locations, busy, notice, run, onAdd }: {
  day: PlannerDay;
  week: PlannerWeek;
  canManage: boolean;
  locations: LocationOption[];
  busy: string | null;
  notice: Notice;
  run: RunAction;
  onAdd: () => void;
}) {
  const ordered = [...day.activities].sort((a, b) =>
    a.plannedStartMinute - b.plannedStartMinute || a.plannedEndMinute - b.plannedEndMinute);
  const conflicted = new Set(day.conflicts.flatMap(c => c.activityIds));
  const w = day.workload;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-gray-100 px-4 py-3">
        <h2 className="text-[16px] font-bold text-gray-900">
          {day.weekdayName}, {longDate(day.date)}
        </h2>
        <span className="text-[12px] text-gray-500">
          {day.locations.length > 0
            ? day.locations.map(l => l.name).join(" → ")
            : "no location on this day"}
        </span>
        <span className="text-[12px] text-gray-400">· {week.timezone}</span>
        {w && w.firstStartMinute !== null && w.lastEndMinute !== null && (
          <span className="ml-auto text-[12px] font-semibold text-gray-600 tabular-nums">
            {hhmm(w.firstStartMinute)} - {hhmm(w.lastEndMinute)}
          </span>
        )}
      </div>

      {day.unavailable ? (
        <p className="px-4 py-6 text-[13px] font-semibold text-rose-700">
          This day could not be read, so nothing is shown for it. That is not the same as an empty day.
          {week.detail ? ` The database said: ${week.detail}` : ""}
        </p>
      ) : (
        <div className="flex flex-col gap-2 p-4">
          {/* s6 THE TEMPLATE BESIDE THE REALITY. Read-only here on purpose: changing the regular week is
              editSession() in Practice Setup, and a planner that rewrote it from one afternoon would
              change every future Tuesday silently. */}
          {day.templateSessions.length > 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                Your regular {day.weekdayName}
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {day.templateSessions.map(t => (
                  <li key={t.id} className="flex flex-wrap items-baseline gap-2 text-[12px]">
                    <span className="tabular-nums text-gray-700">{hhmm(t.startsMinute)} - {hhmm(t.endsMinute)}</span>
                    <span className="text-gray-600">{t.locationName ?? "no location"}</span>
                    <span className="text-gray-400">{t.slotKind}</span>
                    {t.coveredByPlan
                      ? <span className="text-[11px] font-semibold text-emerald-700">covered by today&apos;s plan</span>
                      : <span className="text-[11px] font-semibold text-amber-700">not on today&apos;s plan</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-gray-400">
                Changing this week does not change your template. The regular week is edited in Practice Setup.
              </p>
            </div>
          )}

          {ordered.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-gray-400">Nothing is planned for this day.</p>
          ) : (
            ordered.map((a, i) => {
              const prev = ordered.slice(0, i).filter(p => p.state !== "cancelled").at(-1);
              const gap = prev && a.state !== "cancelled" ? a.plannedStartMinute - prev.plannedEndMinute : null;
              return (
                <div key={a.id} className="flex flex-col gap-2">
                  {gap !== null && gap > 0 && (
                    <p className="pl-16 text-[11px] text-gray-400">{hoursMinutes(gap)} unspoken for</p>
                  )}
                  <ActivityBlock
                    activity={a} conflicted={conflicted.has(a.id)} canManage={canManage}
                    locations={locations} week={week} busy={busy} notice={notice} run={run}
                  />
                </div>
              );
            })
          )}

          {canManage && (
            <button type="button" onClick={onAdd}
              className="mt-1 rounded-xl border border-dashed border-gray-300 px-3 py-3 text-[13px] font-semibold text-gray-600 hover:border-[var(--cp-primary)] hover:text-[var(--cp-primary-deep)]">
              + Add Activity
            </button>
          )}

          <p className="text-[11px] text-gray-400">
            Blocks are moved with the Move control. Dragging a block to a new time is not built on this
            screen yet.
          </p>
        </div>
      )}
    </section>
  );
}

function ActivityBlock({ activity: a, conflicted, canManage, locations, week, busy, notice, run }: {
  activity: PlannerActivity; conflicted: boolean; canManage: boolean;
  locations: LocationOption[]; week: PlannerWeek;
  busy: string | null; notice: Notice; run: RunAction;
}) {
  const tone = toneFor(a.activityType);
  const cancelled = a.state === "cancelled";

  return (
    <article className={`flex gap-3 rounded-xl border px-3 py-2.5 ${conflicted
      ? "border-rose-300 bg-rose-50/40"
      : cancelled ? "border-gray-200 bg-gray-50" : `border-gray-200 ${tone.soft}`}`}>
      <div className="w-12 shrink-0 pt-0.5 text-right">
        <p className={`text-[12px] font-bold tabular-nums ${cancelled ? "text-gray-400 line-through" : "text-gray-800"}`}>
          {hhmm(a.plannedStartMinute)}
        </p>
        <p className="text-[11px] tabular-nums text-gray-400">{hhmm(a.plannedEndMinute)}</p>
      </div>
      <span className={`w-1 shrink-0 rounded-full ${cancelled ? "bg-gray-300" : tone.bar}`} aria-hidden />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={`text-[14px] font-bold ${cancelled ? "text-gray-400 line-through" : "text-gray-900"}`}>
            {a.title}
          </h3>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone.chip}`}>
            {a.label}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATE_CHIP[a.state] ?? STATE_CHIP.planned}`}>
            {PLANNER_STATE_LABEL[a.state] ?? a.state}
          </span>
          {conflicted && (
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">
              In conflict
            </span>
          )}
          <span className="ml-auto text-[11px] text-gray-500 tabular-nums">{hoursMinutes(a.plannedMinutes)}</span>
        </div>

        <p className="mt-0.5 text-[12px] text-gray-600">
          {a.locationName ?? "No location"}
          {a.facilityName ? ` · ${a.facilityName}` : ""}
          {a.room ? ` · ${a.room}` : ""}
        </p>

        {a.notes && <p className="mt-1 text-[12px] text-gray-600">{a.notes}</p>}

        {cancelled && (
          <p className="mt-1 text-[12px] font-semibold text-rose-700">
            Cancelled{a.cancelledAt ? ` on ${a.cancelledAt.slice(0, 10)}` : ""}
            {a.cancellationReason ? `: ${a.cancellationReason}` : ". No reason was given."}
          </p>
        )}

        {/* Lineage, because a copy and a split are things the practitioner did and may want to trace. */}
        {(a.duplicatedFromId || a.splitFromId) && (
          <p className="mt-1 text-[11px] text-gray-400">
            {a.duplicatedFromId ? "Copied from another block. " : ""}
            {a.splitFromId ? "The second half of a split block." : ""}
          </p>
        )}

        {canManage && (
          <ActivityActions
            activity={a} locations={locations} week={week}
            busy={busy === a.id} notice={notice?.subject === a.id ? notice : null} run={run}
          />
        )}
      </div>
    </article>
  );
}
