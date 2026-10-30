import { describe, expect, it } from "vitest";
import { emailsIn, resolveCohortPeople, strictDoc, summariseCohortCost, summariseGateDecisions, validateModeDoc } from "./modes-admin";

// AI operating modes, HQ side: the pure aggregation and the save-time validation.

const U1 = "11111111-1111-4111-8111-111111111111", U2 = "22222222-2222-4222-8222-222222222222";
const g = (v: Record<string, unknown>) => ({ new_value: v });

describe("summariseGateDecisions", () => {
  const log = [
    g({ product: "scholar", mode: "supervised_pilot", cohort: "pilot1", decision: "served", tier: "clinical_educational", rule: "r_a", reason: "ok" }),
    g({ product: "scholar", mode: "supervised_pilot", cohort: "pilot1", decision: "clarify", tier: "high_risk_clinical", rule: "r_b", reason: "clarify_purpose" }),
    g({ product: "scholar", mode: "supervised_pilot", cohort: "pilot1", decision: "refused", tier: "high_risk_clinical", rule: "r_b", reason: "no_model" }),
    g({ product: "scholar", mode: "strict_production", cohort: null, decision: "refused", tier: "high_risk_clinical", rule: "unknown:no_rule", reason: "no_model" }),
    g({ decision: "bogus" }), { new_value: null },
  ];
  const s = summariseGateDecisions(log);
  it("counts by product, mode, cohort and decision, skipping unreadable rows", () => {
    expect(s.total).toBe(4);
    const c = s.cells.find(x => x.cohort === "pilot1")!;
    expect([c.served, c.clarify, c.refused, c.total]).toEqual([1, 1, 1, 3]);
    expect(s.cells.find(x => x.cohort === "(default)")!.refused).toBe(1);
  });
  it("tallies tiers, rules and refusal reasons only", () => {
    expect(s.byTier).toEqual([{ label: "high_risk_clinical", n: 3 }, { label: "clinical_educational", n: 1 }]);
    expect(s.topRules[0]).toEqual({ label: "r_b", n: 2 });
    expect(s.refusalReasons).toEqual([{ label: "no_model", n: 2 }]);
  });
  it("keeps the 15 most-used rules", () => {
    const many = Array.from({ length: 30 }, (_, i) => g({ product: "scholar", mode: "x", cohort: null, decision: "served", rule: `rule_${i}` }));
    expect(summariseGateDecisions(many).topRules).toHaveLength(15);
  });
  it("is empty for an empty log", () => expect(summariseGateDecisions([]).total).toBe(0));
});

describe("summariseCohortCost", () => {
  it("sums cost, tokens and requests for the named members only", () => {
    const r = summariseCohortCost(
      [{ actor_id: U1, cost_usd: "0.5", total_tokens: 100 }, { actor_id: U1.toUpperCase(), cost_usd: 0.25, total_tokens: "50" }, { actor_id: U2, cost_usd: 9, total_tokens: 9 }, { actor_id: null, cost_usd: 1 }],
      [{ product: "scholar", code: "p1", label: "Pilot", userIds: [U1] }],
    );
    expect(r).toEqual([{ product: "scholar", code: "p1", label: "Pilot", members: 1, requests: 2, costUsd: 0.75, tokens: 150 }]);
  });
});

describe("validateModeDoc", () => {
  const cohort = { code: "pilot1", label: "Pilot", mode: "supervised_pilot", userIds: [U1], entitlementSources: [], planCodes: [], hourlyLimit: 30 };
  const ok = { defaultMode: "strict_production", cohorts: [cohort], pilotRisk: { rules: [] }, clarifiableRules: ["unknown"] };
  it("accepts a valid pilot and stores the resolved shape", () => {
    const v = validateModeDoc(ok);
    expect(v.ok && v.doc.cohorts[0].hourlyLimit).toBe(30);
  });
  it("refuses Supervised Pilot as the default", () => {
    const v = validateModeDoc({ ...ok, defaultMode: "supervised_pilot" });
    expect(!v.ok && v.error).toMatch(/cannot be the default/);
  });
  it("refuses a cohort that would be dropped, rather than saving it silently", () => {
    expect(validateModeDoc({ ...ok, cohorts: [{ ...cohort, userIds: [] }] }).ok).toBe(false);
    expect(validateModeDoc({ ...ok, cohorts: [{ ...cohort, code: "Bad Code" }] }).ok).toBe(false);
    expect(validateModeDoc({ ...ok, cohorts: [cohort, cohort] }).ok).toBe(false);
  });
  it("refuses a user id that is not a UUID, and a bad hourly limit", () => {
    expect(validateModeDoc({ ...ok, cohorts: [{ ...cohort, userIds: [U1, "not-a-uuid"] }] }).ok).toBe(false);
    expect(validateModeDoc({ ...ok, cohorts: [{ ...cohort, hourlyLimit: 9999 }] }).ok).toBe(false);
  });
  it("refuses a pilot rule that is not valid", () => {
    expect(validateModeDoc({ ...ok, pilotRisk: { rules: [{ id: "x" }] } }).ok).toBe(false);
  });
  it("the strict document has no cohorts and a Strict default", () => {
    const d = strictDoc();
    expect([d.defaultMode, d.cohorts.length]).toEqual(["strict_production", 0]);
    expect(validateModeDoc(d).ok).toBe(true);
  });
});

describe("people by email", () => {
  const profiles = [{ id: U1, email: "nurse.one@example.com" }, { id: U2, email: "nurse.two@example.com" }];
  const admin = (fail = false) => ({
    from: () => ({ select: () => ({ in: async (_c: string, v: string[]) => (fail ? { data: null, error: { message: "x" } } : { data: profiles.filter(p => v.includes(p.email)), error: null }) }) }),
  });
  const doc = (userIds: unknown[]) => ({ defaultMode: "strict_production", cohorts: [{ code: "pilot1", label: "Pilot", mode: "supervised_pilot", userIds }] });

  it("finds only emails, lower-cased and once each", () => {
    expect(emailsIn([" Nurse.One@Example.com", U1, "nurse.one@example.com", "not an email", 3])).toEqual(["nurse.one@example.com"]);
  });

  it("turns emails into user ids, keeps ids, and the result validates", async () => {
    const r = await resolveCohortPeople(admin(), doc(["Nurse.One@example.com", U2]));
    expect(r.ok && r.input.cohorts[0].userIds).toEqual([U1, U2]);
    expect(r.ok && validateModeDoc(r.input).ok).toBe(true);
  });

  it("refuses an email with no account, and an unreadable lookup, instead of dropping the person", async () => {
    const missing = await resolveCohortPeople(admin(), doc(["nurse.one@example.com", "nobody@example.com"]));
    expect(missing).toMatchObject({ ok: false, error: expect.stringContaining("nobody@example.com") });
    expect(await resolveCohortPeople(admin(true), doc(["nurse.one@example.com"]))).toMatchObject({ ok: false });
  });

  it("leaves a document with no emails untouched, without a lookup", async () => {
    const d = doc([U1]);
    const r = await resolveCohortPeople({ from: () => { throw new Error("no lookup expected"); } }, d);
    expect(r.ok && r.input).toBe(d);
  });
});
