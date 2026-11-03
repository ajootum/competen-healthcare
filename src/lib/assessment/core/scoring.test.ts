import { describe, expect, it } from "vitest";
import { evaluate, progress, RulesError, groupMinOrdinals } from "./scoring";
import { validateRules } from "./validate";
import { canonicalJson, sha256Hex } from "./hash";
import {
  BA, BEDSIDE_AUDIT, BEDSIDE_RULES, CA, CHART_AUDIT, CHART_RULES, HH, HH_AUDIT, HH_RULES, RA, RESP_ASSESS, RESP_RULES, STAGE_RATING, mkItem, mkSection, uid,
} from "./fixtures";
import { rkey, type InstrumentDef, type Responses } from "./types";
import type { RulesDoc } from "./rules-ast";

const L = (code: string) => ({ level_code: code });
const respAll = (code: string, over: Responses = {}): Responses => ({
  [RA.k1]: L(code), [RA.k2]: L(code), [RA.cs1]: L(code), [RA.cs2]: L(code), [RA.ap1]: L(code), ...over,
});
const withoutHigh: RulesDoc = { ...RESP_RULES, rules: RESP_RULES.rules.filter((r) => r.id !== "high_average") };
const evid = { [RA.ap1]: 1 };

describe("fixtures are valid rule sets", () => {
  it.each([
    ["RESP", RESP_ASSESS, RESP_RULES], ["RESP without high average", RESP_ASSESS, withoutHigh], ["HH", HH_AUDIT, HH_RULES],
    ["BEDSIDE", BEDSIDE_AUDIT, BEDSIDE_RULES], ["CHART", CHART_AUDIT, CHART_RULES],
  ])("%s has no validation errors", (_n, def, rules) => {
    expect(validateRules(def as InstrumentDef, rules as RulesDoc).errors).toEqual([]);
  });
});

describe("1 (planted) a high average can never override a failed critical item", () => {
  it("criticalFail outcome although the average passes", () => {
    const r = respAll("L5", { [RA.cs1]: L("L1") });
    const e = evaluate(RESP_ASSESS, RESP_RULES, r, { evidenceCounts: evid });
    expect(e.aggregates.pct_all).toBe(80); // the average alone would satisfy the 60 percent rule
    expect(e.outcome.code).toBe("NOT_ACH");
    expect(e.class).toBe("negative");
    expect(e.decided_by).toBe("gate:criticalFail");
    expect(e.gates.criticalFail.items.map((i) => i.code)).toEqual(["RA-CS-01"]);
  });
  it("the same answers with the critical item satisfactory are achieved", () => {
    const e = evaluate(RESP_ASSESS, RESP_RULES, respAll("L5"), { evidenceCounts: evid });
    expect(e.outcome.code).toBe("ACHIEVED");
  });
});

describe("2 (planted) not applicable is excluded from the denominator, not counted as a fail", () => {
  const base: Responses = {
    [uid(211)]: { value: "yes" }, [uid(212)]: { value: "yes" }, [uid(213)]: { value: "yes" },
    [uid(214)]: { state: "not_applicable" }, [uid(215)]: { value: "yes" }, [uid(216)]: { value: "yes" },
  };
  it("percent_satisfactory ignores the NA item and says why", () => {
    const e = evaluate(HH_AUDIT, HH_RULES, base);
    expect(e.aggregates.pct).toBe(100);
    expect(e.aggregates.counted).toBe(5);
    expect(e.outcome.code).toBe("COMPLIANT");
    const t = e.trace.find((s) => s.kind === "aggregate" && s.id === "pct");
    expect(t && t.kind === "aggregate" && t.excluded.map((x) => x.code)).toEqual(["HH-04"]);
    expect(e.counts.overall.excluded).toBe(1);
    expect(e.counts.overall.exclusions[0].code).toBe("HH-04");
  });
  it("only when the instrument says so does NA count against", () => {
    const e = evaluate(HH_AUDIT, { ...HH_RULES, defaults: { na: "count_unsatisfactory" } }, base);
    expect(e.aggregates.pct).toBeCloseTo(83.333333, 5);
    expect(e.outcome.code).toBe("PARTIAL");
  });
  it("an item can override the instrument default", () => {
    const def: InstrumentDef = { ...HH_AUDIT, items: HH_AUDIT.items.map((i) => (i.stable_key === uid(214) ? { ...i, config: { ...i.config, treat: { na: "count_unsatisfactory" } } } : i)) };
    expect(evaluate(def, HH_RULES, base).aggregates.pct).toBeCloseTo(83.333333, 5);
  });
  it("all items NA leaves nothing to count", () => {
    const all: Responses = Object.fromEntries([...HH.ids, HH.crit].map((k) => [k, { state: "not_applicable" }]));
    const e = evaluate(HH_AUDIT, HH_RULES, all);
    expect(e.aggregates.pct).toBeNull();
    expect(e.outcome.code).toBe("INCOMPLETE");
  });
});

describe("3 (planted) a mandatory item that is not assessed forces Incomplete", () => {
  it("not_assessed state", () => {
    const e = evaluate(RESP_ASSESS, RESP_RULES, respAll("L6", { [RA.k1]: { state: "not_assessed" } }), { evidenceCounts: evid });
    expect(e.outcome.code).toBe("INCOMPLETE");
    expect(e.class).toBe("incomplete");
    expect(e.decided_by).toBe("gate:mandatoryMissing");
  });
  it("no response at all", () => {
    const r = respAll("L6"); delete r[RA.cs2];
    expect(evaluate(RESP_ASSESS, RESP_RULES, r, { evidenceCounts: evid }).outcome.code).toBe("INCOMPLETE");
  });
  it("a critical failure outranks a missing mandatory item", () => {
    const r = respAll("L6", { [RA.cs1]: L("L0") }); delete r[RA.k1];
    expect(evaluate(RESP_ASSESS, RESP_RULES, r, { evidenceCounts: evid }).decided_by).toBe("gate:criticalFail");
  });
});

describe("4 not observed on a must-be-observed item fails", () => {
  it("critical item not observed", () => {
    const e = evaluate(RESP_ASSESS, RESP_RULES, respAll("L5", { [RA.cs1]: { state: "not_observed" } }), { evidenceCounts: evid });
    expect(e.decided_by).toBe("gate:criticalFail");
    expect(e.gates.criticalFail.items[0].why).toMatch(/not observed/);
  });
  it("a mandatory item without that requirement is simply missing", () => {
    const e = evaluate(RESP_ASSESS, RESP_RULES, respAll("L5", { [RA.cs2]: { state: "not_observed" } }), { evidenceCounts: evid });
    expect(e.decided_by).toBe("gate:mandatoryMissing");
  });
  it("treated as unsatisfactory when the instrument says so", () => {
    const rules: RulesDoc = { ...withoutHigh, defaults: { notObserved: "unsatisfactory" } };
    const e = evaluate(RESP_ASSESS, rules, respAll("L5", { [RA.k2]: { state: "not_observed" } }), { evidenceCounts: evid });
    expect(e.groupOutcomes.know.code).toBe("DEV_REQ");
  });
});

describe("5 unable to demonstrate is unsatisfactory", () => {
  it("on an ordinary item it fails its group", () => {
    const e = evaluate(RESP_ASSESS, RESP_RULES, respAll("L5", { [RA.k2]: { state: "unable_to_demonstrate" } }), { evidenceCounts: evid });
    expect(e.groupOutcomes.know.code).toBe("DEV_REQ");
    expect(e.counts.overall.unsatisfactory).toBe(1);
  });
  it("on a critical item it triggers the gate", () => {
    const e = evaluate(RESP_ASSESS, RESP_RULES, respAll("L5", { [RA.cs1]: { state: "unable_to_demonstrate" } }), { evidenceCounts: evid });
    expect(e.decided_by).toBe("gate:criticalFail");
  });
});

describe("6 a group outcome feeds the overall rules", () => {
  it("every group met", () => {
    const e = evaluate(RESP_ASSESS, withoutHigh, respAll("L4"), { evidenceCounts: evid });
    expect(Object.values(e.groupOutcomes).map((g) => g.code)).toEqual(["ACHIEVED", "ACHIEVED", "ACHIEVED"]);
    expect(e.decided_by).toBe("rule:all_groups");
  });
  it("skills met but knowledge not", () => {
    const e = evaluate(RESP_ASSESS, withoutHigh, respAll("L4", { [RA.k2]: L("L1") }), { evidenceCounts: evid });
    expect(e.groupOutcomes.know.code).toBe("DEV_REQ");
    expect(e.outcome.code).toBe("PARTIAL");
    expect(e.decided_by).toBe("rule:skills_only");
  });
  it("nothing matches: fallback", () => {
    const e = evaluate(RESP_ASSESS, withoutHigh, respAll("L1", { [RA.cs1]: L("L4") }), { evidenceCounts: evid });
    expect(e.decided_by === "rule:skills_only" || e.decided_by === "fallback").toBe(true);
    const e2 = evaluate(RESP_ASSESS, withoutHigh, respAll("L1", { [RA.cs1]: L("L4"), [RA.cs2]: L("L4") }), { evidenceCounts: evid });
    expect(e2.outcome.code).toBe("PARTIAL");
  });
});

describe("7 rules are applied by priority, first match wins", () => {
  it("higher priority beats lower even when both match", () => {
    const e = evaluate(RESP_ASSESS, RESP_RULES, respAll("L4"), { evidenceCounts: evid });
    expect(e.decided_by).toBe("rule:high_average");
  });
  it("array order does not matter", () => {
    const shuffled: RulesDoc = { ...RESP_RULES, rules: [...RESP_RULES.rules].reverse() };
    expect(evaluate(RESP_ASSESS, shuffled, respAll("L4"), { evidenceCounts: evid }).decided_by).toBe("rule:high_average");
  });
  it("the trace stops at the first match", () => {
    const e = evaluate(RESP_ASSESS, RESP_RULES, respAll("L4"), { evidenceCounts: evid });
    expect(e.trace.filter((s) => s.kind === "rule" && s.scope === "overall").length).toBe(1);
  });
});

describe("12 a mean over ordinal values is refused unless permitted", () => {
  const numeric = { ...STAGE_RATING, levels: STAGE_RATING.levels.map((l) => ({ ...l, numeric_value: l.ordinal })) };
  const def: InstrumentDef = { ...RESP_ASSESS, items: RESP_ASSESS.items.map((i) => ({ ...i, scale: numeric })) };
  const rules = (permit: boolean): RulesDoc => ({
    ...withoutHigh, permitOrdinalMean: permit,
    aggregates: [{ id: "mean", fn: "mean_numeric", over: { scope: "all" }, weights: "none" }],
    rules: [
      { id: "m", label: "Mean at least 4", priority: 5, when: { aggregate: "mean", op: ">=", value: 4 }, then: { outcome: "ACHIEVED" } },
      { id: "m2", label: "Mean at least 2", priority: 4, when: { aggregate: "mean", op: ">=", value: 2 }, then: { outcome: "PARTIAL" } },
    ],
  });
  it("validation refuses", () => {
    const v = validateRules(def, rules(false));
    expect(v.errors.map((e) => e.code)).toContain("ordinal_mean");
  });
  it("evaluation refuses too", () => {
    expect(() => evaluate(def, rules(false), respAll("L4"), { evidenceCounts: evid })).toThrow(RulesError);
  });
  it("permitted: allowed, with a warning for the reviewer", () => {
    const v = validateRules(def, rules(true));
    expect(v.errors).toEqual([]);
    expect(v.warnings.map((w) => w.code)).toContain("ordinal_mean_permitted");
    expect(evaluate(def, rules(true), respAll("L4"), { evidenceCounts: evid }).aggregates.mean).toBe(4);
  });
  it("a mean over a numeric rating item needs no permission", () => {
    const d: InstrumentDef = { groups: [], sections: [mkSection(1, "S", 1)], version_no: 1, items: [mkItem(1, 1, "N-1", { response_type: "numeric_rating", config: { min: 0, max: 10 } }), mkItem(2, 1, "N-2", { response_type: "numeric_rating", config: { min: 0, max: 10 } })] };
    const r: RulesDoc = { schema: "asmt.rules/1", outcomes: [{ code: "A", label: "A", class: "positive" }, { code: "B", label: "B", class: "negative" }], aggregates: [{ id: "m", fn: "mean_numeric", over: { scope: "all" }, weights: "none" }], rules: [{ id: "r", label: "r", priority: 1, when: { aggregate: "m", op: ">=", value: 5 }, then: { outcome: "A" } }], fallback: "B" };
    expect(validateRules(d, r).errors).toEqual([]);
    expect(evaluate(d, r, { [uid(1)]: { value: 8 }, [uid(2)]: { value: 4 } }).outcome.code).toBe("A");
  });
});

describe("15 determinism and the trace hash", () => {
  const r = respAll("L5", { [RA.cs1]: L("L1") });
  it("same input, same output and hash", () => {
    const a = evaluate(RESP_ASSESS, RESP_RULES, r, { evidenceCounts: evid });
    const b = evaluate(RESP_ASSESS, RESP_RULES, JSON.parse(JSON.stringify(r)), { evidenceCounts: evid });
    expect(b).toEqual(a);
    expect(a.traceHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("key order of the responses does not change the hash", () => {
    const rev: Responses = Object.fromEntries(Object.entries(r).reverse());
    expect(evaluate(RESP_ASSESS, RESP_RULES, rev, { evidenceCounts: evid }).traceHash).toBe(evaluate(RESP_ASSESS, RESP_RULES, r, { evidenceCounts: evid }).traceHash);
  });
  it("a different answer gives a different hash", () => {
    expect(evaluate(RESP_ASSESS, RESP_RULES, respAll("L4"), { evidenceCounts: evid }).traceHash).not.toBe(evaluate(RESP_ASSESS, RESP_RULES, r, { evidenceCounts: evid }).traceHash);
  });
  it("sha-256 matches the published vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("a".repeat(1000))).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
  });
  it("canonical JSON sorts keys", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe('{"a":[2,{"d":1}],"b":1}');
  });
  it("the rules hash changes when a rule changes", () => {
    const a = evaluate(RESP_ASSESS, RESP_RULES, r, { evidenceCounts: evid }).rules_hash;
    const b = evaluate(RESP_ASSESS, withoutHigh, r, { evidenceCounts: evid }).rules_hash;
    expect(a).not.toBe(b);
  });
});

describe("17 hand hygiene percentage audit (AUD-HH-01 as data)", () => {
  const yes = (k: string) => ({ [k]: { value: "yes" } });
  const base: Responses = { ...yes(uid(211)), ...yes(uid(212)), ...yes(uid(213)), [uid(214)]: { value: "no" }, [uid(215)]: { state: "not_applicable" }, ...yes(uid(216)) };
  it("4 of 5 counted observations compliant is 80 percent: partially compliant", () => {
    const e = evaluate(HH_AUDIT, HH_RULES, base);
    expect(e.aggregates).toEqual({ pct: 80, counted: 5 });
    expect(e.outcome.code).toBe("PARTIAL");
    expect(e.class).toBe("partial");
  });
  it("90 percent or more is compliant", () => {
    const e = evaluate(HH_AUDIT, HH_RULES, { ...base, ...yes(uid(214)) });
    expect(e.aggregates.pct).toBe(100);
    expect(e.outcome.code).toBe("COMPLIANT");
  });
  it("below 70 percent falls to the fallback", () => {
    const e = evaluate(HH_AUDIT, HH_RULES, { ...base, [uid(213)]: { value: "no" } });
    expect(e.aggregates.pct).toBe(60);
    expect(e.outcome.code).toBe("NON_COMPLIANT");
    expect(e.decided_by).toBe("fallback");
  });
  it("a failed automatic-fail item is non-compliant whatever the percentage", () => {
    const e = evaluate(HH_AUDIT, HH_RULES, { ...base, ...yes(uid(214)), [uid(216)]: { value: "no" } });
    expect(e.decided_by).toBe("gate:criticalFail");
    expect(e.outcome.code).toBe("NON_COMPLIANT");
  });
  it("the measurement, date and free text items never enter the percentage", () => {
    const e = evaluate(HH_AUDIT, HH_RULES, { ...base, [uid(217)]: { value: 3 }, [uid(218)]: { value: "2026-11-03" }, [uid(219)]: { value: "ok" } });
    expect(e.aggregates.counted).toBe(5);
    expect(e.counts.overall.neutral).toBe(3);
  });
  it("a missing mandatory observation is incomplete", () => {
    const r = { ...base }; delete r[uid(212)];
    expect(evaluate(HH_AUDIT, HH_RULES, r).outcome.code).toBe("INCOMPLETE");
  });
});

describe("the same engine represents a concurrent bedside audit", () => {
  const item = (n: number, code: string, extra: Responses = {}): Responses => ({
    [uid(n)]: { value: code }, [rkey(uid(n), "staff_role")]: { value: "reg" }, ...extra,
  });
  it("credit_percent only exists when a rule asks, and counts are reported per answer", () => {
    const r: Responses = { ...item(311, "yes"), ...item(312, "yes"), ...item(313, "partial"), ...item(314, "no") };
    const e = evaluate(BEDSIDE_AUDIT, BEDSIDE_RULES, r);
    expect(e.aggregates.credit).toBe(62.5);
    expect(e.outcome.code).toBe("PARTIAL");
    expect(e.counts.overall.byAnswer).toEqual({ yes: 2, partial: 1, no: 1 });
    expect(e.counts.overall.denominator).toBe(3); // the partial answer has no pass or fail meaning
    expect(e.counts.overall.neutral).toBe(1);
  });
  it("not applicable without a reason is invalid and so counts as missing", () => {
    const r: Responses = { ...item(311, "yes"), ...item(312, "yes"), ...item(313, "yes"), [uid(314)]: { state: "not_applicable" } };
    expect(evaluate(BEDSIDE_AUDIT, BEDSIDE_RULES, r).outcome.code).toBe("INCOMPLETE");
    const ok: Responses = { ...r, [uid(314)]: { state: "not_applicable", reason: "No patient contact" } };
    const e = evaluate(BEDSIDE_AUDIT, BEDSIDE_RULES, ok);
    expect(e.aggregates.credit).toBe(100);
    expect(e.outcome.code).toBe("MET");
    expect(e.counts.overall.exclusions[0].code).toBe("BA-04");
  });
  it("unable to determine is excluded here by the instrument default, with its own label", () => {
    const r: Responses = { ...item(311, "yes"), ...item(312, "yes"), ...item(313, "yes"), [uid(314)]: { state: "unable_to_determine" } };
    const e = evaluate(BEDSIDE_AUDIT, BEDSIDE_RULES, r);
    expect(e.counts.overall.excluded).toBe(1);
    expect(e.outcome.code).toBe("MET");
  });
  it("a required secondary field counts toward progress but not toward scoring", () => {
    const r: Responses = { [uid(311)]: { value: "yes" }, ...item(312, "yes"), ...item(313, "yes"), ...item(314, "yes") };
    const e = evaluate(BEDSIDE_AUDIT, BEDSIDE_RULES, r);
    expect(e.outcome.code).toBe("MET");
    const p = progress(BEDSIDE_AUDIT, r);
    expect(p.completed).toBe(3);
    expect(p.missingFields).toBe(1);
    expect(p.incomplete).toBe(1);
  });
  it("a rule may name a secondary field", () => {
    const rules: RulesDoc = { ...BEDSIDE_RULES, rules: [{ id: "assistant", label: "Done by an assistant", priority: 50, when: { item: BA.items[0], field: "staff_role", test: { answered: true } }, then: { outcome: "NOT_MET" } }, ...BEDSIDE_RULES.rules] };
    expect(validateRules(BEDSIDE_AUDIT, rules).errors).toEqual([]);
    const r: Responses = { ...item(311, "yes"), ...item(312, "yes"), ...item(313, "yes"), ...item(314, "yes") };
    expect(evaluate(BEDSIDE_AUDIT, rules, r).decided_by).toBe("rule:assistant");
  });
});

describe("the same engine represents a retrospective chart audit", () => {
  const entry = (n: number, v: string): Responses => ({ [uid(n)]: { value: v }, [rkey(uid(n), "chart_ref")]: { value: "C-1" } });
  it("unable to determine is excluded and reported, never a percentage guess", () => {
    const r: Responses = { ...entry(411, "documented"), ...entry(412, "documented"), [uid(413)]: { state: "unable_to_determine" }, [rkey(uid(413), "chart_ref")]: { value: "C-1" } };
    const e = evaluate(CHART_AUDIT, CHART_RULES, r);
    expect(e.aggregates).toEqual({ pct: 100, judged: 2 });
    expect(e.outcome.code).toBe("GOOD");
    expect(e.counts.overall.byAnswer).toEqual({ documented: 2, "state:unable_to_determine": 1 });
    expect(e.counts.overall.exclusions).toHaveLength(1);
  });
  it("nothing judged", () => {
    const r: Responses = Object.fromEntries(CA.items.map((k) => [k, { state: "unable_to_determine" }]));
    expect(evaluate(CHART_AUDIT, CHART_RULES, r).outcome.code).toBe("NONE");
  });
  it("a gap falls to the fallback", () => {
    const e = evaluate(CHART_AUDIT, CHART_RULES, { ...entry(411, "documented"), ...entry(412, "absent"), ...entry(413, "documented") });
    expect(e.outcome.code).toBe("GAPS");
  });
});

describe("evidence and progress", () => {
  it("evidenceMissing is a predicate and an indicator", () => {
    const rules: RulesDoc = { ...withoutHigh, rules: [{ id: "needs_evidence", label: "Evidence missing", priority: 90, when: { evidenceMissing: { scope: "all" } }, then: { outcome: "DEV_REQ" } }, ...withoutHigh.rules] };
    expect(evaluate(RESP_ASSESS, rules, respAll("L4")).decided_by).toBe("rule:needs_evidence");
    expect(evaluate(RESP_ASSESS, rules, respAll("L4"), { evidenceCounts: evid }).decided_by).toBe("rule:all_groups");
    expect(progress(RESP_ASSESS, respAll("L4")).missingEvidence).toBe(1);
    expect(progress(RESP_ASSESS, respAll("L4"), { evidenceCounts: evid }).missingEvidence).toBe(0);
  });
  it("progress counts completed, unassessed and critical", () => {
    const p = progress(RESP_ASSESS, { [RA.k1]: L("L4"), [RA.cs1]: L("L1"), [RA.cs2]: { state: "not_observed" } });
    expect(p.total).toBe(5);
    // not observed is an answer (an item the assessor did not see), so it counts as completed even though the rules treat it as missing
    expect(p.completed).toBe(3);
    expect(p.unassessed).toBe(2);
    expect(p.incomplete).toBe(0);
    expect(p.critical).toEqual({ total: 1, failed: 1, unanswered: 0 });
    expect(p.mandatoryMissing).toBe(1);
  });
  it("a state answer is completed for progress, and only no answer or not_assessed is unanswered", () => {
    for (const state of ["unable_to_demonstrate", "not_observed"] as const) {
      const p = progress(RESP_ASSESS, { [RA.k1]: { state } });
      expect(p.completed, state).toBe(1);
      expect(p.unassessed, state).toBe(RESP_ASSESS.items.length - 1);
    }
    // unable to determine, on an instrument whose items allow it
    const u = progress(CHART_AUDIT, { [uid(413)]: { state: "unable_to_determine" }, [rkey(uid(413), "chart_ref")]: { value: "C-1" } });
    expect(u.completed).toBe(1);
    const none = progress(RESP_ASSESS, { [RA.k1]: { state: "not_assessed" } });
    expect(none.completed).toBe(0);
    expect(none.unassessed).toBe(RESP_ASSESS.items.length);
    expect(progress(RESP_ASSESS, {}).completed).toBe(0);
  });
  it("completed follows the answer but mandatoryMissing keeps mirroring the database", () => {
    // not observed is treated as missing by the rules: the item counts as completed yet stays a mandatory gap
    const p = progress(RESP_ASSESS, { [RA.cs2]: { state: "not_observed" } });
    expect(p.completed).toBe(1);
    expect(p.mandatoryMissing).toBe(RESP_ASSESS.items.filter((i) => i.mandatory || i.critical).length);
  });
  it("an invalid response is still not completed", () => {
    const p = progress(RESP_ASSESS, { [RA.k1]: { level_code: "NO_SUCH_LEVEL" } });
    expect(p.completed).toBe(0);
  });
  it("group minimum ordinals feed progression", () => {
    expect(groupMinOrdinals(RESP_ASSESS, respAll("L4", { [RA.cs2]: L("L2") }))).toEqual({ know: 4, skills: 2, applied: 4 });
  });
});
