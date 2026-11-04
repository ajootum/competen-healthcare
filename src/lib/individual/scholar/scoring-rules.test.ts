/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import {
  CALCULATION_DEFAULTS, CRITICAL_MISS_SCORE_CAP, LEGACY_RULES_VERSION, SCORING_RULES_VERSION, UNSAFE_SCORE_CAP,
  calculationSpecOf, capForSafety, convertUnit, criteriaMarks, criteriaOf, extractUnsafeLine, findingsOf, marksFromShare, markCalculation, matchUnsafe,
  numbersIn, parseCalculationResponse, parseNumber, partContractOf, readUnsafeLine, rulesOf, safetyRecord, storedSafety, toleranceOf, toleranceOfChoice,
  unitChoices, unitInfo, withinTolerance,
} from "./scoring-rules";

// SQIE-CLOSE-2026-11 WS-A / WS-B / WS-C: the shared scoring rules, run.

const calc = (over: Record<string, unknown> = {}) => calculationSpecOf({ format: "calculation", accepted: ["2.5 mL"], value: 2.5, unit: "mL", ...over })!;

describe("versioning: an attempt says which rules marked it", () => {
  it("v2 is read back; anything else (every attempt kept before) is the legacy rules", () => {
    expect(rulesOf({ rules: SCORING_RULES_VERSION })).toBe(SCORING_RULES_VERSION);
    expect(rulesOf({ kind: "text", text: "x" })).toBe(LEGACY_RULES_VERSION);
    expect(rulesOf(null)).toBe(LEGACY_RULES_VERSION);
    expect(rulesOf({ rules: "sqie-scoring-v9" })).toBe(LEGACY_RULES_VERSION);
  });
});

describe("WS-A numbers", () => {
  it("parses a typed number, refuses an ambiguous comma, never guesses", () => {
    expect(parseNumber("2.5")).toEqual({ ok: true, value: 2.5, warnings: [] });
    expect(parseNumber(" 1,000 ")).toEqual({ ok: true, value: 1000, warnings: [] });
    expect(parseNumber("-3")).toMatchObject({ ok: true, value: -3 });
    expect(parseNumber("2,5")).toEqual({ ok: false, reason: "ambiguous_comma" });
    expect(parseNumber("1/2")).toEqual({ ok: false, reason: "not_a_number" });
    expect(parseNumber("2.5 mL")).toEqual({ ok: false, reason: "not_a_number" });
    expect(parseNumber("")).toEqual({ ok: false, reason: "empty" });
    expect(parseNumber(4)).toMatchObject({ ok: true, value: 4 });
  });
  it("warns on a naked decimal point and a trailing zero, without marking them down", () => {
    expect(parseNumber(".5")).toMatchObject({ ok: true, value: 0.5 });
    expect((parseNumber(".5") as any).warnings[0]).toMatch(/leading zero/);
    expect((parseNumber("5.0") as any).warnings[0]).toMatch(/trailing zero/);
    expect(markCalculation(calc({ value: 0.5, unit: "mg" }), { value: ".5", unit: "mg" }).correct).toBe(true);
  });
  it("lists the figures of a text (thousands separators removed)", () => {
    expect(numbersIn("Give 500 mg from 250 mg in 5 mL; 1,000 units.")).toEqual([500, 250, 5, 1000]);
  });
});

describe("WS-A units: normalised and converted for common clinical units", () => {
  it("spellings normalise to one unit", () => {
    for (const u of ["mcg", "micrograms", "µg", "ug", "Microgram"]) expect(unitInfo(u)!.canonical).toBe("mcg");
    expect(unitInfo("mL per hour")!.canonical).toBe("ml/h");
    expect(unitInfo("ml/hr")!.canonical).toBe("ml/h");
    expect(unitInfo("mg/kg/day")!.canonical).toBe("mg/kg/day");
    expect(unitInfo("")!.canonical).toBe("");
    expect(unitInfo("5 mg")).toBeNull();
  });
  it("converts within a dimension only; a dose per kilogram is not a mass; two capsules are never two tablets", () => {
    expect(convertUnit(2500, "mcg", "mg")).toBeCloseTo(2.5);
    expect(convertUnit(0.0025, "L", "mL")).toBeCloseTo(2.5);
    expect(convertUnit(60, "mL/h", "mL/min")).toBeCloseTo(1);
    expect(convertUnit(1, "mcg/kg/min", "mg/kg/h")).toBeCloseTo(0.06);
    expect(convertUnit(10, "kPa", "mmHg")).toBeCloseTo(75.0062);
    expect(convertUnit(5, "mg", "mg/kg")).toBeNull();
    expect(convertUnit(2, "capsules", "tablets")).toBeNull();
    expect(convertUnit(5, "mg", "mL")).toBeNull();
    expect(convertUnit(3, "puffs", "puffs")).toBe(3);
    expect(convertUnit(3, "puffs", "sprays")).toBeNull();
  });
  it("the unit select offers the key's unit and others of its dimension (a realistic slip), alphabetically", () => {
    const mg = unitChoices("mg");
    expect(mg).toContain("mg"); expect(mg).toContain("micrograms"); expect(mg).toContain("g");
    expect(mg).not.toContain("mL");
    expect([...mg].sort((a, b) => a.localeCompare(b))).toEqual(mg);
    expect(unitChoices("mL/h")).toContain("L/hour");
    expect(unitChoices("")).toEqual([]);
  });
});

describe("WS-A tolerance: exact by default, authored per question, the policy default between", () => {
  it("is exact with no tolerance (a hair of floating point only)", () => {
    expect(withinTolerance(0.1 + 0.2, 0.3, { kind: "none" })).toBe(true);
    expect(withinTolerance(2.51, 2.5, { kind: "none" })).toBe(false);
  });
  it("absolute and percent edges: on the edge passes, beyond it fails", () => {
    expect(withinTolerance(2.6, 2.5, { kind: "absolute", amount: 0.1 })).toBe(true);
    expect(withinTolerance(2.61, 2.5, { kind: "absolute", amount: 0.1 })).toBe(false);
    expect(withinTolerance(105, 100, { kind: "percent", amount: 5 })).toBe(true);
    expect(withinTolerance(105.01, 100, { kind: "percent", amount: 5 })).toBe(false);
    expect(withinTolerance(94.99, 100, { kind: "percent", amount: 5 })).toBe(false);
  });
  it("an authored tolerance must be sound (percent at most 10); the policy choices map to tolerances", () => {
    expect(toleranceOf({ kind: "percent", amount: 11 })).toBeNull();
    expect(toleranceOf({ kind: "absolute", amount: 0 })).toBeNull();
    expect(toleranceOf({ kind: "absolute", amount: 0.5 })).toEqual({ kind: "absolute", amount: 0.5 });
    expect(toleranceOfChoice("exact")).toEqual({ kind: "none" });
    expect(toleranceOfChoice("percent_5")).toEqual({ kind: "percent", amount: 5 });
    expect(toleranceOfChoice("nonsense")).toEqual({ kind: "none" });
  });
  it("the item's own tolerance beats the policy default, which beats the strict code default", () => {
    const own = calc({ tolerance: { kind: "absolute", amount: 0.1 } });
    expect(markCalculation(own, { value: "2.6", unit: "mL" }, { tolerance: { kind: "none" }, units: "exact_unit" }).correct).toBe(true);
    expect(markCalculation(calc(), { value: "2.6", unit: "mL" }).correct).toBe(false);
    expect(markCalculation(calc({ value: 100, unit: "mg" }), { value: "104", unit: "mg" }, { tolerance: { kind: "percent", amount: 5 }, units: "exact_unit" }).correct).toBe(true);
    expect(CALCULATION_DEFAULTS).toEqual({ tolerance: { kind: "none" }, units: "exact_unit" });
  });
});

describe("WS-A marking: wrong units are incorrect, with feedback", () => {
  it("right number, right unit", () => {
    const m = markCalculation(calc(), { value: "2.5", unit: "mL" });
    expect(m).toMatchObject({ correct: true, score: 1, reason: "correct", rules: SCORING_RULES_VERSION });
  });
  it("the same amount in another unit is wrong under the strict default, and says so; right where conversion is allowed", () => {
    const strict = markCalculation(calc({ value: 2.5, unit: "mg" }), { value: "2500", unit: "micrograms" });
    expect(strict).toMatchObject({ correct: false, score: 0, reason: "wrong_unit", inKeyUnit: 2.5 });
    expect(strict.feedback).toMatch(/asks for the answer in mg/);
    expect(strict.feedback).toMatch(/right amount in the wrong unit/);
    const loose = markCalculation(calc({ value: 2.5, unit: "mg" }), { value: "2500", unit: "micrograms" }, { tolerance: { kind: "none" }, units: "convert" });
    expect(loose).toMatchObject({ correct: true, reason: "correct" });
    const authored = markCalculation(calc({ value: 2.5, unit: "mg", units: "convert" }), { value: "2500", unit: "mcg" });
    expect(authored.correct).toBe(true);
  });
  it("a thousandfold slip in the right dimension is wrong, with the conversion shown", () => {
    const m = markCalculation(calc({ value: 2.5, unit: "mg" }), { value: "2.5", unit: "micrograms" }, { tolerance: { kind: "none" }, units: "convert" });
    expect(m).toMatchObject({ correct: false, reason: "wrong_value" });
    expect(m.feedback).toMatch(/0\.0025 mg/);
  });
  it("another dimension, no unit, an unknown unit or not a number is wrong", () => {
    expect(markCalculation(calc(), { value: "2.5", unit: "mg" }).reason).toBe("incompatible_unit");
    expect(markCalculation(calc(), { value: "2.5", unit: "" }).reason).toBe("unit_missing");
    expect(markCalculation(calc(), { value: "2.5", unit: "spoonfuls" }).reason).toBe("incompatible_unit");
    expect(markCalculation(calc(), { value: "two", unit: "mL" }).reason).toBe("unparsed");
    expect(markCalculation(calc(), { value: "2,5", unit: "mL" }).feedback).toMatch(/decimal point/);
  });
  it("a unitless answer needs no unit", () => {
    expect(markCalculation(calc({ value: 4, unit: "" }), { value: "4", unit: "" }).correct).toBe(true);
  });
  it("an unsound key is not a calculation; a response is bounded", () => {
    expect(calculationSpecOf({ format: "calculation", accepted: ["x"], value: "2.5", unit: "mL" })).toBeNull();
    expect(calculationSpecOf({ format: "calculation", accepted: ["x"], value: 2.5, unit: "5 mL" })).toBeNull();
    expect(calculationSpecOf({ accepted: ["x"], value: 2.5, unit: "mL" })).toBeNull();
    expect(parseCalculationResponse({ value: "2.5", unit: "mL" })).toEqual({ value: "2.5", unit: "mL" });
    expect(parseCalculationResponse({ value: "" })).toBeNull();
    expect(parseCalculationResponse({ value: "1".repeat(41) })).toBeNull();
  });
});

describe("WS-B unsafe answers and safety-critical misses", () => {
  it("code recognises an authored unsafe answer by normalised equality only (never 'contains')", () => {
    expect(matchUnsafe("Give the IV potassium as a bolus!", ["give the IV potassium as a bolus"])).toBe("give the IV potassium as a bolus");
    expect(matchUnsafe("Do not give the IV potassium as a bolus", ["give the IV potassium as a bolus"])).toBeNull();
    expect(matchUnsafe("", ["x"])).toBeNull();
  });
  it("the UNSAFE line must quote the learner's own words; none is none; a misquote is invalid", () => {
    expect(readUnsafeLine("none", "anything")).toEqual({ flagged: false });
    expect(readUnsafeLine(null, "anything")).toEqual({ flagged: false });
    expect(readUnsafeLine('"push it as a bolus"', "I would push it as a bolus quickly")).toEqual({ flagged: true, statement: "push it as a bolus" });
    expect(readUnsafeLine("give double the dose", "I would push it as a bolus")).toEqual({ invalid: true });
    const x = extractUnsafeLine("VERDICT x\nUNSAFE: none\nRIGHT: a");
    expect(x.line).toBe("none");
    expect(x.rest).not.toMatch(/UNSAFE/);
    expect(x.rest).toMatch(/RIGHT: a/);
  });
  it("caps: unsafe earns nothing and is never correct; a critical miss is never correct and at most half", () => {
    expect(UNSAFE_SCORE_CAP).toBe(0); expect(CRITICAL_MISS_SCORE_CAP).toBe(0.5);
    expect(capForSafety({ correct: true, score: 1 }, "unsafe")).toEqual({ correct: false, score: 0 });
    expect(capForSafety({ correct: true, score: 0.75 }, "critical_missed")).toEqual({ correct: false, score: 0.5 });
    expect(capForSafety({ correct: false, score: 0.25 }, "critical_missed")).toEqual({ correct: false, score: 0.25 });
    expect(capForSafety({ correct: true, score: 1 }, "safe")).toEqual({ correct: true, score: 1 });
  });
  it("the record kept on the attempt is bounded and read back; a safe or legacy attempt has none", () => {
    const r = safetyRecord("unsafe", { statement: "x".repeat(400), by: "ai" })!;
    expect(r.statement!.length).toBe(300);
    expect(storedSafety({ safety: r })).toEqual(r);
    expect(safetyRecord("safe", { by: "code" })).toBeNull();
    expect(storedSafety({ kind: "text" })).toBeNull();
    expect(storedSafety({ safety: { outcome: "fine", by: "ai" } })).toBeNull();
  });
});

describe("WS-B / WS-C weighted criteria: rubric-based partial credit", () => {
  const C = criteriaOf([{ text: "Recognises sepsis", weight: 2 }, { text: "Escalates now", weight: 3, safetyCritical: true }, { text: "Rechecks", weight: 1 }])!;
  it("the share of the weight met; all met is correct", () => {
    expect(criteriaMarks(C, [0, 1, 2])).toMatchObject({ correct: true, score: 1, awarded: 6, total: 6, outcome: "safe" });
    expect(criteriaMarks(C, [1, 2, 2, 9])).toMatchObject({ matched: [1, 2], score: 4 / 6, correct: false, outcome: "safe" });
  });
  it("a safety-critical criterion not met caps it; an unsafe statement zeroes it", () => {
    expect(criteriaMarks(C, [0, 2])).toMatchObject({ outcome: "critical_missed", score: 0.5, correct: false, missedCritical: ["Escalates now"] });
    expect(criteriaMarks(C, [0, 1, 2], true)).toMatchObject({ outcome: "unsafe", score: 0, awarded: 0, correct: false });
  });
  it("criteria read from authored data are bounded (case rubric `criterion` too)", () => {
    expect(criteriaOf([{ criterion: "A", weight: 2 }])).toEqual([{ text: "A", weight: 2, safetyCritical: false }]);
    expect(criteriaOf([{ text: "A", weight: 6 }])).toBeNull();
    expect(criteriaOf([])).toBeNull();
  });
  it("part marks from a share are whole marks, rounded down", () => {
    expect(marksFromShare(3, 4 / 6)).toBe(2);
    expect(marksFromShare(3, 1)).toBe(3);
    expect(marksFromShare(3, 0.5)).toBe(1);
  });
  it("a structured part's contract: a choice part needs its key as accepted[0]; findings are bounded", () => {
    expect(partContractOf({ role: "answer", options: ["Escalate", "Wait"], correct: 0 }, ["Escalate"]).options).toEqual(["Escalate", "Wait"]);
    expect(partContractOf({ options: ["Escalate", "Wait"], correct: 1 }, ["Escalate"]).options).toBeNull();
    expect(partContractOf({ role: "justify", criteria: [{ text: "why", weight: 1 }] }, ["x"])).toMatchObject({ role: "justify", criteria: [{ text: "why", weight: 1, safetyCritical: false }] });
    expect(findingsOf({ findings: [{ label: "Heart rate", value: 128, unit: "/min" }] })).toEqual([{ label: "Heart rate", value: "128", unit: "/min" }]);
    expect(findingsOf({ findings: [{ label: "", value: "1" }] })).toEqual([]);
  });
});
