/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// The identity rule of the engagement API: an anonymous answer carries no name, email or id; Named View and the
// testing filter are refused (403) without the identifiable right and never reach the loader; a named answer carries
// names and writes exactly one audit row without a name in it.

const U = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", V = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let capabilities: string[] = ["hq.scholar.analytics.view"];
let isOwner = false;
let audits: any[] = [];
let loads: any[] = [];

vi.mock("@/lib/hq/api-gate", () => ({
  hqApiGate: async () => ({ userId: "hq-user", fullName: "HQ Person", isOwner, capabilities, admin: { from: (t: string) => ({ insert: async (row: any) => { if (t === "audit_log") audits.push(row); return { error: null }; } }) } }),
  isHqRefusal: (x: unknown) => x instanceof NextResponse,
}));
vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace-1" }));
vi.mock("@/lib/hq/scholar-analytics/load", async () => {
  const real = await vi.importActual<any>("@/lib/hq/scholar-analytics/load");
  return {
    ...real,
    loadDashboardRows: async (_admin: any, opts: any) => {
      loads.push(opts);
      return {
        learners: [
          { userId: U, classification: "human", createdAt: "2026-10-01T00:00:00Z", accountStatus: "active", fullName: "Amina Learner" },
          { userId: V, classification: "unclassified", createdAt: "2026-10-02T00:00:00Z", accountStatus: "active", fullName: "Bakari Learner" },
        ].filter(l => opts.include.includes(l.classification)),
        raw: { materials: [{ id: "m1", user_id: U, created_at: new Date(Date.now() - 3600_000).toISOString() }], learnSessions: [], learnEvents: [], artefacts: [], reviews: [], revisionSessions: [], caseSessions: [], osceAttempts: [], selfAssessments: [], evaluations: [], planEdits: [] },
        ai: [{ userId: V, at: new Date(Date.now() - 7200_000).toISOString(), operation: "individual_scholar_learn", tokens: 10, costUsd: 0.01 }],
        settled: [], allowances: [], salt: "test-salt", limits: [],
      };
    },
  };
});

const { GET } = await import("./route");
const get = (qs: string) => GET(new Request(`http://x/api/hq/individual/scholar-analytics?${qs}`));

beforeEach(() => { capabilities = ["hq.scholar.analytics.view"]; isOwner = false; audits = []; loads = []; });

describe("GET /api/hq/individual/scholar-analytics", () => {
  it("anonymous by default: pseudonyms only, no name, email or id anywhere in the body, no audit row", async () => {
    const r = await get("range=7d");
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain("Amina"); expect(text).not.toContain("Bakari"); expect(text).not.toContain(U); expect(text).not.toContain(V);
    const j = JSON.parse(text);
    expect(j.named).toBe(false);
    expect(j.canIdentify).toBe(false);
    expect(j.leaderboard.rows).toHaveLength(2);
    expect(j.leaderboard.rows.every((x: any) => /^Learner [0-9A-F]{4,}$/.test(x.label) && !("name" in x))).toBe(true);
    expect(j.leaderboard.rows[0].activities).toBe(1); // the uploader ranks first by meaningful activity, not by AI requests
    expect(audits).toHaveLength(0);
  });
  it("refuses Named View and the testing filter without the identifiable right, before any data is read", async () => {
    expect((await get("range=7d&named=1")).status).toBe(403);
    expect((await get("range=7d&include=demo")).status).toBe(403);
    expect(loads).toHaveLength(0);
  });
  it("Named View with the right: names and status, same ranking, one audit row that names nobody", async () => {
    capabilities = ["hq.scholar.analytics.view", "hq.scholar.analytics.identifiable.read"];
    const anon = await (await get("range=7d")).json();
    const r = await get("range=7d&named=1");
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.named).toBe(true);
    expect(j.leaderboard.rows.map((x: any) => x.key)).toEqual(anon.leaderboard.rows.map((x: any) => x.key));
    expect(j.leaderboard.rows[0].name).toBe("Amina Learner");
    expect(j.leaderboard.rows[0].status).toBe("active");
    expect(JSON.stringify(j)).not.toContain("@");
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("scholar_analytics_identifiable_read");
    expect(JSON.stringify(audits[0].new_value)).not.toContain("Amina");
    expect(audits[0].new_value.learners).toBe(2);
  });
  it("the owner may identify and include test accounts, and the detail is found by pseudonym", async () => {
    isOwner = true;
    const anon = await (await get("range=7d")).json();
    const key = anon.leaderboard.rows[0].key;
    const j = await (await get(`range=7d&named=1&include=demo,test&learner=${encodeURIComponent(key)}`)).json();
    expect(loads.at(-1).include).toEqual(["human", "unclassified", "demo", "test"]);
    expect(j.detail.row.key).toBe(key);
    expect(j.detail.row.name).toBe("Amina Learner");
    expect(audits[0].new_value.learner).toBe(key);
    expect((await (await get(`range=7d&learner=${encodeURIComponent(U)}`)).json()).detail).toBeNull(); // an id is not a key
  });
  it("answers 409 when the salt is missing rather than inventing pseudonyms", async () => {
    const mod = await import("@/lib/hq/scholar-analytics/load");
    const orig = mod.loadDashboardRows;
    (mod as any).loadDashboardRows = async () => ({ learners: [], raw: {}, ai: [], settled: [], allowances: [], salt: null, limits: ["The pseudonym salt is not set up on this environment (migration 910), so the dashboard cannot be shown."] });
    try { expect((await get("range=7d")).status).toBe(409); } finally { (mod as any).loadDashboardRows = orig; }
  });
});
