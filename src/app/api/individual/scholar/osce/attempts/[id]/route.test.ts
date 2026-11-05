// The race between an autosave and a finish: the run closing under a write is not a failed write.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  reads: [] as unknown[],
  saveOk: true,
  finishOk: true,
  finishCalls: 0,
}));

const open = { id: "a1", stationId: "s1", startedAt: new Date(Date.now() - 60_000).toISOString(), finishedAt: null, durationSeconds: null, timeUp: false, status: "in_progress", responses: { Notes: "kept" }, ticks: null, snapshot: null, feedback: null };
const done = { ...open, status: "finished", finishedAt: new Date().toISOString(), durationSeconds: 60, timeUp: false };

vi.mock("@/lib/individual/guard", () => ({
  requireIndividualContext: async () => ({ admin: {}, userId: "u1" }),
  isGuardRefusal: () => false,
}));
vi.mock("@/lib/individual/scholar/store", () => ({
  getOsceAttempt: async () => h.reads.shift() ?? null,
  getOsceStation: async () => ({ id: "s1", checklist: [] }),
  saveOsceProgress: async () => h.saveOk,
  finishOsceAttempt: async () => { h.finishCalls++; return h.finishOk; },
  abandonOsceAttempt: async () => true,
  markOsceAttempt: async () => true,
  saveOsceFeedback: async () => true,
}));
vi.mock("@/lib/individual/scholar/extract", () => ({ findPatientIdentifiers: () => [] }));
vi.mock("@/lib/individual/scholar/http", () => ({ SCHOLAR_AI_AUDIT_ACTION: "x", aiPreflight: async () => null, audit: async () => {}, refusalWords: () => ({ message: "" }), scholarAiRunner: () => ({}), scholarRisk: async () => ({}) }));
vi.mock("@/lib/individual/scholar/ai-standing", () => ({ activityState: () => ({ available: false }), getScholarAiStanding: async () => ({}) }));
vi.mock("@/lib/individual/scholar/generation", () => ({ runOsceFeedback: async () => ({ ok: false }) }));
vi.mock("@/lib/individual/scholar/outcome", () => ({ recordScholarOutcome: async () => {} }));
vi.mock("@/lib/individual/scholar/osce-service", () => ({
  checklistView: () => [{ id: "c1" }], osceGate: async () => null, resultExtras: () => ({}), stationSnapshot: () => ({ sections: ["Notes"], checklist: [], durationMinutes: 10 }),
}));

import { POST } from "./route";

const post = async (body: unknown) => {
  const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "a1" }) });
  return { status: res.status, json: await res.json() };
};

beforeEach(() => { h.reads = []; h.saveOk = true; h.finishOk = true; h.finishCalls = 0; });

describe("OSCE run: finish and autosave landing together", () => {
  it("a save beaten by a finish says the run closed, not that saving failed", async () => {
    h.reads = [open, done]; h.saveOk = false;
    const r = await post({ action: "save", responses: { Notes: "x" } });
    expect(r.status).toBe(409);
    expect(r.json.closed).toBe(true);
    expect(r.json.checklist).toEqual([{ id: "c1" }]);
  });
  it("a save that fails on a run still open still says so", async () => {
    h.reads = [open, open]; h.saveOk = false;
    const r = await post({ action: "save", responses: { Notes: "x" } });
    expect(r.status).toBe(500);
    expect(r.json.closed).toBeUndefined();
  });
  it("a finish beaten by another finish reports the run as finished", async () => {
    h.reads = [open, done]; h.finishOk = false;
    const r = await post({ action: "finish", responses: { Notes: "x" } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ finished: true, durationSeconds: 60, timeUp: false });
    expect(r.json.checklist).toEqual([{ id: "c1" }]);
  });
  it("a finish on a run already finished and not marked is the same reply, and writes nothing", async () => {
    h.reads = [done];
    const r = await post({ action: "finish", responses: { Notes: "x" } });
    expect(r.status).toBe(200);
    expect(r.json.finished).toBe(true);
    expect(h.finishCalls).toBe(0);
  });
  it("a finish that really failed still tells the learner to keep their text", async () => {
    h.reads = [open, open]; h.finishOk = false;
    const r = await post({ action: "finish", responses: { Notes: "x" } });
    expect(r.status).toBe(500);
    expect(r.json.error).toMatch(/could not be saved/);
  });
  it("an abandoned or marked run is not reported as newly finished", async () => {
    h.reads = [{ ...open, status: "abandoned" }];
    expect((await post({ action: "finish" })).status).toBe(409);
    h.reads = [{ ...done, ticks: [{ itemId: "c1", mark: "done" }] }];
    expect((await post({ action: "finish" })).status).toBe(409);
  });
});
