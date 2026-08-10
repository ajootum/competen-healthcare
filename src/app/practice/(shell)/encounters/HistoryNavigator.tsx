"use client";

import { useRouter } from "next/navigation";
import PeriodNavigator, { type PeriodChange } from "@/components/practice/PeriodNavigator";
import { periodToParams, type PeriodRange } from "@/lib/practice/period-range";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-ENC-LANDING-001 s4.7 -- THE ENCOUNTER HISTORY'S PERIOD CONTROL, which is now an ADAPTER.
//
// The control is src/components/practice/PeriodNavigator.tsx and the arithmetic is period-range.ts.
// What is encounters-specific is only what a change MEANS here: a URL on /practice/encounters that
// carries the tab, the session filter, the search and the state filter along with it, and that resets
// the page number -- because page 4 of a thirty-day register is not page 4 of a one-day one.
//
// ⚠ THE ROLLING CHIPS ARE ON AND THAT IS THE WHOLE POINT OF THIS SCREEN'S ADOPTION. s4.7 asks for
// Today / 7 days / 30 days, and those are ROLLING windows measured from the practice's today. The
// calendar chips ("This month") sit beside them and are a DIFFERENT question. Both are offered; neither
// replaced the other. A build that had swapped them would show three days of records on 3 August to a
// practitioner who pressed the thing that used to say "30 days".
//
// ⚠ AND "All dates" IS OFFERED because this register has always had that state -- s4.7's Custom with
// both boxes empty put no bound on the query at all. It is now a chip with a name instead of an
// accident of two empty inputs.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function HistoryNavigator({ period, todayDate, timezone, keep }: {
  period: PeriodRange;
  todayDate: string;
  timezone: string;
  /** The content filters that must survive a period change: tab, session, q, hstate. */
  keep: Record<string, string | null>;
}) {
  const router = useRouter();

  const toHref = (next: PeriodChange) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) q.set(k, v);
    for (const [k, v] of Object.entries(periodToParams(next))) if (v) q.set(k, v);
    // ⚠ THE PAGE NUMBER IS DROPPED, NOT CARRIED. Landing on page 4 of a register that now holds one
    // page shows an empty table, and an empty table under a filter reads as "nothing happened".
    const s = q.toString();
    return `/practice/encounters${s ? `?${s}` : ""}#history`;
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
          Filtered on when the consultation <strong>started</strong>. A rolling window moves with this
          practice&rsquo;s today; a calendar one does not.
        </>
      }
    />
  );
}
