"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PlannerRange } from "@/lib/practice/planner";
import {
  PLANNER_QUICK_ACTIONS, PLANNER_STATE_LABEL, TRAVEL_BASIS_LABEL, activityLabel,
  type PlannerFilters as Filters, type PlannerPeriod,
} from "@/lib/practice/planner-constants";
import {
  hhmm, hoursMinutes, longDate, plannerHref, toneFor, LEGEND_TYPES, STATE_CHIP,
  type LocationOption, type Notice, type PlannerUrlState,
} from "./planner-ui";
import PlannerNavigator from "./PlannerNavigator";
import PlannerFilters, { type SearchHit } from "./PlannerFilters";
import WeekPanel from "./WeekPanel";
import MonthGrid from "./MonthGrid";
import AgendaList from "./AgendaList";
import DayPlanner from "./DayPlanner";
import DayInspector from "./DayInspector";
import ContextPanel from "./ContextPanel";
import AddActivityForm, { type AddDraft } from "./AddActivityForm";
import FullScreenSheet from "../_responsive/FullScreenSheet";
import { useBelowMd } from "./use-below-md";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE PRACTICE PLANNER -- CP-PLAN-002's four views over one payload, compressed by CPR-PLN-002.
//
// ⚠ CPR-PLN-002 s6: CHANGING THE MODE CHANGES THE COMPOSITION, not a label over the same long page.
//
//   week    My Week rail + selected-day canvas + ONE Day Inspector. Nothing else. The appointment
//           book, the timeline and the calendar grid are NOT stacked underneath it any more.
//   day     the appointment book -- compact clinic summary, availability, route, timeline, booking
//           console -- then the activity canvas and the inspector. That stack mounts HERE AND ONLY
//           HERE: page.tsx builds it only for this view and hands it in as `dayOperations`.
//   month   the calendar grid + the inspector for whichever date is selected. The grid lives in this
//           mode and is not appended below Week -- one calendar, not two.
//   agenda  the chronological list, respecting the filters and search. No inspector column: s6 gives
//           Agenda the list and the filters, and a permanent side card is the vertical length s3 is
//           correcting.
//
// s5.3's REPLACEMENTS for the old six-card right rail: the AI Planner statement and the Legend are
// compact disclosures on this header (no permanent card while the capability does not exist), and the
// Quick Actions are + Add Activity's type menu (one control, type preselected).
//
// ⚠ TYPES ONLY FROM planner.ts. `import type` is erased before the browser bundle is built; a VALUE
// imported from planner.ts here would drag activity.ts -> metrics.ts -> access.ts -> `next/headers` into
// the client and break `next build` on pages nobody touched, with tsc and eslint both passing. Every
// constant this tree renders comes from planner-constants.ts or activity-constants.ts.
//
// ⚠ ONE PAYLOAD, FOUR LAYOUTS. `range` is the SAME PlannerDay[] in every branch below, and every count
// any view shows is arithmetic over the same rows -- which is why clicking a month cell's "8 booked"
// can open those eight.
//
// THE STATE IS THE URL. The selected day, the selected session, the view, the period and every filter
// are query parameters, so the appointment book in Day mode reads the same `?date=`, every control is
// linkable, and a practitioner cannot end up editing Thursday while reading Wednesday.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function PlannerWorkspace({
  range, period, selectedDate, selectedSessionId, filters, urlState, canManage, locations,
  followUps, followUpsUnavailable, search, searchUnavailable, searchTruncated, dayOperations,
}: {
  range: PlannerRange;
  period: PlannerPeriod;
  selectedDate: string;
  selectedSessionId: string | null;
  filters: Filters;
  urlState: PlannerUrlState;
  canManage: boolean;
  locations: LocationOption[];
  followUps: { id: string; patientName: string | null; dueOn: string; kind: string | null; overdue: boolean }[];
  followUpsUnavailable: string | null;
  search: { query: string; hits: SearchHit[] } | null;
  searchUnavailable: string | null;
  searchTruncated: boolean;
  /** Day mode's appointment book, built by page.tsx ONLY when the view is `day`. Null otherwise. */
  dayOperations?: ReactNode;
}) {
  const router = useRouter();
  // CPR-MOB-001 s8: one behavioural breakpoint question, for the ONE surface that must MOUNT
  // differently on a phone (the add form's full-screen sheet). Everything else on this screen adapts
  // by CSS alone.
  const belowMd = useBelowMd();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [draft, setDraft] = useState<AddDraft | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);

  const day = range.days.find(d => d.date === selectedDate) ?? range.days[0];
  const session = selectedSessionId
    ? day.sessions.find(s => s.id === selectedSessionId) ?? null
    : null;

  // ── CPR-PD-013 s7: DRAG A BLOCK ONTO ANOTHER DAY ────────────────────────────────────────────────
  //
  // ⚠ WHAT A PLANNER BLOCK CAN BE DRAGGED *TO* IS A DAY, NOT A TIME, and that follows from the screen
  // rather than from preference. DayPlanner is a LIST of cards ordered by start time -- it has no
  // pixels-per-minute geometry -- so dragging a card up or down would either mean nothing or mean an
  // invented time. Timeline.tsx next door is the positioned surface and already drags appointments by
  // time. The move this list can express honestly is the one the Move form spells out with a date
  // field: the same block, a different day.
  //
  // ⚠ THE STATE LIVES HERE BECAUSE THE SOURCE AND THE TARGET ARE SIBLINGS. The card is inside
  // DayPlanner and the seven days are inside WeekPanel; neither can see the other.
  //
  // ⚠ NOT OPTIMISTIC. s7 permits optimistic movement "only if failure can be safely rolled back with
  // clear feedback" -- and a block that visibly jumps to Thursday before the server refuses it for a
  // theatre clash has already told the practitioner something untrue about their week. The row goes
  // busy, the engine decides, and its own words are rendered either way.
  const [dragging, setDragging] = useState<{ id: string; title: string; fromDate: string } | null>(null);

  async function dropOnDay(date: string): Promise<void> {
    const d = dragging;
    setDragging(null);
    // Dropping a block back onto its own day is a cancelled gesture, not a refusal worth reporting.
    if (!d || d.fromDate === date) return;
    await run("move", { id: d.id, planDate: date }, d.id);
  }

  async function run(action: string, body: Record<string, unknown>, subject: string): Promise<boolean> {
    setBusy(subject);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/practice/planner", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const json = await res.json().catch(() => null) as
        { error?: { code?: string; message?: string }; value?: unknown } | null;

      if (!res.ok) {
        setNotice({
          subject, tone: "error",
          // The engine's own words. Only when there are none at all does this screen speak for it, and
          // then it says what it actually knows: the status the server returned.
          message: json?.error?.message ?? `the planner refused that (HTTP ${res.status})`,
        });
        return false;
      }

      // Duplicate decides each date separately, so "it worked" is not the whole answer: the dates it
      // would not copy to, and why, are the half a practitioner has to act on.
      const value = json?.value as { created?: { date: string }[]; refused?: { date: string; reason: string }[] } | undefined;
      if (value?.refused?.length) {
        setNotice({
          subject, tone: "error",
          message: `copied to ${value.created?.length ?? 0} date(s). Not copied: ` +
            value.refused.map(r => `${r.date} -- ${r.reason}`).join("; "),
        });
      } else {
        setNotice({ subject, tone: "ok", message: "Done." });
      }
      router.refresh();
      return true;
    } catch (e) {
      setNotice({
        subject, tone: "error",
        message: e instanceof Error ? `the request did not reach the server: ${e.message}` : "the request did not reach the server",
      });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const openAdd = (d: Partial<AddDraft> = {}) => {
    setNotice(null);
    setTypeMenuOpen(false);
    setDraft({
      activityType: d.activityType ?? "outpatient_clinic",
      title: d.title ?? "",
      planDate: d.planDate ?? day.date,
      start: d.start ?? "09:00",
      end: d.end ?? "12:00",
      locationId: d.locationId ?? "",
    });
  };

  const onBook = (date: string, startMinute: number | null) => openAdd({
    planDate: date,
    start: startMinute === null ? "09:00" : hhmm(startMinute),
    end: startMinute === null ? "12:00" : hhmm(Math.min(1440, startMinute + 180)),
  });

  const w = range.workload;
  const detail = (
    <DayPlanner
      day={day} week={range} canManage={canManage} locations={locations}
      busy={busy} notice={notice} run={run}
      dragging={dragging} onDragActivity={setDragging}
      onAdd={() => openAdd({ planDate: day.date })}
      filters={filters} urlState={urlState} selectedSessionId={selectedSessionId}
    />
  );

  const inspector = (
    <DayInspector
      day={day} week={range} session={session} canManage={canManage} urlState={urlState}
      onBook={onBook} followUps={followUps} followUpsUnavailable={followUpsUnavailable}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {/* ── HEADER: what this screen is, the entry points, and the period's totals ──────────────── */}
      <header className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900">Practice Planner</h1>
            <p className="text-[13px] text-gray-500">
              Plan, organise and adapt your time -- past, present and future. Your template is your
              guide; your plan is your reality.
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {/* s5.1's AI Planner entry point. A DISCLOSURE, not a card: s5.3 says that while the
                capability is unavailable it must not hold a large persistent card, and the panel it
                opens says honestly what does and does not exist. */}
            {/* CPR-MOB-001 s4: thumb-sized below md; max-md:* no-ops leave the desktop header as
                CPR-PLN-002 froze it. */}
            <button type="button" onClick={() => { setAiOpen(o => !o); setLegendOpen(false); }}
              aria-expanded={aiOpen}
              className={`rounded-lg border px-3 py-1.5 text-[13px] font-semibold max-md:min-h-[var(--cp-touch)] ${aiOpen
                ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]"
                : "border-[var(--cp-primary-border)] bg-[var(--cp-primary)]/5 text-[var(--cp-primary-deep)] hover:bg-[var(--cp-primary)]/10"}`}>
              AI Planner
            </button>
            {/* s5.3: the Legend is a compact popover opened from a control, not a permanent tall card. */}
            <button type="button" onClick={() => { setLegendOpen(o => !o); setAiOpen(false); }}
              aria-expanded={legendOpen}
              className={`rounded-lg border px-3 py-1.5 text-[13px] font-semibold max-md:min-h-[var(--cp-touch)] ${legendOpen
                ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]"
                : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
              Legend
            </button>
            {canManage && (
              <div className="relative flex">
                <button type="button" onClick={() => openAdd()}
                  className="rounded-l-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] max-md:min-h-[var(--cp-touch)]">
                  + Add Activity
                </button>
                {/* s5.3: Quick Actions are consolidated here -- the same add flow with the type
                    preselected, one control instead of a permanent card of eight buttons. */}
                <button type="button" onClick={() => setTypeMenuOpen(o => !o)}
                  aria-expanded={typeMenuOpen} aria-label="Add an activity of a specific type"
                  className="rounded-r-lg border-l border-white/30 bg-[var(--cp-primary)] px-2 py-1.5 text-[13px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] max-md:min-h-[var(--cp-touch)] max-md:min-w-[var(--cp-touch)]">
                  ⌄
                </button>
                {typeMenuOpen && (
                  <div className="absolute right-0 top-full z-20 mt-1 w-60 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
                    {PLANNER_QUICK_ACTIONS.map(q => (
                      <button key={String(q.key)} type="button"
                        onClick={() => openAdd({ activityType: String(q.key), title: activityLabel(String(q.key)) })}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-semibold text-gray-700 hover:bg-gray-50 max-md:min-h-[var(--cp-touch)]">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${toneFor(String(q.key)).dot}`} aria-hidden />
                        <span className="min-w-0 truncate">{q.label}</span>
                      </button>
                    ))}
                    <p className="px-2.5 py-1 text-[11px] text-gray-400">
                      Each opens the add form with the type filled in. Nothing is written until you add it.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {aiOpen && (
          <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-[12px] text-gray-700">
              <span className="font-bold">AI Planner -- not yet available.</span>{" "}
              This planner does not suggest slots, rearrange your week or judge whether a day is well
              arranged. That is a future capability and nothing behind this control does it yet.
            </p>
            <p className="mt-1 text-[12px] text-gray-500">
              What is checked today is arithmetic, not advice: overlaps, and the travel allowance you
              typed against each location. Those checks live in the Day Inspector&apos;s Checks tab, and
              the engine refuses a conflicting move when you attempt one.
            </p>
          </div>
        )}

        {legendOpen && (
          <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
              {LEGEND_TYPES.map(t => (
                <li key={t} className="flex items-center gap-1.5 text-[11px] text-gray-600">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${toneFor(t).dot}`} aria-hidden />
                  <span className="min-w-0 truncate">{activityLabel(t)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-gray-200 pt-2">
              {Object.entries(PLANNER_STATE_LABEL).map(([state, label]) => (
                <span key={state} className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATE_CHIP[state] ?? STATE_CHIP.planned}`}>
                  {label}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-gray-400">
              Colour only makes the week scannable. Every block also says its type in words.
            </p>
          </div>
        )}

        {/* ── PERIOD SUMMARY. COUNTS ONLY -- no percentage, no target. On small widths a zero that
            says nothing steps aside (s5.1); every figure is back the moment it is non-zero. ───────── */}
        <div className="mt-3 flex flex-wrap items-stretch gap-x-6 gap-y-3 border-t border-gray-100 pt-3">
          {/* One day is one date. "16 Aug 2026 - 16 Aug 2026" is the same fact printed as noise, and
              CPR-PLAN-002 s5 opens Day mode with a COMPACT header. */}
          <Figure label="Showing"
            value={range.fromDate === range.toDate
              ? longDate(range.fromDate)
              : `${longDate(range.fromDate)} - ${longDate(range.toDate)}`}
            wide />
          {w === null ? (
            <p className="text-[13px] font-semibold text-rose-700">
              The totals for this period could not be worked out{range.detail ? `: ${range.detail}` : "."}
            </p>
          ) : (
            <>
              <Figure label="Activities" value={String(w.activityCount)}
                quietOnSmall={w.activityCount === 0} />
              <Figure label="Appointments" value={String(w.appointmentCount)}
                quietOnSmall={w.appointmentCount === 0}
                note={w.voidAppointmentCount > 0 ? `${w.voidAppointmentCount} cancelled or missed` : undefined} />
              <Figure label="Sessions" value={String(w.sessionCount)}
                quietOnSmall={w.sessionCount === 0}
                note={w.sessionsNotGenerated > 0 ? `${w.sessionsNotGenerated} with no generated times` : undefined} />
              {/* ⚠ A DASH, NOT A NOUGHT, when nothing in the period could be counted.
                  AND THE UNIT, which this tile was the only place to omit: "25 / Free / in your own diary"
                  is 25 of nothing named, and hours, days and slots all read plausibly. The Day Inspector
                  labels the same figure "Slots" beside Booked and Free, and planner-constants.ts opens
                  CAPACITY_BASIS_NOTE with "HOW A FREE COUNT MUST BE LABELLED WHEREVER IT IS DRAWN" -- this
                  is one of the places it is drawn. */}
              <Figure label="Free" value={w.availableCount === null ? "-" : String(w.availableCount)}
                note={w.availableCount === null ? "not calculable" : "appointment slots in your own diary"} />
              <Figure label="Days used" value={String(w.daysWithActivities)}
                note={`of ${range.days.length} days`} />
              <Figure label="Locations" value={String(w.locationCount)}
                quietOnSmall={w.locationCount === 0} />
              <Figure label="Conflicts" value={String(w.conflictCount)}
                quietOnSmall={w.conflictCount === 0}
                tone={w.conflictCount > 0 ? "bad" : undefined} />
              {/* ⚠ NEVER "Travel Time". This is the sum of the buffers the practitioner typed against
                  each location. See TRAVEL_BASIS_LABEL and the AI Planner disclosure's note. */}
              <Figure label={TRAVEL_BASIS_LABEL} value={hoursMinutes(w.travelBufferMinutes)} note="not measured"
                quietOnSmall={w.travelBufferMinutes === 0} />
            </>
          )}
        </div>

        {/* Where the selected day actually takes you. */}
        <p className="mt-2 text-[12px] text-gray-500">
          {day.unavailable
            ? `${day.weekdayName} could not be read.`
            : day.locations.length === 0
              ? `${day.weekdayName} has no location on it.`
              : `${day.weekdayName}: ${day.locations.map(l => l.facilityName ? `${l.name} (${l.facilityName})` : l.name).join(" then ")}`}
        </p>
      </header>

      <PlannerNavigator period={period} todayDate={range.todayDate} timezone={range.timezone}
        urlState={urlState} />
      <PlannerFilters filters={filters} urlState={urlState} locations={locations}
        search={search} searchUnavailable={searchUnavailable} searchTruncated={searchTruncated} />

      {range.unavailable && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-800">
          This period could not be read, so nothing below is a statement about what you have on.
          {range.detail ? ` The database said: ${range.detail}` : ""}
        </p>
      )}
      {range.truncated && (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
          This period holds more than the planner reads in one go. Some of it is not shown. Choose a
          shorter period to see all of it.
        </p>
      )}
      {range.rangeCapped && (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
          A period is read at most {range.days.length} days at a time, so this one was cut short at{" "}
          {longDate(range.toDate)}.
        </p>
      )}

      {/* THE ADD FLOW, above whichever view is open, so pressing + Add Activity never opens a form
          somewhere below the fold. One form for every entry point -- header, type menu, day cards,
          canvas and inspector all call the same openAdd.

          CPR-MOB-001 s8: "Add activity -- full-screen form or bottom sheet." Below md the SAME form,
          with the same draft state and the same submit path, mounts inside FullScreenSheet instead of
          inline -- one form component, two frames, zero duplicated logic (s19). The mount is gated on
          the hook rather than on CSS because the sheet runs a focus trap and a scroll lock, which a
          display:none copy would still run against the visible desktop form. */}
      {draft && canManage && (belowMd ? (
        <FullScreenSheet open onClose={() => setDraft(null)} title="Add an activity">
          <AddActivityForm
            bare draft={draft} setDraft={setDraft} locations={locations}
            busy={busy === "add"} notice={notice?.subject === "add" ? notice : null}
            onSubmit={async body => { const ok = await run("plan", body, "add"); if (ok) setDraft(null); }}
            onCancel={() => setDraft(null)}
          />
        </FullScreenSheet>
      ) : (
        <AddActivityForm
          draft={draft} setDraft={setDraft} locations={locations}
          busy={busy === "add"} notice={notice?.subject === "add" ? notice : null}
          onSubmit={async body => { const ok = await run("plan", body, "add"); if (ok) setDraft(null); }}
          onCancel={() => setDraft(null)}
        />
      ))}

      {/* ── THE FOUR COMPOSITIONS (s6) ─────────────────────────────────────────────────────────── */}
      {period.view === "week" ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)_330px]">
          <WeekPanel week={range} selectedDate={day.date} canManage={canManage}
            dragging={dragging} onDropDay={dropOnDay}
            onAdd={date => openAdd({ planDate: date })} urlState={urlState} />
          {/* CPR-MOB-001 s8: "Week -- stacked day cards with activity/location/booked/free summary."
              My Week's cards above ARE that face, so below md Week mode is those cards and nothing
              else; the selected-day canvas and the inspector return at md. The wrapper is a visual
              no-op everywhere it shows them: xl:contents hands both back to the outer grid as the
              same two columns, and between md and xl it is the same single-column stack with the
              same gap. Each card's "Open Day view" is the one-action route onward (HFE-10). */}
          <div className="max-md:hidden grid gap-4 xl:contents">
            {detail}
            {inspector}
          </div>
        </div>
      ) : period.view === "day" ? (
        <div className="flex flex-col gap-4">
          {/* s6: Day mode's primary content is the timeline, the appointments, the availability and
              the booking controls; the activity canvas and the inspector follow as context. */}
          {dayOperations}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
            {detail}
            {inspector}
          </div>
        </div>
      ) : period.view === "month" ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
          <MonthGrid range={range} period={period} filters={filters} urlState={urlState}
            selectedDate={day.date} />
          {inspector}
        </div>
      ) : (
        // AGENDA: the chronological list, with CPR-PLAN-002 s8.3's ITEM PREVIEW beside it -- but ONLY
        // while a session is actually selected. CPR-PLN-002 froze Agenda against a PERMANENT side
        // panel, and that half of the freeze stands: nothing is mounted here until the practitioner
        // selects an item, and closing the selection returns the list to full width. The preview is
        // the same ContextPanel the Day Inspector's Overview renders, so the counts, the outcomes and
        // the honesty sentences cannot diverge between the two surfaces (HFE-07, s14).
        <div className={session
          ? "grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_330px]"
          : "grid grid-cols-1 gap-4"}>
          <AgendaList range={range} period={period} filters={filters} urlState={urlState} />
          {session && (
            <aside className="self-start rounded-2xl border border-gray-200 bg-white">
              <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
                <h2 className="text-[14px] font-bold text-gray-900">Item preview</h2>
                <Link scroll={false} href={plannerHref({ ...urlState, sel: null })}
                  className="ml-auto rounded-lg border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
                  Close
                </Link>
              </div>
              <div className="p-4">
                <ContextPanel day={day} session={session} canManage={canManage}
                  urlState={urlState} onBook={onBook} />
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, note, tone, wide, quietOnSmall }: {
  label: string; value: string; note?: string; tone?: "bad"; wide?: boolean;
  /** s5.1: a zero that does not help scanning is hidden on small widths only. Never on desktop. */
  quietOnSmall?: boolean;
}) {
  return (
    <div className={`${wide ? "min-w-[220px]" : ""} ${quietOnSmall ? "max-md:hidden" : ""}`}>
      <p className={`text-[15px] font-bold ${tone === "bad" ? "text-rose-700" : "text-gray-900"}`}>{value}</p>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      {note && <p className="text-[11px] text-gray-400">{note}</p>}
    </div>
  );
}
