import { describe, expect, it } from "vitest";
import { activitySummary, enoughForTrend, listSummary, measureGroups, noMeasureLine, practisedDetail, withoutEngagementInsight } from "./progress-simplify";

// My Plan correction (CE-03): what Progress says once, and how loudly.

describe("one learning-activity summary", () => {
  const eng = { windowDays: 28, studyDays: 5, answers: 12, reviews: 4, decisions: 2, checks: 1, lastStudied: "2026-11-01T10:00:00Z" };
  it("joins the workspace's engagement with Learning Intelligence's active weeks", () => {
    const a = activitySummary(eng, { activeWeeks: 3, weeks: 4 });
    expect(a).toMatchObject({ studyDays: 5, activeWeeks: 3, weeks: 4 });
    expect(a.line).toBe("5 study days in the last 28 · 3 of the last 4 weeks active · 12 answers · 4 reviews · 2 case decisions · 1 Teach Me check");
  });
  it("leaves out what is not recorded, and says 1 study day in the singular", () => {
    const a = activitySummary({ ...eng, studyDays: 1, answers: 1, reviews: null, decisions: 0, checks: null }, null);
    expect(a.activeWeeks).toBeNull();
    expect(a.line).toBe("1 study day in the last 28 · 1 answer");
  });
});

describe("one line for what is not measured", () => {
  const m = (id: string, state: string) => ({ id, title: id, state });
  it("draws a card for each measured one and one line for the rest", () => {
    const g = measureGroups([m("coverage", "measured"), m("understanding", "not_measured"), m("retention", "insufficient")]);
    expect(g.measured).toEqual(["coverage"]);
    expect(g.none).toBe(false);
    expect(g.line).toBe("Not measured yet: understanding and retention. They appear once there is enough practice to say.");
  });
  it("is ONE empty state when nothing is measured", () => {
    const g = measureGroups([m("a", "not_measured"), m("b", "insufficient")]);
    expect(g).toMatchObject({ measured: [], none: true, line: null });
    expect(noMeasureLine("knowledge")).toMatch(/Nothing is measured yet for knowledge/);
  });
  it("says nothing when everything is measured", () => {
    expect(measureGroups([m("a", "measured")])).toMatchObject({ none: false, line: null, notMeasured: [] });
  });
});

describe("a trend needs three weeks with data", () => {
  it("is drawn with three or more weeks that hold data, not before", () => {
    expect(enoughForTrend([0, 0, 4, 0, 2, 0, 0, 0])).toBe(false);
    expect(enoughForTrend([0, 1, 4, 0, 2, 0, 0, 0])).toBe(true);
    expect(enoughForTrend([])).toBe(false);
  });
});

describe("summary lines of folded lists", () => {
  it("says how many, and how many practised", () => {
    expect(listSummary({ one: "topic" }, 12, practisedDetail(3, 12))).toBe("12 topics · 3 of 12 practised");
    expect(listSummary({ one: "competency", many: "competencies" }, 1)).toBe("1 competency");
    expect(listSummary({ one: "material" }, 0, practisedDetail(0, 0))).toBe("0 materials");
  });
});

describe("Learning Intelligence's engagement sentence", () => {
  it("is dropped from its list, the learning-activity block says it", () => {
    expect(withoutEngagementInsight([
      "You studied on 5 of the last 28 days, and were active in 3 of the last 4 weeks.", "You have not studied in the last 28 days.", "Your recall is strong.",
    ])).toEqual(["Your recall is strong."]);
  });
});
