import { describe, it, expect } from "vitest";
import { loadSafety } from "@/lib/qaw/safety";
import { loadAuditTrail } from "@/lib/qaw/audit-trail";

// Four compliance figures that a quality lead reads as permission to look elsewhere:
//
//   safety      "Patient safety events", "Open investigations"
//   audit-trail "Compliance issues", "Open action items"
//
// All four were produced by reads that discarded their errors, so an unread table rendered as a reassuring
// zero on a governance board. The rule these assert is the one already written on the practice patient
// record: A FIGURE THAT COULD NOT BE READ IS NOT A NOUGHT — it is an em dash, with the source named.

/* eslint-disable @typescript-eslint/no-explicit-any */

const FAIL = { message: "canceling statement due to statement timeout" };

/** PostgREST stand-in; `byTable` supplies each table's result, anything unlisted resolves empty-ok. */
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

const INCIDENT = { id: "i1", incident_type: "fall", severity: "high", near_miss: false, status: "investigating", reported_by_name: "N", description: "d", created_at: "2026-08-01T00:00:00Z" };
const withIncidents = { data: [INCIDENT], error: null };

describe("loadSafety — an unread table must not calm the safety board", () => {
  it("nulls the escalation-dependent figure and names the source", async () => {
    const d: any = await loadSafety(stubAdmin({ op_incidents: withIncidents, op_escalations: { data: null, error: FAIL } }), "h1", false);

    expect(d.unavailable).toContain("escalations");
    expect(d.kpis.openInvestigations).toBeNull();   // ← would have been 1 (the investigating incident) + 0
  });

  it("nulls the patient-safety-event figures when the alert table cannot be read", async () => {
    const d: any = await loadSafety(stubAdmin({ op_incidents: withIncidents, op_safety_alerts: { data: null, error: FAIL } }), "h1", false);

    expect(d.unavailable).toContain("safety alerts");
    expect(d.kpis.pse).toBeNull();
    expect(d.kpis.activePse).toBeNull();
  });

  it("still reports real zeros when every table responds", async () => {
    const d: any = await loadSafety(stubAdmin({ op_incidents: withIncidents }), "h1", false);

    expect(d.unavailable).toEqual([]);
    expect(d.kpis.pse).toBe(0);
    expect(d.kpis.openInvestigations).toBe(1);
    // The distinction the change exists for: a genuine 0 and an unreadable table must not agree.
  });
});

describe("loadAuditTrail — 'no compliance issues' must be earned", () => {
  it("nulls the obligations figure and names the source", async () => {
    const d: any = await loadAuditTrail(stubAdmin({ gov_obligations: { data: null, error: FAIL } }), "h1", false);

    expect(d.unavailable).toContain("compliance obligations");
    expect(d.kpis.complianceIssues).toBeNull();
  });

  it("nulls the corrective-action figure and names the source", async () => {
    const d: any = await loadAuditTrail(stubAdmin({ capa_actions: { data: null, error: FAIL } }), "h1", false);

    expect(d.unavailable).toContain("corrective actions");
    expect(d.kpis.openActions).toBeNull();
  });

  it("still reports real zeros when every table responds", async () => {
    const d: any = await loadAuditTrail(stubAdmin({}), "h1", false);

    expect(d.unavailable).toEqual([]);
    expect(d.kpis.complianceIssues).toBe(0);
    expect(d.kpis.openActions).toBe(0);
  });
});
