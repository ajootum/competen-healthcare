import { describe, expect, it } from "vitest";
import { choiceLeaks, containsAnswer, writtenLeaks } from "./answer-leak";
import { qualityProblems } from "./question-quality";
import { checkQuestions, type DraftQuestion, type Passage } from "./generation";
import { answerLeaks, checkRevisionDraft } from "./revision";

// SQIE-CLOSE-2026-11 WS-H: the question does not give its own answer away (quality requirement 4), and a generated single-best-answer
// or case item is screened for patient identifiers as every revision format already is.

const SEPSIS = "Sepsis is life-threatening organ dysfunction caused by a dysregulated host response to infection. "
  + "The Sepsis Six should be delivered within one hour. Give oxygen, take blood cultures and give intravenous antibiotics. "
  + "Give intravenous fluids, measure lactate and monitor urine output.";
const sepsis: Passage = { chunkId: "c", materialId: "m", materialTitle: "Sepsis notes", ordinal: 2, pageFrom: 2, pageTo: 2, content: SEPSIS };
const good: DraftQuestion = {
  stem: "A patient with suspected sepsis is being treated. Which action is part of the Sepsis Six?",
  options: ["Measure lactate", "Monitor organ dysfunction", "Take urine cultures", "Monitor host response"],
  correctIndex: 0,
  rationale: "The notes list measuring lactate as part of the Sepsis Six.",
  sourceQuote: "Give intravenous fluids, measure lactate and monitor urine output.",
};

const NOTE = [
  "1. Pyelonephritis (kidney infection): This infection spreads from the bladder to one or both kidneys.",
  "2. Symptoms include fever, loin pain and dysuria.",
  "3. Escherichia coli is the commonest cause.",
  "4. Treatment is with antibiotics and fluids.",
].join("\n");
const renal: Passage = { chunkId: "c1", materialId: "m1", materialTitle: "Renal notes", ordinal: 1, pageFrom: 1, pageTo: 1, content: NOTE };
const SHORT = {
  stem: "Which organism is the commonest cause of pyelonephritis?", accepted: ["Escherichia coli"], rationale: "The notes say Escherichia coli is the commonest cause.",
  sourceQuote: "Escherichia coli is the commonest cause.", difficulty: 1, level: "recall", objective: "Recall the commonest cause of pyelonephritis.",
  keyPoints: ["Escherichia coli is the commonest cause"], misconceptions: ["The infection starts in the kidneys"], references: [],
};
const MRQ = {
  stem: "Which of these are symptoms of pyelonephritis? Choose all that apply.", options: ["fever", "loin pain", "dysuria", "antibiotics"], correct: [0, 1, 2],
  rationale: "Symptoms include fever, loin pain and dysuria.", sourceQuote: "Symptoms include fever, loin pain and dysuria.", difficulty: 2, level: "understanding",
  objective: "Recognise the symptoms.", keyPoints: ["fever", "loin pain", "dysuria"], misconceptions: [], references: [],
};

describe("the one leak rule (moved from scenario.ts unchanged)", () => {
  it("two or more content words, in order, normalised; a single word never; no synonyms", () => {
    expect(containsAnswer("Give OXYGEN, as prescribed!", "give oxygen as prescribed")).toBe(true);
    expect(containsAnswer("The patient has sepsis", "sepsis")).toBe(false);
    expect(containsAnswer("Prescribed oxygen is given", "give oxygen as prescribed")).toBe(false);
    expect(containsAnswer("measure the lactate", "measure lactate")).toBe(true); // "the" is not a content word
  });
  it("a choice leaks only when every keyed option, and no other, is in the stem", () => {
    const opts = ["Measure lactate", "Give oxygen now", "Take urine cultures", "Monitor host response"];
    expect(choiceLeaks("After you measure lactate, which action follows?", opts, [0])).toBe(true);
    expect(choiceLeaks("Should you measure lactate or take urine cultures first?", opts, [0])).toBe(false); // a wrong option is named too
    expect(choiceLeaks("Which actions follow? Measure lactate.", opts, [0, 1])).toBe(false); // only part of the key
    expect(choiceLeaks("Which action is part of the Sepsis Six?", opts, [])).toBe(false);
  });
  it("a written answer leaks when an accepted answer is in the text shown with it", () => {
    expect(writtenLeaks("Escherichia coli is common. What causes most pyelonephritis?", ["Escherichia coli", "E. coli"])).toBe(true);
    expect(writtenLeaks("Which organism causes most pyelonephritis?", ["Escherichia coli"])).toBe(false);
  });
});

describe("single best answer and case items (question-quality.ts, checkQuestions)", () => {
  it("passes the sound fixture and refuses a stem that states its key", () => {
    expect(qualityProblems(good, SEPSIS)).toEqual([]);
    const leaked = { ...good, stem: "The nurse will measure lactate for this patient with sepsis. Which action is part of the Sepsis Six?" };
    expect(qualityProblems(leaked, SEPSIS).map(p => p.reason)).toContain("answer_in_stem");
  });
  it("checkQuestions drops a leaking item with its reason and keeps the rest", () => {
    const leaked = { ...good, stem: "The nurse will measure lactate for this patient with sepsis. Which action is part of the Sepsis Six?" };
    const r = checkQuestions(JSON.stringify([good, leaked]), sepsis);
    expect(r.kept).toHaveLength(1);
    expect(r.dropped.map(d => d.reason)).toEqual(["answer_in_stem"]);
  });
  it("checkQuestions refuses a generated item that carries a patient identifier, before anything else is judged", () => {
    const named = { ...good, stem: "A patient (NHS no 943 476 5919) has suspected sepsis. Which action is part of the Sepsis Six?" };
    const dob = { ...good, rationale: "DOB: 12/03/1961. The notes list measuring lactate as part of the Sepsis Six." };
    const r = checkQuestions(JSON.stringify([named, dob]), sepsis);
    expect(r.kept).toEqual([]);
    expect(r.dropped.map(d => d.reason)).toEqual(["identifier", "identifier"]);
  });
});

describe("revision formats (checkRevisionDraft)", () => {
  it("the sound fixtures still pass", () => {
    expect(checkRevisionDraft("short", SHORT, renal).ok).toBe(true);
    expect(checkRevisionDraft("mrq", MRQ, renal).ok).toBe(true);
  });
  it("a short answer whose stem states the accepted answer is refused answer_leaked", () => {
    const leaked = { ...SHORT, stem: "Escherichia coli is mentioned in the notes. Which organism is the commonest cause of pyelonephritis?" };
    expect(checkRevisionDraft("short", leaked, renal)).toEqual({ ok: false, reason: "answer_leaked" });
  });
  it("a multiple-response stem that names every keyed option and no other is refused; naming a wrong one too is not", () => {
    const opts = ["loin pain", "high fever", "painful dysuria", "oral antibiotics"];
    const base = { stem: "x", options: opts, answer: { correct: [0, 1] } };
    expect(answerLeaks("mrq", { ...base, stem: "With loin pain and high fever, which are symptoms? Choose all that apply." })).toBe(true);
    expect(answerLeaks("mrq", { ...base, stem: "Loin pain, high fever or oral antibiotics: which are symptoms? Choose all that apply." })).toBe(false);
  });
  it("a structured item leaks when its lead-in or any part prompt states a part's accepted answer", () => {
    const parts = [{ prompt: "Name the commonest cause.", marks: 1, accepted: ["Escherichia coli"] }, { prompt: "Name the treatment.", marks: 1, accepted: ["antibiotics and fluids"] }];
    expect(answerLeaks("structured", { stem: "A case of pyelonephritis.", options: [], answer: { parts } })).toBe(false);
    expect(answerLeaks("structured", { stem: "A case of pyelonephritis treated with antibiotics and fluids.", options: [], answer: { parts } })).toBe(true);
    expect(answerLeaks("structured", { stem: "A case.", options: [], answer: { parts: [parts[0], { ...parts[1], prompt: "Escherichia coli was cultured: name the treatment." }] } })).toBe(true);
  });
  it("formats the rule does not cover are never refused by it", () => {
    expect(answerLeaks("flashcard", { stem: "Escherichia coli", options: [], answer: { back: "Escherichia coli" } })).toBe(false);
  });
});
