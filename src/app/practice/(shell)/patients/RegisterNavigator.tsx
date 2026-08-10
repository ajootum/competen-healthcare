"use client";

import { useRouter } from "next/navigation";
import PeriodNavigator, { type PeriodChange } from "@/components/practice/PeriodNavigator";
import { periodToParams, type PeriodRange } from "@/lib/practice/period-range";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE PATIENT REGISTER'S PERIOD -- AND IT ANSWERS ONE QUESTION ONLY, WHICH IS WHY IT SAYS SO.
//
// ⚠ A PATIENT IS NOT AN EVENT. The only date a patient record owns is when it was created. It does not
// know when the person was last seen (that is an encounter), when they are next due (that is a
// follow-up), or when they were booked (that is an appointment). So this control can honestly narrow
// the register to WHO WAS REGISTERED in a period, and it can honestly do nothing else -- and the caption
// says that outright, because "Patients: 3" under a date range reads as "we saw three people that week"
// to anybody who has not thought about it.
//
// ⚠ IT NARROWS THE REGISTER AND NOT THE WORKLIST TILES ABOVE IT. Who is waiting, who is overdue, whose
// results have come back -- those are questions about NOW, and a period filter over them would empty a
// waiting room because nobody in it was registered last March.
//
// ⚠ AND THE DEFAULT IS "All dates". This screen's first job is finding a person. Hiding people by
// default because of when their record happens to have been created would break the search that a busy
// desk depends on.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function RegisterNavigator({ period, todayDate, timezone, keep }: {
  period: PeriodRange;
  todayDate: string;
  timezone: string;
  /** list / patient / q / scope / sort -- everything the register's own URL already carries. */
  keep: Record<string, string | null>;
}) {
  const router = useRouter();

  const toHref = (next: PeriodChange) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) q.set(k, v);
    for (const [k, v] of Object.entries(periodToParams(next))) if (v) q.set(k, v);
    // The page number is dropped: page 4 of a narrowed register is an empty table, which reads as
    // "nobody is on the register".
    const s = q.toString();
    return `/practice/patients${s ? `?${s}` : ""}`;
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
            The register below shows only patients <em>registered</em> in this period. It is not who was
            seen, or who was booked &mdash; those live on Encounters and the Planner. The lists above are
            not narrowed.
          </strong>
        ) : (
          <>
            Narrows the register by <strong>registration date</strong> only &mdash; the one date a patient
            record owns. Who was seen is on Encounters; who was booked is on the Planner.
          </>
        )
      }
    />
  );
}
