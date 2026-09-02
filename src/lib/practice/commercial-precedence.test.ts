/**
 * CPR-PD-PROV-001 §12 / AC-10 -- the precedence statement, as assertions.
 *
 * The prose is docs/adr/ADR-015-practice-commercial-precedence.md. These are the rungs it defines, in
 * the order it defines them, so a change to the rule breaks a test rather than only a paragraph.
 */
import { describe, it, expect } from "vitest";
import { judgeOverride, type CommercialAuthority } from "./commercial-precedence";

const DAY = 86_400_000;
const ahead = (d: number) => new Date(Date.now() + d * DAY).toISOString();
const back = (d: number) => new Date(Date.now() - d * DAY).toISOString();

const authority = (over: Partial<CommercialAuthority> = {}): CommercialAuthority => ({
  governedBy: "entitlement", workspaceStatus: "ACTIVE",
  subscription: null, billingLive: false, problems: [], ...over,
});

const paid = (periodEnd: string | null) => authority({
  subscription: { planCode: "practice_solo_ugx", status: "active", periodEnd },
  billingLive: true,
});

describe("rung 1 -- administrative suspension outranks every commercial fact", () => {
  it("refuses a grant into an administratively closed practice", () => {
    // Writing a period here would produce a "saved" and a practice still shut. §12's top rung.
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
    // ⚠ A failed read must not resolve to "not suspended". That is how a caller is told to proceed
    // because the thing that would have stopped them was unreachable.
    const v = judgeOverride(authority({ governedBy: "unreadable", workspaceStatus: null }),
      { kind: "end", acknowledged: true });
    expect(v.allowed).toBe(false);
    expect((v as any).code).toBe("AUTHORITY_UNREADABLE");
  });
});

describe("rung 2 -- a live paid subscription may be overridden, but never silently", () => {
  it("refuses an unacknowledged END of a paid practice", () => {
    const v = judgeOverride(paid(ahead(20)), { kind: "end", acknowledged: false });
    expect(v.allowed).toBe(false);
    expect((v as any).code).toBe("BILLING_OVERRIDE_UNACKNOWLEDGED");
  });

  it("ALLOWS the same act once acknowledged -- the rule is about silence, not the act", () => {
    // §12 says "must not be silently overwritten". Refusing outright would send a legitimate
    // chargeback or safety suspension to the SQL editor, where nothing is audited at all.
    const v = judgeOverride(paid(ahead(20)), { kind: "end", acknowledged: true });
    expect(v.allowed).toBe(true);
    expect((v as any).acknowledgementRequired).toBe(true);
    expect((v as any).because).toContain("paid");
  });

  it("refuses an unacknowledged grant that would END BEFORE what was paid for", () => {
    const v = judgeOverride(paid(ahead(60)), { kind: "grant", proposedEndsAt: ahead(10), acknowledged: false });
    expect(v.allowed).toBe(false);
    expect((v as any).code).toBe("BILLING_OVERRIDE_UNACKNOWLEDGED");
    expect((v as any).message).toContain("paid until");
  });

  it("asks NOTHING of a grant that extends beyond what was paid for", () => {
    // ⚠ THE ASYMMETRY IS DELIBERATE. Extending a paid practice is a gift, not a conflict. Demanding a
    // ceremony for it trains Directors to click through the ceremony, which is how a real warning
    // stops being read.
    const v = judgeOverride(paid(ahead(20)), { kind: "grant", proposedEndsAt: ahead(90), acknowledged: false });
    expect(v).toEqual({ allowed: true, acknowledgementRequired: false });
  });

  it("asks nothing of an open-ended grant either", () => {
    const v = judgeOverride(paid(ahead(20)), { kind: "grant", proposedEndsAt: null, acknowledged: false });
    expect(v.allowed).toBe(true);
    expect((v as any).acknowledgementRequired).toBe(false);
  });
});

describe("a subscription that is not live is not an authority", () => {
  it("a cancelled subscription blocks nothing", () => {
    // ⚠ THE RECEIPT-NOT-A-GATE RULE. The row records what was paid; it never decided access.
    const a = authority({
      subscription: { planCode: "p", status: "cancelled", periodEnd: ahead(20) }, billingLive: false,
    });
    expect(judgeOverride(a, { kind: "end", acknowledged: false })).toEqual(
      { allowed: true, acknowledgementRequired: false });
  });

  it("a subscription whose period has run out blocks nothing", () => {
    const a = authority({
      subscription: { planCode: "p", status: "active", periodEnd: back(1) }, billingLive: false,
    });
    expect(judgeOverride(a, { kind: "end", acknowledged: false }).allowed).toBe(true);
  });

  it("a practice with no subscription at all is the ordinary case and needs no ceremony", () => {
    expect(judgeOverride(authority(), { kind: "end", acknowledged: false })).toEqual(
      { allowed: true, acknowledgementRequired: false });
    expect(judgeOverride(authority(), { kind: "grant", proposedEndsAt: ahead(30), acknowledged: false })).toEqual(
      { allowed: true, acknowledgementRequired: false });
  });
});
