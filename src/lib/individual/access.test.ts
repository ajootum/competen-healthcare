import { describe, it, expect } from "vitest";
import {
  foldAccess, readIndividualAccess, decideLanding, effectivePrimary, validatePrimaryChoice, type IndividualMembership,
} from "./access";

// ADR-016 gate 3. These execute the resolver's branches -- the acceptance criteria of COMPETEN-IND-003 s5
// that do not need a database: one person holding both experiences, a person holding one, direct
// Professional entry, the primary preference, and every way the store can fail to answer.

/* eslint-disable @typescript-eslint/no-explicit-any */

const MEMBER = { id: "m1", status: "active", primary_experience: null, onboarded_at: "2026-10-01T00:00:00Z", granted_at: "2026-09-30T00:00:00Z" };
const ok = (data: unknown) => ({ data, error: null });
const live = (...codes: string[]) => ok(codes.map(experience_code => ({ experience_code })));
const failed = { data: null, error: { code: "08006", message: "connection failure" } };
const absent = { data: null, error: { code: "PGRST205", message: "not in schema cache" } };

describe("foldAccess", () => {
  it("admits a member holding BOTH experiences, in registry order whatever the row order", () => {
    const a: any = foldAccess(ok(MEMBER), live("professional", "scholar"));
    expect(a.state).toBe("member");
    expect(a.live).toEqual(["scholar", "professional"]);
  });

  it("admits a member holding only Professional -- direct entry, no Scholar prerequisite", () => {
    const a: any = foldAccess(ok(MEMBER), live("professional"));
    expect(a.live).toEqual(["professional"]);
  });

  it("admits a member with NO live experience as a member, so the landing can say so", () => {
    const a: any = foldAccess(ok(MEMBER), live());
    expect(a.state).toBe("member");
    expect(a.live).toEqual([]);
  });

  it("ignores an experience code the registry does not know", () => {
    const a: any = foldAccess(ok(MEMBER), live("scholar", "recruitment"));
    expect(a.live).toEqual(["scholar"]);
  });

  it("refuses a person with no membership row", () => {
    expect(foldAccess(ok(null), null)).toEqual({ state: "none", reason: "no_membership" });
  });

  it.each([["suspended", "suspended"], ["revoked", "revoked"]])("refuses a %s membership", (status, reason) => {
    expect(foldAccess(ok({ ...MEMBER, status }), null)).toEqual({ state: "none", reason });
  });

  // ⚠ FAIL CLOSED. ADR-015's "unreadable is not permission".
  it("is unavailable, not admitted, when the membership read fails", () => {
    expect(foldAccess(failed, null)).toEqual({ state: "unavailable" });
  });

  it("is unavailable, not 'no experiences', when the entitlement read fails for a member", () => {
    expect(foldAccess(ok(MEMBER), failed)).toEqual({ state: "unavailable" });
  });

  it("calls a missing table 'not provisioned', a kind of no-access, never unavailable", () => {
    expect(foldAccess(absent, null)).toEqual({ state: "none", reason: "not_provisioned" });
  });

  it("drops an unknown primary preference rather than trusting it", () => {
    const a: any = foldAccess(ok({ ...MEMBER, primary_experience: "enterprise" }), live("scholar"));
    expect(a.membership.primaryExperience).toBeNull();
  });
});

describe("readIndividualAccess", () => {
  function stub(byTable: Record<string, unknown>, throwOn?: string) {
    const reads: string[] = [];
    const admin = {
      from(table: string) {
        reads.push(table);
        if (table === throwOn) throw new Error("network");
        const result = byTable[table] ?? ok(null);
        const chain: any = new Proxy({}, { get(_t, p) { return p === "then" ? (res: any) => res(result) : () => chain; } });
        return chain;
      },
    };
    return { admin, reads };
  }

  it("reads liveness from the DB-clock view, never the raw ledger", async () => {
    const { admin, reads } = stub({ individual_membership: ok(MEMBER), individual_live_entitlement: live("scholar") });
    const a: any = await readIndividualAccess(admin, "u1");
    expect(a.live).toEqual(["scholar"]);
    expect(reads).toEqual(["individual_membership", "individual_live_entitlement"]);
    expect(reads).not.toContain("individual_entitlement");
  });

  it("does not read entitlements for a non-member", async () => {
    const { admin, reads } = stub({ individual_membership: ok(null) });
    await readIndividualAccess(admin, "u1");
    expect(reads).toEqual(["individual_membership"]);
  });

  it("is unavailable when the client throws", async () => {
    const { admin } = stub({}, "individual_membership");
    expect(await readIndividualAccess(admin, "u1")).toEqual({ state: "unavailable" });
  });
});

describe("landing and primary experience", () => {
  const m = (over: Partial<IndividualMembership> = {}): IndividualMembership =>
    ({ id: "m1", status: "active", primaryExperience: null, onboardedAt: "2026-10-01", grantedAt: null, ...over });

  it("sends a member who has not finished onboarding to the welcome", () => {
    expect(decideLanding(m({ onboardedAt: null }), ["professional"])).toEqual({ kind: "welcome" });
  });

  it("honours the primary experience while it is live", () => {
    expect(decideLanding(m({ primaryExperience: "professional" }), ["scholar", "professional"]))
      .toEqual({ kind: "experience", experience: "professional" });
  });

  // Graduated, then Scholar ended: the preference must not strand them on a door that refuses.
  it("falls back when the primary experience is no longer live", () => {
    expect(decideLanding(m({ primaryExperience: "scholar" }), ["professional"]))
      .toEqual({ kind: "experience", experience: "professional" });
  });

  it("states the no-experience case rather than picking one", () => {
    expect(decideLanding(m({ primaryExperience: "scholar" }), [])).toEqual({ kind: "no_experience" });
  });

  it("effectivePrimary never returns an experience that is not live", () => {
    expect(effectivePrimary("scholar", ["professional"])).toBe("professional");
    expect(effectivePrimary(null, [])).toBeNull();
  });

  it("accepts as primary only an experience that is live for the person", () => {
    expect(validatePrimaryChoice("scholar", ["scholar", "professional"])).toBe("scholar");
    expect(validatePrimaryChoice("scholar", ["professional"])).toBeNull();
    expect(validatePrimaryChoice("practice", ["scholar"])).toBeNull();
    expect(validatePrimaryChoice(undefined, ["scholar"])).toBeNull();
  });
});
