import { describe, expect, it } from "vitest";
import { buildCriterionTree, criterionDrift, criterionMapping, criterionToItem, CRITERION_KIND, type CriterionRow } from "./criteria";

const row = (over: Partial<CriterionRow> = {}): CriterionRow => ({
  competency_id: "c1", competency_code: "NUR-CCF-001", competency_name: "Respiratory Assessment", domain_name: "Clinical skills", skill_id: "s1", sort_order: 1,
  component_code: "clinical_skills", wording: "Counts the respiratory rate for a full minute", framework_code: "NUR-CCF", framework_version: "1.0.0",
  framework_pub_status: "draft", competency_hash: "hash1", clinically_approved: true, ...over,
});

describe("criterion picker row to item and mapping", () => {
  it("a picked criterion becomes a mapping with a frozen snapshot, the competency hash and the framework version", () => {
    const m = criterionMapping(row());
    expect(m.kind).toBe(CRITERION_KIND);
    expect(m.ref_id).toBe("s1");
    expect(m.ref_code).toBe("NUR-CCF-001");
    expect(m.ref_version).toBe("NUR-CCF 1.0.0");
    expect(m.ref_hash).toBe("hash1");
    expect(m.relation).toBe("assesses");
    expect(m.ref_snapshot).toEqual({
      wording: "Counts the respiratory rate for a full minute", component_code: "clinical_skills", competency_id: "c1", competency_name: "Respiratory Assessment",
      framework_code: "NUR-CCF", framework_version: "1.0.0",
    });
  });
  it("the item prompt is the wording, it is a rating item with the chosen scale, and it takes the component as its group when the version has it", () => {
    const it1 = criterionToItem(row(), { stableKey: "k1", sectionKey: "sec", position: 4, scaleVersionId: "sv", scale: null, groupCodes: ["clinical_skills", "knowledge"] });
    expect(it1.prompt).toBe("Counts the respiratory rate for a full minute");
    expect(it1.response_type).toBe("rating_scale");
    expect(it1.scale_version_id).toBe("sv");
    expect(it1.group_code).toBe("clinical_skills");
    expect(it1.mapping?.ref_id).toBe("s1");
    expect(it1.critical).toBe(false);
    expect(criterionToItem(row(), { stableKey: "k2", sectionKey: "sec", position: 1, scaleVersionId: null, scale: null, groupCodes: ["knowledge"] }).group_code).toBeNull();
  });
  it("the tree is framework, domain, competency, criteria in arrival order", () => {
    const t = buildCriterionTree([row(), row({ skill_id: "s2", wording: "b" }), row({ competency_id: "c2", skill_id: "s3", competency_name: "Other", domain_name: "Knowledge" })])!;
    expect(t.frameworkCode).toBe("NUR-CCF");
    expect(t.domains.map((d) => d.name)).toEqual(["Clinical skills", "Knowledge"]);
    expect(t.domains[0].competencies[0].criteria).toHaveLength(2);
    expect(buildCriterionTree([])).toBeNull();
  });
});

describe("drift between the snapshot and the live criterion", () => {
  const m = criterionMapping(row());
  it("no drift when nothing moved", () => { expect(criterionDrift(m, row()).drifted).toBe(false); });
  it("changed wording, moved component, changed competency hash, lost approval and a gone criterion are each flagged", () => {
    expect(criterionDrift(m, row({ wording: "New wording" })).reasons.join(" ")).toMatch(/wording/);
    expect(criterionDrift(m, row({ component_code: "knowledge" })).reasons.join(" ")).toMatch(/component/);
    expect(criterionDrift(m, row({ competency_hash: "other" })).reasons.join(" ")).toMatch(/content has changed/);
    expect(criterionDrift(m, row({ clinically_approved: false })).reasons.join(" ")).toMatch(/clinical approval/);
    expect(criterionDrift(m, null).reasons.join(" ")).toMatch(/no longer exists/);
  });
  it("an unknown approval is not drift and a non-criterion mapping never drifts", () => {
    expect(criterionDrift(m, row({ clinically_approved: null })).drifted).toBe(false);
    expect(criterionDrift({ ...m, kind: "other" }, null).drifted).toBe(false);
    expect(criterionDrift(null, null).drifted).toBe(false);
  });
});
