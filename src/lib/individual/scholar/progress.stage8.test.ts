import { describe, expect, it } from "vitest";
import { learningHistory, periods, trendOf, weekStart, type HistoryInput } from "./progress-history";
import { nextSteps } from "./progress-next";
import { evaluate, type EAttempt, type EvaluationRules } from "./evaluation";

// COMPETEN-SCHOLAR-PROGRESS-01 (Progress, Stage 8 of 8) P2 and P4, pinned by being run.

const NOW = "2026-10-25T12:00:00.000Z";
let n = 0;
const A = (questionId: string, correct: boolean, at: string): EAttempt => ({ id: `a${++n}`, questionId, correct, marking: "deterministic", answeredAt: at, sessionId: null });
const empty: HistoryInput = { questions: [], attempts: [], reviews: [], decisions: [], checks: [], evaluations: [], contexts: [] };

describe("learning history (P2)", () => {
  it("weeks run Monday to Monday, oldest first, ending with the current week", () => {
    expect(weekStart(NOW)).toBe("2026-10-19T00:00:00.000Z");
    const p = periods("week", NOW, 3, []);
    expect(p.map(x => x.start)).toEqual(["2026-10-05T00:00:00.000Z", "2026-10-12T00:00:00.000Z", "2026-10-19T00:00:00.000Z"]);
  });

  it("knowledge counts only first answers to new questions; answering again is exposure, never improvement", () => {
    const h = learningHistory({ ...empty, attempts: [
      A("q1", false, "2026-10-13T10:00:00Z"), A("q2", false, "2026-10-13T11:00:00Z"), A("q3", true, "2026-10-14T10:00:00Z"),
      // the same three again the next week, all right: practice, not new evidence
      A("q1", true, "2026-10-20T10:00:00Z"), A("q2", true, "2026-10-20T11:00:00Z"), A("q3", true, "2026-10-21T10:00:00Z"),
    ] }, { kind: "week", now: NOW, count: 2, minPerPeriod: 3 });
    expect(h.rows[0].knowledge).toEqual({ n: 3, correct: 1, percent: 33 });
    expect(h.rows[1].knowledge).toEqual({ n: 0, correct: 0, percent: null });
    expect(h.rows[1].exposure).toEqual({ answers: 3, correct: 3 });
    expect(h.trends.knowledge).toBeNull();
  });

  it("a trend compares first-try accuracy on new items between the last two periods with a figure", () => {
    expect(trendOf([{ n: 5, correct: 2, percent: 40 }, { n: 5, correct: 4, percent: 80 }])).toBe("improving");
    expect(trendOf([{ n: 5, correct: 4, percent: 80 }, { n: 1, correct: 0, percent: null }, { n: 5, correct: 4, percent: 75 }])).toBe("steady");
    expect(trendOf([{ n: 5, correct: 4, percent: 80 }, { n: 5, correct: 2, percent: 40 }])).toBe("lower");
  });

  it("programme periods follow the educational context, so a change never rewrites the earlier one", () => {
    const h = learningHistory({ ...empty, contexts: [{ programme: "Nursing diploma", level: "Year 1", from: "2026-01-01T00:00:00Z", to: "2026-09-01T00:00:00Z" }, { programme: "Nursing diploma", level: "Year 2", from: "2026-09-01T00:00:00Z", to: null }],
      attempts: [A("q1", true, "2026-03-01T10:00:00Z"), A("q2", true, "2026-10-01T10:00:00Z")] }, { kind: "programme", now: NOW, count: 0, minPerPeriod: 1 });
    expect(h.rows.map(r => [r.context, r.knowledge.n])).toEqual([["Nursing diploma, Year 1", 1], ["Nursing diploma, Year 2", 1]]);
    expect(h.notes.some(x => /keep their own context/.test(x))).toBe(true);
  });
});

describe("next steps (P4)", () => {
  const RULES: EvaluationRules = { minEvidence: 2, recencyDays: 90, minSources: 1, bands: { strong: 80, developing: 50 }, evidence: ["revision", "spaced_review", "clinical_reasoning", "teach_checks"] };
  const S = (k: number) => ({ chunkId: `k${k}`, materialId: "m1", materialTitle: "Oxygen notes", label: `section ${k}` });
  const Q = (id: string, k: number) => ({ id, chunkId: `k${k}`, materialId: "m1", kind: "mcq", difficulty: 2, competencyId: null, caseId: null });

  it("no finding, no step: with no evidence only a fresh check and the classification are suggested", () => {
    const e = evaluate({ sections: [S(1)], questions: [], attempts: [], reviews: [], checks: [], decisions: [], links: [], catalogue: null }, RULES, NOW);
    const steps = nextSteps(e, { unclassified: [{ id: "m1", title: "Oxygen notes" }], strongMaterials: [], rules: ["teach", "spaced", "case", "evaluate", "classify", "advance"], max: 6 });
    expect(steps.map(s => s.kind)).toEqual(["evaluate", "classify"]);
  });

  it("a gap leads to Teach Me then Revision on that section; switched-off rules suggest nothing", () => {
    const e = evaluate({ sections: [S(1), S(2)], questions: [Q("q1", 1), Q("q2", 1), Q("q3", 2), Q("q4", 2)],
      attempts: [A("q1", false, NOW), A("q2", false, NOW), A("q3", true, NOW), A("q4", true, NOW)], reviews: [], checks: [], decisions: [], links: [], catalogue: null }, RULES, NOW);
    const steps = nextSteps(e, { unclassified: [], strongMaterials: [{ id: "m1", title: "Oxygen notes", n: 12 }], rules: ["teach", "advance"], max: 6 });
    expect(steps.slice(0, 2).map(s => [s.kind, s.chunkId])).toEqual([["teach", "k1"], ["revise", "k1"]]);
    expect(steps.some(s => s.kind === "advance")).toBe(true);
    expect(nextSteps(e, { unclassified: [], strongMaterials: [], rules: [], max: 6 }).some(s => s.kind === "teach")).toBe(false);
  });
});
