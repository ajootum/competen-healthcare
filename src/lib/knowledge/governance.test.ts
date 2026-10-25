import { describe, expect, it } from "vitest";
import { COHORT_FLOOR, DEFAULT_CKRI_POLICY, PERMISSIONS, dbRefusal, participationNotice, resolveCkriPolicy, shapeChoices } from "./governance";
import { ELIGIBLE_FIELDS, FORBIDDEN_COLUMNS, MEASURES } from "./data-contracts";

describe("CKRI policy (CONFIG-002)", () => {
  it("defaults compute nothing and show educators nothing", () => {
    expect(Object.values(DEFAULT_CKRI_POLICY.measures).every(v => v === false)).toBe(true);
    expect(DEFAULT_CKRI_POLICY.educatorMeasures).toEqual([]);
    expect(DEFAULT_CKRI_POLICY.cohortDimensions).toEqual(["programme"]);
  });
  it("never lowers the cohort below the floor", () => {
    expect(resolveCkriPolicy({ minCohort: 1 }).minCohort).toBe(COHORT_FLOOR);
    expect(resolveCkriPolicy({ minCohort: 25 }).minCohort).toBe(25);
    expect(resolveCkriPolicy({ minCohort: "x" }).minCohort).toBe(DEFAULT_CKRI_POLICY.minCohort);
  });
  it("cannot switch on a measure whose source is pending", () => {
    const p = resolveCkriPolicy({ measures: { evaluation_performance: true, knowledge_gap: true } });
    expect(p.measures.evaluation_performance).toBe(false);
    expect(p.measures.knowledge_gap).toBe(true);
  });
  it("shows educators only computed measures, and only known cohort dimensions", () => {
    const p = resolveCkriPolicy({ measures: { knowledge_gap: true }, educatorMeasures: ["knowledge_gap", "retention", "made_up"], cohortDimensions: ["programme", "email", "institution"] });
    expect(p.educatorMeasures).toEqual(["knowledge_gap"]);
    expect(p.cohortDimensions).toEqual(["programme", "institution"]);
  });
  it("clamps rounding and retention", () => {
    expect(resolveCkriPolicy({ roundTo: 3 }).roundTo).toBe(5);
    expect(resolveCkriPolicy({ snapshotRetentionDays: 5 }).snapshotRetentionDays).toBe(30);
  });
});

describe("the four permissions", () => {
  it("are four separate records, two of them CKRI's", () => {
    expect(PERMISSIONS.map(p => p.code)).toEqual(["personal_ai_learning", "collective_analytics", "content_contribution", "research_study"]);
    expect(new Set(PERMISSIONS.map(p => p.record)).size).toBe(3);
    expect(PERMISSIONS.filter(p => p.owner === "ckri").map(p => p.code)).toEqual(["collective_analytics", "research_study"]);
  });
  it("shapes each choice from its own record, and a study per project", () => {
    const c = shapeChoices({
      consent: { status: "granted", notice_version: "v3", granted_at: "t1" },
      analytics: { status: "withdrawn", notice_version: "n1", withdrawn_at: "t2" },
      candidacy: null,
      studies: [{ project_id: "p1", status: "granted", notice_version: "n1", granted_at: "t3" }],
      projects: [{ id: "p1", code: "a", title: "A", status: "recruiting" }, { id: "p2", code: "b", title: "B", status: "recruiting" }, { id: "p3", code: "c", title: "C", status: "closed" }],
    });
    expect(c.personal_ai_learning.state).toBe("granted");
    expect(c.collective_analytics.state).toBe("withdrawn");
    expect(c.content_contribution.state).toBe("unavailable");
    expect(c.research_studies.map(s => [s.code, s.choice.state])).toEqual([["a", "granted"], ["b", "not_chosen"]]);
  });
});

describe("participation notice", () => {
  it("needs a version AND an https URL", () => {
    expect(participationNotice({})).toBeNull();
    expect(participationNotice({ CKRI_PARTICIPATION_NOTICE_VERSION: "ckri-notice/1" })).toBeNull();
    expect(participationNotice({ CKRI_PARTICIPATION_NOTICE_VERSION: "ckri-notice/1", CKRI_PARTICIPATION_NOTICE_URL: "http://x" })).toBeNull();
    expect(participationNotice({ CKRI_PARTICIPATION_NOTICE_VERSION: "ckri-notice/1", CKRI_PARTICIPATION_NOTICE_URL: "https://example.org/n" })).toEqual({ version: "ckri-notice/1", url: "https://example.org/n" });
  });
});

describe("data contracts", () => {
  it("no eligible field is a forbidden column", () => {
    for (const f of ELIGIBLE_FIELDS) expect(FORBIDDEN_COLUMNS as readonly string[]).not.toContain(f.column);
  });
  it("every measure names only catalogue fields", () => {
    const codes = new Set(ELIGIBLE_FIELDS.map(f => f.code));
    for (const m of MEASURES) for (const f of m.fields) expect(codes.has(f)).toBe(true);
  });
  it("every measure states its limits", () => {
    for (const m of MEASURES) expect(m.limits.length).toBeGreaterThan(20);
  });
});

describe("database refusals", () => {
  it("return the sentence, never the SQL", () => {
    expect(dbRefusal({ message: "ckri_research_project: not independent. The proposer cannot decide their own project" }, "x")).toBe("not independent. The proposer cannot decide their own project");
    expect(dbRefusal({ message: "duplicate key value violates unique constraint" }, "fallback")).toBe("fallback");
  });
});
