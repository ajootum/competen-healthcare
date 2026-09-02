// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-PROV-001 §5 -- THE RULES AN ACCESS PERIOD MUST SATISFY, IN ONE PLACE.
//
// ⚠ THIS EXISTS BECAUSE §19 SAYS "not as a parallel expiry system". Two surfaces now create an access
// period: the Product Director's access card on an existing practice, and the provisioning wizard that
// gives a brand-new practice its first one. Written twice, they would drift -- and the drift would not
// look like a bug, it would look like the wizard being slightly more permissive than the card, which is
// exactly the difference nobody notices until a practice is provisioned with a window that had already
// closed.
//
// ⚠ IT LIVES ON THE PRACTICE SIDE, NOT IN src/lib/hq, and the direction matters. The landlord plane
// already reads practice modules (pd-practices.ts does); nothing under src/lib/practice imports from
// src/lib/hq, and putting a shared rule in the landlord tree would have made the SELF-SERVE SIGNUP path
// depend on a Product Director module to create its own trial.
//
// ⚠ AND IT IS PURE. No client, no clock of its own beyond an injectable `now`, so the rules can be
// tested exhaustively without a database -- which is what makes the boundary cases (end exactly equal to
// start, end exactly now, a start in the future with no end) worth asserting at all.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * §5's "approved quick durations such as 14, 30, 60 and 90 days plus Custom", plus §9's 7.
 *
 * ⚠ §5 ASKS FOR THESE TO COME FROM CONFIGURATION "where possible", AND THEY DO NOT. They are a shared
 * constant, which buys the half that matters -- the Director's access card and the provisioning wizard
 * offer the same durations and cannot drift apart -- and not the half it does not: nobody can change
 * them without a deploy. `pd_ops_config` stores one number per key (`value_hours`), so a LIST of presets
 * has nowhere to live there yet. Said plainly rather than left looking configurable.
 */
export const ACCESS_PRESET_DAYS = [7, 14, 30, 60, 90] as const;

/** §3's access bases that GRANT access. Anything else is a state a period ends in, not one it starts in. */
export const ACCESS_BASES = ["trial", "active"] as const;
export type AccessBasis = (typeof ACCESS_BASES)[number];

export type PeriodInput = {
  status: string;
  startsAt: string;
  /** null = open-ended, which §5 permits only as an explicit choice -- never as a missing value. */
  endsAt: string | null;
};

export type PeriodRefusal = {
  code: "INVALID_BASIS" | "INVALID_TIMESTAMP" | "INVALID_INTERVAL" | "END_IN_THE_PAST";
  /** HTTP status, so both callers refuse identically rather than each picking one. */
  status: number;
  message: string;
};

/**
 * Returns the refusal, or null when the period is valid. `string | null` is the shape
 * `validateIndividual` in provisioning.ts already uses for the same job, so a caller reads the same way.
 *
 * `now` is injectable ONLY so tests can pin the boundary. Callers pass nothing.
 */
export function validateAccessPeriod(p: PeriodInput, now: number = Date.now()): PeriodRefusal | null {
  if (!(ACCESS_BASES as readonly string[]).includes(p.status))
    return { code: "INVALID_BASIS", status: 400, message: "a granted period must be active or trial" };

  const startMs = Date.parse(p.startsAt);
  if (Number.isNaN(startMs))
    return { code: "INVALID_TIMESTAMP", status: 400, message: "the start must be an instant" };

  if (p.endsAt === null) return null;

  const endMs = Date.parse(p.endsAt);
  if (Number.isNaN(endMs))
    return { code: "INVALID_TIMESTAMP", status: 400, message: "the end must be an instant, or null for open-ended access" };

  // §5: "Reject end <= start and other invalid intervals server-side."
  if (endMs <= startMs)
    return { code: "INVALID_INTERVAL", status: 422, message: "the end must be after the start" };

  // ⚠ A WINDOW THAT HAS ALREADY CLOSED IS REFUSED. Granting a period that ended in the past is
  // indistinguishable from expiring one: the caller gets a "saved" and the practice stays locked out.
  //
  // ⚠ THIS RUNS AFTER THE ORDER CHECK, AND THE ORDER IS THE ANSWER PEOPLE NEED. A period starting now
  // and ending yesterday fails BOTH tests, and "the end must be after the start" is the one that tells a
  // Director what to change. Only a period wholly in the past -- start behind now, end after the start
  // but still behind now, which is what a reactivation form invites -- reaches this line.
  if (endMs <= now)
    return {
      code: "END_IN_THE_PAST", status: 422,
      message: "that end has already passed, so it would not grant access. Choose a later one.",
    };

  return null;
}

/**
 * The end of a period of `days` measured from `from`. One implementation, because the wizard shows this
 * figure on the Access step, repeats it on the Review step and the server recomputes it on write -- and
 * three roundings of the same arithmetic is how a screen promises 30 days and stores 29.
 */
export const endOfPeriod = (from: string | number, days: number): string =>
  new Date((typeof from === "number" ? from : Date.parse(from)) + days * 86_400_000).toISOString();

/** Whole days between two instants, rounded up, as §7's "days remaining" counts them. */
export const daysBetween = (from: string | number, to: string | number): number =>
  Math.ceil(
    ((typeof to === "number" ? to : Date.parse(to)) - (typeof from === "number" ? from : Date.parse(from)))
    / 86_400_000,
  );
