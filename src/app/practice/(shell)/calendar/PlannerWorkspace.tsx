"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PlannerRange } from "@/lib/practice/planner";
import {
  TRAVEL_BASIS_LABEL, activityLabel,
  type PlannerFilters as Filters, type PlannerPeriod,
} from "@/lib/practice/planner-constants";
import {
  hoursMinutes, longDate, hhmm, type LocationOption, type Notice, type PlannerUrlState,
} from "./planner-ui";
import PlannerNavigator from "./PlannerNavigator";
import PlannerFilters, { type SearchHit } from "./PlannerFilters";
import WeekPanel from "./WeekPanel";
import MonthGrid from "./MonthGrid";
import AgendaList from "./AgendaList";
import DayPlanner from "./DayPlanner";
import RightRail from "./RightRail";
import AddActivityForm, { type AddDraft } from "./AddActivityForm";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE PRACTICE PLANNER -- CPR-V5-005's three columns, now CP-PLAN-002's four views over one payload.
//
// ⚠ TYPES ONLY FROM planner.ts. `import type` is erased before the browser bundle is built; a VALUE
// imported from planner.ts here would drag activity.ts -> metrics.ts -> access.ts -> `next/headers` into
// the client and break `next build` on pages nobody touched, with tsc and eslint both passing. Every
// constant this tree renders comes from planner-constants.ts or activity-constants.ts.
//
// ⚠ ONE PAYLOAD, FOUR LAYOUTS. `range` is the SAME PlannerDay[] in every branch below. Day draws one of
// them in detail, Week draws seven in a rail plus one in detail, Month draws the grid and Agenda draws
// the list -- and every count any of them shows is arithmetic over the same rows, which is why clicking
// a month cell's "8 booked" can open those eight.
//
// THE STATE IS THE URL. The selected day, the selected session, the view, the period and every filter
// are query parameters, so the appointment book below this planner reads the same `?date=`, every
// control is linkable, and a practitioner cannot end up editing Thursday while reading Wednesday.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function PlannerWorkspace({
  range, period, selectedDate, selectedSessionId, filters, urlState, canManage, locations,
  followUps, followUpsUnavailable, search, searchUnavailable, searchTruncated,
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
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [draft, setDraft] = useState<AddDraft | null>(null);

  const day = range.days.find(d => d.date === selectedDate) ?? range.days[0];
  const session = selectedSessionId
    ? day.sessions.find(s => s.id === selectedSessionId) ?? null
    : null;

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
    setDraft({
      activityType: d.activityType ?? "outpatient_clinic",
      title: d.title ?? "",
      planDate: d.planDate ?? day.date,
      start: d.start ?? "09:00",
      end: d.end ?? "12:00",
      locationId: d.locationId ?? "",
    });
  };

  const w = range.workload;
  const detail = (
    <div className="flex min-w-0 flex-col gap-4">
      {draft && canManage && (
        <AddActivityForm
          draft={draft} setDraft={setDraft} locations={locations}
          busy={busy === "add"} notice={notice?.subject === "add" ? notice : null}
          onSubmit={async body => { const ok = await run("plan", body, "add"); if (ok) setDraft(null); }}
          onCancel={() => setDraft(null)}
        />
      )}
      <DayPlanner
        day={day} week={range} canManage={canManage} locations={locations}
        busy={busy} notice={notice} run={run}
        onAdd={() => openAdd({ planDate: day.date })}
        filters={filters} urlState={urlState} selectedSessionId={selectedSessionId}
      />
    </div>
  );

  const rail = (
    <RightRail
      day={day} week={range} canManage={canManage}
      followUps={followUps} followUpsUnavailable={followUpsUnavailable}
      // The title is prefilled with the type's own name so a quick action is ONE interaction plus a
      // confirmation, not a form with an empty required field.
      onQuickAdd={activityType => openAdd({ activityType, title: activityLabel(activityType) })}
      session={session} urlState={urlState}
      onBook={(date, startMinute) => openAdd({
        planDate: date,
        start: startMinute === null ? "09:00" : hhmm(startMinute),
        end: startMinute === null ? "12:00" : hhmm(Math.min(1440, startMinute + 180)),
      })}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {/* ── HEADER: what this screen is, and the week's totals when a week is what is on show ──── */}
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
            {/* s3 asks for AI Planner in the header. It is a jump to the panel, which says honestly what
                it can and cannot do -- it is not a second, different claim about the same thing. */}
            <a href="#planner-ai"
              className="rounded-lg border border-[var(--cp-primary-border)] bg-[var(--cp-primary)]/5 px-3 py-1.5 text-[13px] font-semibold text-[var(--cp-primary-deep)] hover:bg-[var(--cp-primary)]/10">
              AI Planner
            </a>
            {canManage && (
              <button type="button" onClick={() => openAdd()}
                className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
                + Add Activity
              </button>
            )}
          </div>
        </div>

        {/* ── PERIOD SUMMARY. COUNTS ONLY -- no percentage, no target. ──────────────────────────── */}
        <div className="mt-3 flex flex-wrap items-stretch gap-x-6 gap-y-3 border-t border-gray-100 pt-3">
          <Figure label="Showing" value={`${longDate(range.fromDate)} - ${longDate(range.toDate)}`} wide />
          {w === null ? (
            <p className="text-[13px] font-semibold text-rose-700">
              The totals for this period could not be worked out{range.detail ? `: ${range.detail}` : "."}
            </p>
          ) : (
            <>
              <Figure label="Activities" value={String(w.activityCount)} />
              <Figure label="Appointments" value={String(w.appointmentCount)}
                note={w.voidAppointmentCount > 0 ? `${w.voidAppointmentCount} cancelled or missed` : undefined} />
              <Figure label="Sessions" value={String(w.sessionCount)}
                note={w.sessionsNotGenerated > 0 ? `${w.sessionsNotGenerated} with no generated times` : undefined} />
              {/* ⚠ A DASH, NOT A NOUGHT, when nothing in the period could be counted. */}
              <Figure label="Free" value={w.availableCount === null ? "-" : String(w.availableCount)}
                note={w.availableCount === null ? "not calculable" : "in your own diary"} />
              <Figure label="Days used" value={String(w.daysWithActivities)}
                note={`of ${range.days.length} days`} />
              <Figure label="Locations" value={String(w.locationCount)} />
              <Figure label="Conflicts" value={String(w.conflictCount)}
                tone={w.conflictCount > 0 ? "bad" : undefined} />
              {/* ⚠ NEVER "Travel Time". This is the sum of the buffers the practitioner typed against
                  each location. See TRAVEL_BASIS_LABEL and the AI Planner panel's note. */}
              <Figure label={TRAVEL_BASIS_LABEL} value={hoursMinutes(w.travelBufferMinutes)} note="not measured" />
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

      {/* ── THE FOUR VIEWS ─────────────────────────────────────────────────────────────────────── */}
      {period.view === "week" ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)_330px]">
          <WeekPanel week={range} selectedDate={day.date} canManage={canManage}
            onAdd={date => openAdd({ planDate: date })} urlState={urlState} />
          {detail}
          {rail}
        </div>
      ) : period.view === "day" ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
          {detail}
          {rail}
        </div>
      ) : period.view === "month" ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
          <MonthGrid range={range} period={period} filters={filters} urlState={urlState}
            selectedDate={day.date} />
          {rail}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
          <AgendaList range={range} period={period} filters={filters} urlState={urlState} />
          {rail}
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, note, tone, wide }: {
  label: string; value: string; note?: string; tone?: "bad"; wide?: boolean;
}) {
  return (
    <div className={wide ? "min-w-[220px]" : ""}>
      <p className={`text-[15px] font-bold ${tone === "bad" ? "text-rose-700" : "text-gray-900"}`}>{value}</p>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      {note && <p className="text-[11px] text-gray-400">{note}</p>}
    </div>
  );
}
