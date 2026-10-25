// ── MY PROFESSIONAL EVALUATION: THE WORDS ── COMPETEN-PROFESSIONAL-EVALUATION-01, Professional Stage 6 ─────────────────
//
// The six dimensions are SEPARATE (owner GO s5): there is no seventh "overall" and no score. Every source keeps its own
// provenance, in four words a person can tell apart (plus "recorded by Competen Learning" for a course completion, which
// is a recorded fact, not an assessment). Nothing here names a profession, a country or a catalogue.

export const DIMENSIONS = [
  ["development_activity", "Development activity"],
  ["knowledge", "Knowledge and understanding"],
  ["application", "Application of learning"],
  ["competency_evidence", "Competency evidence"],
  ["independent_verification", "Independent verification"],
  ["evidence_confidence", "Evidence confidence"],
] as const;
export type Dimension = (typeof DIMENSIONS)[number][0];
export const DIMENSION_LABEL: Record<Dimension, string> = Object.fromEntries(DIMENSIONS) as Record<Dimension, string>;

export const SCOPES = [
  ["development", "My development as a whole"],
  ["goal", "A development goal"],
  ["competency", "A competency"],
  ["outcome", "A learning outcome of a competency"],
  ["topic", "A topic"],
  ["cpd", "A CPD activity"],
  ["learning", "A Competen Learning course"],
  ["area", "A development need (a broader area)"],
] as const;
export type ScopeKind = (typeof SCOPES)[number][0];
export const SCOPE_LABEL: Record<ScopeKind, string> = Object.fromEntries(SCOPES) as Record<ScopeKind, string>;
export const isScopeKind = (v: unknown): v is ScopeKind => typeof v === "string" && SCOPES.some(([s]) => s === v);

/** Owner GO s5: never conflate these. */
export const PROVENANCE = ["self_reported", "document_supported", "platform_recorded", "formative", "independent_decision", "independent_other"] as const;
export type Provenance = (typeof PROVENANCE)[number];
export const PROVENANCE_LABEL: Record<Provenance, string> = {
  self_reported: "Self-reported",
  document_supported: "Document-supported",
  platform_recorded: "Recorded by Competen Learning (a completion, not an assessment)",
  formative: "Formative assessment result",
  independent_decision: "Independently verified",
  independent_other: "Independent decision, not a current verification",
};

export const SOURCE_KINDS = [
  ["cpd", "CPD entry"], ["learning_record", "Competen Learning record"], ["evidence", "Evidence item"], ["reflection", "Private reflection"],
  ["learning_reflection", "Reflection on learning"], ["activity", "Plan activity"], ["goal_review", "Goal review"], ["milestone", "Milestone"],
  ["self_assessment", "Self-assessment"], ["competency_link", "Competency evidence link"], ["competency_mapping", "Competency link on a record"],
  ["verification", "Verification decision (C5)"], ["passport_assessment", "Organisation assessment (Passport)"],
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number][0];
export const SOURCE_KIND_LABEL: Record<SourceKind, string> = Object.fromEntries(SOURCE_KINDS) as Record<SourceKind, string>;

/** Confidence in the EVIDENCE, in words. Never a measure of the person, and never combined with anything. */
export const CONFIDENCE = [["limited", "Limited"], ["moderate", "Moderate"], ["stronger", "Stronger"]] as const;
export type ConfidenceLevel = (typeof CONFIDENCE)[number][0];
export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = Object.fromEntries(CONFIDENCE) as Record<ConfidenceLevel, string>;

/** What may raise evidence confidence (configurable). Self-report alone never does. */
export const CONFIDENCE_FACTORS = [
  ["document_supported", "Document-supported records"],
  ["formative", "Formative assessment results"],
  ["independent", "Independent verification"],
  ["recency", "Recent evidence (within the recency policy)"],
  ["sufficiency", "Enough separate records (the sufficiency policy)"],
] as const;
export type ConfidenceFactor = (typeof CONFIDENCE_FACTORS)[number][0];

/** Deterministic recommendation rules (configurable). Each explains its basis and goes to its owning module. */
export const RECOMMENDATION_RULES = [
  ["record_cpd", "Record or link development activity"],
  ["plan_activity", "Plan an activity under the goal"],
  ["find_learning", "Find relevant Competen Learning"],
  ["formative_assessment", "Take a formative assessment"],
  ["reflect_application", "Reflect on applying learning"],
  ["self_assess", "Self-assess the competency"],
  ["link_evidence", "Link evidence to the competency"],
  ["request_verification", "Consider independent verification"],
  ["refresh_evidence", "Add more recent evidence"],
  ["create_goal", "Set a development goal"],
  ["create_need", "Record a development need"],
  ["review_goal", "Review the goal"],
] as const;
export type RecommendationRule = (typeof RECOMMENDATION_RULES)[number][0];

export const DECISIONS = [["accepted", "Accepted"], ["deferred", "Deferred"], ["dismissed", "Dismissed"]] as const;
export type Decision = (typeof DECISIONS)[number][0];
export const isDecision = (v: unknown): v is Decision => typeof v === "string" && DECISIONS.some(([d]) => d === v);

export const DEFAULT_EVALUATION_TEMPLATES = [
  { code: "looking-back", label: "Looking back: What stands out to me? | What surprised me? | What will I do next?" },
  { code: "evidence-check", label: "Evidence check: Which evidence do I trust most? | What is missing? | Who could give me feedback?" },
];

/** Shown with every evaluation, on screen, in a snapshot and on a Passport link. */
export const FORMATIVE_NOTICE = "A formative evaluation of your own development records. It is not an assessment or verification of clinical competence, and it is not a score.";
export const MISSING_NOTICE = "Missing evidence is not evidence of a gap in competence. It only means nothing is recorded here yet.";
export const OUTCOMES_NOTICE = "CPD and educational results show development. They do not by themselves show improved patient outcomes.";
