import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { listActivitiesResult, portfolioSummary } from "@/lib/practice/clinical-activity";
import { listLocations } from "@/lib/practice/configuration";
import { workspaceClock } from "@/lib/practice/practice-time";
import {
  periodFromParams, periodLabel, periodSpanDays, allDatesTarget, periodToParams,
} from "@/lib/practice/period-range";
import ActivityConsole from "./ActivityConsole";
import ActivityNavigator from "./ActivityNavigator";

// /practice/activity -- CPR-150's CLINICAL ACTIVITY half.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE MODULE IS CALLED "PROCEDURE AND CLINICAL ACTIVITY MANAGEMENT". ONLY THE PROCEDURE HALF EXISTED.
//
// Procedures are recorded inside a consultation, where the patient is -- that is right and unchanged. An
// ACTIVITY has no patient: a ward round, a teaching session, a mortality meeting. It belongs to the
// clinician, so it gets its own page rather than being wedged into a consultation it has nothing to do
// with.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// `activity`, NOT `activities` OR `procedures`: the public marketing section shares this URL space and a
// static route here shadows it silently. The slugs it owns are listed in navigation.ts, and
// practice-content-harness.ts is what catches a mistake -- it caught CPR-310 shipping at /practice/team.

export const dynamic = "force-dynamic";

export default async function ActivityPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "procedure.record")) redirect("/practice/home");

  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const mine = one("mine");
  const kind = one("kind");
  const admin = createAdminClient();
  const onlyMine = mine !== "0";

  // ⚠ THE PRACTICE'S TODAY, NOT THIS MACHINE'S. Every rolling window on the control below is measured
  // from it, and a practice in Kampala is on a different calendar day from the renderer for three hours
  // of every morning.
  const clock = await workspaceClock(admin, shell.ctx.workspaceId);

  // ⚠ THE DEFAULT IS "All dates", WHICH IS EXACTLY WHAT THIS PAGE DID BEFORE THE CONTROL EXISTED. It has
  // never had a period; adding one with a default of "this month" would have hidden every older entry
  // from a clinician's portfolio the day this shipped, silently. See ActivityNavigator's header.
  const period = periodFromParams(one, clock.today, allDatesTarget(clock.today));

  const [activityRead, portfolio, locations] = await Promise.all([
    listActivitiesResult(admin, shell.ctx.workspaceId, {
      performedBy: onlyMine ? shell.ctx.userId : undefined,
      kind: kind || undefined,
      // ⚠ THE READ IS BOUNDED BY THE RANGE AND NOT MERELY DESCRIBED BY IT. A navigator that moved the
      // address bar while the query still said "everything" is a lie the screen tells about itself.
      fromDay: period.bounded ? period.fromDate : undefined,
      toDay: period.bounded ? period.toDate : undefined,
    }),
    portfolioSummary(admin, shell.ctx.workspaceId, shell.ctx.userId, {
      fromDay: period.bounded ? period.fromDate : undefined,
      toDay: period.bounded ? period.toDate : undefined,
    }),
    listLocations(admin, shell.ctx.workspaceId),
  ]);

  const keep = { mine: onlyMine ? null : "0", kind: kind || null };
  // ⚠ THE PERIOD, FOR THE LINKS THE CONSOLE BUILDS ITSELF. Without it, pressing a kind filter would
  // widen the log back out to every date under a control still lit as though it were narrow.
  const periodQuery = Object.entries(periodToParams({
    view: period.view, anchorDate: period.anchorDate,
    from: period.bounded ? period.fromDate : null, to: period.bounded ? period.toDate : null,
    anchoring: period.anchoring, backDays: period.backDays,
  })).filter(([, v]) => !!v).map(([k, v]) => `&${k}=${encodeURIComponent(v!)}`).join("");

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-bold text-gray-900">Clinical activity</h1>
      <p className="mt-0.5 text-[13px] text-gray-500">
        What you did that was not a procedure &mdash; ward rounds, teaching, meetings, training. Recorded
        against you, not against a patient.
      </p>

      <div className="mt-3">
        <ActivityNavigator period={period} todayDate={clock.today} timezone={clock.timezone} keep={keep} />
      </div>

      {/* ── THE THREE STATES, KEPT APART ON THE PAGE AS WELL AS IN THE LOADER ──────────────────────
          has data / genuinely nothing in this period / could not be read. The third one used to be
          indistinguishable from the second: the query's error was discarded and an outage rendered as an
          empty log, which on a portfolio is a claim that somebody did no work. */}
      {activityRead.unavailable ? (
        <p className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
          <strong>The activity log could not be read.</strong> {activityRead.detail}{" "}
          This is not an empty period &mdash; nothing below can be taken as a record of what you did.
        </p>
      ) : activityRead.items.length === 0 && period.bounded ? (
        <p className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
          Nothing is recorded in <strong>{periodLabel(period)}</strong>
          {periodSpanDays(period) !== null && <> ({period.fromDate} to {period.toDate})</>}. The read
          succeeded &mdash; this period is genuinely empty, not unreadable.
        </p>
      ) : null}

      {activityRead.truncated && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <strong>This list stops at {activityRead.limit} entries and there are more.</strong> Narrow the
          period to see the rest &mdash; a list that quietly ended would look like a period with less work
          in it than there was.
        </p>
      )}

      {portfolio.unavailable && (
        <p className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
          <strong>The portfolio figures could not be read.</strong> {portfolio.unavailableDetail}{" "}
          The counts below are not a statement that you did none of this.
        </p>
      )}
      {portfolio.truncated && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          The portfolio counts stopped at the read limit, so they understate this period. Narrow it.
        </p>
      )}

      <ActivityConsole
        activities={activityRead.items}
        portfolio={portfolio}
        locations={locations}
        onlyMine={onlyMine}
        kind={kind ?? ""}
        me={shell.ctx.userId}
        periodQuery={periodQuery}
      />
    </div>
  );
}
