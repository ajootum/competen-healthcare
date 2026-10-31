import { describe, expect, it } from "vitest";
import {
  aiMarkingAllowed, libraryContentOfLearnerQuestion, libraryCopyOf, libraryKeyText, markingOf, validateLibraryQuestion, LIBRARY_FORMATS,
} from "./library-format";
import { effectiveKind, keyOf, markResponse, type RevisionQuestion } from "./revision";

const R = "Because the evidence in the guideline says so.";
const rubric = { level: "understanding", keyPoints: ["Calls for help early", "Gives intramuscular adrenaline", "Supports airway and fluids"], acceptedAlternatives: [], misconceptions: [] };
const GOOD: Record<string, Record<string, unknown>> = {
  mcq: { format: "mcq", stem: "Which drug reverses opioid toxicity?", options: ["Naloxone", "Flumazenil", "Atropine", "Glucagon"], correct_index: 0, rubric: { level: "recall" }, rationale: R },
  mrq: { format: "mrq", stem: "Which are signs of sepsis? Choose all.", options: ["Fever", "Tachycardia", "Bradypnoea", "Hypotension"], answerKey: { correct: [3, 0, 1] }, rationale: R },
  short: { format: "short", stem: "Name the antidote for paracetamol overdose.", options: [], answerKey: { accepted: ["Acetylcysteine", "N-acetylcysteine"] }, marking: "self", rationale: R },
  cloze: { format: "cloze", stem: "The antidote for paracetamol overdose is _____.", options: [], answerKey: { accepted: ["acetylcysteine"] }, rationale: R },
  true_false: { format: "true_false", stem: "Naloxone reverses benzodiazepine toxicity.", options: [], answerKey: { truth: false }, rationale: R },
  extended: { format: "extended", stem: "Explain the initial management of anaphylaxis.", options: [], answerKey: { modelAnswer: "Call for help, give intramuscular adrenaline, airway and fluids.", marks: 6 }, rubric, rationale: R },
  flashcard: { format: "flashcard", stem: "What does NEWS2 stand for?", options: [], answerKey: { back: "National Early Warning Score 2" }, rationale: R },
  match: { format: "match", stem: "Match each drug to its class.", options: ["Amoxicillin", "Furosemide", "Metoprolol"], answerKey: { matches: ["Penicillin", "Loop diuretic", "Beta blocker"] }, rationale: R },
  sequence: { format: "sequence", stem: "Put the steps of hand hygiene in order.", options: ["Rinse", "Wet hands", "Apply soap"], answerKey: { order: [1, 2, 0] }, rationale: R },
  structured: { format: "structured", stem: "A patient presents with chest pain. Answer the parts.", options: [], answerKey: { parts: [{ prompt: "What test first?", marks: 1, accepted: ["ECG"] }, { prompt: "Which enzyme?", marks: 2, accepted: ["Troponin"], rubric: { level: "recall" } }] }, rationale: R },
};
const asQuestion = (c: unknown, id = "q1"): RevisionQuestion => { const x = libraryCopyOf(c)!; return { id, kind: x.kind, stem: x.stem, options: x.options, correctIndex: x.correctIndex, answer: x.answer, rationale: x.rationale, difficulty: null }; };

describe("validateLibraryQuestion: every format, its key, its rubric and its marking rule", () => {
  it("accepts a sound question of each of the ten formats, and its learner copy is a question Scholar can key and mark", () => {
    for (const f of LIBRARY_FORMATS) {
      const v = validateLibraryQuestion(GOOD[f]);
      expect(v, f).toMatchObject({ ok: true, format: f });
      if (!v.ok) continue;
      const q = asQuestion(v.content);
      expect(keyOf(q), f).not.toBeNull();
      expect(effectiveKind(q), f).toBe(f);
      expect(libraryKeyText(v.content), f).not.toBe("");
    }
  });

  it("keeps the 442 question exactly: no format key in, none out, the content unchanged", () => {
    const legacy = { stem: "Which drug reverses opioid toxicity?", options: ["Naloxone", "Flumazenil", "Atropine", "Glucagon"], correct_index: 0, rationale: R, source: { kind: "own_writing" } };
    const v = validateLibraryQuestion(legacy);
    expect(v).toEqual({ ok: true, format: "mcq", content: legacy });
    expect(libraryCopyOf(legacy)).toMatchObject({ kind: "mcq", correctIndex: 0, answer: null });
    expect(validateLibraryQuestion({ ...legacy, options: ["a", "b", "c"] }).ok).toBe(false);
    expect(validateLibraryQuestion({ ...legacy, correct_index: 4 }).ok).toBe(false);
  });

  it("refuses each format's planted defect with a plain reason", () => {
    const bad: [string, Record<string, unknown>][] = [
      ["mcq repeated option", { ...GOOD.mcq, options: ["A", "A", "B", "C"] }],
      ["mrq all correct", { ...GOOD.mrq, answerKey: { correct: [0, 1, 2, 3] } }],
      ["mrq none correct", { ...GOOD.mrq, answerKey: { correct: [] } }],
      ["short no answer", { ...GOOD.short, answerKey: { accepted: [] } }],
      ["short AI marking", { ...GOOD.short, marking: "rubric_ai_formative" }],
      ["cloze no blank", { ...GOOD.cloze, stem: "The antidote for paracetamol overdose is acetylcysteine." }],
      ["true_false no truth", { ...GOOD.true_false, answerKey: {} }],
      ["extended two key points", { ...GOOD.extended, rubric: { ...rubric, keyPoints: ["a", "b"] } }],
      ["extended no model answer", { ...GOOD.extended, answerKey: { marks: 3 } }],
      ["flashcard AI marking", { ...GOOD.flashcard, marking: "rubric_ai_formative" }],
      ["match unequal", { ...GOOD.match, answerKey: { matches: ["Penicillin", "Loop diuretic"] } }],
      ["sequence repeat", { ...GOOD.sequence, answerKey: { order: [0, 0, 1] } }],
      ["structured one part", { ...GOOD.structured, answerKey: { parts: [{ prompt: "What test first?", marks: 1, accepted: ["ECG"] }] } }],
      ["structured marks 6", { ...GOOD.structured, answerKey: { parts: [{ prompt: "What test first?", marks: 6, accepted: ["ECG"] }, { prompt: "Which enzyme?", marks: 1, accepted: ["T"] }] } }],
      ["rubric bad level", { ...GOOD.mrq, rubric: { level: "expert" } }],
      ["unknown format", { ...GOOD.short, format: "essay" }],
      ["short stem", { ...GOOD.mcq, stem: "Why?" }],
      ["no explanation", { ...GOOD.mcq, rationale: "" }],
    ];
    for (const [label, c] of bad) { const v = validateLibraryQuestion(c); expect(v.ok, label).toBe(false); if (!v.ok) expect(v.error.length, label).toBeGreaterThan(10); }
  });

  it("normalises: trims, sorts an mrq key, defaults the marking rule, and drops unknown keys", () => {
    const v = validateLibraryQuestion({ ...GOOD.mrq, stem: "  Which are signs of sepsis? Choose all.  ", extra: "dropped" });
    expect(v.ok && v.content).toMatchObject({ stem: "Which are signs of sepsis? Choose all.", answerKey: { correct: [0, 1, 3] }, marking: "deterministic" });
    expect(v.ok && "extra" in v.content).toBe(false);
  });
});

describe("the learner copy and its marking rule", () => {
  it("is answerKey + rubric + marking for every kind but mcq, whose answer is its rubric only", () => {
    const m = validateLibraryQuestion(GOOD.mcq), e = validateLibraryQuestion(GOOD.extended);
    expect(m.ok && libraryCopyOf(m.content)?.answer).toEqual({ rubric: expect.objectContaining({ level: "recall" }) });
    expect(e.ok && libraryCopyOf(e.content)?.answer).toMatchObject({ format: "extended", modelAnswer: expect.any(String), marks: 6, marking: "rubric_ai_formative", rubric: expect.objectContaining({ keyPoints: rubric.keyPoints }) });
  });

  it("marks deterministic formats by code, and lets AI judge a library copy only where its version says rubric_ai_formative", () => {
    const tf = validateLibraryQuestion(GOOD.true_false);
    const q = asQuestion(tf.ok ? tf.content : null);
    expect(markResponse(q, { kind: "text", text: "false" })).toMatchObject({ correct: true, marking: "deterministic" });
    const ext = validateLibraryQuestion(GOOD.extended), self = validateLibraryQuestion({ ...GOOD.extended, marking: "self" }), short = validateLibraryQuestion(GOOD.short);
    const copy = (v: ReturnType<typeof validateLibraryQuestion>) => ({ library: { versionId: "v" }, answer: v.ok ? libraryCopyOf(v.content)!.answer : null });
    expect(aiMarkingAllowed(copy(ext))).toBe(true);
    expect(aiMarkingAllowed(copy(self))).toBe(false);
    expect(aiMarkingAllowed(copy(short))).toBe(false);
    expect(markingOf(copy(self).answer)).toBe("self");
    // A question Scholar wrote itself is untouched: the policy decides, as before.
    expect(aiMarkingAllowed({ library: null, answer: { accepted: ["x"] } })).toBe(true);
  });
});

describe("a learner's own question as library content (what an offer carries)", () => {
  it("round-trips every format from the stored learner row", () => {
    for (const f of LIBRARY_FORMATS) {
      const v = validateLibraryQuestion(GOOD[f]);
      if (!v.ok) throw new Error(f);
      const q = asQuestion(v.content);
      const back = libraryContentOfLearnerQuestion(q);
      expect(back, f).toMatchObject({ ok: true, format: f });
      if (back.ok) expect(libraryCopyOf(back.content)?.kind, f).toBe(q.kind);
    }
  });
  it("refuses a case step, and drops a rubric that is not one rather than guessing", () => {
    expect(libraryContentOfLearnerQuestion({ kind: "case", stem: "Which drug reverses opioid toxicity?", options: ["a", "b", "c", "d"], correctIndex: 0, answer: null, rationale: R }).ok).toBe(false);
    const r = libraryContentOfLearnerQuestion({ kind: "mcq", stem: "Which drug reverses opioid toxicity?", options: ["Naloxone", "Flumazenil", "Atropine", "Glucagon"], correctIndex: 0, answer: { rubric: { level: "nonsense" } }, rationale: R });
    expect(r.ok && "rubric" in r.content).toBe(false);
  });
});
