import { describe, expect, it } from "vitest";
import { EXPECTED_NOT_SET, NOT_IN_PROGRAMME_NOTE, buildOverview, unionCompetencies, verificationPanel, type OverviewCompetency, type OverviewInput, type ProgressFact } from "./competency-overview-model";
import type { Attempt } from "./history";
import { NOT_VERIFIED_LINE, NO_MAPPED_EVIDENCE, VERIFICATION_UNREADABLE } from "./vocab";

const A = "c0000000-0000-4000-8000-00000000000a", B = "c0000000-0000-4000-8000-00000000000b";
const comp = (id: string, title: string, expected: number | null = 4): OverviewCompetency => ({ id, code: null, title, domain: "Clinical", expected: expected === null ? null : { score: expected, label: "Competent" }, contentStatus: "approved" });
const at = (id: string, when: string, r: number | null): Attempt => ({ instanceId: id, submittedAt: when, instrumentCode: "CHK", instrumentName: "Check", rating: { rating: r, descriptor: r === null ? null : `level ${r}`, low: r, high: r, rated: r === null ? 0 : 1, unjudged: 0, unanswered: 0, criteria: 1 } });
const prog = (o: Partial<ProgressFact> = {}): ProgressFact => ({ sectionsAccepted: 2, sectionsProposed: 0, questions: 10, answered: 8, latestAccuracy: 90, status: "practising", ...o });
const base = (o: Partial<OverviewInput> = {}): OverviewInput => ({
  competencies: [comp(A, "Airway"), comp(B, "Oxygen")], attempts: new Map(), progress: new Map(), activity: null, verifications: [], startable: new Map(), findings: new Map(), scaleMax: 6, ...o,
});

describe("the overview: four classes per competency", () => {
  it("drops an unmapped activity: a competency with no accepted link and no recorded activity has no evidence", () => {
    const m = buildOverview(base({ progress: new Map([[A, prog({ sectionsAccepted: 0, questions: 0, answered: 0, latestAccuracy: null, status: "no_notes" })]]) }));
    expect(m.rows[0].evidence).toEqual({ state: "none", text: NO_MAPPED_EVIDENCE });
    expect(m.rows[1].evidence.state).toBe("none");
    expect(m.rows[0].active).toBe(false);
  });
  it("shows linked practice with its outcome, and marks the row active", () => {
    const m = buildOverview(base({ progress: new Map([[A, prog()]]), activity: new Map([[A, { actions: 3, lastVerdict: "secure", lastAt: "2026-11-01T10:00:00Z" }]]) }));
    expect(m.rows[0].evidence).toMatchObject({ state: "evidence", sectionsAccepted: 2, accuracy: 90, actions: 3, lastAt: "2026-11-01T10:00:00Z" });
    expect(m.rows[0].evidence.state === "evidence" && m.rows[0].evidence.outcome).toBe("90% right on the latest try, 8 of 10 practice questions answered");
    expect(m.rows[0].active).toBe(true);
  });
  it("computes the latest rating, the delta and the trend from every submitted attempt", () => {
    const m = buildOverview(base({ attempts: new Map([[A, [at("i2", "2026-11-02T00:00:00Z", 5), at("i1", "2026-10-01T00:00:00Z", 3)]]]) }));
    const s = m.rows[0].self!;
    expect(s).toMatchObject({ rating: 5, delta: 2, deltaText: "+2", trend: "up", latestInstanceId: "i2", points: [3, 5] });
    expect(s.history.previous?.instanceId).toBe("i1");
    expect(m.rows[0].active).toBe(true);
  });
  it("offers to start where an instrument assesses the competency, even with no attempt yet", () => {
    const m = buildOverview(base({ startable: new Map([[A, { code: "CHK-RESP-ASSESS", name: "Respiratory assessment" }]]) }));
    expect(m.rows[0].self).toMatchObject({ rating: null, canRepeat: { code: "CHK-RESP-ASSESS" }, latestInstanceId: null });
    expect(m.rows[1].self).toBeNull();
  });
  it("compares self against practice and says so in the fixed words when they differ", () => {
    const m = buildOverview(base({ attempts: new Map([[A, [at("i1", "2026-11-02T00:00:00Z", 6)]]]), progress: new Map([[A, prog({ latestAccuracy: 30 })]]) }));
    expect(m.rows[0].compare).toMatchObject({ state: "self_higher", selfBand: "higher", evidenceBand: "lower", differs: true });
    expect(m.rows[0].compare.text).toBe("Your self-rating is higher than your recent practice results suggest. Practising Airway may help you confirm it.");
  });
  it("says practice is higher when it is, aligned when they agree, and nothing to compare without enough of either", () => {
    expect(buildOverview(base({ attempts: new Map([[A, [at("i1", "2026-11-02T00:00:00Z", 1)]]]), progress: new Map([[A, prog({ latestAccuracy: 95 })]]) })).rows[0].compare.state).toBe("evidence_higher");
    expect(buildOverview(base({ attempts: new Map([[A, [at("i1", "2026-11-02T00:00:00Z", 5)]]]), progress: new Map([[A, prog({ latestAccuracy: 95 })]]) })).rows[0].compare.state).toBe("aligned");
    expect(buildOverview(base({ attempts: new Map([[A, [at("i1", "2026-11-02T00:00:00Z", 5)]]]), progress: new Map([[A, prog({ answered: 1, latestAccuracy: 20 })]]) })).rows[0].compare.state).toBe("no_evidence");
    expect(buildOverview(base({ progress: new Map([[A, prog()]]) })).rows[0].compare.state).toBe("no_self");
  });
  it("never changes a self rating whatever the practice shows", () => {
    const attempts = new Map([[A, [at("i1", "2026-11-02T00:00:00Z", 6)]]]);
    const low = buildOverview(base({ attempts, progress: new Map([[A, prog({ latestAccuracy: 0, answered: 20 })]]) })).rows[0].self!;
    const none = buildOverview(base({ attempts })).rows[0].self!;
    expect(low.rating).toBe(6);
    expect(low.rating).toBe(none.rating);
  });
  it("carries the findings of the latest attempt as strengths and gaps", () => {
    const f = (kind: "met" | "below_expected") => ({ itemKey: kind, code: "X", prompt: "p", kind, label: kind, ordinal: 3, expected: 4, competencyId: A });
    const m = buildOverview(base({ attempts: new Map([[A, [at("i1", "2026-11-02T00:00:00Z", 3)]]]), findings: new Map([[A, [f("met"), f("below_expected")]]]) }));
    expect(m.rows[0].self!.strengths).toHaveLength(1);
    expect(m.rows[0].self!.gaps).toHaveLength(1);
  });
});

describe("verified competency", () => {
  it("is Not yet verified whenever there is no record, however strong the self rating or the practice", () => {
    const m = buildOverview(base({ attempts: new Map([[A, [at("i1", "2026-11-02T00:00:00Z", 6)]]]), progress: new Map([[A, prog({ latestAccuracy: 100 })]]), verifications: [] }));
    expect(m.rows.every(r => r.verification.state === "not_yet" && r.verification.line === NOT_VERIFIED_LINE)).toBe(true);
    expect(m.topLine).toBe(NOT_VERIFIED_LINE);
    expect(m.verifiedCount).toBe(0);
  });
  it("shows a current verification for exactly its competency, with who issued it", () => {
    const v = [{ competencyId: B, outcomeLabel: "Verified competent", issuer: "Competen Holdings", decidedAt: "2026-10-30T00:00:00Z", current: true }];
    const m = buildOverview(base({ verifications: v }));
    expect(m.rows[0].verification.state).toBe("not_yet");
    expect(m.rows[1].verification).toMatchObject({ state: "verified", line: "Verified competency: Verified competent", detail: "Issued by Competen Holdings, 2026-10-30" });
    expect(m.verifiedCount).toBe(1);
  });
  it("ignores a verification that is no longer current", () => {
    expect(verificationPanel(A, [{ competencyId: A, outcomeLabel: "x", issuer: "y", decidedAt: "2025-01-01T00:00:00Z", current: false }]).state).toBe("not_yet");
  });
  it("says it could not be read when the Passport could not, never Not yet verified", () => {
    const m = buildOverview(base({ verifications: null }));
    expect(m.rows[0].verification).toMatchObject({ state: "unreadable", line: VERIFICATION_UNREADABLE });
    expect(m.verifiedCount).toBeNull();
    expect(m.topLine).toBe(VERIFICATION_UNREADABLE);
  });
});

describe("the competencies listed: the programme's plus every one the learner has rated themselves on", () => {
  const C = "c0000000-0000-4000-8000-00000000000c";
  const labels = new Map([[C, { code: "NUR-CCF-001", title: "Respiratory Assessment", domain: "Clinical care", framework: "NUR-CCF" }]]);
  it("adds a self-assessed competency the programme does not offer, named from its labels, after the programme's own", () => {
    const u = unionCompetencies([comp(A, "Airway")], [C], labels);
    expect(u.map(c => c.id)).toEqual([A, C]);
    expect(u[1]).toMatchObject({ title: "Respiratory Assessment", code: "NUR-CCF-001", domain: "Clinical care", framework: "NUR-CCF", inProgramme: false, expected: null });
    expect(u[0].inProgramme).toBe(true);
  });
  it("lists a competency in both once, as the programme's, with its programme expected level", () => {
    const u = unionCompetencies([comp(A, "Airway", 4)], [A, A], labels);
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ id: A, inProgramme: true, expected: { score: 4, label: "Competent" } });
  });
  it("still lists one whose label cannot be read, named plainly", () => {
    const u = unionCompetencies([], [C], new Map());
    expect(u[0]).toMatchObject({ id: C, title: "A competency you rated yourself on", inProgramme: false });
  });
  it("orders the extra ones by name", () => {
    const L = new Map<string, { code: string | null; title: string; domain: string; framework: string | null }>([[C, labels.get(C)!], [B, { code: null, title: "Airway", domain: "", framework: null }]]);
    expect(unionCompetencies([], [C, B], L).map(c => c.title)).toEqual(["Airway", "Respiratory Assessment"]);
  });
  it("shows the learner's rating for it unconditionally, with the neutral note and no expected level, and mapped evidence stays filtered", () => {
    const union = unionCompetencies([comp(A, "Airway")], [C], labels);
    const m = buildOverview(base({
      competencies: union, attempts: new Map([[C, [at("i1", "2026-11-02T00:00:00Z", 4)]]]), openSelf: new Map(),
    }));
    const row = m.rows.find(r => r.competency.id === C)!;
    expect(row.self).toMatchObject({ rating: 4, latestInstanceId: "i1" });
    expect(row.active).toBe(true);
    expect(row.competency.inProgramme).toBe(false);
    expect(row.competency.expected).toBeNull();
    expect(row.evidence).toEqual({ state: "none", text: NO_MAPPED_EVIDENCE });
    expect(row.compare.state).toBe("no_evidence");
    expect(NOT_IN_PROGRAMME_NOTE).toBe("Not in your current programme");
    expect(EXPECTED_NOT_SET).toBe("Expected level: not set for your programme");
    expect(`${NOT_IN_PROGRAMME_NOTE} ${EXPECTED_NOT_SET}`).not.toMatch(/draft|unpublished|publish/i);
    expect(m.rows.find(r => r.competency.id === A)?.competency.inProgramme).toBe(true);
  });
  it("shows an open self-assessment on such a competency with a way to continue it", () => {
    const m = buildOverview(base({ competencies: unionCompetencies([], [C], labels), openSelf: new Map([[C, "open-1"]]) }));
    expect(m.rows[0].self).toMatchObject({ rating: null, openInstanceId: "open-1" });
    expect(m.rows[0].active).toBe(true);
  });
});
