import { describe, expect, it } from "vitest";
import { computeSatisfactory, validateResponse } from "./responses";
import { RESP_ASSESS, RA, STAGE_RATING, mkItem } from "./fixtures";
import { RESPONSE_TYPES, type InstrumentItem, type ResponseType, type ResponseValue } from "./types";

const mk = (response_type: ResponseType, extra: Partial<InstrumentItem> = {}) => mkItem(1, 1, "T-1", { response_type, ...extra });
const ok = (item: InstrumentItem, r: ResponseValue | null, field?: string) => validateResponse(item, r, field).ok;
const code = (item: InstrumentItem, r: ResponseValue, field?: string) => validateResponse(item, r, field).issues[0]?.code;

const mcq = { options: [{ code: "a", label: "A", satisfactory: true, credit: 1 }, { code: "b", label: "B", satisfactory: false, credit: 0 }, { code: "c", label: "C", satisfactory: null }] };

describe("16 per-type response validation for all 11 types", () => {
  it("covers every type", () => {
    expect(RESPONSE_TYPES).toHaveLength(11);
  });

  it("rating_scale", () => {
    const item = RESP_ASSESS.items.find((i) => i.stable_key === RA.k1)!;
    expect(ok(item, { level_code: "L3" })).toBe(true);
    expect(code(item, { level_code: "L9" })).toBe("unknown_level");
    expect(code(item, { value: "L3" })).toBe("wrong_slot");
    expect(ok(item, { state: "not_observed" })).toBe(true);
    expect(code(item, { state: "not_applicable" })).toBe("state_not_allowed");
  });

  it("yes_no, pass_fail, achieved", () => {
    for (const [t, a, b] of [["yes_no", "yes", "no"], ["pass_fail", "pass", "fail"], ["achieved", "achieved", "not_achieved"]] as const) {
      const item = mk(t);
      expect(ok(item, { value: a })).toBe(true);
      expect(ok(item, { value: b })).toBe(true);
      expect(code(item, { value: "maybe" })).toBe("bad_value");
      expect(code(item, { value: true })).toBe("bad_value");
      expect(code(item, { level_code: a })).toBe("wrong_slot");
    }
  });

  it("numeric_rating: min, max, step, integer", () => {
    const item = mk("numeric_rating", { config: { min: 1, max: 5, step: 1 } });
    expect(ok(item, { value: 3 })).toBe(true);
    expect(code(item, { value: 0 })).toBe("below_min");
    expect(code(item, { value: 6 })).toBe("above_max");
    expect(code(item, { value: 2.5 })).toBe("off_step");
    expect(code(item, { value: "3" })).toBe("not_a_number");
    expect(code(item, { value: Number.NaN })).toBe("not_a_number");
    expect(code(mk("numeric_rating", { config: { integer: true } }), { value: 2.5 })).toBe("not_integer");
  });

  it("multiple_choice: single and multi", () => {
    const single = mk("multiple_choice", { config: mcq });
    expect(ok(single, { value: "a" })).toBe(true);
    expect(code(single, { value: "z" })).toBe("unknown_option");
    expect(code(single, { value: ["a"] })).toBe("unknown_option");
    const multi = mk("multiple_choice", { config: { ...mcq, select: "multi" } });
    expect(ok(multi, { value: ["a", "b"] })).toBe(true);
    expect(code(multi, { value: [] })).toBe("bad_value");
    expect(code(multi, { value: ["a", "a"] })).toBe("duplicate");
    expect(code(multi, { value: ["a", "q"] })).toBe("unknown_option");
  });

  it("free_text: maxLength and minLength", () => {
    const item = mk("free_text", { config: { maxLength: 5, minLength: 2 } });
    expect(ok(item, { value: "abc" })).toBe(true);
    expect(code(item, { value: "abcdef" })).toBe("too_long");
    expect(code(item, { value: " a " })).toBe("too_short");
    expect(code(item, { value: 12 })).toBe("bad_value");
  });

  it("datetime: ISO and bounds", () => {
    const item = mk("datetime", { config: { min: "2026-01-01", max: "2026-12-31" } });
    expect(ok(item, { value: "2026-06-01" })).toBe(true);
    expect(ok(item, { value: "2026-06-01T10:30:00Z" })).toBe(true);
    expect(code(item, { value: "yesterday" })).toBe("bad_date");
    expect(code(item, { value: "2026-13-45" })).toBe("bad_date");
    expect(code(item, { value: "2025-12-31" })).toBe("before_min");
    expect(code(item, { value: "2027-01-01" })).toBe("after_max");
  });

  it("measurement: number, unit, bounds", () => {
    const item = mk("measurement", { config: { unit: "count", min: 0, max: 100 } });
    expect(ok(item, { value: 12 })).toBe(true);
    expect(ok(item, { value: { value: 12, unit: "count" } })).toBe(true);
    expect(code(item, { value: { value: 12, unit: "mm" } })).toBe("unit_mismatch");
    expect(code(item, { value: -1 })).toBe("below_min");
    expect(code(item, { value: 101 })).toBe("above_max");
  });

  it("na: only the not applicable state", () => {
    const item = mk("na");
    expect(ok(item, { state: "not_applicable" })).toBe(true);
    expect(code(item, { value: true })).toBe("na_needs_state");
    expect(code(item, { state: "unable_to_demonstrate" })).toBe("state_not_allowed");
  });

  it("evidence: a count of attachments", () => {
    const item = mk("evidence");
    expect(ok(item, { value: 0 })).toBe(true);
    expect(ok(item, { value: 2 })).toBe(true);
    expect(code(item, { value: -1 })).toBe("bad_count");
    expect(code(item, { value: 1.5 })).toBe("bad_count");
  });

  it("a response holds exactly one of level, state, value", () => {
    const item = mk("yes_no");
    expect(code(item, {})).toBe("empty");
    expect(code(item, { value: "yes", state: "not_observed" })).toBe("multiple");
    expect(ok(item, null)).toBe(true);
  });

  it("state permission comes from the field, not the type", () => {
    const base = mk("yes_no");
    expect(code(base, { state: "not_applicable" })).toBe("state_not_allowed");
    expect(ok(base, { state: "not_assessed" })).toBe(true);
    const na = mk("yes_no", { config: { allowedStates: ["not_applicable", "unable_to_determine"] } });
    expect(ok(na, { state: "not_applicable" })).toBe(true);
    expect(ok(na, { state: "unable_to_determine" })).toBe(true);
    expect(code(na, { state: "not_observed" })).toBe("state_not_allowed");
    expect(code(na, { state: "bogus" as never })).toBe("unknown_state");
  });

  it("a reason is required for not applicable when the field says so", () => {
    const item = mk("yes_no", { config: { allowedStates: ["not_applicable"], naReasonRequired: true } });
    expect(code(item, { state: "not_applicable" })).toBe("reason_required");
    expect(code(item, { state: "not_applicable", reason: "   " })).toBe("reason_required");
    expect(ok(item, { state: "not_applicable", reason: "No patient" })).toBe(true);
  });

  it("secondary fields validate against their own type", () => {
    const item = mk("yes_no", { fields: [{ field_key: "qty", label: "Qty", response_type: "numeric_rating", config: { min: 0 }, required: true, position: 1 }] });
    expect(ok(item, { value: 3 }, "qty")).toBe(true);
    expect(code(item, { value: -3 }, "qty")).toBe("below_min");
    expect(code(item, { value: 3 }, "ghost")).toBe("unknown_field");
  });
});

describe("computeSatisfactory (the rule the DB trigger mirrors)", () => {
  it("states", () => {
    const item = mk("yes_no", { config: { allowedStates: ["not_applicable", "unable_to_demonstrate", "unable_to_determine"] } });
    expect(computeSatisfactory(item, { state: "unable_to_demonstrate" })).toBe(false);
    for (const s of ["not_assessed", "not_observed", "not_applicable", "unable_to_determine"] as const) expect(computeSatisfactory(item, { state: s })).toBeNull();
  });
  it("rating levels carry their own flag", () => {
    const item = RESP_ASSESS.items.find((i) => i.stable_key === RA.k1)!;
    expect(computeSatisfactory(item, { level_code: "L2" })).toBe(false);
    expect(computeSatisfactory(item, { level_code: "L3" })).toBe(true);
    const nullFlag = mk("rating_scale", { scale: { ...STAGE_RATING, levels: [{ code: "x", label: "X", ordinal: 1, satisfactory: null }] } });
    expect(computeSatisfactory(nullFlag, { level_code: "x" })).toBeNull();
  });
  it("yes/no and friends, with an inverted satisfactory value", () => {
    expect(computeSatisfactory(mk("yes_no"), { value: "yes" })).toBe(true);
    expect(computeSatisfactory(mk("yes_no"), { value: "no" })).toBe(false);
    expect(computeSatisfactory(mk("yes_no", { config: { satisfactoryValue: "no" } }), { value: "no" })).toBe(true);
    expect(computeSatisfactory(mk("pass_fail"), { value: "pass" })).toBe(true);
    expect(computeSatisfactory(mk("achieved"), { value: "not_achieved" })).toBe(false);
  });
  it("numeric bounds", () => {
    const item = mk("numeric_rating", { config: { satisfactoryMin: 3 } });
    expect(computeSatisfactory(item, { value: 3 })).toBe(true);
    expect(computeSatisfactory(item, { value: 2 })).toBe(false);
    expect(computeSatisfactory(mk("measurement", { config: { satisfactoryMax: 0 } }), { value: 0 })).toBe(true);
    expect(computeSatisfactory(mk("numeric_rating"), { value: 5 })).toBeNull();
  });
  it("multiple choice", () => {
    const single = mk("multiple_choice", { config: mcq });
    expect(computeSatisfactory(single, { value: "a" })).toBe(true);
    expect(computeSatisfactory(single, { value: "b" })).toBe(false);
    expect(computeSatisfactory(single, { value: "c" })).toBeNull();
    const multi = mk("multiple_choice", { config: { ...mcq, select: "multi" } });
    expect(computeSatisfactory(multi, { value: ["a"] })).toBe(true);
    expect(computeSatisfactory(multi, { value: ["a", "b"] })).toBe(false);
    expect(computeSatisfactory(multi, { value: ["a", "c"] })).toBeNull();
  });
  it("evidence, free text, date and invalid responses", () => {
    expect(computeSatisfactory(mk("evidence"), { value: 1 })).toBe(true);
    expect(computeSatisfactory(mk("evidence"), { value: 0 })).toBe(false);
    expect(computeSatisfactory(mk("evidence", { config: { minCount: 2 } }), { value: 1 })).toBe(false);
    expect(computeSatisfactory(mk("free_text"), { value: "x" })).toBeNull();
    expect(computeSatisfactory(mk("datetime"), { value: "2026-01-01" })).toBeNull();
    expect(computeSatisfactory(mk("yes_no"), { value: "maybe" })).toBeNull();
  });
  it("a secondary field is never satisfactory-scored", () => {
    const item = mk("yes_no", { fields: [{ field_key: "q", label: "Q", response_type: "yes_no", config: {}, required: false, position: 1 }] });
    expect(computeSatisfactory(item, { value: "yes" }, "q")).toBeNull();
  });
});
