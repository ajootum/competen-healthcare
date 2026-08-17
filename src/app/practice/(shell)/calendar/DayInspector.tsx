"use client";

import { useState } from "react";
import Link from "next/link";
import type { PlannerDay, PlannerSession, PlannerWeek } from "@/lib/practice/planner";
import { CONFLICT_LABEL, TRAVEL_BASIS_LABEL, TRAVEL_BASIS_NOTE } from "@/lib/practice/planner-constants";
import { hhmm, hoursMinutes, shortDate, toneFor, type PlannerUrlState } from "./planner-ui";
import ContextPanel from "./ContextPanel";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-PLN-002 s5.3 -- THE DAY INSPECTOR.
//
// One bounded inspector where the right rail used to stack six permanent cards (Day, Day Summary,
// AI Planner, Upcoming Follow-ups, Quick Actions, Legend). Three tabs and nothing else:
//
//   Overview     location/program, time spoken for, activity and appointment counts, conflicts and the
//                capacity statement -- the Day/Session context panel is the body. NO LIVE QUEUE: the
//                queue is Current Session's, and this panel never renders one.
//   Follow-ups   planning context around the diary. Booking one stays on the Follow-ups board or the
//                patient record -- this tab points there, it does not duplicate that workflow.
//   Checks       deterministic planning checks only: overlaps, the travel allowance the practitioner
//                typed, blocks with no location, sessions with no generated times, bookings with no
//                record attached. Rules, not advice, and never clinical judgement.
//
// WHERE THE OTHER THREE CARDS WENT, because s4 forbids dropping a capability with its card: the AI
// Planner statement and the Legend are compact disclosures on the planner header (s5.3: no permanent
// card while unavailable; legend as popover), and Quick Actions folded into + Add Activity's type menu.
//
// ⚠ BELOW xl THE INSPECTOR IS A COLLAPSIBLE PANEL (s10): a toggle says whether it is open, and the body
// is hidden until asked for. At xl and up it is the third column and the toggle disappears.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

type TabKey = "overview" | "followups" | "checks";

export default function DayInspector({
  day, week, session, canManage, urlState, onBook, followUps, followUpsUnavailable,
}: {
  day: PlannerDay;
  week: PlannerWeek;
  session: PlannerSession | null;
  canManage: boolean;
  urlState: PlannerUrlState;
  onBook: (date: string, startMinute: number | null) => void;
  followUps: { id: string; patientName: string | null; dueOn: string; kind: string | null; overdue: boolean }[];
  followUpsUnavailable: string | null;
}) {
  const [tab, setTab] = useState<TabKey>("overview");
  const [openOnSmall, setOpenOnSmall] = useState(false);

  // COUNTED FROM THE SAME PAYLOAD EVERY VIEW DRAWS. A failed read shows no badge at all -- a nought on
  // an unreadable day would claim it was checked.
  const checkCount = day.unavailable ? null
    : day.conflicts.length
      + (day.workload?.unassignedCount ?? 0)
      + (day.capacity?.sessionsNotGenerated ?? 0)
      + day.appointments.filter(a => !a.voided && !a.href).length;

  const tabs: { key: TabKey; label: string; badge: number | null }[] = [
    { key: "overview", label: "Overview", badge: null },
    { key: "followups", label: "Follow-ups", badge: null },
    { key: "checks", label: "Checks", badge: checkCount },
  ];

  return (
    <aside className="self-start rounded-2xl border border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <h2 className="text-[14px] font-bold text-gray-900">Day Inspector</h2>
        <span className="text-[11px] text-gray-400">{day.weekdayName} {shortDate(day.date)}</span>
        {/* The collapse control exists only where the inspector is not a column of its own. */}
        <button type="button" onClick={() => setOpenOnSmall(o => !o)}
          aria-expanded={openOnSmall}
          className="ml-auto rounded-lg border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 max-md:min-h-[var(--cp-touch)] max-md:px-3 max-md:text-[12px] xl:hidden">
          {openOnSmall ? "Hide" : "Show"}
        </button>
      </div>

      <div className={openOnSmall ? "block" : "hidden xl:block"}>
        <div role="tablist" aria-label="Day inspector sections"
          className="flex gap-1 border-b border-gray-100 px-2 pt-2">
          {tabs.map(t => (
            <button key={t.key} type="button" role="tab" id={`inspector-tab-${t.key}`}
              aria-selected={tab === t.key} aria-controls={`inspector-panel-${t.key}`}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-t-lg border-b-2 px-2.5 py-1.5 text-[12px] font-semibold max-md:min-h-[var(--cp-touch)] ${
                tab === t.key
                  ? "border-[var(--cp-primary)] text-[var(--cp-primary-deep)]"
                  : "border-transparent text-gray-500 hover:text-gray-800"}`}>
              {t.label}
              {t.badge !== null && t.badge > 0 && (
                <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`inspector-panel-${tab}`} aria-labelledby={`inspector-tab-${tab}`}
          className="p-4">
          {tab === "overview" && (
            <Overview day={day} session={session} canManage={canManage}
              urlState={urlState} onBook={onBook} />
          )}
          {tab === "followups" && (
            <FollowUpsTab items={followUps} unavailable={followUpsUnavailable} />
          )}
          {tab === "checks" && <ChecksTab day={day} week={week} />}
        </div>
      </div>
    </aside>
  );
}

// ── OVERVIEW ─────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ NO "EDIT TARGETS", AND NO PERCENTAGE. Nothing in this product stores a target for a practitioner's
// day, so a target rendered here would be a number this screen invented and handed back to them as
// their own professional standard. Every figure below is a COUNT or a DURATION out of plannerWeek(),
// and where a proportion is meant both numbers are shown rather than one ratio.

function Overview({ day, session, canManage, urlState, onBook }: {
  day: PlannerDay; session: PlannerSession | null; canManage: boolean;
  urlState: PlannerUrlState; onBook: (date: string, startMinute: number | null) => void;
}) {
  const w = day.workload;
  return (
    <div className="flex flex-col gap-3">
      {day.unavailable || w === null ? (
        <p className="text-[12px] font-semibold text-rose-700">
          This day could not be read, so it has no summary. That is not the same as a day with nothing
          on it.
        </p>
      ) : (
        <div>
          <div className="grid grid-cols-4 gap-2">
            <Stat value={w.activityCount} label="Activities" />
            <Stat value={day.appointments.filter(a => !a.voided).length} label="Booked" />
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
          </dl>
          {w.byType.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 border-t border-gray-100 pt-2">
              {w.byType.map(t => (
                <li key={t.activityType} className="flex items-center gap-2 text-[12px]">
                  <span className={`h-1.5 w-1.5 rounded-full ${toneFor(t.activityType).dot}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-gray-700">{t.label}</span>
                  <span className="tabular-nums text-gray-500">{t.count} · {hoursMinutes(t.minutes)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* The Day/Session context: conflicts first, then the capacity statement, what happened and the
          booked list. It is the SCHEDULE half of this tab where the block above is the WORKLOAD half --
          "4 free appointment slots" and "6h 30m spoken for" are different kinds of number. */}
      <ContextPanel day={day} session={session} canManage={canManage} urlState={urlState} onBook={onBook} />
    </div>
  );
}

// ── FOLLOW-UPS (s5.3: planning context only; no duplicate clinical workflow) ────────────────────────

function FollowUpsTab({ items, unavailable }: {
  items: { id: string; patientName: string | null; dueOn: string; kind: string | null; overdue: boolean }[];
  unavailable: string | null;
}) {
  return (
    <div>
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
      <div className="mt-3 border-t border-gray-100 pt-2">
        <Link href="/practice/follow-ups"
          className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          Open the Follow-ups board
        </Link>
        <p className="mt-1 text-[11px] text-gray-400">
          Planning context only. Booking a follow-up into a day happens from the Follow-ups board or the
          patient&apos;s record -- this tab does not redefine one as a task.
        </p>
      </div>
    </div>
  );
}

// ── CHECKS ───────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ DETERMINISTIC ONLY (s5.3, s12). Everything below is arithmetic over the practitioner's own diary:
// the overlap rule, the travel allowance they typed, and rows with something missing. Nothing here is a
// suggestion, a target or a clinical judgement -- the engine that could make one does not exist, and
// the AI Planner disclosure on the header says exactly that.

function ChecksTab({ day, week }: { day: PlannerDay; week: PlannerWeek }) {
  if (day.unavailable) {
    return (
      <p className="text-[12px] font-semibold text-rose-700">
        This day could not be read, so nothing was checked on it. That is not a clean bill.
      </p>
    );
  }

  const w = day.workload;
  const nameOnly = day.appointments.filter(a => !a.voided && !a.href).length;
  const notGenerated = day.capacity?.sessionsNotGenerated ?? 0;
  const unassigned = w?.unassignedCount ?? 0;
  const ww = week.workload;

  return (
    <div className="flex flex-col gap-3">
      {day.conflicts.length === 0 ? (
        <p className="text-[12px] text-gray-600">
          Nothing on {day.weekdayName} overlaps, and every move between locations has at least the time
          you allowed for it.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
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
      <div className="border-t border-gray-100 pt-2">
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

      {(unassigned > 0 || notGenerated > 0 || nameOnly > 0) && (
        <ul className="flex flex-col gap-1 border-t border-gray-100 pt-2">
          {unassigned > 0 && (
            <CheckRow n={unassigned}
              label={`block${unassigned === 1 ? "" : "s"} with no location named`} />
          )}
          {notGenerated > 0 && (
            <CheckRow n={notGenerated}
              label={`session${notGenerated === 1 ? "" : "s"} with no generated times -- their free time is not counted anywhere`} />
          )}
          {nameOnly > 0 && (
            <CheckRow n={nameOnly}
              label={`booked by name only, with no clinical record attached`} />
          )}
        </ul>
      )}

      {ww && (
        <p className="border-t border-gray-100 pt-2 text-[12px] text-gray-600">
          Across the period shown: {ww.conflictCount} conflict{ww.conflictCount === 1 ? "" : "s"},{" "}
          {ww.travelShortfallCount} move{ww.travelShortfallCount === 1 ? "" : "s"} with less time than you allowed.
        </p>
      )}

      <p className="text-[11px] text-gray-400">
        These are scheduling checks -- arithmetic over your own diary. None of them is clinical
        judgement, and this planner makes none.
      </p>
    </div>
  );
}

// ── SHARED FURNITURE ─────────────────────────────────────────────────────────────────────────────────

function CheckRow({ n, label }: { n: number; label: string }) {
  return (
    <li className="text-[12px] font-semibold text-amber-800">
      <span className="font-bold tabular-nums">{n}</span> {label}
    </li>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl bg-gray-50 px-2 py-1.5">
      <p className="text-[15px] font-bold text-gray-900 tabular-nums">{value}</p>
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
