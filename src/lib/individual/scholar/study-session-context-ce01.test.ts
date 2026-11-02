import { describe, expect, it } from "vitest";
import {
  buildStudySessionContext, daysUntil, examDistance, STUDY_CONTEXT_LIMITS, STUDY_CONTEXT_MAX_CHARS, type StudySessionContextInput,
} from "./study-session-context";

// SCHOLAR-CE-2026 CE-01: flashcard state and the learner's plan in the study-session block. Pure, deterministic, capped, words only.

const base = (): StudySessionContextInput => ({
  focus: { title: "Acute kidney injury", objective: null, competencies: [] },
  sources: [], missed: [], mistakes: [], unsure: [], osce: [],
  progress: { stepsDone: 1, stepsTotal: 4, completed: false, stagesTouched: ["Learn"] },
});
const card = (n: number, front: string, quality: number | null = 1) => ({ id: `c${String(n).padStart(2, "0")}`, front, topic: null, quality });

describe("flashcard state", () => {
  it("says the due count in words and lists the weakest card fronts, at most five, weakest first", () => {
    const weak = [card(1, "What is oliguria?", 2), card(2, "Define stage three AKI", 0), card(3, "Name two nephrotoxins", 1), card(4, "Causes of prerenal AKI", 2), card(5, "Normal urine output", 1), card(6, "Sixth card front", 2), card(7, "Seventh card front", 2)];
    const r = buildStudySessionContext({ ...base(), flashcards: { due: 7, weak } })!;
    expect(r.text).toContain("I have seven flashcards due for review.");
    const lines = r.text.split("\n").filter(l => l.startsWith("A flashcard I find hard:"));
    expect(lines).toHaveLength(STUDY_CONTEXT_LIMITS.weakCards);
    expect(lines[0]).toContain("Define stage three AKI");
    expect(r.text).not.toContain("Seventh card front");
    expect(r.sections).toContain("misconceptions");
  });

  it("is deterministic whatever order the cards were read in", () => {
    const weak = [card(1, "Alpha front", 1), card(2, "Beta front", 1), card(3, "Gamma front", 0)];
    const a = buildStudySessionContext({ ...base(), flashcards: { due: 2, weak } })!.text;
    const b = buildStudySessionContext({ ...base(), flashcards: { due: 2, weak: [...weak].reverse() } })!.text;
    expect(a).toBe(b);
  });

  it("empty states: no cards read says nothing about cards; none due says so; a count is never shown as a figure", () => {
    expect(buildStudySessionContext({ ...base(), flashcards: null })!.text).not.toMatch(/flashcard/i);
    expect(buildStudySessionContext({ ...base(), flashcards: { due: null, weak: [] } })!.text).not.toMatch(/flashcard/i);
    expect(buildStudySessionContext({ ...base(), flashcards: { due: 0, weak: [] } })!.text).toContain("I have no flashcards due for review.");
    const one = buildStudySessionContext({ ...base(), flashcards: { due: 1, weak: [] } })!.text;
    expect(one).toContain("I have one flashcard due for review.");
    expect(buildStudySessionContext({ ...base(), flashcards: { due: 240, weak: [] } })!.text).toContain("many flashcards");
    expect(buildStudySessionContext({ ...base(), flashcards: { due: 240, weak: [card(1, "Front 123 with codes ABC-123", 1)] } })!.text).not.toMatch(/\d/);
  });

  it("leaves out a card front carrying a patient identifier", () => {
    const r = buildStudySessionContext({ ...base(), flashcards: { due: 1, weak: [card(1, "Mr Jones NHS number 943 476 5919 front", 0), card(2, "Safe front", 1)] } })!;
    expect(r.text).toContain("Safe front");
    expect(r.text).not.toContain("943");
  });
});

describe("the learner's plan", () => {
  it("states goal, exam distance and priorities in words", () => {
    const r = buildStudySessionContext({ ...base(), plan: { goalType: "exam", goal: "Pass my renal module", examInDays: 21, priorities: ["Fluid balance", "Staging", "Dosing", "Fourth priority"] } })!;
    expect(r.text).toContain("My study goal is to prepare for an exam.");
    expect(r.text).toContain("In my own words: Pass my renal module.");
    expect(r.text).toContain("My exam is in about three weeks.");
    expect(r.text).toContain("Topics I am prioritising: Fluid balance; Staging; Dosing.");
    expect(r.text).not.toContain("Fourth priority");
    expect(r.text).not.toMatch(/\d/);
  });
  it("no plan, or an empty one, says nothing; a past exam date is not said", () => {
    expect(buildStudySessionContext({ ...base(), plan: null })!.text).not.toMatch(/exam|goal/i);
    expect(buildStudySessionContext({ ...base(), plan: { goalType: null, goal: null, examInDays: null, priorities: [] } })!.text).not.toMatch(/exam|goal|prioritis/i);
    expect(buildStudySessionContext({ ...base(), plan: { goalType: null, goal: null, examInDays: -3, priorities: [] } })!.text).not.toMatch(/exam/i);
  });
  it("is cut first when over the cap: the focus survives, the plan goes before step progress", () => {
    const r = buildStudySessionContext({ ...base(), plan: { goalType: "learn", goal: "goal words", examInDays: 5, priorities: ["Topic one"] } }, 230)!;
    expect(r.text.length).toBeLessThanOrEqual(230);
    expect(r.text).toContain("I am studying: Acute kidney injury");
    expect(r.text).not.toContain("Topic one");
  });
  it("the whole block stays within the 3000-character cap with everything present", () => {
    const weak = Array.from({ length: 30 }, (_, i) => card(i, `A long flashcard front about topic number ${i} ${"word ".repeat(40)}`, i % 3));
    const r = buildStudySessionContext({ ...base(), flashcards: { due: 30, weak }, plan: { goalType: "exam", goal: "g ".repeat(300), examInDays: 400, priorities: ["p ".repeat(300)] } })!;
    expect(r.text.length).toBeLessThanOrEqual(STUDY_CONTEXT_MAX_CHARS);
  });
});

describe("date words", () => {
  it("counts whole days and puts them in words", () => {
    expect(daysUntil("2026-11-12", "2026-11-02")).toBe(10);
    expect(daysUntil("2026-10-30", "2026-11-02")).toBe(-3);
    expect(daysUntil("tomorrow", "2026-11-02")).toBeNull();
    expect(daysUntil(null, "2026-11-02")).toBeNull();
    expect(examDistance(0)).toBe("today");
    expect(examDistance(1)).toBe("tomorrow");
    expect(examDistance(10)).toBe("in ten days");
    expect(examDistance(21)).toBe("in about three weeks");
    expect(examDistance(400)).toBe("more than twenty weeks away");
    expect(examDistance(-1)).toBe("");
    expect(examDistance(null)).toBe("");
  });
});
