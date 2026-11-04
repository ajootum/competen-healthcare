/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import {
  CALCULATION_DEFAULTS, CRITICAL_MISS_SCORE_CAP, LEGACY_RULES_VERSION, SCORING_RULES_VERSION, UNSAFE_SCORE_CAP,
  applyRounding, calculationProblems, calculationSpecOf, capForSafety, convertUnit, magnitudeError, roundingOf, criteriaMarks, criteriaOf, extractUnsafeLine, findingsOf, marksFromShare, markCalculation, matchUnsafe,
  numbersIn, parseCalculationResponse, parseNumber, partContractOf, readUnsafeLine, rulesOf, safetyRecord, storedSafety, toleranceOf,
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

describe("WS-A tolerance (owner decision 4 Nov 2026): built in full, inactive until the clinical calculation policy is approved", () => {
  it("is exact with no tolerance (a hair of floating point only), and the sign always counts", () => {
    expect(withinTolerance(0.1 + 0.2, 0.3, null)).toBe(true);
    expect(withinTolerance(2.51, 2.5, null)).toBe(false);
    expect(withinTolerance(-250, 250, { kind: "percent", amount: 10 })).toBe(false);
  });
  it("absolute and percent edges: on the edge passes, beyond it fails", () => {
    expect(withinTolerance(2.6, 2.5, { kind: "absolute", amount: 0.1 })).toBe(true);
    expect(withinTolerance(2.61, 2.5, { kind: "absolute", amount: 0.1 })).toBe(false);
    expect(withinTolerance(105, 100, { kind: "percent", amount: 5 })).toBe(true);
    expect(withinTolerance(105.01, 100, { kind: "percent", amount: 5 })).toBe(false);
    expect(withinTolerance(94.99, 100, { kind: "percent", amount: 5 })).toBe(false);
  });
  it("an authored tolerance must be sound (percent at most 10)", () => {
    expect(toleranceOf({ kind: "percent", amount: 11 })).toBeNull();
    expect(toleranceOf({ kind: "absolute", amount: 0 })).toBeNull();
    expect(toleranceOf({ kind: "absolute", amount: 0.5 })).toEqual({ kind: "absolute", amount: 0.5 });
    expect(calculationProblems({ format: "calculation", accepted: ["x"], value: 1, unit: "mg", tolerance: { kind: "percent", amount: 50 } })[0]).toMatch(/tolerance/);
  });
  it("an authored tolerance is NOT used while tolerances are inactive (the default), and is used once they are on", () => {
    const own = calc({ tolerance: { kind: "absolute", amount: 0.1 } });
    const off = markCalculation(own, { value: "2.6", unit: "mL" });
    expect(off).toMatchObject({ correct: false, reason: "wrong_value", tolerance: null, toleranceInactive: true });
    expect(CALCULATION_DEFAULTS).toEqual({ tolerancesActive: false });
    expect(markCalculation(own, { value: "2.6", unit: "mL" }, { tolerancesActive: true })).toMatchObject({ correct: true, tolerance: { kind: "absolute", amount: 0.1 } });
    expect(markCalculation(own, { value: "2.61", unit: "mL" }, { tolerancesActive: true }).correct).toBe(false);
  });
});

describe("WS-A rounding: question-defined", () => {
  it("rounds half away from zero by decimal places or significant figures", () => {
    expect(applyRounding(33.333, { mode: "decimal_places", places: 1 })).toBe(33.3);
    expect(applyRounding(2.25, { mode: "decimal_places", places: 1 })).toBe(2.3);
    expect(applyRounding(0.012345, { mode: "significant_figures", places: 2 })).toBe(0.012);
    expect(applyRounding(1234, { mode: "significant_figures", places: 2 })).toBe(1200);
    expect(applyRounding(-2.25, { mode: "decimal_places", places: 1 })).toBe(-2.3);
    expect(roundingOf({ mode: "decimal_places", places: 7 })).toBeNull();
  });
  it("an answer not rounded as the question says is wrong, with the rule named; the rounded value is right", () => {
    const r = calc({ value: 33.3, unit: "mL/h", accepted: ["33.3 mL/hour"], rounding: { mode: "decimal_places", places: 1 } });
    expect(markCalculation(r, { value: "33.3", unit: "mL/h" }).correct).toBe(true);
    const m = markCalculation(r, { value: "33.33", unit: "mL/h" });
    expect(m).toMatchObject({ correct: false, reason: "not_rounded" });
    expect(m.feedback).toMatch(/1 decimal place/);
    expect(markCalculation(r, { value: "33", unit: "mL/h" }).reason).toBe("wrong_value");
  });
  it("a key not itself rounded as its rule says is not sound", () => {
    expect(calculationProblems({ format: "calculation", accepted: ["x"], value: 33.33, unit: "mL", rounding: { mode: "decimal_places", places: 1 } })).toContain("value: not rounded to 1 decimal place");
    expect(calculationSpecOf({ format: "calculation", accepted: ["x"], value: 33.33, unit: "mL", rounding: { mode: "decimal_places", places: 1 } })).toBeNull();
  });
});

describe("WS-A marking: validated unit equivalence, wrong units incorrect with feedback, tenfold errors unsafe", () => {
  it("right number, right unit; the sign and the decimal point are kept (+250 is not -250)", () => {
    expect(markCalculation(calc(), { value: "2.5", unit: "mL" })).toMatchObject({ correct: true, score: 1, reason: "correct", rules: SCORING_RULES_VERSION, safety: null });
    const pos = calc({ value: 250, unit: "mL", accepted: ["250 mL"] });
    expect(markCalculation(pos, { value: "+250", unit: "mL" }).correct).toBe(true);
    expect(markCalculation(pos, { value: "-250", unit: "mL" })).toMatchObject({ correct: false, reason: "wrong_value" });
    expect(markCalculation(pos, { value: "25.0", unit: "mL" }).correct).toBe(false);
  });
  it("only the key's unit or a validated equivalent counts; an equivalent must be a recognised unit of the same kind", () => {
    const eq = calc({ value: 2.5, unit: "mg", accepted: ["2.5 mg"], equivalentUnits: ["micrograms"] });
    expect(markCalculation(eq, { value: "2500", unit: "mcg" })).toMatchObject({ correct: true, reason: "correct" });
    const strict = markCalculation(calc({ value: 2.5, unit: "mg" }), { value: "0.0025", unit: "g" });
    expect(strict).toMatchObject({ correct: false, reason: "wrong_unit", inKeyUnit: 2.5, safety: null });
    expect(strict.feedback).toMatch(/asks for the answer in mg/);
    expect(calculationProblems({ format: "calculation", accepted: ["x"], value: 1, unit: "mg", equivalentUnits: ["mL"] })[0]).toMatch(/same kind/);
    expect(calculationProblems({ format: "calculation", accepted: ["x"], value: 1, unit: "mg", equivalentUnits: ["spoonfuls"] })[0]).toMatch(/same kind/);
    expect(calculationSpecOf({ format: "calculation", accepted: ["x"], value: 1, unit: "mg", equivalentUnits: ["mL"] })).toBeNull();
  });
  it("a tenfold error is UNSAFE independently of tolerance: even a tolerance that would accept it does not", () => {
    const k = calc({ value: 2.5, unit: "mg", accepted: ["2.5 mg"], tolerance: { kind: "percent", amount: 10 } });
    const slip = markCalculation(k, { value: "25", unit: "mg" }, { tolerancesActive: true });
    expect(slip).toMatchObject({ correct: false, score: 0, safety: { outcome: "unsafe", by: "code" } });
    expect(slip.feedback).toMatch(/10 times the right amount/);
    const unitSlip = markCalculation(k, { value: "2.5", unit: "micrograms" }, { tolerancesActive: true });
    expect(unitSlip).toMatchObject({ reason: "wrong_unit", safety: { outcome: "unsafe" } });
    expect(unitSlip.feedback).toMatch(/1\/1000 of the right amount/);
    // A huge absolute tolerance that would accept 25 for 2.5 is still overruled by the safety check.
    const wide = calc({ value: 2.5, unit: "mg", accepted: ["2.5 mg"], tolerance: { kind: "absolute", amount: 100 } });
    expect(markCalculation(wide, { value: "25", unit: "mg" }, { tolerancesActive: true })).toMatchObject({ correct: false, safety: { outcome: "unsafe" } });
    expect(magnitudeError(24.9, 2.5)).toBe(false); expect(magnitudeError(0.25, 2.5)).toBe(true); expect(magnitudeError(-25, 2.5)).toBe(false);
    // An item may say its amount is not safety-critical (a score, not a dose).
    expect(markCalculation(calc({ value: 2.5, unit: "", accepted: ["2.5"], safetyCritical: false }), { value: "25", unit: "" }).safety).toBeNull();
  });
  it("another dimension, no unit, an unknown unit or not a number is wrong", () => {
    expect(markCalculation(calc(), { value: "2.5", unit: "mg" }).reason).toBe("incompatible_unit");
    expect(markCalculation(calc(), { value: "2.5", unit: "" }).reason).toBe("unit_missing");
    expect(markCalculation(calc(), { value: "2.5", unit: "spoonfuls" }).reason).toBe("incompatible_unit");
    expect(markCalculation(calc(), { value: "two", unit: "mL" }).reason).toBe("unparsed");
    expect(markCalculation(calc(), { value: "2,5", unit: "mL" }).feedback).toMatch(/decimal point/);
  });
  it("a unitless answer needs no unit", () => {
    expect(markCalculation(calc({ value: 4, unit: "", accepted: ["4"] }), { value: "4", unit: "" }).correct).toBe(true);
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
