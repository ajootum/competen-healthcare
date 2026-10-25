import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, resolvePolicy, validateDraft } from "../policy";
import { checkStageChange, parseAiSuggestions, parseNeedForm, parseReflection } from "./needs-form";
import { ruleSuggestions, versionOf } from "./needs-store";
import { NEED_STAGES } from "./needs-vocabulary";

// COMPETEN-PROFESSIONAL-NEEDS-01 (Professional Stage 2) -- the pure rules of the development-need form, the free
// lifecycle, reflections, suggestions and their configuration.

const np = DEFAULT_POLICY.professionalNeeds;
const published = (key: string, settings: unknown) => ({ config_path: `individual.policy.${key}`, published: settings });

describe("the form: only the title is required", () => {
  it("saves with the description alone, and refuses without one", () => {
    expect(parseNeedForm({ title: "Recognising deterioration earlier" }, np)).toMatchObject({ ok: true, value: { title: "Recognising deterioration earlier", origin: "self_identified", priority_code: null } });
    expect(parseNeedForm({ title: "ab" }, np).ok).toBe(false);
  });
  it("copies the chosen label, refuses an unknown option, and keeps sources to the policy", () => {
    const r = parseNeedForm({ title: "Leading handovers", priority: "high", category: "leadership", source: "feedback" }, np);
    expect(r.ok && r.value).toMatchObject({ priority_code: "high", priority_label: "High", category_label: "Leadership and management", origin: "feedback" });
    expect(parseNeedForm({ title: "Leading handovers", priority: "urgent" }, np).ok).toBe(false);
    expect(parseNeedForm({ title: "Leading handovers", source: "feedback" }, { ...np, sources: ["self_identified"] }).ok).toBe(false);
  });
  it("a partial edit touches only what was sent", () => {
    const r = parseNeedForm({ why: "My unit is changing" }, np, true);
    expect(r.ok && Object.keys(r.value)).toEqual(["why_it_matters"]);
  });
});

describe("the lifecycle is not a sequence", () => {
  it("any offered stage may follow any other; reopening follows the policy", () => {
    expect(checkStageChange("identified", "addressed", np).ok).toBe(true);
    expect(checkStageChange("retired", "exploring", np).ok).toBe(true);
    expect(checkStageChange("retired", "exploring", { ...np, reopen: "off" }).ok).toBe(false);
    expect(checkStageChange("identified", "in_development", { ...np, stages: ["identified", "exploring"] }).ok).toBe(false);
  });
});

describe("reflections and suggestions", () => {
  it("a reflection needs words and an offered prompt", () => {
    expect(parseReflection({ body: "A night shift where escalation felt slow" }, np.templates)).toMatchObject({ ok: true, value: { template_code: null } });
    expect(parseReflection({ body: "ok", template: "experience" }, np.templates).ok).toBe(false);
    expect(parseReflection({ body: "Long enough", template: "made-up" }, np.templates).ok).toBe(false);
  });
  it("an AI answer yields at most three suggestions, each with a basis", () => {
    const four = ["- One thing :: because a", "- Two thing :: because b", "1. Three thing :: because c", "- Four thing :: because d", "- No basis line"].join("\n");
    expect(parseAiSuggestions(four).map(s => s.title)).toEqual(["One thing", "Two thing", "Three thing"]);
    expect(parseAiSuggestions("Sorry, I cannot help with that.")).toEqual([]);
  });
  it("rules: aspirations without a need and records expiring within the window; dismissed stays gone, deferred returns", () => {
    const items = [
      { id: "a", section: "aspiration", title: "Lead a team", expires_on: null, superseded_at: null, withdrawn_at: null },
      { id: "r", section: "registration", title: "Main register", expires_on: "2026-12-01", superseded_at: null, withdrawn_at: null },
      { id: "late", section: "registration", title: "Far away", expires_on: "2028-01-01", superseded_at: null, withdrawn_at: null },
      { id: "old", section: "aspiration", title: "Old aim", expires_on: null, superseded_at: "x", withdrawn_at: null },
    ];
    const base = { items, needs: [], decided: [], today: "2026-10-25", windowDays: 90 };
    expect(ruleSuggestions(base).map(s => s.key)).toEqual(["aspiration:a", "renewal:r:2026-12-01"]);
    expect(ruleSuggestions({ ...base, needs: [{ aspiration_item_id: "a", title: "x" }] }).map(s => s.key)).toEqual(["renewal:r:2026-12-01"]);
    expect(ruleSuggestions({ ...base, decided: [{ rule_key: "aspiration:a", status: "dismissed", decided_at: "2026-10-01T00:00:00Z" }] }).map(s => s.key)).toEqual(["renewal:r:2026-12-01"]);
    expect(ruleSuggestions({ ...base, decided: [{ rule_key: "aspiration:a", status: "deferred", decided_at: "2026-10-01T00:00:00Z" }] }).map(s => s.key)).toEqual(["renewal:r:2026-12-01"]);
    expect(ruleSuggestions({ ...base, decided: [{ rule_key: "aspiration:a", status: "deferred", decided_at: "2026-06-01T00:00:00Z" }] }).map(s => s.key)).toContain("aspiration:a");
  });
  it("a competency link records the catalogue version", () => {
    expect(versionOf({ catalogue: { id: "c", name: "n", code: null, version: "1.2.0" } })).toBe("v1.2.0");
  });
});

describe("configuration", () => {
  it("stages are a sequence with identified always kept; a published list replaces the neutral defaults", () => {
    expect(np.stages).toEqual([...NEED_STAGES]);
    expect(validateDraft("professional_need_stages", ["exploring"]).ok).toBe(false);
    const p = resolvePolicy([published("professional_need_priorities", { options: [{ code: "now", label: "Now" }, { code: "later", label: "Later" }] }), published("professional_need_reopen", { value: "off" })]).professionalNeeds;
    expect(p.priorities.map(o => o.label)).toEqual(["Now", "Later"]);
    expect(p.reopen).toBe("off");
    expect(np.categories.some(c => /nurs/i.test(c.label))).toBe(false);
  });
});
