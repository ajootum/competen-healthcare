/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { resetOverride, rollbackVersion } from "./workspace-config-write";

// A minimal fake of the Supabase client: records calls, and lets a test make delete() fail.
function fakeAdmin(opts: { deleteError?: string; rows?: { config_path: string }[]; snapshot?: { config_path: string; settings: unknown }[] } = {}) {
  const calls: { table: string; op: string }[] = [];
  const chain = (table: string, op: string, result: any) => {
    const c: any = {
      eq: () => c, limit: () => c, select: () => c,
      maybeSingle: async () => result,
      then: (res: (v: any) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej),
    };
    calls.push({ table, op });
    return c;
  };
  const admin = {
    from(table: string) {
      return {
        select: () => chain(table, "select", table === "workspace_config_versions"
          ? { data: { snapshot: opts.snapshot ?? [], scope_type: "platform", scope_ref: "individual" } }
          : { data: opts.rows ?? { draft: { value: 1 } } }),
        delete: () => chain(table, "delete", { error: opts.deleteError ? { message: opts.deleteError } : null }),
        insert: () => chain(table, "insert", { data: { id: "v-new" }, error: null }),
        upsert: () => chain(table, "upsert", { error: null }),
        update: () => chain(table, "update", { error: null }),
      };
    },
  };
  return { admin, calls };
}
const actor = { userId: "u1", name: "Tester" };
const scope = { scopeType: "platform", scopeRef: "individual" };

describe("resetOverride", () => {
  it("reports success and audits when the delete succeeds", async () => {
    const { admin, calls } = fakeAdmin();
    expect(await resetOverride(admin, actor, scope, "individual.policy.x")).toEqual({ ok: true });
    expect(calls.some(c => c.table === "workspace_config_audit" && c.op === "insert")).toBe(true);
  });
  it("reports a failed delete and writes no audit row (no silent success)", async () => {
    const { admin, calls } = fakeAdmin({ deleteError: "connect ETIMEDOUT" });
    const r = await resetOverride(admin, actor, scope, "individual.policy.x");
    expect(r).toMatchObject({ ok: false, status: 500, error: "connect ETIMEDOUT" });
    expect(calls.some(c => c.table === "workspace_config_audit")).toBe(false);
  });
});

describe("rollbackVersion prune", () => {
  it("reports a failed prune and records no new version", async () => {
    const { admin, calls } = fakeAdmin({ deleteError: "connect ETIMEDOUT", rows: [{ config_path: "individual.policy.extra" }], snapshot: [] });
    const r = await rollbackVersion(admin, actor, "v1", { scope, prune: true });
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(calls.some(c => c.table === "workspace_config_versions" && c.op === "insert")).toBe(false);
  });
  it("still prunes and counts when the delete succeeds", async () => {
    const { admin } = fakeAdmin({ rows: [{ config_path: "individual.policy.extra" }], snapshot: [] });
    expect(await rollbackVersion(admin, actor, "v1", { scope, prune: true })).toMatchObject({ ok: true, restored: 0, pruned: 1 });
  });
});
