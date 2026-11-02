import { beforeEach, describe, expect, it, vi } from "vitest";

// SCHOLAR-CE-2026 CE-01: the Learn assistant route given the in-place "Ask about this" context. The store reads are keyed on the
// caller (as in production): learner B naming learner A's section ids gets those ids DROPPED, never A's text and never an error that
// says the id exists. The engine is replaced by a recorder, so what the model WOULD have been given is what is asserted.

const h = vi.hoisted(() => ({
  A: "aaaaaaaa-0000-4000-8000-00000000000a", B: "bbbbbbbb-0000-4000-8000-00000000000b",
  user: "" as string,
  runs: [] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
  reads: [] as string[],
}));
const chunk = (n: number) => `aaaaaaaa-0000-4000-8000-0000000000c${n}`;

vi.mock("@/lib/individual/guard", () => ({
  requireIndividualContext: async () => ({ admin: {}, userId: h.user, profile: { fullName: "T" }, live: ["scholar"] }),
  isGuardRefusal: () => false,
}));
vi.mock("@/lib/individual/personal-ai", () => ({
  runIndividualAssistant: async (_a: unknown, r: unknown) => {
    h.runs.push(r);
    return { ok: true, answer: "Fluid balance matters [S1]. Tag [S9] is nothing.\n\nNOT COVERED: dosing", mode: "ask", model: "m", scopesRead: [] };
  },
}));
vi.mock("@/lib/individual/scholar/store", async () => {
  const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  return {
    isUuid: uuid,
    // Only learner A owns chunks c1..c3.
    getPassage: async (_a: unknown, userId: string, id: string) => {
      h.reads.push(`${userId}:${id}`);
      const n = Number(id.slice(-1));
      return userId === h.A && id === chunk(n) && n >= 1 && n <= 3
        ? { chunkId: id, materialId: "aaaaaaaa-0000-4000-8000-0000000000m1", materialTitle: "Renal notes", ordinal: n, pageFrom: n, pageTo: n, content: `Text of section ${n} about fluid balance.` }
        : null;
    },
    getLearningSession: async () => ({ ok: true, data: null }),
  };
});
vi.mock("@/lib/individual/scholar/http", () => ({
  SCHOLAR_AI_AUDIT_ACTION: "ai_assistant_query",
  aiPreflight: async () => null,
  audit: async () => {},
  meteredRefusal: () => null,
  scholarRequestId: () => "req",
  scholarRisk: async (_a: unknown, _u: string, i: { passages: { content: string }[] }) => ({ text: i.passages.map(p => p.content).join("\n"), requestText: "", competencyIds: [], topicTerms: ["Fluid balance"] }),
}));
vi.mock("@/lib/individual/scholar/study-context", () => ({ studySessionBlock: async () => null }));
vi.mock("@/lib/individual/scholar/competency-view", () => ({ loadLearnerCatalogue: async () => ({ competencies: [] }) }));

import { POST } from "./route";

const post = (body: unknown) => POST(new Request("http://localhost/api/individual/scholar/learn/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const ask = (surface: string, chunkIds: string[], extra: Record<string, unknown> = {}) => ({ question: "Explain why the answer is B", mode: "ask", askContext: { surface, chunkIds, refLabel: "Question feedback", ...extra } });

beforeEach(() => { h.runs.length = 0; h.reads.length = 0; h.user = h.A; });

describe("POST learn/assistant with askContext", () => {
  it("grounds on the caller's own sections, cites them, lifts the NOT COVERED line and maps the surface", async () => {
    const res = await post(ask("flashcards", [chunk(1), chunk(2)]));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sources.map((s: { tag: string }) => s.tag)).toEqual(["S1"]);
    expect(json.answer).not.toContain("[S9]");
    expect(json.notCovered).toEqual(["dosing"]);
    expect(json.label).toMatch(/Personal AI/);
    const run = h.runs[0];
    expect(run.study.numbered).toContain("[S1]");
    expect(run.study.numbered).toContain("[S2]");
    expect(run.intentContext).toMatchObject({ surface: "revise", activity: "Question feedback" });
  });

  it("maps case and OSCE onto the existing apply surface and plan/library onto learn", async () => {
    for (const [surface, want] of [["case", "apply"], ["osce", "apply"], ["library", "learn"], ["plan", "learn"], ["revise", "revise"]] as const) {
      h.runs.length = 0;
      await post(ask(surface, [chunk(1)]));
      expect(h.runs[0].intentContext.surface).toBe(want);
    }
  });

  it("learner B naming learner A's sections: the ids are dropped, no text of A's reaches the model, nothing says they exist", async () => {
    h.user = h.B;
    const res = await post(ask("revise", [chunk(1), chunk(2), chunk(3)]));
    expect(res.status).toBe(200);
    const run = h.runs[0];
    expect(run.study.numbered).toBe("");
    expect(run.study.sources).toEqual([]);
    expect(JSON.stringify(run)).not.toContain("fluid balance");
    // every read was keyed on B, never on A
    expect(h.reads.every(r => r.startsWith(`${h.B}:`))).toBe(true);
    const json = await res.json();
    expect(json.sources).toEqual([]);
  });

  it("a mix keeps only the caller's own and never more than six are read", async () => {
    const res = await post(ask("revise", [chunk(1), chunk(9), chunk(3), chunk(4), chunk(5), chunk(6), chunk(7), chunk(8)]));
    expect(res.status).toBe(200);
    expect(h.reads.length).toBeLessThanOrEqual(6);
    expect(h.runs[0].study.sources.map((s: { citation: string }) => s.citation).length).toBe(2);
  });

  it("with no section left, the question still runs as a general explanation under the label", async () => {
    const res = await post(ask("osce", []));
    expect(res.status).toBe(200);
    expect((await res.json()).label).toMatch(/general explanation/);
    expect(h.runs).toHaveLength(1);
  });

  it("an unreadable context is refused before any read or model call", async () => {
    const res = await post({ question: "Why?", askContext: { surface: "billing", chunkIds: [chunk(1)] } });
    expect(res.status).toBe(400);
    expect(h.runs).toHaveLength(0);
    expect(h.reads).toHaveLength(0);
  });

  it("without askContext the route is as before: no sections is still a 400", async () => {
    expect((await post({ question: "Why?" })).status).toBe(400);
  });

  it("a patient identifier in the question is refused before anything is read", async () => {
    const res = await post({ ...ask("revise", [chunk(1)]), question: "NHS number 943 476 5919 what dose" });
    expect(res.status).toBe(422);
    expect(h.runs).toHaveLength(0);
  });
});
