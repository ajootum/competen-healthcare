// asmt core: the three closed grammars a no-code builder may produce.
//   asmt.rules/1        scoring (Scoring Rules Builder, scoring templates)
//   asmt.progression/1  staging over many assessments (Progression Rules Builder)
//   asmt.layout/1       presentation (Template Designer)
// Everything is JSON data. There is no expression string, no eval, no Function. A key that is not in these types
// is refused by the validators.
import type { Attestation, OutcomeClass, ResponseType, StateCode, Treatment } from "./types";
import type { Cond } from "./cond";

// ── asmt.rules/1 ─────────────────────────────────────────────────────────────────────────────────────────────
export const RULES_SCHEMA = "asmt.rules/1" as const;
export const OPS = ["=", "!=", "<", "<=", ">", ">="] as const;
export type Op = (typeof OPS)[number];
export const AGG_FNS = ["count", "sum", "weighted_sum", "percent_satisfactory", "min_ordinal", "max_ordinal", "mean_numeric", "credit_percent"] as const;
export type AggFn = (typeof AGG_FNS)[number];
export const WEIGHT_MODES = ["item", "section", "none"] as const;
export type WeightMode = (typeof WEIGHT_MODES)[number];
export const SCOPES = ["all", "section", "group", "items"] as const;
export type Scope = (typeof SCOPES)[number];

export interface OutcomeDef { code: string; label: string; class: OutcomeClass }

/** Which items. `keys` are section stable_keys, group codes or item stable_keys according to scope. */
export interface Selector {
  scope: Scope;
  keys?: string[];
  critical?: boolean;
  mandatory?: boolean;
  methods?: string[];
}

export type Test =
  | { state: StateCode }
  | { satisfactory: boolean }
  | { levelAtLeast: number }
  | { levelAtMost: number }
  | { value: { op: Op; n: number } }
  | { answered: boolean };

export type Pred =
  | { count: Selector; where: Test; op: Op; value: number }
  | { aggregate: string; op: Op; value: number }
  | { item: string; field?: string; test: Test }
  | { criticalFailed: Selector | true }
  | { mandatoryMissing: Selector | true }
  | { evidenceMissing: Selector | true }
  | { groupOutcome: string; is: string };

export type RulesCond = Cond<Pred>;

export interface Rule {
  id: string;
  label: string;
  /** Higher number is evaluated first. First match wins. */
  priority: number;
  when: RulesCond;
  then: { outcome: string };
  explain?: string;
}

export interface AggregateDef { id: string; fn: AggFn; over: Selector; weights: WeightMode }
export interface GroupRules { group: string; rules: Rule[]; fallback: string }

export interface RulesDoc {
  schema: typeof RULES_SCHEMA;
  outcomes: OutcomeDef[];
  /** Built in, cannot be turned off. Required whenever an item is critical (criticalFail) or mandatory (mandatoryMissing). */
  gates?: { criticalFail?: string; mandatoryMissing?: string };
  defaults?: Treatment;
  aggregates?: AggregateDef[];
  groups?: GroupRules[];
  rules: Rule[];
  fallback: string;
  /** Mean over ordinal (rating_scale) values is refused unless this is true. Shown to the reviewer when true. */
  permitOrdinalMean?: boolean;
}

export const TEST_KEYS = ["state", "satisfactory", "levelAtLeast", "levelAtMost", "value", "answered"] as const;
export const PRED_KEYS = ["count", "aggregate", "item", "criticalFailed", "mandatoryMissing", "evidenceMissing", "groupOutcome"] as const;
export const PRED_ALLOWED: Record<(typeof PRED_KEYS)[number], string[]> = {
  count: ["count", "where", "op", "value"],
  aggregate: ["aggregate", "op", "value"],
  item: ["item", "field", "test"],
  criticalFailed: ["criticalFailed"],
  mandatoryMissing: ["mandatoryMissing"],
  evidenceMissing: ["evidenceMissing"],
  groupOutcome: ["groupOutcome", "is"],
};
export const SELECTOR_KEYS = ["scope", "keys", "critical", "mandatory", "methods"] as const;
export const RULES_TOP_KEYS = ["schema", "outcomes", "gates", "defaults", "aggregates", "groups", "rules", "fallback", "permitOrdinalMean"] as const;
export const RULE_KEYS = ["id", "label", "priority", "when", "then", "explain"] as const;
export const AGGREGATE_KEYS = ["id", "fn", "over", "weights"] as const;

// ── asmt.progression/1 ───────────────────────────────────────────────────────────────────────────────────────
export const PROGRESSION_SCHEMA = "asmt.progression/1" as const;

/** The frozen stage scale and the bands that map a response level ordinal to a stage. */
export interface StageDef { code: string; label: string; ordinal: number }
export interface StageBand { stage: string; from_ordinal: number; to_ordinal: number }
export interface StageScale { stages: StageDef[]; bands: StageBand[] }

export interface EvidenceWhere {
  attestation?: Attestation;
  method?: string;
  outcomeClass?: OutcomeClass;
  /** the lowest level ordinal answered in the group maps, through the bands, to a stage at or above atLeast */
  minLevelStage?: { group: string; atLeast: string };
}

export type ProgPred =
  | { count: { where: EvidenceWhere }; op: Op; value: number }
  | { latest: { field: "outcomeClass" | "outcomeCode"; is: string } }
  | { anyCriticalFailure: { withinDays?: number } }
  | { distinctAssessors: { where?: EvidenceWhere }; op: Op; value: number };

export interface ProgressionDoc {
  schema: typeof PROGRESSION_SCHEMA;
  /** "unstaged" or the code of a stage in the scale used to label the not-staged state */
  notStaged: string;
  target: { stage: string } | { fromProgramme: true };
  evidence: { attestation: Attestation[]; methods?: string[]; withinDays?: number };
  stageRules: { stage: string; when: Cond<ProgPred> }[];
  /** how several records that each meet a count filter combine: latest | best | all_must_meet */
  repeated: "latest" | "best" | "all_must_meet";
  /** when the latest records of different assessors disagree: reduce to the latest, or to the lowest */
  conflicting: "latest" | "lowest";
  permitOrdinalMean: boolean;
  permitSingleAssessment: boolean;
}

export const PROG_TOP_KEYS = ["schema", "notStaged", "target", "evidence", "stageRules", "repeated", "conflicting", "permitOrdinalMean", "permitSingleAssessment"] as const;
export const WHERE_KEYS = ["attestation", "method", "outcomeClass", "minLevelStage"] as const;

// ── asmt.layout/1 ────────────────────────────────────────────────────────────────────────────────────────────
export const LAYOUT_SCHEMA = "asmt.layout/1" as const;
export const PRESENTATIONS = ["standard_checklist", "guided_assessment", "audit_inspection", "assessment_form", "matrix"] as const;
export type Presentation = (typeof PRESENTATIONS)[number];
/** Phase 1 can publish only these. */
export const AVAILABLE_PRESENTATIONS: Presentation[] = ["standard_checklist", "guided_assessment"];

export const NAV_MODES = ["scroll", "stepper", "section_tabs"] as const;
export const NAV_UNITS = ["item", "section"] as const;
export const NAV_PROGRESS = ["bar", "count"] as const;
export const HEADER_BLOCKS = ["TitleBlock", "InstructionsBlock", "SubjectBlock", "ProgressBlock", "ContextBlock", "MetadataBlock"] as const;
export type HeaderBlock = (typeof HEADER_BLOCKS)[number];
export const SECTION_COMPONENTS = ["SectionCard", "SectionAccordion"] as const;
export const ITEM_COMPONENTS = ["ItemRow", "ItemCard", "ItemFocus"] as const;
export const BADGES = ["critical", "mandatory", "method", "group"] as const;
export type Badge = (typeof BADGES)[number];
export const GROUPINGS = ["section", "group", "section_then_group"] as const;
export const SLOT_VALUES = {
  guidance: ["inline", "disclosure"],
  expected: ["inline", "disclosure"],
  response: ["right", "below"],
  evidence: ["inline", "drawer"],
  comment: ["inline", "drawer"],
  fields: ["grid2", "stack"],
} as const;
/** Control names allowed per response type. Closed vocabulary. */
export const CONTROL_VOCAB: Record<ResponseType, readonly string[]> = {
  rating_scale: ["segmented", "radio_list", "select"],
  yes_no: ["segmented", "radio_list"],
  pass_fail: ["segmented", "radio_list"],
  achieved: ["segmented", "radio_list"],
  numeric_rating: ["segmented", "select", "input"],
  multiple_choice: ["radio_list", "select", "checkbox_list"],
  free_text: ["textarea"],
  datetime: ["input"],
  measurement: ["input"],
  na: ["checkbox"],
  evidence: ["uploader"],
};
export const PRINT_KEYS = ["guidance", "responses", "evidenceList", "pageBreak", "signature", "orientation"] as const;

export interface LayoutSlots {
  guidance: "inline" | "disclosure";
  expected: "inline" | "disclosure";
  response: "right" | "below";
  evidence: "inline" | "drawer";
  comment: "inline" | "drawer";
  /** secondary fields of a multi-field item: two-column grid on tablet and desktop, stack on mobile, or always stack */
  fields: "grid2" | "stack";
  badges: Badge[];
}
export interface LayoutNavigation {
  mode: "scroll" | "stepper" | "section_tabs";
  unit: "item" | "section";
  progress: "bar" | "count";
  allowJump: boolean;
  prevNext: boolean;
  /** section tabs with per-section counts (answered / total) */
  sectionTabs?: { counts: boolean };
}
export interface LayoutDoc {
  schema: typeof LAYOUT_SCHEMA;
  presentation: Presentation;
  navigation: LayoutNavigation;
  header: HeaderBlock[];
  /** fields shown by MetadataBlock; the values are supplied by the adapter, never by the layout */
  metadata?: { fields: { key: string; label: string }[] };
  section: { component: "SectionCard" | "SectionAccordion"; collapsible: boolean; groupBadges: boolean };
  item: { component: "ItemRow" | "ItemCard" | "ItemFocus"; slots: LayoutSlots };
  controls: Partial<Record<ResponseType, string>>;
  grouping: "section" | "group" | "section_then_group";
  indicators: { completed: boolean; unassessed: boolean; critical: boolean; missingEvidence: boolean };
  /** the Evaluate / Preview outcome before submit control */
  outcomePreview?: { enabled: boolean; label?: string };
  breakpoints?: {
    mobile?: { item?: { component: LayoutDoc["item"]["component"] }; slots?: Partial<LayoutSlots> };
    tablet?: { item?: { component: LayoutDoc["item"]["component"] }; slots?: Partial<LayoutSlots> };
  };
  print: {
    guidance: boolean; responses: boolean; evidenceList: boolean;
    pageBreak: "section" | "none"; signature: boolean; orientation: "portrait" | "landscape";
  };
}
export const LAYOUT_TOP_KEYS = ["schema", "presentation", "navigation", "header", "metadata", "section", "item", "controls", "grouping", "indicators", "outcomePreview", "breakpoints", "print"] as const;
export const NAV_KEYS = ["mode", "unit", "progress", "allowJump", "prevNext", "sectionTabs"] as const;
export const SLOT_KEYS = ["guidance", "expected", "response", "evidence", "comment", "fields", "badges"] as const;
/** Key names that would let a layout select, hide, filter or reorder items. Refused with a specific message. */
export const ITEM_SELECTOR_KEYS = [
  "items", "itemKeys", "item_keys", "hide", "hidden", "show", "only", "include", "exclude", "filter", "where", "select",
  "selector", "order", "sort", "sortBy", "skip", "visibleItems", "visible", "limit",
] as const;
