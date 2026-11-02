// asmt core: the instrument definition and response shapes. Client-safe, no React, no DB.
// Field names are snake_case and mirror the asmt_* columns so the DB slice and the UI map 1:1.
// Config keys (the jsonb `config` of an item or field) are camelCase, as in the design.
// Nothing here knows any profession, framework or scale: a scale is data.

export const STATE_CODES = ["not_assessed", "not_observed", "not_applicable", "unable_to_demonstrate", "unable_to_determine"] as const;
export type StateCode = (typeof STATE_CODES)[number];

export const RESPONSE_TYPES = [
  "rating_scale", "yes_no", "pass_fail", "achieved", "numeric_rating", "multiple_choice",
  "free_text", "datetime", "measurement", "na", "evidence",
] as const;
export type ResponseType = (typeof RESPONSE_TYPES)[number];

export const CRITICAL_REQUIREMENTS = ["must_be_satisfactory", "must_be_observed", "auto_fail", "reassess"] as const;
export type CriticalRequirement = (typeof CRITICAL_REQUIREMENTS)[number];

export const ATTESTATIONS = ["self_reported", "assessor_evaluated", "auditor_recorded"] as const;
export type Attestation = (typeof ATTESTATIONS)[number];

export const OUTCOME_CLASSES = ["positive", "partial", "negative", "incomplete"] as const;
export type OutcomeClass = (typeof OUTCOME_CLASSES)[number];

/** The reserved key of an item's scored (primary) field. */
export const PRIMARY = "primary";

// ── scales (asmt_response_scale_version / _level / _state, frozen into the definition) ────────────────────────
export interface ScaleLevel {
  code: string;
  label: string;
  description?: string | null;
  ordinal: number;
  numeric_value?: number | null;
  /** true / false / null (null = the level carries no pass or fail meaning) */
  satisfactory?: boolean | null;
  colour_token?: string | null;
  source_level_id?: string | null;
}
export interface ScaleStateDef { state: StateCode; label: string }
export interface ResponseScale {
  code?: string;
  version_id?: string;
  scale_kind?: "rating" | "stage";
  levels: ScaleLevel[];
  states: ScaleStateDef[];
}

// ── items ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ChoiceOption {
  code: string;
  label: string;
  description?: string | null;
  /** true / false / null. Null = no pass or fail meaning. */
  satisfactory?: boolean | null;
  /** partial credit 0..1, or null/absent = this option earns no credit figure */
  credit?: number | null;
}

/** How a state is treated in scoring. Item config.treat overrides rules.defaults. */
export interface Treatment {
  na?: "exclude" | "count_unsatisfactory";
  notObserved?: "missing" | "unsatisfactory";
  unable?: "unsatisfactory";
  undeterminable?: "missing" | "unsatisfactory" | "exclude";
}

export interface ItemConfig {
  // multiple_choice
  options?: ChoiceOption[];
  select?: "single" | "multi";
  // numeric_rating, measurement, datetime (min/max are ISO strings for datetime)
  min?: number | string;
  max?: number | string;
  step?: number;
  integer?: boolean;
  unit?: string;
  // free_text
  minLength?: number;
  maxLength?: number;
  // states
  allowedStates?: StateCode[];
  stateLabels?: Partial<Record<StateCode, string>>;
  naReasonRequired?: boolean;
  treat?: Treatment;
  // what counts as satisfactory (see computeSatisfactory)
  satisfactoryValue?: string;
  satisfactoryMin?: number;
  satisfactoryMax?: number;
  minCount?: number;
}

export interface EvidenceRequirement {
  required: boolean;
  min_count?: number;
  kinds?: string[];
}

/** A secondary field of an item. Its response is keyed (item stable_key, field_key). Never scored by default. */
export interface ItemField {
  field_key: string; // ^[a-z][a-z0-9_]{1,40}$, never "primary"
  label: string;
  response_type: ResponseType;
  scale_version_id?: string | null;
  scale?: ResponseScale | null;
  config: ItemConfig;
  required: boolean;
  position: number;
}

export interface InstrumentGroup { code: string; label: string; weight: number; position: number; source_ref?: string | null }

export interface InstrumentSection {
  stable_key: string;
  parent_section_key?: string | null;
  title: string;
  guidance?: string | null;
  weight: number;
  position: number;
}

export interface InstrumentItem {
  stable_key: string;
  /** stable_key of the section this item sits in */
  section_key: string;
  code: string;
  prompt: string;
  guidance?: string | null;
  expected_performance?: { term_id?: string | null; text: string }[];
  response_type: ResponseType;
  scale_version_id?: string | null;
  /** the frozen scale for a rating_scale item (required when response_type is rating_scale) */
  scale?: ResponseScale | null;
  config: ItemConfig;
  fields?: ItemField[];
  group_code?: string | null;
  method_codes: string[];
  method_rule?: "any" | "all";
  mandatory: boolean;
  critical: boolean;
  critical_requirements: CriticalRequirement[];
  evidence_requirement?: EvidenceRequirement | null;
  weight: number;
  references_text?: string | null;
  position: number;
}

export interface InstrumentDef {
  instrument_code?: string;
  version_no: number;
  version_id?: string;
  purpose_code?: string | null;
  method_codes?: string[];
  groups: InstrumentGroup[];
  sections: InstrumentSection[];
  items: InstrumentItem[];
}

// ── responses ────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * One stored response. Exactly one of level_code (rating_scale), state, value is set.
 * `reason` is the free-text reason a state needs (config.naReasonRequired).
 * `satisfactory` is NEVER trusted from here: it is computed by computeSatisfactory.
 */
export interface ResponseValue {
  level_code?: string | null;
  state?: StateCode | null;
  value?: unknown;
  reason?: string | null;
}

/**
 * Responses keyed by rkey(): the item stable_key for the primary field, "<stable_key>#<field_key>" for a secondary one.
 * DB mapping: asmt_response (item_id, field_key) -> stable_key of item, field_key.
 */
export type Responses = Record<string, ResponseValue>;
export const rkey = (itemKey: string, fieldKey: string = PRIMARY): string => (fieldKey === PRIMARY ? itemKey : `${itemKey}#${fieldKey}`);

export interface EvalContext {
  /** evidence attachments per item stable_key (asmt_evidence rows), for evidence_requirement checks */
  evidenceCounts?: Record<string, number>;
}

export interface Issue { code: string; path: string; message: string }
export interface ValidationResult { errors: Issue[]; warnings: Issue[] }
