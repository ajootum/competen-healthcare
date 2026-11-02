import { describe, expect, it } from "vitest";
import type { IndividualPassport } from "@/lib/individual/passport";
import type { CatalogueCompetency } from "@/lib/individual/scholar/catalogue";
import type { CompetencyCoverage } from "@/lib/competency/progress-model";
import { FORMAL_RECORDS_TITLE, LEARNER_EVIDENCE_TITLE, NO_EVIDENCE, NO_FRAMEWORK, evidenceView, frameworksView, gapsView, groupByFramework } from "./competencies-view";

const comp = (id: string, over: Partial<CatalogueCompetency> = {}): CatalogueCompetency => ({
  id, layer: "profession", profession: "Nursing", catalogue: "Core framework", frameworkId: "f1", domain: "Care", code: id, title: `Competency ${id}`,
  outcomes: [], expectedLevel: null, practice: null, cpu: null, contentStatus: "approved", statusNote: null, ...over,
});
const learner = (over: Record<string, unknown> = {}) => ({ provisioned: true, programme: { label: "BSc Nursing" }, competencies: [comp("b"), comp("a")] as CatalogueCompetency[] | null, belowFloor: 0, ...over });

describe("groupByFramework", () => {
  it("groups by framework in first-seen order, sorted by code, collecting layers", () => {
    const g = groupByFramework([comp("b"), comp("z", { frameworkId: "f2", catalogue: "Second", layer: "advanced" }), comp("a", { layer: "foundational" })]);
    expect(g.map(x => x.name)).toEqual(["Core framework", "Second"]);
    expect(g[0].competencies.map(c => c.id)).toEqual(["a", "b"]);
    expect(g[0].layers).toEqual(["profession", "foundational"]);
  });
});

describe("frameworksView", () => {
  it("separates not set up, no programme, unreadable, empty and listed", () => {
    expect(frameworksView(learner({ provisioned: false }), 0).kind).toBe("not_set_up");
    const np = frameworksView(learner({ programme: null }), 2);
    expect(np.kind === "no_programme" && np.text).toMatch(/Choose your programme/);
    expect(frameworksView(learner({ competencies: null }), 1)).toEqual({ kind: "unreadable" });
    expect(frameworksView(learner({ competencies: [] }), 1)).toEqual({ kind: "empty", text: NO_FRAMEWORK, heldBack: 0 });
    const v = frameworksView(learner(), 1);
    expect(v.kind === "groups" && v.groups).toHaveLength(1);
  });
  it("says content is held back by the floor, not that there is none", () => {
    const v = frameworksView(learner({ competencies: [], belowFloor: 4 }), 1);
    expect(v.kind === "empty" && v.text).toBe("No clinically approved competencies yet.");
    expect(v.kind === "empty" && v.heldBack).toBe(4);
  });
});

describe("gapsView", () => {
  const measured = (gaps: { id: string; name: string; expected: string | null }[]): CompetencyCoverage =>
    ({ state: "measured", framework: "Core framework", total: 5, covered: 5 - gaps.length, coveredPositive: 1, gaps, rows: [] });
  it("is unreadable when coverage could not be read, and says the reason when it was not measured", () => {
    expect(gapsView(learner(), null, 1)).toEqual({ kind: "unreadable" });
    expect(gapsView(learner(), { state: "not_measured", reason: "Your records are not yet linked to competencies." }, 1)).toEqual({ kind: "not_measured", reason: "Your records are not yet linked to competencies." });
    expect(gapsView(learner(), { state: "insufficient", have: 1, need: 5, reason: "Too little practice to say." }, 1).kind).toBe("not_measured");
  });
  it("asks for a programme first", () => {
    expect(gapsView(learner({ programme: null }), measured([]), 0).kind).toBe("no_programme");
    expect(gapsView(learner({ provisioned: false }), null, 0).kind).toBe("not_set_up");
  });
  it("lists the gaps from coverage unchanged, or says none were left", () => {
    const g = [{ id: "x", name: "Wound care", expected: "Proficient" }];
    expect(gapsView(learner(), measured(g), 1)).toEqual({ kind: "gaps", framework: "Core framework", total: 5, covered: 4, gaps: g });
    expect(gapsView(learner(), measured([]), 1)).toEqual({ kind: "none", framework: "Core framework", total: 5 });
  });
});

const passport = (over: Partial<IndividualPassport> = {}): IndividualPassport => ({
  competencies: [], credentials: [], employment: [], own: [], study: { ok: true, data: [] }, evaluations: { ok: true, data: [] },
  learning: { enabled: false, items: [] }, verifications: { provisioned: false, items: [] }, ...over,
});

describe("evidenceView", () => {
  it("is allEmpty only when every read succeeded and found nothing", () => {
    const v = evidenceView(passport());
    expect(v.allEmpty).toBe(true);
    expect(NO_EVIDENCE).toBe("No evidence on your record yet.");
    expect(v.formal.map(s => s.id)).toEqual(["assessed", "credentials"]);
  });
  it("is never allEmpty when a read failed: could not be read is not none", () => {
    const v = evidenceView(passport({ competencies: null }));
    expect(v.allEmpty).toBe(false);
    expect(v.formal[0].state).toBe("unreadable");
    expect(evidenceView(passport({ study: { ok: false, notProvisioned: false } })).learner[0].state).toBe("unreadable");
    expect(evidenceView(passport({ study: { ok: false, notProvisioned: true } })).learner[0].state).toBe("unavailable");
  });
  it("keeps formative rows in the learner group and institution rows in the formal group, each with its label", () => {
    const v = evidenceView(passport({
      study: { ok: true, data: [{ materialId: "m1", achievement: "practice_questions", label: "Cardiology notes", answered: 12, lastStudied: "2026-10-30", includedAt: "2026-10-31" }] },
      competencies: [{ competencyId: "c1", name: "Hand hygiene", outcome: "competent", expiryDate: null, decidedAt: "2026-09-01", issuer: "City Hospital", current: true }],
      credentials: [{ title: "Registration", type: "registration", issuingBody: null, issueDate: null, expiryDate: null, status: "active", evidence: "self_declared" }],
    }));
    expect(v.allEmpty).toBe(false);
    expect(v.learner[0].rows[0].label).toBe("Self-directed study, not a verified competency");
    expect(v.learner[0].rows[0].title).toBe("Cardiology notes");
    expect(v.formal[0].rows[0].label).toMatch(/^Issued by an organisation · Current$/);
    expect(v.formal[1].rows[0].label).toBe("Self-declared, not verified");
    expect(v.learner.flatMap(s => s.rows).some(r => r.title === "Hand hygiene")).toBe(false);
  });
  it("shows verification and learning sections only where they are on", () => {
    const v = evidenceView(passport({ verifications: { provisioned: true, items: null }, learning: { enabled: true, items: [] } }));
    expect(v.formal.map(s => s.id)).toEqual(["assessed", "verified", "credentials", "learning"]);
    expect(v.formal[1].state).toBe("unreadable");
    expect(v.formal[3].state).toBe("empty");
  });
  it("keeps the two group titles apart", () => {
    expect(LEARNER_EVIDENCE_TITLE).toBe("Your learning evidence (formative, not verified)");
    expect(FORMAL_RECORDS_TITLE).toBe("Formal records");
  });
});
