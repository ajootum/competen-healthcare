import { describe, expect, it } from "vitest";
import { applyVerification, qualityProblems, unsupportedTerms, verificationPrompt } from "./question-quality";
import { checkQuestions, type DraftQuestion, type Passage } from "./generation";

// Owner review P0.1: stems, correct answers, distractors, terminology, ambiguity and source support.

const SEPSIS = "Sepsis is life-threatening organ dysfunction caused by a dysregulated host response to infection. "
  + "The Sepsis Six should be delivered within one hour. Give oxygen, take blood cultures and give intravenous antibiotics. "
  + "Give intravenous fluids, measure lactate and monitor urine output.";
const passage: Passage = { chunkId: "c", materialId: "m", materialTitle: "Sepsis notes", ordinal: 2, pageFrom: 2, pageTo: 2, content: SEPSIS };

const good: DraftQuestion = {
  stem: "A patient with suspected sepsis is being treated. Which action is part of the Sepsis Six?",
  options: ["Measure lactate", "Monitor organ dysfunction", "Take urine cultures", "Monitor host response"],
  correctIndex: 0,
  rationale: "The notes list measuring lactate as part of the Sepsis Six.",
  sourceQuote: "Give intravenous fluids, measure lactate and monitor urine output.",
};

describe("deterministic quality checks", () => {
  it("passes a question whose every option is built from the passage and whose answer is in the quote", () => {
    expect(qualityProblems(good, SEPSIS)).toEqual([]);
  });

  it("⚠ refuses a distractor that names something the notes never mention (the staging limitation, closed)", () => {
    const p = qualityProblems({ ...good, options: ["Measure lactate", "Arrange an urgent CT scan", "Take blood cultures later", "Give oxygen"] }, SEPSIS);
    expect(p.map(x => x.reason)).toContain("unsupported_term");
    expect(p.find(x => x.reason === "unsupported_term")?.detail).toMatch(/arrange|urgent|scan/);
  });

  it("refuses a keyed answer the quoted source sentence does not support", () => {
    const p = qualityProblems({ ...good, correctIndex: 3 }, SEPSIS);
    expect(p.map(x => x.reason)).toContain("correct_not_supported");
  });

  it("refuses catch-all options and options that contain one another", () => {
    expect(qualityProblems({ ...good, options: ["Measure lactate", "All of the above", "Give oxygen", "Take blood cultures"] }, SEPSIS)
      .map(x => x.reason)).toContain("banned_option");
    expect(qualityProblems({ ...good, options: ["Measure lactate", "Measure lactate and give oxygen", "Give fluids", "Take blood cultures"] }, SEPSIS)
      .map(x => x.reason)).toContain("options_overlap");
  });

  it("refuses a stem that is not a question, or hides a lower-case negative", () => {
    expect(qualityProblems({ ...good, stem: "Sepsis Six actions" }, SEPSIS).map(x => x.reason)).toContain("not_a_question");
    expect(qualityProblems({ ...good, stem: "Which action is not part of the Sepsis Six?" }, SEPSIS).map(x => x.reason)).toContain("unmarked_negative");
    expect(qualityProblems({ ...good, stem: "Which action is NOT part of the Sepsis Six?" }, SEPSIS).map(x => x.reason)).not.toContain("unmarked_negative");
  });

  it("matches terms by stem, so inflections of the passage's own words are allowed", () => {
    expect(unsupportedTerms("Measuring lactates", SEPSIS)).toEqual([]);
    expect(unsupportedTerms("Arrange a CT scan", SEPSIS)).toEqual(["arrange", "scan"]);
  });

  it("checkQuestions applies the quality layer after the grounding check, with the reason recorded", () => {
    const r = checkQuestions(JSON.stringify([good, { ...good, options: ["Measure lactate", "Arrange an urgent CT scan", "Give oxygen", "Take blood cultures"] }]), passage);
    expect(r.kept).toHaveLength(1);
    expect(r.dropped[0].reason).toBe("unsupported_term");
  });
});

describe("the blind verification", () => {
  it("shows the reader the questions WITHOUT the key", () => {
    const p = verificationPrompt(SEPSIS, [good]);
    expect(p).toContain("A. Measure lactate");
    expect(p).not.toMatch(/correct|rationale|sourceQuote|lactate as part/i);
  });

  it("keeps a question only when exactly the keyed option is supported and nothing is flagged", () => {
    const ok = applyVerification([good], '[{"q":1,"supported":["A"],"answerable":true,"stemAddsFacts":false,"ambiguous":false}]');
    expect(ok.kept).toHaveLength(1);
    const two = applyVerification([good], '[{"q":1,"supported":["A","C"],"answerable":true,"stemAddsFacts":false,"ambiguous":false}]');
    expect(two.kept).toHaveLength(0);
    expect(two.rejected[0].detail).toMatch(/supported AC, keyed A/);
    const wrongKey = applyVerification([good], '[{"q":1,"supported":["B"],"answerable":true,"stemAddsFacts":false,"ambiguous":false}]');
    expect(wrongKey.kept).toHaveLength(0);
    const facts = applyVerification([good], '[{"q":1,"supported":["A"],"answerable":true,"stemAddsFacts":true,"ambiguous":false}]');
    expect(facts.rejected[0].detail).toMatch(/outside facts/);
  });

  it("⚠ fails closed: an unreadable or missing verdict rejects the question", () => {
    expect(applyVerification([good], "I think they are fine").kept).toHaveLength(0);
    expect(applyVerification([good, good], '[{"q":1,"supported":["A"],"answerable":true,"stemAddsFacts":false,"ambiguous":false}]').kept).toHaveLength(1);
  });
});
