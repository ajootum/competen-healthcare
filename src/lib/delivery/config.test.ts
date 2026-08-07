import { describe, it, expect, vi } from "vitest";
import { resolveDeliveryConfig, saveDeliveryConfig, DELIVERY_DEFAULTS } from "@/lib/delivery/config";

// cdp_delivery_config is a LIVE CONTROL SURFACE — the delivery engines read it at runtime, so what it returns
// when it cannot be read decides whether automation runs against a hospital that switched it off. Two defects
// lived here, and both are about a discarded error choosing the wrong answer:
//
//   resolveDeliveryConfig — the hospital OVERRIDE read fell through to the global policy, whose defaults have
//   both switches ON. A governor's opt-out silently became an opt-in.
//
//   saveDeliveryConfig — the find-then-update/insert read chose its BRANCH from `existing`, so a failed read
//   inserted a SECOND global row. With two rows on `hospital_id is null` the resolver's .maybeSingle() then
//   errors on every call and every hospital reverts to code defaults: one blip during one save turns the
//   policy off platform-wide.

/* eslint-disable @typescript-eslint/no-explicit-any */

vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "test-trace" }));

const FAIL = { message: "connection terminated unexpectedly" };
const HID = "hospital-A";

/** PostgREST stand-in. `results` is consumed in call order; writes are recorded. */
function stubAdmin(results: { data: unknown; error: unknown }[]) {
  const writes: any[] = [];
  let i = 0;
  const admin = {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        maybeSingle: async () => results[i++] ?? { data: null, error: null },
        update: (row: any) => { writes.push({ table, op: "update", row }); return chain; },
        insert: (row: any) => { writes.push({ table, op: "insert", row }); return chain; },
        then: undefined,
      };
      // update()/insert() are awaited directly in this module, so the chain must be thenable.
      chain.then = (res: any) => res({ error: null });
      return chain;
    },
  };
  return { admin, writes };
}

const ok = (data: unknown) => ({ data, error: null });
const failed = { data: null, error: FAIL };

describe("resolveDeliveryConfig", () => {
  it("goes DARK when a hospital's own override cannot be read — never back ON via the defaults", async () => {
    const { admin } = stubAdmin([failed]);
    const cfg = await resolveDeliveryConfig(admin, HID);

    // The bug: falling through to the global policy / DELIVERY_DEFAULTS, which have both switches true.
    expect(cfg.orchestration_enabled).toBe(false);
    expect(cfg.auto_remediation).toBe(false);
    expect(DELIVERY_DEFAULTS.orchestration_enabled).toBe(true);   // states plainly what it must not return
    // Numbers bound work rather than authorise it, so they keep their defaults.
    expect(cfg.reminder_horizon_days).toBe(DELIVERY_DEFAULTS.reminder_horizon_days);
  });

  it("honours a readable override", async () => {
    const { admin } = stubAdmin([ok({ reminder_horizon_days: 7, auto_remediation: false, orchestration_enabled: true, campaign_default_due_days: 14 })]);
    const cfg = await resolveDeliveryConfig(admin, HID);
    expect(cfg).toEqual({ reminder_horizon_days: 7, auto_remediation: false, orchestration_enabled: true, campaign_default_due_days: 14 });
  });

  it("falls through to the global policy when the hospital simply has no override", async () => {
    const { admin } = stubAdmin([ok(null), ok({ reminder_horizon_days: 45, auto_remediation: false, orchestration_enabled: true, campaign_default_due_days: 30 })]);
    const cfg = await resolveDeliveryConfig(admin, HID);
    expect(cfg.reminder_horizon_days).toBe(45);
    expect(cfg.auto_remediation).toBe(false);
  });

  it("keeps the pre-148 contract: an unreadable GLOBAL policy resolves to defaults so the engines still run", async () => {
    const { admin } = stubAdmin([failed]);
    expect(await resolveDeliveryConfig(admin, null)).toEqual(DELIVERY_DEFAULTS);
  });
});

describe("saveDeliveryConfig", () => {
  const actor = { id: "user-1", name: "A Governor" };

  it("WRITES NOTHING when it cannot tell whether a policy row exists — a second global row is the harm", async () => {
    const { admin, writes } = stubAdmin([failed]);
    const r = await saveDeliveryConfig(admin, { orchestration_enabled: false }, actor);

    expect(r.ok).toBe(false);
    expect(writes).toHaveLength(0);                               // ← the assertion that matters
    if (!r.ok) expect(r.error).toContain("nothing was written");
  });

  it("UPDATES the existing row when the read succeeds and finds one", async () => {
    const { admin, writes } = stubAdmin([ok({ id: "row-1" })]);
    const r = await saveDeliveryConfig(admin, { orchestration_enabled: false }, actor);

    expect(r.ok).toBe(true);
    const cfgWrites = writes.filter(w => w.table === "cdp_delivery_config");
    expect(cfgWrites).toHaveLength(1);
    expect(cfgWrites[0].op).toBe("update");
    expect(cfgWrites[0].row.orchestration_enabled).toBe(false);
  });

  it("INSERTS only when the read succeeds and genuinely finds no row", async () => {
    const { admin, writes } = stubAdmin([ok(null)]);
    const r = await saveDeliveryConfig(admin, { auto_remediation: false }, actor);

    expect(r.ok).toBe(true);
    const cfgWrites = writes.filter(w => w.table === "cdp_delivery_config");
    expect(cfgWrites).toHaveLength(1);
    expect(cfgWrites[0].op).toBe("insert");
    expect(cfgWrites[0].row.hospital_id).toBe(null);
  });
});
