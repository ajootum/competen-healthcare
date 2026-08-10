"use client";

import { useRouter } from "next/navigation";
import PeriodNavigator, { type PeriodChange } from "@/components/practice/PeriodNavigator";
import { periodToParams, type PeriodRange } from "@/lib/practice/period-range";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-DOC-002's period control -- an ADAPTER over the shared one.
//
// ⚠ EACH OF THE THREE SOURCES HAS ITS OWN DATE AND THEY ARE NOT THE SAME COLUMN. An authored document
// is dated when it was SIGNED, falling back to when it was created; an arrival is dated when it was
// RECEIVED, falling back to when it was entered; an uploaded file is dated when it was uploaded. That is
// the `at` the register already sorts by and the period filters on exactly it -- so "documents in July"
// means the same thing for all three, which no per-source date filter would have.
//
// ⚠ THE DEFAULT IS "All dates". This page is an operational dashboard -- "what needs me" -- before it is
// a register. A default period would have emptied the awaiting-review queue on the day this shipped, and
// an unreviewed result nobody looked at is the specific harm this workspace exists to prevent.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function DocumentsNavigator({ period, todayDate, timezone }: {
  period: PeriodRange;
  todayDate: string;
  timezone: string;
}) {
  const router = useRouter();

  const toHref = (next: PeriodChange) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(periodToParams(next))) if (v) q.set(k, v);
    const s = q.toString();
    return `/practice/documents${s ? `?${s}` : ""}`;
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
            Every card and every queue below is narrowed to this period. Work that arrived outside it is
            not counted here, however long it has been waiting.
          </strong>
        ) : (
          <>
            Dated on when each document was signed, received or uploaded &mdash; whichever applies to it.
          </>
        )
      }
    />
  );
}
