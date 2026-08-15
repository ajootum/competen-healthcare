"use client";

import { useState, type ReactNode } from "react";
import {
  PERIOD_VIEWS, QUICK_PERIODS, LONG_PERIODS, ROLLING_PERIODS, ALL_DATES_LABEL,
  periodLabel, shiftPeriod, quickPeriodTarget, rollingPeriodTarget, allDatesTarget,
  isPeriodDate, periodSpanDays,
  type PeriodRange, type PeriodView, type QuickPeriodKey, type PeriodAnchoring,
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
  /**
   * ⚠ OPTIONAL, AND ABSENT MEANS `calendar`. Every caller written before rolling existed -- the planner
   * is the only one -- keeps meaning exactly what it meant, and no href builder has to be touched to
   * stay correct.
   */
  anchoring?: PeriodAnchoring;
  /** rolling only: days back from today. See period-range.ts's header on why this is an OFFSET. */
  backDays?: number | null;
};

export default function PeriodNavigator({
  period, todayDate, onChange, href, timezone, trailing, views = PERIOD_VIEWS.map(v => v.key),
  viewLabels, showLongPeriods = true, showRollingPeriods = false, showAllDates = false, note,
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
  /**
   * Optional: what a view is CALLED on this screen. The activity portfolio's comp says "List" where
   * the shared vocabulary says "Agenda" -- same view, same arrows, different word -- and renaming the
   * shared PERIOD_VIEWS entry would rename it on every screen that mounts this control.
   */
  viewLabels?: Partial<Record<PeriodView, string>>;
  showLongPeriods?: boolean;
  /**
   * ⚠ BOTH OFF BY DEFAULT, WHICH IS DELIBERATE AND IS NOT TIMIDITY. The planner mounts this control and
   * has no rolling window and no unbounded state; switching them on for everybody would put two rows of
   * chips on a screen whose behaviour nobody asked to change. A screen that has a rolling default asks
   * for them.
   */
  showRollingPeriods?: boolean;
  showAllDates?: boolean;
  /** Optional: one line under the controls, for a screen that must say what its period does NOT cover. */
  note?: ReactNode;
}) {
  const [goTo, setGoTo] = useState("");
  const [customFrom, setCustomFrom] = useState(period.fromDate);
  const [customTo, setCustomTo] = useState(period.toDate);
  const [customOpen, setCustomOpen] = useState(false);

  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);
  // ⚠ "All dates" CONTAINS TODAY BY DEFINITION. Comparing today against fromDate/toDate on an unbounded
  // period would read the two dates the header is standing on -- which bounded NOTHING -- and light
  // "Today" only for one month of the year.
  const inPeriod = !period.bounded || (todayDate >= period.fromDate && todayDate <= period.toDate);
  const span = periodSpanDays(period);

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
        {/* ⚠ FROM A ROLLING OR UNBOUNDED PERIOD, "Today" MEANS THE DAY. Keeping `period.view` would hand
            back an Agenda -- and from "All dates" that is a whole month, which is not what the word
            says. From a calendar view it keeps the view, which is the planner's long-standing
            behaviour and is not disturbed. */}
        <Control href={href} onChange={onChange}
          to={period.anchoring === "calendar"
            ? { view: period.view, anchorDate: todayDate, from: null, to: null }
            : { view: "day", anchorDate: todayDate, from: null, to: null, anchoring: "calendar" }}
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
                  // Pressing a VIEW is a calendar act. Said outright so a rolling or unbounded period
                  // cannot survive the press and leave the switcher lit over a window it does not describe.
                  anchoring: "calendar",
                }}
                label={viewLabels?.[v.key] ?? v.label} title={v.purpose}
                current={period.anchoring === "calendar" && period.view === v.key}
                className={`rounded-md px-2.5 py-1 text-[12px] font-semibold ${period.anchoring === "calendar" && period.view === v.key
                  ? "bg-[var(--cp-primary)] text-white"
                  : "text-gray-600 hover:bg-gray-100"}`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
        {QUICK_PERIODS.map(q => q.key === "custom" ? (
          // ⚠ SOLID BORDER, LIKE ITS NEIGHBOURS. On 2026-08-15 the practice owner stood on this
          // control and asked for a from-one-date-to-another feature -- the dashed border this chip
          // wore for months is the estate's vocabulary for NOT BUILT (the AI tile, the competency
          // tile), so the one chip that opens something read as the one chip that does nothing. The
          // ellipsis is the affordance: this button opens fields where its neighbours ARE periods --
          // appended at render, because the s3 label list is data a harness proves verbatim.
          <button key={q.key} type="button" onClick={() => setCustomOpen(o => !o)}
            aria-expanded={customOpen}
            className={`${chip} ${customOpen
              ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]" : ""}`}>
            {q.label}&hellip;
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

        {/* ── THE ROLLING WINDOWS. A DIFFERENT KIND OF PERIOD, DRAWN DIFFERENTLY ON PURPOSE. ─────────
            "Last 30 days" and "This month" are not two spellings of one thing, and a reader who cannot
            see which sort they pressed is one press away from believing a three-day register is empty.
            The lit chip is the ROLLING one only when the period actually is rolling. */}
        {showRollingPeriods && ROLLING_PERIODS.map(r => (
          <Control href={href} onChange={onChange} key={r.key}
            to={{ ...rollingPeriodTarget(r.backDays, todayDate) }}
            label={r.label}
            title={`From ${r.backDays} days back up to today, and it moves with today.`}
            current={period.anchoring === "rolling" && period.backDays === r.backDays}
            className={`${chip} ${period.anchoring === "rolling" && period.backDays === r.backDays
              ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]" : ""}`}
          />
        ))}

        {showAllDates && (
          <Control href={href} onChange={onChange}
            to={{ ...allDatesTarget(period.anchorDate) }}
            label={ALL_DATES_LABEL}
            title="No date filter at all. This is what this screen shows when nobody has chosen a period."
            current={!period.bounded}
            className={`${chip} ${!period.bounded
              ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]" : ""}`}
          />
        )}

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

      {/* ⚠ THE TRUE SPAN, SAID OUT LOUD, FOR A ROLLING WINDOW ONLY. "Last 30 days" is today-30 up to
          today, which is 31 days -- see period-range.ts's header on why the arithmetic is preserved
          rather than corrected. A label that names 30 beside a window of 31 is only honest if the screen
          is willing to print the 31. */}
      {(period.anchoring === "rolling" || note) && (
        <p className="mt-2 text-[11px] text-gray-500">
          {period.anchoring === "rolling" && span !== null && (
            <span>{span} {span === 1 ? "day" : "days"}, today included, from {period.fromDate} to {period.toDate}. It moves with today. </span>
          )}
          {note}
        </p>
      )}

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
