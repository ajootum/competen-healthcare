// Checklist Studio: row and view types over the 890 to 892 contract. Client-safe (types and constants only).
// The Studio is universal: it knows versions, items, scales, templates and rules, not any profession or framework.
// The one place it meets a framework is the adapter folder under src/lib/assessment/adapters.
import type { InstrumentDef, InstrumentGroup, InstrumentItem, InstrumentSection, Issue, ItemField, ResponseScale } from "../core";

export type LifecycleState = "draft" | "in_review" | "approved" | "published" | "retired";
export const LIFECYCLE_STATES: LifecycleState[] = ["draft", "in_review", "approved", "published", "retired"];
export const STATE_LABEL: Record<LifecycleState, string> = {
  draft: "Draft", in_review: "In review", approved: "Approved", published: "Published", retired: "Retired",
};

/** The five version tables that share the lifecycle (890 section 5 and 892). */
export type DefinitionKind = "instrument" | "scale" | "rule_template" | "layout_template" | "progression";
export const DEFINITION_KINDS: DefinitionKind[] = ["instrument", "scale", "rule_template", "layout_template", "progression"];
export const VERSION_TABLE: Record<DefinitionKind, string> = {
  instrument: "asmt_instrument_version",
  scale: "asmt_response_scale_version",
  rule_template: "asmt_rule_template_version",
  layout_template: "asmt_layout_template_version",
  progression: "asmt_progression_rule_version",
};
export const KIND_LABEL: Record<DefinitionKind, string> = {
  instrument: "Checklist", scale: "Response scale", rule_template: "Scoring template", layout_template: "Layout template", progression: "Progression rule set",
};
export const kindOfTable = (table: string): DefinitionKind | null =>
  (DEFINITION_KINDS.find((k) => VERSION_TABLE[k] === table) ?? null);

/** The lifecycle columns every version table carries. */
export interface LifecycleRow {
  id: string;
  version_no: number;
  state: LifecycleState;
  content_hash: string | null;
  authored_by: string[];
  edited_by: string[];
  last_edited_by: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  published_by: string | null;
  published_at: string | null;
  retired_by: string | null;
  retired_at: string | null;
  duplicated_from_version_id: string | null;
  created_at: string;
}

export interface InstrumentRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  family_code: string | null;
  description: string | null;
  created_by: string | null;
  created_at: string;
}

export interface InstrumentVersionRow extends LifecycleRow {
  instrument_id: string;
  title: string | null;
  summary: string | null;
  purpose_code: string;
  method_codes: string[];
  requires_domain_review: boolean;
  risk: "standard" | "high";
  scoring: Record<string, unknown>;
  scoring_hash: string | null;
  scoring_template_version_id: string | null;
  scoring_tests: unknown[];
  default_layout_version_id: string | null;
  assess_capability: string | null;
  assign_capability: string | null;
  respondent_roles: string[];
  delivery_modes: string[];
  evidence_policy: Record<string, unknown>;
  effective_from: string | null;
  review_due: string | null;
}

export interface LibraryRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  family_code: string | null;
  family_label: string | null;
  latest_version_id: string | null;
  latest_version_no: number | null;
  latest_state: LifecycleState | null;
  published_version_no: number | null;
  versions: number;
  updated_at: string;
}

/** A reference an item maps to, frozen with its snapshot at the time of mapping. */
export interface ItemMapping {
  kind: string;
  ref_id: string | null;
  ref_code: string | null;
  ref_version: string | null;
  ref_hash: string | null;
  ref_snapshot: Record<string, unknown>;
  relation: "assesses" | "derived_from" | "references";
}

export interface EditorItem extends InstrumentItem {
  mapping: ItemMapping | null;
}

/** What the Content tab edits. A subset of InstrumentDef plus the mapping of each item. */
export interface EditorContent {
  groups: InstrumentGroup[];
  sections: InstrumentSection[];
  items: EditorItem[];
}

export interface LoadedInstrumentVersion {
  instrument: InstrumentRow;
  version: InstrumentVersionRow;
  content: EditorContent;
  def: InstrumentDef;
  /** layouts the version allows (asmt_version_layout) */
  allowedLayoutIds: string[];
  tagTermIds: string[];
}

export interface ScaleLevelRow {
  id?: string;
  code: string; label: string; description: string | null; ordinal: number;
  numeric_value: number | null; satisfactory: boolean | null; colour_token: string | null; source_level_id: string | null;
}
export interface ScaleStateRow { state: string; label: string }

export interface ScaleVersionView extends LifecycleRow {
  scale_id: string;
  scale_code: string;
  scale_name: string;
  scale_kind: "rating" | "stage";
  source_kind: string | null;
  source_ref: string | null;
  description: string | null;
  levels: ScaleLevelRow[];
  states: ScaleStateRow[];
}

export interface TemplateVersionView extends LifecycleRow {
  definition_id: string;
  code: string;
  name: string;
  description: string | null;
  presentation?: string;
  rules?: Record<string, unknown>;
  tests?: unknown[];
  layout?: Record<string, unknown>;
}

export interface ProgressionVersionView extends LifecycleRow {
  rule_set_id: string;
  code: string;
  name: string;
  target_kind: string;
  stage_scale_version_id: string;
  description: string | null;
  rules: Record<string, unknown>;
  tests: unknown[];
}

export interface DefinitionEventRow {
  id: string;
  subject_table: string;
  subject_id: string;
  event: string;
  actor_id: string | null;
  reason: string | null;
  content_hash: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface ReviewDecisionRow {
  id: string;
  version_table: string;
  version_id: string;
  review_kind: "governance" | "domain";
  reviewer_id: string;
  decision: "approved" | "rejected" | "changes_requested";
  content_hash: string;
  rationale: string | null;
  created_at: string;
}

export interface TimelineEntry {
  at: string;
  kind: "event" | "decision";
  label: string;
  actorId: string | null;
  detail?: string | null;
  versionNo?: number | null;
  versionId?: string | null;
}

export type StudioIssue = Issue & { source?: string };

export interface ValidationReport {
  ok: boolean;
  errors: StudioIssue[];
  warnings: StudioIssue[];
  tests: { passed: number; failed: number } | null;
  checkedAt: string;
}

export type { InstrumentDef, InstrumentGroup, InstrumentItem, InstrumentSection, ItemField, ResponseScale };
