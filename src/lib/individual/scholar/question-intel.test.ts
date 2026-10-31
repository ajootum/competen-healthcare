import { describe, expect, it } from "vitest";
import {
  NO_CONTEXT, adaptDifficulty, difficultyFits, distractorProblem, feedbackPartsFrom, feedbackText, flashcardFrontAsks, generationContextBlock, keyConsistent,
  levelDefaultDifficulty, parseFeedbackSections, parseRubric, rubricOf, stemKey, type GenerationContext,
} from "./question-intel";
import { applyRevisionVerification } from "./question-quality";
import { checkRevisionDraft } from "./revision";
import { checkQuestions, parseEvaluation, revisionPromptVersion, runQuestions, runRevisionQuestions, type Passage } from "./generation";
import { checkAnswer, type Evidence } from "./exam-answer";
import { isNotesNotPaper, linesFromChunks, parsePaper } from "./exam-paper";
import { PROMPT_VERSIONS } from "./config";
import { feedbackView, revisionItemView } from "./revision-view";
import type { QuestionRow } from "./store";

// ── THE FIXTURE: a short pyelonephritis note, as a student uploads it (the reported end-to-end case) ──
const NOTE = [
  "1. Pyelonephritis (kidney infection): This infection spreads from the bladder to one or both kidneys.",
  "2. Symptoms include fever, loin pain and dysuria.",
  "3. Escherichia coli is the commonest cause.",
  "4. Treatment is with antibiotics and fluids.",
].join("\n");
const passage: Passage = { chunkId: "c1", materialId: "m1", materialTitle: "Renal notes", ordinal: 1, pageFrom: 1, pageTo: 1, content: NOTE };

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
const STATEMENT_CARD = { front: "Pyelonephritis (kidney infection): This infection spreads from the bladder to one or both kidneys.", back: "kidney infection", sourceQuote: "Treatment is with antibiotics and fluids.", difficulty: 1 };

/** A fake metered runner: replies in order, and counts the calls. No model is called. */
function fakeRun(replies: string[]) {
  const parts: string[] = [];
  const run = async (_g: unknown, part?: string) => {
    parts.push(part ?? "main");
    const text = replies.shift() ?? "[]";
    return { ok: true as const, text, model: "fake-model", provider: "fake" } as never;
  };
  return { run, parts };
}

describe("the pyelonephritis note end to end: not a paper, and practice questions from it", () => {
  it("is read as notes, not as an exam paper (the parser fix)", () => {
    const p = parsePaper(linesFromChunks([{ id: "c1", pageFrom: 1, content: NOTE }]));
    expect(p.questions).toEqual([]);
    expect(isNotesNotPaper(p)).toBe(true);
  });

  it("generates short-answer items with a rubric, blind-verified, in two model calls", async () => {
    const { run, parts } = fakeRun([JSON.stringify([SHORT]), JSON.stringify([{ q: 1, supported: [], answerable: true, stemAddsFacts: false, ambiguous: false }])]);
    const r = await runRevisionQuestions("u1", "short", passage, 3, run, { context: { ...NO_CONTEXT, concepts: ["pyelonephritis"], difficulty: "easy" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kept).toHaveLength(1);
    expect(r.calls).toBe(2);
    expect(parts).toEqual(["main", "verify"]);
    expect(r.promptVersion).toBe(`${PROMPT_VERSIONS.revision}:short+${PROMPT_VERSIONS.verifyRevision}`);
    const rubric = rubricOf(r.kept[0].answer);
    expect(rubric).toMatchObject({ level: "recall", source: "notes", acceptedAlternatives: ["Escherichia coli"], expectedAnswer: "Escherichia coli" });
    expect(rubric!.keyPoints).toEqual(["Escherichia coli is the commonest cause"]);
  });

  it("refuses a statement as a flashcard front, then retries once (the worst case is four calls with verify, two without)", async () => {
    const { run, parts } = fakeRun([JSON.stringify([STATEMENT_CARD]), JSON.stringify([STATEMENT_CARD])]);
    const r = await runRevisionQuestions("u1", "flashcard", passage, 3, run);
    expect(r.ok && r.kept).toEqual([]);
    expect(r.ok && r.dropped).toEqual(["not_a_question", "not_a_question"]);
    expect(parts).toEqual(["main", "retry"]);
  });

  it("drops what the blind check rejects, and an mrq whose keyed set the passage does not support exactly", async () => {
    const { run } = fakeRun([JSON.stringify([MRQ]), JSON.stringify([{ q: 1, supported: ["A", "B"], answerable: true, stemAddsFacts: false, ambiguous: false }]), "[]"]);
    const r = await runRevisionQuestions("u1", "mrq", passage, 3, run);
    expect(r.ok && r.kept).toEqual([]);
    expect(r.ok && r.dropped).toContain("failed_verification");
    expect(r.ok && r.calls).toBe(3); // main, verify, retry (nothing survived the retry's checks, so no retry-verify)
  });

  it("counts multiple-choice calls the same way: main + verify when the first attempt survives", async () => {
    const mcq = { stem: "Which organism is the commonest cause of pyelonephritis?", options: ["Escherichia coli", "fluids", "antibiotics", "the bladder"], correctIndex: 0, rationale: "Escherichia coli is the commonest cause.", sourceQuote: "Escherichia coli is the commonest cause.", level: "recall" };
    const { run, parts } = fakeRun([JSON.stringify([mcq]), JSON.stringify([{ q: 1, supported: ["A"], answerable: true, stemAddsFacts: false, ambiguous: false }])]);
    const r = await runQuestions("u1", "mcq", passage, 3, run, { context: NO_CONTEXT });
    expect(r.ok && r.check.kept).toHaveLength(1);
    expect(r.ok && r.calls).toBe(2);
    expect(parts).toEqual(["main", "verify"]);
    expect(r.ok && r.check.kept[0]).toMatchObject({ difficulty: 1, rubric: { level: "recall", expectedAnswer: "Escherichia coli" } });
  });
});

describe("checkRevisionDraft: the SQIE checks", () => {
  it("passes a sound item and stores its rubric with the key", () => {
    const c = checkRevisionDraft("short", SHORT, passage);
    expect(c.ok).toBe(true);
    if (c.ok) expect((c.draft.answer as { accepted: string[] }).accepted).toEqual(["Escherichia coli"]);
  });
  it("refuses a repeat, an off-difficulty item, a stem that asks nothing, an inconsistent key and give-away options", () => {
    expect(checkRevisionDraft("short", SHORT, passage, { existing: new Set([stemKey(SHORT.stem)]) })).toEqual({ ok: false, reason: "repeat" });
    expect(checkRevisionDraft("short", SHORT, passage, { difficulty: "harder" })).toEqual({ ok: false, reason: "off_difficulty" });
    expect(checkRevisionDraft("short", { ...SHORT, stem: "Escherichia coli is the commonest cause." }, passage)).toEqual({ ok: false, reason: "not_a_question" });
    expect(checkRevisionDraft("short", { ...SHORT, accepted: ["fluids"] }, passage)).toEqual({ ok: false, reason: "inconsistent" });
    expect(checkRevisionDraft("mrq", { ...MRQ, options: ["fever", "loin pain", "dysuria", "all of the above"] }, passage)).toEqual({ ok: false, reason: "weak_distractors" });
  });
  it("drops a rubric entry the passage does not ground, never the question", () => {
    const c = checkRevisionDraft("short", { ...SHORT, keyPoints: ["Escherichia coli is the commonest cause", "Give 500 mg twice daily"] }, passage);
    expect(c.ok && rubricOf(c.draft.answer)?.keyPoints).toEqual(["Escherichia coli is the commonest cause"]);
  });
});

describe("question-intel: the pure rules", () => {
  it("a flashcard front is a question or a short term, never a statement", () => {
    expect(flashcardFrontAsks(STATEMENT_CARD.front)).toBe(false);
    expect(flashcardFrontAsks("Pyelonephritis")).toBe(true);
    expect(flashcardFrontAsks("What causes pyelonephritis?")).toBe(true);
  });
  it("distractors, consistency and difficulty", () => {
    expect(distractorProblem(["fever", "fever ", "dysuria", "fluids"])).toBe("duplicate option");
    expect(distractorProblem(["none of the above", "fever", "dysuria", "fluids"])).toBe("catch-all option");
    expect(distractorProblem(["fever", "loin pain", "dysuria", "fluids"])).toBeNull();
    expect(keyConsistent("Escherichia coli", "The commonest cause is Escherichia coli.", "")).toBe(true);
    expect(keyConsistent("Staphylococcus", "The commonest cause is Escherichia coli.", "")).toBe(false);
    expect(difficultyFits(1, "harder")).toBe(false);
    expect(difficultyFits(3, "harder")).toBe(true);
    expect(difficultyFits(1, null)).toBe(true);
  });
  it("the guidance block carries concepts, competency, level, difficulty, count -- words only -- and references only in mode 2", () => {
    const ctx: GenerationContext = { concepts: ["pyelonephritis", "urinary tract infection"], competency: { title: "UTI-01 Infection care", outcome: "Recognise sepsis risk" }, level: "Diploma in Nursing, Year two", difficulty: "harder", mode: "notes", references: [{ tag: "L1", id: "x", title: "Infection care", outcome: null }] };
    const b = generationContextBlock(ctx, 2);
    expect(b).toMatch(/CONCEPTS this passage covers: pyelonephritis; urinary tract infection/);
    expect(b).toMatch(/COMPETENCY .*Infection care -- Recognise sepsis risk/);
    // The student's own record reaches the prompt as words only (the difficulty line names the JSON field's values).
    expect(b.split("\n").filter(l => !l.startsWith("DIFFICULTY")).join("\n")).not.toMatch(/\d/);
    expect(b).toMatch(/DIFFICULTY: harder/);
    expect(b).toMatch(/Write up to two items/);
    expect(b).toMatch(/answerable from the passage ALONE/);
    expect(b).not.toMatch(/APPROVED REFERENCES/);
    expect(generationContextBlock({ ...ctx, mode: "notes_and_references" })).toMatch(/\[L1\] Infection care/);
    expect(generationContextBlock(NO_CONTEXT)).toBe("");
  });
  it("a rubric records only references it was given (never an invented one)", () => {
    const r = parseRubric({ level: "application", references: ["L1", "L9"] }, [NOTE], { expectedAnswer: "x", difficulty: 3, references: [{ tag: "L1", id: "comp-1", title: "t", outcome: null }] });
    expect(r).toMatchObject({ level: "application", source: "references", referenceIds: ["comp-1"] });
    expect(parseRubric({}, [NOTE], { expectedAnswer: null, difficulty: 2 })).toMatchObject({ level: "understanding", source: "notes", referenceIds: [] });
  });
  it("progressive difficulty and the programme level's default", () => {
    expect(adaptDifficulty("standard", [true, true, true])).toBe("harder");
    expect(adaptDifficulty("standard", [false, true, false])).toBe("easy");
    expect(adaptDifficulty("harder", [true, true, true])).toBe("harder");
    expect(adaptDifficulty("standard", [true, true])).toBe("standard");
    expect(levelDefaultDifficulty("Certificate in Enrolled Nursing", null)).toBe("easy");
    expect(levelDefaultDifficulty("Diploma in Nursing", "Year 2")).toBe("standard");
    expect(levelDefaultDifficulty("Bachelor's in Nursing Science", null)).toBe("standard");
    expect(levelDefaultDifficulty("Master's in Public Health", null)).toBe("harder");
    expect(levelDefaultDifficulty("Doctoral programme", null)).toBe("harder");
    expect(levelDefaultDifficulty("Nursing", null)).toBeNull();
  });
});

describe("five-part feedback", () => {
  const g = [NOTE, "Escherichia coli", "E coli causes it"];
  it("parses the labelled lines, joins them for text-only surfaces, and keeps the v1 free text as fallback", () => {
    const e = parseEvaluation("VERDICT: partly\nRIGHT: names Escherichia coli\nMISSING: that it spreads from the bladder\nMISCONCEPTIONS: none\nWHY: The notes say Escherichia coli is the commonest cause.\nNEXT: how the infection spreads from the bladder", g);
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.parts).toEqual({ right: ["names Escherichia coli"], missing: ["that it spreads from the bladder"], misconceptions: [], why: "The notes say Escherichia coli is the commonest cause.", next: "how the infection spreads from the bladder" });
    expect(e.feedback).toMatch(/^What you got right: names Escherichia coli\.\nMissing concepts:/);
    const v1 = parseEvaluation("VERDICT: correct\nYou named Escherichia coli, as the notes do.", g);
    expect(v1).toEqual({ ok: true, verdict: "correct", score: 1, feedback: "You named Escherichia coli, as the notes do." });
    expect(parseFeedbackSections("no labels here")).toBeNull();
  });
  it("refuses feedback that invents a figure, and says NOT_IN_NOTES when it cannot judge", () => {
    expect(parseEvaluation("VERDICT: partly\nRIGHT: names it\nWHY: Give 500 mg.", g)).toEqual({ ok: false, reason: "ungrounded" });
    expect(parseEvaluation("NOT_IN_NOTES", g)).toEqual({ ok: false, reason: "not_in_notes" });
  });
  it("a paper attempt gets the five parts only when they pass their own check, and never a mark", () => {
    const evidence: Evidence[] = [{ tag: "N1", kind: "notes", title: "Renal notes", citation: "page 1", text: NOTE }];
    const base = { option: null, examAnswer: "Escherichia coli [N1].", explanation: "", optionNotes: [], currentGuidance: null, guidanceStatus: "no_current_source", conflicts: [], unsupported: [], uncertainty: [] };
    const good = checkAnswer(JSON.stringify({ ...base, attemptFeedback: { right: ["named the organism"], missing: [], misconceptions: [], why: "The notes name Escherichia coli.", next: "symptoms" } }), evidence, "What causes it?", [], "E coli");
    expect(good.ok && good.content.attemptFeedback).toMatchObject({ right: ["named the organism"] });
    const marked = checkAnswer(JSON.stringify({ ...base, attemptFeedback: { right: ["one point"], why: "Worth 2 marks.", next: null } }), evidence, "What causes it?", [], "E coli");
    expect(marked.ok && marked.content.attemptFeedback).toBeNull();
    expect(feedbackPartsFrom({})).toBeNull();
    expect(feedbackText({ right: [], missing: ["x"], misconceptions: [], why: null, next: null })).toBe("Missing concepts: x.");
  });
});

describe("the browser never sees a rubric before answering", () => {
  const row = (answer: unknown): QuestionRow => ({
    id: "q1", materialId: "m1", chunkId: "c1", kind: "short", stem: SHORT.stem, options: [], correctIndex: null, rationale: SHORT.rationale, sourceQuote: SHORT.sourceQuote,
    model: "m", promptVersion: "p", createdAt: "2026-10-30", answer, difficulty: 1, materialTitle: "Renal notes", ordinal: 1, pageFrom: 1, pageTo: 1, unit: "page",
    latest: null, competencyId: null, caseId: null, caseStep: null, caseTitle: null,
  });
  it("shows only the grounding label before, and the rubric after", () => {
    const c = checkRevisionDraft("short", SHORT, passage);
    if (!c.ok) throw new Error("fixture");
    const v = revisionItemView(row(c.draft.answer));
    expect(JSON.stringify(v)).not.toMatch(/keyPoints|misconception|Escherichia coli is the commonest/);
    expect(v.grounding).toBe("From your notes");
    const f = feedbackView(row(c.draft.answer), { correct: false, score: 0, marking: "deterministic" });
    expect(f.rubric).toMatchObject({ level: "Recall", keyPoints: ["Escherichia coli is the commonest cause"] });
    expect(f.nextDifficulty).toBe("easy");
    // SCHOLAR-FLASHCARDS-QA-01: flashcards carry the level mix version.
    expect(revisionPromptVersion("flashcard")).toBe(`${PROMPT_VERSIONS.revision}:flashcard+${PROMPT_VERSIONS.flashcardMix}`);
  });
  it("applyRevisionVerification fails closed", () => {
    expect(applyRevisionVerification([{ stem: "s", options: [], keyed: null }], "garbage")).toEqual({ kept: [], rejected: [{ index: 0, detail: "no verdict" }] });
  });
  it("checkQuestions refuses an mcq repeat", () => {
    const mcq = { stem: "Which organism is the commonest cause of pyelonephritis?", options: ["Escherichia coli", "fluids", "antibiotics", "the bladder"], correctIndex: 0, rationale: "Escherichia coli is the commonest cause.", sourceQuote: "Escherichia coli is the commonest cause." };
    expect(checkQuestions(JSON.stringify([mcq]), passage, 3, 3, { existing: new Set([stemKey(mcq.stem)]) }).dropped).toEqual([{ reason: "repeat" }]);
  });
});
