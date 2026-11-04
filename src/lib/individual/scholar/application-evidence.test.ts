import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APPLICATION_SKILLS, DRAFT_MAPPING_LABEL, applicationBySkill, caseRecord, competencyThreeViews, decisionOutcome, linksFromProvenance, mappingLine,
  osceRecord, outcomeWord, questionRecord, skillOfDecision, type CompetencyLink, type EvidenceRecord, type VerificationInput,
} from "./application-evidence";
import { buildLearningState } from "./learning-state";

// SALE-2026-11 R4 (SALE-13 / SALE-14).

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const pub = (id = C1): CompetencyLink => ({ competencyId: id, frameworkId: "f1", frameworkVersion: "1.0.0", mappingStatus: "published", objective: "Recognise sepsis", recorded: true });
const draft = (id = C2): CompetencyLink => ({ competencyId: id, frameworkId: "f2", frameworkVersion: "0.3.0", mappingStatus: "draft", objective: null, recorded: true });

const aCase = (over: Partial<Parameters<typeof caseRecord>[0]> = {}) => caseRecord({
  snapshotId: "s1", caseRef: "own:case-1", title: "Breathless after surgery", completedAt: "2026-11-01T10:00:00Z", materialId: "m1",
  decisions: [
    { id: "d1", dimension: "interpretation", marking: "deterministic", correct: true, score: null, safety: [] },
    { id: "d2", dimension: "prioritisation", marking: "deterministic", correct: false, score: null, safety: [] },
    { id: "d3", kind: "handover", marking: "deterministic", correct: null, score: 0.8, safety: [] },
    { id: "d4", dimension: "escalation", marking: "deterministic", correct: true, score: null, safety: ["sc1"] },
    { id: "d5", marking: "ai_evaluation", correct: null, score: 0.5, safety: [] },
  ],
  competencies: [pub()],
  ...over,
});

describe("SALE-13 skills come from what the case author declared", () => {
  it("maps a decision's dimension, a handover, and a decision with no dimension", () => {
    expect(skillOfDecision({ kind: "handover", dimension: "decision" })).toBe("handover");
    expect(skillOfDecision({ dimension: "prioritisation" })).toBe("prioritisation");
    expect(skillOfDecision({ dimension: "interpretation" })).toBe("interpretation");
    expect(skillOfDecision({ dimension: "reassessment" })).toBe("evolving");
    expect(skillOfDecision({ dimension: "recognition" })).toBe("deterioration");
    expect(skillOfDecision({ dimension: "escalation" })).toBe("deterioration");
    expect(skillOfDecision({ dimension: "something-else" })).toBe("reasoning");
    expect(skillOfDecision({})).toBe("reasoning");
  });
  it("a broken safety criterion makes the decision not yet, whatever else; unmarked stays unmarked", () => {
    expect(decisionOutcome({ correct: true, score: 1, safety: ["x"], marking: "deterministic" })).toBe(0);
    expect(decisionOutcome({ correct: null, score: null, marking: "unmarked" })).toBeNull();
    expect(decisionOutcome({ correct: null, score: 0.4 })).toBe(0.4);
    expect(decisionOutcome({ correct: true, score: null })).toBe(1);
  });
  it("one completed case becomes one record split by skill, with its competency link kept", () => {
    const r = aCase();
    expect(r.source).toBe("case");
    expect(r.activityId).toBe("own:case-1");
    expect(Object.fromEntries(r.skills.map(s => [s.skill, s.outcome]))).toEqual({ reasoning: 0.5, prioritisation: 0, interpretation: 1, handover: 0.8, deterioration: 0 });
    expect(r.safetyBroken).toBe(1);
    // weakest marking among marked decisions: AI-evaluated
    expect(r.marking).toBe("ai_evaluation");
    expect(r.competencies).toEqual([pub()]);
  });
  it("an 810 correction replaces a decision's result (latest wins), and escalation windows count as deterioration", () => {
    const r = aCase({
      corrections: [{ decisionPointId: "d2", correctedOutcome: "partial", correctedScore: 0.5 }, { decisionPointId: "d2", correctedOutcome: "correct", correctedScore: null }],
      escalations: [{ score: 1, recognised: true, timeliness: "on_time" }, { score: null, recognised: false, timeliness: "pending" }],
    });
    const s = Object.fromEntries(r.skills.map(x => [x.skill, x.outcome]));
    expect(s.prioritisation).toBe(1);
    expect(s.deterioration).toBe(0.5); // d4 (safety broken: 0) and the on-time window (1); the pending window is unmarked
  });
  it("an OSCE run is practical simulation; a question has no skill", () => {
    const o = osceRecord({ attemptId: "a1", stationId: "st1", title: "Bed bath", finishedAt: "2026-11-02T00:00:00Z", score: 0.9, marking: "self_graded", materialId: "m1", chunkId: null, competencies: [] });
    expect(o.skills).toEqual([{ skill: "practical", outcome: 0.9 }]);
    expect(o.marking).toBe("self");
    const q = questionRecord({ attemptId: "q1", questionId: "qq", stem: "What is the first step?", assessedAt: "2026-11-03T00:00:00Z", outcome: "correct", score: 1, marking: "deterministic", competencies: [pub()] });
    expect(q.skills).toEqual([]);
    expect(q.outcome).toBe(1);
    expect(questionRecord({ attemptId: "q2", questionId: "qq", stem: null, assessedAt: "x", outcome: "unmarked", score: null, marking: "unmarked", competencies: [] }).outcome).toBeNull();
  });
});

describe("SALE-13 words by skill: one activity is never enough", () => {
  it("the same case done well twice is one activity, so the word stays not enough evidence", () => {
    const one = aCase({ snapshotId: "s1", completedAt: "2026-11-01T00:00:00Z" });
    const again = aCase({ snapshotId: "s2", completedAt: "2026-11-02T00:00:00Z" });
    const interp = applicationBySkill([one, again]).find(s => s.skill === "interpretation")!;
    expect(interp.activities).toBe(1);
    expect(interp.word).toBe("thin");
  });
  it("two different cases done well give some evidence; never a percentage", () => {
    const a = aCase({ snapshotId: "s1", caseRef: "own:a" });
    const b = aCase({ snapshotId: "s2", caseRef: "own:b", decisions: [{ id: "x", dimension: "interpretation", marking: "deterministic", correct: true, score: null }] });
    const interp = applicationBySkill([a, b]).find(s => s.skill === "interpretation")!;
    expect(interp.word).toBe("some");
    expect(interp.summary).not.toMatch(/%/);
    expect(applicationBySkill([a, b]).map(s => s.skill).every(s => (APPLICATION_SKILLS as readonly string[]).includes(s))).toBe(true);
  });
  it("question records never appear as application skills", () => {
    const q = questionRecord({ attemptId: "q1", questionId: "qq", stem: "s", assessedAt: "2026-11-03T00:00:00Z", outcome: "correct", score: 1, marking: "deterministic", competencies: [pub()] });
    expect(applicationBySkill([q])).toEqual([]);
  });
  it("a case made from a material counts towards Applying it in the learning state (R1 dimension A1)", () => {
    const state = buildLearningState({
      topics: [{ key: "t", label: "T", materialId: "m1", chunkIds: [] }],
      evidence: [{ itemId: "own:a", attemptId: null, topicKey: "t", chunkId: null, materialId: "m1", source: "case", level: "application", outcome: 1, marking: "code", at: "2026-11-01T00:00:00Z", confidence: null, misconceptions: [] }],
      exposure: [], now: "2026-11-04T00:00:00Z",
    })[0];
    const app = state.dimensions.find(d => d.key === "application")!;
    expect(app.word).toBe("thin");
    expect(app.summary).toMatch(/1 application or reasoning task done well/);
  });
});

describe("SALE-14 provenance: draft is never validated", () => {
  it("reads 990/991 provenance as kept, and says what was not recorded", () => {
    const l = linksFromProvenance([{ id: C1, framework_id: "f1", framework_version: "1.0.0", mapping_status: "published", objective: " o " }, { id: C2, framework_version: null, mapping_status: "weird" }], true);
    expect(l[0]).toMatchObject({ mappingStatus: "published", objective: "o", recorded: true });
    expect(l[1]).toMatchObject({ mappingStatus: null, frameworkVersion: null });
    expect(mappingLine(l[1])).toBe("framework version not recorded (publication status not recorded)");
  });
  it("a draft mapping says so every time; a link read now says it was not recorded then", () => {
    expect(mappingLine(draft())).toContain(DRAFT_MAPPING_LABEL.toLowerCase());
    expect(mappingLine(draft())).toContain("not validated competency evidence");
    expect(mappingLine({ ...pub(), recorded: false })).toMatch(/as it is now .*not recorded when this was done/);
  });
});

const notYet: VerificationInput = { state: "not_yet", line: "Verified competency: Not yet verified", detail: null };
const perfect = (n: number, link: CompetencyLink): EvidenceRecord[] => Array.from({ length: n }, (_, i) =>
  questionRecord({ attemptId: `a${i}`, questionId: `q${i}`, stem: `Q${i}`, assessedAt: `2026-10-${String(10 + i).padStart(2, "0")}T00:00:00Z`, outcome: "correct", score: 1, marking: "deterministic", competencies: [link] }));

describe("SALE-14 three separate views", () => {
  const competencies = [{ id: C1, code: "NUR-1", title: "Assessment" }, { id: C2, code: null, title: "Escalation" }];
  it("each view comes from its own source only", () => {
    const v = competencyThreeViews({
      competencies, self: new Map([[C1, { rating: 4, descriptor: "Competent" }]]), scaleMax: 6,
      records: [...perfect(3, pub()), ...perfect(2, draft())], verification: () => notYet,
    });
    const [a, b] = v;
    expect(a.self).toMatchObject({ state: "rated" });
    expect(a.self.line).toMatch(/You rated yourself 4 of 6: Competent\. Self-reported, not independently verified\./);
    expect(b.self.state).toBe("none");
    expect(a.learning).toMatchObject({ state: "records", total: 3, published: 3, draft: 0 });
    expect(b.learning).toMatchObject({ state: "records", total: 2, draft: 2 });
    expect(b.learning.line).toMatch(/2 on a draft mapping \(not validated evidence\)/);
    expect(b.learning.records.every(r => r.draft && r.mapping.includes("not validated"))).toBe(true);
    // learning evidence never changes the self rating
    expect(a.self.line).not.toMatch(/evidence/i);
  });

  // ⚠ THE STAGE GUARD (owner rule: formative never equals verified competence; never award a competency or Benner stage from formative scores).
  it("STAGE GUARD: no amount of perfect formative evidence sets verified competence or a stage", () => {
    const records = [...perfect(40, pub()), aCase({ competencies: [pub()] }), osceRecord({ attemptId: "o", stationId: "s", title: "t", finishedAt: "2026-11-02T00:00:00Z", score: 1, marking: "ai_evaluation", materialId: null, chunkId: null, competencies: [pub()] })];
    const v = competencyThreeViews({ competencies, self: new Map([[C1, { rating: 6, descriptor: "Expert" }]]), scaleMax: 6, records, verification: () => notYet })[0];
    expect(v.verified).toEqual(notYet);
    const keys = JSON.stringify(v);
    expect(keys).not.toMatch(/"stage"|benner|novice|proficient|"expert"/i);
    // the verified view is exactly what the verification source said, and nothing else
    const verified: VerificationInput = { state: "verified", line: "Verified competency: Competent", detail: "Issued by X" };
    expect(competencyThreeViews({ competencies, self: new Map(), scaleMax: 6, records: [], verification: id => (id === C2 ? verified : notYet) })[1].verified).toBe(verified);
    expect(competencyThreeViews({ competencies, self: new Map(), scaleMax: 6, records, verification: id => (id === C2 ? verified : notYet) })[0].verified).toBe(notYet);
  });
  it("STAGE GUARD: the R4 modules never import or call anything that writes a stage, a verification, an assessment outcome or the Passport", () => {
    for (const f of ["application-evidence.ts", "application-evidence-data.ts"]) {
      // code only: the comments name what the module must never do
      const src = readFileSync(join(__dirname, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
      expect(src).not.toMatch(/asmt_|progression|stage_decision|passport|verification_decision|recordStage|writeStage/i);
    }
  });
  it("words, never a percentage; outcome words are fixed", () => {
    expect(outcomeWord(1)).toBe("done well");
    expect(outcomeWord(0.5)).toBe("partly");
    expect(outcomeWord(0)).toBe("not yet");
    expect(outcomeWord(null)).toBe("not marked");
  });
});
