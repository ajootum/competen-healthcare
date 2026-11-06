/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { capabilityForRoute } from "@/lib/hq/spaces";

// HQ-RECORD-SEARCH-01. The REAL hqApiGate runs here, with only resolveHqContext stood in (as api-gate.test.ts does), over a
// stub admin client that honours .eq / .is filters, so ownership is proven by the query and not by the stub.

let held = new Set<string>();
let signedIn = true;
let owner = false;
let reads: string[] = [];
let tables: Record<string, any[]> = {};
let failTable: string | null = null;

function query(table: string) {
  reads.push(table);
  let rows = (tables[table] ?? []).map(r => ({ ...r }));
  const b: any = {
    select: () => b,
    eq: (c: string, v: unknown) => { rows = rows.filter(r => r[c] === v); return b; },
    is: (c: string, v: unknown) => { rows = rows.filter(r => (r[c] ?? null) === v); return b; },
    order: () => b, limit: () => b,
    maybeSingle: async () => (failTable === table ? { data: null, error: { message: "boom" } } : { data: rows[0] ?? null, error: null }),
    then: (res: any, rej: any) => Promise.resolve(failTable === table ? { data: null, error: { message: "boom" } } : { data: rows, error: null }).then(res, rej),
  };
  return b;
}
const admin = { from: (t: string) => query(t) };

vi.mock("@/lib/hq/context", () => ({
  resolveHqContext: async (cap: string) => {
    if (!signedIn) return { ok: false, redirectTo: "/login?next=/super-admin", decision: "deny", reason: "x" };
    if (owner || held.has(cap)) return { ok: true, ctx: { admin, isOwner: owner, capabilities: [...held] } };
    return { ok: false, redirectTo: "/dashboard", decision: "deny", reason: "x" };
  },
}));

const routes = {
  policies: { cap: "hq.quality.policy.view", table: "hq_policy", mod: () => import("./policies/route") },
  instruments: { cap: "hq.assessment.studio.view", table: "asmt_instrument", mod: () => import("./instruments/route") },
  frameworks: { cap: "hq.learning.content.view", table: "frameworks", mod: () => import("./frameworks/route") },
  positions: { cap: "hq.platform.users.view", table: "hq_position", mod: () => import("./positions/route") },
} as const;
const keys = Object.keys(routes) as (keyof typeof routes)[];
const call = async (k: keyof typeof routes, q = "alpha") => (await routes[k].mod()).GET(new Request(`http://x/api/hq/search/${k}?q=${q}`));

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const seed = () => ({
  practice_platform_flags: [{ flag: "hq_record_search", enabled: true }],
  hq_policy: [{ id: UUID(1), code: "POL-000001", title: "Alpha escalation policy", description: "SECRET-DESC" }],
  asmt_instrument: [
    { id: UUID(2), code: "INS-A", name: "Alpha instrument", owner_scope: "holdings" },
    { id: UUID(3), code: "INS-ALPHA-IND", name: "Alpha personal instrument", owner_scope: "individual" },
  ],
  frameworks: [
    { id: UUID(4), code: "FW-A", name: "Alpha framework", hospital_id: null, is_active: true },
    { id: UUID(5), code: "FW-ALPHA-H", name: "Alpha hospital framework", hospital_id: UUID(99), is_active: true },
  ],
  hq_position: [{ code: "alpha_lead", name: "Alpha Lead", space: "quality" }, { code: "alpha_x", name: "Alpha Odd", space: "nonsense" }],
});

beforeEach(() => { held = new Set(); signedIn = true; owner = false; reads = []; failTable = null; tables = seed(); });

describe("boundary, per type (real hqApiGate)", () => {
  for (const k of keys) {
    it(`${k}: a person holding other capabilities gets 403, only key is error, and nothing is read`, async () => {
      held = new Set(["hq.platform.home.view"]);
      const r = await call(k);
      expect(r.status).toBe(403);
      const body = await r.json();
      expect(Object.keys(body)).toEqual(["error"]);
      expect(reads).toEqual([]);
      owner = false;
    });
    it(`${k}: no session is 401`, async () => {
      signedIn = false;
      expect((await call(k)).status).toBe(401);
      expect(reads).toEqual([]);
    });
    it(`${k}: an owner with capabilities [] still gets results, no-store`, async () => {
      owner = true; held = new Set();
      const r = await call(k);
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect((await r.json()).hits.length).toBeGreaterThan(0);
    });
    it(`${k}: flag off or unreadable is 404 for a holder with no table read beyond the flag`, async () => {
      held = new Set([routes[k].cap]);
      tables.practice_platform_flags = [];
      expect((await call(k)).status).toBe(404);
      tables = seed(); tables.practice_platform_flags = [{ flag: "hq_record_search", enabled: false }];
      expect((await call(k)).status).toBe(404);
      tables = seed(); failTable = "practice_platform_flags";
      expect((await call(k)).status).toBe(404);
      expect(reads.every(t => t === "practice_platform_flags")).toBe(true);
    });
    it(`${k}: flag off does not change a non-holder's answer (still 403)`, async () => {
      tables.practice_platform_flags = [];
      held = new Set(["hq.platform.home.view"]);
      expect((await call(k)).status).toBe(403);
    });
    it(`${k}: a source failure is 502, a short query is 400`, async () => {
      held = new Set([routes[k].cap]);
      expect((await call(k, "a")).status).toBe(400);
      failTable = routes[k].table;
      expect((await call(k)).status).toBe(502);
    });
    it(`capabilityForRoute(destination) equals the entry's capability: ${k}`, async () => {
      const { hqRecordSource } = await import("@/lib/hq/record-search/registry");
      const s = hqRecordSource(k);
      expect(s.capability).toBe(routes[k].cap);
      expect(capabilityForRoute(s.destination(UUID(7)))).toBe(s.capability);
    });
    it(`the route's literal gate equals the entry's capability: ${k}`, () => {
      const src = readFileSync(join(__dirname, k, "route.ts"), "utf8");
      expect(src).toContain(`hqApiGate(["${routes[k].cap}"])`);
      expect(src).toMatch(/if \(isHqRefusal\(ctx\)\) return ctx;/);
    });
  }

  it("holding A but not B: A is 200, B is 403", async () => {
    held = new Set([routes.policies.cap]);
    expect((await call("policies")).status).toBe(200);
    expect((await call("instruments")).status).toBe(403);
  });
});

describe("ownership and content", () => {
  it("a hospital framework and an individual-owned instrument are never returned", async () => {
    owner = true;
    const ins = await (await call("instruments")).json();
    expect(ins.hits.map((h: any) => h.id)).toEqual([UUID(2)]);
    const fw = await (await call("frameworks")).json();
    expect(fw.hits.map((h: any) => h.id)).toEqual([UUID(4)]);
  });
  it("positions outside the HQ spaces are not offered, and the destination is the board", async () => {
    owner = true;
    const r = await (await call("positions")).json();
    expect(r.hits).toEqual([{ id: "alpha_lead", code: "alpha_lead", title: "Alpha Lead", href: "/super-admin/users/positions" }]);
  });
  it("no description or other field leaves the route", async () => {
    owner = true;
    const r = await (await call("policies")).json();
    expect(Object.keys(r.hits[0]).sort()).toEqual(["code", "href", "id", "title"]);
    expect(JSON.stringify(r)).not.toContain("SECRET-DESC");
  });
  it("caps at 8 and says more", async () => {
    owner = true;
    tables.hq_policy = Array.from({ length: 12 }, (_, i) => ({ id: UUID(i + 10), code: `POL-${i}`, title: `Alpha policy ${i}` }));
    const r = await (await call("policies")).json();
    expect(r.hits).toHaveLength(8);
    expect(r.more).toBe(true);
  });
});
