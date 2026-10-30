import { describe, expect, it } from "vitest";
import { sm2 } from "@/lib/delivery/reinforcement";
import {
  SRS_DEFAULTS, answerText, buildRevisionInsights, checkRevisionDraft, keyOf, learnerItem, markResponse, parseResponse, pickQuestions, planGeneration,
  scheduleReview, seededOrder, storedResponse, type PoolItem, type RevisionQuestion,
} from "./revision";
import type { Passage } from "./generation";

// COMPETEN-SCHOLAR-REVISION-01 (Stage 4): the pure rules. The routes, the store and the model are exercised over
// HTTP on staging (scripts/scholar-revision01-harness.ts).

const passage: Passage = {
  chunkId: "c1", materialId: "m1", materialTitle: "Respiratory notes", ordinal: 1, pageFrom: 1, pageTo: 1,
  content: "The trachea divides into the right and left main bronchi. The bronchi divide into bronchioles. Bronchioles end in alveoli, where gas exchange happens. Oxygen is prescribed to a target saturation range.",
};
const Q = (over: Partial<RevisionQuestion>): RevisionQuestion => ({ id: "q1", kind: "mcq", stem: "?", options: [], correctIndex: null, answer: null, rationale: "r", difficulty: null, ...over });

describe("R2: each kind's key, and what a browser may see", () => {
  const mrq = Q({ kind: "mrq", options: ["trachea", "bronchi", "alveoli", "saturation"], answer: { correct: [1, 0] } });
  const match = Q({ id: "m", kind: "match", options: ["trachea", "bronchioles", "alveoli"], answer: { matches: ["divides into main bronchi", "end in alveoli", "gas exchange"] } });
  const seq = Q({ id: "s", kind: "sequence", options: ["alveoli", "trachea", "bronchi"], answer: { order: [1, 2, 0] } });

  it("reads a sound key and refuses an unsound one", () => {
    expect(keyOf(mrq)).toEqual({ kind: "set", indexes: [0, 1] });
    expect(keyOf(Q({ kind: "mcq", options: ["a", "b", "c", "d"], correctIndex: 4 }))).toBeNull();
    expect(keyOf(Q({ kind: "sequence", options: ["a", "b", "c"], answer: { order: [0, 0, 1] } }))).toBeNull();
    expect(answerText(seq)).toBe("trachea → bronchi → alveoli");
    expect(answerText(match)).toContain("alveoli → gas exchange");
  });

  it("the learner view carries no key, rationale or quote, and a match's choices are shuffled the same way each time", () => {
    const v = learnerItem(match);
    expect(JSON.stringify(v)).not.toContain("\"answer\"");
    expect(JSON.stringify(learnerItem(mrq))).not.toMatch(/correct|rationale/);
    expect([...v.choices!].sort()).toEqual([...(match.answer as { matches: string[] }).matches].sort());
    expect(learnerItem(match).choices).toEqual(v.choices);
    expect(seededOrder(4, "x")).toEqual(seededOrder(4, "x"));
    expect(seededOrder(3, "y")).not.toEqual([0, 1, 2]);
  });
});

describe("R2/R4: marked by code where code can, never guessed", () => {
  it("single, multiple, matching and sequencing are marked deterministically, with partial credit", () => {
    const mcq = Q({ options: ["a", "b", "c", "d"], correctIndex: 2 });
    expect(markResponse(mcq, parseResponse(mcq, { index: 2 })!)).toEqual({ correct: true, score: 1, marking: "deterministic" });
    const mrq = Q({ kind: "mrq", options: ["a", "b", "c", "d"], answer: { correct: [0, 1] } });
    expect(markResponse(mrq, parseResponse(mrq, { indexes: [0, 1] })!)).toMatchObject({ correct: true, score: 1 });
    expect(markResponse(mrq, parseResponse(mrq, { indexes: [0, 3] })!)).toMatchObject({ correct: false, score: 0 });
    expect(markResponse(mrq, parseResponse(mrq, { indexes: [0] })!)).toMatchObject({ correct: false, score: 0.5 });
    const seq = Q({ kind: "sequence", options: ["c", "a", "b"], answer: { order: [1, 2, 0] } });
    expect(markResponse(seq, parseResponse(seq, { order: [1, 2, 0] })!)).toMatchObject({ correct: true });
    expect(markResponse(seq, parseResponse(seq, { order: [1, 0, 2] })!)).toMatchObject({ correct: false, score: 1 / 3 });
  });

  it("a short answer is correct by code only on a match; otherwise it needs judgement -- never 'wrong' by default", () => {
    const short = Q({ kind: "short", answer: { accepted: ["a target saturation range"] } });
    expect(markResponse(short, parseResponse(short, { text: "A target saturation range." })!)).toEqual({ correct: true, score: 1, marking: "deterministic" });
    expect(markResponse(short, parseResponse(short, { text: "within the prescribed range" })!)).toEqual({ needsJudgement: true });
  });

  it("a flashcard is the student's own recall grade, labelled self-graded", () => {
    const f = Q({ kind: "flashcard", answer: { back: "gas exchange" } });
    expect(markResponse(f, parseResponse(f, { quality: 4 })!)).toEqual({ correct: true, score: 0.8, marking: "self_graded" });
    expect(parseResponse(f, { quality: 9 })).toBeNull();
  });

  it("an answer is stored in one form only (416): a single choice as chosen_index, the rest as response", () => {
    expect(storedResponse({ kind: "choice", index: 1 })).toEqual({ chosenIndex: 1, response: null });
    expect(storedResponse({ kind: "set", indexes: [0, 2] })).toEqual({ chosenIndex: null, response: { kind: "set", indexes: [0, 2] } });
  });
});

describe("R2: new items are checked like practice questions", () => {
  const quote = "Bronchioles end in alveoli, where gas exchange happens.";
  it("a sound item of each kind is kept; a sequence is stored shuffled with its order as the key", () => {
    expect(checkRevisionDraft("short", { stem: "Where does gas exchange happen?", accepted: ["alveoli", "in the alveoli"], rationale: "Bronchioles end in alveoli, where gas exchange happens.", sourceQuote: quote, difficulty: 1 }, passage).ok).toBe(true);
    expect(checkRevisionDraft("flashcard", { front: "Alveoli", back: "Where gas exchange happens", sourceQuote: quote }, passage).ok).toBe(true);
    const s = checkRevisionDraft("sequence", { stem: "Put the airways in order?", steps: ["trachea", "main bronchi", "bronchioles", "alveoli"], rationale: "The trachea divides into the right and left main bronchi.", sourceQuote: "The bronchi divide into bronchioles.", difficulty: 2 }, passage);
    expect(s.ok).toBe(true);
    if (s.ok) {
      const q = Q({ kind: "sequence", options: s.draft.options, answer: s.draft.answer });
      expect(answerText(q)).toBe("trachea → main bronchi → bronchioles → alveoli");
      expect(s.draft.options).not.toEqual(["trachea", "main bronchi", "bronchioles", "alveoli"]);
    }
  });

  it("drops an item whose quote is not in the passage, that adds a figure, or that identifies a patient", () => {
    expect(checkRevisionDraft("short", { stem: "Where?", accepted: ["alveoli"], rationale: "r", sourceQuote: "Not in the notes at all.", difficulty: 1 }, passage)).toEqual({ ok: false, reason: "quote_not_in_passage" });
    expect(checkRevisionDraft("short", { stem: "What saturation range is targeted?", accepted: ["94 to 98 percent"], rationale: "The target is 94 to 98 percent.", sourceQuote: "Oxygen is prescribed to a target saturation range.", difficulty: 1 }, passage)).toMatchObject({ ok: false, reason: "ungrounded" });
    expect(checkRevisionDraft("flashcard", { front: "Mr John Smith, NHS number 943 476 5919", back: "alveoli", sourceQuote: quote }, passage)).toMatchObject({ ok: false });
    expect(checkRevisionDraft("mrq", { stem: "Choose all?", options: ["a", "a", "b", "c"], correct: [0], rationale: "r", sourceQuote: quote }, passage)).toEqual({ ok: false, reason: "duplicate" });
  });
});

describe("R1/R3: which questions a session offers", () => {
  const P = (id: string, over: Partial<PoolItem> = {}): PoolItem => ({ id, kind: "mcq", difficulty: 2, chunkId: "c1", createdAt: `2026-10-0${id.length}`, latestCorrect: null, misses: 0, lastAnsweredAt: null, due: false, ...over });
  const pool = [P("new1"), P("seen", { lastAnsweredAt: "2026-10-01", latestCorrect: true }), P("due", { due: true, lastAnsweredAt: "2026-10-02" }), P("weak", { misses: 3, latestCorrect: false, lastAnsweredAt: "2026-10-03" }), P("fc", { kind: "flashcard" })];
  it("today: due, then what was hard, then new, then the rest; it may write new ones for a shortfall", () => {
    const r = pickQuestions({ mode: "today", pool, quantity: 10, formats: ["mcq", "flashcard"], difficulty: "any", seed: "s" });
    expect(r.ids).toEqual(["due", "weak", "fc", "new1", "seen"]); // new ones oldest first: fc was made before new1
    expect(r.shortfall).toBe(5);
  });
  it("spaced: due only; weak: missed, most first; neither writes new questions", () => {
    expect(pickQuestions({ mode: "spaced", pool, quantity: 10, formats: ["mcq"], difficulty: "any", seed: "s" })).toEqual({ ids: ["due"], shortfall: 0 });
    expect(pickQuestions({ mode: "weak", pool, quantity: 10, formats: ["mcq"], difficulty: "any", seed: "s" }).ids).toEqual(["weak"]);
  });
  it("flashcards are flashcards only; a difficulty is preferred, then filled", () => {
    expect(pickQuestions({ mode: "flashcards", pool, quantity: 5, formats: ["mcq"], difficulty: "any", seed: "s" }).ids).toEqual(["fc"]);
    const mixed = [P("e", { difficulty: 1 }), P("h", { difficulty: 3 })];
    expect(pickQuestions({ mode: "quick", pool: mixed, quantity: 2, formats: ["mcq"], difficulty: "harder", seed: "s" }).ids).toEqual(["h", "e"]);
  });
  it("new questions: never a section and format that already has them, and at most REVISION_GENERATION_CALLS_MAX calls", () => {
    const plan = planGeneration({ shortfall: 10, chunkIds: ["a", "b"], formats: ["mcq", "short"], existing: new Set(["a|mcq"]) });
    expect(plan.map(p => `${p.chunkId}|${p.kind}`)).not.toContain("a|mcq");
    expect(plan.reduce((n, p) => n + p.count, 0)).toBe(9);
    expect(planGeneration({ shortfall: 100, chunkIds: ["a", "b", "c", "d"], formats: ["mcq", "short"], existing: new Set() }).length).toBe(8);
  });
  it("SQIE D-6: a small shortfall is shared, so every asked format is written (not the first format only)", () => {
    // Staging 30 Oct: short answer + multiple choice from one note. The first format took the whole shortfall.
    for (const formats of [["short", "mcq"], ["mcq", "short"]] as const) {
      const plan = planGeneration({ shortfall: 3, chunkIds: ["note"], formats, existing: new Set() });
      expect(plan.map(p => p.kind).sort()).toEqual(["mcq", "short"]);
      expect(plan.reduce((n, p) => n + p.count, 0)).toBe(3);
    }
    expect(planGeneration({ shortfall: 5, chunkIds: ["note"], formats: ["mcq", "short"], existing: new Set() }).map(p => `${p.kind}:${p.count}`)).toEqual(["mcq:3", "short:2"]);
  });
  it("SQIE D-6: today's new questions are interleaved by format, so both asked formats reach the session", () => {
    const made = [P("m1", { createdAt: "2026-10-30T10:00:01" }), P("m2", { createdAt: "2026-10-30T10:00:02" }), P("m3", { createdAt: "2026-10-30T10:00:03" }),
      P("s1", { kind: "short", createdAt: "2026-10-30T10:00:04" }), P("s2", { kind: "short", createdAt: "2026-10-30T10:00:05" }), P("s3", { kind: "short", createdAt: "2026-10-30T10:00:06" })];
    expect(pickQuestions({ mode: "today", pool: made, quantity: 3, formats: ["short", "mcq"], difficulty: "any", seed: "s" }).ids).toEqual(["m1", "s1", "m2"]);
  });
});

describe("R3: the shared SM-2, within the policy's bounds", () => {
  it("with the defaults it is exactly the earlier rule", () => {
    for (const q of [0, 2, 3, 4, 5]) {
      const prev = { ease: 2.5, interval: 6, reps: 2 };
      const s = sm2(prev, q);
      expect(scheduleReview(prev, q, 2, SRS_DEFAULTS)).toMatchObject({ interval: s.interval, reps: s.reps, ease: s.ease, status: s.reps >= 5 && s.interval >= 60 ? "mastered" : "active" });
    }
  });
  it("a harder question comes back sooner, and no interval passes the cap", () => {
    const prev = { ease: 2.5, interval: 40, reps: 4 };
    expect(scheduleReview(prev, 5, 3, { ...SRS_DEFAULTS, harderIntervalPercent: 50 }).interval).toBe(Math.round(sm2(prev, 5).interval / 2));
    expect(scheduleReview(prev, 5, 2, { ...SRS_DEFAULTS, maxIntervalDays: 30 }).interval).toBe(30);
  });
});

describe("R5: revision intelligence, measured or why not, never competence", () => {
  const base = { today: "2026-10-24", windowDays: 30, minAnswers: 3, materials: [{ id: "m1", title: "Respiratory notes" }, { id: "m2", title: "Oxygen therapy" }] };
  const questions = [{ id: "q1", stem: "Where does gas exchange happen?", kind: "short" as const, chunkId: "c1", materialId: "m1", competencyId: "comp" }];
  it("counts what is due and coming, recall and its trend, repeated difficulties, coverage and marking", () => {
    const r = buildRevisionInsights({
      ...base, questions,
      attempts: [
        { questionId: "q1", correct: false, answeredAt: "2026-10-20T10:00:00Z", marking: "ai_evaluation", sessionId: "s1" },
        { questionId: "q1", correct: false, answeredAt: "2026-10-21T10:00:00Z", marking: "self_graded", sessionId: "s1" },
        { questionId: "q1", correct: true, answeredAt: "2026-10-22T10:00:00Z", marking: "deterministic", sessionId: null },
      ],
      reviews: [{ quality: 4, reviewedAt: "2026-10-23T09:00:00Z", materialId: "m1" }, { quality: 1, reviewedAt: "2026-10-22T09:00:00Z", materialId: "m1" }, { quality: 5, reviewedAt: "2026-10-21T09:00:00Z", materialId: "m1" }],
      cards: [{ nextReviewAt: "2026-10-24", status: "active" }, { nextReviewAt: "2026-10-28", status: "active" }, { nextReviewAt: "2027-01-01", status: "mastered" }],
    });
    expect(r).toMatchObject({ due: 1, upcoming7: 1, recall: { state: "measured", reviews: 3, recalledShare: 67 }, coverage: { revised: 1, of: 2 } });
    expect(r.repeatedDifficulties).toEqual([{ questionId: "q1", stem: "Where does gas exchange happen?", misses: 2, chunkId: "c1", materialId: "m1" }]);
    expect(r.marking).toEqual({ deterministic: 0, self_graded: 1, ai_evaluation: 1 });
    expect(r.competencyActivity).toEqual([{ competencyId: "comp", answered: 3 }]);
    expect(r.recommendations.map(x => x.id)).toEqual(["due", "difficult", "weak", "untouched"]);
    expect(r.recommendations[1].action).toEqual({ learnSection: "c1" });
  });
  it("says why a measure is not shown, never a blank or a zero", () => {
    const r = buildRevisionInsights({ ...base, questions: [], attempts: [], reviews: null, cards: [] });
    expect(r.recall).toEqual({ state: "not_measured", reason: expect.stringMatching(/not installed/) });
    const few = buildRevisionInsights({ ...base, questions: [], attempts: [], reviews: [{ quality: 4, reviewedAt: "2026-10-23T09:00:00Z", materialId: "m1" }], cards: [] });
    expect(few.recall).toMatchObject({ state: "insufficient", have: 1, need: 3 });
  });
});
