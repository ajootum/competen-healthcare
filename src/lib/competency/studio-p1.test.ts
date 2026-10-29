import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRequirements, componentOutcome, type ComponentRequirement } from "./studio-components";
import { mappingProblems, stageFor, type Band } from "./stage-mapping";
import { pickOverlay } from "./foundation";

// CFCA-STUDIO-P1 (migration 660): the CCHU roll-up rule, the DACUM stage mapping, and the migration's guards.

const lvl = (score: number) => ({ id: `l${score}`, score, label: `L${score}` });
const req = (code: string, o: Partial<ComponentRequirement> = {}): ComponentRequirement => ({ code, passLevel: null, mandatory: true, safetyCritical: false, weight: null, ...o });
const CCHU = [req("clinical_skills"), req("knowledge"), req("knowledge_application")];

describe("CCHU component roll-up: a weighted average never overrides a failed mandatory component", () => {
  it("achieves when every mandatory component reaches the target", () => {
    const o = componentOutcome(CCHU, [{ code: "clinical_skills", score: 4 }, { code: "knowledge", score: 3 }, { code: "knowledge_application", score: 3 }], 3);
    expect(o.status).toBe("achieved");
    expect(o.overall).toBe(3);
  });
  it("fails on one mandatory component below its pass level, however high the weighted level", () => {
    const reqs = [req("clinical_skills", { weight: 90 }), req("knowledge", { weight: 5 }), req("knowledge_application", { weight: 5 })];
    const o = componentOutcome(reqs, [{ code: "clinical_skills", score: 6 }, { code: "knowledge", score: 6 }, { code: "knowledge_application", score: 2 }], 3);
    expect(o.overall).toBe(5);
    expect(o.status).toBe("not_achieved");
    expect(o.failedMandatory).toEqual(["knowledge_application"]);
  });
  it("names a failed safety-critical component, and a component's own pass level wins over the target", () => {
    const reqs = [req("clinical_skills", { safetyCritical: true, passLevel: lvl(5) }), req("knowledge")];
    const o = componentOutcome(reqs, [{ code: "clinical_skills", score: 4 }, { code: "knowledge", score: 6 }], 3);
    expect(o.status).toBe("not_achieved");
    expect(o.failedSafetyCritical).toEqual(["clinical_skills"]);
  });
  it("is incomplete, never passed, while a mandatory component is not assessed", () => {
    const o = componentOutcome(CCHU, [{ code: "clinical_skills", score: 6 }, { code: "knowledge", score: 6 }], 3);
    expect(o.status).toBe("incomplete");
    expect(o.missingMandatory).toEqual(["knowledge_application"]);
  });
  it("an optional component below target does not fail alone, but counts in the weighted level", () => {
    const reqs = [req("clinical_skills"), req("knowledge", { mandatory: false })];
    expect(componentOutcome(reqs, [{ code: "clinical_skills", score: 4 }, { code: "knowledge", score: 2 }], 3).status).toBe("achieved");
    expect(componentOutcome(reqs, [{ code: "clinical_skills", score: 3 }, { code: "knowledge", score: 1 }], 3).status).toBe("not_achieved");
  });
  it("HQ input: safety-critical is always mandatory, unknown or retired components and bad weights are refused", () => {
    const registry = [{ code: "knowledge", label: "Knowledge", description: null, sortOrder: 0, active: true }, { code: "old", label: "Old", description: null, sortOrder: 1, active: false }];
    const levels = [{ id: "00000000-0000-4000-8000-000000000003", scaleId: "s", score: 3, label: "L3" }];
    const ok = checkRequirements([{ code: "knowledge", mandatory: false, safetyCritical: true, passLevelId: levels[0].id }], registry, levels);
    expect(ok.ok && ok.reqs[0].mandatory).toBe(true);
    expect(checkRequirements([{ code: "nope" }], registry, levels).ok).toBe(false);
    expect(checkRequirements([{ code: "old" }], registry, levels).ok).toBe(false);
    expect(checkRequirements([{ code: "knowledge", weight: 0 }], registry, levels).ok).toBe(false);
    expect(checkRequirements([{ code: "knowledge" }, { code: "knowledge" }], registry, levels).ok).toBe(false);
  });
});

describe("DACUM 0-6 to Competen stages (owner mapping, CFCA-STUDIO-P1)", () => {
  const bands: Band[] = [[0, "unstaged"], [1, "novice"], [2, "novice"], [3, "advanced_beginner"], [4, "competent"], [5, "proficient"], [6, "expert"]]
    .map(([score, stageCode]) => ({ levelId: `l${score}`, score: score as number, stageCode: stageCode as string }));
  const stages = ["unstaged", "novice", "advanced_beginner", "competent", "proficient", "expert"].map((code, i) => ({ code, label: code, description: null, sortOrder: i * 10, active: true }));
  it("maps every level as approved", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(s => stageFor(s, bands))).toEqual(["unstaged", "novice", "novice", "advanced_beginner", "competent", "proficient", "expert"]);
    expect(stageFor(null, bands)).toBeNull();
  });
  it("a draft with a level left unmapped, or a higher level at an earlier stage, is reported", () => {
    const levels = [0, 1, 2, 3, 4, 5, 6].map(lvl);
    expect(mappingProblems(levels, bands, stages)).toEqual([]);
    expect(mappingProblems(levels, bands.slice(0, 6), stages)).toEqual(["Level 6 (L6) has no stage."]);
    const swapped = bands.map(b => (b.score === 5 ? { ...b, stageCode: "novice" } : b));
    expect(mappingProblems(levels, swapped, stages).some(p => /earlier stage/.test(p))).toBe(true);
  });
});

describe("pickOverlay: the programme's own catalogue order decides", () => {
  const o = (catalogueId: string, requirement: "required" | "optional") => ({ catalogueId, catalogueName: catalogueId, catalogueVersion: "1.0.0", entryId: `e-${catalogueId}`, requirement, expectedLevel: null });
  it("takes the first of the programme's catalogues, and none from catalogues outside it", () => {
    expect(pickOverlay([o("b", "optional"), o("a", "required")], new Map([["a", 0], ["b", 1]]))?.catalogueId).toBe("a");
    expect(pickOverlay([o("x", "required")], new Map([["a", 0]]))).toBeNull();
  });
});

describe("migration 660 guards", () => {
  const m = readFileSync(join(process.cwd(), "supabase/migrations/660-cfca-studio-p1.sql"), "utf8").toLowerCase();
  it("freezes component requirements and mapping bands outside draft, with the cascade allowance", () => {
    expect(m).toMatch(/competency_catalogue_entry_component_guard[\s\S]*pg_trigger_depth\(\) > 1[\s\S]*coalesce\(v_status, 'draft'\) <> 'draft'/);
    expect(m).toMatch(/competency_stage_mapping_band_guard[\s\S]*pg_trigger_depth\(\) > 1[\s\S]*coalesce\(v_status, 'draft'\) <> 'draft'/);
  });
  it("refuses the author as publisher, an incomplete mapping, and any edit after publication", () => {
    expect(m).toContain("new.published_by = old.created_by");
    expect(m).toContain("so the mapping cannot be published");
    expect(m).toContain("cannot become % or be edited");
  });
  it("a safety-critical component is always mandatory, and the requirement has three values", () => {
    expect(m).toContain("not is_safety_critical or is_mandatory");
    expect(m).toContain("requirement in ('required', 'recommended', 'optional')");
  });
  it("seeds the approved DACUM mapping and keeps Benner the default scale", () => {
    expect(m).toContain("(0, 'unstaged'), (1, 'novice'), (2, 'novice'), (3, 'advanced_beginner'), (4, 'competent'),");
    expect(m).toContain("(5, 'proficient'), (6, 'expert')");
    expect(m).toMatch(/'dacum 0-6', 'dacum achievement scale[^']*', 0, 6, false/);
  });
  it("is additive: no existing table is dropped or rewritten, and NUR-FOUND is a draft of references", () => {
    expect(m).not.toMatch(/\bdrop table\b|\bdrop column\b|\btruncate\b|\bdelete from\b/);
    expect(m).not.toMatch(/update (frameworks|framework_competencies|scoring_levels|scoring_scales|competency_catalogue_entry)\b/);
    expect(m).toMatch(/'nur-found', 'core',[\s\S]*?true, 'draft', null, 'profession'/);
  });
});

describe("migration 670 guards (criteria by component, DACUM source wording)", () => {
  const m = readFileSync(join(process.cwd(), "supabase/migrations/670-cfca-criteria-components.sql"), "utf8").toLowerCase();
  it("adds only nullable columns, and the hash is unchanged for an untagged skill", () => {
    expect(m).toContain("add column if not exists component_code text");
    expect(m).toContain("references competency_assessment_component(code) on delete restrict");
    expect(m).toContain("jsonb_agg(s.name || coalesce(' [' || s.component_code || ']', '') order by s.name, s.id)");
    expect(m).not.toMatch(/\bdrop (table|column)\b|\btruncate\b|\bdelete from\b|update (framework_competencies|competency_skills|frameworks)\b/);
  });
  it("sets the DACUM wording only where the 660 seed is still in place, and leaves scores and the mapping alone", () => {
    expect(m).toMatch(/where s\.id = l\.scale_id and s\.name = 'dacum 0-6' and l\.score = v\.score and l\.label = v\.seeded;/);
    expect(m).toContain("'can perform this activity satisfactorily without supervision and assistance'");
    expect(m).not.toMatch(/update competency_stage_mapping|set score|is_passing\s*=/);
  });
});
