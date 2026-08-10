"use client";

import { useRouter } from "next/navigation";
import PeriodNavigator, { type PeriodChange } from "@/components/practice/PeriodNavigator";
import { periodToParams, type PeriodRange } from "@/lib/practice/period-range";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// /practice/activity's period control -- an ADAPTER over src/components/practice/PeriodNavigator.
//
// ⚠ THE DEFAULT IS "All dates" AND THAT IS THE POINT OF THE ADOPTION, NOT A HEDGE. This log has never
// had a period on it: it showed the most recent hundred entries and nothing else. Giving it a default of
// "this month" would have hidden every older entry from a clinician who came here to look at their
// portfolio, on the day the control shipped, without a word. So the screen opens exactly as it opened
// yesterday, and the period is something a reader chooses.
//
// ⚠ AND IT FILTERS ON occurred_at -- WHEN THE WORK WAS DONE, not when it was typed up. A ward round
// entered a week late belongs to the morning it happened, which is the only reading of "what happened on
// that day" a portfolio can defend.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function ActivityNavigator({ period, todayDate, timezone, keep }: {
  period: PeriodRange;
  todayDate: string;
  timezone: string;
  /** The content filters that must survive a period change: `mine` and `kind`. */
  keep: Record<string, string | null>;
}) {
  const router = useRouter();

  const toHref = (next: PeriodChange) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) q.set(k, v);
    for (const [k, v] of Object.entries(periodToParams(next))) if (v) q.set(k, v);
    const s = q.toString();
    return `/practice/activity${s ? `?${s}` : ""}`;
  };

  return (
    <PeriodNavigator
      period={period}
      todayDate={todayDate}
      timezone={timezone}
      href={toHref}
      onChange={next => router.push(toHref(next))}
      showRollingPeriods
      showAllDates
      note={
        <>
          Filtered on when the activity <strong>happened</strong>, not on when it was recorded. The
          portfolio figures below move with this period too.
        </>
      }
    />
  );
}
