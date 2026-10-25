/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// /api/hq/positions: the owner gate runs before anything is parsed, a capability outside the code catalogue
// never reaches the database, the actor comes from the session and never from the body, and the database's
// refusals come back with their own sentence and the right status. The database behaviour itself (owner
// check, audit-first, separation of duties, history) is proven against migration 500 in the local rehearsal.

const OWNER = "11111111-1111-4111-8111-111111111111";
let isOwner = true;
let rpcCalls: { fn: string; args: any }[] = [];
let rpcResult: { data: any; error: any } = { data: { ok: true }, error: null };

const ctx = () => ({
  userId: OWNER, fullName: "Owner", isOwner,
  admin: { rpc: async (fn: string, args: any) => { rpcCalls.push({ fn, args }); return rpcResult; } },
});

vi.mock("@/lib/hq/api-gate", () => ({
  hqApiGate: async () => ctx(),
  hqOwnerApiGate: async () => (isOwner ? ctx() : NextResponse.json({ error: "Only a platform owner can do this" }, { status: 403 })),
  isHqRefusal: (x: unknown) => x instanceof NextResponse,
}));
vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace-1" }));

const { POST } = await import("./route");
const post = (body: unknown) => POST(new Request("http://x/api/hq/positions", { method: "POST", body: JSON.stringify(body) }));
const reason = "owner asked for it";

beforeEach(() => { isOwner = true; rpcCalls = []; rpcResult = { data: { ok: true }, error: null }; });

describe("POST /api/hq/positions", () => {
  it("refuses a non-owner before the database is called", async () => {
    isOwner = false;
    const r = await post({ action: "create", code: "competency_author", space: "quality", name: "Competency Author", reason });
    expect(r.status).toBe(403);
    expect(rpcCalls).toEqual([]);
  });

  it("creates through the audited function, with the session as the actor whatever the body says", async () => {
    const r = await post({ action: "create", code: "competency_author", space: "quality", name: "Competency Author", reason, p_actor: "22222222-2222-4222-8222-222222222222" });
    expect(r.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("hq_position_admin_create");
    expect(rpcCalls[0].args).toMatchObject({ p_actor: OWNER, p_trace: "trace-1", p_code: "competency_author", p_space: "quality", p_reason: reason });
  });

  it("grants only a code-catalogue capability", async () => {
    expect((await post({ action: "grant", code: "competency_author", capability: "hq.invented.right", reason })).status).toBe(400);
    expect(rpcCalls).toEqual([]);
    expect((await post({ action: "grant", code: "competency_author", capability: "hq.quality.competency.author", reason })).status).toBe(200);
    expect(rpcCalls[0].fn).toBe("hq_position_admin_grant");
  });

  it("returns the database's separation-of-duties refusal as 409 with its sentence", async () => {
    rpcResult = { data: null, error: { code: "P0001", message: "hq_position_capability separation_of_duties: competency_author already holds hq.quality.competency.author, and a competency author cannot hold clinical approval (so hq.quality.clinical.approve is refused)" } };
    const r = await post({ action: "grant", code: "competency_author", capability: "hq.quality.clinical.approve", reason, acknowledge_sensitive: true });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/cannot hold clinical approval/);
  });

  it("ends a grant through the end function, never a delete", async () => {
    await post({ action: "end_grant", code: "competency_author", capability: "hq.platform.users.view", reason });
    expect(rpcCalls.map(c => c.fn)).toEqual(["hq_position_admin_end_grant"]);
  });

  it("says 'not applied' when migration 500 is absent", async () => {
    rpcResult = { data: null, error: { code: "PGRST202", message: "Could not find the function public.hq_position_admin_create" } };
    const r = await post({ action: "create", code: "competency_author", space: "quality", name: "Competency Author", reason });
    expect(r.status).toBe(503);
  });
});
