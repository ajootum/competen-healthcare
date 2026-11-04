// SQIE-CLOSE-2026-11 WS-D (attempt records, migration 990) and WS-H (the stem must not reveal the key; identifiers in generated
// mcq and case text). Pure, plus the store's snapshot write against a fake client (the 990-absent fallback).

import { beforeEach, describe, expect, it } from "vitest";
import { buildAttemptSnapshot, provenanceFor, provenanceFromRow, snapshotFromRow, snapshotInsertRow } from "./attempt-snapshot";
import { checkQuestions, type DraftQuestion, type Passage } from "./generation";
import { echoedInStem, keyInStem, qualityProblems } from "./question-quality";
import { checkRevisionDraft } from "./revision";
import { readProgress, signProgress, tokenKey } from "./scenario";
import { insertAttemptSnapshot, resetContinuitySchema, type QuestionRow } from "./store";
import { checkResponse } from "./learn-check-record";

const SEPSIS = "Sepsis is life-threatening organ dysfunction caused by a dysregulated host response to infection. "
  + "The Sepsis Six should be delivered within one hour. Give oxygen, take blood cultures and give intravenous antibiotics. "
  + "Give intravenous fluids, measure lactate and monitor urine output.";
const sepsis: Passage = { chunkId: "c", materialId: "m", materialTitle: "Sepsis notes", ordinal: 2, pageFrom: 2, pageTo: 2, content: SEPSIS };
const good: DraftQuestion = {
  stem: "A patient with suspected sepsis is being treated. Which action is part of the Sepsis Six?",
  options: ["Measure lactate", "Monitor organ dysfunction", "Take urine cultures", "Monitor host response"],
  correctIndex: 0, rationale: "The notes list measuring lactate as part of the Sepsis Six.", sourceQuote: "Give intravenous fluids, measure lactate and monitor urine output.",
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

describe("WS-H: the stem must not reveal the key", () => {
  it("an answer is echoed only when every content word of it is in the stem", () => {
    expect(echoedInStem("Measure lactate", "Which Sepsis Six action is to measure lactate?")).toBe(true);
    expect(echoedInStem("Measure lactate", "Which Sepsis Six action is about lactate?")).toBe(false);
    expect(echoedInStem("94", "Is the target 94?")).toBe(false); // no content word: never called echoed
  });

  it("choice: refused when the echoed options are all keyed; a distractor on the stem's words is fine", () => {
    expect(keyInStem({ stem: "Which Sepsis Six action is to measure lactate?", options: good.options, keyed: [0] })).toMatch(/keyed option A/);
    expect(keyInStem({ stem: "Should you measure lactate or monitor host response first?", options: good.options, keyed: [0] })).toBeNull();
    expect(keyInStem({ stem: good.stem, options: good.options, keyed: [0] })).toBeNull();
  });

  it("mcq: qualityProblems and checkQuestions refuse the leak before anything is stored or shown", () => {
    const leaky = { ...good, stem: "Which Sepsis Six action is to measure lactate?" };
    expect(qualityProblems(good, SEPSIS)).toEqual([]);
    expect(qualityProblems(leaky, SEPSIS).map(p => p.reason)).toContain("answer_leaked");
    const r = checkQuestions(JSON.stringify([good, leaky]), sepsis);
    expect(r.kept.map(k => k.stem)).toEqual([good.stem]);
    expect(r.dropped[0].reason).toBe("answer_leaked");
  });

  it("short and mrq: checkRevisionDraft refuses a stem that holds the key, and keeps the sound item", () => {
    expect(checkRevisionDraft("short", SHORT, renal).ok).toBe(true);
    expect(checkRevisionDraft("short", { ...SHORT, stem: "Is Escherichia coli the commonest cause of pyelonephritis, and which organism is it?" }, renal)).toEqual({ ok: false, reason: "answer_leaked" });
    expect(checkRevisionDraft("mrq", MRQ, renal).ok).toBe(true);
    expect(checkRevisionDraft("mrq", { ...MRQ, stem: "Which of fever, loin pain and dysuria are symptoms of pyelonephritis? Choose all that apply." }, renal)).toEqual({ ok: false, reason: "answer_leaked" });
  });

  it("identifier: a generated mcq (or case step) naming a patient is dropped", () => {
    const named = { ...good, stem: "Mr John Smith, NHS number 943 476 5919, has suspected sepsis. Which action is part of the Sepsis Six?" };
    const r = checkQuestions(JSON.stringify([named]), sepsis);
    expect(r.kept).toEqual([]);
    expect(r.dropped[0].reason).toBe("identifier");
  });
});

const checkQ = {
  id: "11111111-1111-4111-8111-111111111111", materialId: "m", chunkId: "c", kind: "short", stem: "Why is lactate measured in sepsis?", options: [], correctIndex: null,
  rationale: "Lactate shows tissue perfusion.", sourceQuote: "measure lactate", model: "m", promptVersion: "p", createdAt: "2026-11-04T00:00:00Z",
  answer: { accepted: ["Lactate shows tissue perfusion."], modelAnswer: "Lactate shows tissue perfusion.", rubric: { keyPoints: ["tissue perfusion"] }, check: { source: "lesson" } },
  difficulty: 2, materialTitle: "Notes", ordinal: 1, pageFrom: null, pageTo: null, unit: "page", latest: null,
  competencyId: "22222222-2222-4222-8222-222222222222", caseId: null, caseStep: null, caseTitle: null,
} as unknown as QuestionRow;
const PROV = [{ competencyId: "22222222-2222-4222-8222-222222222222", frameworkId: "44444444-4444-4444-8444-444444444444", frameworkCode: "NMC-FN", frameworkVersion: "2.1.0", contentHash: "0123456789abcdef0123456789abcdef" }];

describe("WS-D: an understanding check keeps its snapshot, with the framework version", () => {
  it("an unmarked check: marking unmarked, no score, outcome incorrect (the 990 rule), the typed answer and the guide kept", () => {
    const response = checkResponse({ text: "It shows perfusion", question: checkQ.stem, selfGrade: null });
    const s = buildAttemptSnapshot(checkQ, { attemptId: "33333333-3333-4333-8333-333333333333", answeredAt: "2026-11-04T10:00:00Z", chosenIndex: null, response, correct: false, score: null, marking: "unmarked", contentVersion: 2, provenance: PROV })!;
    expect(s).toMatchObject({ marking: "unmarked", score: null, outcome: "incorrect", questionVersion: "own:2" });
    expect(s.response).toMatchObject({ kind: "check", text: "It shows perfusion" });
    expect(s.rubric?.keyPoints).toEqual(["tissue perfusion"]);
    expect(s.competencyProvenance).toEqual(PROV);
    const row = snapshotInsertRow(s) as Record<string, unknown>;
    expect(row.competency_provenance).toEqual([{ competency_id: PROV[0].competencyId, framework_id: PROV[0].frameworkId, framework_code: "NMC-FN", framework_version: "2.1.0", content_hash: PROV[0].contentHash }]);
    expect(snapshotFromRow({ ...row, user_id: "u" })?.competencyProvenance).toEqual(PROV);
  });

  it("provenance is kept only for the question's own competencies, and is left off the row when unknown", () => {
    expect(provenanceFor(["22222222-2222-4222-8222-222222222222"], null)).toBeNull();
    expect(provenanceFor([], PROV)).toBeNull();
    expect(provenanceFor(["55555555-5555-4555-8555-555555555555"], PROV)).toBeNull();
    expect(provenanceFromRow([{ competency_id: 7 }, "x"])).toBeNull();
    const s = buildAttemptSnapshot({ ...checkQ, competencyId: null }, { attemptId: "33333333-3333-4333-8333-333333333333", answeredAt: "t", chosenIndex: null, response: { kind: "check", text: "a" }, correct: true, score: 1, marking: "self_graded" })!;
    expect("competency_provenance" in snapshotInsertRow(s)).toBe(false);
  });
});

/** A fake client: each insert answers the next scripted error (null = success), and records what was sent. */
function fakeAdmin(errors: ({ code: string; message?: string } | null)[]) {
  const sent: Record<string, unknown>[] = [];
  return { sent, from: () => ({ insert: async (row: Record<string, unknown>) => { sent.push({ ...row }); return { error: errors.shift() ?? null }; } }) };
}

describe("WS-D: the snapshot write without 990 (fail closed, no error)", () => {
  beforeEach(() => resetContinuitySchema());
  const snap = (marking: string, provenance: typeof PROV | null) => buildAttemptSnapshot(checkQ, { attemptId: "33333333-3333-4333-8333-333333333333", answeredAt: "t", chosenIndex: null, response: { kind: "check", text: "a" }, correct: false, score: marking === "unmarked" ? null : 0, marking, provenance })!;

  it("the column absent: retried without it, kept as the 791 row, and not sent again", async () => {
    const a = fakeAdmin([{ code: "PGRST204", message: "column competency_provenance not found" }]);
    expect(await insertAttemptSnapshot(a, "u", snap("self_graded", PROV))).toBe("ok");
    expect(a.sent).toHaveLength(2);
    expect("competency_provenance" in a.sent[0]).toBe(true);
    expect("competency_provenance" in a.sent[1]).toBe(false);
    expect(await insertAttemptSnapshot(a, "u", snap("self_graded", PROV))).toBe("ok");
    expect("competency_provenance" in a.sent[2]).toBe(false);
  });

  it("an unmarked snapshot 791 refuses: absent (the attempt stands), and the next unmarked one is not tried", async () => {
    const a = fakeAdmin([{ code: "23514", message: "violates check constraint" }]);
    expect(await insertAttemptSnapshot(a, "u", snap("unmarked", null))).toBe("absent");
    expect(await insertAttemptSnapshot(a, "u", snap("unmarked", null))).toBe("absent");
    expect(a.sent).toHaveLength(1);
  });

  it("with 990: one insert, provenance included", async () => {
    const a = fakeAdmin([null]);
    expect(await insertAttemptSnapshot(a, "u", snap("unmarked", PROV))).toBe("ok");
    expect(a.sent).toHaveLength(1);
    expect(a.sent[0].marking).toBe("unmarked");
  });
});

describe("WS-D: a scenario stage keeps its five feedback parts through the signed token", () => {
  const key = tokenKey("test-secret"), who = { userId: "u", questionId: "q", answer: { format: "scenario" } }, now = Date.parse("2026-11-04T10:00:00Z");
  const parts = { right: ["Named sepsis"], missing: ["Lactate"], misconceptions: [], why: "Lactate shows perfusion.", next: "Revise the Sepsis Six." };

  it("the parts come back as they were judged", () => {
    const t = signProgress(key, who, { next: 1, results: [{ score: 0.5, by: "ai", answer: "x", feedback: "text", parts }], evaluator: { model: "m", promptVersion: "p" } }, now);
    expect(readProgress(key, t, who, now)?.results[0].parts).toEqual(parts);
  });

  it("long parts on every stage keep the token inside the read bound (earliest parts dropped first)", () => {
    const long = { right: Array(4).fill("r".repeat(300)), missing: Array(4).fill("m".repeat(300)), misconceptions: Array(3).fill("x".repeat(300)), why: "w".repeat(400), next: "n".repeat(400) };
    const results = Array.from({ length: 3 }, () => ({ score: 1, by: "ai" as const, answer: "a".repeat(200), feedback: "f".repeat(600), parts: long }));
    const t = signProgress(key, who, { next: 3, results, evaluator: { model: "m", promptVersion: "p" } }, now);
    expect(t.length).toBeLessThanOrEqual(12000);
    const back = readProgress(key, t, who, now);
    expect(back?.results).toHaveLength(3);
    expect(back?.results[2].parts?.right[0].length).toBeLessThanOrEqual(160);
  });
});
