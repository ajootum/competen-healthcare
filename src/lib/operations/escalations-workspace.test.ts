import { describe, it, expect } from "vitest";
import { loadEscalations } from "@/lib/operations/escalations-workspace";
import { loadExecutiveActionCentre } from "@/lib/operations/unit-command";

// Two loaders whose empty state is rendered as an ALL-CLEAR:
//
//   unit-manager/escalations/page.tsx  →  "✅ No open escalations. All escalations are resolved."
//   unit-manager/action-centre/page.tsx →  "Nothing in the queue — no open escalations, incidents,
//                                           improvement actions or pending validations."
//
// Both sentences were printed off `.length === 0` from reads that discarded their errors, so "nobody needs
// you" and "we could not look" rendered identically — with a green tick on one of them. An escalation queue
// is the list where that matters most: it exists to make somebody act.

/* eslint-disable @typescript-eslint/no-explicit-any */

const FAIL = { message: "canceling statement due to statement timeout" };

/**
 * PostgREST stand-in. `byTable` gives the result for each table; anything unlisted resolves empty-ok.
 * The chain is thenable because these loaders await the builder directly.
 */
function stubAdmin(byTable: Record<string, { data: unknown; error: unknown }>) {
  return {
    from(table: string) {
      const result = byTable[table] ?? { data: [], error: null };
      const chain: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") return (res: any) => res(result);
          if (prop === "limit") return () => chain;
          return () => chain;
        },
      });
      return chain;
    },
  };
}

const OK: { data: unknown; error: unknown } = { data: [], error: null };

describe("loadEscalations — the ✅ must not be printed for an unread queue", () => {
  it("reports unavailable when the queue read fails, rather than an empty board", async () => {
    const d: any = await loadEscalations(stubAdmin({ op_escalations: { data: null, error: FAIL } }), "h1", false);

    expect(d.provisioned).toBe(true);        // the table exists — this is not the pre-migration case
    expect(d.unavailable).toBe(true);        // ← the page's honest branch hangs off this
    expect(d.board).toBeUndefined();         // and there is no empty board to render a tick from
  });

  it("a genuinely empty queue is still reported as empty, not unavailable", async () => {
    const d: any = await loadEscalations(stubAdmin({ op_escalations: OK }), "h1", false);

    expect(d.provisioned).toBe(true);
    expect(d.unavailable).toBe(false);
    expect(d.board).toEqual([]);
    // The distinction the whole fix exists for: these two cases must not agree.
  });
});

describe("loadExecutiveActionCentre — the work queue must not claim to be complete", () => {
  it("names every source that could not be read", async () => {
    const d: any = await loadExecutiveActionCentre(stubAdmin({
      op_escalations: { data: null, error: FAIL },
      op_incidents: { data: null, error: FAIL },
      op_quality_actions: { data: null, error: FAIL },
    }), "h1", false);

    expect(d.unavailable).toEqual(expect.arrayContaining(["escalations", "incidents", "improvement actions"]));
  });

  it("names only the source that failed, and still returns what did load", async () => {
    const d: any = await loadExecutiveActionCentre(stubAdmin({
      op_escalations: { data: null, error: FAIL },
      op_incidents: OK,
      op_quality_actions: OK,
    }), "h1", false);

    expect(d.unavailable).toEqual(["escalations"]);
    expect(Array.isArray(d.items)).toBe(true);   // a partial queue is still shown — those rows are real
  });

  it("reports nothing unavailable when every source responds", async () => {
    const d: any = await loadExecutiveActionCentre(stubAdmin({}), "h1", false);
    expect(d.unavailable).toEqual([]);
  });
});
