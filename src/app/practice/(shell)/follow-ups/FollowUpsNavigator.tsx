"use client";

import { useRouter } from "next/navigation";
import PeriodNavigator, { type PeriodChange } from "@/components/practice/PeriodNavigator";
import { periodToParams, type PeriodRange } from "@/lib/practice/period-range";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-FUP-001's period control -- an ADAPTER over the shared one.
//
// ⚠ IT FILTERS ON due_on, THE ONLY DATE A FOLLOW-UP OWNS. Not created_at ("when somebody typed it") and
// not closed_at (which most rows do not have). "What was owed that week" is the question this queue can
// answer honestly.
//
// ⚠ AND THE DEFAULT IS "All dates", WHICH IS THIS BOARD'S EXISTING BEHAVIOUR AND MUST STAY IT. This is a
// work queue before it is a review screen. A default period would hide overdue people from the one board
// in the product whose whole purpose is to say who has been forgotten -- and the older the neglect, the
// further outside any recent window it falls, so the default would hide the worst cases first.
//
// ⚠ A NARROWED BOARD SAYS SO. Every card, every tab and every count is computed from the same narrowed
// read, so the figures stay the lengths of the lists they open; but a narrowed board that looked like
// the whole board is how somebody goes home believing nobody is waiting.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function FollowUpsNavigator({ period, todayDate, timezone, keep }: {
  period: PeriodRange;
  todayDate: string;
  timezone: string;
  /** view / q / priority / source -- the content filters a period change must not silently drop. */
  keep: Record<string, string | null>;
}) {
  const router = useRouter();

  const toHref = (next: PeriodChange) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) q.set(k, v);
    for (const [k, v] of Object.entries(periodToParams(next))) if (v) q.set(k, v);
    const s = q.toString();
    return `/practice/follow-ups${s ? `?${s}` : ""}`;
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
        period.bounded ? (
          <strong>
            Narrowed to follow-ups due in this period. This is not the whole queue, and an obligation due
            outside it is not shown here however overdue it is.
          </strong>
        ) : (
          <>Every obligation this queue holds, whatever its due date. Choose a period to review one.</>
        )
      }
    />
  );
}
