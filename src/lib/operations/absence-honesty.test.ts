import { describe, it, expect } from "vitest";
import { loadWorkforceExceptions } from "@/lib/operations/workforce-exceptions";
import { loadCompetencyMatching } from "@/lib/operations/competency-matching";

// The last of the clinical/compliance ABSENCE reads. Each of these rendered an unread table as an all-clear:
//
//   workforce-exceptions   a shorter exception list, silently
//   competency-matching    every nurse as "None", and — worst — the panel concluding
//                          "✅ Workforce competency currency is healthy across all roles"
//
// That green tick is what this suite mainly exists to keep dead: it was a positive assertion about workforce
// safety, derived from a table nobody had queried, on the screen a manager uses to decide who may staff what.

/* eslint-disable @typescript-eslint/no-explicit-any */

const FAIL = { message: "canceling statement due to statement timeout" };
const ABSENT = { message: 'relation "op_roster_exceptions" does not exist' };

function stubAdmin(byTable: Record<string, { data: unknown; error: unknown }>) {
  return {
    from(table: string) {
      const result = byTable[table] ?? { data: [], error: null };
      const chain: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") return (res: any) => res(result);
          return () => chain;
        },
      });
      return chain;
    },
  };
}

describe("loadWorkforceExceptions", () => {
  it("names a source that failed to read", async () => {
    const d: any = await loadWorkforceExceptions(stubAdmin({ op_escalations: { data: null, error: FAIL } }), "h1", false);
    expect(d.unavailable).toContain("escalations");
  });

  it("stays QUIET for a store that is merely absent — a pre-migration tenant is not a degraded one", async () => {
    const d: any = await loadWorkforceExceptions(stubAdmin({ op_roster_exceptions: { data: null, error: ABSENT } }), "h1", false);
    expect(d.unavailable).not.toContain("roster exceptions");
    // Distinguishing these two is the reason the check is `error && !missing(error)` and not just `error`.
  });

  it("reports nothing unavailable when every store responds", async () => {
    const d: any = await loadWorkforceExceptions(stubAdmin({}), "h1", false);
    expect(d.unavailable).toEqual([]);
  });
});

describe("loadCompetencyMatching", () => {
  // loadOpsConsoleData decides `ready`; with an all-empty stub it returns a real but empty operational
  // picture, which is enough to reach the competency block under test — VERIFIED by asserting d.ready in
  // each case rather than guarding on it, because a guard would make every assertion below vacuous the day
  // the backbone stub stops satisfying it.
  const run = (competency: { data: unknown; error: unknown }) =>
    loadCompetencyMatching(stubAdmin({ competency_decisions: competency }), "h1", false) as Promise<any>;

  it("NEVER concludes the workforce is healthy from a table it could not read", async () => {
    const d = await run({ data: null, error: FAIL });
    expect(d.ready).toBe(true);   // a silent early return here would make every assertion below vacuous

    expect(d.decisionsUnavailable).toBe(true);
    const texts = d.insights.map((i: any) => i.text).join(" ");
    expect(texts).not.toContain("healthy across all roles");  // ← the green tick that must stay dead
    expect(texts).toContain("could not be read");
  });

  it("marks staff Unknown rather than None — a different claim about a person", async () => {
    const d = await run({ data: null, error: FAIL });
    expect(d.ready).toBe(true);

    expect(d.staff.every((s: any) => s.status !== "None")).toBe(true);
    expect(d.kpis.expiredCerts).toBeNull();
    expect(d.kpis.expiringCerts).toBeNull();
  });

  it("still reports real figures when the table responds", async () => {
    const d = await run({ data: [], error: null });
    expect(d.ready).toBe(true);

    expect(d.decisionsUnavailable).toBe(false);
    expect(d.kpis.expiredCerts).toBe(0);
    // A readable-but-empty table is allowed to say healthy; an unreadable one is not.
  });
});
