// asmt core: per-type response validation and the SATISFACTORY RULE.
//
// ⚠ DB MIRROR. computeSatisfactory below is the rule the asmt_response trigger applies (writer can never set the
// column). The DB slice must mirror it exactly:
//   state set:      unable_to_demonstrate -> false. Every other state -> null (not_assessed, not_observed,
//                   not_applicable, unable_to_determine carry no pass or fail meaning of their own. How a state is
//                   TREATED in scoring is a rules matter, see scoring.ts).
//   rating_scale:   the chosen level's satisfactory flag (true / false / null).
//   yes_no:         value "yes" is satisfactory unless config.satisfactoryValue = "no".
//   pass_fail:      value "pass" (config.satisfactoryValue may name "fail").
//   achieved:       value "achieved" (config.satisfactoryValue may name "not_achieved").
//   numeric_rating, measurement: if config.satisfactoryMin and/or satisfactoryMax is set, value inside the bounds
//                   (inclusive) -> true else false. If neither is set -> null.
//   multiple_choice single: the option's satisfactory flag. multi: false if any chosen option is false, else true if
//                   all chosen options are true, else null.
//   evidence:       value is the attachment count. count >= config.minCount (default 1) -> true else false.
//   free_text, datetime, na: null.
//   A secondary field (field_key other than "primary") is NEVER satisfactory-scored: always null.
//   An invalid response yields null (the trigger refuses it before it gets here).
import type { ChoiceOption, InstrumentItem, ItemConfig, ItemField, ResponseScale, ResponseType, ResponseValue, StateCode } from "./types";
import { PRIMARY, STATE_CODES } from "./types";

export interface FieldSpec {
  field_key: string;
  label: string;
  response_type: ResponseType;
  scale: ResponseScale | null;
  config: ItemConfig;
  required: boolean;
}

/** The spec of the primary field (the item itself) or of a secondary field. Null if the field does not exist. */
export function fieldSpec(item: InstrumentItem, fieldKey: string = PRIMARY): FieldSpec | null {
  if (fieldKey === PRIMARY) {
    return { field_key: PRIMARY, label: item.prompt, response_type: item.response_type, scale: item.scale ?? null, config: item.config ?? {}, required: item.mandatory };
  }
  const f: ItemField | undefined = (item.fields ?? []).find((x) => x.field_key === fieldKey);
  return f ? { field_key: f.field_key, label: f.label, response_type: f.response_type, scale: f.scale ?? null, config: f.config ?? {}, required: f.required } : null;
}

/** States a response may use. not_assessed is always allowed (it means "no answer yet"). */
export function allowedStates(spec: FieldSpec): StateCode[] {
  if (spec.response_type === "na") return ["not_assessed", "not_applicable"];
  const base: StateCode[] = spec.config.allowedStates
    ? spec.config.allowedStates
    : spec.response_type === "rating_scale" && spec.scale ? spec.scale.states.map((s) => s.state) : [];
  return Array.from(new Set<StateCode>(["not_assessed", ...base]));
}

/** Label of a state for this field: config.stateLabels, then the scale's own label, then a neutral default. */
export function stateLabel(spec: FieldSpec, s: StateCode): string {
  return spec.config.stateLabels?.[s] ?? spec.scale?.states.find((x) => x.state === s)?.label ?? s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export interface ResponseIssue { code: string; message: string }
export interface ResponseCheck { ok: boolean; issues: ResponseIssue[] }

const POSITIVE: Partial<Record<ResponseType, [string, string]>> = {
  yes_no: ["yes", "no"], pass_fail: ["pass", "fail"], achieved: ["achieved", "not_achieved"],
};
const ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const hasVal = (v: unknown) => v !== undefined && v !== null;

function optionOf(spec: FieldSpec, code: unknown): ChoiceOption | undefined {
  return (spec.config.options ?? []).find((o) => o.code === code);
}

/**
 * Validate one response against its field. `r` null/undefined means "no answer yet" and is valid.
 * Checks: exactly one of level_code / state / value; state allowed (NA permission); NA reason; options; min / max /
 * step; unit; maxLength; ISO date; evidence count.
 */
export function validateResponse(item: InstrumentItem, r: ResponseValue | null | undefined, fieldKey: string = PRIMARY): ResponseCheck {
  const issues: ResponseIssue[] = [];
  const bad = (code: string, message: string) => { issues.push({ code, message }); };
  const spec = fieldSpec(item, fieldKey);
  if (!spec) { bad("unknown_field", `Item has no field "${fieldKey}".`); return { ok: false, issues }; }
  if (r === null || r === undefined) return { ok: true, issues };
  const given = [hasVal(r.level_code), hasVal(r.state), hasVal(r.value)].filter(Boolean).length;
  if (given === 0) { bad("empty", "A response needs a level, a state or a value."); return { ok: false, issues }; }
  if (given > 1) { bad("multiple", "A response holds exactly one of level_code, state and value."); return { ok: false, issues }; }

  if (hasVal(r.state)) {
    const s = r.state as StateCode;
    if (!STATE_CODES.includes(s)) { bad("unknown_state", `Unknown state "${String(s)}".`); return { ok: false, issues }; }
    if (!allowedStates(spec).includes(s)) bad("state_not_allowed", `State "${s}" is not allowed on this field.`);
    if (s === "not_applicable" && spec.config.naReasonRequired && !(typeof r.reason === "string" && r.reason.trim())) {
      bad("reason_required", "Not applicable needs a reason.");
    }
    return { ok: issues.length === 0, issues };
  }

  const t = spec.response_type;
  if (t === "rating_scale") {
    if (hasVal(r.value)) bad("wrong_slot", "A rating is a level_code, not a value.");
    if (!spec.scale) bad("no_scale", "The field has no scale.");
    else if (!hasVal(r.level_code) || !spec.scale.levels.some((l) => l.code === r.level_code)) bad("unknown_level", `Level "${String(r.level_code)}" is not on the scale.`);
    return { ok: issues.length === 0, issues };
  }
  if (hasVal(r.level_code)) { bad("wrong_slot", `A ${t} response is a value, not a level_code.`); return { ok: false, issues }; }
  const v = r.value;
  const c = spec.config;
  switch (t) {
    case "yes_no": case "pass_fail": case "achieved": {
      const [a, b] = POSITIVE[t]!;
      if (v !== a && v !== b) bad("bad_value", `Expected "${a}" or "${b}".`);
      break;
    }
    case "numeric_rating": case "measurement": {
      let n: unknown = v;
      if (t === "measurement" && v && typeof v === "object" && !Array.isArray(v)) {
        const o = v as { value?: unknown; unit?: unknown };
        if (c.unit && o.unit !== c.unit) bad("unit_mismatch", `Expected unit "${c.unit}".`);
        n = o.value;
      }
      if (!isNum(n)) { bad("not_a_number", "Expected a number."); break; }
      if (typeof c.min === "number" && n < c.min) bad("below_min", `Below the minimum ${c.min}.`);
      if (typeof c.max === "number" && n > c.max) bad("above_max", `Above the maximum ${c.max}.`);
      if (c.integer && !Number.isInteger(n)) bad("not_integer", "Expected a whole number.");
      if (c.step && c.step > 0) {
        const base = typeof c.min === "number" ? c.min : 0;
        const q = (n - base) / c.step;
        if (Math.abs(q - Math.round(q)) > 1e-9) bad("off_step", `Not a multiple of ${c.step}.`);
      }
      break;
    }
    case "multiple_choice": {
      const multi = c.select === "multi";
      if (multi) {
        if (!Array.isArray(v) || v.length === 0) { bad("bad_value", "Choose at least one option."); break; }
        if (new Set(v).size !== v.length) bad("duplicate", "An option was chosen twice.");
        for (const x of v) if (!optionOf(spec, x)) bad("unknown_option", `Option "${String(x)}" does not exist.`);
      } else if (typeof v !== "string" || !optionOf(spec, v)) bad("unknown_option", `Option "${String(v)}" does not exist.`);
      break;
    }
    case "free_text": {
      if (typeof v !== "string") { bad("bad_value", "Expected text."); break; }
      if (c.maxLength !== undefined && v.length > c.maxLength) bad("too_long", `Longer than ${c.maxLength} characters.`);
      if (c.minLength !== undefined && v.trim().length < c.minLength) bad("too_short", `Shorter than ${c.minLength} characters.`);
      break;
    }
    case "datetime": {
      if (typeof v !== "string" || !ISO.test(v) || Number.isNaN(Date.parse(v))) { bad("bad_date", "Expected an ISO 8601 date or date and time."); break; }
      if (typeof c.min === "string" && Date.parse(v) < Date.parse(c.min)) bad("before_min", `Before ${c.min}.`);
      if (typeof c.max === "string" && Date.parse(v) > Date.parse(c.max)) bad("after_max", `After ${c.max}.`);
      break;
    }
    case "na": bad("na_needs_state", "A not-applicable field is answered with the not_applicable state only."); break;
    case "evidence": {
      if (!isNum(v) || !Number.isInteger(v) || v < 0) bad("bad_count", "Expected a whole number of attachments, zero or more.");
      break;
    }
  }
  return { ok: issues.length === 0, issues };
}

/** Pure: the numeric value of an answered response (rating level numeric_value, number, measurement, evidence count). */
export function numericValue(spec: FieldSpec, r: ResponseValue | null | undefined): number | null {
  if (!r || hasVal(r.state)) return null;
  if (spec.response_type === "rating_scale") {
    const l = spec.scale?.levels.find((x) => x.code === r.level_code);
    return l && isNum(l.numeric_value) ? l.numeric_value : null;
  }
  if (spec.response_type === "numeric_rating" || spec.response_type === "evidence") return isNum(r.value) ? r.value : null;
  if (spec.response_type === "measurement") {
    if (isNum(r.value)) return r.value;
    const o = r.value as { value?: unknown } | null;
    return o && typeof o === "object" && isNum(o.value) ? o.value : null;
  }
  return null;
}

/** Pure: the ordinal of a chosen rating level, or null. */
export function levelOrdinal(spec: FieldSpec, r: ResponseValue | null | undefined): number | null {
  if (spec.response_type !== "rating_scale" || !r || hasVal(r.state)) return null;
  const l = spec.scale?.levels.find((x) => x.code === r.level_code);
  return l ? l.ordinal : null;
}

/** Pure: partial credit 0..1 of a multiple_choice answer, or null when no chosen option carries a credit figure. */
export function creditOf(spec: FieldSpec, r: ResponseValue | null | undefined): number | null {
  if (spec.response_type !== "multiple_choice" || !r || hasVal(r.state) || !hasVal(r.value)) return null;
  const chosen = (Array.isArray(r.value) ? r.value : [r.value]).map((x) => optionOf(spec, x));
  if (chosen.length === 0 || chosen.some((o) => !o)) return null;
  const cr = chosen.map((o) => o!.credit);
  if (cr.some((x) => x === undefined || x === null)) return null;
  return Math.min(1, (cr as number[]).reduce((a, b) => a + b, 0));
}

/** Pure: the codes an answer is counted under (level code, yes/no value, option codes, or "state:<state>"). */
export function answerCodes(spec: FieldSpec, r: ResponseValue | null | undefined): string[] {
  if (!r) return [];
  if (hasVal(r.state)) return [`state:${r.state}`];
  if (spec.response_type === "rating_scale") return hasVal(r.level_code) ? [String(r.level_code)] : [];
  if (spec.response_type === "multiple_choice") return (Array.isArray(r.value) ? r.value : hasVal(r.value) ? [r.value] : []).map(String);
  if (POSITIVE[spec.response_type] && typeof r.value === "string") return [r.value];
  return [];
}

/** Pure: true / false / null. See the header for the rule the DB trigger mirrors. */
export function computeSatisfactory(item: InstrumentItem, r: ResponseValue | null | undefined, fieldKey: string = PRIMARY): boolean | null {
  if (fieldKey !== PRIMARY) return null;
  const spec = fieldSpec(item, fieldKey);
  if (!spec || !r) return null;
  if (hasVal(r.state)) return r.state === "unable_to_demonstrate" ? false : null;
  if (!validateResponse(item, r, fieldKey).ok) return null;
  const t = spec.response_type, c = spec.config;
  switch (t) {
    case "rating_scale": {
      const l = spec.scale?.levels.find((x) => x.code === r.level_code);
      return l && typeof l.satisfactory === "boolean" ? l.satisfactory : null;
    }
    case "yes_no": case "pass_fail": case "achieved": {
      const [a, b] = POSITIVE[t]!;
      const good = c.satisfactoryValue === a || c.satisfactoryValue === b ? c.satisfactoryValue : a;
      return r.value === good;
    }
    case "numeric_rating": case "measurement": {
      const n = numericValue(spec, r);
      if (n === null || (c.satisfactoryMin === undefined && c.satisfactoryMax === undefined)) return null;
      return (c.satisfactoryMin === undefined || n >= c.satisfactoryMin) && (c.satisfactoryMax === undefined || n <= c.satisfactoryMax);
    }
    case "multiple_choice": {
      const chosen = (Array.isArray(r.value) ? r.value : [r.value]).map((x) => optionOf(spec, x)!);
      const flags = chosen.map((o) => (typeof o.satisfactory === "boolean" ? o.satisfactory : null));
      if (flags.some((f) => f === false)) return false;
      return flags.every((f) => f === true) ? true : null;
    }
    case "evidence": return (r.value as number) >= (c.minCount ?? 1);
    default: return null;
  }
}
