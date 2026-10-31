import { describe, expect, it } from "vitest";
import { buildMistakeNotebook, toFixIds, yourAnswerText, type MistakeAttempt, type MistakeQuestion } from "./mistakes";
import { FORMATIVE_KIND } from "./written-feedback";

// SCHOLAR-COMPANION-01 P1: the mistake notebook's grouping and wording. Pure.

const Q = (over: Partial<MistakeQuestion>): MistakeQuestion => ({
  id: "q1", kind: "mcq", stem: "Which airway divides into the main bronchi?", options: ["Pharynx", "Trachea", "Larynx", "Alveoli"], correctIndex: 1, answer: null,
  rationale: "The trachea divides at the carina.", difficulty: 2, materialId: "m1", chunkId: "c1", ...over,
});
const wrong = (questionId: string, answeredAt: string, over: Partial<MistakeAttempt> = {}): MistakeAttempt =>
  ({ questionId, correct: false, answeredAt, chosenIndex: 0, response: null, marking: "deterministic", score: 0, ...over });
const hist = (questionId: string, correct: boolean, answeredAt: string) => ({ questionId, correct, answeredAt });

const questions = new Map<string, MistakeQuestion>([
  ["q1", Q({})],
  ["q2", Q({ id: "q2", stem: "Name one thing.", kind: "short", options: [], correctIndex: null, answer: { accepted: ["oxygen"] }, materialId: "m2", chunkId: "c2", rationale: "Oxygen is a drug." })],
  ["q3", Q({ id: "q3", stem: "A third.", materialId: "m1", chunkId: "c1" })],
]);
const titles = new Map([["m1", "Respiratory"], ["m2", "Drugs"]]);
const topics = new Map([["c1", ["Airway"]], ["c2", ["Oxygen therapy"]]]);

describe("what is still to fix", () => {
  it("is the questions whose latest attempt was wrong", () => {
    expect(toFixIds([hist("a", false, "2026-10-01"), hist("a", true, "2026-10-02"), hist("b", true, "2026-10-01"), hist("b", false, "2026-10-03")])).toEqual(new Set(["b"]));
    expect(toFixIds([])).toEqual(new Set());
  });
});

describe("your answer, in words", () => {
  it("words each kind of answer", () => {
    const q = Q({});
    expect(yourAnswerText(q, { chosenIndex: 0, response: null })).toBe("A. Pharynx");
    expect(yourAnswerText(q, { chosenIndex: null, response: { kind: "text", text: " windpipe " } })).toBe("windpipe");
    expect(yourAnswerText(q, { chosenIndex: null, response: { kind: "set", indexes: [0, 2] } })).toBe("A. Pharynx; C. Larynx");
    expect(yourAnswerText(q, { chosenIndex: null, response: { kind: "order", order: [1, 0] } })).toBe("Trachea → Pharynx");
    expect(yourAnswerText(q, { chosenIndex: null, response: { kind: "parts", texts: ["x", ""] } })).toBe("(a) x; (b) no answer");
    expect(yourAnswerText(q, { chosenIndex: null, response: { kind: "recall", quality: 1 } })).toContain("not remembered");
    expect(yourAnswerText(q, { chosenIndex: null, response: null })).toBe("Not recorded");
  });
});

describe("the notebook", () => {
  const input = {
    wrong: [wrong("q1", "2026-10-05"), wrong("q1", "2026-10-02"), wrong("q2", "2026-10-04", { chosenIndex: null, response: { kind: "text", text: "air" } }), wrong("q3", "2026-10-06")],
    history: [
      hist("q1", false, "2026-10-05"), hist("q1", false, "2026-10-02"), hist("q1", true, "2026-10-01"),
      hist("q2", false, "2026-10-04"), hist("q2", true, "2026-10-07"),
      hist("q3", false, "2026-10-06"),
    ],
    questions, titles, topics,
  };
  it("lists the newest miss first, grouped by material, with counts and the stored key and reason", () => {
    const nb = buildMistakeNotebook({ ...input, show: "all" });
    expect(nb.total).toBe(3);
    expect(nb.toFix).toBe(2);
    expect(nb.groups.map(g => g.title)).toEqual(["Respiratory", "Drugs"]);
    const q1 = nb.groups[0].items.find(i => i.questionId === "q1")!;
    expect(q1.missed).toBe(2);
    expect(q1.lastMissedAt).toBe("2026-10-05");
    expect(q1.corrected).toBe(false);
    expect(q1.yourAnswer).toBe("A. Pharynx");
    expect(q1.correctAnswer).toBe("Trachea");
    expect(q1.rationale).toBe("The trachea divides at the carina.");
    expect(nb.groups[0].items.map(i => i.questionId)).toEqual(["q3", "q1"]);
  });
  it("marks a question corrected only by a LATER correct attempt, and hides it from 'still to fix'", () => {
    const all = buildMistakeNotebook({ ...input, show: "all" });
    const q2 = all.groups[1].items[0];
    expect(q2.corrected).toBe(true);
    expect(q2.correctedAt).toBe("2026-10-07");
    expect(q2.yourAnswer).toBe("air");
    // q1's only correct attempt is BEFORE its misses: not corrected.
    expect(all.groups[0].items.find(i => i.questionId === "q1")!.corrected).toBe(false);
    const fix = buildMistakeNotebook({ ...input });
    expect(fix.groups.map(g => g.materialId)).toEqual(["m1"]);
    expect(fix.toFix).toBe(2);
    expect(fix.total).toBe(3);
  });
  it("filters by material and topic, leaving the counts alone", () => {
    const byMaterial = buildMistakeNotebook({ ...input, show: "all", materialId: "m2" });
    expect(byMaterial.groups.map(g => g.materialId)).toEqual(["m2"]);
    expect(byMaterial.total).toBe(3);
    const byTopic = buildMistakeNotebook({ ...input, show: "all", topic: "Oxygen therapy" });
    expect(byTopic.groups.flatMap(g => g.items.map(i => i.questionId))).toEqual(["q2"]);
    expect(byTopic.topics).toEqual(["Airway", "Oxygen therapy"]);
  });
  it("ignores a wrong attempt whose question no longer exists", () => {
    const nb = buildMistakeNotebook({ ...input, wrong: [...input.wrong, wrong("gone", "2026-10-09")], show: "all" });
    expect(nb.total).toBe(3);
  });
  it("shows formative feedback only on an AI-evaluated answer, labelled by its model", () => {
    const fb = { kind: FORMATIVE_KIND, model: "m", promptVersion: "p", items: [{ part: null, parts: null, summary: "Check the carina." }] };
    const ai = wrong("q2", "2026-10-08", { chosenIndex: null, marking: "ai_evaluation", response: { kind: "text", text: "air", formative: fb } });
    const self = wrong("q2", "2026-10-08", { chosenIndex: null, marking: "self_graded", response: { kind: "text", text: "air", formative: fb } });
    expect(buildMistakeNotebook({ ...input, wrong: [ai], history: [hist("q2", false, "2026-10-08")], show: "all" }).groups[0].items[0].formative).toEqual({ model: "m", texts: ["Check the carina."] });
    expect(buildMistakeNotebook({ ...input, wrong: [self], history: [hist("q2", false, "2026-10-08")], show: "all" }).groups[0].items[0].formative).toBeNull();
  });
  it("an empty notebook is empty", () => {
    expect(buildMistakeNotebook({ wrong: [], history: [], questions, titles, topics })).toMatchObject({ groups: [], toFix: 0, total: 0 });
  });
});
