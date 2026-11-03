import { describe, expect, it } from "vitest";
import { presetAllNA, presetAllSatisfactory, presetBlank, presetOneCriticalFailed, runTests, satisfactoryResponse, unsatisfactoryResponse, type ScoringTestCase } from "./testing";
import { validateResponse } from "./responses";
import { evaluate } from "./scoring";
import { BEDSIDE_AUDIT, BEDSIDE_RULES, CHART_AUDIT, CHART_RULES, HH, HH_AUDIT, HH_RULES, RA, RESP_ASSESS, RESP_RULES } from "./fixtures";
import { rkey } from "./types";

const evid = { [RA.ap1]: 1 };

describe("preset generators produce valid responses", () => {
  it.each([["RESP", RESP_ASSESS], ["HH", HH_AUDIT], ["BEDSIDE", BEDSIDE_AUDIT], ["CHART", CHART_AUDIT]] as const)("%s", (_n, def) => {
    for (const make of [presetAllSatisfactory, presetOneCriticalFailed, presetAllNA]) {
      const rs = make(def);
      for (const [k, r] of Object.entries(rs)) {
        const [ik, fk] = k.split("#");
        const item = def.items.find((i) => i.stable_key === ik)!;
        expect(validateResponse(item, r, fk ?? "primary").issues).toEqual([]);
      }
    }
  });
  it("blank is empty", () => {
    expect(presetBlank()).toEqual({});
  });
  it("all satisfactory answers every item and every required secondary field", () => {
    const rs = presetAllSatisfactory(BEDSIDE_AUDIT);
    expect(Object.keys(rs)).toHaveLength(BEDSIDE_AUDIT.items.length * 2);
    expect(rs[rkey(BEDSIDE_AUDIT.items[0].stable_key, "staff_role")]).toBeDefined();
    expect(rs[rkey(BEDSIDE_AUDIT.items[0].stable_key, "observation_note")]).toBeUndefined();
  });
  it("one critical failed fails exactly the first critical item", () => {
    const rs = presetOneCriticalFailed(RESP_ASSESS);
    const e = evaluate(RESP_ASSESS, RESP_RULES, rs, { evidenceCounts: evid });
    expect(e.decided_by).toBe("gate:criticalFail");
    expect(e.gates.criticalFail.items.map((i) => i.code)).toEqual(["RA-CS-01"]);
    expect(presetOneCriticalFailed(HH_AUDIT, HH.crit)[HH.crit]).toEqual({ value: "no" });
  });
  it("all NA only where NA is permitted; the rest stays unanswered", () => {
    expect(Object.keys(presetAllNA(RESP_ASSESS))).toEqual([]);
    expect(Object.keys(presetAllNA(HH_AUDIT))).toHaveLength(6);
    expect(evaluate(HH_AUDIT, HH_RULES, presetAllNA(HH_AUDIT)).outcome.code).toBe("INCOMPLETE");
  });
  it("satisfactory and unsatisfactory responses for each type", () => {
    for (const it of [...HH_AUDIT.items, ...RESP_ASSESS.items]) expect(satisfactoryResponse(it)).not.toBeNull();
    expect(unsatisfactoryResponse(RESP_ASSESS.items[0])).toEqual({ level_code: "L2" });
    expect(unsatisfactoryResponse(HH_AUDIT.items[0])).toEqual({ value: "no" });
    expect(unsatisfactoryResponse(HH_AUDIT.items.find((i) => i.response_type === "free_text")!)).toBeNull();
  });
});

describe("runTests", () => {
  const cases: ScoringTestCase[] = [
    { id: "ok", name: "all satisfactory", responses: presetAllSatisfactory(RESP_ASSESS), evidence: evid, expect: { outcome: "ACHIEVED", class: "positive", gate: null, ruleId: "high_average", aggregates: { pct_all: 100 } } },
    { id: "crit", name: "one critical failed", responses: presetOneCriticalFailed(RESP_ASSESS), evidence: evid, expect: { outcome: "NOT_ACH", gate: "criticalFail" } },
    { id: "blank", name: "blank", responses: presetBlank(), expect: { outcome: "INCOMPLETE", gate: "mandatoryMissing" } },
  ];
  it("passes when every expectation holds", () => {
    const r = runTests(RESP_ASSESS, RESP_RULES, cases);
    expect(r.passed).toBe(3);
    expect(r.failed).toBe(0);
    expect(r.results[0].traceHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("reports each mismatch in words", () => {
    const r = runTests(RESP_ASSESS, RESP_RULES, [{ ...cases[0], expect: { outcome: "PARTIAL", class: "partial", gate: "criticalFail", ruleId: "x", groupOutcomes: { know: "DEV_REQ" }, aggregates: { pct_all: 1 } } }]);
    expect(r.failed).toBe(1);
    expect(r.results[0].mismatches).toHaveLength(6);
    expect(r.results[0].mismatches[0]).toMatch(/outcome is ACHIEVED, expected PARTIAL/);
  });
  it("a case that cannot be evaluated fails instead of throwing", () => {
    const bad = { ...RESP_RULES, rules: [{ id: "x", label: "x", priority: 1, when: { aggregate: "ghost", op: ">=" as const, value: 1 }, then: { outcome: "ACHIEVED" } }] };
    const r = runTests(RESP_ASSESS, bad, [cases[0]]);
    expect(r.results[0].ok).toBe(false);
    expect(r.results[0].mismatches[0]).toMatch(/could not evaluate/);
  });
  it("the other fixtures run end to end", () => {
    expect(runTests(BEDSIDE_AUDIT, BEDSIDE_RULES, [{ id: "a", name: "all", responses: presetAllSatisfactory(BEDSIDE_AUDIT), expect: { outcome: "MET" } }]).failed).toBe(0);
    expect(runTests(CHART_AUDIT, CHART_RULES, [{ id: "a", name: "all", responses: presetAllSatisfactory(CHART_AUDIT), expect: { outcome: "GOOD" } }]).failed).toBe(0);
  });
});
