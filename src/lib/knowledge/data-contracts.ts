// ── CKRI DATA CONTRACTS ── COMPETEN-KNOWLEDGE-RESEARCH-01 s3 (K1) and s4 (K2) ────────────────────────────────
//
// WHICH structured Scholar evidence collective learning intelligence may read, field by field, and WHICH aggregate
// measures it may compute from them. A closed catalogue, reviewed as code: the no-code policy (governance.ts) can
// only switch measures and cohort dimensions OFF or narrow them, never add a field.
//
// ⚠ WHAT IS NEVER ELIGIBLE, AND IS THEREFORE NOT IN THIS FILE AT ALL. Student uploads and their text, AI
// conversations, explanations, generated questions and cases, free-text answers and reasoning, AI feedback, debriefs,
// titles and topics a student typed, labels a student typed for their institution or level, and any clinical
// narrative. FORBIDDEN_COLUMNS names them so the harness can prove the aggregate builder (migration 441) never reads
// one. A person identifier is used inside the database to count DISTINCT participants and to apply their choice, and
// never leaves it: no CKRI table has a person column except the participation record itself (440).
//
// ⚠ AGGREGATE IS NOT ANONYMOUS BY DECLARATION. Small cells are suppressed and counts rounded (441), but de-identified
// aggregates can still be combined with other knowledge. The disclosure controls reduce that risk. They do not
// remove it, and nothing in CKRI claims they do.

export type Stage = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type FieldClass = "cohort_attribute" | "structured_code" | "measure" | "coarse_time";
export type FieldStatus = "available" | "pending_source";

export type EligibleField = { code: string; stage: Stage; source: string; column: string; class: FieldClass; status: FieldStatus; note: string };

/** The closed catalogue of fields CKRI may aggregate. Codes are stable: a snapshot names the contract version it used. */
export const ELIGIBLE_FIELDS: readonly EligibleField[] = [
  { code: "join.programme", stage: 1, source: "individual_scholar_learner_context", column: "programme_code", class: "cohort_attribute", status: "available", note: "The programme code in force when the evidence was recorded (402 history)." },
  { code: "join.level", stage: 1, source: "individual_scholar_learner_context", column: "level_code", class: "cohort_attribute", status: "available", note: "Configured level code only. The typed level label is never read." },
  { code: "join.institution", stage: 1, source: "individual_scholar_learner_context", column: "institution_code", class: "cohort_attribute", status: "available", note: "Configured institution code only. Off by default: institution cohorts are the smallest." },
  { code: "classify.competency", stage: 3, source: "individual_scholar_competency_map", column: "competency_id", class: "structured_code", status: "available", note: "A CFCA competency a mapping names, counted only when its latest decision is accepted (388)." },
  { code: "classify.decision", stage: 3, source: "individual_scholar_competency_decision", column: "decision", class: "structured_code", status: "available", note: "accepted or rejected. The reason text is never read." },
  { code: "learn.competency", stage: 4, source: "individual_scholar_learning_session", column: "competency_id", class: "structured_code", status: "available", note: "The competency a learning session was opened on. Title and topic are never read." },
  { code: "learn.started", stage: 4, source: "individual_scholar_learning_session", column: "created_at", class: "coarse_time", status: "available", note: "Coarsened to the reporting period." },
  { code: "revise.correct", stage: 5, source: "individual_scholar_attempt", column: "correct", class: "measure", status: "available", note: "Deterministic marking of a formative, AI-generated question. Not a validated instrument." },
  { code: "revise.answered", stage: 5, source: "individual_scholar_attempt", column: "answered_at", class: "coarse_time", status: "available", note: "Coarsened to the reporting period, and the gap between attempts in whole days." },
  { code: "revise.competency", stage: 5, source: "individual_scholar_competency_map", column: "competency_id", class: "structured_code", status: "available", note: "The competency of the question's source section, through an accepted mapping." },
  { code: "apply.correct", stage: 6, source: "individual_scholar_case_answer", column: "correct", class: "measure", status: "available", note: "A decision point's marking. AI-marked points are counted apart from deterministic ones." },
  { code: "apply.marking", stage: 6, source: "individual_scholar_case_answer", column: "marking", class: "structured_code", status: "available", note: "deterministic or ai. Reasoning text and AI feedback are never read." },
  { code: "apply.safety_flags", stage: 6, source: "individual_scholar_case_answer", column: "safety_criterion_ids", class: "measure", status: "available", note: "Counted as whether any safety criterion was raised, never which text." },
  { code: "apply.competency", stage: 6, source: "individual_scholar_case_competency", column: "competency_id", class: "structured_code", status: "available", note: "The competencies a private case teaches." },
  { code: "apply.library_case", stage: 6, source: "individual_scholar_case_session", column: "library_version_id", class: "structured_code", status: "available", note: "A governed library case a session used (resource demand)." },
  { code: "evaluate.result", stage: 7, source: "individual_scholar_evaluation", column: "results", class: "measure", status: "pending_source", note: "Migration 426 is on staging only. Bound when 426 is merged and its results shape is frozen." },
  { code: "progress.trend", stage: 8, source: "(none)", column: "(none)", class: "measure", status: "pending_source", note: "Stage 8 Progress is not started." },
] as const;

/** Columns the aggregate builder must never read. The harness scans 441 for each. */
export const FORBIDDEN_COLUMNS = [
  "stem", "options", "rationale", "source_quote", "reasoning", "ai_feedback", "blueprint", "debrief", "response", "held_response",
  "chosen_option_ids", "title", "topic", "concepts", "content", "text", "institution_label", "level_label", "reason", "filename",
  "storage_path", "extracted_text", "evidence_refs", "criteria", "limitations", "context",
] as const;

export type MeasureCode = "outcome_coverage" | "knowledge_gap" | "retention" | "reasoning_difficulty" | "evaluation_performance" | "resource_demand";
export type Measure = { code: MeasureCode; label: string; stage: Stage; fields: string[]; status: FieldStatus; unit: string; limits: string };

/**
 * The aggregate measures (K2). Each states its unit and the limits a reader must keep in view (s8): every Scholar
 * measure is FORMATIVE, from a self-selected, consenting population, and none is a validated assessment instrument or
 * evidence about patient outcomes.
 */
export const MEASURES: readonly Measure[] = [
  { code: "outcome_coverage", label: "Learning-outcome coverage", stage: 3, fields: ["classify.competency", "classify.decision"], status: "available",
    unit: "participants whose material maps (accepted) to the competency",
    limits: "Coverage of uploaded study material, not of the curriculum taught. AI-proposed mappings count only once accepted." },
  { code: "knowledge_gap", label: "Common knowledge gaps", stage: 5, fields: ["revise.correct", "revise.competency", "revise.answered"], status: "available",
    unit: "share of formative revision answers correct, per competency",
    limits: "Questions are AI-generated from each student's own material, so difficulty is not standardised across students." },
  { code: "retention", label: "Revision and retention", stage: 5, fields: ["revise.correct", "revise.answered", "revise.competency"], status: "available",
    unit: "share of later answers (7 or more days after a correct one) still correct",
    limits: "Self-paced revision. Students who return are a self-selected subset." },
  { code: "reasoning_difficulty", label: "Clinical reasoning difficulties", stage: 6, fields: ["apply.correct", "apply.marking", "apply.safety_flags", "apply.competency"], status: "available",
    unit: "share of case decision points marked correct, and share raising a safety criterion",
    limits: "Simulated, formative cases. AI-marked points are reported apart and are not validated measurements." },
  { code: "evaluation_performance", label: "Evaluation performance", stage: 7, fields: ["evaluate.result"], status: "pending_source",
    unit: "pending", limits: "Not computed until migration 426 is merged and its result shape is frozen." },
  { code: "resource_demand", label: "Educational-resource demand", stage: 4, fields: ["learn.competency", "learn.started", "apply.library_case"], status: "available",
    unit: "learning sessions opened and library cases used, per competency",
    limits: "Demand from Scholar users, not from all students of a programme." },
] as const;

export const COHORT_DIMENSIONS = ["programme", "level", "institution"] as const;
export type CohortDimension = (typeof COHORT_DIMENSIONS)[number];

/** The contract version a snapshot records. Bump it whenever a field or measure definition changes. */
export const DATA_CONTRACT_VERSION = "ckri-contract/1";

export const fieldByCode = (code: string) => ELIGIBLE_FIELDS.find(f => f.code === code) ?? null;
export const measureByCode = (code: string) => MEASURES.find(m => m.code === code) ?? null;
