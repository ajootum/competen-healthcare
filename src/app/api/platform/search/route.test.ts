/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Real hqApiGate, resolveHqContext mocked (as api-gate.test.ts does). A recording stub proves which tables are read.
const resolve = vi.fn();
vi.mock("@/lib/hq/context", () => ({ resolveHqContext: (cap: string, opts: unknown) => resolve(cap, opts) }));

import { GET } from "./route";
import { escapeLike } from "@/lib/platform/search";

let reads: string[] = [];
let filters: string[] = [];
const stub = () => ({
  from(table: string) {
    reads.push(table);
    const q: any = {
      select: () => q, order: () => q, eq: () => q, limit: () => q,
      or: (f: string) => { filters.push(f); return q; },
      then: (res: any) => res({ data: [{ id: "1", name: "Alpha", slug: "a", full_name: "A", email: "e@x", label: "L", code: "c", entity_name: "E", action: "x" }], error: null }),
    };
    return q;
  },
});
const ctx = (isOwner: boolean, capabilities: string[]) => ({ userId: "u", admin: stub(), isOwner, capabilities });
// the resolver admits when the caller holds the capability asked about
const asCaller = (isOwner: boolean, caps: string[]) =>
  resolve.mockImplementation(async (cap: string) =>
    isOwner || caps.includes(cap) ? { ok: true, ctx: ctx(isOwner, caps) } : { ok: false, redirectTo: "/dashboard", decision: "deny", reason: "x" });
const call = (q: string) => GET(new Request(`http://x/api/platform/search?q=${encodeURIComponent(q)}`));

beforeEach(() => { resolve.mockReset(); reads = []; filters = []; });

describe("GET /api/platform/search", () => {
  it("no session is 401 with zero reads", async () => {
    resolve.mockResolvedValue({ ok: false, redirectTo: "/login?next=/super-admin", decision: "deny", reason: "x" });
    const r = await call("alpha");
    expect(r.status).toBe(401); expect(reads).toEqual([]);
  });
  it("holding no relevant capability is 403, only an error key, zero reads", async () => {
    asCaller(false, ["hq.something.else"]);
    const r = await call("alpha");
    expect(r.status).toBe(403); expect(Object.keys(await r.json())).toEqual(["error"]); expect(reads).toEqual([]);
  });
  it("holding one capability reads only that source and names only it", async () => {
    asCaller(false, ["hq.platform.audit.view"]);
    const r = await call("alpha"); const j = await r.json();
    expect(r.status).toBe(200);
    expect(reads).toEqual(["audit_log"]);
    expect(j.searched).toEqual(["Activity"]);
    expect(j.groups.map((g: any) => g.type)).toEqual(["Activity"]);
    expect(JSON.stringify(j)).not.toMatch(/Tenants|Users|e@x/);
  });
  it("operations.view reads tenants and workspaces only", async () => {
    asCaller(false, ["hq.platform.operations.view"]);
    await call("alpha");
    expect(reads.sort()).toEqual(["plat_workspaces", "tenants"]);
  });
  it("the owner reads every source", async () => {
    asCaller(true, []);
    const j = await (await call("alpha")).json();
    expect(reads.sort()).toEqual(["audit_log", "framework_competencies", "frameworks", "hospitals", "plat_workspaces", "profiles", "tenants"]);
    expect(j.searched.length).toBe(7);
  });
  it("limits: too short reads nothing, too long is 400", async () => {
    asCaller(true, []);
    expect((await (await call("a")).json()).total).toBe(0); expect(reads).toEqual([]);
    expect((await call("x".repeat(121))).status).toBe(400); expect(reads).toEqual([]);
  });
  it("escapes underscore in ilike terms", async () => {
    asCaller(true, []);
    await call("a_b");
    expect(filters[0]).toContain(String.raw`ilike.%a\_b%`);
    expect(escapeLike("50%_\\")).toBe(String.raw`50\%\_\\`);
  });
});
