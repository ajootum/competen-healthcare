"use client";

import { useRouter } from "next/navigation";
import PeriodNavigator, { type PeriodChange } from "@/components/practice/PeriodNavigator";
import type { PlannerPeriod } from "@/lib/practice/planner-constants";
import { plannerHref, type PlannerUrlState } from "./planner-ui";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CP-PLAN-002 s3 -- THE PLANNER'S TIME NAVIGATOR, which is now an ADAPTER and not a control.
//
// The control itself is src/components/practice/PeriodNavigator.tsx, because the practice owner asked
// for it on every screen that reviews data over time. All that is planner-specific is what a change
// MEANS here: a URL on /practice/calendar that also carries the content filters and the selection.
//
// ⚠ THE FILTERS RIDE ALONG. Moving to next week must not silently drop "Walk-ins only" -- s2 keeps the
// range and the content controls separate, and separate means neither resets the other.
//
// ⚠ AND EVERY CONTROL IS A REAL LINK. `href` is passed, so each period is bookmarkable, the browser's
// own back button works, and the server does the read -- which is what makes the appointment book below
// the planner always show the day the planner is showing.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function PlannerNavigator({ period, todayDate, timezone, urlState }: {
  period: PlannerPeriod;
  todayDate: string;
  timezone: string;
  urlState: PlannerUrlState;
}) {
  const router = useRouter();

  const toHref = (next: PeriodChange) => plannerHref({
    ...urlState,
    view: next.view,
    date: next.anchorDate,
    // A range belongs to Agenda and to nothing else. Carrying it onto a Week would make the URL say two
    // different things about which days are on the screen.
    from: next.view === "agenda" ? next.from : null,
    to: next.view === "agenda" ? next.to : null,
  });

  return (
    <PeriodNavigator
      period={period}
      todayDate={todayDate}
      timezone={timezone}
      href={toHref}
      onChange={next => router.push(toHref(next))}
    />
  );
}
