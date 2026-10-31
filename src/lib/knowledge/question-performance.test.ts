import { describe, expect, it } from "vitest";
import { HIGH_CORRECT, LOW_CORRECT, MIN_ATTEMPTS, difficultyFlag, loadLibraryPerformance, summarisePerformance } from "./question-performance";

describe("difficultyFlag", () => {
  it("needs 20 attempts", () => { expect(difficultyFlag(19, 0)).toBeNull(); expect(difficultyFlag(MIN_ATTEMPTS, 0)).toBe("review_difficulty_or_key"); });
  it("flags under 25% and over 95% only", () => {
    expect(difficultyFlag(100, 24)).toBe("review_difficulty_or_key");
    expect(difficultyFlag(100, LOW_CORRECT)).toBeNull();
    expect(difficultyFlag(100, 96)).toBe("review_difficulty_or_key");
    expect(difficultyFlag(100, HIGH_CORRECT)).toBeNull();
    expect(difficultyFlag(100, 60)).toBeNull();
  });
});

describe("summarisePerformance", () => {
  it("counts copies, attempts, percent correct and last used per version; no attempts is no percentage (not zero)", () => {
    const m = summarisePerformance(
      [{ id: "c1", library_version_id: "v1" }, { id: "c2", library_version_id: "v1" }, { id: "c3", library_version_id: "v2" }],
      [{ question_id: "c1", correct: true, answered_at: "2026-10-01T00:00:00Z" }, { question_id: "c2", correct: false, answered_at: "2026-10-05T00:00:00Z" }, { question_id: "zz", correct: true, answered_at: "2026-10-09T00:00:00Z" }],
    );
    expect(m.get("v1")).toMatchObject({ copies: 2, attempts: 2, correct: 1, percentCorrect: 50, lastUsed: "2026-10-05T00:00:00Z", flag: null });
    expect(m.get("v2")).toMatchObject({ copies: 1, attempts: 0, percentCorrect: null, lastUsed: null });
  });
});

type Call = { table: string; select: string };
function fake(rows: Record<string, unknown[]>, failOn?: string) {
  const calls: Call[] = [];
  const admin = {
    from(table: string) {
      const q = { select(cols: string) { calls.push({ table, select: cols }); return q; }, in() { return q; }, limit() { return q; },
        then(res: (v: unknown) => void) { res(failOn === table ? { data: null, error: { message: "boom" } } : { data: rows[table] ?? [], error: null }); } };
      return q;
    },
  };
  return { admin, calls };
}

describe("loadLibraryPerformance reads aggregate columns only", () => {
  it("never selects user_id or any content column", async () => {
    const { admin, calls } = fake({ individual_scholar_question: [{ id: "c1", library_version_id: "v1" }], individual_scholar_attempt: [{ question_id: "c1", correct: true, answered_at: "2026-10-01T00:00:00Z" }] });
    const r = await loadLibraryPerformance(admin, ["v1"]);
    expect(r.measured).toBe(true);
    expect(r.byVersion.get("v1")?.attempts).toBe(1);
    expect(calls).toEqual([{ table: "individual_scholar_question", select: "id, library_version_id" }, { table: "individual_scholar_attempt", select: "question_id, correct, answered_at" }]);
    expect(JSON.stringify(calls)).not.toMatch(/user_id|stem|options|rationale|chosen_index|response/);
  });
  it("a read error is not measured, never zero", async () => {
    const { admin } = fake({}, "individual_scholar_question");
    expect(await loadLibraryPerformance(admin, ["v1"])).toMatchObject({ measured: false });
  });
});
