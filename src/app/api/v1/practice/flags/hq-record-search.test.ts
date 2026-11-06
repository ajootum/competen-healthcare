/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// HQ-RECORD-SEARCH-01: who may turn the record search on. It is the Holdings right, through the one flag writer. That the flag gives nobody data
// access is proven in src/app/api/hq/search/search.test.ts (flag on, no capability: 403, zero reads).

let held = new Set<string>();
let owner = false;
let rows: Record<string, any>[] = [];
let audits: any[] = [];
let auditFails = false;
const admin = {
  from: (t: string) => {
    if (t === "practice_audit_event") return { insert: async (r: any) => { if (auditFails) return { error: { message: "no" } }; audits.push(r); return { error: null }; } };
    let f: any = null;
    const b: any = {
      select: () => b, eq: (_c: string, v: string) => { f = v; return b; },
      maybeSingle: async () => ({ data: rows.find(r => r.flag === f) ?? null, error: null }),
      update: (patch: any) => ({ eq: async (_c: string, v: string) => { const r = rows.find(x => x.flag === v); if (r) Object.assign(r, patch); return { error: null }; } }),
      insert: async (r: any) => { rows.push({ ...r }); return { error: null }; },
    };
    return b;
  },
};
vi.mock("@/lib/api-auth", () => ({
  getCaller: async () => ({ admin, userId: "u1", traceId: "t" }),
  isResponse: () => false,
}));
vi.mock("@/lib/hq/context", () => ({
  resolveHqContext: async (cap: string) =>
    owner || held.has(cap)
      ? { ok: true, ctx: { admin, isOwner: owner, capabilities: [...held], userId: "u1", fullName: "U" } }
      : { ok: false, redirectTo: "/dashboard", decision: "deny", reason: "x" },
}));

const patch = async (body: any) => (await import("./route")).PATCH(new Request("http://x/api/v1/practice/flags", { method: "PATCH", body: JSON.stringify(body) }) as any);
const flip = (enabled: unknown) => patch({ flag: "hq_record_search", enabled });

beforeEach(() => { held = new Set(); owner = false; rows = []; audits = []; auditFails = false; });

describe("the HQ record search switch", () => {
  it("\u26a0 is refused to the Practice Product Director's right, and writes nothing", async () => {
    held = new Set(["hq.practice.flags.manage"]);
    expect((await flip(true)).status).toBe(403);
    expect(rows).toEqual([]);
    expect(audits).toEqual([]);
  });
  it("⚠ the Holdings right alone does not open the one flag writer, for any flag", async () => {
    held = new Set(["hq.platform.governance.manage"]);
    rows = [{ flag: "practice_sign_in", enabled: false }];
    expect((await patch({ flag: "practice_sign_in", enabled: true, reason: "a long enough reason" })).status).toBe(403);
    expect((await flip(true)).status).toBe(403);
    expect(rows).toEqual([{ flag: "practice_sign_in", enabled: false }]);
  });
  it("is refused to someone with no right", async () => {
    expect((await flip(true)).status).toBe(403);
    expect(rows).toEqual([]);
  });
  it("the Holdings right, through the one gate, creates the row on the first flip, and it is audited", async () => {
    held = new Set(["hq.practice.flags.manage", "hq.platform.governance.manage"]);
    const r = await flip(true);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ enabled: true, changed: true });
    expect(rows[0]).toMatchObject({ flag: "hq_record_search", enabled: true });
    expect(audits).toHaveLength(1);
  });
  it("the owner can turn it off again", async () => {
    owner = true;
    rows = [{ flag: "hq_record_search", enabled: true }];
    expect((await flip(false)).status).toBe(200);
    expect(rows[0].enabled).toBe(false);
  });
  it("\u26a0 a change that cannot be audited does not stand", async () => {
    owner = true;
    auditFails = true;
    expect((await flip(true)).status).toBe(503);
    expect(rows[0].enabled).toBe(false);
  });
  it("refuses a value that is not true or false", async () => {
    owner = true;
    expect((await flip("yes")).status).toBe(400);
    expect(rows).toEqual([]);
  });
  it("a Practice flag with no row is still not created", async () => {
    owner = true;
    expect((await patch({ flag: "practice_pilot_provisioning", enabled: true })).status).toBe(404);
    expect(rows).toEqual([]);
  });
});
