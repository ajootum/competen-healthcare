/**
 * CPR-PD-PROV-001 §4 step 2 -- the wizard's form-to-instants conversion.
 *
 * ⚠ THE CASE THAT MATTERS MOST IS THE EMPTY ONE. A date input starts empty, and
 * `new Date("T23:59:59.999Z").toISOString()` throws a RangeError -- so the naive version of this
 * function crashes the Access step the moment somebody clicks the custom-date field before typing in it.
 * A refusal is a state the step renders; an exception is a blank screen.
 */
import { describe, it, expect } from "vitest";
import { resolveAccessPeriod, type ProvAccess } from "./_provisioning-steps";

const form = (over: Partial<ProvAccess> = {}): ProvAccess => ({
  planCode: "practice_trial", basis: "trial",
  startMode: "now", startDate: "",
  endMode: "days", days: 30, endDate: "",
  ...over,
});

describe("resolveAccessPeriod", () => {
  it("a duration from now produces that many days", () => {
    const r = resolveAccessPeriod(form({ days: 30 }));
    expect(r.problem).toBeNull();
    expect(r.days).toBe(30);
    expect(Date.parse(r.endsAt!) - Date.parse(r.startsAt!)).toBe(30 * 86_400_000);
  });

  it("a custom end date runs to the END of that day, not its midnight", () => {
    // ⚠ Resolving to midnight would silently cut the last day off every custom period.
    const r = resolveAccessPeriod(form({ endMode: "date", endDate: "2027-01-31" }));
    expect(r.problem).toBeNull();
    expect(r.endsAt).toBe("2027-01-31T23:59:59.999Z");
  });

  it("an EMPTY custom end date refuses instead of throwing", () => {
    const r = resolveAccessPeriod(form({ endMode: "date", endDate: "" }));
    expect(r.problem).toBe("Choose the date access ends.");
    expect(r.endsAt).toBeNull();
  });

  it("an EMPTY future start date refuses instead of throwing", () => {
    const r = resolveAccessPeriod(form({ startMode: "later", startDate: "" }));
    expect(r.problem).toBe("Choose the date access starts.");
  });

  it("open-ended resolves to a start and no end", () => {
    const r = resolveAccessPeriod(form({ endMode: "open" }));
    expect(r.problem).toBeNull();
    expect(r.endsAt).toBeNull();
    expect(r.days).toBeNull();
    expect(r.startsAt).not.toBeNull();
  });

  it("a future start with a duration measures the duration FROM that start", () => {
    // Not from today: 30 days of access beginning next month is 30 days, not 30-minus-the-wait.
    const r = resolveAccessPeriod(form({ startMode: "later", startDate: "2027-03-01", days: 30 }));
    expect(r.problem).toBeNull();
    expect(r.startsAt).toBe("2027-03-01T00:00:00.000Z");
    expect(r.endsAt).toBe("2027-03-31T00:00:00.000Z");
    expect(r.days).toBe(30);
  });

  it("a zero or negative duration refuses", () => {
    expect(resolveAccessPeriod(form({ days: 0 })).problem).toBe("Choose how many days of access.");
    expect(resolveAccessPeriod(form({ days: -5 })).problem).toBe("Choose how many days of access.");
  });

  it("a period wholly in the past refuses, naming the consequence", () => {
    // ⚠ BOTH INSTANTS BEHIND NOW, and the end still after the start -- otherwise the ORDER rule fires
    // first and says something different. That precedence is deliberate (see entitlement-period.ts):
    // for a period starting now and ending in 2020, "the end must be after the start" is the sentence
    // that tells somebody what to change.
    const r = resolveAccessPeriod(form({
      startMode: "later", startDate: "2020-01-01", endMode: "date", endDate: "2020-06-01",
    }));
    expect(r.problem).toContain("already passed");
    expect(r.problem).toContain("locked out");
  });

  it("and a past end with a start of NOW reports the order instead", () => {
    const r = resolveAccessPeriod(form({ endMode: "date", endDate: "2020-01-01" }));
    expect(r.problem).toBe("The end must be after the start.");
  });

  it("a custom end BEFORE a chosen start reports the order, which is the fixable half", () => {
    const r = resolveAccessPeriod(form({
      startMode: "later", startDate: "2027-06-01", endMode: "date", endDate: "2027-05-01",
    }));
    expect(r.problem).toBe("The end must be after the start.");
  });
});
