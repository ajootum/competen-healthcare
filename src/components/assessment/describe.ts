// Pure helpers that turn a stored response into words, for the report and the print sheet.
import {
  allowedStates, fieldSpec, stateLabel, PRIMARY,
  type FieldSpec, type InstrumentItem, type ResponseValue,
} from "@/lib/assessment/core";
import { optionsOf } from "./FieldControls";

const YES_NO_WORDS: Record<string, string> = {
  yes: "Yes", no: "No", pass: "Pass", fail: "Fail", achieved: "Achieved", not_achieved: "Not achieved",
};

/** The words for one answer: the level or option label, the state label (with its reason), or the value with its unit. Null when unanswered. */
export function describeResponse(spec: FieldSpec, r: ResponseValue | null | undefined): string | null {
  if (!r) return null;
  if (r.state != null) {
    if (r.state === "not_assessed") return null;
    return `${stateLabel(spec, r.state)}${r.reason ? `: ${r.reason}` : ""}`;
  }
  const opts = optionsOf(spec);
  if (r.level_code != null) return opts.find((o) => o.code === r.level_code)?.label ?? String(r.level_code);
  const v = r.value;
  if (v == null) return null;
  if (spec.response_type === "multiple_choice") {
    const codes = Array.isArray(v) ? v.map(String) : [String(v)];
    return codes.map((c) => opts.find((o) => o.code === c)?.label ?? c).join(", ");
  }
  if (typeof v === "string" && YES_NO_WORDS[v] && ["yes_no", "pass_fail", "achieved"].includes(spec.response_type)) return YES_NO_WORDS[v];
  if (spec.response_type === "measurement") {
    const n = typeof v === "object" ? (v as { value?: unknown }).value : v;
    return `${String(n)}${spec.config.unit ? ` ${spec.config.unit}` : ""}`;
  }
  if (spec.response_type === "evidence") return `${String(v)} attached`;
  return String(v);
}

/** Label of an answer code as counted by the engine (a level code, option code, yes or no value, or "state:<state>"). */
export function answerCodeLabels(items: InstrumentItem[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const it of items) {
    const specs = [fieldSpec(it, PRIMARY)!];
    for (const sp of specs) {
      for (const o of optionsOf(sp)) if (!(o.code in out)) out[o.code] = o.label;
      for (const s of allowedStates(sp)) { const k = `state:${s}`; if (!(k in out)) out[k] = stateLabel(sp, s); }
    }
  }
  return out;
}
