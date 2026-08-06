import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { intelligenceSuite, isCohortDimension, COHORT_DIMENSIONS } from "@/lib/practice/intelligence";
import { INTELLIGENCE_TABS, DEFAULT_RANGE_DAYS } from "@/lib/practice/intelligence-constants";

// GET /api/v1/practice/intelligence -- CPR-PI-002's engine, as one read model.
//
// ?days=30 | ?from=YYYY-MM-DD&to=YYYY-MM-DD   the reporting window (s7.1's selector)
// ?cohortBy=diagnosis|procedure|treatment|sex|age_band|location|pathway
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE SAME ASSEMBLER THE PAGE USES. The workspace renders on the server and calls `intelligenceSuite`
// directly; this route exists for the other consumers CPR-PI-002 s6 and s9 anticipate -- the assistant's
// query engine, and a future mobile surface. If it assembled its own payload there would immediately be
// two answers to every figure in the suite, which is the precise thing this whole engine is built to
// avoid (CORE-001 s16: "No widget independently calculates a conflicting version of a shared metric").
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// 200 EVEN WHEN FEEDERS FAILED. s12: "Unavailable AI must not block dashboards", and the same applies to
// every other source. Each module carries its own status and reason, so a caller renders what it has and
// retries the part that broke. A 500 here would throw away nine working areas because one query timed out.
//
// NO CACHING HEADER. Half of this payload is operational -- overdue obligations, unreviewed results, open
// consultations -- and caching the assembled whole to suit its slowest-changing part would make the
// priority strip stale, which is the one part of the page somebody acts on within the minute.

export const dynamic = "force-dynamic";

/** A day the caller supplied, or undefined. Rejected rather than coerced: `?from=last-tuesday` must not
 *  silently become today, because a window nobody chose is a figure nobody can check (s15). */
const day = (raw: string | null): string | undefined =>
  raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;

export async function GET(req: NextRequest) {
  // report.view is the gate CPR-V5-003 and migration 191 already agree on, and the same one the page
  // enforces. Declared here rather than relying on the sidebar having hidden the link.
  const auth = await requirePracticeContext("report.view");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const rawDays = Number(url.searchParams.get("days"));
  const days = Number.isFinite(rawDays) && rawDays > 0
    ? Math.min(Math.max(Math.round(rawDays), 1), 366)
    : undefined;

  const from = day(url.searchParams.get("from"));
  const to = day(url.searchParams.get("to"));
  const cohortBy = url.searchParams.get("cohortBy");

  const suite = await intelligenceSuite(auth.caller.admin, auth.ctx, {
    fromDay: from, toDay: to,
    // A custom window wins over a preset; neither given, the engine's own default period applies.
    days: from && to ? undefined : (days ?? DEFAULT_RANGE_DAYS),
    cohortBy: isCohortDimension(cohortBy) ? cohortBy : undefined,
  });

  return NextResponse.json({
    ...suite,
    // s6's nine areas travel with the payload so a second surface does not hard-code them, and s4's
    // constraint travels with them: these are TABS. A client that turns them into sidebar entries is
    // contradicting the specification, not extending it.
    tabs: INTELLIGENCE_TABS,
    tabsAreInternal: true,
    cohortDimensions: COHORT_DIMENSIONS,
    correlationId: auth.caller.traceId,
  });
}
