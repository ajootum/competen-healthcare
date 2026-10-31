import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FORMATIVE_KIND, RESPONSE_BUDGET, SUMMARY_MAX, formativeFeedback, formativeOf, formativeText, storedPartResults, withFormative } from "./written-feedback";
import type { FeedbackParts } from "./question-intel";

// SCHOLAR-WRITTEN-FEEDBACK-01: formative AI feedback on a written answer, kept on the attempt's own 416 response.

const EV = { model: "model-a", promptVersion: "evaluate/2" };
const parts: FeedbackParts = { right: ["Names the alveoli"], missing: ["Diffusion across the membrane"], misconceptions: [], why: "Gas exchange happens in the alveoli.", next: "Revise diffusion" };
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

describe("formativeFeedback (what is kept)", () => {
  it("is labelled ai_formative, with the evaluator, and keeps parts or a bounded summary, never both", () => {
    const f = formativeFeedback([{ part: null, feedback: "Alveoli is right.", parts }, { part: 2, feedback: "x".repeat(2000), parts: null }], EV)!;
    expect(f).toMatchObject({ kind: FORMATIVE_KIND, model: "model-a", promptVersion: "evaluate/2" });
    expect(f.items[0]).toEqual({ part: null, parts, summary: null });
    expect(f.items[1].summary!.length).toBe(SUMMARY_MAX);
    expect(JSON.stringify(f)).not.toMatch(/verified|self_graded|competence|verdict|score/);
  });
  it("keeps nothing without an evaluator, without feedback, or where an item carries a patient identifier", () => {
    expect(formativeFeedback([{ part: null, feedback: "Good.", parts: null }], null)).toBeNull();
    expect(formativeFeedback([{ part: null, feedback: "", parts: null }], EV)).toBeNull();
    expect(formativeFeedback([{ part: null, feedback: "As for NHS number 943 476 5919, revise this.", parts: null }], EV)).toBeNull();
  });
});

describe("withFormative (bounded under 416's 8000 bytes)", () => {
  it("adds the feedback beside the answer", () => {
    const f = formativeFeedback([{ part: null, feedback: "Alveoli is right.", parts }], EV);
    expect(withFormative({ kind: "text", text: "the alveoli" }, f)).toEqual({ kind: "text", text: "the alveoli", formative: f });
  });
  it("drops items from the end until it fits, and always keeps the answer", () => {
    const big = { kind: "parts", texts: ["é".repeat(1000), "é".repeat(1000), "é".repeat(1000)], awarded: [1, 1, 1], by: ["ai", "ai", "ai"] };
    const f = formativeFeedback([1, 2, 3].map(p => ({ part: p, feedback: "y".repeat(400), parts: null })), EV)!;
    const out = withFormative(big, f)!;
    expect(bytes(out)).toBeLessThanOrEqual(RESPONSE_BUDGET);
    expect((out.formative as { items: unknown[] }).items.length).toBe(1);
    const huge = { kind: "text", text: "é".repeat(3600) };
    expect(withFormative(huge, f)).toEqual(huge);
    expect(withFormative(null, f)).toBeNull();
  });
});

describe("formativeOf (read back only on an ai_evaluation attempt)", () => {
  const f = formativeFeedback([{ part: null, feedback: "Alveoli is right.", parts }], EV);
  const stored = withFormative({ kind: "text", text: "the alveoli" }, f);
  it("returns the checked feedback for an AI-evaluated answer", () => {
    expect(formativeOf(stored, "ai_evaluation")).toEqual(f);
    expect(formativeText(formativeOf(stored, "ai_evaluation")!.items[0])).toContain("Diffusion across the membrane");
  });
  it("ignores it on a self-graded or code-marked answer, and anything not ai_formative", () => {
    expect(formativeOf(stored, "self_graded")).toBeNull();
    expect(formativeOf(stored, "deterministic")).toBeNull();
    expect(formativeOf({ formative: { ...f, kind: "verified" } }, "ai_evaluation")).toBeNull();
    expect(formativeOf({ kind: "text", text: "x" }, "ai_evaluation")).toBeNull();
  });
});

describe("storedPartResults (a structured answer reviewed later)", () => {
  const f = formativeFeedback([{ part: 2, feedback: "Alveoli is right.", parts: null }], EV);
  const response = withFormative({ kind: "parts", texts: ["", "alveoli", "oxygen"], awarded: [0, 1, 2], by: ["blank", "ai", "code"] }, f);
  it("rebuilds each part's marks, how it was marked, and the AI part's feedback", () => {
    expect(storedPartResults(response, "ai_evaluation", 3)).toEqual([
      { awarded: 0, by: "blank" }, { awarded: 1, by: "ai", feedback: "Alveoli is right.", parts: null }, { awarded: 2, by: "code" },
    ]);
  });
  it("guesses nothing: not AI-evaluated, no `by`, or the wrong part count", () => {
    expect(storedPartResults(response, "self_graded", 3)).toBeNull();
    expect(storedPartResults({ kind: "parts", texts: ["a"], awarded: [1] }, "ai_evaluation", 1)).toBeNull();
    expect(storedPartResults(response, "ai_evaluation", 2)).toBeNull();
  });
});

describe("no leakage into verified or competence outputs (D5)", () => {
  it("the evaluation evidence read never selects the attempt's response", () => {
    const s = readFileSync("src/lib/individual/scholar/store.ts", "utf8");
    const ev = s.slice(s.indexOf("export async function evaluationEvidence"), s.indexOf("export async function evaluationEvidence") + 1200);
    expect(ev).toMatch(/individual_scholar_attempt"\)\.select\("id, question_id, correct, marking, answered_at, revision_session_id, evaluator_model"\)/);
  });
  it("nothing that makes an evaluation, verification or Passport entry reads the kept feedback", () => {
    for (const f of ["evaluation.ts", "evaluation-data.ts", "passport-items.ts", "passport-evaluations.ts"]) {
      let src = "";
      try { src = readFileSync(`src/lib/individual/scholar/${f}`, "utf8"); } catch { continue; }
      expect(src).not.toMatch(/written-feedback|recentWrittenFeedback|formativeOf/);
    }
  });
});

describe("the wiring, as written", () => {
  const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  it("the answer route keeps feedback only on an ai_evaluation attempt, short and structured alike", () => {
    const s = read("src/app/api/individual/scholar/revision/answer/route.ts");
    expect(s.match(/const formative = marking === "ai_evaluation" \? formativeFeedback\(/g)?.length).toBe(2);
    // SCHOLAR-SQIE-LEARNER-01: the rubric snapshot goes on first, so the feedback is what yields when the size is tight.
    expect(s).toContain("response: withFormative(withRubricSnapshot(answered, rubricSnapshotOf(q)), formative)");
    expect(s).toContain("response: withFormative(withRubricSnapshot({ ...stored.response, awarded: final.map(x => x.awarded), by: final.map(x => x.by) }, rubricSnapshotOf(q)), formative)");
  });
  it("the session review shows it again, read back through formativeOf", () => {
    const s = read("src/app/api/individual/scholar/revision/sessions/[id]/route.ts");
    expect(s).toContain("...keptAttemptView(q, a)");
    expect(read("src/lib/individual/scholar/revision-view.ts")).toMatch(/formativeOf\(a\.response, a\.marking\)/);
  });
});
