// ASMT-SCORING-INTEGRATION-01 acceptance (owner spec section 11), deterministic, over the acceptance workbook as imported.
// 1 correct profile per instrument, 2 the 0-6 descriptions preserved, 3 grades 3 and 4 both Competent, 4 Yes/Partial/No scoring,
// 5 N/A excluded, 6 unanswered is neither zero nor N/A, 7 critical items override when configured, 8 results without a threshold,
// 9 evidence fields intact, 10 a historical scoring version reproduces, 11 evidence is not verified competence.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readWorkbookGrids } from "./grid";
import { draftWorkbook } from "./workbook";
import { buildInstrumentPlan } from "./to-content";
import { PROFILES, PROPOSED_DECISION_TEMPLATE, applyProfile, chooseProfile, summarizeResult } from "./profiles";
import { toDefinition } from "../studio/assemble";
import { evaluate, hashDoc, rkey, runTests, validateRules, type InstrumentDef, type ResponseScale, type Responses } from "../core";
import type { WorkbookDraft } from "./types";

const grids = readWorkbookGrids(new Uint8Array(readFileSync(join(__dirname, "__fixtures__", "nursing-assessment-audits.xlsx"))));
const base = draftWorkbook(grids, { fileName: "Nursing Assessment Audits.xlsx", sha256: "d".repeat(64), byteSize: 1 }, [{ code: "CA", label: "Competency Assessment", isActive: true }]);
const draft: WorkbookDraft = {
  ...base,
  groups: base.groups.map((g, i) => ({ ...g, family: "CA", purposeCode: "summative", respondentRoles: [i === 0 ? "assessor" : "auditor"], confirmed: true })),
  excluded: base.excluded.map((e) => ({ ...e, confirmed: true })),
};
let n = 0;
const key = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function instrument(i: number) {
  const g = draft.groups[i];
  const plan = buildInstrumentPlan(draft, g, key, "2026-11-04T00:30:00Z");
  const scale: ResponseScale | null = plan.scale ? { code: "S", version_id: "v", scale_kind: "rating", levels: plan.scale.levels.map((l) => ({ ...l })), states: plan.scale.states.map((s) => ({ state: s.state as "not_applicable", label: s.label })) } : null;
  const content = { ...plan.content, items: plan.content.items.map((it) => (it.response_type === "rating_scale" ? { ...it, scale_version_id: "v", scale } : it)) };
  const def: InstrumentDef = toDefinition(content, { instrumentCode: `T${i}`, versionNo: 1 });
  return { g, plan, content, def };
}
const A = instrument(0), B = instrument(1), C = instrument(2);
const all = (def: InstrumentDef, pick: (code: string) => Responses[string], codes: (it: InstrumentDef["items"][number]) => string[]): Responses =>
  Object.fromEntries(def.items.map((it) => [rkey(it.stable_key), pick(codes(it)[0])]));

describe("1. each imported instrument gets the right profile", () => {
  it("rating scale -> graded; documented/observed findings -> weighted agreement; other options -> weighted compliance", () => {
    expect(chooseProfile(A.def)).toBe("graded_assessment");
    expect(chooseProfile(B.def)).toBe("weighted_agreement");
    expect(chooseProfile(C.def)).toBe("weighted_compliance");
    expect(A.plan.scoring.rules?.profile?.id).toBe("graded_assessment");
    expect(B.plan.scoring.rules?.profile?.id).toBe("weighted_agreement");
    expect(C.plan.scoring.rules?.profile?.id).toBe("weighted_compliance");
    expect(A.plan.scoring.deliveryModes).toEqual(["assessor_led"]);
    expect(B.plan.scoring.deliveryModes).toEqual(["auditor_recorded"]);
    expect(C.plan.scoring.deliveryModes).toEqual(["auditor_recorded"]);
  });
});

describe("2 and 3. the 0-6 scale keeps its complete descriptions and the source competence levels", () => {
  it("preserves every achievement description in full and keeps grades 3 and 4 as Competent", () => {
    const levels = A.plan.scale!.levels;
    expect(levels.map((l) => l.code)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    expect(levels[0].description).toBe("Requires training to perform this activity satisfactorily to participate in the clinical environment.");
    expect(levels[6].description).toMatch(/^Can perform this activity with more than acceptable speed and quality, with initiative and adaptability/);
    expect(levels.every((l) => (l.description ?? "").length > 30)).toBe(true);
    expect(levels[3].label).toBe("Competent");
    expect(levels[4].label).toBe("Competent");
    expect(levels[5].label).toBe("Proficient");
    expect(levels[6].label).toBe("Expert");
    expect(levels.map((l) => l.numeric_value)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("4 and 5. Yes = 2, Partial = 1, No = 0, N/A excluded with a reason", () => {
  const rules = B.plan.scoring.rules!;
  const codes = (it: InstrumentDef["items"][number]) => (it.config.options ?? []).map((o) => o.code);
  it("sets the option values on the content and both percentages come out of the engine", () => {
    const opts = B.def.items[0].config.options!;
    expect(Object.fromEntries(opts.map((o) => [o.code, [o.satisfactory, o.credit]]))).toEqual({ yes: [true, 1], partial: [false, 0.5], no: [false, 0] });
    expect(B.def.items.every((it) => it.config.naReasonRequired === true && it.mandatory && (it.config.allowedStates ?? []).includes("not_applicable"))).toBe(true);
    expect(validateRules(B.def, rules).errors).toEqual([]);
    const n = B.def.items.length;
    // two Yes, one Partial, one No, the rest Yes
    const r = all(B.def, () => ({ value: "yes" }), codes);
    r[rkey(B.def.items[2].stable_key)] = { value: "partial" };
    r[rkey(B.def.items[3].stable_key)] = { value: "no" };
    const ev = evaluate(B.def, rules, r);
    expect(ev.aggregates.weighted_pct).toBeCloseTo(((2 * (n - 2) + 1) / (2 * n)) * 100, 6);
    expect(ev.aggregates.full_match_pct).toBeCloseTo(((n - 2) / n) * 100, 6);
    expect(ev.outcome.code).toBe("NOT_CONFIGURED");
  });
  it("excludes a justified N/A from both denominators and never counts it as zero", () => {
    const r = all(B.def, () => ({ value: "yes" }), codes);
    r[rkey(B.def.items[0].stable_key)] = { state: "not_applicable", reason: "not relevant to this patient" };
    r[rkey(B.def.items[1].stable_key)] = { value: "no" };
    const ev = evaluate(B.def, rules, r);
    const n = B.def.items.length - 1;
    expect(ev.aggregates.judged).toBe(n);
    expect(ev.aggregates.weighted_pct).toBeCloseTo(((n - 1) / n) * 100, 6);
    expect(ev.counts.overall.excluded).toBe(1);
    expect(ev.counts.overall.exclusions[0].why).toMatch(/not applicable, excluded/);
  });
  it("every saved test the profile wrote passes on both audits", () => {
    for (const x of [B, C]) {
      const run = runTests(x.def, x.plan.scoring.rules!, x.plan.scoring.tests);
      expect(run.results.filter((t) => !t.ok).map((t) => `${t.name}: ${t.mismatches.join("; ")}`)).toEqual([]);
      expect(run.passed).toBeGreaterThanOrEqual(7);
    }
  });
});

describe("6. unanswered is its own state", () => {
  it("one unanswered item makes the result Not determined, with the percentages still calculated over the answered", () => {
    const r = all(C.def, () => ({ value: "yes" }), (it) => (it.config.options ?? []).map((o) => o.code));
    delete r[rkey(C.def.items[5].stable_key)];
    const ev = evaluate(C.def, C.plan.scoring.rules!, r);
    expect(ev.outcome.code).toBe("NOT_DETERMINED");
    expect(ev.counts.overall.unanswered).toBe(1);
    expect(ev.aggregates.weighted_pct).toBe(100);
    expect(ev.counts.overall.byAnswer["state:not_applicable"]).toBeUndefined();
  });
  it("a graded instrument: nothing answered is Not determined and never an average of 0", () => {
    const ev = evaluate(A.def, A.plan.scoring.rules!, {});
    expect(ev.outcome.code).toBe("NOT_DETERMINED");
    expect(ev.aggregates.average_grade).toBeNull();
  });
});

describe("7. critical items override when configured", () => {
  it("a critical item not met decides the negative outcome through the gate, on a rules document rebuilt for the critical content", () => {
    const content = { ...C.content, items: C.content.items.map((it, i) => (i === 0 ? { ...it, critical: true, mandatory: true, critical_requirements: ["must_be_satisfactory" as const] } : it)) };
    const applied = applyProfile(content, "weighted_compliance", { def: toDefinition(content, { versionNo: 1 }) });
    const def = toDefinition(applied.content, { versionNo: 1 });
    expect(applied.rules.gates?.criticalFail).toBe("CRITICAL_DEFICIENCY");
    expect(validateRules(def, applied.rules).errors).toEqual([]);
    const r = all(def, () => ({ value: "yes" }), (it) => (it.config.options ?? []).map((o) => o.code));
    r[rkey(def.items[0].stable_key)] = { value: "no" };
    const ev = evaluate(def, applied.rules, r);
    expect(ev.outcome.code).toBe("CRITICAL_DEFICIENCY");
    expect(ev.decided_by).toBe("gate:criticalFail");
    expect(ev.aggregates.weighted_pct).toBeCloseTo(((def.items.length - 1) / def.items.length) * 100, 6);
  });
});

describe("8. results are calculated without a pass threshold", () => {
  it("the graded instrument reports average grade and achievement percentage with the interpretation Not configured", () => {
    const r: Responses = Object.fromEntries(A.def.items.map((it, i) => [rkey(it.stable_key), { level_code: String(i % 2 === 0 ? 4 : 3) }]));
    const ev = evaluate(A.def, A.plan.scoring.rules!, r);
    expect(ev.outcome).toMatchObject({ code: "NOT_CONFIGURED", label: "Not configured" });
    expect(ev.aggregates.average_grade).toBeCloseTo(3.5, 1);
    const s = summarizeResult(A.def, A.plan.scoring.rules!, ev, r)!;
    expect(s.interpretation.configured).toBe(false);
    expect(s.calculated.find((l) => l.label === "Achievement percentage")?.value).toMatch(/^58\.\d%|^58%|^59/);
    expect(s.calculated.find((l) => l.label === "Grade distribution")?.value).toMatch(/3 Competent: 31, 4 Competent: 31/);
    expect(validateRules(A.def, A.plan.scoring.rules!).errors).toEqual([]);
    const run = runTests(A.def, A.plan.scoring.rules!, A.plan.scoring.tests);
    expect(run.results.filter((t) => !t.ok).map((t) => `${t.name}: ${t.mismatches.join("; ")}`)).toEqual([]);
  });
  it("the proposed competency decision is a separate template, valid on the graded instrument, and not part of the instrument's rules", () => {
    const t = PROPOSED_DECISION_TEMPLATE.rules();
    expect(validateRules(A.def, t).errors).toEqual([]);
    expect(A.plan.scoring.rules!.rules.some((r) => r.id.includes("minimum_grade"))).toBe(false);
    const r3: Responses = Object.fromEntries(A.def.items.map((it) => [rkey(it.stable_key), { level_code: "3" }]));
    expect(evaluate(A.def, t, r3).outcome.code).toBe("COMPETENT");
    const r2 = { ...r3, [rkey(A.def.items[0].stable_key)]: { level_code: "2" } };
    expect(evaluate(A.def, t, r2).outcome.code).toBe("NOT_YET_COMPETENT");
    expect(evaluate(A.def, A.plan.scoring.rules!, r2).outcome.code).toBe("NOT_CONFIGURED");
  });
});

describe("9. source evidence fields remain intact and the profile's fields are present", () => {
  it("concurrent audit: documented finding, independent finding, discrepancy, action, explainable change, context", () => {
    const keys = B.def.items[0].fields!.map((f) => f.field_key);
    expect(keys).toEqual(["documented_finding", "observed_finding", "discrepancy", "action_needed", "explainable_change", "clinical_context"]);
    expect(B.def.items[0].fields!.find((f) => f.field_key === "documented_finding")?.label).toMatch(/Documented Finding/i);
    expect(B.def.items[0].fields!.find((f) => f.field_key === "explainable_change")?.response_type).toBe("yes_no");
  });
  it("chart audit: policy requirement as the section, criterion as the prompt, deficiency or evidence and record references", () => {
    expect(C.def.sections[0].title).toBe("Timing of Assessments");
    expect(C.def.items[0].prompt).toBe("Initial comprehensive within 24h of admission");
    expect(C.def.items[0].fields!.map((f) => f.field_key)).toEqual(["evidence_comments", "record_reference"]);
    expect(A.def.items[0].fields!.map((f) => f.field_key)).toEqual(["evidence_comments"]);
  });
});

describe("10. a historical scoring version stays reproducible", () => {
  it("the same rules and responses give the same hash and outcome; changed rules change the hash, never the recorded result", () => {
    const r = all(C.def, () => ({ value: "yes" }), (it) => (it.config.options ?? []).map((o) => o.code));
    const v1 = C.plan.scoring.rules!;
    const a = evaluate(C.def, v1, r), b = evaluate(C.def, v1, r);
    expect(a.rules_hash).toBe(hashDoc(v1 as unknown as Record<string, unknown>));
    expect(b.traceHash).toBe(a.traceHash);
    const v2: typeof v1 = { ...v1, rules: [...v1.rules, { id: "target", label: "At least 90", priority: 10, when: { aggregate: "weighted_pct", op: ">=", value: 90 }, then: { outcome: "NOT_CONFIGURED" } }] };
    expect(evaluate(C.def, v2, r).rules_hash).not.toBe(a.rules_hash);
    expect(a.outcome.code).toBe("NOT_CONFIGURED");
  });
});

describe("11. assessment evidence is never automatic competency verification", () => {
  it("no profile outcome is positive, and the summary says the interpretation is not configured", () => {
    for (const x of [A, B, C]) {
      const rules = x.plan.scoring.rules!;
      expect(rules.outcomes.filter((o) => o.class === "positive")).toEqual([]);
      expect(rules.fallback).toBe("NOT_CONFIGURED");
    }
    const r = all(B.def, () => ({ value: "yes" }), (it) => (it.config.options ?? []).map((o) => o.code));
    r[rkey(B.def.items[0].stable_key, "action_needed")] = { value: "Re-check the observation chart" };
    const ev = evaluate(B.def, B.plan.scoring.rules!, r);
    const s = summarizeResult(B.def, B.plan.scoring.rules!, ev, r)!;
    expect(s.calculated[0]).toMatchObject({ label: "Weighted agreement percentage", value: "100%" });
    expect(s.attention.find((a) => a.label === "Corrective actions recorded")?.items).toHaveLength(1);
    expect(s.interpretation.configured).toBe(false);
  });
  it("the profile definitions name their fit and never a profession", () => {
    expect(PROFILES.graded_assessment.unfit(B.def)).toBe("No item rates on a scale.");
    expect(PROFILES.weighted_agreement.unfit(A.def)).toBe("No item answers with Yes / Partial / No.");
  });
});
