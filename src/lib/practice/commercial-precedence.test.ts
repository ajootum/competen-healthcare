/**
 * CPR-PD-PROV-001 §12 / AC-10 -- the precedence statement, as assertions.
 *
 * The prose is docs/adr/ADR-015-practice-commercial-precedence.md. These are the rungs it defines, in
 * the order it defines them, so a change to the rule breaks a test rather than only a paragraph.
 *
 * ⚠ RUNG 3 JUDGES THE PERIOD, NOT THE WORKSPACE (migration 368). These tests were originally written
 * against "has this practice ever paid", which asked the wrong question -- see the courtesy-extension
 * case below, which passed under the old rule while warning about something untrue.
 */
import { describe, it, expect } from "vitest";
import { judgeOverride, type CommercialAuthority } from "./commercial-precedence";

const DAY = 86_400_000;
const ahead = (d: number) => new Date(Date.now() + d * DAY).toISOString();
const back = (d: number) => new Date(Date.now() - d * DAY).toISOString();

const authority = (over: Partial<CommercialAuthority> = {}): CommercialAuthority => ({
  governedBy: "entitlement", workspaceStatus: "ACTIVE",
  subscription: null, billingLive: false, currentPeriod: null, problems: [], ...over,
});

/** A practice whose CURRENT period was written by a settled payment. */
const paidPeriod = (endsAt: string | null) => authority({
  subscription: { planCode: "practice_solo_ugx", status: "active", periodEnd: endsAt },
  billingLive: true,
  currentPeriod: { source: "payment", endsAt, grantsAccessNow: true },
});

/** A practice whose current period a Director wrote, whatever else has happened to it before. */
const directorPeriod = (endsAt: string | null, over: Partial<CommercialAuthority> = {}) => authority({
  currentPeriod: { source: "director", endsAt, grantsAccessNow: true }, ...over,
});

describe("rung 1 -- administrative suspension outranks every commercial fact", () => {
  it("refuses a grant into an administratively closed practice", () => {
    const v = judgeOverride(authority({ governedBy: "administrative", workspaceStatus: "SUSPENDED" }),
      { kind: "grant", proposedEndsAt: ahead(30), acknowledged: false });
    expect(v.allowed).toBe(false);
    expect((v as any).code).toBe("ADMINISTRATIVELY_CLOSED");
    expect((v as any).message).toContain("SUSPENDED");
  });

  it("outranks even an acknowledged override, because acknowledgement is about billing not lifecycle", () => {
    const v = judgeOverride(authority({ governedBy: "administrative", workspaceStatus: "ARCHIVED" }),
      { kind: "grant", proposedEndsAt: ahead(30), acknowledged: true });
    expect(v.allowed).toBe(false);
  });

  it("refuses when the authority could not be read, rather than assuming it is fine", () => {
    const v = judgeOverride(authority({ governedBy: "unreadable", workspaceStatus: null }),
      { kind: "end", acknowledged: true });
    expect(v.allowed).toBe(false);
    expect((v as any).code).toBe("AUTHORITY_UNREADABLE");
  });
});

describe("rung 3 -- a period a PAYMENT wrote may be overridden, but never silently", () => {
  it("refuses an unacknowledged END of a paid period", () => {
    const v = judgeOverride(paidPeriod(ahead(20)), { kind: "end", acknowledged: false });
    expect(v.allowed).toBe(false);
    expect((v as any).code).toBe("BILLING_OVERRIDE_UNACKNOWLEDGED");
  });

  it("ALLOWS the same act once acknowledged -- the rule is about silence, not the act", () => {
    const v = judgeOverride(paidPeriod(ahead(20)), { kind: "end", acknowledged: true });
    expect(v.allowed).toBe(true);
    expect((v as any).acknowledgementRequired).toBe(true);
    expect((v as any).because).toContain("paid");
  });

  it("refuses an unacknowledged grant that would END BEFORE the paid period does", () => {
    const v = judgeOverride(paidPeriod(ahead(60)), { kind: "grant", proposedEndsAt: ahead(10), acknowledged: false });
    expect(v.allowed).toBe(false);
    expect((v as any).message).toContain("paid until");
  });

  it("asks NOTHING of a grant that extends beyond the paid period", () => {
    // ⚠ THE ASYMMETRY IS DELIBERATE. Extending a paid practice is a gift, not a conflict. Demanding a
    // ceremony for it trains Directors to click through the ceremony, which is how a real warning
    // stops being read.
    const v = judgeOverride(paidPeriod(ahead(20)), { kind: "grant", proposedEndsAt: ahead(90), acknowledged: false });
    expect(v).toEqual({ allowed: true, acknowledgementRequired: false });
  });

  it("still judges from the PERIOD when no subscription row corroborates it", () => {
    // A payment wrote the period; the subscription row is missing or unreadable. The period is authority
    // enough on its own -- the row only supplies the plan name for the message.
    const a = authority({ currentPeriod: { source: "payment", endsAt: ahead(15), grantsAccessNow: true } });
    const v = judgeOverride(a, { kind: "end", acknowledged: false });
    expect(v.allowed).toBe(false);
    expect((v as any).code).toBe("BILLING_OVERRIDE_UNACKNOWLEDGED");
  });
});

describe("migration 368 -- the cases the per-WORKSPACE rule got wrong", () => {
  it("does NOT warn when shortening a Director's own courtesy extension, even after a lapsed payment", () => {
    // ⚠ THE CASE THE COLUMN EXISTS FOR. Under the old rule this practice "had paid", so a Director
    // revising their own 14-day goodwill period was told they were overriding a payment -- one that had
    // ended weeks earlier and had nothing to do with the period being changed. The warning was false.
    const a = directorPeriod(ahead(14), {
      subscription: { planCode: "practice_solo_ugx", status: "active", periodEnd: ahead(40) },
      billingLive: true,
    });
    const v = judgeOverride(a, { kind: "grant", proposedEndsAt: ahead(7), acknowledged: false });
    expect(v).toEqual({ allowed: true, acknowledgementRequired: false });
  });

  it("does not warn when ending a Director-written period either", () => {
    const v = judgeOverride(directorPeriod(ahead(14)), { kind: "end", acknowledged: false });
    expect(v).toEqual({ allowed: true, acknowledgementRequired: false });
  });

  it("treats a period written before the column existed as NOT billing-authoritative", () => {
    // `unknown` is an admission, and the safe reading of an admission is the one that does not claim
    // authority it cannot demonstrate. Safe in fact as well as in principle: no payment had ever
    // settled when migration 368 backfilled.
    const a = authority({ currentPeriod: { source: "unknown", endsAt: ahead(14), grantsAccessNow: true } });
    expect(judgeOverride(a, { kind: "end", acknowledged: false }).allowed).toBe(true);
  });

  it("treats a provisioning trial as not billing-authoritative", () => {
    const a = authority({ currentPeriod: { source: "provisioning", endsAt: ahead(14), grantsAccessNow: true } });
    expect(judgeOverride(a, { kind: "end", acknowledged: false }).allowed).toBe(true);
  });
});

describe("nothing granting access is nothing to take away", () => {
  it("reactivating an expired practice asks no ceremony, even one that paid before", () => {
    const a = authority({
      subscription: { planCode: "p", status: "active", periodEnd: back(1) },
      billingLive: false, currentPeriod: null,
    });
    expect(judgeOverride(a, { kind: "grant", proposedEndsAt: ahead(30), acknowledged: false })).toEqual(
      { allowed: true, acknowledgementRequired: false });
  });

  it("a practice with no period at all is the ordinary case", () => {
    expect(judgeOverride(authority(), { kind: "end", acknowledged: false })).toEqual(
      { allowed: true, acknowledgementRequired: false });
  });

  it("a paid period that has already lapsed is not live authority", () => {
    // grantsAccessNow false -- the payment bought a window that has closed.
    const a = authority({ currentPeriod: { source: "payment", endsAt: back(1), grantsAccessNow: false } });
    expect(judgeOverride(a, { kind: "end", acknowledged: false }).allowed).toBe(true);
  });
});
