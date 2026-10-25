import { describe, expect, it } from "vitest";
import { bandOf, coherentRules, evaluate, VERIFIED_NOT_ASSESSED, type EAttempt, type EDecision, type EvidenceSet, type EvaluationRules, type EQuestion } from "./evaluation";

// COMPETEN-SCHOLAR-EVALUATION-01 (Stage 6) E2-E4: the evaluation rules, pinned by being run.

const NOW = "2026-10-25T12:00:00Z";
const RULES: EvaluationRules = { minEvidence: 3, recencyDays: 90, minSources: 2, bands: { strong: 80, developing: 50 }, evidence: ["teach_checks", "revision", "spaced_review", "clinical_reasoning"] };
const S = (n: number) => ({ chunkId: `k${n}`, materialId: "m1", materialTitle: "Oxygen therapy notes", label: `section ${n}` });
const Q = (id: string, chunk: number, extra: Partial<EQuestion> = {}): EQuestion => ({ id, chunkId: `k${chunk}`, materialId: "m1", kind: "mcq", difficulty: 2, competencyId: null, caseId: null, ...extra });
let n = 0;
const A = (questionId: string, correct: boolean, at = "2026-10-20T10:00:00Z", marking: EAttempt["marking"] = "deterministic", sessionId: string | null = null): EAttempt => ({ id: `a${++n}`, questionId, correct, marking, answeredAt: at, sessionId });
const D = (caseId: string, dp: string, correct: boolean | null, extra: Partial<EDecision> = {}): EDecision => ({
  id: `d${++n}`, caseId, decisionPointId: dp, dimension: "prioritisation", written: false, marking: "deterministic", correct, safetyMissed: 0, createdAt: "2026-10-21T10:00:00Z", chunkIds: ["k1"], competencyIds: [], context: "medical", ...extra,
});
const base = (over: Partial<EvidenceSet> = {}): EvidenceSet => ({ sections: [S(1), S(2), S(3)], questions: [], attempts: [], reviews: [], checks: [], decisions: [], links: [], catalogue: null, ...over });

describe("evaluate: six dimensions, kept apart", () => {
  it("coverage is never knowledge: worked-on sections with no marked answer leave knowledge not measured", () => {
    const e = evaluate(base({ checks: [{ id: "c1", chunkIds: ["k1"], verdict: "understood", createdAt: NOW }] }), RULES, NOW);
    expect(e.coverage).toMatchObject({ state: "measured", sections: { total: 3, worked: 1 } });
    expect(e.knowledge.state).toBe("not_measured");
    expect(e.knowledge.informalChecks.understood).toBe(1);
    expect(e.limitations).toContain("Coverage shows what you have worked on, not what you know.");
  });

  it("one question is one piece of evidence, judged on its latest answer; answering again is repeated exposure", () => {
    const qs = [Q("q1", 1), Q("q2", 2), Q("q3", 3)];
    const e = evaluate(base({ questions: qs, attempts: [A("q1", false, "2026-10-01T10:00:00Z"), A("q1", true, "2026-10-02T10:00:00Z"), A("q1", true, "2026-10-03T10:00:00Z"), A("q2", true), A("q3", false)] }), RULES, NOW);
    expect(e.knowledge).toMatchObject({ state: "measured", independent: 3, correct: 2, percent: 67, band: "developing", repeats: 2 });
  });

  it("AI-evaluated and self-graded answers are shown apart, never counted as independent knowledge", () => {
    const qs = [Q("q1", 1), Q("q2", 2), Q("q3", 3), Q("s1", 1, { kind: "short" }), Q("s2", 2, { kind: "short" })];
    const e = evaluate(base({ questions: qs, attempts: [A("q1", true), A("q2", true), A("q3", true), A("s1", true, undefined, "self_graded"), A("s2", false, undefined, "ai_evaluation")] }), RULES, NOW);
    expect(e.knowledge).toMatchObject({ state: "measured", independent: 3, correct: 3, selfReported: { n: 1, correct: 1 }, aiEvaluated: { n: 1, correct: 0 } });
    expect(e.limitations.some(l => /graded by you/.test(l))).toBe(true);
    expect(e.confidence.deterministicShare).toBeCloseTo(3 / 5);
  });

  it("below the minimum evidence a dimension says insufficient, with what it has and what it needs", () => {
    const e = evaluate(base({ questions: [Q("q1", 1)], attempts: [A("q1", true)] }), RULES, NOW);
    expect(e.knowledge).toMatchObject({ state: "insufficient", have: 1, need: 3 });
    expect(e.confidence.level).toBe("insufficient");
  });

  it("scenario and case-step questions are application, not knowledge", () => {
    const qs = [Q("c1", 1, { kind: "case" }), Q("c2", 2, { caseId: "x" }), Q("c3", 3, { kind: "case" })];
    const e = evaluate(base({ questions: qs, attempts: qs.map(q => A(q.id, true)) }), RULES, NOW);
    expect(e.application).toMatchObject({ state: "measured", independent: 3 });
    expect(e.knowledge.state).toBe("not_measured");
  });
});

describe("retention and clinical reasoning", () => {
  it("retention reads spaced reviews after an interval and questions right again a day or more later", () => {
    const qs = [Q("q1", 1), Q("q2", 2)];
    const e = evaluate(base({
      questions: qs,
      attempts: [A("q1", true, "2026-10-01T10:00:00Z"), A("q1", true, "2026-10-05T10:00:00Z"), A("q2", true, "2026-10-01T10:00:00Z"), A("q2", true, "2026-10-01T11:00:00Z")],
      reviews: [{ id: "r1", questionId: "q1", quality: 4, intervalDays: 6, reviewedAt: NOW }, { id: "r2", questionId: "q2", quality: 1, intervalDays: 1, reviewedAt: NOW }, { id: "r3", questionId: "q2", quality: 5, intervalDays: 0, reviewedAt: NOW }],
    }), RULES, NOW);
    // r3 has no interval, q2's second answer came the same day: neither is a recall.
    expect(e.retention).toMatchObject({ state: "measured", recalls: 3, successful: 2, longestIntervalDays: 6 });
    expect(e.retentionDifficulties).toEqual([{ chunkId: "k2", materialId: "m1", label: "Oxygen therapy notes, section 2", failed: 1 }]);
  });

  it("clinical reasoning counts each decision of each case once, by dimension; written answers and safety stay apart", () => {
    const decisions = [D("c", "d1", false), D("c", "d1", true, { createdAt: "2026-10-22T10:00:00Z" }), D("c", "d2", false, { dimension: "interpretation", safetyMissed: 1 }), D("c", "d3", false, { dimension: "interpretation" }),
      D("c", "d4", null, { written: true, marking: "self_graded" })];
    const e = evaluate(base({ decisions }), RULES, NOW);
    expect(e.reasoning).toMatchObject({ state: "measured", independent: 3, correct: 1, repeats: 1, safetyMissed: 1, written: { aiEvaluated: 0, selfReviewed: 1 } });
    expect(e.reasoningWeaknesses).toEqual([{ dimension: "interpretation", n: 2, correct: 0 }]);
    expect(e.recommendations.some(r => r.kind === "case")).toBe(true);
  });

  it("evidence the policy does not read is not read", () => {
    const e = evaluate(base({ decisions: [D("c", "d1", true), D("c", "d2", true), D("c", "d3", true)] }), { ...RULES, evidence: ["revision"] }, NOW);
    expect(e.reasoning.state).toBe("not_measured");
    expect(e.evidence.decisions).toEqual([]);
  });
});

describe("bands, confidence, areas and the competence boundary", () => {
  it("bands describe, they do not certify; a configuration with developing above strong is made coherent", () => {
    expect(bandOf(80, RULES.bands)).toBe("strong");
    expect(bandOf(79, RULES.bands)).toBe("developing");
    expect(bandOf(10, RULES.bands)).toBe("needs_work");
    expect(coherentRules({ ...RULES, bands: { strong: 60, developing: 90 } }).bands).toEqual({ strong: 60, developing: 59 });
  });

  it("confidence grows with amount, breadth and recency, and says why", () => {
    const qs = Array.from({ length: 12 }, (_, i) => Q(`q${i}`, (i % 3) + 1));
    const strong = evaluate(base({ sections: [S(1), S(2), S(3), S(4)], questions: [...qs, Q("x", 4)], attempts: [...qs.map(q => A(q.id, true)), A("x", true)] }), RULES, NOW);
    expect(strong.confidence.level).toBe("strong");
    const dated = evaluate(base({ questions: qs, attempts: qs.map(q => A(q.id, true, "2025-01-01T10:00:00Z")) }), RULES, NOW);
    expect(dated.confidence.level).toBe("moderate");
    expect(dated.limitations.some(l => /older than 90 days/.test(l))).toBe(true);
  });

  it("judges at the most specific level the evidence supports: the learning outcome where a section names one", () => {
    const qs = [Q("q1", 1, { competencyId: "C" }), Q("q2", 1, { competencyId: "C" }), Q("q3", 2, { competencyId: "C" }), Q("q4", 2, { competencyId: "C" })];
    const e = evaluate(base({
      questions: qs, attempts: [A("q1", true), A("q2", true), A("q3", false), A("q4", false)],
      links: [{ chunkId: "k1", competencyId: "C", outcome: "Administer oxygen to a target range" }, { chunkId: "k2", competencyId: "C", outcome: "Escalate worsening hypoxaemia" }],
      catalogue: [{ id: "C", title: "Oxygen therapy", code: "CF-1", domain: "Respiratory care", practice: "Medicines", cpu: "CPU 3", outcomes: [], expectedLevel: { score: 2, label: "Foundation" } }],
    }), RULES, NOW);
    expect(e.strengths.map(a => [a.kind, a.label])).toEqual([["outcome", "Administer oxygen to a target range"]]);
    expect(e.gaps.map(a => [a.kind, a.label, a.expected])).toEqual([["outcome", "Escalate worsening hypoxaemia", "Foundation"]]);
    expect(e.cfca?.[0]).toMatchObject({ domain: "Respiratory care", units: [{ name: "Medicines › CPU 3" }] });
    expect(e.recommendations.slice(0, 2).map(r => [r.kind, r.chunkId])).toEqual([["teach", "k2"], ["revise", "k2"]]);
    expect(e.recommendations.find(r => r.label.startsWith("Start on"))?.chunkId).toBe("k3");
  });

  it("with no catalogue it judges by section, and says so", () => {
    const qs = [Q("q1", 1), Q("q2", 1), Q("q3", 2), Q("q4", 2)];
    const e = evaluate(base({ questions: qs, attempts: [A("q1", true), A("q2", true), A("q3", false), A("q4", false)] }), RULES, NOW);
    expect(e.strengths.map(a => a.kind)).toEqual(["section"]);
    expect(e.cfca).toBeNull();
    expect(e.limitations.some(l => /No competency catalogue/.test(l))).toBe(true);
  });

  it("verified clinical competence is never assessed here, whatever the evidence", () => {
    const qs = Array.from({ length: 20 }, (_, i) => Q(`q${i}`, (i % 3) + 1));
    const e = evaluate(base({ questions: qs, attempts: qs.map(q => A(q.id, true)) }), RULES, NOW);
    expect(e.verified).toEqual({ state: "not_assessed", reason: VERIFIED_NOT_ASSESSED });
    expect(e.limitations).toContain(VERIFIED_NOT_ASSESSED);
    expect(JSON.stringify(e)).not.toMatch(/\bcompetent\b|mastered|certif|passed/i);
  });
});
