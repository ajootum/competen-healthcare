// Checklist Studio: STARTER rule sets (owner GO 3 Nov 2026). Three ordinary rules documents an author copies into a draft as
// their own editable rules, so no published scoring template is needed to prepare a checklist. They are not governed content:
// the draft still goes through independent review and publication. Client-safe, pure, and universal (no profession named).
import { RULES_SCHEMA, type InstrumentDef, type RulesDoc } from "../core";

export interface Starter {
  id: string; label: string; summary: string;
  build: (def: InstrumentDef) => RulesDoc;
  /** why this starter does not fit the definition, or null when it does */
  unfit: (def: InstrumentDef) => string | null;
}

const gates = { criticalFail: "NOT_MET", mandatoryMissing: "INCOMPLETE" } as const;

/** Compliance percentage over Yes / No / N/A answers: a percentage target and a lower partial band, both editable. */
export function compliancePercentage(): RulesDoc {
  return {
    schema: RULES_SCHEMA,
    outcomes: [
      { code: "COMPLIANT", label: "Compliant", class: "positive" },
      { code: "PARTIAL", label: "Partially compliant", class: "partial" },
      { code: "NOT_MET", label: "Non-compliant", class: "negative" },
      { code: "INCOMPLETE", label: "Incomplete", class: "incomplete" },
    ],
    gates,
    defaults: { na: "exclude", undeterminable: "exclude" },
    aggregates: [
      { id: "pct", fn: "percent_satisfactory", over: { scope: "all" }, weights: "none" },
      { id: "judged", fn: "count", over: { scope: "all" }, weights: "none" },
    ],
    rules: [
      { id: "nothing_judged", label: "Nothing could be judged", priority: 30, when: { aggregate: "judged", op: "=", value: 0 }, then: { outcome: "INCOMPLETE" } },
      { id: "target_met", label: "At least 90 percent met", priority: 20, when: { aggregate: "pct", op: ">=", value: 90 }, then: { outcome: "COMPLIANT" }, explain: "Starter: change 90 to your own target." },
      { id: "partial", label: "At least 70 percent met", priority: 10, when: { aggregate: "pct", op: ">=", value: 70 }, then: { outcome: "PARTIAL" }, explain: "Starter: change 70 to your own lower band, or remove this rule." },
    ],
    fallback: "NOT_MET",
  };
}

/** Rating threshold: every rated item at or above a level is achieved, any is partial. The level is the middle of the scale. */
export function ratingThreshold(def: InstrumentDef): RulesDoc {
  const levels = (def.items.find((it) => it.response_type === "rating_scale" && it.scale?.levels.length)?.scale?.levels ?? []).map((l) => l.ordinal).sort((a, b) => a - b);
  const threshold = levels.length ? levels[Math.ceil((levels.length - 1) / 2)] : 1;
  return {
    schema: RULES_SCHEMA,
    outcomes: [
      { code: "ACHIEVED", label: "Achieved", class: "positive" },
      { code: "PARTIAL", label: "Partially achieved", class: "partial" },
      { code: "NOT_MET", label: "Not achieved", class: "negative" },
      { code: "INCOMPLETE", label: "Incomplete", class: "incomplete" },
    ],
    gates,
    defaults: { na: "exclude", undeterminable: "exclude" },
    aggregates: [
      { id: "lowest", fn: "min_ordinal", over: { scope: "all" }, weights: "none" },
      { id: "highest", fn: "max_ordinal", over: { scope: "all" }, weights: "none" },
      { id: "rated", fn: "count", over: { scope: "all" }, weights: "none" },
    ],
    rules: [
      { id: "nothing_rated", label: "Nothing rated", priority: 30, when: { aggregate: "rated", op: "=", value: 0 }, then: { outcome: "INCOMPLETE" } },
      { id: "all_at_threshold", label: `Every rated item at or above level ${threshold}`, priority: 20, when: { aggregate: "lowest", op: ">=", value: threshold }, then: { outcome: "ACHIEVED" }, explain: `Starter: the threshold ${threshold} is the middle of the scale. Change it to your own level.` },
      { id: "some_at_threshold", label: `Some items at or above level ${threshold}`, priority: 10, when: { aggregate: "highest", op: ">=", value: threshold }, then: { outcome: "PARTIAL" } },
    ],
    fallback: "NOT_MET",
  };
}

/** Every item that carries a pass or fail meaning must be met, and critical items decide outright. */
export function allCriticalItemsMet(): RulesDoc {
  return {
    schema: RULES_SCHEMA,
    outcomes: [
      { code: "MET", label: "Met", class: "positive" },
      { code: "NOT_MET", label: "Not met", class: "negative" },
      { code: "INCOMPLETE", label: "Incomplete", class: "incomplete" },
    ],
    gates,
    defaults: { na: "exclude" },
    rules: [
      { id: "nothing_answered", label: "Nothing answered", priority: 20, when: { count: { scope: "all" }, where: { answered: true }, op: "=", value: 0 }, then: { outcome: "INCOMPLETE" } },
      { id: "all_met", label: "No item not met, at least one answered", priority: 10, when: { all: [{ count: { scope: "all" }, where: { satisfactory: false }, op: "=", value: 0 }, { count: { scope: "all" }, where: { answered: true }, op: ">=", value: 1 }] }, then: { outcome: "MET" }, explain: "Starter: a critical item not met decides Not met through the gate, before this rule." },
    ],
    fallback: "NOT_MET",
  };
}

export const STARTERS: Starter[] = [
  { id: "compliance", label: "Compliance percentage (Yes / No / N/A)", summary: "Met over met plus not met, not applicable excluded. Target 90 percent, partial band 70 percent, both yours to change.", build: () => compliancePercentage(),
    unfit: (def) => (def.items.some((it) => ["yes_no", "pass_fail", "achieved", "multiple_choice", "rating_scale", "numeric_rating", "measurement", "evidence"].includes(it.response_type)) ? null : "No item carries a met or not met meaning yet.") },
  { id: "rating_threshold", label: "Rating threshold", summary: "Every rated item at or above a level is Achieved, any is Partially achieved. The level starts at the middle of the scale.", build: ratingThreshold,
    unfit: (def) => (def.items.some((it) => it.response_type === "rating_scale") ? null : "No item rates on a scale.") },
  { id: "all_critical", label: "All critical items met", summary: "Any item not met is Not met; critical items decide through the gate. Nothing answered is Incomplete.", build: () => allCriticalItemsMet(),
    unfit: (def) => (def.items.length ? null : "No items yet.") },
];
