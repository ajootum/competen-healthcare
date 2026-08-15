"use client";

import { useRouter } from "next/navigation";
import PeriodNavigator, { type PeriodChange } from "@/components/practice/PeriodNavigator";
import { periodToParams, type PeriodRange } from "@/lib/practice/period-range";

// /practice/payments' period control -- an ADAPTER over the shared PeriodNavigator, the same shape
// every other adopted screen uses (the activity page's s6 menu is the one named exception, and the
// period harness holds it to a stricter rule). Money filters on when the charge or payment HAPPENED.

export default function PaymentsNavigator({ period, todayDate, timezone, keep }: {
  period: PeriodRange;
  todayDate: string;
  timezone: string;
  /** Content state that must survive a period change: tab, patient filter, encounter context. */
  keep: Record<string, string | null>;
}) {
  const router = useRouter();
  const toHref = (next: PeriodChange) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) q.set(k, v);
    for (const [k, v] of Object.entries(periodToParams(next))) if (v) q.set(k, v);
    const s = q.toString();
    return `/practice/payments${s ? `?${s}` : ""}`;
  };
  return (
    <PeriodNavigator
      period={period}
      todayDate={todayDate}
      timezone={timezone}
      href={toHref}
      onChange={next => router.push(toHref(next))}
      views={["agenda"]}
      showRollingPeriods
      showAllDates
      note={<>Filtered on when the charge or payment <strong>happened</strong>. Outstanding balances are always shown in full.</>}
    />
  );
}
