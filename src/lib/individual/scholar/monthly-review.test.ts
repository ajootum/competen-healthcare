import { describe, expect, it } from "vitest";
import {
  apportion, compactBlueprint, enrichBlueprint, expandBlueprint, isLate, isMonth, monthActivity, monthEnd, monthLabel, monthStanding, monthlyBlueprint, monthlyBreakdown, nextMonth, parseBlueprint, parseMix,
  prevMonth, recommendedDate, reviewLength, reviewNudges, selectForBlueprint, weakTopics, type ActivityRecords, type PoolQuestion, type ReviewPolicy,
} from "./monthly-review";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sec = (n: number, m = 1) => ({ chunkId: id(n), materialId: id(100 + m), materialTitle: `Material ${m}`, label: `section ${n}` });
const POLICY: ReviewPolicy = { minQuestions: 10, maxQuestions: 30, perSection: 2, mix: "60_25_15" };

function records(): ActivityRecords {
  return {
    sections: [sec(1), sec(2), sec(3), sec(4, 2)],
    lessons: [
      { sessionId: "s1", step: 0, title: "Haemodynamics", chunkIds: [id(1), id(2)], at: "2026-10-03T09:00:00Z" },
      { sessionId: "s1", step: 0, title: "Haemodynamics", chunkIds: [id(1), id(2)], at: "2026-10-04T09:00:00Z" },   // same lesson, a second event
      { sessionId: "s1", step: 1, title: "Preload", chunkIds: [id(3)], at: "2026-10-05T09:00:00Z" },
      { sessionId: "s2", step: 0, title: "September lesson", chunkIds: [id(4)], at: "2026-09-30T23:59:59Z" },   // not October
    ],
    materials: [{ id: id(102), title: "Material 2", at: "2026-10-31T23:00:00Z" }, { id: id(101), title: "Material 1", at: "2026-08-01T10:00:00Z" }],
    answers: [
      { questionId: "q1", chunkId: id(1), at: "2026-10-10T10:00:00Z", sessionId: "r1" }, { questionId: "q2", chunkId: id(1), at: "2026-10-10T10:01:00Z", sessionId: "r1" },
      { questionId: "q3", chunkId: id(2), at: "2026-11-01T00:00:00Z", sessionId: "r2" },   // November
      { questionId: "q9", chunkId: id(999), at: "2026-10-11T10:00:00Z", sessionId: "r1" },   // not the learner's section
    ],
    reviews: [{ chunkId: id(3), at: "2026-10-12T10:00:00Z" }],
    revisionSessions: [{ id: "r1", mode: "quick", at: "2026-10-10T10:00:00Z" }, { id: "r2", mode: "mock", at: "2026-11-01T00:00:00Z" }],
    caseSessions: [{ id: "c1", at: "2026-10-20T12:00:00Z", chunkIds: [id(2)] }],
    topics: { [id(1)]: ["Cardiac output"], [id(2)]: ["Cardiac output", "Preload"], [id(3)]: ["Preload"] },
    links: [{ chunkId: id(1), competencyId: "k1" }, { chunkId: id(4), competencyId: "k2" }],
    competencies: [{ id: "k1", title: "Haemodynamic monitoring" }, { id: "k2", title: "Other" }],
  };
}

describe("dates", () => {
  it("handles month arithmetic across a year end", () => {
    expect([nextMonth("2026-12"), prevMonth("2026-01"), monthEnd("2026-02"), monthEnd("2028-02"), monthLabel("2026-10")]).toEqual(["2027-01", "2025-12", "2026-02-28", "2028-02-29", "October 2026"]);
    expect([isMonth("2026-10"), isMonth("2026-13"), isMonth("26-10"), isMonth(null)]).toEqual([true, false, false, false]);
  });
  it("recommends N days before the month ends, never before it starts", () => {
    expect(recommendedDate("2026-10", 5)).toBe("2026-10-26");
    expect(recommendedDate("2026-02", 40)).toBe("2026-02-01");
    expect(isLate("2026-10", "2026-11-02T00:00:00Z")).toBe(true);
    expect(isLate("2026-10", "2026-10-31T23:59:00Z")).toBe(false);
  });
});

describe("monthActivity", () => {
  const a = monthActivity(records(), "2026-10");
  it("counts only real activity dated inside the month", () => {
    expect(a.lessons.map(l => `${l.sessionId}:${l.step}`)).toEqual(["s1:0", "s1:1"]);   // one lesson once, September's excluded
    expect(a.answers).toBe(3);   // q9 is counted as an answer, but touches no section of the learner
    expect(a.revisionSessions).toBe(1);
    expect(a.caseSessions).toBe(1);
    expect(a.reviews).toBe(1);
    expect(a.activeDays).toEqual(["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-20", "2026-10-31"]);
  });
  it("names the sections, materials, subjects and competencies from existing mappings", () => {
    expect(a.sections.map(s => s.chunkId).sort()).toEqual([id(1), id(2), id(3)]);   // section 4 had only a September lesson
    expect(a.materials.map(m => m.title)).toEqual(["Material 1", "Material 2"]);    // Material 2 was added on 31 October
    expect(a.subjects).toEqual(["Cardiac output", "Preload"]);
    expect(a.competencies.map(c => c.title)).toEqual(["Haemodynamic monitoring"]);
  });
  it("weights by lessons, answers, reviews and cases, heaviest first", () => {
    // section 1: 1 lesson x2 + 2 answers = 4. section 2: 1 lesson x2 + 1 case x2 = 4. section 3: 1 lesson x2 + 1 review = 3. Ties go to the lower id.
    expect(a.sections.map(s => [s.chunkId, s.weight])).toEqual([[id(1), 4], [id(2), 4], [id(3), 3]]);
  });
  it("is empty for a month with nothing in it", () => {
    const e = monthActivity(records(), "2026-07");
    expect(e.sections).toEqual([]);
    expect(e.activeDays).toEqual([]);
  });
});

describe("monthlyBlueprint", () => {
  const act = monthActivity(records(), "2026-10");
  const gaps = { [id(1)]: 2, [id(3)]: 1 };
  it("is deterministic and balanced: shares of the length, a place for every section", () => {
    const x = monthlyBlueprint(act, gaps, POLICY), y = monthlyBlueprint(act, gaps, POLICY);
    expect(x).toEqual(y);
    expect(x.length).toBe(10);   // 3 sections x 2 = 6, held up to the fewest (10)
    expect(x.sections.length).toBe(3);
    expect(x.totals.core + x.totals.application + x.totals.gaps).toBe(10);
    expect(x.sections.every(s => s.core + s.application + s.gaps >= 1)).toBe(true);
    expect(x.totals.gaps).toBeLessThanOrEqual(3);   // only the known gaps
    expect(x.totals.application).toBeGreaterThan(0);
  });
  it("never asks for gap questions that are not known", () => {
    const b = monthlyBlueprint(act, {}, POLICY);
    expect(b.totals.gaps).toBe(0);
    expect(b.totals.core + b.totals.application).toBe(b.length);
    for (const s of b.sections) expect(s.gaps).toBe(0);
  });
  it("clamps the length to the policy and drops the lightest sections when it is shorter than their number", () => {
    const many: ActivityRecords = {
      ...records(), sections: Array.from({ length: 12 }, (_, i) => sec(i + 1)), answers: [], reviews: [], caseSessions: [], revisionSessions: [], links: [],
      lessons: Array.from({ length: 12 }, (_, i) => ({ sessionId: "s", step: i, title: "t", chunkIds: [id(i + 1)], at: "2026-10-02T00:00:00Z" })),
    };
    const m = monthActivity(many, "2026-10");
    const capped = monthlyBlueprint(m, {}, { ...POLICY, minQuestions: 3, maxQuestions: 8 });
    expect(capped.length).toBe(8);
    expect(capped.sections.length).toBe(8);
    expect(capped.omittedSections).toBe(4);
    expect(monthlyBlueprint(m, {}, { ...POLICY, maxQuestions: 30 }).length).toBe(24);
  });
  it("has no blueprint for a month with no activity, and tolerates min above max", () => {
    expect(monthlyBlueprint(monthActivity(records(), "2026-07"), {}, POLICY)).toMatchObject({ length: 0, sections: [] });
    expect(reviewLength(3, { minQuestions: 40, maxQuestions: 20, perSection: 2 })).toBe(20);
    expect(reviewLength(0, POLICY)).toBe(0);
  });
  it("gives more questions to the heavier section", () => {
    const heavy: ActivityRecords = { ...records(), answers: Array.from({ length: 30 }, (_, i) => ({ questionId: `q${i}`, chunkId: id(1), at: "2026-10-10T10:00:00Z", sessionId: "r1" })) };
    const b = monthlyBlueprint(monthActivity(heavy, "2026-10"), {}, { ...POLICY, minQuestions: 12 });
    const n = (c: string) => { const s = b.sections.find(x => x.chunkId === c)!; return s.core + s.application + s.gaps; };
    expect(n(id(1))).toBeGreaterThan(n(id(3)));
  });
  it("parses its mixes and falls back on an unknown one", () => {
    expect(parseMix("40_30_30")).toEqual({ core: 40, application: 30, gaps: 30 });
    expect(parseMix("nonsense")).toEqual({ core: 60, application: 25, gaps: 15 });
    expect(apportion(10, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(10);
    expect(apportion(5, [0, 0])).toEqual([3, 2]);
  });
  it("reads back what it produced, and refuses anything else", () => {
    const b = monthlyBlueprint(act, gaps, POLICY);
    expect(parseBlueprint(JSON.parse(JSON.stringify(b)), "2026-10")).toMatchObject({ length: b.length, totals: b.totals });
    expect(parseBlueprint(b, "2026-09")).toBeNull();
    expect(parseBlueprint({ ...b, sections: [{ ...b.sections[0], chunkId: "nope" }] }, "2026-10")).toBeNull();
    expect(parseBlueprint({ ...b, sections: [] }, "2026-10")).toBeNull();
    expect(parseBlueprint({ ...b, sections: [{ ...b.sections[0], core: -1 }] }, "2026-10")).toBeNull();
  });
});

describe("the compact blueprint", () => {
  const act = monthActivity(records(), "2026-10");
  const bp = monthlyBlueprint(act, { [id(1)]: 2 }, POLICY);
  it("carries the targets exactly through a short string, and names the sections again from the learner's own", () => {
    const c = compactBlueprint(bp);
    expect(c.length).toBeLessThan(400);
    const back = expandBlueprint(c, "2026-10")!;
    expect(back.sections.map(s => [s.chunkId, s.core, s.application, s.gaps, s.weight])).toEqual(bp.sections.map(s => [s.chunkId, s.core, s.application, s.gaps, s.weight]));
    expect([back.length, back.totals, back.policy, back.omittedSections]).toEqual([bp.length, bp.totals, bp.policy, bp.omittedSections]);
    expect(enrichBlueprint(back, records().sections)).toEqual(bp);
  });
  it("refuses anything that is not one", () => {
    expect(expandBlueprint("nonsense", "2026-10")).toBeNull();
    expect(expandBlueprint(null, "2026-10")).toBeNull();
    expect(expandBlueprint(`60.25.15.10.30.2.0~${id(1)}.0.0.0.1`, "2026-10")).toBeNull();      // nothing asked for
    expect(expandBlueprint(`60.25.15.10.30.2~${id(1)}.1.0.0.1`, "2026-10")).toBeNull();        // short header
    expect(expandBlueprint(`60.25.15.10.30.2.0~${id(1)}.1.0.0.1~${id(1)}.1.0.0.1`, "2026-10")).toBeNull();   // a section twice
    expect(expandBlueprint(`60.25.15.10.30.2.0~nope.1.0.0.1`, "2026-10")).toBeNull();
  });
});

describe("selectForBlueprint", () => {
  const act = monthActivity(records(), "2026-10");
  const bp = monthlyBlueprint(act, { [id(1)]: 2 }, POLICY);
  const pool: PoolQuestion[] = [];
  for (const s of [1, 2, 3]) for (let i = 0; i < 4; i++) pool.push({ id: `c${s}-${i}`, chunkId: id(s), application: false, gap: false });
  pool.push({ id: "a2", chunkId: id(2), application: true, gap: false }, { id: "g1a", chunkId: id(1), application: false, gap: true }, { id: "g1b", chunkId: id(1), application: false, gap: true });
  it("fills from stored questions, gaps and application first, with no repeats", () => {
    const s = selectForBlueprint(bp, pool, "u:2026-10");
    expect(new Set(s.picked.map(p => p.id)).size).toBe(s.picked.length);
    expect(s.picked.filter(p => p.bucket === "gaps").map(p => p.id).sort()).toEqual(["g1a", "g1b"].slice(0, bp.totals.gaps));
    expect(s.picked.length + s.shortfallTotal).toBe(bp.length);
    expect(s.spilled.application).toBe(bp.totals.application - s.picked.filter(p => p.bucket === "application").length);
  });
  it("is deterministic for the same pool and seed, and changes with the seed", () => {
    const a = selectForBlueprint(bp, pool, "x"), b = selectForBlueprint(bp, pool, "x"), c = selectForBlueprint(bp, pool, "y");
    expect(a).toEqual(b);
    expect(c.picked.map(p => p.id)).not.toEqual(a.picked.map(p => p.id));
  });
  it("reports what is still short when too little is stored, after using other sections' stored questions", () => {
    const small = selectForBlueprint(bp, pool.filter(q => q.chunkId === id(1) && !q.gap).slice(0, 2), "s");
    expect(small.picked.length).toBe(2);
    expect(small.shortfallTotal).toBe(bp.length - 2);
    expect(small.shortfall.reduce((n, x) => n + x.count, 0)).toBe(small.shortfallTotal);
  });
  it("is all shortfall with an empty pool", () => {
    const none = selectForBlueprint(bp, [], "s");
    expect(none.picked).toEqual([]);
    expect(none.shortfallTotal).toBe(bp.length);
  });
});

describe("monthlyBreakdown", () => {
  const sections = [sec(1), sec(2), sec(3)];
  const questions = [
    { id: "a", chunkId: id(1), application: false }, { id: "b", chunkId: id(1), application: false }, { id: "c", chunkId: id(2), application: true },
    { id: "d", chunkId: id(2), application: false }, { id: "e", chunkId: id(3), application: false }, { id: "f", chunkId: id(3), application: false },
  ];
  const t = (q: string, correct: boolean, marking = "deterministic", answeredAt = "2026-11-02T10:00:00Z") => ({ questionId: q, correct, marking, answeredAt });
  const r = monthlyBreakdown({
    sections, topics: { [id(1)]: ["Cardiac output"], [id(2)]: ["Preload"] }, questions, bands: { strong: 80, developing: 50 },
    attempts: [t("a", true), t("b", true), t("c", false), t("d", false), t("e", false, "self_graded"), t("a", false, "deterministic", "2026-11-01T10:00:00Z")],
  });
  it("judges each question on its latest answer and counts only code-marked ones in the figure", () => {
    expect(r.overall).toMatchObject({ asked: 6, answered: 4, correct: 2, other: 1, unanswered: 1, percent: 50 });
    expect(r.byType.application).toEqual({ asked: 1, answered: 1, correct: 0 });
    expect(r.missed.map(m => m.questionId).sort()).toEqual(["c", "d"]);
  });
  it("is honest per section: a figure, too few, or none", () => {
    const by = (n: number) => r.bySection.find(s => s.chunkId === id(n))!;
    expect(by(1)).toMatchObject({ state: "ok", percent: 100, band: "strong" });
    expect(by(2)).toMatchObject({ state: "ok", percent: 0, band: "needs_work" });
    expect(by(3)).toMatchObject({ state: "none", percent: null, other: 1 });
  });
  it("lists the weakest first and names topics worth putting first in a plan", () => {
    expect(r.bySection[0].chunkId).toBe(id(2));
    expect(weakTopics(r)).toEqual(["Preload"]);
    expect(weakTopics({ bySection: [] })).toEqual([]);
  });
  it("gives no overall figure from fewer than two code-marked answers", () => {
    const one = monthlyBreakdown({ sections, topics: {}, questions: questions.slice(0, 1), attempts: [t("a", true)], bands: { strong: 80, developing: 50 } });
    expect(one.overall.percent).toBeNull();
    expect(one.bySection[0].state).toBe("too_few");
  });
});

describe("standing and nudges", () => {
  const row = (idn: string, createdAt: string, retakeOf: string | null = null) => ({ id: idn, month: "2026-10", createdAt, retakeOf, late: false });
  it("the first completed review is the original and later ones are practice, newest first", () => {
    const s = monthStanding([row("r2", "2026-11-05T00:00:00Z", "r1"), row("r1", "2026-10-30T00:00:00Z"), row("r3", "2026-11-09T00:00:00Z", "r1"), { ...row("x", "2026-10-01T00:00:00Z"), month: "2026-09" }], "2026-10");
    expect(s.original?.id).toBe("r1");
    expect(s.retakes.map(r => r.id)).toEqual(["r3", "r2"]);
    expect(monthStanding([], "2026-10")).toEqual({ original: null, retakes: [] });
  });
  const base = { recommendDays: 5, reminders: true, optedOut: false, done: new Set<string>(), active: new Set(["2026-09", "2026-10"]) };
  it("reminds from the recommended date, and about last month for two weeks", () => {
    expect(reviewNudges({ ...base, today: "2026-10-20" }).map(n => n.month)).toEqual([]);
    expect(reviewNudges({ ...base, today: "2026-10-26" }).map(n => n.month)).toEqual(["2026-10"]);
    expect(reviewNudges({ ...base, today: "2026-11-10", active: new Set(["2026-10"]) })).toEqual([{ month: "2026-10", due: true, recommended: "2026-10-26", late: true }]);
    expect(reviewNudges({ ...base, today: "2026-11-20", active: new Set(["2026-10"]) })).toEqual([]);
  });
  it("is silent when taken, opted out, off, or the month had no activity", () => {
    expect(reviewNudges({ ...base, today: "2026-10-28", done: new Set(["2026-10"]) })).toEqual([]);
    expect(reviewNudges({ ...base, today: "2026-10-28", optedOut: true })).toEqual([]);
    expect(reviewNudges({ ...base, today: "2026-10-28", reminders: false })).toEqual([]);
    expect(reviewNudges({ ...base, today: "2026-10-28", active: new Set() })).toEqual([]);
  });
});
