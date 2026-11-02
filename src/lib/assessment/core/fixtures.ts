// asmt core: TEST FIXTURES, built as plain data. Four instruments on ONE engine with no schema change:
//   RESP_ASSESS   a staged skills assessment (rating scale, critical items, groups, evidence)
//   HH_AUDIT      a hand-hygiene percentage audit (yes/no with not applicable, measurement, date, free text)
//   BEDSIDE_AUDIT a concurrent audit (agreement options with partial credit, secondary fields, reasoned NA)
//   CHART_AUDIT   a retrospective chart audit (documented / partial / absent, unable to determine, required fields)
// Nothing here is seeded anywhere. They exist so the tests prove the engine represents all four.
import { LAYOUT_SCHEMA, RULES_SCHEMA, type RulesDoc } from "./rules-ast";
import type { InstrumentDef, InstrumentItem, InstrumentSection, ResponseScale } from "./types";

export const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function mkSection(n: number, title: string, position: number, parent?: number, weight = 1): InstrumentSection {
  return { stable_key: uid(n), parent_section_key: parent ? uid(parent) : null, title, weight, position };
}

export function mkItem(n: number, section: number, code: string, partial: Partial<InstrumentItem> & Pick<InstrumentItem, "response_type">): InstrumentItem {
  return {
    stable_key: uid(n), section_key: uid(section), code, prompt: `Prompt ${code}`, guidance: null, expected_performance: [],
    scale: null, config: {}, fields: [], group_code: null, method_codes: [], method_rule: "any",
    mandatory: false, critical: false, critical_requirements: [], evidence_requirement: null, weight: 1, references_text: null, position: n,
    ...partial,
  };
}

// ── RESP_ASSESS ──────────────────────────────────────────────────────────────────────────────────────────────
const lv = (code: string, ordinal: number, label: string, satisfactory: boolean, description: string) => ({ code, label, ordinal, numeric_value: null, satisfactory, description });
export const STAGE_RATING: ResponseScale = {
  code: "STAGE-0-6", scale_kind: "rating",
  levels: [
    lv("L0", 0, "0 No evidence", false, "No evidence of the expected performance."),
    lv("L1", 1, "1 Novice", false, "Needs step-by-step direction."),
    lv("L2", 2, "2 Novice", false, "Follows rules, little discretion."),
    lv("L3", 3, "3 Advanced beginner", true, "Performs acceptably with some support."),
    lv("L4", 4, "4 Competent", true, "Plans and prioritises independently."),
    lv("L5", 5, "5 Proficient", true, "Sees the whole picture and adapts."),
    lv("L6", 6, "6 Expert", true, "Intuitive, fluent performance."),
  ],
  states: [
    { state: "not_assessed", label: "Not assessed" },
    { state: "not_observed", label: "Not observed" },
    { state: "unable_to_demonstrate", label: "Unable to demonstrate" },
  ],
};

export const RA = { know: uid(101), skills: uid(102), applied: uid(103), k1: uid(11), k2: uid(12), cs1: uid(13), cs2: uid(14), ap1: uid(15), s1: uid(1), s2: uid(2) };

export const RESP_ASSESS: InstrumentDef = {
  instrument_code: "CHK-RESP-ASSESS", version_no: 1, purpose_code: "formative", method_codes: ["self_assessment", "direct_observation"],
  groups: [
    { code: "know", label: "Knowledge", weight: 1, position: 1 },
    { code: "skills", label: "Skills", weight: 1, position: 2 },
    { code: "applied", label: "Applied knowledge", weight: 1, position: 3 },
  ],
  sections: [mkSection(1, "Assess breathing", 1), mkSection(2, "Interpret findings", 2)],
  items: [
    mkItem(11, 1, "RA-K-01", { response_type: "rating_scale", scale: STAGE_RATING, group_code: "know", mandatory: true, method_codes: ["self_assessment"] }),
    mkItem(12, 1, "RA-K-02", { response_type: "rating_scale", scale: STAGE_RATING, group_code: "know" }),
    mkItem(13, 1, "RA-CS-01", { response_type: "rating_scale", scale: STAGE_RATING, group_code: "skills", mandatory: true, critical: true, critical_requirements: ["must_be_satisfactory", "must_be_observed"], method_codes: ["direct_observation"] }),
    mkItem(14, 1, "RA-CS-02", { response_type: "rating_scale", scale: STAGE_RATING, group_code: "skills", mandatory: true, method_codes: ["direct_observation"] }),
    mkItem(15, 2, "RA-AP-01", { response_type: "rating_scale", scale: STAGE_RATING, group_code: "applied", evidence_requirement: { required: true, min_count: 1 } }),
  ],
};

const groupOk = (g: string, n: number) => ({
  all: [
    { count: { scope: "group" as const, keys: [g] }, where: { satisfactory: false }, op: "=" as const, value: 0 },
    { count: { scope: "group" as const, keys: [g] }, where: { answered: true }, op: ">=" as const, value: n },
  ],
});

export const RESP_RULES: RulesDoc = {
  schema: RULES_SCHEMA,
  outcomes: [
    { code: "ACHIEVED", label: "Achieved", class: "positive" },
    { code: "PARTIAL", label: "Partially achieved", class: "partial" },
    { code: "DEV_REQ", label: "Further development required", class: "partial" },
    { code: "NOT_ACH", label: "Not achieved", class: "negative" },
    { code: "INCOMPLETE", label: "Incomplete", class: "incomplete" },
  ],
  gates: { criticalFail: "NOT_ACH", mandatoryMissing: "INCOMPLETE" },
  aggregates: [
    { id: "pct_all", fn: "percent_satisfactory", over: { scope: "all" }, weights: "item" },
  ],
  groups: [
    { group: "know", rules: [{ id: "know_ok", label: "Knowledge met", priority: 10, when: groupOk("know", 2), then: { outcome: "ACHIEVED" } }], fallback: "DEV_REQ" },
    { group: "skills", rules: [{ id: "skills_ok", label: "Skills met", priority: 10, when: groupOk("skills", 2), then: { outcome: "ACHIEVED" } }], fallback: "DEV_REQ" },
    { group: "applied", rules: [{ id: "applied_ok", label: "Applied met", priority: 10, when: groupOk("applied", 1), then: { outcome: "ACHIEVED" } }], fallback: "DEV_REQ" },
  ],
  rules: [
    // a high average alone would pass: this rule exists so the critical gate has something to override
    { id: "high_average", label: "High average", priority: 100, when: { aggregate: "pct_all", op: ">=", value: 60 }, then: { outcome: "ACHIEVED" } },
    { id: "all_groups", label: "Every group met", priority: 20, when: { all: [{ groupOutcome: "know", is: "ACHIEVED" }, { groupOutcome: "skills", is: "ACHIEVED" }, { groupOutcome: "applied", is: "ACHIEVED" }] }, then: { outcome: "ACHIEVED" } },
    { id: "skills_only", label: "Skills met, others not", priority: 10, when: { groupOutcome: "skills", is: "ACHIEVED" }, then: { outcome: "PARTIAL" } },
  ],
  fallback: "DEV_REQ",
};

// ── HH_AUDIT ─────────────────────────────────────────────────────────────────────────────────────────────────
export const HH = { s1: uid(201), s2: uid(202), ids: [uid(211), uid(212), uid(213), uid(214), uid(215)], crit: uid(216), meas: uid(217), when: uid(218), note: uid(219) };

export const HH_AUDIT: InstrumentDef = {
  instrument_code: "AUD-HH-01", version_no: 1, purpose_code: "audit", method_codes: ["direct_observation"],
  groups: [],
  sections: [mkSection(201, "Hand hygiene moments", 1), mkSection(202, "Context", 2)],
  items: [
    ...[211, 212, 213, 214, 215].map((n, i) => mkItem(n, 201, `HH-0${i + 1}`, { response_type: "yes_no", mandatory: true, config: { allowedStates: ["not_applicable"] } })),
    mkItem(216, 201, "HH-06", { response_type: "yes_no", mandatory: true, critical: true, critical_requirements: ["auto_fail"], config: { allowedStates: ["not_applicable"] } }),
    mkItem(217, 202, "HH-07", { response_type: "measurement", config: { unit: "count", min: 0 } }),
    mkItem(218, 202, "HH-08", { response_type: "datetime" }),
    mkItem(219, 202, "HH-09", { response_type: "free_text", config: { maxLength: 500 } }),
  ],
};

export const HH_RULES: RulesDoc = {
  schema: RULES_SCHEMA,
  outcomes: [
    { code: "COMPLIANT", label: "Compliant", class: "positive" },
    { code: "PARTIAL", label: "Partially compliant", class: "partial" },
    { code: "NON_COMPLIANT", label: "Non-compliant", class: "negative" },
    { code: "INCOMPLETE", label: "Incomplete", class: "incomplete" },
  ],
  gates: { criticalFail: "NON_COMPLIANT", mandatoryMissing: "INCOMPLETE" },
  aggregates: [
    { id: "pct", fn: "percent_satisfactory", over: { scope: "items", keys: [...HH.ids, HH.crit] }, weights: "none" },
    { id: "counted", fn: "count", over: { scope: "items", keys: [...HH.ids, HH.crit] }, weights: "none" },
  ],
  rules: [
    { id: "nothing_counted", label: "Nothing to count", priority: 30, when: { aggregate: "counted", op: "=", value: 0 }, then: { outcome: "INCOMPLETE" } },
    { id: "high", label: "At least 90 percent", priority: 20, when: { aggregate: "pct", op: ">=", value: 90 }, then: { outcome: "COMPLIANT" } },
    { id: "mid", label: "At least 70 percent", priority: 10, when: { aggregate: "pct", op: ">=", value: 70 }, then: { outcome: "PARTIAL" } },
  ],
  fallback: "NON_COMPLIANT",
};

// ── BEDSIDE_AUDIT (concurrent) ───────────────────────────────────────────────────────────────────────────────
export const BA = { s1: uid(301), items: [uid(311), uid(312), uid(313), uid(314)] };
const agree = [
  { code: "yes", label: "Yes", satisfactory: true, credit: 1 },
  { code: "partial", label: "Partial", satisfactory: null, credit: 0.5 },
  { code: "no", label: "No", satisfactory: false, credit: 0 },
];
const bedsideFields = [
  { field_key: "staff_role", label: "Staff role", response_type: "multiple_choice" as const, config: { options: [{ code: "reg", label: "Registered" }, { code: "asst", label: "Assistant" }] }, required: true, position: 1 },
  { field_key: "observation_note", label: "Observation", response_type: "free_text" as const, config: { maxLength: 300 }, required: false, position: 2 },
];
export const BEDSIDE_AUDIT: InstrumentDef = {
  instrument_code: "AUD-BED-01", version_no: 1, purpose_code: "audit", method_codes: ["direct_observation"],
  groups: [],
  sections: [mkSection(301, "Observed care", 1)],
  items: BA.items.map((_k, i) => mkItem(311 + i, 301, `BA-0${i + 1}`, {
    response_type: "multiple_choice", mandatory: true,
    config: { options: agree, select: "single", allowedStates: ["not_applicable", "unable_to_determine"], naReasonRequired: true, stateLabels: { unable_to_determine: "Could not observe" } },
    fields: bedsideFields,
  })),
};
export const BEDSIDE_RULES: RulesDoc = {
  schema: RULES_SCHEMA,
  outcomes: [
    { code: "MET", label: "Standard met", class: "positive" },
    { code: "PARTIAL", label: "Partly met", class: "partial" },
    { code: "NOT_MET", label: "Not met", class: "negative" },
    { code: "INCOMPLETE", label: "Incomplete", class: "incomplete" },
  ],
  gates: { mandatoryMissing: "INCOMPLETE" },
  defaults: { undeterminable: "exclude" },
  aggregates: [{ id: "credit", fn: "credit_percent", over: { scope: "all" }, weights: "none" }],
  rules: [
    { id: "met", label: "Credit 85 or more", priority: 20, when: { aggregate: "credit", op: ">=", value: 85 }, then: { outcome: "MET" } },
    { id: "partial", label: "Credit 60 or more", priority: 10, when: { aggregate: "credit", op: ">=", value: 60 }, then: { outcome: "PARTIAL" } },
  ],
  fallback: "NOT_MET",
};

// ── CHART_AUDIT (retrospective) ──────────────────────────────────────────────────────────────────────────────
export const CA = { s1: uid(401), items: [uid(411), uid(412), uid(413)] };
const doc = [
  { code: "documented", label: "Documented", satisfactory: true, credit: 1 },
  { code: "partial", label: "Partly documented", satisfactory: null, credit: 0.5 },
  { code: "absent", label: "Not documented", satisfactory: false, credit: 0 },
];
export const CHART_AUDIT: InstrumentDef = {
  instrument_code: "AUD-CHART-01", version_no: 1, purpose_code: "audit", method_codes: ["portfolio_review"],
  groups: [],
  sections: [mkSection(401, "Chart entries", 1)],
  items: CA.items.map((_k, i) => mkItem(411 + i, 401, `CH-0${i + 1}`, {
    response_type: "multiple_choice", mandatory: false,
    config: { options: doc, select: "single", allowedStates: ["unable_to_determine"], treat: { undeterminable: "exclude" } },
    fields: [
      { field_key: "chart_ref", label: "Chart reference", response_type: "free_text", config: { maxLength: 40 }, required: true, position: 1 },
      { field_key: "entry_date", label: "Entry date", response_type: "datetime", config: {}, required: false, position: 2 },
    ],
  })),
};
export const CHART_RULES: RulesDoc = {
  schema: RULES_SCHEMA,
  outcomes: [
    { code: "GOOD", label: "Well documented", class: "positive" },
    { code: "GAPS", label: "Gaps found", class: "negative" },
    { code: "NONE", label: "Nothing could be judged", class: "incomplete" },
  ],
  aggregates: [
    { id: "pct", fn: "percent_satisfactory", over: { scope: "all" }, weights: "none" },
    { id: "judged", fn: "count", over: { scope: "all" }, weights: "none" },
  ],
  rules: [
    { id: "none_judged", label: "Nothing judged", priority: 30, when: { aggregate: "judged", op: "=", value: 0 }, then: { outcome: "NONE" } },
    { id: "good", label: "All documented", priority: 20, when: { aggregate: "pct", op: ">=", value: 100 }, then: { outcome: "GOOD" } },
  ],
  fallback: "GAPS",
};

export const layoutBase = { schema: LAYOUT_SCHEMA } as const;
