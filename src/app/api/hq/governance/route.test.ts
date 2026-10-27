/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// /api/hq/governance: the owner gate runs before anything is parsed, the actor comes from the session, an owner
// cannot record their own appointment, and the database's refusals come back with their own sentence and status.
// The database behaviour itself (board rules, separation of duties, history) is proven against migration 610 in
// the local rehearsal (docs/evidence/SCHOLAR-GOV-IMPLEMENT-01/LOCAL-ONLY-PROBES-610.sql).

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
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
const post = (body: unknown) => POST(new Request("http://x/api/hq/governance", { method: "POST", body: JSON.stringify(body) }));
const reason = "board resolution recorded";

beforeEach(() => { isOwner = true; rpcCalls = []; rpcResult = { data: { ok: true }, error: null }; });

describe("POST /api/hq/governance", () => {
  it("refuses a non-owner before the database is called", async () => {
    isOwner = false;
    const r = await post({ action: "appoint", seat: "board_holdings_nominee_1", person_id: OTHER, status: "nominated", reason });
    expect(r.status).toBe(403);
    expect(rpcCalls).toEqual([]);
  });

  it("records through the audited function, with the session as the actor whatever the body says", async () => {
    const r = await post({ action: "appoint", seat: "board_holdings_nominee_1", person_id: OTHER, status: "nominated", reason, p_actor: OTHER });
    expect(r.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("hq_gov_admin_appoint");
    expect(rpcCalls[0].args).toMatchObject({ p_actor: OWNER, p_trace: "trace-1", p_seat: "board_holdings_nominee_1", p_person: OTHER, p_status: "nominated", p_reason: reason });
  });

  it("refuses recording your own appointment before the database is called", async () => {
    const r = await post({ action: "appoint", seat: "committee_academic_lead_chair", person_id: OWNER, status: "nominated", reason });
    expect(r.status).toBe(409);
    expect(rpcCalls).toEqual([]);
  });

  it("refuses an active appointment without its basis or interests before the database is called", async () => {
    expect((await post({ action: "appoint", seat: "committee_academic_lead_chair", person_id: OTHER, status: "active", interests: "None declared", reason })).status).toBe(400);
    expect((await post({ action: "appoint", seat: "committee_academic_lead_chair", person_id: OTHER, status: "active", basis: "Resolution R-1", reason })).status).toBe(400);
    expect(rpcCalls).toEqual([]);
  });

  it("returns the database's board refusal as 400 and a separation-of-duties refusal as 409, with their sentences", async () => {
    rpcResult = { data: null, error: { code: "P0001", message: "hq_gov invalid: Competen Scholar Board is not incorporated, so a director cannot be appointed yet. Record a nomination" } };
    let r = await post({ action: "appoint", seat: "board_holdings_nominee_1", person_id: OTHER, status: "active", basis: "Resolution R-1", interests: "None declared", reason });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/not incorporated/);
    rpcResult = { data: null, error: { code: "P0001", message: "hq_gov separation_of_duties: a competency author cannot hold clinical approval" } };
    r = await post({ action: "appoint", seat: "committee_clinical_content_reviewer", person_id: OTHER, status: "nominated", reason });
    expect(r.status).toBe(409);
  });

  it("answers 503 when migration 610 is absent, never 403", async () => {
    rpcResult = { data: null, error: { code: "PGRST202", message: "Could not find the function public.hq_gov_admin_end" } };
    const r = await post({ action: "end", appointment_id: OTHER, reason });
    expect(r.status).toBe(503);
    expect((await r.json()).error).toMatch(/migration 610/);
  });
});
