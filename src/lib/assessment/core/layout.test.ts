import { describe, expect, it } from "vitest";
import { GUIDED_ASSESSMENT_LAYOUT, STANDARD_CHECKLIST_LAYOUT, resolveView, type Breakpoint } from "./layout";
import { validateLayout } from "./validate";
import { evaluate } from "./scoring";
import { BEDSIDE_AUDIT, BEDSIDE_RULES, CHART_AUDIT, HH_AUDIT, RA, RESP_ASSESS, RESP_RULES, uid } from "./fixtures";
import { presetAllSatisfactory } from "./testing";
import type { LayoutDoc } from "./rules-ast";
import type { InstrumentDef, Responses } from "./types";

const DEFS: [string, InstrumentDef][] = [["RESP", RESP_ASSESS], ["HH", HH_AUDIT], ["BEDSIDE", BEDSIDE_AUDIT], ["CHART", CHART_AUDIT]];
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code);

const rich = (): LayoutDoc => ({
  ...clone(STANDARD_CHECKLIST_LAYOUT),
  header: ["TitleBlock", "ContextBlock", "MetadataBlock", "ProgressBlock"],
  metadata: { fields: [{ key: "subject", label: "Subject" }, { key: "unit", label: "Unit" }, { key: "target_stage", label: "Target stage" }] },
  navigation: { mode: "section_tabs", unit: "section", progress: "count", allowJump: true, prevNext: true, sectionTabs: { counts: true } },
  outcomePreview: { enabled: true, label: "Evaluate" },
});

describe("validateLayout: the built-in layouts and the new vocabulary are valid", () => {
  it("Standard Checklist and Guided Assessment", () => {
    expect(validateLayout(STANDARD_CHECKLIST_LAYOUT, RESP_ASSESS, { forPublication: true }).errors).toEqual([]);
    expect(validateLayout(GUIDED_ASSESSMENT_LAYOUT, RESP_ASSESS, { forPublication: true }).errors).toEqual([]);
  });
  it("ContextBlock, MetadataBlock, fields grid, section tabs with counts, outcome preview", () => {
    const l = rich();
    l.item.slots.fields = "grid2";
    expect(validateLayout(l, BEDSIDE_AUDIT).errors).toEqual([]);
  });
});

describe("(planted) a layout can never select, hide or reorder items", () => {
  const withKey = (path: string[], key: string, value: unknown): LayoutDoc => {
    const l = clone(STANDARD_CHECKLIST_LAYOUT) as unknown as Record<string, unknown>;
    let o = l;
    for (const p of path) o = o[p] as Record<string, unknown>;
    o[key] = value;
    return l as unknown as LayoutDoc;
  };
  it.each([
    [[], "items", ["a"]], [[], "hide", ["a"]], [[], "order", ["b", "a"]], [["item"], "where", { critical: false }],
    [["section"], "filter", "x"], [["navigation"], "skip", ["a"]], [["item", "slots"], "include", ["a"]], [["breakpoints", "mobile"], "hidden", true],
    [["print"], "only", "critical"], [[], "selector", { scope: "all" }],
  ])("%j key %s is refused with its own code", (path, key, value) => {
    const v = validateLayout(withKey(path as string[], key as string, value), RESP_ASSESS);
    expect(v.errors.some((e) => e.code === "layout_item_selector" && e.path.endsWith(key as string))).toBe(true);
  });
  it("an unknown component is an error", () => {
    const l = clone(STANDARD_CHECKLIST_LAYOUT) as LayoutDoc;
    (l.item as { component: string }).component = "MagicRow";
    (l.header as string[]).push("Banner");
    (l.controls as Record<string, string>).yes_no = "dropdown";
    (l.controls as Record<string, string>).bogus_type = "segmented";
    const c = codes(validateLayout(l, RESP_ASSESS));
    expect(c.filter((x) => x === "unknown_component").length).toBeGreaterThanOrEqual(3);
    expect(c).toContain("unknown_key");
  });
  it("breakpoints may only change look", () => {
    const l = clone(STANDARD_CHECKLIST_LAYOUT) as LayoutDoc;
    (l.breakpoints!.mobile as Record<string, unknown>).items = [];
    expect(codes(validateLayout(l))).toContain("layout_item_selector");
  });
  it("and the renderer still draws every item when handed a hostile layout", () => {
    const l = clone(STANDARD_CHECKLIST_LAYOUT) as unknown as Record<string, unknown>;
    l.hide = [RA.k1]; l.items = [RA.k2]; l.order = [RA.ap1];
    (l.item as Record<string, unknown>).where = { critical: true };
    const v = resolveView(RESP_ASSESS, l as unknown as LayoutDoc, {});
    expect(v.itemKeys.sort()).toEqual(RESP_ASSESS.items.map((i) => i.stable_key).sort());
  });
});

describe("presentation availability", () => {
  it("accepted by the schema but not publishable yet", () => {
    const l = { ...clone(STANDARD_CHECKLIST_LAYOUT), presentation: "competency_matrix" } as LayoutDoc;
    expect(validateLayout(l).errors).toEqual([]);
    expect(validateLayout(l).warnings.map((w) => w.code)).toContain("presentation_not_available");
    const pub = validateLayout(l, undefined, { forPublication: true });
    expect(pub.errors.map((e) => e.code)).toContain("presentation_not_available");
    expect(pub.errors[0].message).toMatch(/not yet available/);
  });
  it("shape errors", () => {
    expect(codes(validateLayout({ ...clone(STANDARD_CHECKLIST_LAYOUT), schema: "nope" } as unknown as LayoutDoc))).toContain("bad_schema");
    expect(codes(validateLayout({ ...clone(STANDARD_CHECKLIST_LAYOUT), header: ["MetadataBlock"] } as LayoutDoc))).toContain("metadata_missing");
    expect(codes(validateLayout({ ...clone(STANDARD_CHECKLIST_LAYOUT), presentation: "wall_chart" } as unknown as LayoutDoc))).toContain("unknown_presentation");
  });
});

describe("every item is rendered, in both presentations, at every breakpoint and grouping", () => {
  const layouts: [string, LayoutDoc][] = [["standard", STANDARD_CHECKLIST_LAYOUT], ["guided", GUIDED_ASSESSMENT_LAYOUT], ["guided by section", { ...clone(GUIDED_ASSESSMENT_LAYOUT), navigation: { ...GUIDED_ASSESSMENT_LAYOUT.navigation, unit: "section" } }], ["tabs", rich()]];
  const bps: Breakpoint[] = ["desktop", "tablet", "mobile"];
  const groupings = ["section", "group", "section_then_group"] as const;
  for (const [dn, def] of DEFS) for (const [ln, layout] of layouts) for (const g of groupings) for (const bp of bps) {
    it(`${dn} / ${ln} / ${g} / ${bp}`, () => {
      const v = resolveView(def, { ...layout, grouping: g }, {}, null, { breakpoint: bp });
      const all = def.items.map((i) => i.stable_key).sort();
      expect(v.itemKeys.slice().sort()).toEqual(all);
      expect(v.blocks.flatMap((b) => b.items.map((i) => i.key)).sort()).toEqual(all); // exactly once each
      expect(v.steps.flatMap((s) => s.itemKeys).sort()).toEqual(all);
      expect(v.progress.total).toBe(def.items.length);
    });
  }
});

describe("Standard Checklist and Guided Assessment", () => {
  it("standard scrolls and shows all items; guided steps one item at a time", () => {
    const s = resolveView(RESP_ASSESS, STANDARD_CHECKLIST_LAYOUT, {});
    expect(s.mode).toBe("scroll");
    expect(s.blocks.map((b) => b.items.length)).toEqual([4, 1]);
    const g = resolveView(RESP_ASSESS, GUIDED_ASSESSMENT_LAYOUT, {}, null, { currentStep: 2 });
    expect(g.mode).toBe("stepper");
    expect(g.steps).toHaveLength(5);
    expect(g.steps.every((x) => x.itemKeys.length === 1)).toBe(true);
    expect(g.step).toMatchObject({ index: 2, total: 5, prevKey: g.steps[1].key, nextKey: g.steps[3].key });
    expect(resolveView(RESP_ASSESS, GUIDED_ASSESSMENT_LAYOUT, {}, null, { currentStep: 99 }).step.nextKey).toBeNull();
    expect(resolveView(RESP_ASSESS, GUIDED_ASSESSMENT_LAYOUT, {}, null, { currentStep: -4 }).step.prevKey).toBeNull();
  });
  it("switching presentation loses nothing: the same responses show in both", () => {
    const r: Responses = { [RA.k1]: { level_code: "L4" }, [RA.cs1]: { state: "not_observed" } };
    const s = resolveView(RESP_ASSESS, STANDARD_CHECKLIST_LAYOUT, r);
    const g = resolveView(RESP_ASSESS, GUIDED_ASSESSMENT_LAYOUT, r);
    const pick = (v: typeof s) => v.items.map((i) => [i.key, i.response]);
    expect(pick(g)).toEqual(pick(s));
    expect(s.items.find((i) => i.key === RA.k1)!.response).toEqual({ level_code: "L4" });
  });
});

describe("indicators", () => {
  it("completed, unassessed, critical, missing evidence", () => {
    const r: Responses = { [RA.k1]: { level_code: "L4" }, [RA.cs1]: { level_code: "L1" }, [RA.ap1]: { level_code: "L5" } };
    const v = resolveView(RESP_ASSESS, STANDARD_CHECKLIST_LAYOUT, r);
    expect(v.progress).toMatchObject({ total: 5, completed: 3, unassessed: 2, missingEvidence: 1 });
    expect(v.progress.critical).toEqual({ total: 1, failed: 1, unanswered: 0 });
    const item = v.items.find((i) => i.key === RA.cs1)!;
    expect(item.status).toMatchObject({ criticalFailed: true, complete: true });
    expect(v.items.find((i) => i.key === RA.ap1)!.status.missingEvidence).toBe(true);
    expect(resolveView(RESP_ASSESS, STANDARD_CHECKLIST_LAYOUT, r, null, { evidenceCounts: { [RA.ap1]: 1 } }).progress.missingEvidence).toBe(0);
  });
  it("badges are the layout's choice limited to those that apply", () => {
    const v = resolveView(RESP_ASSESS, STANDARD_CHECKLIST_LAYOUT, {});
    expect(v.items.find((i) => i.key === RA.cs1)!.badges).toEqual(["critical", "method", "group"]);
    expect(v.items.find((i) => i.key === RA.k2)!.badges).toEqual(["group"]);
    const l = clone(STANDARD_CHECKLIST_LAYOUT); l.item.slots.badges = ["critical"];
    expect(resolveView(RESP_ASSESS, l, {}).items.find((i) => i.key === RA.cs1)!.badges).toEqual(["critical"]);
  });
});

describe("controls: the rating scale shows every level's anchored descriptor", () => {
  it("label and description for each level, in ordinal order", () => {
    const v = resolveView(RESP_ASSESS, STANDARD_CHECKLIST_LAYOUT, {});
    const it = v.items.find((i) => i.key === RA.k1)!;
    expect(it.control).toBe("segmented");
    expect(it.options.map((o) => o.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(it.options.every((o) => o.label && o.description)).toBe(true);
    expect(it.options[3]).toMatchObject({ code: "L3", label: "3 Advanced beginner" });
  });
  it("the layout may choose a control from the closed list, and a bad choice falls back", () => {
    const l = clone(STANDARD_CHECKLIST_LAYOUT); l.controls = { rating_scale: "radio_list", yes_no: "select" };
    const v = resolveView(RESP_ASSESS, l, {});
    expect(v.items.find((i) => i.key === RA.k1)!.control).toBe("radio_list");
    const h = resolveView(HH_AUDIT, l, {});
    expect(h.items.find((i) => i.key === uid(211))!.control).toBe("segmented");
    expect(h.items.find((i) => i.key === uid(211))!.options.map((o) => o.code)).toEqual(["yes", "no"]);
  });
  it("state labels come from the field", () => {
    const v = resolveView(BEDSIDE_AUDIT, STANDARD_CHECKLIST_LAYOUT, {});
    expect(v.items[0].states).toEqual([{ state: "not_applicable", label: "Not applicable" }, { state: "unable_to_determine", label: "Could not observe" }]);
  });
});

describe("multi-field items, context, metadata, tabs, outcome preview", () => {
  it("fields: grid on desktop and tablet, always stacked on mobile", () => {
    const l = clone(STANDARD_CHECKLIST_LAYOUT); l.item.slots.fields = "grid2";
    expect(resolveView(BEDSIDE_AUDIT, l, {}, null, { breakpoint: "desktop" }).items[0].slots.fields).toBe("grid2");
    expect(resolveView(BEDSIDE_AUDIT, l, {}, null, { breakpoint: "tablet" }).items[0].slots.fields).toBe("grid2");
    expect(resolveView(BEDSIDE_AUDIT, l, {}, null, { breakpoint: "mobile" }).items[0].slots.fields).toBe("stack");
    const it = resolveView(BEDSIDE_AUDIT, l, {}).items[0];
    expect(it.fields.map((f) => [f.field_key, f.required])).toEqual([["staff_role", true], ["observation_note", false]]);
  });
  it("mobile switches the item component", () => {
    expect(resolveView(RESP_ASSESS, STANDARD_CHECKLIST_LAYOUT, {}, null, { breakpoint: "mobile" }).items[0].component).toBe("CriterionCard");
    expect(resolveView(RESP_ASSESS, STANDARD_CHECKLIST_LAYOUT, {}, null, { breakpoint: "desktop" }).items[0].component).toBe("CriterionRow");
  });
  it("context and metadata values are supplied, labels come from the layout, absent for an audit", () => {
    const v = resolveView(RESP_ASSESS, rich(), {}, null, { context: "Framework 1 > Duty 2 > Task 3", metadata: { subject: "Person A", unit: undefined } });
    expect(v.context).toBe("Framework 1 > Duty 2 > Task 3");
    expect(v.metadata).toEqual([{ key: "subject", label: "Subject", value: "Person A" }, { key: "unit", label: "Unit", value: null }, { key: "target_stage", label: "Target stage", value: null }]);
    expect(resolveView(HH_AUDIT, rich(), {}).context).toBeNull();
  });
  it("section tabs carry per-section counts", () => {
    const r: Responses = { [RA.k1]: { level_code: "L4" }, [RA.k2]: { level_code: "L4" }, [RA.ap1]: { level_code: "L4" } };
    const v = resolveView(RESP_ASSESS, rich(), r);
    expect(v.sectionTabs).toEqual([
      { key: RA.s1, title: "Assess breathing", total: 4, complete: 2, remaining: 2 },
      { key: RA.s2, title: "Interpret findings", total: 1, complete: 1, remaining: 0 },
    ]);
    expect(resolveView(RESP_ASSESS, STANDARD_CHECKLIST_LAYOUT, r).sectionTabs).toBeNull();
  });
  it("the outcome preview control carries the evaluation when given", () => {
    const rs = presetAllSatisfactory(RESP_ASSESS);
    const e = evaluate(RESP_ASSESS, RESP_RULES, rs, { evidenceCounts: { [RA.ap1]: 1 } });
    const v = resolveView(RESP_ASSESS, rich(), rs, e);
    expect(v.outcomePreview).toMatchObject({ enabled: true, label: "Evaluate", evaluation: { code: "ACHIEVED", class: "positive" } });
    expect(resolveView(RESP_ASSESS, rich(), rs).outcomePreview.evaluation).toBeNull();
    const off = clone(rich()); off.outcomePreview = { enabled: false };
    expect(resolveView(RESP_ASSESS, off, rs).outcomePreview.enabled).toBe(false);
  });
  it("section_then_group splits a section by group but never drops an item", () => {
    const v = resolveView(RESP_ASSESS, { ...clone(STANDARD_CHECKLIST_LAYOUT), grouping: "section_then_group" }, {});
    expect(v.blocks.map((b) => [b.title, b.subtitle, b.items.length])).toEqual([
      ["Assess breathing", "Knowledge", 2], ["Assess breathing", "Skills", 2], ["Interpret findings", "Applied knowledge", 1],
    ]);
  });
  it("the evaluation of the bedside fixture drives the preview as well", () => {
    const rs = presetAllSatisfactory(BEDSIDE_AUDIT);
    const e = evaluate(BEDSIDE_AUDIT, BEDSIDE_RULES, rs);
    expect(resolveView(BEDSIDE_AUDIT, rich(), rs, e).outcomePreview.evaluation?.code).toBe("MET");
  });
});
