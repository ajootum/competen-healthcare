"use client";

import { useState, type ReactNode } from "react";
import {
  PERIOD_VIEWS, QUICK_PERIODS, LONG_PERIODS, periodLabel, shiftPeriod, quickPeriodTarget,
  isPeriodDate, type PeriodRange, type PeriodView, type QuickPeriodKey,
} from "@/lib/practice/period-range";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// THE PERIOD NAVIGATOR -- "which days am I looking at", as a control ANY screen can mount.
//
// ⚠ IT IS NOT THE PLANNER'S, AND THAT IS WHY IT LIVES IN src/components/practice RATHER THAN IN THE
// CALENDAR ROUTE. The practice owner asked for it "on all screens where there is a possibility of
// reviewing the data to see what happened at a particular time" -- Encounters, Patients, Follow-ups,
// Documents and Reports are the obvious next ones. A control welded into one page is a control the
// second page reimplements slightly differently, and then "last week" means two things.
//
// ---- HOW A SECOND SCREEN ADOPTS IT -----------------------------------------------------------------
//
// It is PRESENTATIONAL. It holds no route, builds no URL and fetches nothing:
//
//   period      where you are now, from resolvePeriod() on the server or in the caller
//   todayDate   THE PRACTICE'S today, never the browser's -- see quickPeriodTarget
//   onChange    called with {view, anchorDate, from, to}; the caller decides whether that is a router
//               push, a query-string change or local state
//   href        OPTIONAL. When given, every control renders as a LINK to href(next) instead of a
//               button, so a server-rendered screen keeps working without JavaScript and every period
//               is bookmarkable. The planner passes this; a screen with client-side state need not.
//
// ⚠ IT IMPORTS ONLY period-range.ts, WHICH IMPORTS NOTHING. A control that reached a server engine for
// one constant would drag `next/headers` into the bundle of every screen that mounted it, and
// scripts/practice-bundle-harness.ts exists because that has already cost this product 120 kB on four
// clinical screens.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type PeriodChange = {
  view: PeriodView;
  anchorDate: string;
  from: string | null;
  to: string | null;
};

export default function PeriodNavigator({
  period, todayDate, onChange, href, timezone, trailing, views = PERIOD_VIEWS.map(v => v.key),
  showLongPeriods = true,
}: {
  period: PeriodRange;
  todayDate: string;
  onChange: (next: PeriodChange) => void;
  /** Optional: render every control as a link. A screen without one still works through onChange. */
  href?: (next: PeriodChange) => string;
  /** Optional: the timezone every date on the screen is in, shown as a chip. */
  timezone?: string;
  /** Optional: anything the host screen wants on the same row -- a view switcher's neighbour, a button. */
  trailing?: ReactNode;
  /** Optional: a screen with no month grid can offer fewer views. Defaults to all four. */
  views?: readonly PeriodView[];
  showLongPeriods?: boolean;
}) {
  const [goTo, setGoTo] = useState("");
  const [customFrom, setCustomFrom] = useState(period.fromDate);
  const [customTo, setCustomTo] = useState(period.toDate);
  const [customOpen, setCustomOpen] = useState(false);

  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);
  const inPeriod = todayDate >= period.fromDate && todayDate <= period.toDate;

  const plain = "rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50";
  const chip = "rounded-lg border border-gray-200 px-2.5 py-1 text-[12px] font-semibold text-gray-600 hover:border-[var(--cp-primary)] hover:text-[var(--cp-primary-deep)]";

  const quick = (key: QuickPeriodKey): PeriodChange => {
    const t = quickPeriodTarget(key, todayDate);
    return { view: t.view, anchorDate: t.anchorDate, from: t.from, to: t.to };
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* ── TODAY. The PRACTICE's today, which is not the browser's for three hours every morning. ── */}
        <Control href={href} onChange={onChange}
          to={{ view: period.view, anchorDate: todayDate, from: null, to: null }}
          label="Today"
          className={`rounded-lg border px-3 py-1.5 text-[13px] font-semibold ${inPeriod
            ? "border-[var(--cp-primary-border)] bg-[var(--cp-primary)]/5 text-[var(--cp-primary-deep)]"
            : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
        />

        {/* ── PREVIOUS / NEXT, by the unit of the ACTIVE view. ─────────────────────────────────── */}
        <div className="flex items-center gap-1">
          <Control href={href} onChange={onChange} to={{ view: period.view, ...prev }} label="‹"
            aria={`Previous ${unitWord(period.view)}`} className={plain} />
          <Control href={href} onChange={onChange} to={{ view: period.view, ...next }} label="›"
            aria={`Next ${unitWord(period.view)}`} className={plain} />
        </div>

        <h2 className="px-1 text-[15px] font-bold text-gray-900" aria-live="polite">
          {periodLabel(period)}
        </h2>
        {timezone && (
          <span className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-semibold text-gray-600">
            {timezone}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {trailing}
          <div className="flex items-center rounded-lg border border-gray-200 p-0.5" role="group"
            aria-label="Period view">
            {PERIOD_VIEWS.filter(v => views.includes(v.key)).map(v => (
              <Control href={href} onChange={onChange} key={v.key}
                to={{
                  view: v.key,
                  // The day being looked at survives the switch: Month to Day opens the day you were on.
                  anchorDate: period.anchorDate,
                  from: v.key === "agenda" ? period.fromDate : null,
                  to: v.key === "agenda" ? period.toDate : null,
                }}
                label={v.label} title={v.purpose} current={period.view === v.key}
                className={`rounded-md px-2.5 py-1 text-[12px] font-semibold ${period.view === v.key
                  ? "bg-[var(--cp-primary)] text-white"
                  : "text-gray-600 hover:bg-gray-100"}`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
        {QUICK_PERIODS.map(q => q.key === "custom" ? (
          <button key={q.key} type="button" onClick={() => setCustomOpen(o => !o)}
            aria-expanded={customOpen}
            className="rounded-lg border border-dashed border-gray-300 px-2.5 py-1 text-[12px] font-semibold text-gray-600 hover:border-[var(--cp-primary)] hover:text-[var(--cp-primary-deep)]">
            {q.label}
          </button>
        ) : (
          <Control href={href} onChange={onChange} key={q.key} to={quick(q.key)} label={q.label} className={chip} />
        ))}

        {/* The longer periods the practice owner asked for -- "any day of the week or month OR YEAR".
            A separate list because s3 names six and only six, and a list that quietly grows is as much
            a drift as one that quietly shrinks. */}
        {showLongPeriods && LONG_PERIODS.map(q => (
          <Control href={href} onChange={onChange} key={q.key} to={quick(q.key)} label={q.label} className={chip} />
        ))}

        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-gray-600">
          <span className="font-semibold">Go to date</span>
          <input
            type="date" value={goTo}
            onChange={e => {
              const v = e.target.value;
              setGoTo(v);
              // The chosen view is RETAINED where practical. Day, Week and Month all contain a date;
              // Agenda is a range with no single day to jump to, so it opens that date's Day view
              // rather than silently sliding the range's start.
              if (isPeriodDate(v))
                onChange(period.view === "agenda"
                  ? { view: "day", anchorDate: v, from: null, to: null }
                  : { view: period.view, anchorDate: v, from: null, to: null });
            }}
            className="rounded-lg border border-gray-200 px-2 py-1 text-[12px] text-gray-800"
          />
        </label>
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
            onClick={() => onChange({ view: "agenda", anchorDate: customFrom, from: customFrom, to: customTo })}
            className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
            Show this period
          </button>
          <p className="text-[11px] text-gray-500">
            {isPeriodDate(customFrom) && isPeriodDate(customTo) && customTo >= customFrom
              ? "Shown as a chronological list."
              : "A period needs a start and an end that is not before it."}
          </p>
        </div>
      )}
    </section>
  );
}

type ControlProps = {
  to: PeriodChange;
  label: ReactNode;
  aria?: string;
  title?: string;
  current?: boolean;
  className: string;
  href?: (next: PeriodChange) => string;
  onChange: (next: PeriodChange) => void;
};

/**
 * One control, two renderings: a LINK when the host screen gave us an href, a BUTTON otherwise.
 *
 * ⚠ THE `to` VALUE IS THE SAME IN BOTH BRANCHES, which is the point. A screen that built its links one
 * way and its click handlers another would eventually navigate somewhere the link did not point.
 */
function Control({ to, label, aria, title, current, className, href, onChange }: ControlProps) {
  if (href)
    return (
      <a href={href(to)} aria-label={aria} title={title}
        aria-current={current ? "page" : undefined} className={className}>{label}</a>
    );
  return (
    <button type="button" onClick={() => onChange(to)} aria-label={aria} title={title}
      aria-pressed={current} className={className}>{label}</button>
  );
}

/** The word for what the arrows move by, taken from the view rather than assumed. */
function unitWord(view: string): string {
  return PERIOD_VIEWS.find(v => v.key === view)?.unit ?? "period";
}
