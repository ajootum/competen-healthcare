/**
 * CPR-PD-PROV-001 §5 -- the access-period rules, which two surfaces now depend on: the Product
 * Director's access card on an existing practice, and the provisioning wizard giving a new one its first
 * period. §19: "not as a parallel expiry system."
 *
 * ⚠ `now` IS PINNED IN EVERY CASE. These rules compare against the clock, so a test that let Date.now()
 * run would be asserting something slightly different on every execution -- and the boundary cases below
 * (an end exactly equal to now, a start exactly equal to an end) are precisely the ones that would flip.
 */
import { describe, it, expect } from "vitest";
import {
  validateAccessPeriod, endOfPeriod, daysBetween, ACCESS_PRESET_DAYS, ACCESS_BASES,
} from "./entitlement-period";

const NOW = Date.parse("2026-09-02T12:00:00.000Z");
const at = (iso: string) => iso;
const DAY = 86_400_000;
const plus = (ms: number) => new Date(NOW + ms).toISOString();

describe("§5 -- what a valid access period is", () => {
  it("accepts a period that starts now and ends in the future", () => {
    expect(validateAccessPeriod({ status: "trial", startsAt: plus(0), endsAt: plus(30 * DAY) }, NOW)).toBeNull();
  });

  it("accepts an explicitly open-ended period", () => {
    // §5 permits it, but only as a choice -- see the route, which refuses an ABSENT end date.
    expect(validateAccessPeriod({ status: "active", startsAt: plus(0), endsAt: null }, NOW)).toBeNull();
  });

  it("accepts a future start, because §15 makes that Scheduled rather than invalid", () => {
    expect(validateAccessPeriod({ status: "trial", startsAt: plus(7 * DAY), endsAt: plus(37 * DAY) }, NOW)).toBeNull();
  });

  it("refuses a basis that is not one the gate accepts", () => {
    // "expired" is a state a period ENDS in. Starting one there would create a practice born locked out.
    expect(validateAccessPeriod({ status: "expired", startsAt: plus(0), endsAt: plus(DAY) }, NOW)?.code)
      .toBe("INVALID_BASIS");
    expect(validateAccessPeriod({ status: "suspended", startsAt: plus(0), endsAt: plus(DAY) }, NOW)?.code)
      .toBe("INVALID_BASIS");
  });

  it("refuses an end equal to the start, not only one before it", () => {
    // §5 says "end <= start", and the equal case is the one an off-by-one implementation lets through.
    const r = validateAccessPeriod({ status: "trial", startsAt: plus(DAY), endsAt: plus(DAY) }, NOW);
    expect(r?.code).toBe("INVALID_INTERVAL");
    expect(r?.status).toBe(422);
  });

  it("reports the ORDER problem, not the past problem, when a period both inverts and lapses", () => {
    // Starts now, ends yesterday. Both rules are broken; only one of them tells the caller what to fix.
    expect(validateAccessPeriod({ status: "trial", startsAt: plus(0), endsAt: plus(-DAY) }, NOW)?.code)
      .toBe("INVALID_INTERVAL");
  });

  it("refuses a whole period behind now, which is what a reactivation form invites", () => {
    const r = validateAccessPeriod({ status: "trial", startsAt: plus(-30 * DAY), endsAt: plus(-DAY) }, NOW);
    expect(r?.code).toBe("END_IN_THE_PAST");
  });

  it("refuses an end exactly at now -- a period with no remaining life is not access", () => {
    expect(validateAccessPeriod({ status: "trial", startsAt: plus(-DAY), endsAt: plus(0) }, NOW)?.code)
      .toBe("END_IN_THE_PAST");
  });

  it("refuses unparseable instants rather than passing them to the database", () => {
    expect(validateAccessPeriod({ status: "trial", startsAt: "not a date", endsAt: plus(DAY) }, NOW)?.code)
      .toBe("INVALID_TIMESTAMP");
    expect(validateAccessPeriod({ status: "trial", startsAt: plus(0), endsAt: "soon" }, NOW)?.code)
      .toBe("INVALID_TIMESTAMP");
  });

  it("every basis it accepts is one the access gate grants on", () => {
    // ⚠ THE ASSERTION THAT KEEPS THIS HONEST. If somebody adds a basis here that resolveWorkspaceContext
    // does not admit, provisioning would create a practice with a period that validates and never opens.
    for (const basis of ACCESS_BASES)
      expect(validateAccessPeriod({ status: basis, startsAt: plus(0), endsAt: plus(DAY) }, NOW)).toBeNull();
  });
});

describe("§5 -- the arithmetic the wizard shows and the server stores", () => {
  it("endOfPeriod adds whole days", () => {
    expect(endOfPeriod(at("2026-09-02T12:00:00.000Z"), 30)).toBe("2026-10-02T12:00:00.000Z");
  });

  it("daysBetween rounds up, so a part-day still counts as a day of access", () => {
    expect(daysBetween(NOW, NOW + 30 * DAY)).toBe(30);
    expect(daysBetween(NOW, NOW + 30 * DAY + 1)).toBe(31);
  });

  it("every offered preset produces a period the rules accept", () => {
    // The presets and the validator are two halves of the same promise: a button that produces a
    // refusal is a button that should not be on the screen.
    for (const days of ACCESS_PRESET_DAYS) {
      const endsAt = endOfPeriod(NOW, days);
      expect(validateAccessPeriod({ status: "trial", startsAt: new Date(NOW).toISOString(), endsAt }, NOW)).toBeNull();
      expect(daysBetween(NOW, endsAt)).toBe(days);
    }
  });
});
