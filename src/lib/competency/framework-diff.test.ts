/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { diffFramework, loadFrameworkDiff, normalise } from "./framework-diff";

// FRAMEWORK-DESIGN-STUDIO-02 S1 (G7): the draft's live rows against the last published snapshot.

const k = (id: string | null, name: string, component: string, sort: number, extra: any = {}) => ({ id, name, component_code: component, sort_order: sort, ...extra });
const comp = (id: string, code: string, sort: number, skills: any[], extra: any = {}) => ({
  id, code, name: `Competency ${code}`, description: null, sort_order: sort, learning_outcomes: ["Outcome"], expected_level_id: "L3", risk_category: "standard", practice_id: null, cpu_id: null, competency_skills: skills, ...extra,
});
const published = () => ({
  name: "Example", description: null, component_order: null, version_label: "1.0.0",
  framework_domains: [
    { id: "d1", name: "Communication", code: null, sort_order: 1, framework_competencies: [
      comp("c1", "EX-001", 1, [k("k1", "Explains purpose", "cs", 1), k("k2", "Knows policy", "kn", 2), k("k3", "Checks understanding", "cs", 3)]),
      comp("c2", "EX-002", 2, [k("k4", "Writes legibly", "cs", 1)]),
    ] },
    { id: "d2", name: "Safety", code: null, sort_order: 2, framework_competencies: [comp("c3", "EX-003", 1, [])] },
  ],
});

describe("draft versus published", () => {
  it("no change reads as unchanged", () => {
    const d = diffFramework(normalise(published()), normalise(published()));
    expect(d.unchanged).toBe(true);
  });
  it("names every kind of change: fields, criteria added/retired/reworded/moved, competencies added/removed, order", () => {
    const live: any = published();
    const [dom1, dom2] = live.framework_domains;
    const c1 = dom1.framework_competencies[0], c2 = dom1.framework_competencies[1];
    c1.name = "Communicates clearly";                              // a clinical field
    c1.competency_skills[0].name = "Explains the purpose";        // reworded
    c1.competency_skills[1].is_active = false;                     // retired
    c1.competency_skills[2].component_code = "kn";                 // to another section
    c1.competency_skills.push(k("k9", "New criterion", "cs", 4));  // added
    const moved = c2.competency_skills.splice(0, 1)[0];            // to another competency
    dom2.framework_competencies[0].competency_skills.push(moved);
    dom2.framework_competencies.push(comp("c4", "EX-004", 2, [k("k10", "Brand new", "cs", 1)]));
    live.framework_domains = [dom2, dom1];                         // domain order
    dom1.framework_competencies.splice(1, 1);                      // c2 removed
    dom2.sort_order = 0;

    const d = diffFramework(normalise(published()), normalise(live));
    expect(d.unchanged).toBe(false);
    expect(d.domains.reordered).toBe(true);
    expect(d.competencies.added.map(c => c.code)).toEqual(["EX-004"]);
    expect(d.competencies.removed.map(c => c.code)).toEqual(["EX-002"]);
    const ch1 = d.competencies.changed.find(c => c.id === "c1")!;
    expect(ch1.fields).toEqual([{ field: "name", before: "Competency EX-001", after: "Communicates clearly", clinical: true }]);
    expect(ch1.criteria.textChanged).toEqual([{ id: "k1", component: "cs", before: "Explains purpose", after: "Explains the purpose" }]);
    expect(ch1.criteria.retired.map(x => x.id)).toEqual(["k2"]);
    expect(ch1.criteria.added.map(x => x.id)).toEqual(["k9"]);
    expect(ch1.criteria.moved).toEqual([{ id: "k3", text: "Checks understanding", from: { competencyId: "c1", component: "cs" }, to: { competencyId: "c1", component: "kn" } }]);
    const ch3 = d.competencies.changed.find(c => c.id === "c3")!;
    expect(ch3.criteria.moved[0]).toMatchObject({ id: "k4", from: { competencyId: "c2" }, to: { competencyId: "c3" } });
    expect(d.counts).toMatchObject({ competenciesAdded: 1, competenciesRemoved: 1, criteriaAdded: 2, criteriaRetired: 1, criteriaTextChanged: 1, criteriaMoved: 2 });
  });
  it("a competency moved to another domain, and a reorder within a section", () => {
    const live: any = published();
    const c2 = live.framework_domains[0].framework_competencies.splice(1, 1)[0];
    live.framework_domains[1].framework_competencies.push({ ...c2, sort_order: 2 });
    const c1 = live.framework_domains[0].framework_competencies[0];
    c1.competency_skills[0].sort_order = 5;                        // k1 now after k3 within "cs"
    const d = diffFramework(normalise(published()), normalise(live));
    expect(d.competencies.changed.find(c => c.id === "c2")?.movedDomain).toEqual({ from: "Communication", to: "Safety" });
    expect(d.competencies.changed.find(c => c.id === "c1")?.criteria.reordered).toEqual(["cs"]);
  });
  it("a snapshot from before 750 (no criterion ids) compares criteria by section and text", () => {
    const old: any = published();
    for (const dm of old.framework_domains) { delete dm.id; for (const c of dm.framework_competencies) for (const s of c.competency_skills) s.id = null; }
    const live: any = published();
    live.framework_domains[0].framework_competencies[0].competency_skills[0].name = "Explains the purpose";
    const ch = diffFramework(normalise(old), normalise(live)).competencies.changed.find(c => c.id === "c1")!;
    expect(ch.criteria.added.map(x => x.text)).toEqual(["Explains the purpose"]);
    expect(ch.criteria.removed.map(x => x.text)).toEqual(["Explains purpose"]);
  });
  it("a framework never published says so", async () => {
    const admin: any = { from: (t: string) => {
      const q: any = { select: () => q, eq: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: { id: "f1", name: "Example", pub_status: "draft", hospital_id: null }, error: null }),
        then: (ok: any) => Promise.resolve({ data: t === "framework_versions" ? [] : null, error: null }).then(ok) };
      return q;
    } };
    expect(await loadFrameworkDiff(admin, "f1")).toMatchObject({ status: "no_published_version" });
  });
});
