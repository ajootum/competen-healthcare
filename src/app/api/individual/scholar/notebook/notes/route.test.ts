import { beforeEach, describe, expect, it, vi } from "vitest";

// The gate, the patient-identifier screen, ownership and the no-model rule of the Notebook's routes. The store and guard are stand-ins: what is
// tested is what the routes refuse, what they pass on, and that a learner id from a request body is never used.

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const K = "11111111-1111-4111-8111-111111111111", N = "22222222-2222-4222-8222-222222222222";
const state = { policy: { scholarPersonalNotebook: "on", scholarLearningLibrary: "on" }, schema: true, signedIn: true };
const create = vi.fn(), update = vi.fn(), remove = vi.fn(), audit = vi.fn(), lesson = vi.fn();
const modelCall = vi.fn();

vi.mock("@/lib/individual/guard", () => ({
  requireIndividualContext: async () => (state.signedIn ? { admin: { id: "admin" }, userId: USER, profile: { fullName: "x" } } : Response.json({ error: "Not signed in" }, { status: 401 })),
  isGuardRefusal: (c: unknown) => c instanceof Response,
}));
vi.mock("@/lib/individual/policy", () => ({ loadIndividualPolicy: async () => state.policy }));
vi.mock("@/lib/individual/scholar/http", () => ({ audit: (...a: unknown[]) => audit(...a), scholarAiRunner: modelCall }));
vi.mock("@/lib/individual/scholar/competency-view", () => ({ loadLearnerCatalogue: async () => ({ competencies: [{ id: N, title: "A competency" }] }) }));
vi.mock("@/lib/individual/scholar/store", () => ({
  deleteNote: (...a: unknown[]) => remove(...a),
  notebookSchema: async () => state.schema,
  notebookOffered: (p: typeof state.policy, s: boolean) => p.scholarPersonalNotebook === "on" && p.scholarLearningLibrary === "on" && s,
  createNotebookNote: (...a: unknown[]) => create(...a),
  updateNotebookNote: (...a: unknown[]) => update(...a),
  lessonNotes: (...a: unknown[]) => lesson(...a),
}));

const { GET, POST } = await import("./route");
const item = await import("./[id]/route");
const req = (body: unknown, method = "POST") => new Request("http://x/api", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = { params: Promise.resolve({ id: N }) };

beforeEach(() => {
  vi.clearAllMocks();
  state.policy = { scholarPersonalNotebook: "on", scholarLearningLibrary: "on" }; state.schema = true; state.signedIn = true;
  create.mockResolvedValue({ ok: true, id: N, revision: 1, existing: false });
  update.mockResolvedValue({ ok: true, id: N, revision: 2 });
  remove.mockResolvedValue("ok");
  lesson.mockResolvedValue({ ok: true, data: [] });
});

describe("the gate", () => {
  it("off by policy: 403 on every verb, and nothing is written", async () => {
    state.policy = { scholarPersonalNotebook: "off", scholarLearningLibrary: "on" };
    expect((await POST(req({ clientKey: K, body: "x" }))).status).toBe(403);
    expect((await item.PATCH(req({ expectedRevision: 1, body: "x" }, "PATCH"), ctx)).status).toBe(403);
    expect((await item.DELETE(req({}, "DELETE"), ctx)).status).toBe(403);
    expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it("library off: 403. Migration absent: 409. Nothing is written", async () => {
    state.policy = { scholarPersonalNotebook: "on", scholarLearningLibrary: "off" };
    expect((await POST(req({ clientKey: K, body: "x" }))).status).toBe(403);
    state.policy = { scholarPersonalNotebook: "on", scholarLearningLibrary: "on" }; state.schema = false;
    expect((await POST(req({ clientKey: K, body: "x" }))).status).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });
  it("signed out: 401, which the page turns into words kept on the device", async () => {
    state.signedIn = false;
    expect((await POST(req({ clientKey: K, body: "x" }))).status).toBe(401);
  });
});

describe("POST", () => {
  it("saves with nothing but words, for the caller, whatever the body claims", async () => {
    const res = await POST(req({ clientKey: K, body: "An idea", user_id: "someone-else", userId: "someone-else" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, id: N, revision: 1 });
    expect(create.mock.calls[0][1]).toBe(USER);
    expect(create.mock.calls[0][2]).toMatchObject({ body: "An idea", context: { link: { targetKind: "free" } } });
  });
  it("screens words, title and tags for patient identifiers: 422, and nothing is written", async () => {
    for (const b of [{ body: "Patient MRN: 12345678" }, { body: "x", title: "MRN: 12345678" }, { body: "x", tags: ["MRN: 12345678"] }]) {
      const res = await POST(req({ clientKey: K, ...b }));
      expect(res.status).toBe(422);
      expect((await res.json()).reason).toBe("identifier");
    }
    expect(create).not.toHaveBeenCalled();
  });
  it("screens a topic's words too", async () => {
    const res = await POST(req({ clientKey: K, body: "x", context: { link: { targetKind: "topic", topic: "MRN: 12345678" } } }));
    expect(res.status).toBe(422);
    expect(create).not.toHaveBeenCalled();
    expect((await item.PATCH(req({ expectedRevision: 1, link: { targetKind: "topic", topic: "MRN: 12345678" } }, "PATCH"), ctx)).status).toBe(422);
    expect(update).not.toHaveBeenCalled();
  });
  it("a retry reports the note it finds and what it holds, and is not audited twice", async () => {
    create.mockResolvedValue({ ok: true, id: N, revision: 3, existing: true, stored: { body: "older", title: null, tags: [] } });
    const res = await POST(req({ clientKey: K, body: "newer" }));
    expect(await res.json()).toMatchObject({ existing: true, revision: 3, stored: { body: "older" } });
    expect(audit).not.toHaveBeenCalled();
  });
  it("the audit row holds codes, never the note's words", async () => {
    await POST(req({ clientKey: K, body: "A private thought about my placement" }));
    expect(audit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(audit.mock.calls[0])).not.toContain("private thought");
  });
  it("a failed save is a 503 the page retries. A section that is not theirs is a 404", async () => {
    create.mockResolvedValue({ ok: false, error: "failed" });
    expect((await POST(req({ clientKey: K, body: "x" }))).status).toBe(503);
    create.mockResolvedValue({ ok: false, error: "not_found" });
    expect((await POST(req({ clientKey: K, body: "x" }))).status).toBe(404);
  });
  it("never calls a model", async () => {
    await POST(req({ clientKey: K, body: "x" }));
    expect(modelCall).not.toHaveBeenCalled();
  });
});

describe("GET", () => {
  it("reads one lesson for the caller, and needs a lesson", async () => {
    const res = await GET(new Request(`http://x/api?session=${N}&step=2&chunks=${K}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(lesson.mock.calls[0][1]).toBe(USER);
    expect(lesson.mock.calls[0][2]).toMatchObject({ sessionId: N, step: 2, chunkIds: [K] });
    expect((await GET(new Request("http://x/api"))).status).toBe(400);
    expect((await GET(new Request(`http://x/api?session=${N}&step=999`))).status).toBe(400);
  });
});

describe("PATCH", () => {
  it("needs a revision", async () => {
    expect((await item.PATCH(req({ body: "x" }, "PATCH"), ctx)).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
  it("a save from an old copy is 409 with the stored copy, and nothing is overwritten", async () => {
    update.mockResolvedValue({ ok: false, error: "conflict", current: { body: "other", title: null, tags: [], revision: 9 } });
    const res = await item.PATCH(req({ expectedRevision: 1, body: "x" }, "PATCH"), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ conflict: true, current: { revision: 9 } });
  });
  it("a link to something gone is 422, never the note's own 404, so the page does not treat the note as removed", async () => {
    update.mockResolvedValue({ ok: false, error: "target" });
    const res = await item.PATCH(req({ expectedRevision: 1, link: { targetKind: "free" } }, "PATCH"), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("target");
  });
  it("words written for another learner are refused, on a first save and on a change", async () => {
    expect((await POST(req({ forUser: K, clientKey: K, body: "x" }))).status).toBe(401);
    expect((await item.PATCH(req({ forUser: K, expectedRevision: 1, body: "x" }, "PATCH"), ctx)).status).toBe(401);
    expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
    expect((await POST(req({ forUser: USER, clientKey: K, body: "x" }))).status).toBe(200);
  });
  it("another learner's note is simply not found", async () => {
    update.mockResolvedValue({ ok: false, error: "not_found" });
    const missing = await item.PATCH(req({ expectedRevision: 1, body: "x" }, "PATCH"), ctx);
    expect(missing.status).toBe(404);
    expect((await missing.json()).reason).toBe("not_found");
    expect(update.mock.calls[0][1]).toBe(USER);
  });
  it("screens an edit for patient identifiers", async () => {
    expect((await item.PATCH(req({ expectedRevision: 1, body: "MRN: 12345678" }, "PATCH"), ctx)).status).toBe(422);
    expect(update).not.toHaveBeenCalled();
  });
  it("only a competency the learner can see may be linked", async () => {
    expect((await item.PATCH(req({ expectedRevision: 1, competencyId: K }, "PATCH"), ctx)).status).toBe(422);
    expect((await item.PATCH(req({ expectedRevision: 1, competencyId: N }, "PATCH"), ctx)).status).toBe(200);
  });
  it("typing is not audited. A pin or a link is, by code only", async () => {
    await item.PATCH(req({ expectedRevision: 1, body: "typing" }, "PATCH"), ctx);
    expect(audit).not.toHaveBeenCalled();
    await item.PATCH(req({ expectedRevision: 1, pinned: true }, "PATCH"), ctx);
    expect(audit).toHaveBeenCalledTimes(1);
  });
});

describe("DELETE", () => {
  it("removes the caller's own, and audits by code", async () => {
    expect((await item.DELETE(req({}, "DELETE"), ctx)).status).toBe(200);
    expect(remove.mock.calls[0][1]).toBe(USER);
    expect(audit).toHaveBeenCalledTimes(1);
  });
  it("another learner's id is simply not found", async () => {
    remove.mockResolvedValue("not_found");
    expect((await item.DELETE(req({}, "DELETE"), ctx)).status).toBe(404);
  });
});
