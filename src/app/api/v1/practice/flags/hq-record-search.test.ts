/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// HQ-RECORD-SEARCH-01: the flags route accepts hq_record_search through its existing gate (hq.practice.flags.manage). That the
// flag gives nobody data access is proven in src/app/api/hq/search/search.test.ts (flag on, no capability: 403, zero reads).

let held = new Set<string>();
let owner = false;
let rows: Record<string, any>[] = [];
let audits: any[] = [];
const admin = {
  from: (t: string) => {
    if (t === "practice_audit_event") return { insert: async (r: any) => { audits.push(r); return { error: null }; } };
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

beforeEach(() => { held = new Set(); owner = false; rows = []; audits = []; });

describe("flags route: hq_record_search", () => {
  it("is refused (403) without hq.practice.flags.manage, and writes nothing", async () => {
    held = new Set(["hq.platform.users.view"]);
    expect((await patch({ flag: "hq_record_search", enabled: true })).status).toBe(403);
    expect(rows).toEqual([]);
  });
  it("a holder of hq.practice.flags.manage turns it on (row created on the first flip), audited", async () => {
    held = new Set(["hq.practice.flags.manage"]);
    const r = await patch({ flag: "hq_record_search", enabled: true });
    expect(r.status).toBe(200);
    expect(rows).toEqual([expect.objectContaining({ flag: "hq_record_search", enabled: true })]);
    expect(audits[0].payload).toMatchObject({ flag: "hq_record_search", from: null, to: true });
  });
  it("an unknown flag is still 400, and a missing launch flag is still 404", async () => {
    owner = true;
    expect((await patch({ flag: "nonsense", enabled: true })).status).toBe(400);
    expect((await patch({ flag: "practice_pilot_provisioning", enabled: true })).status).toBe(404);
  });
});
