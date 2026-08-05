import type { WorkspaceContext } from "@/lib/practice/access";
import { zonedDayRange } from "@/lib/practice/practice-time";
import { todaysPlan, type TodaysPlan } from "@/lib/practice/activity";
import {
  sessionMetrics, todayAtAGlance, waitingQueue, activeFollowUps, operationalAlerts, draftEncounters,
  type SessionMetrics, type GlanceTile, type FollowUpLens, type Alert, type QueueGroup,
} from "@/lib/practice/session";
import { sessionTimeline, type SessionTimeline } from "@/lib/practice/session-timeline";

/* eslint-disable @typescript-eslint/no-explicit-any -- the Supabase admin client is untyped; every
   engine in src/lib/practice does the same. */

// CPR-CORE-001 CORE-08: THE DASHBOARD ASSEMBLER.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE SPEC'S CORE RULE, MADE STRUCTURAL: "Dashboard widgets consume shared engines; widgets do not own
// business logic" (cover page), and s11 "the frontend should receive an ASSEMBLED dashboard payload to
// reduce inconsistent calculations and excessive client-side joins".
//
// Before this file the page called seven engines itself and decided its own scope inline. Nothing was
// wrong with the answers, but the ARRANGEMENT was: every new card meant another call in the page, and the
// day a second surface needed the same figures (a mobile home, /practice/today, an API consumer) it would
// have assembled them slightly differently. That is exactly what s16 forbids -- "no widget independently
// calculates a conflicting version of a shared metric".
//
// So the scope decision lives HERE, once, and everything downstream receives it rather than deriving it.
//
// ── WHAT THIS FILE IS NOT ───────────────────────────────────────────────────────────────────────────
//
// It is an ASSEMBLER, not an engine. It owns no business logic of its own: every figure below comes from
// the engine the feeder matrix (s7) names as its owner, and this file's whole job is to call them with
// one consistent scope and stamp the result. If a calculation ever appears in here, it is in the wrong
// place -- that is the rule this file exists to enforce, and it is the first thing to check in review.
//
// ── PARTIAL FAILURE IS A FIRST-CLASS OUTCOME ────────────────────────────────────────────────────────
//
// s14: "Render available cards and show retry on the failed card", and s16: "a failure in one feeder does
// not make the entire dashboard unusable". So no feeder is awaited in a way that lets it take the others
// down: every one already reports its own unavailability, and `feeders` below records which ones did.
// A rejected promise -- a thrown error rather than a returned one -- is caught per feeder for the same
// reason, because Promise.all rejects the whole batch on one throw and that would blank the page.

export type FeederState = "ok" | "unavailable";

export type DashboardReadModel = {
  /** s12: "Every dashboard response must include an as_of timestamp and timezone." */
  asOf: string;
  timezone: string;
  scope: {
    date: string;
    /**
     * s7, Today at a Glance: "counts are session-scoped after session start; day-scoped before start".
     * Stated in the payload so a screen labels what it drew rather than assuming.
     */
    kind: "session" | "day";
    sessionId: string | null;
    fromIso: string;
    toIso: string;
  };
  plan: TodaysPlan;
  session: SessionMetrics | null;
  glance: { tiles: GlanceTile[]; scope: "session" | "day"; unavailable: boolean };
  queue: { groups: QueueGroup[]; total: number | null; unavailable: boolean };
  timeline: SessionTimeline;
  followUps: FollowUpLens[];
  alerts: { alerts: Alert[]; unavailable: boolean };
  drafts: Awaited<ReturnType<typeof draftEncounters>>;
  /** Which feeders answered. s14's "partial failure" state, per card rather than per page. */
  feeders: Record<string, FeederState>;
  /** True when EVERY feeder failed -- the one case where the page itself should say so. */
  unavailable: boolean;
};

/**
 * Run a feeder without letting it take the dashboard down.
 *
 * Every engine here already returns its own `unavailable` flag rather than throwing, so this catch is for
 * the case none of them model: an exception. Returning the caller's fallback keeps the shape stable, and
 * the feeder is recorded as unavailable so the card can say so and offer a retry.
 */
async function feed<T>(fallback: T, run: () => Promise<T>): Promise<{ value: T; state: FeederState }> {
  try {
    return { value: await run(), state: "ok" };
  } catch {
    return { value: fallback, state: "unavailable" };
  }
}

/**
 * The assembled Practice Command Centre payload (CPR-CORE-001 s11).
 *
 * @param at injected rather than read from the clock inside, so a caller -- and a test -- can assemble
 *           the dashboard for a known instant. Every feeder receives the SAME instant, which is what
 *           stops two cards on one screen disagreeing about what "now" is.
 */
export async function dashboardReadModel(
  admin: any, ctx: WorkspaceContext, opts: { at?: Date } = {},
): Promise<DashboardReadModel> {
  const at = opts.at ?? new Date();

  // ── 1. CONTEXT FIRST. s4's dependency sequence is Current Activity -> Session -> Queue/Encounter -> …
  // so the plan and the running session are resolved before anything that needs to know the scope.
  const plan = await todaysPlan(admin, ctx, { at });
  const session = await sessionMetrics(admin, ctx, plan, at);

  // ── 2. THE SCOPE DECISION, MADE ONCE.
  // s7: session-scoped after session start, day-scoped before it. This is the single line that s9 of
  // CPR-V5-001 was really asking for -- "the entire dashboard must automatically change based on
  // confirmed current activity and location" -- and it is one line because it is made in one place.
  const day = zonedDayRange(plan.date, plan.timezone);
  const scope = session
    ? { date: plan.date, kind: "session" as const, sessionId: session.activity.id,
        fromIso: session.windowStartIso, toIso: session.windowEndIso }
    : { date: plan.date, kind: "day" as const, sessionId: null,
        fromIso: day.startIso, toIso: day.endIso };

  // ── 3. THE FEEDERS, IN PARALLEL, EACH ISOLATED.
  const [glance, queue, timeline, followUps, alerts, drafts] = await Promise.all([
    feed({ tiles: [], scope: scope.kind, unavailable: true },
      () => todayAtAGlance(admin, ctx, { fromIso: scope.fromIso, toIso: scope.toIso, today: plan.date, scope: scope.kind })),
    feed({ groups: [], total: null, unavailable: true },
      () => waitingQueue(admin, ctx, at)),
    feed({ date: plan.date, timezone: plan.timezone, dayStartIso: day.startIso,
           events: [], upcoming: [], sources: [], unavailable: true, partial: false } as SessionTimeline,
      () => sessionTimeline(admin, ctx, { date: plan.date, timezone: plan.timezone, at })),
    feed([] as FollowUpLens[],
      () => activeFollowUps(admin, ctx, plan.date)),
    feed({ alerts: [], unavailable: true },
      () => operationalAlerts(admin, ctx, plan.date)),
    feed(null as Awaited<ReturnType<typeof draftEncounters>>,
      () => draftEncounters(admin, ctx)),
  ]);

  // A feeder is unavailable if it threw OR if it reported its own failure. Both are the same thing to a
  // card that has to decide between "nothing here" and "could not tell", and keeping them separate would
  // make every consumer check two flags and eventually check only one.
  const feeders: Record<string, FeederState> = {
    plan: plan.unavailable ? "unavailable" : "ok",
    glance: glance.state === "ok" && !glance.value.unavailable ? "ok" : "unavailable",
    queue: queue.state === "ok" && !queue.value.unavailable ? "ok" : "unavailable",
    timeline: timeline.state === "ok" && !timeline.value.unavailable ? "ok" : "unavailable",
    // A follow-up lens reports failure as a null count rather than a flag, so "every lens is null" is
    // what a failed read looks like here. An EMPTY array is also a failure -- five lenses are always
    // returned on success, so nought of them means the call did not do its job.
    followUps: followUps.state === "ok" && followUps.value.length > 0
      && followUps.value.some(l => l.count !== null) ? "ok" : "unavailable",
    alerts: alerts.state === "ok" && !alerts.value.unavailable ? "ok" : "unavailable",
    drafts: drafts.state === "ok" && drafts.value !== null ? "ok" : "unavailable",
  };

  return {
    asOf: at.toISOString(),
    timezone: plan.timezone,
    scope,
    plan,
    session,
    glance: glance.value,
    queue: queue.value,
    timeline: timeline.value,
    followUps: followUps.value,
    alerts: alerts.value,
    drafts: drafts.value,
    feeders,
    // ⚠ ONLY when every feeder failed. s16: "a failure in one feeder does not make the entire dashboard
    // unusable" -- so this must never be true because one card could not be read, or the page would blank
    // itself over a slow inbox.
    unavailable: Object.values(feeders).every(s => s === "unavailable"),
  };
}
