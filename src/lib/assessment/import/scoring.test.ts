// Proposed scoring from the acceptance workbook: deterministic, validated by the engine, tests pass by construction, every
// assumption a flag. Also the starter rule sets, validated against the same definitions.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readWorkbookGrids } from "./grid";
import { draftWorkbook } from "./workbook";
import { buildInstrumentPlan } from "./to-content";
import { acceptProposedRules, isProposedRules, patchPartialOptions, proposalSummary, proposeScoring, thresholdFromText } from "./scoring";
import { toDefinition } from "../studio/assemble";
import { runTests, validateRules, type InstrumentDef, type ResponseScale } from "../core";
import { STARTERS } from "../studio/starters";
import type { WorkbookDraft } from "./types";

const grids = readWorkbookGrids(new Uint8Array(readFileSync(join(__dirname, "__fixtures__", "nursing-assessment-audits.xlsx"))));
const base = draftWorkbook(grids, { fileName: "Nursing Assessment Audits.xlsx", sha256: "c".repeat(64), byteSize: 1 }, [{ code: "CA", label: "Competency Assessment", isActive: true }]);
const draft: WorkbookDraft = {
  ...base,
  groups: base.groups.map((g, i) => ({ ...g, family: "CA", purposeCode: "summative", respondentRoles: [i === 0 ? "assessor" : "auditor"], confirmed: true })),
  excluded: base.excluded.map((e) => ({ ...e, confirmed: true })),
};
let n = 0;
const key = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

/** The plan's content as the engine sees it after registration: rating items carry the frozen scale. */
function defOf(groupIndex: number) {
  const g = draft.groups[groupIndex];
  const plan = buildInstrumentPlan(draft, g, key, "2026-11-03T20:00:00Z");
  const scale: ResponseScale | null = plan.scale ? { code: "X", version_id: "v", scale_kind: "rating", levels: plan.scale.levels.map((l) => ({ ...l })), states: plan.scale.states.map((s) => ({ state: s.state as "not_applicable", label: s.label })) } : null;
  const content = { ...plan.content, items: plan.content.items.map((it) => (it.response_type === "rating_scale" ? { ...it, scale_version_id: "v", scale } : it)) };
  const def: InstrumentDef = toDefinition(content, { instrumentCode: "T", versionNo: 1 });
  const sheets = draft.sheets.filter((s) => g.sheets.includes(s.name));
  return { g, plan, content, def, sheets };
}

describe("rating-scale instrument (sheet 1)", () => {
  const { g, def, sheets, plan } = defOf(0);
  const p = proposeScoring({ sheets, def, respondentRoles: g.respondentRoles });
  it("proposes a rating threshold at the middle level, flagged as a neutral default, with assessor-led delivery", () => {
    expect(p.family).toBe("rating");
    expect(p.threshold).toMatchObject({ ordinal: 3, source: "default", label: "Competent" });
    expect(p.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["threshold_default", "rating_threshold_rules", "delivery_mode_proposed"]));
    expect(p.deliveryModes).toEqual(["assessor_led"]);
    expect(isProposedRules(p.rules)).toBe(true);
  });
  it("is valid for the engine and its saved tests pass", () => {
    const v = validateRules(def, p.rules!);
    expect(v.errors).toEqual([]);
    const run = runTests(def, p.rules!, p.tests);
    expect(run.results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.mismatches.join("; ")}`)).toEqual([]);
    expect(run.passed).toBe(5);
  });
  it("never averages ordinals and keeps the scale as imported", () => {
    expect(p.rules!.permitOrdinalMean).toBeUndefined();
    expect(p.rules!.aggregates!.map((a) => a.fn)).toEqual(["min_ordinal", "max_ordinal", "count"]);
    expect(plan.scale!.levels.every((l) => l.satisfactory === null)).toBe(true);
  });
  it("accepting removes the proposal mark and nothing else", () => {
    const a = acceptProposedRules(p.rules!);
    expect(isProposedRules(a)).toBe(false);
    expect(a.rules.map((r) => r.id)).toEqual(["nothing_rated", "all_at_threshold", "some_at_threshold"]);
    expect(validateRules(def, a).errors).toEqual([]);
    expect(proposalSummary(p)).toMatch(/Rating threshold at Competent \(neutral default\)/);
  });
});

describe("audits with Yes / No / Partial (sheets 2 and 3)", () => {
  for (const gi of [1, 2]) {
    const { g, def, content, sheets, plan } = defOf(gi);
    const p = plan.scoring;
    it(`${g.title}: compliance percentage with N/A excluded, Partial counted as not met and flagged, auditor-recorded delivery`, () => {
      expect(p.family).toBe("compliance");
      expect(p.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["partial_counted_not_met", "compliance_percentage", "threshold_default", "delivery_mode_proposed"]));
      expect(p.deliveryModes).toEqual(["auditor_recorded"]);
      expect(p.rules!.defaults).toEqual({ na: "exclude", undeterminable: "exclude" });
      expect(validateRules(def, p.rules!).errors).toEqual([]);
      const run = runTests(def, p.rules!, p.tests);
      expect(run.results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.mismatches.join("; ")}`)).toEqual([]);
      expect(run.passed).toBe(4);
    });
    it(`${g.title}: the plan's content already counts Partial as not met (the workbook defines nothing else), and the sheet still records it as undefined`, () => {
      expect(content.items[0].config.options?.find((o) => o.code === "partial")?.satisfactory).toBe(false);
      expect(sheets[0].response.options.find((o) => o.code === "partial")?.satisfactory).toBeNull();
      expect(patchPartialOptions(content).changed).toEqual([]);
    });
  }
  it("patchPartialOptions marks only options without a met or not met meaning", () => {
    const { content } = defOf(2);
    const raw = { ...content, items: content.items.map((it) => ({ ...it, config: { ...it.config, options: it.config.options?.map((o) => (o.code === "partial" ? { ...o, satisfactory: null } : o)) } })) };
    const r = patchPartialOptions(raw);
    expect(r.changed).toEqual(["Partial"]);
    expect(r.content.items.every((it) => it.config.options?.every((o) => typeof o.satisfactory === "boolean"))).toBe(true);
    expect(r.content.items[0].config.options?.find((o) => o.code === "yes")?.satisfactory).toBe(true);
  });
});

describe("thresholds from text", () => {
  it("reads an explicit threshold sentence and ignores descriptions that name no level", () => {
    expect(thresholdFromText(["A minimum score of 4 is required to pass."], ["0", "1", "2", "3", "4", "5", "6"])).toEqual({ value: "4", text: "A minimum score of 4 is required to pass." });
    expect(thresholdFromText(["Can perform this activity satisfactorily without supervision."], ["0", "1", "2", "3"])).toBeNull();
    expect(thresholdFromText(["Pass level 9"], ["0", "1", "2"])).toBeNull();
  });
  it("proposes no scoring and says so when the items carry no rating or compliance answers", () => {
    const def: InstrumentDef = { version_no: 1, groups: [], sections: [], items: [] };
    const p = proposeScoring({ sheets: [], def, respondentRoles: [] });
    expect(p.family).toBe("none");
    expect(p.rules).toBeNull();
    expect(p.flags.map((f) => f.code)).toEqual(["delivery_mode_missing", "no_scoring_proposed"]);
  });
});

describe("starter rule sets", () => {
  it("are valid against a rating instrument and a compliance audit", () => {
    const r = defOf(0).def;
    const c = toDefinition(patchPartialOptions(defOf(2).content).content, { instrumentCode: "T", versionNo: 1 });
    for (const s of STARTERS) {
      expect(s.unfit(r), `${s.id} fits rating`).toBeNull();
      expect(validateRules(r, s.build(r)).errors, `${s.id} on rating`).toEqual([]);
      if (s.id === "rating_threshold") { expect(s.unfit(c)).toBe("No item rates on a scale."); continue; }
      expect(s.unfit(c), `${s.id} fits compliance`).toBeNull();
      expect(validateRules(c, s.build(c)).errors, `${s.id} on compliance`).toEqual([]);
    }
    expect(STARTERS.find((s) => s.id === "rating_threshold")!.build(r).rules.find((x) => x.id === "all_at_threshold")?.when).toEqual({ aggregate: "lowest", op: ">=", value: 3 });
  });
});
