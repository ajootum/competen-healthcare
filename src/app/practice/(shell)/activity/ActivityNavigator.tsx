"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  periodToParams, resolveTarget, quickPeriodTarget, rollingPeriodTarget, allDatesTarget,
  shiftPeriod, isPeriodDate, type PeriodRange, type PeriodView,
} from "@/lib/practice/period-range";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// /practice/activity's period control -- CPR-PCA-HFE-012 s6, built to s6's OWN architecture.
//
// ⚠ THIS PAGE DELIBERATELY DOES NOT MOUNT PeriodNavigator ANY MORE. s6 orders the expanded chip
// collection REPLACED with progressive disclosure: one Period MENU (Today, This week, This month,
// Last month, Last 90 days, This year, All dates, Custom), previous/next arrows, a List/Month view
// toggle, and the resolved range printed on the right. The owner asked for a from-one-date-to-another
// option WHILE STANDING ON THE OLD CONTROL -- the custom range existed behind a chip whose dashed
// border is this product's vocabulary for "not built". Reachable is not discoverable; the menu names
// it Custom dates and it opens two labelled fields.
//
// ⚠ THE DEFAULT IS STILL "All dates". This log never had a period; a this-month default would have
// hidden every older entry from a clinician's portfolio the day it shipped. The menu simply makes the
// active choice legible.
//
// ⚠ THE MENU CHOOSES THE RANGE; THE TOGGLE CHOOSES THE RENDERING. Picking "This week" while in Month
// view falls back to List, because a week drawn as a month grid would be a calendar around days the
// period does not contain. Only a calendar month may render as one.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const MENU: { key: string; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "this_week", label: "This week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "90d", label: "Last 90 days" },
  { key: "this_year", label: "This year" },
  { key: "all", label: "All dates" },
  { key: "custom", label: "Custom dates" },
];

type Target = {
  view: PeriodView; anchorDate: string; from: string | null; to: string | null;
  anchoring?: "calendar" | "rolling" | "all"; backDays?: number | null;
};

export default function ActivityNavigator({ period, todayDate, timezone, keep }: {
  period: PeriodRange;
  todayDate: string;
  timezone: string;
  /** The content filters that must survive a period change: `mine` and `kind`. */
  keep: Record<string, string | null>;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(period.bounded ? period.fromDate : todayDate);
  const [customTo, setCustomTo] = useState(period.bounded ? period.toDate : todayDate);

  const toHref = (next: Target) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) q.set(k, v);
    for (const [k, v] of Object.entries(periodToParams({
      view: next.view, anchorDate: next.anchorDate, from: next.from, to: next.to,
      anchoring: next.anchoring ?? "calendar", backDays: next.backDays ?? null,
    }))) if (v) q.set(k, v);
    const s = q.toString();
    return `/practice/activity${s ? `?${s}` : ""}`;
  };
  const go = (next: Target) => { setMenuOpen(false); setCustomOpen(false); router.push(toHref(next)); };

  // The month grid survives a range change ONLY into another calendar month.
  const viewFor = (rangeIsMonth: boolean): PeriodView =>
    period.view === "month" && rangeIsMonth ? "month" : "agenda";

  const targetOf = (key: string): Target => {
    if (key === "all") return { ...allDatesTarget(period.anchorDate) } as Target;
    if (key === "90d") return { ...rollingPeriodTarget(90, todayDate) } as Target;
    if (key === "today") return { view: "agenda", anchorDate: todayDate, from: todayDate, to: todayDate };
    const t = quickPeriodTarget(key as never, todayDate);
    const r = resolveTarget({ view: t.view, anchorDate: t.anchorDate, from: t.from, to: t.to, anchoring: "calendar", backDays: null }, todayDate);
    const isMonth = key === "this_month" || key === "last_month";
    return isMonth
      ? { view: viewFor(true), anchorDate: r.fromDate, from: null, to: null }
      : { view: "agenda", anchorDate: r.fromDate, from: r.fromDate, to: r.toDate };
  };

  // What the closed menu SAYS. Each entry is matched by resolving it in its own NATURAL view -- a
  // month target resolved as an agenda would be ambiguous -- so the word on the button and the range
  // on the right cannot drift apart. Anything unmatched is honestly "Custom".
  const canonicalRange = (key: string): { fromDate: string; toDate: string } => {
    if (key === "today") return { fromDate: todayDate, toDate: todayDate };
    const t = quickPeriodTarget(key as never, todayDate);
    return resolveTarget({ view: t.view, anchorDate: t.anchorDate, from: t.from, to: t.to, anchoring: "calendar", backDays: null }, todayDate);
  };
  const activeLabel = (() => {
    if (!period.bounded) return "All dates";
    if (period.anchoring === "rolling") return period.backDays === 90 ? "Last 90 days" : `Last ${period.backDays} days`;
    for (const m of MENU) {
      if (m.key === "all" || m.key === "90d" || m.key === "custom") continue;
      const r = canonicalRange(m.key);
      if (r.fromDate === period.fromDate && r.toDate === period.toDate) return m.label;
    }
    return "Custom";
  })();

  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);
  const seg = (active: boolean) =>
    `rounded-md px-3 py-1 text-[12px] font-semibold ${active
      ? "bg-[var(--cp-primary)] text-white"
      : "text-gray-600 hover:bg-gray-100"}`;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-gray-500">Period</span>

        {/* ── s6's ONE MENU, where the old two rows of chips were ─────────────────────────────── */}
        <div className="relative">
          <button type="button" onClick={() => setMenuOpen(o => !o)} aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-gray-800 hover:bg-gray-50">
            {activeLabel} <span aria-hidden="true" className="text-gray-400">&#9662;</span>
          </button>
          {menuOpen && (
            <div role="menu" className="absolute left-0 top-full z-20 mt-1 w-44 rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
              {MENU.map(m => m.key === "custom" ? (
                <button key={m.key} type="button" role="menuitem"
                  onClick={() => { setMenuOpen(false); setCustomOpen(o => !o); }}
                  className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50">
                  {m.label}&hellip;
                </button>
              ) : (
                <button key={m.key} type="button" role="menuitem" onClick={() => go(targetOf(m.key))}
                  className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] font-semibold hover:bg-gray-50 ${
                    m.label === activeLabel ? "text-[var(--cp-primary-deep)]" : "text-gray-700"}`}>
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button type="button" onClick={() => go({ view: period.view, ...prev } as Target)}
            aria-label="Previous period"
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50">
            &#8249;
          </button>
          <button type="button" onClick={() => go({ view: period.view, ...next } as Target)}
            aria-label="Next period"
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50">
            &#8250;
          </button>
        </div>

        <span className="ml-2 text-[12px] font-semibold text-gray-500">View</span>
        <div className="flex items-center rounded-lg border border-gray-200 p-0.5" role="group" aria-label="Record view">
          {/* s20: Month earned its button the day the grid became real; List is the agenda view under
              the comp's own name. Day and Week are ranges in the menu, not views of a record. */}
          <button type="button" className={seg(period.view !== "month")}
            aria-pressed={period.view !== "month"}
            onClick={() => go({
              view: "agenda", anchorDate: period.anchorDate,
              from: period.bounded ? period.fromDate : null, to: period.bounded ? period.toDate : null,
              anchoring: period.bounded ? "calendar" : "all",
            })}>
            List
          </button>
          <button type="button" className={seg(period.view === "month")}
            aria-pressed={period.view === "month"}
            onClick={() => go({
              view: "month",
              anchorDate: period.bounded && period.anchoring === "calendar" ? period.anchorDate : todayDate,
              from: null, to: null,
            })}>
            Month
          </button>
        </div>

        {/* ── s6: the RESOLVED range, on the right, so the menu's word is checkable at a glance ── */}
        <span className="ml-auto flex items-center gap-2">
          <span className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-semibold text-gray-600">
            {timezone}
          </span>
          <span className="text-[13px] font-semibold text-gray-800" aria-live="polite">
            {period.bounded ? `${period.fromDate} – ${period.toDate}` : "All dates"}
          </span>
        </span>
      </div>

      {customOpen && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-gray-50 p-2">
          <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-gray-600">
            From
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[12px] text-gray-800" />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-gray-600">
            To
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[12px] text-gray-800" />
          </label>
          <button type="button"
            disabled={!isPeriodDate(customFrom) || !isPeriodDate(customTo) || customTo < customFrom}
            onClick={() => go({ view: "agenda", anchorDate: customFrom, from: customFrom, to: customTo })}
            className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
            Apply
          </button>
          {isPeriodDate(customFrom) && isPeriodDate(customTo) && customTo < customFrom && (
            <span className="text-[11px] text-[var(--cmp-text-warning)]">The end is before the start.</span>
          )}
        </div>
      )}

      <p className="mt-2 text-[11px] text-gray-500">
        Filtered on when the activity <strong>happened</strong>, not on when it was recorded. The
        portfolio figures below move with this period too.
      </p>
    </section>
  );
}
