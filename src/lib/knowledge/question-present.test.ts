/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { presentQuestion, presentSource } from "./question-present";
import { questionContentFromFields } from "./question-format";
import { validateLibraryQuestion } from "@/lib/individual/scholar/library-format";

// SQIE-LIBRARY-GAPS-01. Every format a reviewer meets is read as a question (key marked in words), a legacy single best
// answer question and unreadable content fall back to null (the page's old view), and absent fields are left out.

const R = "Fever, tachycardia and hypotension are all signs of sepsis in this setting.";
const rubric = { level: "understanding", objective: "Recognise sepsis", keyPoints: ["Fever", "Tachycardia", "Hypotension"], misconceptions: ["Sepsis always has a fever"] };
const source = { kind: "open_licence", reference: "A guideline", licence: "CC BY 4.0" };
const heads = (c: unknown) => presentQuestion(c)!.blocks.map(b => b.heading);
const block = (c: unknown, h: string) => presentQuestion(c)!.blocks.find(b => b.heading === h) as any;
const valid = (c: Record<string, unknown>) => { const v = validateLibraryQuestion(c); expect(v.ok, JSON.stringify(v)).toBe(true); return c; };

describe("presentQuestion", () => {
  it("legacy single best answer content and unreadable content are not presented (the old view stays)", () => {
    expect(presentQuestion({ stem: "A stem long enough", options: ["a", "b", "c", "d"], correct_index: 1, rationale: R })).toBeNull();
    for (const bad of [null, undefined, "x", [], { format: "mcq" }, { format: "poem", stem: "A stem long enough" }, { format: "mrq", stem: "" }]) expect(presentQuestion(bad)).toBeNull();
  });

  it("mcq with a format key marks the one correct option in words", () => {
    const c = valid({ format: "mcq", stem: "Which sign is earliest in sepsis?", options: ["Fever", "Coma", "Bradycardia", "Pallor"], correct_index: 0, rubric, marking: "deterministic", rationale: R, source });
    const p = presentQuestion(c)!;
    expect(p).toMatchObject({ format: "mcq", formatLabel: "Single best answer", marking: "deterministic" });
    expect(p.markingLabel).toMatch(/Marked by code/);
    expect(block(c, "Options").items.map((o: any) => o.key)).toEqual([true, false, false, false]);
    expect(heads(c)).toEqual(["Question", "Options", "Explanation shown after answering", "Rubric level", "Rubric objective", "Rubric key points", "Common misconceptions"]);
    expect(p.source).toEqual({ label: "Open licence", declared: true, lines: ["Reference: A guideline", "Licence: CC BY 4.0"] });
  });

  it("mrq marks every correct option", () => {
    const c = valid({ format: "mrq", stem: "Which are signs of sepsis? Choose all.", options: ["Fever", "Tachycardia", "Bradypnoea", "Hypotension"], answerKey: { correct: [0, 1, 3] }, marking: "deterministic", rationale: R });
    expect(block(c, "Options (choose all that apply)").items.map((o: any) => o.key)).toEqual([true, true, false, true]);
  });

  it("short, cloze and flashcard show accepted answers / blank fills / the back", () => {
    const short = valid({ format: "short", stem: "Name the first-line antibiotic class for sepsis?", options: [], answerKey: { accepted: ["Broad spectrum", "Broad-spectrum antibiotics"] }, marking: "deterministic", rationale: R });
    expect(block(short, "Accepted answers").items).toEqual(["Broad spectrum", "Broad-spectrum antibiotics"]);
    const cloze = valid({ format: "cloze", stem: "Sepsis is a life-threatening _____ to infection.", options: [], answerKey: { format: "cloze", accepted: ["response"] }, marking: "deterministic", rationale: R });
    expect(block(cloze, "Sentence with the blank").text).toMatch(/_____/);
    expect(block(cloze, "Fills the blank").items).toEqual(["response"]);
    const card = valid({ format: "flashcard", stem: "Define sepsis", options: [], answerKey: { back: "A dysregulated response to infection." }, marking: "self", rationale: R });
    expect(block(card, "Back of the card").text).toBe("A dysregulated response to infection.");
  });

  it("true_false says whether the statement is true or false", () => {
    for (const [t, w] of [["true", "True"], ["false", "False"]] as const) {
      const c = valid({ format: "true_false", stem: "Sepsis can occur without a fever at all.", options: [], answerKey: { format: "true_false", accepted: [t], statement: "Sepsis can occur without a fever at all.", explanation: R }, marking: "deterministic", rationale: R });
      expect(block(c, "The statement is").text).toBe(w);
    }
  });

  it("extended shows the model answer, marks and the rubric key points", () => {
    const c = valid({ format: "extended", stem: "Explain how you would recognise early sepsis.", options: [], answerKey: { format: "extended", accepted: ["x".repeat(30)], modelAnswer: "A model answer that is long enough to be valid.", marks: 3 }, rubric, marking: "rubric_ai_formative", rationale: R });
    expect(block(c, "Model answer").text).toMatch(/model answer/);
    expect(block(c, "Practice marks").text).toBe("3");
    expect(block(c, "Rubric key points").items).toEqual(rubric.keyPoints);
    expect(presentQuestion(c)!.markingLabel).toMatch(/Formative AI/);
  });

  it("match shows each prompt with its match", () => {
    const c = valid({ format: "match", stem: "Match each sign with its meaning.", options: ["Fever", "Tachycardia", "Hypotension"], answerKey: { matches: ["Infection", "Compensation", "Shock"] }, marking: "deterministic", rationale: R });
    expect(block(c, "Pairs (prompt and its match)").items).toEqual([{ prompt: "Fever", match: "Infection" }, { prompt: "Tachycardia", match: "Compensation" }, { prompt: "Hypotension", match: "Shock" }]);
  });

  it("sequence shows the shuffled steps and the correct order", () => {
    const c = valid({ format: "sequence", stem: "Put the sepsis six steps in order.", options: ["Give fluids", "Recognise", "Take cultures"], answerKey: { order: [1, 2, 0] }, marking: "deterministic", rationale: R });
    expect(block(c, "Steps as learners first see them (shuffled)").items).toEqual(["Give fluids", "Recognise", "Take cultures"]);
    expect(block(c, "Correct order")).toMatchObject({ ordered: true, items: ["Recognise", "Take cultures", "Give fluids"] });
  });

  it("structured shows each part with marks, accepted answers and its own rubric", () => {
    const c = valid({ format: "structured", stem: "A patient presents with fever and low blood pressure.", options: [], marking: "self", rationale: R,
      answerKey: { parts: [{ prompt: "Name the likely diagnosis?", marks: 1, accepted: ["Sepsis"] }, { prompt: "State two immediate actions?", marks: 2, accepted: ["Fluids", "Antibiotics"], rubric: { level: "application", keyPoints: ["Fluids"], acceptedAlternatives: [], misconceptions: [] } }] } });
    const parts = block(c, "Parts").items;
    expect(parts.map((p: any) => [p.label, p.marks, p.accepted])).toEqual([["Part a", 1, ["Sepsis"]], ["Part b", 2, ["Fluids", "Antibiotics"]]]);
    expect(parts[1].rubric.map((b: any) => b.heading)).toEqual(["Rubric level", "Rubric key points"]);
  });

  it("builds from the educator's form fields too, and leaves out what is not there (no blank, no zero)", () => {
    const c = questionContentFromFields({ format: "short", stem: "Name the first-line antibiotic class for sepsis?", accepted: "Broad spectrum", rationale: R });
    const p = presentQuestion(c)!;
    expect(p.marking).toBeNull(); expect(p.markingLabel).toBeNull();
    expect(p.blocks.map(b => b.heading)).not.toContain("Rubric level");
    expect(p.source).toEqual({ label: "Not declared", lines: [], declared: false });
  });
});

describe("presentSource", () => {
  it("says what is declared, and says 'Not declared' when nothing is", () => {
    expect(presentSource({ source: { kind: "permission", reference: "Ref", permissionNote: "Written 1 Oct" } })).toEqual({ label: "Permission of the rights holder", declared: true, lines: ["Reference: Ref", "Permission: Written 1 Oct"] });
    expect(presentSource({ source: { kind: "own_writing" } })).toEqual({ label: "Own writing", declared: true, lines: [] });
    expect(presentSource({})).toEqual({ label: "Not declared", lines: [], declared: false });
  });
});
