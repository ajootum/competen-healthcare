/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// /api/super-admin/users/classification (HQ-USERS-CLASSIFY-01): the owner gate runs before anything is parsed, a
// bad body never reaches the database, the actor is the session and never the body, the ONLY database calls are
// the two audited 650 functions (no Auth, entitlement, appointment or membership write), and a missing 650 is a
// plain 503 that changed nothing. The database side (owner check, audit per change) is proven in the 650 probes.

const OWNER = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let isOwner = true;
let calls: { kind: string; name: string; args?: any }[] = [];
let rpcResult: { data: any; error: any } = { data: 2, error: null };

// Every other door on the client is recorded, so a classification that touched auth or a table would show here.
const admin = new Proxy({}, {
  get: (_t, prop: string) => {
    if (prop === "rpc") return async (fn: string, args: any) => { calls.push({ kind: "rpc", name: fn, args }); return rpcResult; };
    if (prop === "from") return (t: string) => { calls.push({ kind: "from", name: t }); return new Proxy({}, { get: () => () => ({}) }); };
    if (prop === "auth") { calls.push({ kind: "auth", name: "auth" }); return {}; }
    return undefined;
  },
});
const ctx = () => ({ userId: OWNER, fullName: "Owner", isOwner, admin });

vi.mock("@/lib/hq/api-gate", () => ({
  hqApiGate: async () => ctx(),
  hqOwnerApiGate: async () => (isOwner ? ctx() : NextResponse.json({ error: "Only a platform owner can do this" }, { status: 403 })),
  isHqRefusal: (x: unknown) => x instanceof NextResponse,
}));
vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace-1" }));

const { POST } = await import("./route");
const post = (body: unknown) => POST(new Request("http://x/api/super-admin/users/classification", { method: "POST", body: JSON.stringify(body) }));
const classify = (over: Record<string, unknown> = {}) => post({ action: "classify", userIds: [A, B], accountType: "human", reason: "confirmed with the facility", ...over });

beforeEach(() => { isOwner = true; calls = []; rpcResult = { data: 2, error: null }; });

describe("POST /api/super-admin/users/classification", () => {
  it("refuses a viewer who is not an owner before anything else happens", async () => {
    isOwner = false;
    const r = await classify();
    expect(r.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("classifies through hq_account_classify only, with the session as the actor whatever the body says", async () => {
    const r = await classify({ p_actor: B, actor: B });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ success: true, changed: 2, unchanged: 0 });
    expect(calls).toEqual([{ kind: "rpc", name: "hq_account_classify", args: {
      p_actor: OWNER, p_actor_name: "Owner", p_profile_ids: [A, B], p_account_type: "human",
      p_reason: "confirmed with the facility", p_trace: "trace-1",
    } }]);
  });

  it("reports accounts that already had the type as unchanged", async () => {
    rpcResult = { data: 1, error: null };
    expect(await (await classify()).json()).toMatchObject({ changed: 1, unchanged: 1 });
  });

  it.each([
    ["an unknown type", { accountType: "robot" }],
    ["no accounts", { userIds: [] }],
    ["a non-uuid id", { userIds: ["x"] }],
    ["a blank reason", { reason: "  " }],
    ["too many accounts", { userIds: Array.from({ length: 501 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`) }],
  ])("refuses %s with 400 and no database call", async (_n, over) => {
    expect((await classify(over)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("refuses an unknown action", async () => {
    expect((await post({ action: "delete", userIds: [A] })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("sets the default view through hq_users_default_view_set only", async () => {
    rpcResult = { data: "all", error: null };
    const r = await post({ action: "set_default_view", view: "all" });
    expect(r.status).toBe(200);
    expect(calls).toEqual([{ kind: "rpc", name: "hq_users_default_view_set", args: { p_actor: OWNER, p_actor_name: "Owner", p_view: "all", p_trace: "trace-1" } }]);
  });

  it("refuses a non-owner changing the default view", async () => {
    isOwner = false;
    expect((await post({ action: "set_default_view", view: "all" })).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("answers 503 while migration 650 is absent", async () => {
    rpcResult = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    const r = await classify();
    expect(r.status).toBe(503);
    expect((await r.json()).error).toMatch(/migration 650/);
  });

  it("passes the database's own refusal through as 500", async () => {
    rpcResult = { data: null, error: { code: "P0001", message: "hq_account_classify owner_required: classifying accounts requires platform ownership" } };
    const r = await classify();
    expect(r.status).toBe(500);
    expect((await r.json()).error).toMatch(/owner_required/);
  });
});
