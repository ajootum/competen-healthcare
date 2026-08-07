import { describe, it, expect } from "vitest";
import { evidenceFromTask, evidenceFromMedication } from "@/lib/hww/evidence";

// The evidence bridge's header promises "a marker in notes makes each source event idempotent
// (re-completions never duplicate)". That guarantee is enforced by ONE read, and this suite exists to hold it
// to the only case where it matters: when that read fails.
//
// It used to answer `!!data` on a discarded error — "no, not bridged" for a check that never ran — so a blip
// did not skip the create, it CAUSED a second one. The assertion that matters below is therefore not the
// returned reason but INSERTS.LENGTH: a duplicate skill_log_entry is the actual harm.

/* eslint-disable @typescript-eslint/no-explicit-any */

const FAIL = { message: "canceling statement due to statement timeout" };

/**
 * Minimal PostgREST stand-in covering the three chains the bridge uses:
 *   .select().ilike().limit().maybeSingle()   — the idempotency check
 *   .select().eq().maybeSingle()              — the unit-name lookup
 *   .insert().select().single()               — the write we are counting
 */
function stubAdmin(opts: { checkError?: unknown; alreadyThere?: boolean }) {
  const inserts: any[] = [];
  const admin = {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        ilike: () => chain,
        eq: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          if (table === "skill_log_entries") {
            return { data: opts.alreadyThere ? { id: "existing-entry" } : null, error: opts.checkError ?? null };
          }
          return { data: { name: "Ward 3" }, error: null };   // units
        },
        insert: (row: any) => { inserts.push({ table, row }); return chain; },
        single: async () => ({ data: { id: "new-entry" }, error: null }),
      };
      return chain;
    },
  };
  return { admin, inserts };
}

const TASK = { id: "task-1", assigned_to: "nurse-1", patient_id: "patient-1", task_type: "procedure", description: "IV cannulation", completed_at: "2026-08-07T09:00:00Z", unit_id: "unit-1" };
const MED = { id: "med-1", outcome: "administered", administered_by: "nurse-1", administered_at: "2026-08-07T09:00:00Z", witness_id: null };
const SCHED = { unit_id: "unit-1", drug_name: "Paracetamol", route: "po", high_risk: false };

describe("evidence bridge idempotency", () => {
  it("WRITES NOTHING when the idempotency check cannot run — a duplicate is the harm", async () => {
    const { admin, inserts } = stubAdmin({ checkError: FAIL });
    const r = await evidenceFromTask(admin, TASK);

    expect(r.created).toBe(false);
    expect(inserts).toHaveLength(0);                      // ← the assertion that matters
    expect(r.reason).toContain("idempotency check unavailable");
  });

  it("same for a medication administration", async () => {
    const { admin, inserts } = stubAdmin({ checkError: FAIL });
    const r = await evidenceFromMedication(admin, MED, SCHED);

    expect(r.created).toBe(false);
    expect(inserts).toHaveLength(0);
    expect(r.reason).toContain("idempotency check unavailable");
  });

  it("still creates the entry when the check runs and finds nothing", async () => {
    const { admin, inserts } = stubAdmin({ alreadyThere: false });
    const r = await evidenceFromTask(admin, TASK);

    expect(r).toEqual({ created: true, id: "new-entry" });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].row.status).toBe("pending");        // automation never self-verifies
    expect(inserts[0].row.notes).toContain("[auto:op_task:task-1]");
  });

  it("still skips when the check runs and finds it already bridged", async () => {
    const { admin, inserts } = stubAdmin({ alreadyThere: true });
    const r = await evidenceFromTask(admin, TASK);

    expect(r).toEqual({ created: false, reason: "already bridged" });
    expect(inserts).toHaveLength(0);
  });

  it("does not reach the check for work that is not bridgeable at all", async () => {
    const { admin, inserts } = stubAdmin({ checkError: FAIL });
    expect((await evidenceFromTask(admin, { ...TASK, task_type: "restock_supplies" })).reason).toBe("not a procedural task type");
    expect((await evidenceFromTask(admin, { ...TASK, patient_id: null })).reason).toBe("no performer/patient");
    expect((await evidenceFromMedication(admin, { ...MED, outcome: "refused" }, SCHED)).reason).toBe("not an administration");
    expect(inserts).toHaveLength(0);
  });
});
