import type { WorkspaceContext } from "@/lib/practice/access";
import { zonedDayRange } from "@/lib/practice/practice-time";
import { todaysPlan, type TodaysPlan } from "@/lib/practice/activity";
import {
  sessionMetrics, withPatientFigures, waitingQueue, activeFollowUps, operationalAlerts, draftEncounters,
  sessionFlow, sessionAttention,
  type SessionWithFigures, type FollowUpLens, type Alert, type QueueGroup, type SessionFlow,
} from "@/lib/practice/session";
import { sessionTimeline, type SessionTimeline } from "@/lib/practice/session-timeline";
import { operationsHome } from "@/lib/practice/operations-home";
import { practiceBrief, type PracticeBrief } from "@/lib/practice/brief";
import {
  practiceMetrics, metricScope, type Metric, type MetricKey, type PracticeMetrics,
} from "@/lib/practice/metrics";

// ── THE GLANCE IS A VIEW OF THE METRICS, NOT A SECOND CALCULATION (CORE-10) ─────────────────────────
//
// s7's "Today at a Glance" names eight figures and s8 defines each of them precisely. Until now the tiles
// were counted by `todayAtAGlance` in session.ts, whose definitions disagreed with s8 in five places --
// Waiting read from appointment status rather than the queue (so walk-ins were invisible and patients
// already in the room were counted as waiting), Completed counted a clerical desk action rather than a
// clinical one, Follow-ups Due folded the whole overdue backlog into "due".
//
// That function is now GONE rather than corrected, because s16's rule is not "compute it correctly twice"
// -- it is "no widget independently calculates a conflicting version of a shared metric". Two correct
// implementations drift into two answers just as surely as a wrong one, only later and more quietly.
//
// This table is the ONLY thing the tiles add: which metric, in what order, and where its list lives. No
// arithmetic, no query -- everything numeric arrives from metrics.ts already computed, already carrying
// its own formula and sources.
const GLANCE_TILES: { key: MetricKey; href: string }[] = [
  { key: "booked", href: "/practice/calendar" },
  { key: "waiting", href: "/practice/calendar" },
  { key: "completed", href: "/practice/encounters" },
  { key: "walk_in", href: "/practice/calendar" },
  { key: "cancelled", href: "/practice/calendar" },
  { key: "emergency", href: "/practice/calendar" },
  { key: "follow_ups_due", href: "/practice/follow-ups" },
  { key: "no_show", href: "/practice/calendar" },
];

/**
 * A tile is a metric plus the place its list lives.
 *
 * `formula` and `sources` ride along because s16 requires every metric to be "traceable to source records
 * and a documented formula" -- a property of the NUMBER, not of a document somebody may never open, so it
 * travels with the number and can be rendered beside it.
 */
export type GlanceTile = {
  key: MetricKey;
  label: string;
  count: number | null;
  href: string;
  status: Metric["status"];
  /** Why there is no number, in plain language. Null when the value stands. */
  reason: string | null;
  /** What the figure counts, for the practitioner. This is the one the tile shows. */
  basis: string;
  /** ⚠ ENGINEERING, not rendered on a practitioner surface. */
  formula: string;
  sources: string[];
};

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
  session: SessionWithFigures | null;
  glance: { tiles: GlanceTile[]; scope: "session" | "day"; unavailable: boolean };
  /**
   * s11's `brief`, CORE-12. Carried in the PAYLOAD rather than badged in one component's JSX, so any
   * surface rendering these sentences also carries the label, the calculation time and the rows they
   * were counted from.
   */
  brief: PracticeBrief;
  /**
   * The rows the brief was derived FROM, which the alerts, tasks and messages cards also render.
   *
   * Exposed rather than re-read: the page used to call `operationsHome` itself, so one screen made the
   * same expensive read twice and had two chances to disagree with itself about what was waiting. One
   * call, one answer, several cards.
   */
  operations: Awaited<ReturnType<typeof operationsHome>> | null;
  /** All twelve of s8's metrics for this scope. The glance shows eight of them. */
  metrics: PracticeMetrics | null;
  /** `total` is the database's own count of everybody waiting; `groups` may hold only the first
   *  QUEUE_LIMIT of them, and `capped` is how a reader tells. See waitingQueue in session.ts. */
  queue: { groups: QueueGroup[]; total: number | null; unavailable: boolean; capped: boolean };
  /**
   * CPR-CUR-001 s5.2 zones B/C: the current patient, the next patient, and the flow counters no other
   * engine owns (arrived, in progress, expected). Derived in session.ts from the same canonical rows
   * the queue and metrics read, so the cockpit cannot disagree with either.
   */
  flow: SessionFlow;
  /**
   * CPR-CUR-001 s11's Immediate Attention: deterministic operational exceptions about the RUNNING
   * session only. Empty when nothing is running -- day-scoped worries belong to the Command Centre.
   */
  attention: Alert[];
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
  // s8's twelve metrics for this scope, computed once. The glance tiles are a view of eight of them and
  // Practice Performance is a view of three more -- one calculation, several readers, which is the whole
  // of s16's rule.
  const mScope = metricScope({
    date: plan.date, timezone: plan.timezone, activityId: scope.sessionId,
    window: session ? { fromIso: scope.fromIso, toIso: scope.toIso } : null,
  });

  const FLOW_FALLBACK: SessionFlow = {
    current: null, next: null, arrived: null, inProgress: null, expected: null,
    expectedList: null, expectedListTotal: null, unregisteredArrivals: null,
    openEncounters: null, unavailable: true,
  };

  const [metrics, queue, timeline, followUps, alerts, drafts, home, flow] = await Promise.all([
    feed(null as PracticeMetrics | null,
      () => practiceMetrics(admin, ctx, mScope, at)),
    feed({ groups: [], total: null, unavailable: true, capped: false },
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
    // The brief's own feeder. ONE call, and the brief is derived from ITS rows rather than re-reading --
    // a briefing service with its own queries would be a second answer to the same question, and it
    // would drift only under load, which is the worst time to find out.
    feed(null as Awaited<ReturnType<typeof operationsHome>> | null,
      () => operationsHome(admin, ctx)),
    // CPR-CUR-001's flow projection. Fed the SESSION window when one is running so `expected` counts
    // this session's bookings; the current/next/arrived reads are day-scoped inside the engine.
    feed(FLOW_FALLBACK,
      () => sessionFlow(admin, ctx,
        session ? { fromIso: session.windowStartIso, toIso: session.windowEndIso } : null,
        plan.date, plan.timezone, at)),
  ]);

  // A feeder is unavailable if it threw OR if it reported its own failure. Both are the same thing to a
  // card that has to decide between "nothing here" and "could not tell", and keeping them separate would
  // make every consumer check two flags and eventually check only one.
  // The tiles, assembled by lookup. A metric that is missing from the map is a programming error rather
  // than a runtime state, so it is not silently skipped -- it would leave a hole in a frozen layout.
  const glanceTiles: GlanceTile[] = metrics.value
    ? GLANCE_TILES.map(({ key, href }) => {
        const m = metrics.value!.metrics[key];
        return { key, href, label: m.label, count: m.value, status: m.status,
          reason: m.reason, basis: m.basis, formula: m.formula, sources: m.sources };
      })
    : [];

  // ⚠ THE SESSION'S PATIENT FIGURES COME FROM metrics.ts, NOT FROM THE SESSION ENGINE. Both used to
  // count them, one card apart, which is the drift s16 names. The engine owns the clock; s8 owns the
  // patients. `withPatientFigures` does the projection, so the arithmetic still lives in an engine.
  const m = metrics.value?.metrics;
  const sessionWithFigures = session
    ? withPatientFigures(session, m?.patients_seen.value ?? null, m?.average_consult_time.value ?? null, at)
    : null;

  const feeders: Record<string, FeederState> = {
    plan: plan.unavailable ? "unavailable" : "ok",
    // ⚠ THE GLANCE IS EIGHT OF THE TWELVE, so its availability is about THOSE EIGHT. Derived from
    // PracticeMetrics.unavailable it asked "did all twelve fail", and one metric outside the glance
    // being merely `unknowable` (clinic delay, below its minimum observations) was enough to report a
    // glance of eight em dashes as healthy. A card must not be judged by figures it does not show.
    glance: metrics.state === "ok" && glanceTiles.length > 0
      && !glanceTiles.every(t => t.status === "unreadable" || t.status === "not_permitted")
      ? "ok" : "unavailable",
    queue: queue.state === "ok" && !queue.value.unavailable ? "ok" : "unavailable",
    timeline: timeline.state === "ok" && !timeline.value.unavailable ? "ok" : "unavailable",
    // A follow-up lens reports failure as a null count rather than a flag, so "every lens is null" is
    // what a failed read looks like here. An EMPTY array is also a failure -- five lenses are always
    // returned on success, so nought of them means the call did not do its job.
    followUps: followUps.state === "ok" && followUps.value.length > 0
      && followUps.value.some(l => l.count !== null) ? "ok" : "unavailable",
    alerts: alerts.state === "ok" && !alerts.value.unavailable ? "ok" : "unavailable",
    drafts: drafts.state === "ok" && drafts.value !== null ? "ok" : "unavailable",
    // ⚠ RETURNING A VALUE IS NOT THE SAME AS HAVING READ ANYTHING. operationsHome does not throw when its
    // queries fail -- it now reports them in `unreadable` instead -- so a feeder judged only on "did it
    // return" called itself healthy while every read behind it had failed. The same trap the glance fell
    // into, one feeder later.
    brief: home.state === "ok" && home.value !== null
      && (home.value.unreadable?.length ?? 0) === 0 ? "ok" : "unavailable",
    flow: flow.state === "ok" && !flow.value.unavailable ? "ok" : "unavailable",
  };

  return {
    asOf: at.toISOString(),
    timezone: plan.timezone,
    scope,
    plan,
    session: sessionWithFigures,
    glance: { tiles: glanceTiles, scope: scope.kind, unavailable: feeders.glance === "unavailable" },
    metrics: metrics.value,
    queue: queue.value,
    flow: flow.value,
    // The attention rules are PURE and run over figures their own engines computed: the flow
    // projection, the session clock and s8's waiting count. Composition, not calculation.
    attention: sessionAttention({
      flow: flow.value,
      session: sessionWithFigures,
      waiting: m?.waiting.value ?? null,
    }),
    timeline: timeline.value,
    followUps: followUps.value,
    alerts: alerts.value,
    drafts: drafts.value,
    operations: home.value,
    brief: practiceBrief(home.value
      ? { attention: home.value.attention, blindSpots: home.value.blindSpots, allClear: home.value.allClear, unreadable: home.value.unreadable }
      // A feeder that threw has no attention list. An EMPTY brief with every domain named as a blind
      // spot is the honest shape: it says nothing was read, not that nothing is waiting.
      : { attention: [], blindSpots: [], unreadable: ["everything -- the brief could not be read"] }, at),
    feeders,
    // ⚠ ONLY when every feeder failed. s16: "a failure in one feeder does not make the entire dashboard
    // unusable" -- so this must never be true because one card could not be read, or the page would blank
    // itself over a slow inbox.
    unavailable: Object.values(feeders).every(s => s === "unavailable"),
  };
}
