import { describe, it, expect } from "vitest";
import { checkDeploymentReadiness } from "@/lib/operations/deployment-readiness";

// COMP-027 is a GATE: shift-staff/route.ts refuses a deployment with 409 when `blocked` is true, and the
// allocator in assignment-engine reads the same boolean to decide who is assignable. So the only question
// that matters here is what it answers when it CANNOT READ the governed record.
//
// It used to answer "cleared". The read discarded its error, an empty array produced no critical failures,
// and the function returned blocked:false / reason:null for a record it had never seen. Worse, the route then
// logged `action: "deploy_staff"` with `readiness_override: undefined` — so a deployment that was never
// checked became permanently indistinguishable from one that passed.

/* eslint-disable @typescript-eslint/no-explicit-any */

const FAIL = { message: "canceling statement due to statement timeout" };

/** Stand-in for .from().select().eq().limit() — awaited directly, so the chain is thenable. */
function stubAdmin(result: { data: unknown; error: unknown } | { throws: true }) {
  return {
    from() {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        limit: () => chain,
        then: (res: any, rej: any) => ("throws" in result ? rej(new Error("connection lost")) : res(result)),
      };
      return chain;
    },
  };
}

const ok = (rows: unknown[]) => ({ data: rows, error: null });
const CRITICAL = { outcome: "requires_remediation", critical_failure: true, expiry_date: null, framework_competencies: { name: "Central line care" } };
const CLEAN = { outcome: "competent", critical_failure: false, expiry_date: "2099-01-01", framework_competencies: { name: "Hand hygiene" } };

describe("checkDeploymentReadiness — the COMP-027 gate", () => {
  it("BLOCKS when the competency record cannot be read, instead of clearing the worker", async () => {
    const r = await checkDeploymentReadiness(stubAdmin({ data: null, error: FAIL }), "nurse-1");

    expect(r.blocked).toBe(true);          // ← the route's 409 hangs off this
    expect(r.unavailable).toBe(true);      // ← and the audit action hangs off this
    expect(r.reason).toContain("could not be read");
  });

  it("blocks on a thrown read too", async () => {
    const r = await checkDeploymentReadiness(stubAdmin({ throws: true }), "nurse-1");
    expect(r.blocked).toBe(true);
    expect(r.unavailable).toBe(true);
  });

  it("reports NO failures it did not see — an unreadable record must not fabricate counts either", async () => {
    const r = await checkDeploymentReadiness(stubAdmin({ data: null, error: FAIL }), "nurse-1");
    expect(r.criticalFailures).toBe(0);
    expect(r.expiredCount).toBe(0);
    expect(r.criticalCompetencies).toEqual([]);
    // `unavailable` is therefore the ONLY thing separating this from a clean pass — which is why the route
    // must branch on it rather than on the counts.
  });

  it("an unverifiable result is DISTINGUISHABLE from a clean pass", async () => {
    const unread = await checkDeploymentReadiness(stubAdmin({ data: null, error: FAIL }), "nurse-1");
    const clear = await checkDeploymentReadiness(stubAdmin(ok([CLEAN])), "nurse-1");

    expect(clear.blocked).toBe(false);
    expect(clear.unavailable).toBe(false);
    // The regression that would let the audit trail lie again: these two agreeing.
    expect(unread.unavailable).not.toBe(clear.unavailable);
  });

  it("still blocks a real unresolved critical failure, and names it", async () => {
    const r = await checkDeploymentReadiness(stubAdmin(ok([CRITICAL, CLEAN])), "nurse-1");
    expect(r).toMatchObject({ blocked: true, unavailable: false, criticalFailures: 1 });
    expect(r.criticalCompetencies).toEqual(["Central line care"]);
    expect(r.reason).toContain("governed override");
  });

  it("still clears a worker with a readable, clean record", async () => {
    const r = await checkDeploymentReadiness(stubAdmin(ok([CLEAN])), "nurse-1");
    expect(r).toMatchObject({ blocked: false, unavailable: false, reason: null, criticalFailures: 0 });
  });

  it("still warns (without blocking) on an expired competency", async () => {
    const r = await checkDeploymentReadiness(stubAdmin(ok([{ ...CLEAN, expiry_date: "2020-01-01" }])), "nurse-1");
    expect(r.blocked).toBe(false);
    expect(r.expiredCount).toBe(1);
    expect(r.warning).toContain("expired");
  });

  it("an empty-but-READABLE record clears — absence of decisions is not the same as an unreadable table", async () => {
    const r = await checkDeploymentReadiness(stubAdmin(ok([])), "nurse-1");
    expect(r).toMatchObject({ blocked: false, unavailable: false });
  });
});
