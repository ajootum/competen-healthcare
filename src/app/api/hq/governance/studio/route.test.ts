/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// /api/hq/governance/studio: the studio gate runs first, approve and publish are owner-only before the database is
// called, an edit is applied to the draft the database holds at the revision the editor read, and refusals keep their
// sentence. The database behaviour (lifecycle, immutability, projection) is proven against migration 620 in the local
// rehearsal (docs/evidence/SCHOLAR-GOV-IMPLEMENT-01/LOCAL-ONLY-PROBES-620.sql).

const ME = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";
let isOwner = false;
let gateOpen = true;
let rpcCalls: { fn: string; args: any }[] = [];
let rpcResult: { data: any; error: any } = { data: { ok: true }, error: null };
let draft: any = null;

const ctx = () => ({
  userId: ME, fullName: "Editor", isOwner,
  admin: {
    rpc: async (fn: string, args: any) => { rpcCalls.push({ fn, args }); return rpcResult; },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: draft, error: null }) }) }) }),
  },
});
vi.mock("@/lib/hq/api-gate", () => ({
  hqApiGate: async () => (gateOpen ? ctx() : NextResponse.json({ error: "no" }, { status: 403 })),
  isHqRefusal: (x: unknown) => x instanceof NextResponse,
}));
vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace-1" }));

const { POST } = await import("./route");
const post = (body: unknown) => POST(new Request("http://x/api/hq/governance/studio", { method: "POST", body: JSON.stringify(body) }));
const reason = "restructure the portfolios";
const def = { levels: [{ level: 3, label: "Ops" }], units: [{ code: "ops_unit", level: 3, kind: "department", name: "Ops" }], positions: [], relationships: [], links: [], independence_pairs: [] };

beforeEach(() => {
  isOwner = false; gateOpen = true; rpcCalls = []; rpcResult = { data: { ok: true }, error: null };
  draft = { id: V, structure_code: "scholar", status: "draft", revision: 4, definition: def, based_on_version_id: null };
});

describe("POST /api/hq/governance/studio", () => {
  it("refuses a person without the studio right before anything is parsed", async () => {
    gateOpen = false;
    expect((await post({ action: "create_draft", structure: "scholar", reason })).status).toBe(403);
    expect(rpcCalls).toEqual([]);
  });

  it("refuses approve and publish to a non-owner editor before the database is called", async () => {
    expect((await post({ action: "transition", version: V, step: "approve", reason })).status).toBe(403);
    expect((await post({ action: "publish", version: V, basis: "Owner decision OD-1", reason })).status).toBe(403);
    expect(rpcCalls).toEqual([]);
    isOwner = true;
    expect((await post({ action: "publish", version: V, basis: "Owner decision OD-1", reason })).status).toBe(200);
    expect(rpcCalls[0]).toMatchObject({ fn: "hq_gov_studio_publish", args: { p_actor: ME, p_version: V } });
  });

  it("applies an edit to the stored draft and saves it at the revision read", async () => {
    const r = await post({ action: "edit", version: V, revision: 4, op: { op: "position_add", position: { name: "Ops Lead", unit: "ops_unit", kind: "lead" } }, reason });
    expect(r.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("hq_gov_studio_save_draft");
    expect(rpcCalls[0].args.p_revision).toBe(4);
    expect(rpcCalls[0].args.p_definition.positions).toEqual([{ code: "ops_lead", name: "Ops Lead", unit: "ops_unit", kind: "lead" }]);
  });

  it("refuses an edit to a stale revision or to a version that is not a draft", async () => {
    expect((await post({ action: "edit", version: V, revision: 3, op: { op: "unit_retire", code: "ops_unit" }, reason })).status).toBe(409);
    draft.status = "published";
    expect((await post({ action: "edit", version: V, revision: 4, op: { op: "unit_retire", code: "ops_unit" }, reason })).status).toBe(409);
    expect(rpcCalls).toEqual([]);
  });

  it("returns an operation's own refusal as 400 without saving", async () => {
    const r = await post({ action: "edit", version: V, revision: 4, op: { op: "position_move", code: "nobody", unit: "ops_unit" }, reason });
    expect(r.status).toBe(400);
    expect(rpcCalls).toEqual([]);
  });

  it("answers 503 when migration 620 is absent, and keeps the database's sentence otherwise", async () => {
    rpcResult = { data: null, error: { code: "PGRST202", message: "Could not find the function public.hq_gov_studio_create_draft" } };
    let r = await post({ action: "create_draft", structure: "scholar", reason });
    expect(r.status).toBe(503);
    expect((await r.json()).error).toMatch(/migration 620/);
    rpcResult = { data: null, error: { code: "P0001", message: "hq_gov exists: this structure already has an open version. Publish or discard it first" } };
    r = await post({ action: "create_draft", structure: "scholar", reason });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/already has an open version/);
  });
});
