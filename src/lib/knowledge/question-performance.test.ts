import { describe, expect, it } from "vitest";
import {
  HIGH_CORRECT, LOW_CORRECT, MIN_ATTEMPTS, difficultyFlag, discriminationFlag, floorOf, loadFormatCorrectness, loadLibraryPerformance,
  misconceptionPatterns, optionCells, versionPerformanceOf,
} from "./question-performance";

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

describe("discrimination", () => {
  it("negative, weak or fine; no index is no flag", () => {
    expect(discriminationFlag(-0.1)).toBe("negative");
    expect(discriminationFlag(0.1)).toBe("weak");
    expect(discriminationFlag(0.35)).toBeNull();
    expect(discriminationFlag(null)).toBeNull();
  });
});

describe("the floor is the CKRI minimum cohort, never below 5", () => {
  it("clamps", () => { expect(floorOf({ minCohort: 2, roundTo: 5 })).toBe(5); expect(floorOf({ minCohort: 12, roundTo: 5 })).toBe(12); });
});

describe("optionCells: complementary suppression", () => {
  it("missing options are a real zero, numbers kept", () => { expect(optionCells({ 0: 10, 2: 15 })).toEqual([10, 0, 15, 0]); });
  it("exactly one hidden cell hides the smallest reported one too", () => { expect(optionCells({ 0: 20, 1: null, 2: 10, 3: 15 })).toEqual([20, null, null, 15]); });
  it("two hidden cells are left as they are", () => { expect(optionCells({ 0: 20, 1: null, 2: null, 3: 15 })).toEqual([20, null, null, 15]); });
  it("unreadable is none", () => { expect(optionCells(null)).toBeNull(); expect(optionCells([1])).toBeNull(); });
});

describe("versionPerformanceOf", () => {
  it("a suppressed row carries no figure at all", () => {
    const p = versionPerformanceOf({ version_id: "v1", suppressed: true, learners: 3, attempts: 9, percent_correct: 50, option_counts: { 0: 3 } });
    expect(p).toMatchObject({ versionId: "v1", suppressed: true, learners: null, attempts: null, percentCorrect: null, options: null, discrimination: null, flag: null });
  });
  it("a reported row: counts, flags", () => {
    const p = versionPerformanceOf({ version_id: "v2", suppressed: false, learners: 30, attempts: 40, first_attempts: 30, percent_correct: 20, first_percent_correct: 15,
      last_used: "2026-11-01", missed_learners: 25, option_counts: { 0: 5, 1: 20, 2: null, 3: 5 }, discrimination: -0.12, discrimination_n: 25 });
    expect(p).toMatchObject({ learners: 30, attempts: 40, percentCorrect: 20, flag: "review_difficulty_or_key", discriminationFlag: "negative", missedLearners: 25 });
    expect(p.options).toEqual([null, 20, null, 5]);
  });
});

type Rpc = { fn: string; args: Record<string, unknown> };
function fakeRpc(result: (fn: string) => { data: unknown; error: unknown }) {
  const calls: Rpc[] = [];
  const froms: string[] = [];
  const admin = {
    rpc(fn: string, args: Record<string, unknown>) { calls.push({ fn, args }); return Promise.resolve(result(fn)); },
    from(t: string) { froms.push(t); throw new Error("no table may be read directly"); },
  };
  return { admin, calls, froms };
}

describe("loadLibraryPerformance reads ONLY the 996 function (consent and floor in the database)", () => {
  it("passes the floor and rounding, reads no table", async () => {
    const { admin, calls, froms } = fakeRpc(() => ({ data: [{ version_id: "v1", suppressed: false, learners: 10, attempts: 20, percent_correct: 60 }], error: null }));
    const r = await loadLibraryPerformance(admin, ["v1", "v1"], { minCohort: 3, roundTo: 5 });
    expect(r).toMatchObject({ measured: true, floor: 5 });
    expect(r.byVersion.get("v1")?.attempts).toBe(20);
    expect(calls).toEqual([{ fn: "ckri_library_item_stats", args: { p_versions: ["v1"], p_min: 5, p_round: 5 } }]);
    expect(froms).toEqual([]);
  });
  it("996 absent: not measured with the reason, never zero", async () => {
    const { admin } = fakeRpc(() => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.ckri_library_item_stats" } }));
    const r = await loadLibraryPerformance(admin, ["v1"], { minCohort: 10, roundTo: 5 });
    expect(r.measured).toBe(false);
    expect(r.reason).toMatch(/996/);
    expect(r.byVersion.size).toBe(0);
  });
  it("per format: through the second 996 function", async () => {
    const { admin, calls } = fakeRpc(() => ({ data: [{ format: "mcq", source: "personal", suppressed: true, learners: null }, { format: "short", source: "library", suppressed: false, learners: 10, attempts: 30, percent_correct: 70 }], error: null }));
    const r = await loadFormatCorrectness(admin, { minCohort: 10, roundTo: 5 });
    expect(calls[0].fn).toBe("ckri_question_format_correctness");
    expect(r.rows).toEqual([
      { format: "mcq", source: "personal", suppressed: true, learners: null, attempts: null, percentCorrect: null },
      { format: "short", source: "library", suppressed: false, learners: 10, attempts: 30, percentCorrect: 70 },
    ]);
  });
});

describe("misconceptionPatterns", () => {
  it("sums missed learners per misconception over reported versions only", () => {
    const perf = new Map([
      ["a", versionPerformanceOf({ version_id: "a", suppressed: false, missed_learners: 10 })],
      ["b", versionPerformanceOf({ version_id: "b", suppressed: false, missed_learners: 5 })],
      ["c", versionPerformanceOf({ version_id: "c", suppressed: true })],
    ]);
    const out = misconceptionPatterns([
      { versionId: "a", misconceptions: ["Confusing preload with afterload", "Ignoring units"] },
      { versionId: "b", misconceptions: ["confusing preload with afterload."] },
      { versionId: "c", misconceptions: ["Ignoring units"] },
    ], perf);
    expect(out).toEqual([
      { misconception: "Confusing preload with afterload", versions: 2, missedLearners: 15 },
      { misconception: "Ignoring units", versions: 1, missedLearners: 10 },
    ]);
  });
});
