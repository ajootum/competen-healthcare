/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-BOOK-FLOW-002 s19 -- THE BOOKING FUNNEL.
//
// Where a patient stops, counted. Nine steps, a coarse device class, and one integer whose meaning is
// fixed by the step. Migration 366's header explains why there is no metadata column and no journey id;
// this file is the only thing that writes to it, and it cannot write anything else.
//
// ---- RECORDING CAN NEVER COST SOMEBODY AN APPOINTMENT ----------------------------------------------
//
// Every call here is fire-and-forget: it swallows its own failures, returns nothing anybody branches on,
// and is never awaited in a way that can delay a booking. A funnel that took a booking down with it
// would be the worst possible trade -- measurement is the least important thing happening on that
// request, and it must behave like it.
//
// ---- WHAT THE NUMBERS CAN AND CANNOT SAY -----------------------------------------------------------
//
// These are PAGE-LEVEL COUNTS, not people. A refresh counts twice, a crawler that reaches a public
// profile counts once, and a patient who opens the page on a phone and finishes on a laptop counts as
// two journeys. That is the price of not holding a journey identifier, and the read surface says so in
// as many words rather than presenting a conversion rate as though it were a headcount.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const FUNNEL_TABLE = "practice_booking_funnel_event";

/**
 * The closed list, matching migration 366's CHECK.
 *
 * The order is the JOURNEY's order, and the read surface depends on it: `FUNNEL_STEPS` is what the
 * conversion between consecutive steps is computed from, so a step inserted in the wrong place would
 * quietly produce a conversion between two things that do not follow one another.
 */
export const FUNNEL_STEPS = [
  "profile_viewed",
  "booking_started",
  "availability_viewed",
  "details_started",
  "verification_started",
  "booking_confirmed",
] as const;

/** Steps that are not rungs of the ladder -- they are things that went wrong, or a different door. */
export const FUNNEL_ASIDES = [
  "verification_failed",
  "verification_resent",
  "slot_taken_at_commit",
  "request_submitted",
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number] | (typeof FUNNEL_ASIDES)[number];

const ALL_STEPS: string[] = [...FUNNEL_STEPS, ...FUNNEL_ASIDES];

/** What a patient-facing label calls each rung. */
export const FUNNEL_LABELS: Record<string, string> = {
  profile_viewed: "Opened your page",
  booking_started: "Started booking",
  availability_viewed: "Looked at times",
  details_started: "Filled in details",
  verification_started: "Asked for a code",
  booking_confirmed: "Booked",
  verification_failed: "Wrong or expired code",
  verification_resent: "Asked for another code",
  slot_taken_at_commit: "Lost the time at the last moment",
  request_submitted: "Sent a request instead",
};

export type FunnelDevice = "mobile" | "desktop" | "unknown";

/**
 * Mobile or desktop, from the user agent, at the only resolution that is not a fingerprint.
 *
 * s19 asks for "mobile vs desktop completion". A full user-agent string is a fingerprint and is not
 * stored; this collapses it to one of three words before anything is written.
 */
export function deviceClass(userAgent: string | null | undefined): FunnelDevice {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "unknown";
  if (/mobile|android|iphone|ipad|ipod|windows phone/.test(ua)) return "mobile";
  return "desktop";
}

/**
 * Record one step.
 *
 * ⚠ IT NEVER THROWS AND NEVER REPORTS. There is no return value to branch on, on purpose: a caller that
 * could see this fail would eventually handle it, and handling it means letting a measurement affect a
 * booking. The only place a failure is visible is the server log.
 *
 * ⚠ AND IT VALIDATES ITS OWN INPUT rather than trusting the database to. A bad step would be refused by
 * the CHECK constraint anyway, but the refusal would arrive as a logged error on a live booking request
 * instead of being dropped here where it belongs.
 */
export async function recordFunnelStep(admin: any, args: {
  workspaceId: string | null | undefined;
  step: FunnelStep;
  device?: FunnelDevice | null;
  /** Seconds to complete on booking_confirmed, attempt number on verification_failed. Nothing else. */
  measure?: number | null;
}): Promise<void> {
  try {
    if (!args.workspaceId) return;
    if (!ALL_STEPS.includes(args.step)) return;

    const measure = typeof args.measure === "number" && Number.isFinite(args.measure)
      // Clamped rather than refused: a duration longer than a day is a clock somebody changed mid-
      // booking, and losing the row over it would lose the completion it was attached to.
      ? Math.max(0, Math.min(86_400, Math.trunc(args.measure)))
      : null;

    await admin.from(FUNNEL_TABLE).insert({
      workspace_id: args.workspaceId,
      step: args.step,
      device: args.device ?? null,
      measure,
    });
  } catch {
    // Deliberately silent. See this function's header.
  }
}

/**
 * Record a step when the caller holds a handle rather than a workspace.
 *
 * ⚠ THE EXTRA READ IS THE PRICE OF NOT PASSING WORKSPACE IDS THROUGH THE PUBLIC ENGINES. Those engines
 * take a handle and return a patient-safe payload; threading a workspace id out of them so a counter
 * could use it would put an internal identifier on a public path for the sake of a metric. One indexed
 * lookup on a column that is already unique is the cheaper mistake.
 *
 * ⚠ AND IT IS AWAITED, NOT FIRED AND FORGOTTEN. On a serverless request, work not finished before the
 * response is returned may simply be killed -- an emitter that looked asynchronous would record nothing
 * and nobody would notice, which is worse than not measuring at all.
 */
export async function recordFunnelStepByHandle(admin: any, args: {
  handle: string;
  step: FunnelStep;
  device?: FunnelDevice | null;
  measure?: number | null;
}): Promise<void> {
  try {
    const clean = (args.handle ?? "").trim().toLowerCase().replace(/^@/, "");
    if (!clean) return;
    const { data } = await admin.from("practice_booking_access")
      .select("workspace_id").eq("handle", clean).maybeSingle();
    const workspaceId = (data?.workspace_id as string | undefined) ?? null;
    if (!workspaceId) return;
    await recordFunnelStep(admin, { ...args, workspaceId });
  } catch {
    // Silent, for the reason recordFunnelStep is.
  }
}

export type FunnelRung = {
  step: string;
  label: string;
  count: number;
  /**
   * Conversion from the rung above, as a percentage, or null for the first rung and wherever the rung
   * above recorded nothing. ⚠ Null is not zero: "no conversion" and "nobody got that far to convert"
   * are different facts and the screen says different things about them.
   */
  fromPrevious: number | null;
};

export type FunnelReading = {
  state: "ok" | "unreadable" | "empty";
  reason: string | null;
  rungs: FunnelRung[];
  asides: { step: string; label: string; count: number }[];
  /** s19's completion time, over completed journeys only. Null when none completed. */
  medianSecondsToBook: number | null;
  byDevice: { device: string; confirmed: number }[];
  /** The window these counts cover, so a number is never read as all-time when it is not. */
  sinceIso: string;
  /**
   * ⚠ THE CAVEAT TRAVELS WITH THE NUMBERS. A conversion rate presented without it reads as a headcount,
   * and these are page-level counts: a refresh counts twice and a crawler counts once.
   */
  note: string;
};

const FUNNEL_NOTE =
  "These count page visits rather than people. A refresh counts twice, and a link opened by something "
  + "other than a patient still counts once, so treat the shape as a guide rather than a headcount.";

/**
 * The funnel for one practice over a window.
 *
 * ⚠ A FAILED READ IS `unreadable`, NEVER AN EMPTY FUNNEL. "Nobody visited your booking page" and "the
 * counts could not be read" are opposite messages, and only one of them should make a practitioner
 * change anything.
 */
export async function bookingFunnel(admin: any, args: {
  workspaceId: string; days?: number;
}): Promise<FunnelReading> {
  const days = Math.max(1, Math.min(365, Math.trunc(args.days ?? 30)));
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();

  const empty = (state: FunnelReading["state"], reason: string | null): FunnelReading => ({
    state, reason, rungs: [], asides: [], medianSecondsToBook: null, byDevice: [],
    sinceIso, note: FUNNEL_NOTE,
  });

  const { data, error } = await admin.from(FUNNEL_TABLE)
    .select("step, device, measure")
    .eq("workspace_id", args.workspaceId)
    .gte("occurred_at", sinceIso)
    // Bounded, because an unbounded read on a busy practice is a page that stops loading. The cap is
    // far above any plausible volume for this deployment; when it stops being, this becomes a grouped
    // query in the database rather than a bigger number here.
    .limit(10_000);

  if (error) return empty("unreadable", `these counts could not be read: ${error.message}`);
  const rows = (data ?? []) as { step: string; device: string | null; measure: number | null }[];
  if (rows.length === 0) return empty("empty", null);

  const count = (step: string) => rows.filter(r => r.step === step).length;

  const rungs: FunnelRung[] = FUNNEL_STEPS.map((step, i) => {
    const c = count(step);
    const prev = i === 0 ? null : count(FUNNEL_STEPS[i - 1]);
    return {
      step,
      label: FUNNEL_LABELS[step] ?? step,
      count: c,
      // ⚠ NO PERCENTAGE WHERE THE DENOMINATOR IS NOUGHT. Dividing by it yields Infinity or NaN, and
      // rendering either as "0%" would report a step nobody reached as a step everybody abandoned.
      fromPrevious: prev === null || prev === 0 ? null : Math.round((c / prev) * 100),
    };
  });

  const asides = FUNNEL_ASIDES
    .map(step => ({ step, label: FUNNEL_LABELS[step] ?? step, count: count(step) }))
    .filter(a => a.count > 0);

  const durations = rows
    .filter(r => r.step === "booking_confirmed" && typeof r.measure === "number")
    .map(r => r.measure as number)
    .sort((a, b) => a - b);
  // The MEDIAN rather than the mean: one patient who left the tab open over lunch would move a mean
  // enough to make it useless, and there is no journey id to spot them with.
  const medianSecondsToBook = durations.length > 0
    ? durations[Math.floor(durations.length / 2)]
    : null;

  const byDevice = (["mobile", "desktop", "unknown"] as const)
    .map(device => ({
      device,
      confirmed: rows.filter(r => r.step === "booking_confirmed" && (r.device ?? "unknown") === device).length,
    }))
    .filter(d => d.confirmed > 0);

  return { state: "ok", reason: null, rungs, asides, medianSecondsToBook, byDevice, sinceIso, note: FUNNEL_NOTE };
}
