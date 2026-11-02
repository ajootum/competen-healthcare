/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { markedAgainstLine } from "./marked-against";
import { feedbackView, keptAttemptView } from "./revision-view";
import { rubricSnapshotOf, withRubricSnapshot } from "./rubric-snapshot";
import { QUESTION_FORMATS } from "./question-formats";
import type { QuestionRow } from "./store";

// SCHOLAR-CE-2026 CE-05: the "marked against" line is on every format's feedback, and says only what the attempt really kept.

const base = (over: Partial<QuestionRow> & Record<string, unknown>): QuestionRow => ({
  id: "q1", materialId: "m1", chunkId: "c1", kind: "short", stem: "Stem?", options: [], correctIndex: null, rationale: "Because.", sourceQuote: "q", model: "m", promptVersion: "v", createdAt: "2026-10-01T00:00:00Z",
  answer: null, difficulty: 2, materialTitle: "M", ordinal: 1, pageFrom: 1, pageTo: 1, unit: "page", latest: null, competencyId: null, caseId: null, caseStep: null, caseTitle: null, ...over,
}) as QuestionRow;
const rubric = { objective: "Check.", level: "understanding", expectedAnswer: "x", keyPoints: ["Point one", "Point two", "Point three"], acceptedAlternatives: [], misconceptions: [], source: "notes", referenceIds: [] };

/** One stored question for each format a learner can see, in the shape the store gives it. */
const FIXTURES: Record<string, QuestionRow> = {
  mcq: base({ kind: "mcq", options: ["a", "b", "c", "d"], correctIndex: 1 }),
  case: base({ kind: "case", options: ["a", "b", "c", "d"], correctIndex: 2 }),
  mrq: base({ kind: "mrq", options: ["a", "b", "c", "d"], answer: { correct: [0, 2] } }),
  short: base({ kind: "short", answer: { accepted: ["the risk"], rubric } }),
  flashcard: base({ kind: "flashcard", answer: { back: "The back" } }),
  match: base({ kind: "match", options: ["p1", "p2", "p3"], answer: { matches: ["m1", "m2", "m3"] } }),
  sequence: base({ kind: "sequence", options: ["s1", "s2", "s3"], answer: { order: [1, 0, 2] } }),
  structured: base({ kind: "structured", answer: { parts: [{ prompt: "(a)?", marks: 1, accepted: ["x"] }, { prompt: "(b)?", marks: 2, accepted: ["y"] }] } }),
  cloze: base({ kind: "short", answer: { format: "cloze", accepted: ["term"] } }),
  true_false: base({ kind: "short", answer: { format: "true_false", accepted: ["true"], statement: "S", explanation: "E" } }),
  extended: base({ kind: "short", answer: { format: "extended", accepted: ["model"], modelAnswer: "model", marks: 3, partialCredit: { rule: "per_key_point", marksPerPoint: 1 }, rubric } }),
  scenario: base({
    kind: "short", answer: {
      format: "scenario", accepted: ["k1", "k2"], stages: [
        { reveal: "", prompt: "One?", kind: "mcq", options: ["a", "b", "c", "d"], correct: [0], weight: 1, keyPoint: "k1" },
        { reveal: "More.", prompt: "Two?", kind: "short", accepted: ["two"], weight: 3, keyPoint: "k2" },
      ],
    },
  }),
};

describe("the line says what the format was marked against", () => {
  it("one sentence per format and per marking, from the registry's formats", () => {
    expect(markedAgainstLine({ format: "mcq", marking: "deterministic" })).toBe("Marked by its answer key.");
    expect(markedAgainstLine({ format: "mrq", marking: "deterministic" })).toBe("Marked by its answer key.");
    expect(markedAgainstLine({ format: "true_false", marking: "deterministic" })).toBe("Marked by its answer key.");
    expect(markedAgainstLine({ format: "cloze", marking: "deterministic" })).toBe("Marked by its answer key.");
    expect(markedAgainstLine({ format: "flashcard", marking: "self_graded" })).toMatch(/^Your own self-check/);
    expect(markedAgainstLine({ format: "short", marking: "deterministic" })).toBe("Marked by code against the accepted answers.");
    expect(markedAgainstLine({ format: "short", marking: "self_graded" })).toBe("Marked by you against the accepted answers.");
    expect(markedAgainstLine({ format: "short", marking: "ai_evaluation", keyPoints: 3 })).toBe("Judged by AI against your notes, the accepted answers and 3 key points.");
    expect(markedAgainstLine({ format: "extended", marking: "ai_evaluation", keyPoints: 4 })).toBe("Marked by AI against 4 key points from your notes.");
    expect(markedAgainstLine({ format: "extended", marking: "self_graded", keyPoints: 1 })).toBe("Marked by you against 1 key point and the model answer.");
    expect(markedAgainstLine({ format: "structured", marking: "deterministic", parts: 3 })).toBe("Marked part by part (3 parts) against each part's accepted answers, by code.");
    expect(markedAgainstLine({ format: "scenario", marking: "self_graded", weights: [1, 3] })).toBe("Marked stage by stage (2 stages, weighted 1 / 3) against each stage's key, by code where it matched, otherwise by you.");
    expect(markedAgainstLine({ format: "mcq", marking: "deterministic", libraryVersion: 4 })).toBe("Marked by code against the Competen library answer, version 4.");
    expect(markedAgainstLine({ format: "short", marking: "ai_evaluation", libraryVersion: 2 })).toBe("Judged by AI against the Competen library answer and its rubric, version 2.");
  });
  it("names the saved guide only when the attempt kept one", () => {
    expect(markedAgainstLine({ format: "mrq", marking: "deterministic", guide: "0123456789abcdef" })).toBe("Marked by its answer key (the guide as saved when you answered, 01234567).");
    expect(markedAgainstLine({ format: "mrq", marking: "deterministic", guide: null })).not.toMatch(/guide/);
  });
  it("never invents a count: with none kept it says 'its key points' / 'each part' / 'each stage'", () => {
    expect(markedAgainstLine({ format: "extended", marking: "ai_evaluation" })).toBe("Marked by AI against its key points from your notes.");
    expect(markedAgainstLine({ format: "structured", marking: "ai_evaluation" })).toContain("(each part)");
    expect(markedAgainstLine({ format: "scenario", marking: "deterministic" })).toContain("(each stage)");
    expect(markedAgainstLine({ format: "short", marking: "ai_evaluation" })).toBe("Judged by AI against your notes, the accepted answers.");
  });
});

describe("every format's feedback view carries the line", () => {
  const marking: Record<string, "deterministic" | "self_graded" | "ai_evaluation"> = { flashcard: "self_graded" };
  it("every format in the registry that a learner answers has a fixture and a non-empty line", () => {
    const answered = QUESTION_FORMATS.map(r => r.key as string);
    for (const k of answered) expect(FIXTURES[k], `a fixture for ${k}`).toBeTruthy();
    for (const k of answered) {
      const f = feedbackView(FIXTURES[k], { correct: true, score: 1, marking: marking[k] ?? "deterministic", justMarked: true });
      expect(f.markedAgainst, k).toMatch(/\.$/);
      expect(f.markedAgainst.length, k).toBeGreaterThan(20);
    }
  });
  it("what an AI-marked short or extended answer says follows its marking", () => {
    expect(feedbackView(FIXTURES.short, { correct: true, score: 1, marking: "ai_evaluation" }).markedAgainst).toMatch(/^Judged by AI/);
    expect(feedbackView(FIXTURES.extended, { correct: false, score: 0.5, marking: "ai_evaluation" }).markedAgainst).toMatch(/^Marked by AI against/);
    expect(feedbackView(FIXTURES.extended, { correct: false, score: 0.5, marking: "self_graded" }).markedAgainst).toMatch(/^Marked by you against/);
  });
  it("shown later it reads the attempt's own snapshot: its guide and its key points, not the question's current ones", () => {
    const q = FIXTURES.extended;
    const kept = withRubricSnapshot({ kind: "text", text: "my answer" }, rubricSnapshotOf(q))!;
    const view = keptAttemptView(q, { response: kept, marking: "ai_evaluation" });
    const line = feedbackView(q, { correct: false, score: 0.5, marking: "ai_evaluation", ...view }).markedAgainst;
    expect(line).toMatch(/^Marked by AI against 3 key points from your notes \(the guide as saved when you answered, [0-9a-f]{8}\)\.$/);
    // the question's key points are edited afterwards: the line still says what it was marked against
    const edited = base({ ...q, answer: { ...(q.answer as any), rubric: { ...rubric, keyPoints: ["only one now"] } } });
    expect(feedbackView(edited, { correct: false, score: 0.5, marking: "ai_evaluation", ...keptAttemptView(edited, { response: kept, marking: "ai_evaluation" }) }).markedAgainst).toContain("3 key points");
  });
  it("an attempt that kept no snapshot gets the plain statement, with no guide named", () => {
    const f = feedbackView(FIXTURES.mrq, { correct: true, score: 1, marking: "deterministic" });
    expect(f.markedAgainst).toBe("Marked by its answer key.");
  });
  it("a governed library question names the library version", () => {
    const lib = base({ ...FIXTURES.mcq, library: { resourceId: "r", versionId: "v", versionNo: 3, resourceTitle: "R", approvedAt: "2026-01-01" } as any });
    expect(feedbackView(lib, { correct: true, score: 1, marking: "deterministic" }).markedAgainst).toBe("Marked by code against the Competen library answer, version 3.");
  });
});
