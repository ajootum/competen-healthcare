"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PLANNER_SHOW_OPTIONS, APPOINTMENT_TYPE_LABEL, APPOINTMENT_STATUS_LABEL,
  plannerFiltersActive, type PlannerFilters as Filters,
} from "@/lib/practice/planner-constants";
import { ACTIVITY_TYPES, ACTIVITY_LABEL, type ActivityType } from "@/lib/practice/activity-constants";
import { plannerHref, hhmm, shortDate, type LocationOption, type PlannerUrlState } from "./planner-ui";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CP-PLAN-002 s4 -- CONTENT CONTROLS AND SCHEDULE SEARCH.
//
// ⚠ SEPARATE FROM THE RANGE CONTROLS, WHICH s2 FREEZES: "Time range and content filters are separate
// controls." Nothing in this component changes which days are read, and nothing in the navigator changes
// what is drawn on them. That is why they are two components and two rows -- a practitioner who ticks
// "Walk-ins" must not find themselves in a different fortnight.
//
// ⚠ AND s4's OPENING SENTENCE IS THE POINT OF THE WHOLE ROW: "The user must be able to decide what
// appears WITHOUT CHANGING THE UNDERLYING PRACTITIONER PROGRAM." Hiding a session here hides it from this
// screen. It does not suspend it, does not delete it and does not touch the template -- that is
// editSession() in Practice Setup and it is a separate, deliberate act.
//
// THE SEARCH IS NOT A FILTER, and they sit apart for that reason. The filter narrows the period on
// screen; the search reads the WHOLE DIARY and hands back a date to go to, because s4 requires that
// finding a known booking never means paging through weeks.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type SearchHit = {
  kind: string; id: string; title: string; subtitle: string | null;
  date: string; startMinute: number; endMinute: number;
  locationName: string | null; sessionLabel: string | null;
  statusLabel: string; href: string | null; goToDate: string; past: boolean;
};

export default function PlannerFilters({
  filters, urlState, locations, search, searchUnavailable, searchTruncated,
}: {
  filters: Filters;
  urlState: PlannerUrlState;
  locations: LocationOption[];
  /** Null when nothing was searched for. An EMPTY ARRAY means searched and found nothing. */
  search: { query: string; hits: SearchHit[] } | null;
  searchUnavailable: string | null;
  searchTruncated: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState(filters.query);
  // CPR-PLAN-002 s3 (2026-08-16): on constrained widths the filter row folds behind ONE control that
  // carries the ACTIVE-FILTER COUNT -- so a phone screen is not five select boxes tall, and a hidden
  // filter can never be a silent one: the number on the button says something is narrowing the view.
  // Desktop keeps the full row exactly as CPR-PLN-002 left it.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeCount = [
    filters.show !== "all", !!filters.locationId, !!filters.activityType,
    !!filters.appointmentType, !!filters.status, filters.query.trim().length > 0,
  ].filter(Boolean).length;

  const at = (s: PlannerUrlState) => plannerHref({ ...urlState, ...s });
  const go = (s: PlannerUrlState) => router.push(at(s));

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-3">
      <button type="button" onClick={() => setFiltersOpen(o => !o)}
        aria-expanded={filtersOpen}
        className={`rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold md:hidden ${activeCount > 0
          ? "border-[var(--cp-primary-border)] bg-[var(--cp-primary)]/5 text-[var(--cp-primary-deep)]"
          : "border-gray-200 text-gray-700"}`}>
        Filters ({activeCount}) {filtersOpen ? "⌃" : "⌄"}
      </button>
      <div className={`${filtersOpen ? "mt-2 flex" : "hidden md:flex"} flex-wrap items-end gap-2`}>
        <Select label="Show" value={filters.show} onChange={v => go({ show: v })}
          options={PLANNER_SHOW_OPTIONS.map(o => [o.key, o.label])} />

        <Select label="Location" value={filters.locationId ?? ""} onChange={v => go({ location: v })}
          options={[["", "All locations"],
            ...locations.map(l => [l.id, l.facility ? `${l.name} (${l.facility})` : l.name] as [string, string])]} />

        <Select label="Activity type" value={filters.activityType ?? ""}
          onChange={v => go({ activityType: v })}
          options={[["", "All activities"],
            ...ACTIVITY_TYPES.map(t => [t, ACTIVITY_LABEL[t as ActivityType] ?? t] as [string, string])]} />

        <Select label="Appointment type" value={filters.appointmentType ?? ""}
          onChange={v => go({ appointmentType: v })}
          options={[["", "All types"],
            ...Object.entries(APPOINTMENT_TYPE_LABEL)]} />

        <Select label="Status" value={filters.status ?? ""} onChange={v => go({ status: v })}
          options={[["", "Any status"], ...Object.entries(APPOINTMENT_STATUS_LABEL)]} />

        {/* ── SEARCH THE SCHEDULE ───────────────────────────────────────────────────────────────── */}
        <form className="ml-auto flex items-end gap-1.5"
          onSubmit={e => { e.preventDefault(); go({ q }); }}>
          <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-gray-600">
            Search schedule
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder="Patient, location or activity"
              className="w-[220px] rounded-lg border border-gray-200 px-2 py-1 text-[12px] text-gray-800" />
          </label>
          <button type="submit"
            className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white">
            Search
          </button>
        </form>
      </div>

      {plannerFiltersActive(filters) && (
        <p className="mt-2 border-t border-gray-100 pt-2 text-[12px] text-gray-500">
          Some of what is on these days is hidden by the controls above. Your program is unchanged.{" "}
          <Link scroll={false}
            href={plannerHref({
              view: urlState.view, date: urlState.date, from: urlState.from, to: urlState.to,
              sel: urlState.sel,
            })}
            className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
            Clear filters and search
          </Link>
        </p>
      )}

      {/* ── RESULTS. s4: date, time, location, session, and a direct Go to date. ─────────────────── */}
      {searchUnavailable ? (
        <p role="alert" className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-800">
          {searchUnavailable}
        </p>
      ) : search && (
        <div className="mt-2 rounded-xl border border-gray-200">
          <p className="border-b border-gray-100 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500">
            {search.hits.length === 0
              ? `Nothing in the schedule matches "${search.query}"`
              : `${search.hits.length} match${search.hits.length === 1 ? "" : "es"} for "${search.query}"`}
            {searchTruncated ? " -- and there are more" : ""}
          </p>
          {search.hits.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-gray-500">
              This searched every date, past and future -- not only the period on screen. Try fewer
              letters, or check the spelling of the name as it was booked.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {search.hits.map(h => (
                <li key={`${h.kind}-${h.id}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                  <span className="text-[13px] font-semibold text-gray-900">{h.title}</span>
                  <span className="text-[11px] text-gray-500">{h.subtitle}</span>
                  <span className="text-[12px] tabular-nums text-gray-700">
                    {shortDate(h.date)} {hhmm(h.startMinute)}-{hhmm(h.endMinute)}
                  </span>
                  <span className="text-[12px] text-gray-600">{h.locationName ?? "no location"}</span>
                  {h.sessionLabel && <span className="text-[11px] text-gray-500">{h.sessionLabel}</span>}
                  <span className="text-[11px] font-semibold text-gray-500">{h.statusLabel}</span>
                  {h.past && <span className="text-[11px] text-gray-400">past</span>}
                  <span className="ml-auto flex items-center gap-2">
                    <Link scroll={false}
                      href={plannerHref({ ...urlState, view: "day", date: h.goToDate, from: null, to: null })}
                      className="rounded-lg border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">
                      Go to date
                    </Link>
                    {h.href ? (
                      <Link href={h.href}
                        className="rounded-lg border border-[var(--cp-primary-border)] px-2 py-0.5 text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:bg-[var(--cp-primary)]/5">
                        View patient
                      </Link>
                    ) : h.kind === "appointment" && (
                      // A booking made as a name with no record has nothing to open, and a button that
                      // 404s is worse than a sentence that says why there is none.
                      <span className="text-[11px] text-gray-400">booked by name only</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-gray-600">
      {label}
      <select value={value} onChange={e => onChange(e.target.value)}
        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[12px] font-normal text-gray-800">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
