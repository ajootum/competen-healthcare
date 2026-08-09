"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { PlannerDay, PlannerSession, PlannerWeek } from "@/lib/practice/planner";
import {
  CONFLICT_LABEL, PLANNER_QUICK_ACTIONS, PLANNER_STATE_LABEL,
  TRAVEL_BASIS_LABEL, TRAVEL_BASIS_NOTE, activityLabel,
} from "@/lib/practice/planner-constants";
import {
  hhmm, hoursMinutes, shortDate, toneFor, LEGEND_TYPES, STATE_CHIP, type PlannerUrlState,
} from "./planner-ui";
import ContextPanel from "./ContextPanel";

// s3's RIGHT PANEL: Day Summary, AI Planner, Upcoming Follow-ups, Quick Actions and Legend.
//
// ⚠ CP-PLAN-002 s7's CONTEXTUAL PANEL SITS AT THE TOP OF IT, and it is a different question from the Day
// Summary below. The Day Summary is the practitioner's WORKLOAD -- how much of their own time is spoken
// for. The contextual panel is the SCHEDULE -- capacity, who is booked and what a schedule override has
// done to them. Merging the two would put "4 free appointment slots" next to "6h 30m spoken for" as
// though they were the same kind of number.

export default function RightRail({
  day, week, canManage, followUps, followUpsUnavailable, onQuickAdd,
  session, urlState, onBook,
}: {
  day: PlannerDay;
  week: PlannerWeek;
  canManage: boolean;
  followUps: { id: string; patientName: string | null; dueOn: string; kind: string | null; overdue: boolean }[];
  followUpsUnavailable: string | null;
  onQuickAdd: (activityType: string) => void;
  session: PlannerSession | null;
  urlState: PlannerUrlState;
  onBook: (date: string, startMinute: number | null) => void;
}) {
  return (
    <aside className="flex flex-col gap-4">
      <ContextPanel day={day} session={session} canManage={canManage} urlState={urlState} onBook={onBook} />
      <DaySummary day={day} />
      <AiPlanner day={day} week={week} />
      <FollowUps items={followUps} unavailable={followUpsUnavailable} />
      {canManage && <QuickActions onQuickAdd={onQuickAdd} />}
      <Legend />
    </aside>
  );
}

// ── DAY SUMMARY ──────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ NO "EDIT TARGETS", AND NO PERCENTAGE. The comp puts both on this panel. Nothing in this product
// stores a target for a practitioner's day, so a target rendered here would be a number this screen
// invented and handed back to them as their own professional standard. Every figure below is a COUNT or
// a DURATION that came out of plannerWeek(), and where a proportion is meant -- days with activities,
// blocks with no location -- both numbers are shown rather than one ratio.

function DaySummary({ day }: { day: PlannerDay }) {
  const w = day.workload;
  return (
    <Panel title="Day Summary" subtitle={`${day.weekdayName} ${shortDate(day.date)}`}>
      {day.unavailable || w === null ? (
        <p className="text-[12px] font-semibold text-rose-700">
          This day could not be read, so it has no summary. That is not the same as a day with nothing on it.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat value={w.activityCount} label="Activities" />
            <Stat value={w.cancelledCount} label="Cancelled" />
            <Stat value={day.locations.length} label="Locations" />
          </div>
          <dl className="mt-3 flex flex-col gap-1 text-[12px]">
            <Line term="Time spoken for" value={hoursMinutes(w.committedMinutes)} />
            <Line term="Sum of every block" value={hoursMinutes(w.plannedMinutes)} />
            <Line term="Day runs"
              value={w.firstStartMinute === null || w.lastEndMinute === null
                ? "nothing planned"
                : `${hhmm(w.firstStartMinute)} - ${hhmm(w.lastEndMinute)}`} />
            <Line term="Unspoken for inside the day" value={hoursMinutes(w.gapMinutes)} />
            <Line term="Blocks with no location" value={String(w.unassignedCount)} />
          </dl>
          {w.byType.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 border-t border-gray-100 pt-2">
              {w.byType.map(t => (
                <li key={t.activityType} className="flex items-center gap-2 text-[12px]">
                  <span className={`h-1.5 w-1.5 rounded-full ${toneFor(t.activityType).dot}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-gray-700">{t.label}</span>
                  <span className="tabular-nums text-gray-500">{t.count} · {hoursMinutes(t.minutes)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

// ── AI PLANNER ───────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ THIS PANEL MAKES NO SUGGESTIONS, AND SAYS SO. The comp fills it with four: "Travel time to Wednesday
// teaching is optimal", "Consider moving 1 patient to the 12:20 slot". s7 itself marks AI planning
// recommendations as a FUTURE CAPABILITY, and there is no engine behind any of them -- inventing a
// sentence here would be advice about a clinical week generated by a screen.
//
// WHAT IS REAL IS HERE: conflict detection and travel validation. They are RULES, not advice -- they
// answer whether the buffer the practitioner typed fits between two blocks, which is arithmetic.

function AiPlanner({ day, week }: { day: PlannerDay; week: PlannerWeek }) {
  const w = week.workload;
  return (
    <Panel title="AI Planner" id="planner-ai"
      badge={<span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">
        Not yet available
      </span>}>
      <p className="text-[12px] text-gray-500">
        This planner does not suggest slots, rearrange your week or judge whether a day is well arranged.
        That is a future capability and nothing behind this panel does it yet.
      </p>

      <h3 className="mt-3 text-[11px] font-bold uppercase tracking-wide text-gray-500">
        What it does check
      </h3>

      {day.unavailable ? (
        <p className="mt-1 text-[12px] font-semibold text-rose-700">
          This day could not be read, so nothing was checked on it.
        </p>
      ) : (
        <>
          {day.conflicts.length === 0 ? (
            <p className="mt-1 text-[12px] text-gray-600">
              Nothing on {day.weekdayName} overlaps, and every move between locations has at least the time
              you allowed for it.
            </p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1.5">
              {day.conflicts.map((c, i) => (
                <li key={`${c.code}-${i}`} className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-rose-700">
                    {CONFLICT_LABEL[c.code] ?? c.code}
                  </p>
                  <p className="text-[12px] text-rose-800">{c.message}</p>
                </li>
              ))}
            </ul>
          )}

          {/* ⚠ NEVER "Travel Time". The figure is the sum of buffers the practitioner typed against each
              location, and the note that says so is rendered with it every time. */}
          <div className="mt-3 border-t border-gray-100 pt-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{TRAVEL_BASIS_LABEL}</p>
            <p className="text-[15px] font-bold text-gray-900">{hoursMinutes(day.travel.bufferMinutes)}</p>
            <p className="text-[11px] text-gray-400">{TRAVEL_BASIS_NOTE}</p>
            {day.travel.hops.length > 0 && (
              <ul className="mt-1.5 flex flex-col gap-1">
                {day.travel.hops.map((h, i) => (
                  <li key={`${h.fromName}-${h.toName}-${i}`}
                    className={`text-[12px] ${h.sufficient ? "text-gray-600" : "font-semibold text-rose-700"}`}>
                    {h.fromName} → {h.toName}: {hoursMinutes(h.gapMinutes)} between them, {hoursMinutes(h.neededMinutes)} allowed for
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {w && (
        <p className="mt-3 border-t border-gray-100 pt-2 text-[12px] text-gray-600">
          This week: {w.conflictCount} conflict{w.conflictCount === 1 ? "" : "s"},{" "}
          {w.travelShortfallCount} move{w.travelShortfallCount === 1 ? "" : "s"} with less time than you allowed.
        </p>
      )}
    </Panel>
  );
}

// ── UPCOMING FOLLOW-UPS ──────────────────────────────────────────────────────────────────────────────

function FollowUps({ items, unavailable }: {
  items: { id: string; patientName: string | null; dueOn: string; kind: string | null; overdue: boolean }[];
  unavailable: string | null;
}) {
  return (
    <Panel title="Upcoming Follow-ups"
      badge={<Link href="/practice/follow-ups" className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">View all</Link>}>
      {unavailable ? (
        <p className="text-[12px] font-semibold text-amber-700">{unavailable}</p>
      ) : items.length === 0 ? (
        <p className="text-[12px] text-gray-500">Nothing open or scheduled.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map(f => (
            <li key={f.id} className="flex items-baseline gap-2 text-[12px]">
              <span className={`w-[52px] shrink-0 tabular-nums ${f.overdue ? "font-semibold text-rose-700" : "text-gray-500"}`}>
                {shortDate(f.dueOn)}
              </span>
              <span className="min-w-0 flex-1 truncate text-gray-800">{f.patientName ?? "a patient"}</span>
              <span className="shrink-0 text-gray-500">{f.kind ?? ""}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── QUICK ACTIONS (s9) ───────────────────────────────────────────────────────────────────────────────
//
// ⚠ RENDERED BY MAPPING PLANNER_QUICK_ACTIONS, NEVER BY LISTING BUTTONS HERE. That array is where s9's
// vocabulary is reconciled with the activity types the database will actually accept; a hand-typed row
// of buttons is how a screen comes to offer "Add Travel" while the CHECK constraint refuses it at the
// moment somebody presses it.

function QuickActions({ onQuickAdd }: { onQuickAdd: (activityType: string) => void }) {
  return (
    <Panel title="Quick Actions">
      <div className="grid grid-cols-2 gap-2">
        {PLANNER_QUICK_ACTIONS.map(q => (
          <button key={String(q.key)} type="button" onClick={() => onQuickAdd(String(q.key))}
            className="flex items-center gap-2 rounded-xl border border-gray-200 px-2.5 py-2 text-left text-[12px] font-semibold text-gray-700 hover:border-[var(--cp-primary)] hover:text-[var(--cp-primary-deep)]">
            <span className={`h-2 w-2 shrink-0 rounded-full ${toneFor(String(q.key)).dot}`} aria-hidden />
            <span className="min-w-0 truncate">{q.label}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-gray-400">
        Each opens the add form with the type filled in. Nothing is written until you add it.
      </p>
    </Panel>
  );
}

// ── LEGEND ───────────────────────────────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <Panel title="Legend">
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {LEGEND_TYPES.map(t => (
          <li key={t} className="flex items-center gap-1.5 text-[11px] text-gray-600">
            <span className={`h-2 w-2 shrink-0 rounded-full ${toneFor(t).dot}`} aria-hidden />
            <span className="min-w-0 truncate">{activityLabel(t)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-1.5 border-t border-gray-100 pt-2">
        {Object.entries(PLANNER_STATE_LABEL).map(([state, label]) => (
          <span key={state} className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATE_CHIP[state] ?? STATE_CHIP.planned}`}>
            {label}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-gray-400">
        Colour only makes the week scannable. Every block also says its type in words.
      </p>
    </Panel>
  );
}

// ── SHARED FURNITURE ─────────────────────────────────────────────────────────────────────────────────

function Panel({ title, subtitle, badge, id, children }: {
  title: string; subtitle?: string; badge?: ReactNode; id?: string; children: ReactNode;
}) {
  return (
    <section id={id} className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[14px] font-bold text-gray-900">{title}</h2>
        {subtitle && <span className="text-[11px] text-gray-400">{subtitle}</span>}
        <span className="ml-auto">{badge}</span>
      </div>
      {children}
    </section>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl bg-gray-50 px-2 py-1.5">
      <p className="text-[16px] font-bold text-gray-900 tabular-nums">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
    </div>
  );
}

function Line({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="min-w-0 flex-1 truncate text-gray-500">{term}</dt>
      <dd className="shrink-0 font-semibold text-gray-800 tabular-nums">{value}</dd>
    </div>
  );
}
