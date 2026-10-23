import { describe, expect, it } from "vitest";
import { assembleMappings, evidenceByCompetency, goalGaps, linksFor, professionalProgress, subjectText, PROFESSIONAL_COVERAGE_REASONS } from "./mapping-store";
import { acceptedLinks } from "./passport-records";

// Migration 393's store, the pure parts: states from append-only decisions, what counts as evidence for the
// shared progress model, goal gaps by S1 expected level, and what the Passport may show.

const comp = (id: string, title: string, score: number | null) => ({
  competencyId: id, code: null, title, description: null, layer: "profession" as const, profession: null,
  catalogue: { id: "F", name: "Nursing: Respiratory Care", code: "NUR-RESP", version: "1" }, domain: { id: "D", name: "Resp" },
  outcomes: [], expectedLevel: score === null ? null : { id: `L${score}`, score, label: `Level ${score}` }, cpu: null,
  links: { prerequisites: [], extends: [], sharedWith: [] },
});
const CATALOGUE = [comp("K1", "Oxygen therapy", 3), comp("K2", "Respiratory assessment", 4), comp("K3", "Airway", null)];
const rows = [
  { id: "m1", cpd_id: "c1", competency_id: "K1", source: "person", confidence: null },
  { id: "m2", goal_id: "g1", competency_id: "K2", source: "person", confidence: null },
  { id: "m3", goal_id: "g1", competency_id: "K1", source: "person", confidence: null },
  { id: "m4", evidence_id: "e1", competency_id: "K2", source: "ai", confidence: "0.80", rationale: "Assessment of breathing" },
];
const decided = (map_id: string, decision: string, at: string) => ({ map_id, decision, decided_by: "person", created_at: at });
const decisions = [decided("m1", "accepted", "2026-10-01"), decided("m2", "accepted", "2026-10-01"), decided("m3", "accepted", "2026-10-01")];
const record = {
  goals: [{ id: "g1", title: "Lead respiratory care", status: "in_progress" }],
  cpd: [{ id: "c1", evidence_class: "source_linked" }],
  evidence: [{ id: "e1", evidence_class: "self_declared", framework_competency_id: null }],
};
const mappings = assembleMappings(rows, decisions);
const view = { provisioned: true, mappings, catalogue: CATALOGUE, names: new Map(CATALOGUE.map(c => [c.competencyId, c.title])) };

describe("professional competency mapping store", () => {
  it("an AI row with no decision is proposed, and the latest decision wins", () => {
    expect(mappings.find(m => m.mapId === "m4")).toMatchObject({ kind: "evidence", source: "ai", confidence: 0.8, state: "proposed" });
    const later = assembleMappings(rows, [...decisions, decided("m1", "rejected", "2026-10-02")]);
    expect(later.find(m => m.mapId === "m1")?.state).toBe("rejected");
  });

  it("counts only accepted links on CPD and evidence; positive only with a document", () => {
    const ev = evidenceByCompetency(mappings, record);
    expect([...ev]).toEqual([["K1", { evidence: 1, positive: 1 }]]);
  });

  it("counts the single 373 link on an evidence item once, even if also mapped", () => {
    const withLink = { ...record, evidence: [{ id: "e1", evidence_class: "self_declared", framework_competency_id: "K2" }] };
    const accepted = assembleMappings(rows, [...decisions, decided("m4", "accepted", "2026-10-02")]);
    expect(evidenceByCompetency(accepted, withLink).get("K2")).toEqual({ evidence: 1, positive: 0 });
  });

  it("a goal gap is what an accepted goal link aims at that no evidence touches", () => {
    expect([...goalGaps(mappings, evidenceByCompetency(mappings, record))]).toEqual([["g1", ["K2"]]]);
  });

  it("progress: shared-model coverage of the offered catalogue, gaps by expected level", () => {
    const p = professionalProgress(view, record);
    expect(p.coverage).toMatchObject({ state: "measured", total: 3, covered: 1, coveredPositive: 1 });
    if (p.coverage.state === "measured") expect(p.coverage.gaps.map(g => g.id)).toEqual(["K2", "K3"]);
    expect(p.goalGaps).toEqual([{ goalId: "g1", title: "Lead respiratory care", competencies: [{ id: "K2", name: "Respiratory assessment", expected: "Level 4" }] }]);
  });

  it("nothing offered (the default) is Not measured with the Professional reason, never 0", () => {
    const p = professionalProgress({ ...view, catalogue: [] }, record);
    expect(p.coverage).toEqual({ state: "not_measured", reason: PROFESSIONAL_COVERAGE_REASONS.noCatalogue });
  });

  it("an unreadable source is Not measured, and gaps are unknown rather than none", () => {
    const p = professionalProgress({ ...view, mappings: null }, record);
    expect(p.coverage).toEqual({ state: "not_measured", reason: PROFESSIONAL_COVERAGE_REASONS.unreadable });
    expect(p.goalGaps).toBeNull();
  });

  it("before 393 is applied, coverage says links are not set up", () => {
    const p = professionalProgress({ ...view, provisioned: false, mappings: [] }, record);
    expect(p.coverage).toEqual({ state: "not_measured", reason: PROFESSIONAL_COVERAGE_REASONS.noEvidenceSource });
  });

  it("names a link to a competency no longer offered instead of dropping it", () => {
    expect(linksFor({ mappings, names: new Map() }, "cpd", "c1")[0].title).toBe("A competency no longer offered");
  });

  it("the engine reads only the person's own words for a subject", () => {
    expect(subjectText("cpd", { title: "ALS course", provider: "RC UK", reflection: "  ", hours: 8 })).toBe("ALS course. RC UK");
  });

  it("the Passport shows accepted CPD and evidence links only", () => {
    const links = acceptedLinks(record as never, mappings, view.names);
    expect([...links]).toEqual([["cpd:c1", ["Oxygen therapy"]]]);
  });
});
