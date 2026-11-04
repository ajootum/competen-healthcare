// SQIE-CLOSE-2026-11 WS-D (owner decision 3, migration 991: mapping status and objective) and WS-H (the stem must not reveal the key; identifiers in generated
// mcq and case text). Pure, plus the store's snapshot write against a fake client (the 990-absent fallback).

import { beforeEach, describe, expect, it } from "vitest";
import { buildAttemptSnapshot, provenance990Keys, snapshotFromRow, snapshotInsertRow, withMappingStatus, withObjective } from "./attempt-snapshot";
import { checkQuestions, type DraftQuestion, type Passage } from "./generation";
import { echoedInStem, keyInStem, qualityProblems } from "./question-quality";
import { checkRevisionDraft } from "./revision";
import { insertAttemptSnapshot, resetContinuitySchema, type QuestionRow } from "./store";

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


const COMP = "22222222-2222-4222-8222-222222222222", FW = "44444444-4444-4444-8444-444444444444";
const checkQ = {
  id: "11111111-1111-4111-8111-111111111111", materialId: "m", chunkId: "c", kind: "short", stem: "Why is lactate measured in sepsis?", options: [], correctIndex: null,
  rationale: "Lactate shows tissue perfusion.", sourceQuote: "measure lactate", model: "m", promptVersion: "p", createdAt: "2026-11-04T00:00:00Z",
  answer: { accepted: ["Lactate shows tissue perfusion."], rubric: { keyPoints: ["tissue perfusion"], objective: "Explain why lactate is measured" } },
  difficulty: 2, materialTitle: "Notes", ordinal: 1, pageFrom: null, pageTo: null, unit: "page", latest: null,
  competencyId: COMP, caseId: null, caseStep: null, caseTitle: null,
} as unknown as QuestionRow;
const base = [{ id: COMP, content_hash: null, framework_id: FW, framework_version: "2.1.0" }];

describe("WS-D owner decision 3 (991): mapping status and learning objective", () => {
  it("published or draft from the framework at answer time; unknown stays null", () => {
    expect(withMappingStatus(base, new Map([[FW, "published" as const]]))[0].mapping_status).toBe("published");
    expect(withMappingStatus(base, new Map([[FW, "draft" as const]]))[0].mapping_status).toBe("draft");
    expect(withMappingStatus(base, new Map())[0].mapping_status).toBeNull();
    expect(withMappingStatus([{ ...base[0], framework_id: null }], new Map([[FW, "published" as const]]))[0].mapping_status).toBeNull();
  });

  it("the objective is bounded, and kept on the snapshot row and read back", () => {
    const p = withObjective(withMappingStatus(base, new Map([[FW, "draft" as const]])), "x".repeat(400));
    expect(p[0].objective).toHaveLength(300);
    const s = buildAttemptSnapshot(checkQ, { attemptId: "33333333-3333-4333-8333-333333333333", answeredAt: "t", chosenIndex: null, response: { kind: "check", text: "a" }, correct: false, score: null, marking: "unmarked", provenance: p })!;
    const row = snapshotInsertRow(s) as Record<string, unknown>;
    expect((row.competency_provenance as Record<string, unknown>[])[0]).toMatchObject({ id: COMP, mapping_status: "draft" });
    expect(snapshotFromRow({ ...row })?.competencyProvenance?.[0]).toMatchObject({ mapping_status: "draft", objective: "x".repeat(300) });
    expect(provenance990Keys(p)).toEqual(base);
  });
});

/** A fake client: each insert answers the next scripted error (null = success), and records a copy of what was sent. */
function fakeAdmin(errors: ({ code: string; message?: string } | null)[]) {
  const sent: Record<string, unknown>[] = [];
  return { sent, from: () => ({ insert: async (row: Record<string, unknown>) => { sent.push(JSON.parse(JSON.stringify(row))); return { error: errors.shift() ?? null }; } }) };
}

describe("WS-D (991): the snapshot write without 991 keeps the 990 keys only (fail closed, no error)", () => {
  beforeEach(() => resetContinuitySchema());
  const snap = () => buildAttemptSnapshot(checkQ, { attemptId: "33333333-3333-4333-8333-333333333333", answeredAt: "t", chosenIndex: null, response: { kind: "check", text: "a" }, correct: false, score: 0, marking: "self_graded",
    provenance: withObjective(withMappingStatus(base, new Map([[FW, "published" as const]])), "Explain") })!;

  it("the 990 CHECK refuses the new keys: retried with the four 990 keys, and not sent again", async () => {
    const a = fakeAdmin([{ code: "23514", message: "new row violates check constraint \"individual_scholar_attempt_snapshot_provenance_check\"" }]);
    expect(await insertAttemptSnapshot(a, "u", snap(), { needs990: true })).toBe("ok");
    expect(a.sent).toHaveLength(2);
    expect((a.sent[0].competency_provenance as Record<string, unknown>[])[0]).toHaveProperty("mapping_status", "published");
    expect(a.sent[1].competency_provenance).toEqual(base);
    expect(await insertAttemptSnapshot(a, "u", snap(), { needs990: true })).toBe("ok");
    expect(a.sent[2].competency_provenance).toEqual(base);
  });

  it("with 991: one insert, the status and objective kept", async () => {
    const a = fakeAdmin([null]);
    expect(await insertAttemptSnapshot(a, "u", snap(), { needs990: true })).toBe("ok");
    expect(a.sent).toHaveLength(1);
    expect((a.sent[0].competency_provenance as Record<string, unknown>[])[0]).toMatchObject({ mapping_status: "published", objective: "Explain" });
  });

  it("a shape refusal that is not the provenance rule is not retried", async () => {
    const a = fakeAdmin([{ code: "23514", message: "violates check constraint \"individual_scholar_attempt_snapshot_shape_check\"" }]);
    expect(await insertAttemptSnapshot(a, "u", snap(), { needs990: true })).toBe("failed");
    expect(a.sent).toHaveLength(1);
  });
});
