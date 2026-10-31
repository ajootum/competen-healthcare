import { describe, expect, it } from "vitest";
import { misconceptionScore, pickByMisconception, recentMisses, type RecentMiss } from "./misconception";
import { pickQuestions, type PoolItem } from "./revision";
import { selectNext, type Candidate } from "./adaptive";

// SCHOLAR-SQIE-LEARNER-01: the next item prefers an unanswered or due item whose rubric names a misconception the learner keeps
// missing (or whose topic is the one they missed), then the existing rotation. A stable reorder: nothing added, nothing dropped.

const NOW = "2026-10-31T12:00:00Z";
const miss = (over: Partial<RecentMiss> = {}): RecentMiss => ({ misconceptions: ["The infection starts in the kidneys"], topic: null, chunkId: null, at: "2026-10-28T09:00:00Z", ...over });

describe("recent misses", () => {
  it("are the last 30 days, newest first; older or future ones are not counted", () => {
    const rows = [miss({ at: "2026-10-02T00:00:00Z" }), miss({ at: "2026-09-30T00:00:00Z" }), miss({ at: "2026-10-30T00:00:00Z" }), miss({ at: "2026-11-05T00:00:00Z" }), miss({ at: "not a date" })];
    expect(recentMisses(rows, NOW).map(r => r.at)).toEqual(["2026-10-30T00:00:00Z", "2026-10-02T00:00:00Z"]);
    expect(recentMisses(rows, NOW, 3).map(r => r.at)).toEqual(["2026-10-30T00:00:00Z"]);
  });
});

describe("misconceptionScore", () => {
  it("counts a misconception in the same words or mostly the same words, and the topic or section of a missed item", () => {
    const m = [miss({ topic: "Renal infections", chunkId: "c9" })];
    expect(misconceptionScore({ id: "a", misconceptions: ["the infection starts in the kidneys."] }, m)).toBe(3);
    expect(misconceptionScore({ id: "a", misconceptions: ["Infection starts in the kidneys first"] }, m)).toBe(3);
    expect(misconceptionScore({ id: "a", misconceptions: ["Antibiotics are never needed"] }, m)).toBe(0);
    expect(misconceptionScore({ id: "a", topic: "renal infections" }, m)).toBe(1);
    expect(misconceptionScore({ id: "a", chunkId: "c9" }, m)).toBe(1);
    expect(misconceptionScore({ id: "a", misconceptions: ["The infection starts in the kidneys"], topic: "Renal infections" }, m)).toBe(4);
    expect(misconceptionScore({ id: "a", misconceptions: ["The infection starts in the kidneys"] }, [])).toBe(0);
  });
});

describe("pickByMisconception", () => {
  const items = [
    { id: "plain", misconceptions: [], lastAnsweredAt: null },
    { id: "answered-match", misconceptions: ["The infection starts in the kidneys"], lastAnsweredAt: "2026-10-20T00:00:00Z", due: false },
    { id: "new-match", misconceptions: ["The infection starts in the kidneys"], lastAnsweredAt: null },
    { id: "due-match", misconceptions: ["The infection starts in the kidneys"], lastAnsweredAt: "2026-10-01T00:00:00Z", due: true },
    { id: "new-topic", topic: "Renal infections", lastAnsweredAt: null },
  ];
  it("puts unanswered or due matches first, best match first, then everything else in its given order", () => {
    const out = pickByMisconception(items, [miss({ topic: "Renal infections" })]).map(i => i.id);
    expect(out).toEqual(["new-match", "due-match", "new-topic", "plain", "answered-match"]);
  });
  it("is a stable reorder: with no misses, or no match, the order is the one given and nothing is lost", () => {
    expect(pickByMisconception(items, []).map(i => i.id)).toEqual(items.map(i => i.id));
    expect(pickByMisconception(items, [miss({ misconceptions: ["Something unrelated entirely"] })]).map(i => i.id)).toEqual(items.map(i => i.id));
    expect(pickByMisconception(items, [miss()])).toHaveLength(items.length);
  });
  it("can include answered items too (Weak areas)", () => {
    expect(pickByMisconception(items, [miss()], { answeredToo: true }).map(i => i.id).slice(0, 3)).toEqual(["answered-match", "new-match", "due-match"]);
  });
});

describe("adaptive selectNext", () => {
  const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({ id, kind: "mcq", difficulty: 2, library: false, createdAt: `2026-10-0${id.length}T00:00:00Z`, lastAnsweredAt: null, ...over });
  const base = { target: "standard" as const, exclude: new Set<string>(), formats: ["mcq" as const], lastKind: null };

  it("with no misses, picks as before", () => {
    const pool = [cand("a"), cand("bb", { misconceptions: ["The infection starts in the kidneys"] })];
    expect(selectNext({ ...base, pool }).exact?.id).toBe("a");
    expect(selectNext({ ...base, pool, recentMisses: [] }).exact?.id).toBe("a");
  });
  it("prefers an unanswered item on a misconception the learner keeps missing, over the rotation's pick", () => {
    const pool = [cand("a"), cand("bb", { misconceptions: ["The infection starts in the kidneys"] })];
    expect(selectNext({ ...base, pool, recentMisses: [miss()] }).exact?.id).toBe("bb");
  });
  it("never prefers an answered item that is not due, never crosses the target difficulty, never picks an excluded one", () => {
    const pool = [cand("a"), cand("bb", { misconceptions: ["The infection starts in the kidneys"], lastAnsweredAt: "2026-10-20T00:00:00Z" })];
    expect(selectNext({ ...base, pool, recentMisses: [miss()] }).exact?.id).toBe("a");
    const hard = [cand("a"), cand("bb", { misconceptions: ["The infection starts in the kidneys"], difficulty: 3 })];
    expect(selectNext({ ...base, pool: hard, recentMisses: [miss()] }).exact?.id).toBe("a");
    const gone = [cand("a"), cand("bb", { misconceptions: ["The infection starts in the kidneys"] })];
    expect(selectNext({ ...base, pool: gone, exclude: new Set(["bb"]), recentMisses: [miss()] }).exact?.id).toBe("a");
  });
  it("a due item on the missed topic is preferred", () => {
    const pool = [cand("a"), cand("bb", { topic: "Renal infections", lastAnsweredAt: "2026-10-01T00:00:00Z", due: true })];
    expect(selectNext({ ...base, pool, recentMisses: [miss({ misconceptions: [], topic: "renal infections" })] }).exact?.id).toBe("bb");
  });
});

describe("Weak areas", () => {
  const item = (id: string, over: Partial<PoolItem> = {}): PoolItem => ({
    id, kind: "short", difficulty: 2, chunkId: "c1", createdAt: "2026-10-01T00:00:00Z", latestCorrect: false, misses: 1, lastAnsweredAt: "2026-10-20T00:00:00Z", due: false, ...over,
  });
  const ask = (pool: PoolItem[], recent?: RecentMiss[]) => pickQuestions({ mode: "weak", pool, quantity: 10, formats: ["short"], difficulty: "any", seed: "s", recentMisses: recent }).ids;

  it("with no recent misses the order is most-missed first, as before", () => {
    const pool = [item("a", { misses: 1 }), item("b", { misses: 3 }), item("c", { misses: 2 })];
    expect(ask(pool)).toEqual(["b", "c", "a"]);
    expect(ask(pool, [])).toEqual(["b", "c", "a"]);
  });
  it("among the missed, those on a misconception the learner keeps missing come first", () => {
    const pool = [item("a", { misses: 1, misconceptions: ["The infection starts in the kidneys"] }), item("b", { misses: 3 }), item("c", { misses: 2 })];
    expect(ask(pool, [miss()])).toEqual(["a", "b", "c"]);
  });
  it("then unanswered or due questions on the same misconception fill what is left; unrelated ones do not", () => {
    const pool = [
      item("a", { misses: 2 }),
      item("fresh-match", { latestCorrect: null, misses: 0, lastAnsweredAt: null, misconceptions: ["The infection starts in the kidneys"] }),
      item("fresh-other", { latestCorrect: null, misses: 0, lastAnsweredAt: null }),
      item("due-match", { latestCorrect: true, misses: 0, due: true, misconceptions: ["The infection starts in the kidneys"] }),
      item("answered-match", { latestCorrect: true, misses: 0, misconceptions: ["The infection starts in the kidneys"] }),
    ];
    expect(ask(pool, [miss()])).toEqual(["a", "fresh-match", "due-match"]);
    expect(ask(pool)).toEqual(["a"]);
  });
});
