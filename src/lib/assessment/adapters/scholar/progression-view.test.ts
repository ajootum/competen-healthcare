import { describe, expect, it } from "vitest";
import type { StageScale } from "../../core";
import { buildStageView, latestPerRuleSet, outstandingList, outstandingText, stageLabel, summaryLine, viewsForCompetency, type DecisionRow, type RuleSetFact } from "./progression-view";
import { entriesForReport, mappedCompetencyId, type StageEntry } from "./progression-read";
import { buildOverview, type OverviewCompetency } from "./competency-overview-model";
import { EVIDENCE_SUPPORTED_NOTE } from "./vocab";

const SCALE: StageScale = {
  stages: [{ code: "novice", label: "Novice", ordinal: 1 }, { code: "advanced_beginner", label: "Advanced Beginner", ordinal: 2 }, { code: "competent", label: "Competent", ordinal: 3 }],
  bands: [],
};
const COMP = "c0000000-0000-4000-8000-000000000001";
const INSTR = "a0000000-0000-4000-8000-000000000001";
const SET: RuleSetFact = { ruleSetId: "s1", code: "RA-PROG", name: "RA progression", targetKind: "instrument", targetRef: INSTR, stageScaleVersionId: null };
const OUT = [
  { kind: "rule", stage: "competent", text: "distinct assessors >= 2 (now 1)" },
  { kind: "rule", stage: "competent", text: "not any critical failure in 180 days" },
];
const dec = (o: Partial<DecisionRow> = {}): DecisionRow => ({ id: "d1", ruleVersionId: "rv1", state: "staged", stageCode: "advanced_beginner", targetStageCode: "competent", outstanding: OUT, validUntil: null, computedAt: "2026-11-01T10:00:00Z", ...o });

describe("the evidence-supported stage wording", () => {
  it("a staged decision names the stage and target by their labels and lists what is outstanding", () => {
    const v = buildStageView(dec(), SET, SCALE);
    expect(v.summary).toBe("Evidence-supported stage: Advanced Beginner (from assessor-led assessments) · Target: Competent · Outstanding: distinct assessors >= 2 (now 1); no critical failure in the last 180 days");
    expect(v.note).toBe(EVIDENCE_SUPPORTED_NOTE);
    expect(v.summary).not.toContain("advanced_beginner");
  });
  it("unassessed says there is no assessor-led evidence and nothing else", () => {
    const v = buildStageView(dec({ state: "unassessed", stageCode: null, targetStageCode: "competent", outstanding: [{ kind: "no_evidence", text: "No qualifying evidence" }] }), SET, SCALE);
    expect(v.summary).toBe("No assessor-led evidence yet");
    expect(v.stageLabel).toBeNull();
    expect(v.outstanding).toEqual([]);
  });
  it("not staged says so, with the target and the outstanding requirements", () => {
    const v = buildStageView(dec({ state: "not_staged", stageCode: null }), SET, SCALE);
    expect(v.summary.startsWith("Not staged yet · Target: Competent · Outstanding: ")).toBe(true);
    expect(v.stageLabel).toBeNull();
  });
  it("a staged decision with nothing outstanding omits the outstanding part", () => {
    expect(summaryLine({ state: "staged", stageLabel: "Competent", targetLabel: "Competent", outstanding: [] })).toBe("Evidence-supported stage: Competent (from assessor-led assessments) · Target: Competent");
  });
  it("never shows a code: a stage the scale cannot name is humanised, and an unreadable scale still gives words", () => {
    expect(stageLabel(null, "advanced_beginner")).toBe("Advanced Beginner");
    expect(stageLabel(SCALE, null)).toBeNull();
    expect(buildStageView(dec(), SET, null).summary).toContain("Advanced Beginner");
  });
  it("outstanding sentences use stage labels and words for filters, never the stored JSON", () => {
    const t = outstandingText('records matching {"attestation":"assessor_evaluated","outcomeClass":"positive","minLevelStage":{"group":"clinical_skills","atLeast":"competent"}} >= 3 (now 1)', SCALE);
    expect(t).toBe("assessor-led, positive outcome, lowest rating in clinical skills at Competent or above records >= 3 (now 1)");
    expect(t).not.toMatch(/[{}"]/);
    expect(outstandingText("records matching {broken} >= 3 (now 1)", SCALE)).toBe("qualifying records >= 3 (now 1)");
    expect(outstandingText("Stage competent: only one assessment.", SCALE)).toBe("Stage Competent: only one assessment");
    expect(outstandingText("No rule describes stage competent.", SCALE)).toBe("No rule describes the stage Competent");
    expect(outstandingText("latest outcomeClass is positive (now negative)", SCALE)).toBe("latest outcome class is positive (now negative)");
  });
  it("tolerates a malformed outstanding column", () => {
    expect(outstandingList(null, SCALE)).toEqual([]);
    expect(outstandingList({}, SCALE)).toEqual([]);
    expect(outstandingList(["plain", 5, { text: "  " }, { text: "ok" }], SCALE)).toEqual(["plain", "ok"]);
  });
  it("marks a decision stale once its evidence window has passed", () => {
    expect(buildStageView(dec({ validUntil: "2026-11-02T00:00:00Z" }), SET, SCALE, new Date("2026-11-03T00:00:00Z")).stale).toBe(true);
    expect(buildStageView(dec({ validUntil: "2026-12-02T00:00:00Z" }), SET, SCALE, new Date("2026-11-03T00:00:00Z")).stale).toBe(false);
    expect(buildStageView(dec(), SET, SCALE).stale).toBe(false);
  });
});

describe("the latest decision per rule set", () => {
  const ruleSetOf = new Map([["rv1", "s1"], ["rv2", "s1"], ["rv3", "s2"]]);
  it("keeps the newest computed_at for each rule set, across rule versions of the same set", () => {
    const rows = [dec({ id: "a", ruleVersionId: "rv1", computedAt: "2026-10-01T00:00:00Z" }), dec({ id: "b", ruleVersionId: "rv2", computedAt: "2026-11-01T00:00:00Z" }), dec({ id: "c", ruleVersionId: "rv3", computedAt: "2026-09-01T00:00:00Z" })];
    const out = latestPerRuleSet(rows, ruleSetOf);
    expect([...out.keys()].sort()).toEqual(["s1", "s2"]);
    expect(out.get("s1")?.id).toBe("b");
    expect(out.get("s2")?.id).toBe("c");
  });
  it("ignores a decision whose rule version is unknown", () => {
    expect(latestPerRuleSet([dec({ ruleVersionId: "zz" })], ruleSetOf).size).toBe(0);
  });
});

describe("which competencies a decision speaks about", () => {
  const entry = (instrumentId: string | null, competencyIds: string[]): StageEntry => ({ view: buildStageView(dec(), SET, SCALE), competencyIds, instrumentId });
  it("viewsForCompetency returns only the views whose rule set reaches the competency", () => {
    const v = buildStageView(dec(), SET, SCALE);
    expect(viewsForCompetency([{ view: v, competencyIds: [COMP] }], COMP)).toHaveLength(1);
    expect(viewsForCompetency([{ view: v, competencyIds: [COMP] }], "other")).toEqual([]);
  });
  it("a competency or criterion mapping resolves to its competency; anything else to none", () => {
    const skill = "b0000000-0000-4000-8000-000000000009";
    expect(mappedCompetencyId({ kind: "competency", ref_id: COMP, ref_snapshot: null }, new Map())).toBe(COMP);
    expect(mappedCompetencyId({ kind: "competency_criterion", ref_id: skill, ref_snapshot: { competency_id: COMP } }, new Map())).toBe(COMP);
    expect(mappedCompetencyId({ kind: "competency_criterion", ref_id: skill, ref_snapshot: {} }, new Map([[skill, COMP]]))).toBe(COMP);
    expect(mappedCompetencyId({ kind: "other", ref_id: COMP, ref_snapshot: null }, new Map())).toBeNull();
    expect(mappedCompetencyId({ kind: "competency", ref_id: "nope", ref_snapshot: null }, new Map())).toBeNull();
  });
  it("a report gets the decisions on its checklist or on a competency it assesses", () => {
    expect(entriesForReport([entry(INSTR, [])], INSTR, [])).toHaveLength(1);
    expect(entriesForReport([entry(null, [COMP])], INSTR, [COMP])).toHaveLength(1);
    expect(entriesForReport([entry(null, [COMP])], INSTR, ["x"])).toHaveLength(0);
  });
});

describe("the Overview row", () => {
  const c: OverviewCompetency = { id: COMP, code: "C1", title: "Assessing", domain: "D", expected: null, contentStatus: "approved" };
  const base = { attempts: new Map(), progress: new Map(), activity: null, verifications: [], startable: new Map(), findings: new Map(), scaleMax: 6 };
  it("carries the stage beside, not inside, the verification line, and makes the row active", () => {
    const v = buildStageView(dec(), SET, SCALE);
    const { rows } = buildOverview({ ...base, competencies: [c], stages: [{ view: v, competencyIds: [COMP] }] });
    expect(rows[0].stages).toHaveLength(1);
    expect(rows[0].active).toBe(true);
    expect(rows[0].verification.line).toBe("Verified competency: Not yet verified");
    expect(rows[0].self).toBeNull();
  });
  it("shows no stage when there is none, and the row is not made active by it", () => {
    const { rows } = buildOverview({ ...base, competencies: [c] });
    expect(rows[0].stages).toEqual([]);
    expect(rows[0].active).toBe(false);
  });
});
