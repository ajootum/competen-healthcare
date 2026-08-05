"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PlannerWeek } from "@/lib/practice/planner";
import { TRAVEL_BASIS_LABEL, activityLabel } from "@/lib/practice/planner-constants";
import { hoursMinutes, longDate, shiftDate, type LocationOption, type Notice } from "./planner-ui";
import WeekPanel from "./WeekPanel";
import DayPlanner from "./DayPlanner";
import RightRail from "./RightRail";
import AddActivityForm, { type AddDraft } from "./AddActivityForm";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-005 THE PRACTICE PLANNER -- s3's three columns, and the one place that talks to the engine.
//
// ⚠ TYPES ONLY FROM planner.ts. `import type` is erased before the browser bundle is built; a VALUE
// imported from planner.ts here would drag activity.ts -> metrics.ts -> access.ts -> `next/headers` into
// the client and break `next build` on pages nobody touched, with tsc and eslint both passing. Every
// constant this tree renders comes from planner-constants.ts or activity-constants.ts.
//
// THE SELECTED DAY IS THE URL, not client state. The appointment book below this planner reads the same
// ?date= parameter, and two different ideas of "the day I am looking at" on one screen is how a
// practitioner ends up editing Thursday while reading Wednesday. It also means the week the server
// fetched always contains the day being shown.
//
// EVERY REFUSAL IS SHOWN WHERE IT BELONGS. The engine writes sentences for practitioners -- "only 20
// minutes between Aga Khan and Mulago, which needs 40" -- and they are rendered verbatim against the
// block they are about, never summarised into "something went wrong".
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function PlannerWorkspace({
  week, selectedDate, canManage, locations, followUps, followUpsUnavailable,
}: {
  week: PlannerWeek;
  selectedDate: string;
  canManage: boolean;
  locations: LocationOption[];
  followUps: { id: string; patientName: string | null; dueOn: string; kind: string | null; overdue: boolean }[];
  followUpsUnavailable: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [draft, setDraft] = useState<AddDraft | null>(null);

  const day = week.days.find(d => d.date === selectedDate) ?? week.days[0];

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

  const prevWeek = shiftDate(week.weekStartDate, -7);
  const nextWeek = shiftDate(week.weekStartDate, 7);
  const w = week.workload;

  return (
    <div className="flex flex-col gap-4">
      {/* ── HEADER (s3): week summary, location, timezone, AI Planner, Add Activity ─────────────── */}
      <header className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900">Practice Planner</h1>
            <p className="text-[13px] text-gray-500">
              Plan, organise and adapt your week. Your template is your guide -- your plan is your reality.
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Link href={`/practice/calendar?date=${prevWeek}`}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50"
              aria-label="Previous week">‹</Link>
            <Link href="/practice/calendar"
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50">
              This week
            </Link>
            <Link href={`/practice/calendar?date=${nextWeek}`}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50"
              aria-label="Next week">›</Link>

            {/* The timezone the whole screen is on. Every minute figure below is practice-local. */}
            <span className="ml-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[12px] font-semibold text-gray-600">
              {week.timezone}
            </span>

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

        {/* ── WEEK SUMMARY. COUNTS ONLY -- no percentage, no target. ────────────────────────────── */}
        <div className="mt-3 flex flex-wrap items-stretch gap-x-6 gap-y-3 border-t border-gray-100 pt-3">
          <Figure label="This week" value={`${longDate(week.weekStartDate)} - ${longDate(week.weekEndDate)}`} wide />
          {w === null ? (
            <p className="text-[13px] font-semibold text-rose-700">
              The week totals could not be worked out{week.detail ? `: ${week.detail}` : "."}
            </p>
          ) : (
            <>
              <Figure label="Activities" value={String(w.activityCount)} />
              <Figure label="Days with activities" value={String(w.daysWithActivities)} note="of 7 days" />
              <Figure label="Locations" value={String(w.locationCount)} />
              <Figure label="Planned" value={hoursMinutes(w.committedMinutes)} note="time spoken for" />
              <Figure label="Conflicts" value={String(w.conflictCount)}
                tone={w.conflictCount > 0 ? "bad" : undefined} />
              <Figure label="Cancelled" value={String(w.cancelledCount)} />
              {/* ⚠ NEVER "Travel Time". This is the sum of the buffers the practitioner typed against
                  each location. See TRAVEL_BASIS_LABEL and the AI Planner panel's note. */}
              <Figure label={TRAVEL_BASIS_LABEL} value={hoursMinutes(w.travelBufferMinutes)} note="not measured" />
            </>
          )}
        </div>

        {/* Where the selected day actually takes you. s3's "location" in the header. */}
        <p className="mt-2 text-[12px] text-gray-500">
          {day.unavailable
            ? `${day.weekdayName} could not be read.`
            : day.locations.length === 0
              ? `${day.weekdayName} has no location on it.`
              : `${day.weekdayName}: ${day.locations.map(l => l.facilityName ? `${l.name} (${l.facilityName})` : l.name).join(" then ")}`}
        </p>
      </header>

      {week.unavailable && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-800">
          This week could not be read, so nothing below is a statement about what you have on.
          {week.detail ? ` The database said: ${week.detail}` : ""}
        </p>
      )}
      {week.truncated && (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
          This week holds more blocks than the planner reads in one go. Some are not shown.
        </p>
      )}

      {/* ── s3's THREE COLUMNS ────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)_330px]">
        <WeekPanel
          week={week} selectedDate={day.date} canManage={canManage}
          onAdd={date => openAdd({ planDate: date })}
        />

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
            day={day} week={week} canManage={canManage} locations={locations}
            busy={busy} notice={notice} run={run}
            onAdd={() => openAdd({ planDate: day.date })}
          />
        </div>

        <RightRail
          day={day} week={week} canManage={canManage}
          followUps={followUps} followUpsUnavailable={followUpsUnavailable}
          // The title is prefilled with the type's own name so a quick action is ONE interaction plus a
          // confirmation, not a form with an empty required field.
          onQuickAdd={activityType => openAdd({ activityType, title: activityLabel(activityType) })}
        />
      </div>
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
