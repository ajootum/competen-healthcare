// SQIE-CLOSE-2026-11 WS-I: one question's history across practice, Revise, adaptive and mock exams, CYU and exam papers.
import { describe, expect, it } from "vitest";
import { buildAttemptSnapshot, contentHashOf, type AttemptIntegrity } from "./attempt-snapshot";
import { buildQuestionHistory, CHANGED_NOTE, NO_SNAPSHOT_NOTE, sourceOf, versionLabel } from "./question-history";
import type { HistoryAttemptRow, HistorySessionRow, QuestionRow } from "./store";

const Q = {
  id: "11111111-1111-4111-8111-111111111111", materialId: "m", chunkId: "c", kind: "short", stem: "Why is lactate measured in sepsis?", options: [], correctIndex: null,
  rationale: "Lactate shows tissue perfusion.", sourceQuote: "measure lactate", model: "m", promptVersion: "p", createdAt: "2026-11-01T00:00:00Z",
  answer: { accepted: ["Lactate shows tissue perfusion."], rubric: { keyPoints: ["tissue perfusion"] } }, difficulty: 2, materialTitle: "Notes", ordinal: 1,
  pageFrom: null, pageTo: null, unit: "page", latest: null, competencyId: null, caseId: null, caseStep: null, caseTitle: null,
} as unknown as QuestionRow;
const att = (id: string, over: Partial<HistoryAttemptRow>): HistoryAttemptRow => ({
  id, questionId: Q.id, answeredAt: "2026-11-02T10:00:00Z", correct: false, score: 0, chosenIndex: null, marking: "deterministic", response: { kind: "text", text: "perfusion" },
  evaluatorModel: null, evaluatorPromptVersion: null, contentVersion: 1, revisionSessionId: null, ...over,
});
const A = { check: "a0000000-0000-4000-8000-000000000001", revise: "a0000000-0000-4000-8000-000000000002", adaptive: "a0000000-0000-4000-8000-000000000003", mock: "a0000000-0000-4000-8000-000000000004", practice: "a0000000-0000-4000-8000-000000000005" };
const S = { revise: "s0000000-0000-4000-8000-000000000001", adaptive: "s0000000-0000-4000-8000-000000000002", mock: "s0000000-0000-4000-8000-000000000003" };
const sessions = new Map<string, HistorySessionRow>([
  [S.revise, { id: S.revise, mode: "quick", adaptive: false }], [S.adaptive, { id: S.adaptive, mode: "mock", adaptive: true }], [S.mock, { id: S.mock, mode: "mock", adaptive: false }],
]);
const checks = new Map([[A.check, { attemptId: A.check, sessionId: "learn-session", step: 2 }]]);

describe("WS-I: one question's history", () => {
  it("tells every source apart: check, revise, adaptive, mock, practice", () => {
    expect(sourceOf(att(A.check, { response: { kind: "check", text: "x", question: "q" } }), sessions, new Map())).toBe("check");
    expect(sourceOf(att(A.check, {}), sessions, checks)).toBe("check");
    expect(sourceOf(att(A.revise, { revisionSessionId: S.revise }), sessions, checks)).toBe("revise");
    expect(sourceOf(att(A.adaptive, { revisionSessionId: S.adaptive }), sessions, checks)).toBe("adaptive");
    expect(sourceOf(att(A.mock, { revisionSessionId: S.mock }), sessions, checks)).toBe("mock");
    expect(sourceOf(att(A.practice, {}), sessions, checks)).toBe("practice");
  });

  it("mixed sources, newest first, each with what it was marked against; an old answer after an edit says so", () => {
    // The revise answer was marked against an EARLIER wording of the question (its snapshot), the live question has changed since.
    const before = { ...Q, stem: "Why do we measure lactate?" } as QuestionRow;
    const snap = buildAttemptSnapshot(before, { attemptId: A.revise, answeredAt: "2026-11-02T09:00:00Z", chosenIndex: null, response: { kind: "text", text: "perfusion" }, correct: true, score: 1, marking: "deterministic", contentVersion: 1 })!;
    const integrity = new Map<string, AttemptIntegrity>([
      [A.revise, { snapshot: snap, corrections: [] }],
      // The adaptive answer was corrected: the effective result is shown with the original beside it.
      [A.adaptive, { snapshot: null, corrections: [{ id: "c1", attemptId: A.adaptive, previousScore: 0, previousOutcome: "incorrect", correctedScore: 1, correctedOutcome: "correct", reason: "The key was wrong here.", basis: "key_error", correctedByKind: "system_rule", createdAt: "2026-11-03T00:00:00Z" }] }],
    ]);
    const h = buildQuestionHistory(Q, {
      attempts: [
        att(A.check, { answeredAt: "2026-11-04T10:00:00Z", marking: "unmarked", score: null, response: { kind: "check", text: "It shows perfusion", question: Q.stem }, contentVersion: 2 }),
        att(A.revise, { answeredAt: "2026-11-02T09:00:00Z", revisionSessionId: S.revise, correct: true, score: 1 }),
        att(A.adaptive, { answeredAt: "2026-11-03T09:00:00Z", revisionSessionId: S.adaptive }),
      ],
      sessions, checks, integrity,
      examAnswers: [{ id: "e1", materialId: "paper", examQuestionId: "eq", examStem: "Explain lactate in sepsis.", attempt: { text: "perfusion" }, model: "opus", promptVersion: "v2", createdAt: "2026-11-01T09:00:00Z" }],
    });
    expect(h.entries.map(e => e.source)).toEqual(["check", "adaptive", "revise", "exam_paper"]);
    expect(h.bySource).toEqual({ check: 1, adaptive: 1, revise: 1, exam_paper: 1 });
    const [check, adaptive, revise] = h.entries as Extract<typeof h.entries[number], { kind: "attempt" }>[];
    expect(check).toMatchObject({ outcome: "unmarked", score: null, answer: "It shows perfusion", step: 2, sessionId: "learn-session" });
    expect(check.markedAgainst).toMatchObject({ snapshotKept: false, questionVersion: "own:2" });
    expect(check.markedAgainst.notes).toContain(NO_SNAPSHOT_NOTE);
    expect(adaptive).toMatchObject({ outcome: "correct", original: { outcome: "incorrect", score: 0 } });
    expect(revise.markedAgainst).toMatchObject({ snapshotKept: true, questionVersion: "own:1", contentHash: snap.contentHash.slice(0, 8), questionChangedSince: true });
    expect(revise.markedAgainst.contentHash).not.toBe(contentHashOf(Q).slice(0, 8));
    expect(revise.markedAgainst.notes).toContain(CHANGED_NOTE);
    expect(h.entries[3]).toMatchObject({ kind: "exam_answer", examQuestion: "Explain lactate in sepsis.", attempt: "perfusion" });
  });

  it("an answer kept against the live question has no change note, and a version is said in words", () => {
    const snap = buildAttemptSnapshot(Q, { attemptId: A.practice, answeredAt: "t", chosenIndex: null, response: { kind: "text", text: "x" }, correct: false, score: 0, marking: "deterministic", contentVersion: 3 })!;
    const h = buildQuestionHistory(Q, { attempts: [att(A.practice, {})], sessions, checks: new Map(), integrity: new Map([[A.practice, { snapshot: snap, corrections: [] }]]) });
    const e = h.entries[0] as Extract<typeof h.entries[number], { kind: "attempt" }>;
    expect(e.markedAgainst.notes).toEqual([]);
    expect(versionLabel(e.markedAgainst.questionVersion)).toBe("your question, version 3");
    expect(versionLabel(null)).toBeNull();
  });
});
