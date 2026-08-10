"use client";

import { useRouter } from "next/navigation";
import PeriodNavigator, { type PeriodChange } from "@/components/practice/PeriodNavigator";
import { periodToParams, type PeriodRange } from "@/lib/practice/period-range";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-330's reporting window, as an ADAPTER over the shared control. It replaces PeriodPicker.tsx, which
// was two date boxes and four buttons that each wrote `?days=N`.
//
// ⚠ THE DEFAULT DID NOT MOVE, AND `?days=N` STILL MEANS WHAT IT MEANT. reports.ts computes a window of
// `days` INCLUSIVE -- `days=30` is today-29 up to today, thirty calendar days. The page therefore maps
// that legacy parameter to a rolling window of 29 BACK, which is the identical pair of dates, rather
// than to 30 back, which would silently add a day to every bookmarked report in the practice.
//
// ⚠ THE CHIPS ARE THE SHARED ONES AND THEY USE THE SHARED OFFSET. "Last 30 days" here is today-30 up to
// today -- 31 days -- because that is what the same words mean on the encounters register a clinician
// reads every morning, and two chips in one product with the same name and different arithmetic is the
// exact drift period-range.ts exists to end. The control prints the true span and both real dates under
// itself, so neither reading can mislead anybody. Which of the two conventions should win is a decision
// for the practice owner, not one to take by accident in an adapter.
//
// ⚠ NO "All dates". A report is an aggregate OVER A PERIOD -- "4 did not attend, of 37 booked" needs a
// window for the denominator to mean anything -- and this page has never offered an unbounded one.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function ReportsNavigator({ period, todayDate, timezone, basePath = "/practice/reports" }: {
  period: PeriodRange;
  todayDate: string;
  timezone: string;
  /**
   * ⚠ A PARAMETER BECAUSE PeriodPicker HARDCODED `/practice/reports` AND /practice/reports/analytics
   * MOUNTED IT ANYWAY. Changing the period on the Practice-activity page therefore threw you off that
   * page onto the correspondence dashboard, with the period applied to the wrong screen. Two screens,
   * one control, and the control has to know which screen it is on.
   */
  basePath?: string;
}) {
  const router = useRouter();

  const toHref = (next: PeriodChange) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(periodToParams(next))) if (v) q.set(k, v);
    const s = q.toString();
    return `${basePath}${s ? `?${s}` : ""}`;
  };

  return (
    <PeriodNavigator
      period={period}
      todayDate={todayDate}
      timezone={timezone}
      href={toHref}
      onChange={next => router.push(toHref(next))}
      showRollingPeriods
      note={
        <>
          Every count on this page is read over these days, in this practice&rsquo;s calendar rather than
          the server&rsquo;s. Counts and denominators only &mdash; no rates and no targets.
        </>
      }
    />
  );
}
