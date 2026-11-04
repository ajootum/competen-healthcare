// SQIE-CLOSE-2026-11 WS-D, owner decision 3 (migration 991): each competency a snapshot names says whether its framework
// version was published (or a draft mapping, publication pending) and which learning objective was tested. Pure, plus the
// store's snapshot write against a fake client (the 991-absent fallback keeps the four 990 keys).

import { beforeEach, describe, expect, it } from "vitest";
import { buildAttemptSnapshot, provenance990Keys, snapshotFromRow, snapshotInsertRow, withMappingStatus, withObjective } from "./attempt-snapshot";
import { insertAttemptSnapshot, resetContinuitySchema, type QuestionRow } from "./store";

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
