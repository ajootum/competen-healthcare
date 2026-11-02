/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

// SCHOLAR-CE-2026 CE-05: a scenario ALREADY STORED is held to today's rules. One written under an earlier prompt (v1: the opening that gave the
// answer away, "a healthcare student is revising...") must never be offered for a NEW attempt; nothing is deleted, and an answered one keeps its history.

const h = vi.hoisted(() => ({ reads: [] as string[], content: "" }));
vi.mock("./store", () => ({ getPassage: async (_a: unknown, _u: string, id: string) => { h.reads.push(id); return h.content ? { chunkId: id, content: h.content } : null; } }));

import { checkRevisionDraft, pickQuestions, type PoolItem } from "./revision";
import { SCENARIO_MIN_VERSION, scenarioVersionOf, storedScenarioProblem } from "./scenario";
import { offerable, staleScenarios } from "./scenario-service";
import { GOOD, NOTE, STUDENT_FRAMED, UNCITED, LEAKING } from "./scenario.fixture";
import { effectiveKind } from "./revision";

const passage = { chunkId: "c1", materialId: "m1", materialTitle: "Recognising deterioration", ordinal: 1, pageFrom: 1, pageTo: 1, content: NOTE };
/** A scenario row as the store hands it back: the answer is what checkRevisionDraft stored (or, for a refused draft, built by hand). */
const stored = (raw: any, version: string, id: string): any => {
  const ok = checkRevisionDraft("scenario", GOOD, passage);
  if (!ok.ok) throw new Error("fixture");
  const answer = (ok.draft.answer as any);
  // A hand-built item keeps GOOD's stored shape but the stem and stages of `raw` (what an older prompt would have stored).
  const stages = (raw === GOOD ? answer.stages : raw.stages.map((s: any, i: number) => ({ ...answer.stages[Math.min(i, 2)], ...s, ...(s.kind === "mcq" ? { options: s.options, correct: s.correct } : {}) })));
  return {
    id, materialId: "m1", chunkId: "c1", kind: "short", stem: raw.situation, options: [], correctIndex: null, rationale: "r", sourceQuote: "q", model: "m", promptVersion: version,
    createdAt: "2026-11-01T00:00:00Z", answer: { ...answer, stages }, difficulty: 2, materialTitle: "M", ordinal: 1, pageFrom: 1, pageTo: 1, unit: "page", latest: null,
    competencyId: null, caseId: null, caseStep: null, caseTitle: null,
  };
};

beforeEach(() => { h.reads.length = 0; h.content = NOTE; });

describe("the stored rule", () => {
  it("the current version is the oldest offered", () => {
    expect(scenarioVersionOf("scholar-scenario-v3+x")).toBe(3);
    expect(scenarioVersionOf("scholar-scenario-v1")).toBe(1);
    expect(scenarioVersionOf(null)).toBeNull();
    expect(scenarioVersionOf("scholar-revision-v3:short")).toBeNull();
    expect(SCENARIO_MIN_VERSION).toBe(3);
  });
  it("a stored v1 item -- even one that is otherwise sound -- is not offered; a missing version is not either", () => {
    expect(storedScenarioProblem(stored(GOOD, "scholar-scenario-v1", "a"), NOTE)).toBe("stale_scenario");
    expect(storedScenarioProblem(stored(GOOD, "scholar-scenario-v2", "a"), NOTE)).toBe("stale_scenario"); // v2 allowed plain recall questions
    expect(storedScenarioProblem(stored(GOOD, "", "a"), NOTE)).toBe("stale_scenario");
    expect(storedScenarioProblem({ ...stored(GOOD, "scholar-scenario-v3", "a"), promptVersion: undefined }, NOTE)).toBe("stale_scenario");
  });
  it("a stored v3 valid item is offered, and so is a later version", () => {
    expect(storedScenarioProblem(stored(GOOD, "scholar-scenario-v3", "a"), NOTE)).toBeNull();
    expect(storedScenarioProblem(stored(GOOD, "scholar-scenario-v4", "a"), NOTE)).toBeNull();
  });
  it("a v3 item that fails today's checks is not offered, with the reason", () => {
    expect(storedScenarioProblem(stored(LEAKING, "scholar-scenario-v3", "a"), NOTE)).toBe("answer_leaked");
    expect(storedScenarioProblem(stored(STUDENT_FRAMED, "scholar-scenario-v3", "a"), NOTE)).toBe("not_a_scenario");
    expect(storedScenarioProblem(stored(UNCITED, "scholar-scenario-v3", "a"), NOTE)).toBe("uncited_stage");
  });
  it("a section that can no longer be read, or a stored shape that is no longer a scenario, is not offered", () => {
    expect(storedScenarioProblem(stored(GOOD, "scholar-scenario-v3", "a"), null)).toBe("stale_scenario");
    expect(storedScenarioProblem({ ...stored(GOOD, "scholar-scenario-v3", "a"), answer: { format: "scenario", accepted: ["x"], stages: [] } }, NOTE)).toBe("stale_scenario");
  });
});

describe("what a new session or a replayed set may be given", () => {
  const rows = () => [stored(LEAKING, "scholar-scenario-v1", "old"), stored(GOOD, "scholar-scenario-v3", "new"), { ...stored(GOOD, "x", "plain"), kind: "mrq", answer: { correct: [0] } }];
  it("the stale scenario is withheld, the valid one and every other format are not; the notes are read once", async () => {
    const r = await offerable({} as any, "u1", rows());
    expect(r.questions.map((q: any) => q.id)).toEqual(["new", "plain"]);
    expect([...r.stale]).toEqual([["old", "stale_scenario"]]);
    expect(h.reads).toEqual(["c1"]);
  });
  it("a stored v1 leaking item is not selected for a new session; the stored v3 valid one is", async () => {
    const { questions } = await offerable({} as any, "u1", rows().slice(0, 2));
    const pool: PoolItem[] = questions.map((q: any) => ({ id: q.id, kind: effectiveKind(q), difficulty: 2, chunkId: q.chunkId, createdAt: q.createdAt, latestCorrect: null, misses: 0, lastAnsweredAt: null, due: false }));
    const pick = pickQuestions({ mode: "quick", pool, quantity: 5, formats: ["scenario"], difficulty: "any", seed: "s", recentMisses: [] } as any);
    expect(pick.ids).toEqual(["new"]);
    // the stale one leaves the session short by none, so the route has nothing to replace; had the valid one not existed the shortfall would write a fresh one
    const none = pickQuestions({ mode: "quick", pool: pool.filter(p => p.id === "old" as string), quantity: 1, formats: ["scenario"], difficulty: "any", seed: "s", recentMisses: [] } as any);
    expect(none.ids).toEqual([]);
    expect(none.shortfall).toBe(1);
  });
  it("a scenario the learner already answered stays in its session (history), whatever its state today; an unanswered stale one leaves it", async () => {
    const r = await offerable({} as any, "u1", [stored(LEAKING, "scholar-scenario-v1", "answered"), stored(LEAKING, "scholar-scenario-v1", "unanswered")], new Set(["answered"]));
    expect(r.questions.map((q: any) => q.id)).toEqual(["answered"]);
    expect([...r.stale.keys()]).toEqual(["unanswered"]);
  });
  it("nothing is read for a session with no scenario", async () => {
    await staleScenarios({} as any, "u1", [{ ...stored(GOOD, "x", "p"), kind: "mcq", answer: null }]);
    expect(h.reads).toEqual([]);
  });
  it("when the section is gone, a stored scenario is not offered", async () => {
    h.content = "";
    expect((await offerable({} as any, "u1", [stored(GOOD, "scholar-scenario-v3", "new")])).questions).toEqual([]);
  });
});
