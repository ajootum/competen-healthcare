/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { caseClosing, endsOnReaching, learnerView, stageGuidance, validateBlueprint, type Blueprint } from "./blueprint";
import { STAGE_CATEGORIES } from "./categories";
import { applyAnswer, findLibraryCases } from "./library";
import { gapsFromResults, rankLibraryCases, scoreCase } from "./ranking";
import { authorSystem, professionPhrase } from "./studio";
import { MINIMAL_S4 } from "./fixtures";
import { offeringOn } from "./offering-switch";
import { CASE_BLUEPRINT_SYSTEM } from "../individual/scholar/generation";
import { blueprintFromDraft } from "../individual/scholar/clinical";
import { policyPath, resolvePolicy, validateDraft } from "../individual/policy";

const policyFor = (published: unknown) => resolvePolicy(published === undefined ? [] : [{ config_path: policyPath("scholar_case_contribution"), published }]);

// SCHOLAR-INTELLIGENCE-COMPLETE-01: standard stage categories, optional reasoning sections, "explain your choice",
// the reflection ending, relevance ranking, the contribution switch and the profession-neutral prompts.

const withStage = (patch: Record<string, unknown>, i = 0): Blueprint => ({ ...MINIMAL_S4, stages: MINIMAL_S4.stages.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
const CAT: Blueprint = {
  ...MINIMAL_S4,
  stages: [
    { id: "s1", title: "Weigh the options", reveals: [], decisionPointIds: ["d1"], category: "differentials" },
    { id: "s2", title: "Plan the care", reveals: [], decisionPointIds: ["d2"], category: "management" },
    { id: "s3", title: "Looking back", reveals: [], decisionPointIds: [], category: "reflection", narrativeHint: "What would you change next time?" },
  ],
  differentials: [{ label: "Pneumonia", reasoning: "Fever and cough fit." }, { label: "Embolus", reasoning: "Pleuritic pain would fit." }],
  managementPrinciples: ["Escalate early."],
  expectedReasoning: "Recognise, interpret, then act.",
};

describe("old cases stay valid; new fields are optional", () => {
  it("the existing private fixture validates as before", () => {
    expect(validateBlueprint(MINIMAL_S4, "private")).toEqual([]);
  });
  it("an old stored shape (no category, no sections, no askReason, a narrativeHint of any kind) is untouched", () => {
    const old = withStage({ narrativeHint: "" });
    expect(validateBlueprint(old, "private")).toEqual([]);
  });
});

describe("stage categories", () => {
  it("accepts every standard category, and null or absent", () => {
    for (const c of STAGE_CATEGORIES) expect(validateBlueprint(withStage({ category: c }), "private")).toEqual([]);
    expect(validateBlueprint(withStage({ category: null }), "private")).toEqual([]);
  });
  it("refuses an unknown category", () => {
    expect(validateBlueprint(withStage({ category: "triage" }), "private").join(" ")).toMatch(/stage s1: category must be one of/);
    expect(validateBlueprint(withStage({ category: 3 }), "private").join(" ")).toMatch(/category must be one of/);
  });
  it("the learner view carries the category label with the title", () => {
    const v = learnerView(CAT, { reachedStageIds: ["s1"], revealedFactIds: [] }, "salt");
    expect(v.stages[0]).toMatchObject({ title: "Weigh the options", category: "differentials", categoryLabel: "Differentials" });
    expect(learnerView(MINIMAL_S4, { reachedStageIds: ["s1"], revealedFactIds: [] }, "salt").stages[0]).toMatchObject({ category: null, categoryLabel: null, guidance: null });
  });
});

describe("optional reasoning sections", () => {
  it("accepts well-formed sections and refuses malformed ones", () => {
    expect(validateBlueprint(CAT, "private")).toEqual([]);
    expect(validateBlueprint({ ...MINIMAL_S4, differentials: [{ label: "", reasoning: "x" }] }, "private").join(" ")).toMatch(/differentials: each needs a label/);
    expect(validateBlueprint({ ...MINIMAL_S4, differentials: Array.from({ length: 13 }, () => ({ label: "a", reasoning: "b" })) }, "private").join(" ")).toMatch(/differentials: a list of up to 12/);
    expect(validateBlueprint({ ...MINIMAL_S4, managementPrinciples: ["ok", ""] }, "private").join(" ")).toMatch(/managementPrinciples/);
    expect(validateBlueprint({ ...MINIMAL_S4, managementPrinciples: "escalate" }, "private").join(" ")).toMatch(/managementPrinciples/);
    expect(validateBlueprint({ ...MINIMAL_S4, expectedReasoning: "x".repeat(4001) }, "private").join(" ")).toMatch(/expectedReasoning/);
  });
  it("fact.kind investigation is a valid kind (type-level) and does not disturb validation", () => {
    const b: Blueprint = { ...MINIMAL_S4, facts: [{ id: "f1", kind: "investigation", label: "Chest X-ray", value: "Requested", revealedAt: "request", safetyCritical: false }] };
    expect(validateBlueprint(b, "private")).toEqual([]);
  });
  it("differentials show their labels on reaching the stage and their reasoning once it is behind the learner", () => {
    const at = stageGuidance(CAT, CAT.stages[0], ["s1"]);
    expect(at).toEqual({ differentials: [{ label: "Pneumonia" }, { label: "Embolus" }] });
    const after = stageGuidance(CAT, CAT.stages[0], ["s1", "s2"]);
    expect(after?.differentials?.[0]).toEqual({ label: "Pneumonia", reasoning: "Fever and cough fit." });
  });
  it("management principles appear only after the management stage is finished; expected reasoning never in a stage", () => {
    expect(stageGuidance(CAT, CAT.stages[1], ["s1", "s2"])).toBeNull();
    expect(stageGuidance(CAT, CAT.stages[1], ["s1", "s2", "s3"])).toEqual({ managementPrinciples: ["Escalate early."] });
    expect(JSON.stringify(learnerView(CAT, { reachedStageIds: ["s1", "s2", "s3"], revealedFactIds: [] }, "salt"))).not.toContain("Recognise, interpret, then act.");
  });
  it("the closing holds everything, and the reflection stage's narrativeHint is the prompt", () => {
    expect(caseClosing(CAT)).toEqual({
      reflectionPrompt: "What would you change next time?", differentials: CAT.differentials, managementPrinciples: ["Escalate early."], expectedReasoning: "Recognise, interpret, then act.",
    });
    expect(caseClosing(MINIMAL_S4)).toEqual({ reflectionPrompt: null, differentials: [], managementPrinciples: [], expectedReasoning: null });
  });
  it("a reflection stage with no decision ends the case on being reached", () => {
    expect(endsOnReaching(CAT, "s3")).toBe(true);
    expect(endsOnReaching(CAT, "s2")).toBe(false);
    const s2 = { reached_stage_ids: ["s1", "s2"], revealed_fact_ids: [], answers: [{ decisionPointId: "d1", chosen: ["a"], at: "t", safety: 0 }] };
    expect(applyAnswer(CAT, s2, "d2", ["a"], null, "t")).toMatchObject({ reached: ["s1", "s2", "s3"], completed: true });
  });
});

describe("explain your choice", () => {
  const ASK: Blueprint = { ...MINIMAL_S4, decisionPoints: MINIMAL_S4.decisionPoints.map(d => (d.id === "d1" ? { ...d, askReason: true } : d)) };
  const fresh = { reached_stage_ids: ["s1"], revealed_fact_ids: [] as string[], answers: [] as any[] };
  it("askReason must be a boolean", () => {
    expect(validateBlueprint(ASK, "private")).toEqual([]);
    expect(validateBlueprint({ ...MINIMAL_S4, decisionPoints: MINIMAL_S4.decisionPoints.map(d => ({ ...d, askReason: "yes" as any })) }, "private").join(" ")).toMatch(/askReason is true or false/);
  });
  it("the learner view says which decisions ask", () => {
    const v = learnerView(ASK, { reachedStageIds: ["s1"], revealedFactIds: [] }, "salt");
    expect(v.stages[0].decisionPoints[0].askReason).toBe(true);
  });
  it("a library answer keeps the reason beside the choice, only where the decision asks, capped, and marking is untouched", () => {
    const r: any = applyAnswer(ASK, fresh, "d1", ["a"], null, "t", "  Airway first.  ");
    expect(r.answers[0]).toMatchObject({ decisionPointId: "d1", chosen: ["a"], reason: "Airway first." });
    const same: any = applyAnswer(ASK, fresh, "d1", ["a"], null, "t", null);
    expect(same.answers[0].reason).toBeUndefined();
    expect(same.reached).toEqual(r.reached);
    const noAsk: any = applyAnswer(MINIMAL_S4, fresh, "d1", ["a"], null, "t", "ignored");
    expect(noAsk.answers[0].reason).toBeUndefined();
    const long: any = applyAnswer(ASK, fresh, "d1", ["a"], null, "t", "x".repeat(3000));
    expect(long.answers[0].reason).toHaveLength(1000);
  });
});

describe("relevance ranking (pure)", () => {
  const A = "aaaaaaaa-0000-4000-8000-000000000001", B = "bbbbbbbb-0000-4000-8000-000000000002", C = "cccccccc-0000-4000-8000-000000000003";
  const cases = [
    { id: "newest", title: "Wound care review", level: "advanced", competencyIds: [C], objectives: ["Dress a wound"] },
    { id: "match", title: "Sepsis on the ward", level: "foundation", competencyIds: [A], objectives: ["Escalate sepsis"] },
    { id: "gap", title: "Fluid balance", level: "intermediate", competencyIds: [B], objectives: ["Chart fluids"] },
  ];
  it("score = 3 x competency + 2 x topic + 3 x gap + level fit", () => {
    const s = scoreCase(cases[1], { competencyIds: [A], topic: "sepsis ward", gaps: { competencyIds: [A] }, level: "foundation" });
    expect(s.score).toBeCloseTo(3 + 2 + 3 + 1);
    expect(s.why).toEqual(["Teaches the competency you asked for", "Matches your topic", "Targets a gap in your latest evaluation", "Pitched at your level"]);
    expect(scoreCase(cases[0], { level: "foundation" }).score).toBe(-1);                              // two steps apart
    expect(scoreCase(cases[2], { level: "foundation" }).score).toBe(0);                               // one step, unknown fit
    expect(scoreCase(cases[0], {}).score).toBe(0);
  });
  it("orders by score; equal scores keep the order given (newest first)", () => {
    expect(rankLibraryCases(cases, { competencyIds: [A] }).map(c => c.id)).toEqual(["match", "newest", "gap"]);
    expect(rankLibraryCases(cases, {}).map(c => c.id)).toEqual(["newest", "match", "gap"]);
  });
  it("a learner gap lifts a case that teaches it", () => {
    expect(rankLibraryCases(cases, { gaps: { competencyIds: [B] } })[0].id).toBe("gap");
  });
  it("a gap label sharing a long word is a weaker match", () => {
    const s = scoreCase(cases[2], { gaps: { labels: ["Fluid chart accuracy"] } });
    expect(s.score).toBe(1.5);
    expect(s.why).toEqual(["Related to a gap in your latest evaluation"]);
  });
  it("reads a stored evaluation's gaps: competency and outcome keys, labels", () => {
    expect(gapsFromResults({ gaps: [{ kind: "competency", key: A, label: "Sepsis" }, { kind: "section", key: "chunk", label: "Notes, p2" }] })).toEqual({ competencyIds: [A], labels: ["Sepsis", "Notes, p2"] });
    expect(gapsFromResults({})).toBeUndefined();
    expect(gapsFromResults(null)).toBeUndefined();
  });
});

describe("findLibraryCases filters as before, then ranks and delivery-checks in rank order", () => {
  const COMP_A = "aaaaaaaa-0000-4000-8000-000000000001", COMP_B = "bbbbbbbb-0000-4000-8000-000000000002";
  function fake(deliverable: (id: string) => boolean) {
    const rows: Record<string, any[]> = {
      practice_platform_flags: [{ flag: "case_library", enabled: true }],
      workspace_config_overrides: [],
      case_library_version: [
        { id: "v1", case_id: "k1", state: "published", level: "intermediate", risk: "standard", published_at: "3", content: { title: "Wound care", learningObjectives: [{ text: "Dress" }] } },
        { id: "v2", case_id: "k2", state: "published", level: "intermediate", risk: "standard", published_at: "2", content: { title: "Sepsis ward", learningObjectives: [{ text: "Escalate" }] } },
        { id: "v3", case_id: "k3", state: "published", level: "intermediate", risk: "standard", published_at: "1", content: { title: "Fluids", learningObjectives: [] } },
      ],
      case_library_version_competency: [{ version_id: "v1", competency_id: COMP_B }, { version_id: "v2", competency_id: COMP_A }, { version_id: "v3", competency_id: COMP_B }],
      case_library_case: [{ id: "k1", code: "C1", status: "active" }, { id: "k2", code: "C2", status: "active" }, { id: "k3", code: "C3", status: "active" }],
    };
    const checked: string[] = [];
    const builder = (t: string) => {
      let r = rows[t] ?? [];
      const b: any = {
        select: () => b, eq: (c: string, v: any) => { r = r.filter(x => x[c] === v); return b; }, in: (c: string, v: any[]) => { r = r.filter(x => v.includes(x[c])); return b; },
        order: () => b, limit: () => b, maybeSingle: async () => ({ data: r[0] ?? null, error: null }),
        then: (res: any) => res({ data: r, error: null }),
      };
      return b;
    };
    return { admin: { from: builder, rpc: async (_fn: string, a: any) => { checked.push(a.p_version); return { data: deliverable(a.p_version), error: null }; } } as any, checked };
  }
  it("ranks the learner's gap first and checks delivery in that order, skipping an undeliverable one", async () => {
    const f = fake(id => id !== "v2");
    const out = await findLibraryCases(f.admin, { competencyIds: [COMP_A, COMP_B], gaps: { competencyIds: [COMP_A] } });
    expect(f.checked[0]).toBe("v2");                                                                // best first: nothing is checked ahead of it
    expect(out!.map(o => o.versionId)).toEqual(["v1", "v3"]);                                       // v2 refused by the delivery check, never offered
    expect(out![0].why).toBeDefined();
    expect(Object.keys(out![0])).not.toContain("objectives");                                        // nothing of the blueprint leaks into an offer
  });
  it("still filters: a competency nobody teaches offers nothing", async () => {
    const f = fake(() => true);
    expect(await findLibraryCases(f.admin, { competencyIds: ["dddddddd-0000-4000-8000-000000000004"] })).toEqual([]);
  });
  it("a learner gap puts its case first", async () => {
    const f = fake(() => true);
    const out = await findLibraryCases(f.admin, { gaps: { competencyIds: [COMP_A] } });
    expect(out![0].versionId).toBe("v2");
    expect(out![0].why).toContain("Targets a gap in your latest evaluation");
  });
});

describe("contribution switch", () => {
  it("follows the case library switch when unset, and off stops offers only", () => {
    expect(offeringOn(true, {})).toBe(true);                       // absent = follows case_library (on)
    expect(offeringOn(false, {})).toBe(false);                     // library off = off, as before
    expect(offeringOn(true, { scholarCaseContribution: "on" })).toBe(true);
    expect(offeringOn(true, { scholarCaseContribution: "off" })).toBe(false);
    expect(offeringOn(false, { scholarCaseContribution: "on" })).toBe(false);   // can never open what the library keeps shut
  });
  it("the policy resolves an unset or invalid value to on (follows), and off only when published", () => {
    expect(policyFor(undefined).scholarCaseContribution).toBe("on");
    expect(validateDraft("scholar_case_contribution", "off")).toMatchObject({ ok: true, settings: { value: "off" } });
    expect(validateDraft("scholar_case_contribution", "sometimes").ok).toBe(false);
    expect(policyFor({ value: "off" }).scholarCaseContribution).toBe("off");
    expect(policyFor({ value: "maybe" }).scholarCaseContribution).toBe("on");
    expect(policyFor(undefined).scholarCaseContribution).toBe("on");
  });
});

describe("profession-neutral prompts", () => {
  it("the educator draft prompt names the case's profession when known and the health professions otherwise, never nursing by default", () => {
    expect(authorSystem()).not.toMatch(/nurse/i);
    expect(authorSystem()).toContain("educators in the health professions");
    expect(authorSystem(["Physiotherapist", "Occupational therapist"])).toContain("educators in Physiotherapist, Occupational therapist");
    expect(professionPhrase([" ", ""])).toBe("the health professions");
  });
  it("both prompts ask for the standard categories in order, never forced", () => {
    for (const p of [authorSystem(["Midwife"]), CASE_BLUEPRINT_SYSTEM]) {
      for (const c of STAGE_CATEGORIES) expect(p).toContain(c);
      expect(p).toMatch(/never force/i);
    }
    expect(CASE_BLUEPRINT_SYSTEM).not.toMatch(/\bnurse/i);
  });
  it("a private draft keeps a known stage category and drops an unknown one; a plain title still works", () => {
    const b = blueprintFromDraft({
      title: "t", stages: ["Plain stage", { title: "Look at results", category: "investigations" }, { title: "Odd", category: "triage" }],
      decisions: [1, 2, 3].map(n => ({ stage: n, prompt: `Q${n}`, kind: "single", options: [{ text: "a", correct: true }, { text: "b", correct: false }], rationale: "r" })),
    }, { passages: [], competencies: [] })!;
    expect(b.stages.map(s => s.category)).toEqual([undefined, "investigations", undefined]);
    expect(validateBlueprint(b, "private")).toEqual([]);
  });
});
