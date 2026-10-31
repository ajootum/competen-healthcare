import { describe, expect, it } from "vitest";
import { eligibleAchievements, parseLabel, studyAchievementsFrom, studyDetail, type ChoiceRow } from "./passport-items";
import { EVIDENCE_LABEL } from "../passport";

// COMPETEN-IND-004 s11, migration 375: the person's choice of study achievements in their Passport.

const materials = [{ id: "m1", title: "Renal notes" }, { id: "m2", title: "Sepsis notes" }];
const questions = [
  { id: "q1", materialId: "m1", kind: "mcq" as const },
  { id: "q2", materialId: "m1", kind: "mcq" as const },
  { id: "q3", materialId: "m1", kind: "case" as const },
  { id: "q4", materialId: "m2", kind: "mcq" as const },
];
const attempts = [
  { questionId: "q1", answeredAt: "2026-10-20T10:00:00Z" },
  { questionId: "q1", answeredAt: "2026-10-21T10:00:00Z" },
  { questionId: "q2", answeredAt: "2026-10-22T09:00:00Z" },
  { questionId: "q3", answeredAt: "2026-10-19T09:00:00Z" },
];
const choice = (over: Partial<ChoiceRow>): ChoiceRow => ({ materialId: "m1", achievement: "practice_questions", label: "My renal study", includedAt: "2026-10-23T00:00:00Z", ...over });

describe("eligible achievements", () => {
  it("are only what was earned: one per material and kind with at least one answer", () => {
    const e = eligibleAchievements({ materials, questions, attempts, choices: [] });
    expect(e.map(x => `${x.materialId}:${x.achievement}:${x.answered}`)).toEqual(["m1:practice_questions:2", "m1:practice_scenarios:1"]);
    expect(e.every(x => x.chosenLabel === null)).toBe(true);
  });

  it("counts distinct questions, not answers, and dates from the latest answer", () => {
    const e = eligibleAchievements({ materials, questions, attempts, choices: [] });
    expect(e[0]).toMatchObject({ answered: 2, lastStudied: "2026-10-22T09:00:00Z" });
  });

  it("says which ones are chosen, and under what title", () => {
    const e = eligibleAchievements({ materials, questions, attempts, choices: [choice({})] });
    expect(e.find(x => x.achievement === "practice_questions")?.chosenLabel).toBe("My renal study");
    expect(e.find(x => x.achievement === "practice_scenarios")?.chosenLabel).toBeNull();
  });
});

describe("what the Passport shows", () => {
  it("⚠ nothing by default: no choice, no item, whatever the study history", () => {
    expect(studyAchievementsFrom({ choices: [], questions, attempts })).toEqual([]);
  });

  it("each chosen achievement, independently, with its figure", () => {
    const shown = studyAchievementsFrom({ choices: [choice({}), choice({ achievement: "practice_scenarios", label: "Scenarios" })], questions, attempts });
    expect(shown.map(s => [s.label, s.answered])).toEqual([["My renal study", 2], ["Scenarios", 1]]);
  });

  it("⚠ drops an item with nothing answered rather than claim an achievement of zero", () => {
    expect(studyAchievementsFrom({ choices: [choice({ materialId: "m2", achievement: "practice_scenarios" })], questions, attempts })).toEqual([]);
  });

  it("⚠ carries no note text, question, answer or result -- only the title, kind, count and dates", () => {
    const [s] = studyAchievementsFrom({ choices: [choice({})], questions, attempts });
    expect(Object.keys(s).sort()).toEqual(["achievement", "answered", "includedAt", "label", "lastStudied", "materialId"]);
  });

  it("describes the figure as practice answered from own notes, never as accuracy", () => {
    expect(studyDetail({ achievement: "practice_questions", answered: 1 })).toBe("1 practice question answered from own notes");
    expect(studyDetail({ achievement: "practice_scenarios", answered: 3 })).toBe("3 practice scenarios answered from own notes");
  });

  it("is labelled self-directed, distinct from every other evidence class", () => {
    expect(EVIDENCE_LABEL.self_directed).toBe("Self-directed study, not a verified competency");
    expect(new Set(Object.values(EVIDENCE_LABEL)).size).toBe(Object.keys(EVIDENCE_LABEL).length);
  });
});

describe("the title", () => {
  it("is trimmed with whitespace collapsed, 1 to 120 characters", () => {
    expect(parseLabel("  Renal   study ")).toBe("Renal study");
    expect(parseLabel("   ")).toBeNull();
    expect(parseLabel("x".repeat(121))).toBeNull();
    expect(parseLabel(42)).toBeNull();
  });
});

describe("code-marked revision kinds count under practice questions (owner-delegated ruling 31 Oct)", () => {
  const qs = [
    { id: "r1", materialId: "m1", kind: "mrq" }, { id: "r2", materialId: "m1", kind: "match" }, { id: "r3", materialId: "m1", kind: "sequence" },
    { id: "r4", materialId: "m1", kind: "short" }, { id: "r5", materialId: "m1", kind: "structured" }, { id: "r6", materialId: "m1", kind: "mrq" },
  ];
  const at = (questionId: string, marking?: string) => ({ questionId, answeredAt: "2026-10-25T10:00:00Z", marking });

  it("counts mrq, match and sequence answers marked by code", () => {
    const e = eligibleAchievements({ materials, questions: qs, attempts: [at("r1", "deterministic"), at("r2", "deterministic"), at("r3", "deterministic")], choices: [] });
    expect(e.map(x => `${x.achievement}:${x.answered}`)).toEqual(["practice_questions:3"]);
  });

  it("never counts AI-marked or self-graded answers, nor short or structured questions", () => {
    const e = eligibleAchievements({
      materials, questions: qs, choices: [],
      attempts: [at("r4", "ai_evaluation"), at("r4", "self_graded"), at("r5", "ai_evaluation"), at("r5", "deterministic"), at("r1", "self_graded"), at("r6", "ai_evaluation"), at("r2")],
    });
    // short/structured never count (even if somehow code-marked), and mrq/match only when explicitly deterministic.
    expect(e.filter(x => x.achievement === "practice_questions")).toEqual([]);
  });

  it("adds to the mcq figure and to what the Passport shows, distinct questions only", () => {
    const shown = studyAchievementsFrom({ choices: [choice({})], questions: [...questions, ...qs], attempts: [...attempts, at("r1", "deterministic"), at("r1", "deterministic"), at("r4", "ai_evaluation")] });
    expect(shown.map(s => s.answered)).toEqual([3]);
  });

  it("a legacy mcq or case answer with no marking still counts", () => {
    expect(eligibleAchievements({ materials, questions, attempts, choices: [] }).map(x => x.answered)).toEqual([2, 1]);
  });
});

describe("study achievement wording is the one studyDetail() wording", () => {
  it("revision reviews read as reviews, not answers", () => {
    expect(studyDetail({ achievement: "revision_reviews", answered: 8 })).toBe("8 revision reviews of own notes");
    expect(studyDetail({ achievement: "practice_questions", answered: 1 })).toBe("1 practice question answered from own notes");
  });
});
