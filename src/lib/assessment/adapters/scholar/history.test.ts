import { describe, expect, it } from "vitest";
import { RA, RESP_ASSESS } from "../../core/fixtures";
import type { Responses } from "../../core";
import { buildHistory, deltaText, lowerMedian, ratingsByCompetency, type Attempt, type CompetencyRating } from "./history";
import { classifyItem, findStrengthsAndGaps, findingText, type ItemContext } from "./findings";

const level = (ordinal: number) => ({ level_code: `L${ordinal}` });
const COMP = "c0000000-0000-4000-8000-000000000001";
const OTHER = "c0000000-0000-4000-8000-000000000002";
const rating = (r: number | null): CompetencyRating => ({ rating: r, descriptor: null, low: r, high: r, rated: r === null ? 0 : 1, unjudged: 0, unanswered: 0, criteria: 1 });
const attempt = (id: string, at: string, r: number | null): Attempt => ({ instanceId: id, submittedAt: at, instrumentCode: "CHK", instrumentName: "Check", rating: rating(r) });

describe("a competency's self rating in one instance", () => {
  const competencyOf = new Map([[RA.k1, COMP], [RA.k2, COMP], [RA.cs1, COMP], [RA.cs2, COMP], [RA.ap1, OTHER]]);
  it("is the lower median of the rated criteria, never an average, with the lowest and highest beside it", () => {
    const r: Responses = { [RA.k1]: level(2), [RA.k2]: level(3), [RA.cs1]: level(4), [RA.cs2]: level(6), [RA.ap1]: level(1) };
    const out = ratingsByCompetency(RESP_ASSESS, r, competencyOf);
    expect(out.get(COMP)).toMatchObject({ rating: 3, low: 2, high: 6, rated: 4, unjudged: 0, unanswered: 0, criteria: 4 });
    expect(out.get(COMP)?.descriptor).toBe("3 Advanced beginner");
    expect(out.get(OTHER)?.rating).toBe(1);
  });
  it("counts unable to judge and not answered apart and never as zero", () => {
    const r: Responses = { [RA.k1]: level(5), [RA.k2]: { state: "unable_to_demonstrate" }, [RA.cs1]: { state: "not_observed" } };
    const c = ratingsByCompetency(RESP_ASSESS, r, competencyOf).get(COMP)!;
    expect(c.rating).toBe(5);
    expect(c).toMatchObject({ rated: 1, unjudged: 1, unanswered: 1, criteria: 4 });
  });
  it("has no rating when no criterion was rated, and ignores items that map to no competency", () => {
    expect(ratingsByCompetency(RESP_ASSESS, {}, competencyOf).get(COMP)).toMatchObject({ rating: null, descriptor: null, rated: 0, unanswered: 4 });
    expect(ratingsByCompetency(RESP_ASSESS, { [RA.k1]: level(4) }, new Map()).size).toBe(0);
  });
  it("lowerMedian takes the lower middle value of an even count", () => {
    expect(lowerMedian([])).toBeNull();
    expect(lowerMedian([5])).toBe(5);
    expect(lowerMedian([6, 2, 4, 3])).toBe(3);
    expect(lowerMedian([1, 9, 5])).toBe(5);
  });
});

describe("self ratings over time", () => {
  it("is empty with no attempt", () => {
    expect(buildHistory([])).toMatchObject({ latest: null, previous: null, delta: null, trend: "none", attempts: [] });
  });
  it("orders attempts by submitted_at, takes the latest and previous, and the delta between them", () => {
    const h = buildHistory([attempt("c", "2026-11-03T09:00:00Z", 4), attempt("a", "2026-10-01T09:00:00Z", 2), attempt("b", "2026-10-20T09:00:00Z", 3)]);
    expect(h.attempts.map(a => a.instanceId)).toEqual(["a", "b", "c"]);
    expect(h.latest?.instanceId).toBe("c");
    expect(h.previous?.instanceId).toBe("b");
    expect(h.delta).toBe(1);
    expect(h.trend).toBe("up");
  });
  it("says down, same and first", () => {
    expect(buildHistory([attempt("a", "2026-10-01T00:00:00Z", 4), attempt("b", "2026-10-02T00:00:00Z", 2)])).toMatchObject({ delta: -2, trend: "down" });
    expect(buildHistory([attempt("a", "2026-10-01T00:00:00Z", 4), attempt("b", "2026-10-02T00:00:00Z", 4)])).toMatchObject({ delta: 0, trend: "same" });
    expect(buildHistory([attempt("a", "2026-10-01T00:00:00Z", 4)])).toMatchObject({ delta: null, trend: "first" });
  });
  it("gives no delta when either attempt rated nothing", () => {
    expect(buildHistory([attempt("a", "2026-10-01T00:00:00Z", null), attempt("b", "2026-10-02T00:00:00Z", 4)])).toMatchObject({ delta: null, trend: "first" });
  });
  it("words the delta", () => {
    expect([deltaText(2), deltaText(-1), deltaText(0), deltaText(null)]).toEqual(["+2", "-1", "no change", null]);
  });
});

describe("strengths and gaps against the expected level", () => {
  const item = (key: string) => RESP_ASSESS.items.find(i => i.stable_key === key)!;
  const ctx = (expected: number | null): ItemContext => ({ competencyId: COMP, expected });
  it("is a strength at or above the expected level and a gap below it", () => {
    expect(classifyItem(item(RA.k1), { [RA.k1]: level(4) }, ctx(4))?.kind).toBe("met");
    expect(classifyItem(item(RA.k1), { [RA.k1]: level(5) }, ctx(4))?.kind).toBe("met");
    const low = classifyItem(item(RA.k1), { [RA.k1]: level(3) }, ctx(4))!;
    expect(low).toMatchObject({ kind: "below_expected", ordinal: 3, expected: 4, label: "Below the expected level" });
  });
  it("says unable to demonstrate and not answered as themselves, never as a zero", () => {
    expect(classifyItem(item(RA.k1), { [RA.k1]: { state: "unable_to_demonstrate" } }, ctx(4))?.kind).toBe("unable_to_demonstrate");
    expect(classifyItem(item(RA.k1), { [RA.k1]: { state: "unable_to_determine" } }, ctx(4))).toMatchObject({ kind: "unable_to_judge", label: "Unable to judge", ordinal: null });
    expect(classifyItem(item(RA.k1), {}, ctx(4))).toMatchObject({ kind: "not_answered", label: "Not answered" });
    expect(classifyItem(item(RA.k1), { [RA.k1]: { state: "not_assessed" } }, ctx(4))?.kind).toBe("not_answered");
  });
  it("says nothing about not observed and not applicable", () => {
    expect(classifyItem(item(RA.k1), { [RA.k1]: { state: "not_observed" } }, ctx(4))).toBeNull();
    expect(classifyItem(item(RA.k1), { [RA.k1]: { state: "not_applicable" } }, ctx(4))).toBeNull();
  });
  it("uses the scale's own pass or fail meaning when the programme expects no level", () => {
    expect(classifyItem(item(RA.k1), { [RA.k1]: level(3) }, ctx(null))?.kind).toBe("met");
    expect(classifyItem(item(RA.k1), { [RA.k1]: level(2) }, ctx(null))?.kind).toBe("not_satisfactory");
  });
  it("splits a whole instance and words each finding", () => {
    const r: Responses = { [RA.k1]: level(5), [RA.k2]: level(2), [RA.cs1]: { state: "unable_to_determine" } };
    const contexts = new Map([[RA.k1, ctx(4)], [RA.k2, ctx(4)], [RA.cs1, ctx(4)], [RA.cs2, ctx(4)], [RA.ap1, ctx(4)]]);
    const { strengths, gaps } = findStrengthsAndGaps(RESP_ASSESS, r, contexts);
    expect(strengths.map(f => f.code)).toEqual(["RA-K-01"]);
    expect(gaps.map(f => f.kind)).toEqual(["below_expected", "unable_to_judge", "not_answered", "not_answered"]);
    expect(findingText(gaps[0])).toBe("RA-K-02 Prompt RA-K-02: Below the expected level (you rated 2, expected 4)");
  });
});
