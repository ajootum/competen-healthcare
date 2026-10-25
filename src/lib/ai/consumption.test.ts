/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { ATTRIBUTION, budgetPeriod, openingCeiling, resolveBudgetPolicy, resolveOwner, resolveRouting } from "./consumption";

// COMPETEN-HOLDINGS-AI-CONSUMPTION-01: who pays is decided from the workflow, and a budget's policy fails closed.

describe("AI consumption ownership", () => {
  it("a student's own case work is the student's; screening, de-duplication, promotion and shared variations are the platform's", () => {
    for (const w of ["case.private_generate", "case.private_interact", "case.feedback", "case.live_with_stored"] as const) expect(ATTRIBUTION[w]).toBe("individual");
    for (const w of ["case.candidate_screen", "case.dedupe", "case.promote", "case.shared_variation"] as const) expect(ATTRIBUTION[w]).toBe("platform");
    expect(ATTRIBUTION["case.replay_stored"]).toBe("none");
    expect(ATTRIBUTION["case.educator_develop"]).toBe("platform_or_institution");
    expect(ATTRIBUTION["case.institution_commission"]).toBe("institution");
  });

  it("CKRI (KNOWLEDGE-RESEARCH-01 s9): knowledge development and research analysis are platform or institution work, never a student's", async () => {
    for (const w of ["knowledge.educator_develop", "research.analysis_assist"] as const) expect(ATTRIBUTION[w]).toBe("platform_or_institution");
    // With no budget assigned, a student's request is REFUSED, never charged to the student.
    const admin = { from: () => { const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }) }; return q; } };
    for (const w of ["knowledge.educator_develop", "research.analysis_assist"] as const) {
      const r: any = await resolveOwner(admin, w, "scholar", { userId: "00000000-0000-4000-8000-000000000001" });
      expect(r.type).not.toBe("individual");
      expect(r).toMatchObject({ refused: "no_budget" });
    }
  });

  it("an unpublished budget policy funds nothing: zero ceiling, no activities, no automated processing", () => {
    const p = resolveBudgetPolicy(null);
    expect(p).toMatchObject({ ceilingCau: 0, activities: {}, automatedLimit: null, carryForward: "none", unreconciledCapCau: 0 });
  });

  it("clamps a budget policy and keeps only valid activity codes", () => {
    const p = resolveBudgetPolicy({ ceilingCau: -5, activities: { case_steps: { capPerPeriod: 10 }, "Bad Code": {}, teach: {} }, automatedLimit: "20", alertAtPct: 400, carryForward: "unused", carryCapCau: 50 });
    expect(p.ceilingCau).toBe(0);
    expect(Object.keys(p.activities)).toEqual(["case_steps", "teach"]);
    expect(p.activities.case_steps.capPerPeriod).toBe(10);
    expect(p.activities.teach.capPerPeriod).toBeNull();
    expect(p.automatedLimit).toBe(20);
    expect(p.alertAtPct).toBe(100);
  });

  it("routing only maps known workflows to valid budget codes", () => {
    expect(resolveRouting({ workflows: { "case.candidate_screen": "platform.scholar.cases", "case.invented": "x.y.z", "case.dedupe": "Bad Code" } }))
      .toEqual({ "case.candidate_screen": "platform.scholar.cases" });
  });

  it("budgets are kept by calendar month, and carry forward only what the policy allows", () => {
    const { start, end } = budgetPeriod(new Date("2026-10-24T15:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    const none = resolveBudgetPolicy({ ceilingCau: 1000 });
    const carry = resolveBudgetPolicy({ ceilingCau: 1000, carryForward: "unused", carryCapCau: 200 });
    expect(openingCeiling(none, { included: 1000, used: 100, reserved: 0 })).toBe(1000);
    expect(openingCeiling(carry, { included: 1000, used: 100, reserved: 0 })).toBe(1200);
    expect(openingCeiling(carry, { included: 1000, used: 950, reserved: 0 })).toBe(1050);
    expect(openingCeiling(carry, null)).toBe(1000);
  });
});
