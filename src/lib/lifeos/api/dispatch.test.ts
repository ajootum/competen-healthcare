import { describe, expect, it, vi } from "vitest";
import { LifeosError } from "../core/errors";
import type { LifeosStore, Principal, Row } from "../core/types";
import { createResource, transitionResource, type RequestContext } from "../core/service";
import { dispatch, RATE_LIMITS } from "./dispatch";
import { ROUTES, matchRoute } from "./routes";
import { buildOpenApi } from "./openapi";

const ME = "11111111-1111-4111-8111-111111111111";
const WS = "44444444-4444-4444-8444-444444444444";
const REC = "33333333-3333-4333-8333-333333333333";
const session: Principal = { kind: "session", individualId: ME, scopes: "*", clientId: null, boundWorkspaceId: null };

function fakeStore(over: Partial<LifeosStore> = {}): LifeosStore {
  return {
    flagEnabled: vi.fn(async () => true),
    rateTake: vi.fn(async () => ({ allowed: true, retryAfter: 1 })),
    mutate: vi.fn(async () => ({ replayed: false, refs: [], rows: [] })),
    peekIdempotency: vi.fn(async () => null),
    get: vi.fn(async () => null),
    where: vi.fn(async () => []),
    list: vi.fn(async () => []),
    liveGrants: vi.fn(async () => []),
    ...over,
  };
}

const call = (method: string, path: string, opts: { body?: unknown; headers?: Record<string, string>; store?: LifeosStore | null; authenticate?: () => Promise<Principal> } = {}) => {
  const hasBody = method !== "GET";
  const req = new Request(`http://x/api/lifeos/v1/${path}`, {
    method,
    headers: { ...(hasBody ? { "content-type": "application/json", "idempotency-key": "k1" } : {}), ...opts.headers },
    ...(hasBody ? { body: typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body ?? {}) } : {}),
  });
  return dispatch(req, path.split("?")[0].split("/"), {
    store: opts.store === undefined ? fakeStore() : opts.store,
    authenticate: opts.authenticate ?? (async () => session),
    traceId: "trace-1",
  });
};

describe("the gate comes first and fails closed", () => {
  it("off: an empty 404, and authentication is never reached", async () => {
    const authenticate = vi.fn(async () => session);
    const res = await call("GET", "me", { store: fakeStore({ flagEnabled: vi.fn(async () => false) }), authenticate });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(authenticate).not.toHaveBeenCalled();
  });
  it("no store (service key unavailable) is off", async () => {
    const res = await call("GET", "me", { store: null });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });
  it("a gate read that throws is off, not a 500", async () => {
    const res = await call("GET", "me", { store: fakeStore({ flagEnabled: vi.fn(async () => { throw new Error("boom"); }) }) });
    expect(res.status).toBe(404);
  });
  it("off answers the same for a write, and for a path that does not exist", async () => {
    const off = fakeStore({ flagEnabled: vi.fn(async () => false) });
    expect((await call("POST", "workspaces", { store: off })).status).toBe(404);
    expect((await call("GET", "nope/nope", { store: off })).status).toBe(404);
  });
});

describe("the order of the door", () => {
  it("authentication comes before routing, so paths cannot be probed signed out", async () => {
    const res = await call("GET", "nope", { authenticate: async () => { throw new LifeosError("unauthenticated", "Sign in"); } });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toEqual({ code: "unauthenticated", message: "Sign in", traceId: "trace-1" });
  });
  it("an unknown path is a 404 envelope, and a wrong method is a 405", async () => {
    expect(((await (await call("GET", "nope")).json()).error.code)).toBe("not_found");
    expect((await call("POST", "me")).status).toBe(405);
  });
  it("a path id that is not a UUID is a 404 and reaches no query", async () => {
    const store = fakeStore();
    expect((await call("GET", "workspaces/not-a-uuid", { store })).status).toBe(404);
    expect(store.where).not.toHaveBeenCalled();
  });
  it("a delegated token without the scope is refused before the store is asked", async () => {
    const store = fakeStore();
    const token: Principal = { kind: "delegated_token", boundWorkspaceId: WS, individualId: ME, scopes: ["goals:read"], clientId: "app" };
    const res = await call("GET", `workspaces/${WS}/commitments`, { store, authenticate: async () => token });
    expect(res.status).toBe(403);
    expect(store.rateTake).not.toHaveBeenCalled();
  });
  it("rate limited: 429 with Retry-After, in the right bucket, before anything else runs", async () => {
    const store = fakeStore({ rateTake: vi.fn(async () => ({ allowed: false, retryAfter: 7 })) });
    const res = await call("POST", `workspaces/${WS}/commitments`, { store, body: { title: "x" } });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
    expect(store.rateTake).toHaveBeenCalledWith(ME, "write", RATE_LIMITS.write.max, RATE_LIMITS.write.windowSeconds);
    expect(store.mutate).not.toHaveBeenCalled();
  });
});

describe("the door before holding LifeOS", () => {
  const identity = { issuer: "i", subject: "s", displayName: "d", email: null, competenIndividualLive: true };
  const call2 = (store: LifeosStore, session?: () => Promise<typeof identity>) => dispatch(
    new Request("http://x/api/lifeos/v1/access/status"), ["access", "status"],
    { store, authenticate: async () => { throw new LifeosError("forbidden", "no"); }, session, traceId: "t" },
  );
  it("does not need a principal", async () => {
    const store = fakeStore({ where: vi.fn(async () => []) });
    const res = await call2(store, async () => identity);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ enabled: true, eligible: true, active: false, terms: null });
  });
  it("with the flag off, nobody is eligible, whatever they hold", async () => {
    const store = fakeStore({ flagEnabled: vi.fn(async (f: string) => f === "lifeos_core") });
    const res = await call2(store, async () => identity);
    expect((await res.json()).data.eligible).toBe(false);
  });
  it("is refused with no session reader", async () => {
    expect((await call2(fakeStore())).status).toBe(403);
  });
  it("with the gate off, it does not exist", async () => {
    const res = await call2(fakeStore({ flagEnabled: vi.fn(async () => false) }), async () => identity);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });
});

describe("write requirements", () => {
  const path = `workspaces/${WS}/commitments`;
  it("needs application/json", async () => {
    const res = await call("POST", path, { body: { title: "x" }, headers: { "content-type": "text/plain" } });
    expect(res.status).toBe(422);
  });
  it("needs an Idempotency-Key, of a bounded length", async () => {
    const req = new Request(`http://x/api/lifeos/v1/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const res = await dispatch(req, path.split("/"), { store: fakeStore(), authenticate: async () => session, traceId: "t" });
    expect((await res.json()).error.message).toMatch(/Idempotency-Key/);
    expect((await call("POST", path, { body: { title: "x" }, headers: { "idempotency-key": "k".repeat(256) } })).status).toBe(422);
  });
  it("refuses a body that is not JSON", async () => {
    expect((await call("POST", path, { body: "{not json" })).status).toBe(422);
  });
  it("refuses a field the server owns, naming the problem", async () => {
    const store = fakeStore();
    const res = await call("POST", path, { store, body: { title: "x", status: "done" } });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("validation_failed");
    expect(store.mutate).not.toHaveBeenCalled();
  });
  it("an unexpected failure says nothing of its cause, and carries the trace", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = fakeStore({ where: vi.fn(async () => { throw new Error("password=hunter2"); }) });
    const res = await call("GET", `workspaces/${WS}`, { store });
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(text).not.toContain("hunter2");
    expect(JSON.parse(text).error.traceId).toBe("trace-1");
    spy.mockRestore();
  });
});

describe("workspace access answers not found, never forbidden, to an outsider", () => {
  it("no membership row", async () => {
    const res = await call("GET", `workspaces/${WS}/commitments`);
    expect(res.status).toBe(404);
  });
  it("a membership that has ended", async () => {
    const store = fakeStore({ where: vi.fn(async () => [{ status: "left", role: "member" }] as Row[]) });
    expect((await call("GET", `workspaces/${WS}/commitments`, { store })).status).toBe(404);
  });
  it("a suspended tenant refuses its members", async () => {
    const store = fakeStore({
      where: vi.fn(async () => [{ status: "active", role: "owner" }] as Row[]),
      get: vi.fn(async (t: string) => (t === "lifeos_workspace" ? { status: "active", tenant_id: REC } : { status: "suspended" })) as LifeosStore["get"],
    });
    expect((await call("GET", `workspaces/${WS}/commitments`, { store })).status).toBe(403);
  });
});

describe("idempotency in the service", () => {
  const ctx = (store: LifeosStore): RequestContext => ({ store, principal: session, traceId: "t", idempotencyKey: "k", requestHash: "h" });
  const membership = vi.fn(async (t: string) => (t === "lifeos_membership" ? [{ status: "active", role: "owner", id: REC }] : [])) as unknown as LifeosStore["where"];
  const row = {
    id: REC, schema_version: 1, workspace_id: WS, owner_individual_id: ME, access_scope: "private", provenance_source: "user", provenance_ref: null,
    version: 2, created_by: ME, updated_by: ME, created_at: "t", updated_at: "t", archived_at: null,
    world_id: null, goal_id: null, project_id: null, title: "x", notes: null, important: null, urgent: null, quadrant: null, due_on: null,
    scheduled_on: null, scheduled_time: null, estimated_minutes: null, completed_at: null, status: "done",
  };

  it("a retry of a transition that already happened replays, instead of failing as an illegal move", async () => {
    const store = fakeStore({
      where: membership,
      peekIdempotency: vi.fn(async () => ({ requestHash: "h", refs: [{ t: "lifeos_commitment", id: REC }] })),
      get: vi.fn(async (t: string) => (t === "lifeos_workspace" ? { status: "active" } : row)) as LifeosStore["get"],
    });
    const r = await transitionResource(ctx(store), WS, "commitments", REC, { to: "done", expectedVersion: 1 });
    expect(r.replayed).toBe(true);
    expect(store.mutate).not.toHaveBeenCalled();
  });
  it("a replay after access has ended answers not found, and returns nothing of the record", async () => {
    const store = fakeStore({
      where: vi.fn(async () => []) as LifeosStore["where"],
      peekIdempotency: vi.fn(async () => ({ requestHash: "h", refs: [{ t: "lifeos_commitment", id: REC }] })),
      get: vi.fn(async () => row) as LifeosStore["get"],
    });
    await expect(transitionResource(ctx(store), WS, "commitments", REC, { to: "done", expectedVersion: 1 })).rejects.toMatchObject({ code: "not_found" });
  });
  it("the same key on a different request is refused", async () => {
    const store = fakeStore({ peekIdempotency: vi.fn(async () => ({ requestHash: "other", refs: [] })) });
    await expect(createResource(ctx(store), WS, "commitments", { title: "x" })).rejects.toMatchObject({ code: "idempotency_key_reused" });
    expect(store.mutate).not.toHaveBeenCalled();
  });
  it("when planning fails because a concurrent first attempt committed, the retry still replays", async () => {
    const peek = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ requestHash: "h", refs: [{ t: "lifeos_commitment", id: REC }] });
    const store = fakeStore({
      where: membership,
      peekIdempotency: peek,
      get: vi.fn(async (t: string) => (t === "lifeos_workspace" ? { status: "active" } : row)) as LifeosStore["get"],
    });
    const r = await transitionResource(ctx(store), WS, "commitments", REC, { to: "done", expectedVersion: 1 });
    expect(r.replayed).toBe(true);
    expect(store.mutate).not.toHaveBeenCalled();
  });
  it("a new request sends the key, the hash and the owner, and the status is set by the server", async () => {
    const mutate = vi.fn(async (a: { ops: { values: Row }[] }) => ({ replayed: false, refs: [], rows: [{ ...row, ...a.ops[0].values, version: 1 }] }));
    const store = fakeStore({
      where: membership,
      mutate: mutate as unknown as LifeosStore["mutate"],
      get: vi.fn(async () => ({ status: "active" })) as LifeosStore["get"],
    });
    await createResource(ctx(store), WS, "commitments", { title: "Call aunt" });
    const args = mutate.mock.calls[0][0] as unknown as { idempotencyKey: string; requestHash: string; actorKind: string; ops: { values: Row }[] };
    expect(args.idempotencyKey).toBe("k");
    expect(args.requestHash).toBe("h");
    expect(args.actorKind).toBe("user");
    expect(args.ops[0].values).toMatchObject({ owner_individual_id: ME, workspace_id: WS, status: "inbox", provenance_source: "user" });
  });
});

describe("the route table", () => {
  it("fixed paths win over parameterised ones", () => {
    const m = matchRoute("POST", ["workspaces", WS, "suggestions", "generate"]);
    expect(m && m !== "method_not_allowed" && m.route.path).toBe("/workspaces/:ws/suggestions/generate");
  });
  it("read-only resources have no write route", () => {
    for (const name of ["quadrant-classifications", "integration-connections"]) {
      expect(ROUTES.filter(r => r.path.includes(name) && r.method !== "GET")).toEqual([]);
    }
  });
  it("the suggestions API cannot create or edit a suggestion directly", () => {
    expect(matchRoute("PATCH", ["workspaces", WS, "suggestions", REC])).toBe("method_not_allowed");
    expect(ROUTES.some(r => r.method === "POST" && r.path === "/workspaces/:ws/suggestions")).toBe(false);
  });
  it("the public document holds the approved list, and nothing a person must decide", () => {
    const doc = JSON.stringify(Object.keys((buildOpenApi(ROUTES, "public") as { paths: object }).paths));
    expect(doc).toContain("/workspaces/{ws}/commitments");
    for (const never of ["suggestions", "permission-grants", "invitations", "tenants", "oauth/authorize"]) expect(doc).not.toContain(never);
  });
  it("a delegated token cannot reach an internal route, whatever scopes it holds", async () => {
    const tokenHash = "x";
    const store = fakeStore({
      where: vi.fn(async (t: string) => (t === "lifeos_live_oauth_token"
        ? [{ access_live: true, client_id: REC, individual_id: ME, scopes: ["*", "suggestions:write", "grants:write"], version: 1, id: tokenHash, bound_workspace_id: WS }]
        : t === "lifeos_live_entitlement" ? [{ source: "direct" }] : [])) as LifeosStore["where"],
      get: vi.fn(async (t: string) => (t === "lifeos_api_client" ? { status: "approved", allowed_scopes: ["*", "suggestions:write", "grants:write"] } : { status: "active", id: ME })) as LifeosStore["get"],
    });
    const req = new Request(`http://x/api/lifeos/v1/workspaces/${WS}/permission-grants`, { headers: { authorization: "Bearer lo_at_x" } });
    const stands = { accountStands: async () => true, sourceStands: async () => true };
    const res = await dispatch(req, ["workspaces", WS, "permission-grants"], { store, authenticate: async () => session, traceId: "t", ...stands });
    expect(res.status).toBe(403);
    // With nothing able to say the person's account still stands, the answer is no.
    const unasked = await dispatch(req.clone(), ["workspaces", WS, "permission-grants"], { store, authenticate: async () => session, traceId: "t" });
    expect(unasked.status).toBe(401);
    const banned = await dispatch(req.clone(), ["workspaces", WS, "permission-grants"], { store, authenticate: async () => session, traceId: "t", ...stands, accountStands: async () => false });
    expect(banned.status).toBe(401);
  });
  it("with the public flag off, a bearer token gets not found", async () => {
    const store = fakeStore({ flagEnabled: vi.fn(async (f: string) => f === "lifeos_core") });
    const req = new Request(`http://x/api/lifeos/v1/me`, { headers: { authorization: "Bearer lo_at_x" } });
    expect((await dispatch(req, ["me"], { store, authenticate: async () => session, traceId: "t" })).status).toBe(404);
  });
  it("the OpenAPI document generates, with path templates and the idempotency header", () => {
    const doc = buildOpenApi(ROUTES) as { openapi: string; paths: Record<string, Record<string, { parameters: { name: string }[] }>> };
    expect(doc.openapi).toBe("3.1.0");
    const post = doc.paths["/workspaces/{ws}/commitments"].post;
    expect(post.parameters.map(p => p.name)).toEqual(["ws", "Idempotency-Key"]);
  });
});
