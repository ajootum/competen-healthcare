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
