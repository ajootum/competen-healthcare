import { describe, expect, it } from "vitest";
import { revalidateTemplate, validateDefinition, validateRules } from "./validate";
import { HH, HH_AUDIT, HH_RULES, RA, RESP_ASSESS, RESP_RULES, mkItem, mkSection, uid } from "./fixtures";
import type { Pred, Rule, RulesDoc } from "./rules-ast";
import type { InstrumentDef } from "./types";
import type { ScoringTestCase } from "./testing";

const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code);
const pct = (op: ">=" | "<" | ">" | "<=" | "=", value: number): Pred => ({ aggregate: "pct", op, value });
const rule = (id: string, priority: number, when: Rule["when"], outcome: string): Rule => ({ id, label: id, priority, when, then: { outcome } });
const hh = (rules: Rule[], over: Partial<RulesDoc> = {}): RulesDoc => ({ ...HH_RULES, rules, ...over });
const nothingCounted = rule("nc", 30, { aggregate: "counted", op: "=", value: 0 }, "INCOMPLETE");

describe("validateRules: the shipped fixtures are sound", () => {
  it("no errors", () => {
    expect(validateRules(HH_AUDIT, HH_RULES).errors).toEqual([]);
    expect(validateRules(RESP_ASSESS, RESP_RULES).errors).toEqual([]);
  });
});

describe("8 same-priority overlap with different outcomes is refused", () => {
  it("overlapping boxes", () => {
    const v = validateRules(HH_AUDIT, hh([nothingCounted, rule("a", 10, pct(">=", 50), "PARTIAL"), rule("b", 10, pct(">=", 80), "COMPLIANT")]));
    expect(codes(v)).toContain("ambiguous");
  });
  it("disjoint conditions at the same priority are fine", () => {
    const v = validateRules(HH_AUDIT, hh([nothingCounted, rule("a", 10, pct(">=", 80), "COMPLIANT"), rule("b", 10, { all: [pct("<", 80), pct(">=", 50)] }, "PARTIAL")]));
    expect(codes(v)).not.toContain("ambiguous");
    expect(v.errors).toEqual([]);
  });
  it("overlap with the same outcome is fine, and so is overlap at different priorities", () => {
    expect(codes(validateRules(HH_AUDIT, hh([nothingCounted, rule("a", 10, pct(">=", 50), "COMPLIANT"), rule("b", 10, pct(">=", 80), "COMPLIANT"), rule("c", 5, pct(">=", 60), "PARTIAL")])))).not.toContain("ambiguous");
  });
  it("a negated condition is analysed as its complement", () => {
    const v = validateRules(HH_AUDIT, hh([nothingCounted, rule("a", 10, { not: pct("<", 80) }, "COMPLIANT"), rule("b", 10, pct("<", 80), "PARTIAL")]));
    expect(codes(v)).not.toContain("ambiguous");
  });
});

describe("9 a shadowed or contradictory rule is unreachable", () => {
  it("a lower rule inside a higher rule's range", () => {
    const v = validateRules(HH_AUDIT, hh([nothingCounted, rule("wide", 20, pct(">=", 50), "COMPLIANT"), rule("narrow", 10, pct(">=", 80), "PARTIAL")]));
    expect(v.errors.filter((e) => e.code === "unreachable").map((e) => e.path)).toEqual(["rules[2]"]);
  });
  it("the reverse order is reachable", () => {
    const v = validateRules(HH_AUDIT, hh([nothingCounted, rule("narrow", 20, pct(">=", 80), "COMPLIANT"), rule("wide", 10, pct(">=", 50), "PARTIAL")]));
    expect(v.errors).toEqual([]);
  });
  it("contradictory conditions can never be true", () => {
    const v = validateRules(HH_AUDIT, hh([nothingCounted, rule("x", 20, { all: [pct(">=", 90), pct("<", 10)] }, "COMPLIANT"), rule("ok", 10, pct(">=", 70), "PARTIAL")]));
    expect(v.errors.some((e) => e.code === "unreachable" && e.path === "rules[1]")).toBe(true);
  });
  it("a count above the number of selected items cannot be reached", () => {
    const pred: Pred = { count: { scope: "items", keys: [HH.ids[0]] }, where: { satisfactory: true }, op: ">=", value: 2 };
    const v = validateRules(HH_AUDIT, hh([nothingCounted, rule("x", 20, pred, "COMPLIANT"), rule("ok", 10, pct(">=", 70), "PARTIAL")]));
    expect(v.errors.some((e) => e.code === "unreachable" && e.path === "rules[1]")).toBe(true);
  });
  it("an outcome reachable only through a dead rule is also uncovered", () => {
    const v = validateRules(HH_AUDIT, hh([nothingCounted, rule("wide", 20, pct(">=", 50), "COMPLIANT"), rule("narrow", 10, pct(">=", 80), "PARTIAL")]));
    expect(codes(v)).toContain("uncovered_outcome");
  });
});

describe("10 an outcome nothing can produce is refused", () => {
  it("declared but never used", () => {
    const v = validateRules(HH_AUDIT, hh([nothingCounted, rule("a", 20, pct(">=", 90), "COMPLIANT")]));
    expect(v.errors.filter((e) => e.code === "uncovered_outcome").map((e) => e.message).join(" ")).toMatch(/Partially compliant/);
  });
  it("a gate or fallback counts as a way to produce it", () => {
    const v = validateRules(HH_AUDIT, hh([nothingCounted, rule("a", 20, pct(">=", 90), "COMPLIANT"), rule("b", 10, pct(">=", 70), "PARTIAL")]));
    expect(v.errors).toEqual([]);
  });
});

describe("11 a fallback is required", () => {
  it("missing", () => {
    const doc = { ...HH_RULES } as Partial<RulesDoc>;
    delete doc.fallback;
    expect(codes(validateRules(HH_AUDIT, doc as RulesDoc))).toContain("fallback_required");
  });
  it("not a declared outcome", () => {
    expect(codes(validateRules(HH_AUDIT, { ...HH_RULES, fallback: "NOPE" }))).toContain("unresolved_ref");
  });
  it("each group rule set needs its own", () => {
    const doc: RulesDoc = { ...RESP_RULES, groups: [{ group: "know", rules: [], fallback: "" }] };
    expect(codes(validateRules(RESP_ASSESS, doc))).toContain("fallback_required");
  });
});

describe("13 type mismatches", () => {
  const yn = HH.ids[0];
  it("a level test on a yes/no item", () => {
    const v = validateRules(HH_AUDIT, hh([nothingCounted, rule("x", 20, { item: yn, test: { levelAtLeast: 3 } }, "COMPLIANT"), rule("ok", 10, pct(">=", 70), "PARTIAL")]));
    expect(codes(v)).toContain("type_mismatch");
  });
  it("a level test counted over only yes/no items", () => {
    const pred: Pred = { count: { scope: "items", keys: [yn] }, where: { levelAtMost: 2 }, op: ">=", value: 1 };
    expect(codes(validateRules(HH_AUDIT, hh([nothingCounted, rule("x", 20, pred, "COMPLIANT"), rule("ok", 10, pct(">=", 70), "PARTIAL")])))).toContain("type_mismatch");
  });
  it("a value test on a rating item without numeric values, and a satisfactory test on free text", () => {
    expect(codes(validateRules(RESP_ASSESS, { ...RESP_RULES, rules: [rule("x", 200, { item: RA.k1, test: { value: { op: ">", n: 1 } } }, "ACHIEVED"), ...RESP_RULES.rules] }))).toContain("type_mismatch");
    expect(codes(validateRules(HH_AUDIT, hh([nothingCounted, rule("x", 20, { item: HH.note, test: { satisfactory: true } }, "COMPLIANT"), rule("ok", 10, pct(">=", 70), "PARTIAL")])))).toContain("type_mismatch");
  });
  it("a level beyond the scale", () => {
    expect(codes(validateRules(RESP_ASSESS, { ...RESP_RULES, rules: [rule("x", 200, { item: RA.k1, test: { levelAtLeast: 9 } }, "ACHIEVED"), ...RESP_RULES.rules] }))).toContain("level_out_of_range");
  });
  it("the satisfactory test is refused on a secondary field", () => {
    const def: InstrumentDef = { version_no: 1, groups: [], sections: [mkSection(1, "S", 1)], items: [mkItem(1, 1, "X-1", { response_type: "yes_no", fields: [{ field_key: "note", label: "Note", response_type: "free_text", config: {}, required: false, position: 1 }] })] };
    const doc: RulesDoc = { schema: "asmt.rules/1", outcomes: [{ code: "A", label: "A", class: "positive" }, { code: "B", label: "B", class: "negative" }], rules: [rule("r", 1, { item: uid(1), field: "note", test: { satisfactory: true } }, "A")], fallback: "B" };
    expect(codes(validateRules(def, doc))).toContain("type_mismatch");
  });
});

describe("14 DNF analysis is capped at 256 terms", () => {
  const big = (n: number): Rule["when"] => ({
    all: Array.from({ length: n }, (_, i) => ({ any: [{ aggregate: "pct", op: ">=" as const, value: i + 1 }, { aggregate: "counted", op: "=" as const, value: i + 1 }] })),
  });
  it("512 terms is too complex", () => {
    const v = validateRules(HH_AUDIT, hh([nothingCounted, rule("big", 20, big(9), "COMPLIANT"), rule("ok", 10, pct(">=", 70), "PARTIAL")]));
    expect(codes(v)).toContain("too_complex");
  });
  it("256 terms is analysed", () => {
    const v = validateRules(HH_AUDIT, hh([nothingCounted, rule("big", 20, big(8), "COMPLIANT"), rule("ok", 10, pct(">=", 70), "PARTIAL")]));
    expect(codes(v)).not.toContain("too_complex");
  });
});

describe("the remaining checks of the design", () => {
  it("unknown keys and operators", () => {
    const bad = { ...HH_RULES, surprise: 1 } as unknown as RulesDoc;
    expect(codes(validateRules(HH_AUDIT, bad))).toContain("unknown_key");
    expect(codes(validateRules(HH_AUDIT, hh([nothingCounted, rule("x", 20, { aggregate: "pct", op: "~=" as never, value: 5 }, "COMPLIANT")])))).toContain("unknown_operator");
    expect(codes(validateRules(HH_AUDIT, hh([nothingCounted, rule("x", 20, { bogus: 1 } as unknown as Pred, "COMPLIANT")])))).toContain("unknown_predicate");
    const fn = { ...HH_RULES, aggregates: [{ id: "a", fn: "median", over: { scope: "all" }, weights: "none" }] } as unknown as RulesDoc;
    expect(codes(validateRules(HH_AUDIT, fn))).toContain("unknown_function");
  });
  it("unresolved references", () => {
    expect(codes(validateRules(HH_AUDIT, hh([nothingCounted, rule("x", 20, { aggregate: "ghost", op: ">=", value: 1 }, "COMPLIANT")])))).toContain("unresolved_ref");
    expect(codes(validateRules(HH_AUDIT, hh([nothingCounted, rule("x", 20, { item: uid(9999), test: { answered: true } }, "COMPLIANT")])))).toContain("unresolved_ref");
    expect(codes(validateRules(HH_AUDIT, hh([nothingCounted, rule("x", 20, pct(">=", 1), "GHOST")])))).toContain("unresolved_ref");
    expect(codes(validateRules(HH_AUDIT, hh([nothingCounted, rule("x", 20, { criticalFailed: { scope: "group", keys: ["nope"] } }, "COMPLIANT")])))).toContain("unresolved_ref");
  });
  it("gate outcomes are required when an item is critical or mandatory, and have the right class", () => {
    const noGates = { ...HH_RULES } as Partial<RulesDoc>;
    delete noGates.gates;
    expect(codes(validateRules(HH_AUDIT, noGates as RulesDoc)).filter((c) => c === "gate_missing")).toHaveLength(2);
    expect(codes(validateRules(HH_AUDIT, { ...HH_RULES, gates: { criticalFail: "COMPLIANT", mandatoryMissing: "INCOMPLETE" } }))).toContain("gate_class");
    expect(codes(validateRules(HH_AUDIT, { ...HH_RULES, gates: { criticalFail: "NON_COMPLIANT", mandatoryMissing: "PARTIAL" } }))).toContain("gate_class");
  });
  it("percentages stay between 0 and 100", () => {
    expect(codes(validateRules(HH_AUDIT, hh([nothingCounted, rule("x", 20, pct(">=", 150), "COMPLIANT"), rule("ok", 10, pct(">=", 70), "PARTIAL")])))).toContain("percent_range");
  });
  it("weights are zero or more", () => {
    const def: InstrumentDef = { ...HH_AUDIT, items: HH_AUDIT.items.map((i, n) => (n === 0 ? { ...i, weight: -1 } : i)) };
    expect(codes(validateRules(def, HH_RULES))).toContain("weight_range");
    expect(codes(validateDefinition(def))).toContain("weight_range");
  });
  it("a group rule cannot read another group's outcome", () => {
    const doc: RulesDoc = { ...RESP_RULES, groups: [{ group: "know", rules: [rule("g", 1, { groupOutcome: "skills", is: "ACHIEVED" }, "ACHIEVED")], fallback: "DEV_REQ" }] };
    expect(codes(validateRules(RESP_ASSESS, doc))).toContain("group_cycle");
  });
  it("duplicate rule ids and non-integer priorities", () => {
    expect(codes(validateRules(HH_AUDIT, hh([nothingCounted, rule("nc", 20, pct(">=", 1), "COMPLIANT")])))).toContain("duplicate_key");
    expect(codes(validateRules(HH_AUDIT, hh([nothingCounted, rule("x", 1.5, pct(">=", 1), "COMPLIANT")])))).toContain("bad_rule");
  });
  it("an empty selection is a warning, not an error", () => {
    const pred: Pred = { count: { scope: "all", critical: true, methods: ["no_such_method"] }, where: { answered: true }, op: ">=", value: 0 };
    const v = validateRules(HH_AUDIT, hh([nothingCounted, rule("x", 20, pred, "COMPLIANT"), rule("ok", 10, pct(">=", 70), "PARTIAL")]));
    expect(v.warnings.map((w) => w.code)).toContain("empty_selection");
  });
  it("the definition itself: a critical item must be mandatory, keys unique", () => {
    const def: InstrumentDef = { ...HH_AUDIT, items: HH_AUDIT.items.map((i, n) => (n === 0 ? { ...i, critical: true, mandatory: false } : n === 1 ? { ...i, stable_key: HH_AUDIT.items[0].stable_key } : i)) };
    expect(validateDefinition(def).errors.map((e) => e.code)).toEqual(expect.arrayContaining(["critical_not_mandatory", "duplicate_key"]));
  });
});

describe("a copied scoring template is validated again against the version", () => {
  const tests: ScoringTestCase[] = [{ id: "t1", name: "all yes", responses: Object.fromEntries([...HH.ids, HH.crit].map((k) => [k, { value: "yes" }])), expect: { outcome: "COMPLIANT" } }];
  it("a sound template passes with its tests", () => {
    expect(revalidateTemplate(HH_AUDIT, { rules: HH_RULES, tests }).errors).toEqual([]);
  });
  it("a template that points at items this version lacks is refused", () => {
    const other: InstrumentDef = { ...HH_AUDIT, items: HH_AUDIT.items.slice(0, 3) };
    const r = revalidateTemplate(other, { rules: HH_RULES });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.every((e) => e.code.startsWith("template_"))).toBe(true);
  });
  it("a saved test that no longer passes is an error", () => {
    const r = revalidateTemplate(HH_AUDIT, { rules: HH_RULES, tests: [{ ...tests[0], expect: { outcome: "PARTIAL" } }] });
    expect(r.errors.map((e) => e.code)).toContain("template_test_failed");
  });
});
