// Instants for harness fixtures, relative to the run rather than typed into the file.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ WHY A HARDCODED DATE IS A FIXTURE WITH A FUSE.
//
// Four harnesses booked appointments at instants like "2026-09-01T09:00:00.000Z" -- future when they
// were written, and quietly past afterwards. On 2026-09-02 the configuration harness went red on two
// assertions, and the message named neither the date nor the cause:
//
//   FAIL rung 2: with no explicit length, the VISIT TYPE's minutes win over the workspace default
//        -- undefined from the visit type, workspace default is 20
//
// The booking had been refused with LEAD_TIME -- "the booking rule for this location needs 30 minutes'
// notice, and that time is sooner than that" -- because a moment in the past is trivially sooner than
// half an hour from now. So `booked20` was null, `duration_minutes` read undefined, and an assertion
// about DURATION PRECEDENCE failed for a reason that had nothing to do with durations.
//
// ⚠ AND IT GOT WORSE AS IT AGED, ONE ASSERTION AT A TIME. The same harness's other bookings were still
// hours or days ahead, so it failed partially -- which reads like a real regression in the thing being
// tested rather than a fixture rotting. That is the expensive part: not the red, but the wrong diagnosis
// it invites.
//
// ⚠ THE LEAD TIME IS WHY THIS ONLY STARTED BITING RECENTLY. CP_STANDARD_V1 (the provisioning baseline)
// seeds a starter rule with 30 minutes' notice, so every provisioned harness world now has one. Before
// that, a stale date booked happily and nothing complained.
//
// Birth dates, effective-from dates and anything whose VALUE is the point stay hardcoded. This is only
// for instants that must simply be "far enough ahead to be bookable".
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * An instant `days` from now, at a fixed hour, so a fixture is deterministic within a run and never
 * stale between runs.
 *
 * ⚠ `days` MUST BE AT LEAST ONE. Pinning the hour means "today at 09:00" is in the past for any run
 * after nine in the morning -- the exact failure this module exists to end, reintroduced by an argument.
 * It throws rather than returning a value that works until lunchtime.
 */
export function daysAhead(days: number, hourUtc = 9): string {
  if (!Number.isFinite(days) || days < 1)
    throw new Error(`daysAhead needs at least 1 day: an hour pinned on today is already past for most of it (got ${days})`);
  if (!Number.isInteger(hourUtc) || hourUtc < 0 || hourUtc > 23)
    throw new Error(`daysAhead needs an hour between 0 and 23 (got ${hourUtc})`);
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
}

/** The calendar date of `daysAhead`, for fixtures that want YYYY-MM-DD rather than an instant. */
export function dateAhead(days: number): string {
  return daysAhead(days).slice(0, 10);
}
