// Proposed scoring from the acceptance workbook: deterministic, validated by the engine, tests pass by construction, every
// assumption a flag. Also the starter rule sets, validated against the same definitions.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readWorkbookGrids } from "./grid";
import { draftWorkbook } from "./workbook";
import { buildInstrumentPlan } from "./to-content";
import { acceptProposedRules, isProposedRules, patchPartialOptions, proposalSummary, proposeScoring } from "./scoring";
import { toDefinition } from "../studio/assemble";
import { validateRules, type InstrumentDef, type ResponseScale } from "../core";
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

describe("the import proposal is a scoring profile", () => {
  const { g, def, sheets, plan } = defOf(0);
  it("sheet 1 gets the graded profile with the average grade, marked proposed, delivery assessor-led", () => {
    const p = proposeScoring({ sheets, def, respondentRoles: g.respondentRoles, levels: plan.scale?.levels ?? null });
    expect(p.profileId).toBe("graded_assessment");
    expect(p.rules?.profile?.id).toBe("graded_assessment");
    expect(p.rules?.aggregates?.map((a) => a.fn)).toEqual(["mean_numeric", "count", "min_ordinal"]);
    expect(p.rules?.permitOrdinalMean).toBe(true);
    expect(p.deliveryModes).toEqual(["assessor_led"]);
    expect(isProposedRules(p.rules)).toBe(true);
    expect(p.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["profile_applied", "interpretation_not_configured", "delivery_mode_proposed"]));
    expect(plan.scale!.levels.every((l) => l.satisfactory === null)).toBe(true);
  });
  it("accepting removes the proposal mark and nothing else", () => {
    const a = acceptProposedRules(plan.scoring.rules!);
    expect(isProposedRules(a)).toBe(false);
    expect(a.rules.map((r) => r.id)).toEqual(["unanswered", "nothing_graded"]);
    expect(validateRules(def, a).errors).toEqual([]);
    expect(proposalSummary(plan.scoring)).toMatch(/Graded assessment.*Not configured/);
  });
  it("the two audits get the weighted profiles", () => {
    expect(defOf(1).plan.scoring.profileId).toBe("weighted_agreement");
    expect(defOf(2).plan.scoring.profileId).toBe("weighted_compliance");
    expect(defOf(2).plan.scoring.rules?.aggregates?.map((a) => a.id)).toEqual(["weighted_pct", "full_match_pct", "judged"]);
  });
  it("patchPartialOptions marks only options without a met or not met meaning", () => {
    const { content } = defOf(2);
    const raw = { ...content, items: content.items.map((it) => ({ ...it, config: { ...it.config, options: it.config.options?.map((o) => (o.code === "partial" ? { ...o, satisfactory: null } : o)) } })) };
    const r = patchPartialOptions(raw);
    expect(r.changed).toEqual(["Partial"]);
    expect(r.content.items.every((it) => it.config.options?.every((o) => typeof o.satisfactory === "boolean"))).toBe(true);
  });
  it("proposes nothing when the items carry no rating or choice answers", () => {
    const empty: InstrumentDef = { version_no: 1, groups: [], sections: [], items: [] };
    const p = proposeScoring({ sheets: [], def: empty, respondentRoles: [] });
    expect(p.family).toBe("none");
    expect(p.rules).toBeNull();
    expect(p.flags.map((f) => f.code)).toEqual(["no_scoring_proposed"]);
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
