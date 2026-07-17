// ============================================================
// CKCM shared vocabulary (Book I)
// Labels & option lists for the Practice → CPU structural spine,
// assessment blueprints, evidence matrices, and competency decisions.
// ============================================================

export type RiskCategory = "low" | "standard" | "high" | "critical";

export const RISK_CONFIG: Record<RiskCategory, { label: string; cls: string }> = {
  low:      { label: "Low",      cls: "bg-gray-100 text-gray-600" },
  standard: { label: "Standard", cls: "bg-blue-100 text-blue-700" },
  high:     { label: "High",     cls: "bg-amber-100 text-amber-700" },
  critical: { label: "Critical", cls: "bg-red-100 text-red-700" },
};

// Assessment methods (Book I Ch.8) — superset of the legacy 7
export type AssessmentMethod =
  | "self" | "knowledge" | "skills_checklist" | "direct_observation" | "simulation"
  | "osce" | "concurrent_audit" | "retrospective_audit" | "portfolio"
  | "peer" | "supervisor" | "interview";

export const METHOD_LABELS: Record<AssessmentMethod, string> = {
  self:                "Self-Assessment",
  knowledge:           "Knowledge Assessment",
  skills_checklist:    "Skills Checklist",
  direct_observation:  "Direct Observation",
  simulation:          "Simulation",
  osce:                "OSCE",
  concurrent_audit:    "Concurrent Audit",
  retrospective_audit: "Retrospective Audit",
  portfolio:           "Portfolio",
  peer:                "Peer Assessment",
  supervisor:          "Supervisor Assessment",
  interview:           "Structured Interview",
};

// Evidence hierarchy (Book I Ch.9) — strength descends down the list
export const EVIDENCE_TYPES: { key: string; label: string; strength: string }[] = [
  { key: "direct_observation",  label: "Direct Observation of Practice", strength: "Very High" },
  { key: "simulation",          label: "Clinical Simulation",            strength: "High" },
  { key: "skills_checklist",    label: "Skills Checklist",               strength: "High" },
  { key: "concurrent_audit",    label: "Concurrent Audit",               strength: "High" },
  { key: "retrospective_audit", label: "Retrospective Chart Audit",      strength: "Moderate" },
  { key: "knowledge",           label: "Knowledge Assessment",           strength: "Moderate" },
  { key: "interview",           label: "Structured Interview",           strength: "Moderate" },
  { key: "reflection",          label: "Reflective Practice",            strength: "Supportive" },
  { key: "self",                label: "Self-Assessment",                strength: "Informative" },
];

// Consensus rules (Book I Ch.10)
export type ConsensusRule = "any" | "majority" | "unanimous" | "weighted" | "lead";
export const CONSENSUS_LABELS: Record<ConsensusRule, string> = {
  any:       "Any (first assessor)",
  majority:  "Simple Majority",
  unanimous: "Unanimous",
  weighted:  "Weighted Consensus",
  lead:      "Designated Lead Assessor",
};

// Competency decision outcomes (Book I Ch.10)
export type DecisionOutcome =
  | "competent" | "competent_with_conditions" | "provisionally_competent"
  | "requires_remediation" | "not_yet_competent" | "suspended" | "expired";

export const OUTCOME_CONFIG: Record<DecisionOutcome, { label: string; cls: string; passing: boolean }> = {
  competent:                 { label: "Competent",                 cls: "bg-green-100 text-green-700",  passing: true },
  competent_with_conditions: { label: "Competent w/ Conditions",   cls: "bg-teal-100 text-teal-700",    passing: true },
  provisionally_competent:   { label: "Provisionally Competent",   cls: "bg-blue-100 text-blue-700",    passing: true },
  requires_remediation:      { label: "Requires Remediation",      cls: "bg-amber-100 text-amber-700",  passing: false },
  not_yet_competent:         { label: "Not Yet Competent",         cls: "bg-gray-100 text-gray-600",    passing: false },
  suspended:                 { label: "Suspended",                 cls: "bg-red-100 text-red-700",      passing: false },
  expired:                   { label: "Expired",                   cls: "bg-orange-100 text-orange-600", passing: false },
};

// Competency maturity (Benner progression, Book I Ch.5/10)
export type Maturity = "novice" | "advanced_beginner" | "competent" | "proficient" | "expert" | "mentor" | "authority";
export const MATURITY_LABELS: Record<Maturity, string> = {
  novice:            "Novice",
  advanced_beginner: "Advanced Beginner",
  competent:         "Competent",
  proficient:        "Proficient",
  expert:            "Expert",
  mentor:            "Clinical Mentor",
  authority:         "Clinical Authority",
};

// Skill complexity levels (Book I Ch.7)
export const COMPLEXITY_LABELS: Record<number, string> = {
  1: "Foundational",
  2: "Routine Clinical",
  3: "Advanced Clinical",
  4: "Specialty",
  5: "Highly Specialized",
};

// Clinical Authorization types (Book II Ch.24)
export type AuthorizationType =
  | "clinical_privilege" | "scope_of_practice" | "supervised_practice" | "restricted_practice"
  | "temporary" | "emergency" | "equipment" | "independent" | "procedural";

export const AUTH_TYPE_LABELS: Record<AuthorizationType, string> = {
  clinical_privilege:  "Clinical Privilege",
  scope_of_practice:   "Scope of Practice",
  supervised_practice: "Supervised Practice",
  restricted_practice: "Restricted Practice",
  temporary:           "Temporary Authorization",
  emergency:           "Emergency Authorization",
  equipment:           "Equipment Authorization",
  independent:         "Independent Practice",
  procedural:          "Procedural Authorization",
};

export type AuthStatus = "pending" | "active" | "suspended" | "revoked" | "expired";
export const AUTH_STATUS_CONFIG: Record<AuthStatus, { label: string; cls: string }> = {
  pending:   { label: "Pending",   cls: "bg-gray-100 text-gray-600" },
  active:    { label: "Active",    cls: "bg-green-100 text-green-700" },
  suspended: { label: "Suspended", cls: "bg-amber-100 text-amber-700" },
  revoked:   { label: "Revoked",   cls: "bg-red-100 text-red-700" },
  expired:   { label: "Expired",   cls: "bg-orange-100 text-orange-600" },
};

// Assessment programme types (Book II Ch.10/11)
export const PROGRAMME_TYPE_LABELS: Record<string, string> = {
  recruitment:        "Recruitment",
  orientation:        "Orientation",
  probation:          "Probation",
  annual:             "Annual Review",
  specialty:          "Specialty Certification",
  remediation:        "Remediation",
  return_to_practice: "Return to Practice",
  leadership:         "Leadership",
};

export const SCHEDULING_LABELS: Record<string, string> = {
  fixed:                "Fixed Schedule",
  rolling:              "Rolling Schedule",
  competency_triggered: "Competency-Triggered",
  event_triggered:      "Event-Triggered",
};

// Professional Credential types (Book II Ch.25)
export const CREDENTIAL_TYPE_LABELS: Record<string, string> = {
  professional_license:    "Professional License",
  academic_qualification:  "Academic Qualification",
  board_certification:     "Board Certification",
  specialty_certification: "Specialty Certification",
  internal_certification:  "Internal Certification",
  external_certification:  "External Certification",
  cpd_certificate:         "CPD Certificate",
  instructor_certification:"Instructor Certification",
  mandatory_training:      "Mandatory Training",
};

export const CREDENTIAL_STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  active:               { label: "Active",   cls: "bg-green-100 text-green-700" },
  expired:              { label: "Expired",  cls: "bg-orange-100 text-orange-600" },
  suspended:            { label: "Suspended",cls: "bg-amber-100 text-amber-700" },
  revoked:              { label: "Revoked",  cls: "bg-red-100 text-red-700" },
  pending_verification: { label: "Unverified", cls: "bg-gray-100 text-gray-600" },
};

// Professional Recognition types (Book II Ch.26)
export const RECOGNITION_TYPE_LABELS: Record<string, { label: string; icon: string }> = {
  excellence_award:        { label: "Excellence Award",        icon: "🏆" },
  preceptor:               { label: "Preceptor",               icon: "🧭" },
  mentor:                  { label: "Mentor",                  icon: "🌟" },
  employee_of_month:       { label: "Employee of the Month",   icon: "🥇" },
  innovation:              { label: "Innovation Award",        icon: "💡" },
  patient_safety_champion: { label: "Patient Safety Champion", icon: "🛡️" },
  long_service:            { label: "Long Service",            icon: "🎗️" },
  custom:                  { label: "Recognition",             icon: "🎖️" },
};

// Curriculum programme types (Book II Ch.18)
export const CURRICULUM_TYPE_LABELS: Record<string, string> = {
  orientation:   "Orientation",
  specialty:     "Specialty",
  cpd:           "CPD",
  remediation:   "Remediation",
  leadership:    "Leadership",
  certification: "Certification",
};

// ============================================================
// EQOS — Enterprise Quality Operating System (Ch.41-45)
// ============================================================

export const QUALITY_STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  draft:        { label: "Draft",        cls: "bg-gray-100 text-gray-600" },
  active:       { label: "Active",       cls: "bg-green-100 text-green-700" },
  under_review: { label: "Under Review", cls: "bg-amber-100 text-amber-700" },
  retired:      { label: "Retired",      cls: "bg-gray-100 text-gray-400" },
};

export const FRAMEWORK_TYPE_LABELS: Record<string, string> = {
  accreditation: "Accreditation",
  regulatory:    "Regulatory",
  professional:  "Professional",
  internal:      "Internal",
};

// Improvement methodologies (EQOS Ch.43)
export const METHODOLOGY_LABELS: Record<string, string> = {
  pdsa:                   "PDSA",
  clinical_audit:         "Clinical Audit",
  rca:                    "Root Cause Analysis",
  fmea:                   "FMEA",
  lean:                   "Lean",
  six_sigma:              "Six Sigma",
  kaizen:                 "Kaizen",
  human_factors:          "Human Factors",
  implementation_science: "Implementation Science",
};

export const IMPROVEMENT_STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  proposed:  { label: "Proposed",  cls: "bg-gray-100 text-gray-600" },
  planning:  { label: "Planning",  cls: "bg-blue-100 text-blue-700" },
  active:    { label: "Active",    cls: "bg-teal-100 text-teal-700" },
  measuring: { label: "Measuring", cls: "bg-violet-100 text-violet-700" },
  sustained: { label: "Sustained", cls: "bg-green-100 text-green-700" },
  closed:    { label: "Closed",    cls: "bg-gray-100 text-gray-500" },
  abandoned: { label: "Abandoned", cls: "bg-red-50 text-red-500" },
};

export const INDICATOR_UNIT_LABELS: Record<string, string> = {
  percent:       "%",
  count:         "count",
  rate_per_1000: "per 1,000",
  days:          "days",
  minutes:       "min",
  score:         "score",
};

// Is the latest measurement meeting the indicator's target?
export function indicatorStatus(
  value: number | null,
  target: number | null,
  escalation: number | null,
  direction: string
): "on_target" | "warning" | "breach" | "no_data" {
  if (value == null) return "no_data";
  const better = (a: number, b: number) => direction === "lower_is_better" ? a <= b : a >= b;
  if (target != null && better(value, target)) return "on_target";
  if (escalation != null && !better(value, escalation)) return "breach";
  return target != null ? "warning" : "no_data";
}

export const INDICATOR_STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  on_target: { label: "On target",   cls: "bg-green-100 text-green-700" },
  warning:   { label: "Off target",  cls: "bg-amber-100 text-amber-700" },
  breach:    { label: "Escalation",  cls: "bg-red-100 text-red-700" },
  no_data:   { label: "No data",     cls: "bg-gray-100 text-gray-500" },
};

export const QO_LINK_TYPE_LABELS: Record<string, string> = {
  requires: "Requires",
  supports: "Supports",
  measures: "Measures",
};

// ============================================================
// COMPETEN Studio — modular content authoring
// ============================================================

export const SKILL_TYPE_LABELS: Record<string, { label: string; icon: string }> = {
  psychomotor:     { label: "Psychomotor",     icon: "✋" },
  cognitive:       { label: "Cognitive",       icon: "🧠" },
  communication:   { label: "Communication",   icon: "💬" },
  decision_making: { label: "Decision-making", icon: "⚖️" },
  leadership:      { label: "Leadership",      icon: "⭐" },
  documentation:   { label: "Documentation",   icon: "📝" },
  safety_critical: { label: "Safety-critical", icon: "🛡️" },
};

export const SCORING_METHOD_LABELS: Record<string, string> = {
  done_not_done: "Done / Not done",
  competent_nyc: "Competent / Not yet competent",
  scale_0_2:     "0–2 scale",
  scale_0_4:     "0–4 scale",
  entrustment:   "Entrustment scale",
  narrative:     "Narrative only",
};

// Assessor operating layer ("The Assessor Role" spec)
export const ENTRUSTMENT_LABELS: Record<string, string> = {
  not_permitted:        "Not permitted to perform",
  direct_supervision:   "May perform under direct supervision",
  indirect_supervision: "May perform under indirect supervision",
  independent:          "May perform independently",
  may_supervise:        "May supervise or teach others",
};

export const TASK_TYPE_UI: Record<string, { label: string; icon: string; cls: string }> = {
  full_cpu:    { label: "Full CPU assessment", icon: "🏥", cls: "bg-blue-50 text-blue-700" },
  focused:     { label: "Focused assessment",  icon: "🎯", cls: "bg-violet-50 text-violet-700" },
  renewal:     { label: "Renewal",             icon: "🔄", cls: "bg-amber-50 text-amber-700" },
  remediation: { label: "Remediation",         icon: "🌱", cls: "bg-red-50 text-red-600" },
  entrustment: { label: "Entrustment decision",icon: "🔑", cls: "bg-teal-50 text-teal-700" },
};

// Clinical Knowledge Objects (migration 025)
export const KNOWLEDGE_TYPE_UI: Record<string, { label: string; icon: string }> = {
  anatomy:            { label: "Anatomy",            icon: "🫀" },
  physiology:         { label: "Physiology",         icon: "⚡" },
  pathophysiology:    { label: "Pathophysiology",    icon: "🔬" },
  pharmacology:       { label: "Pharmacology",       icon: "💊" },
  classification:     { label: "Classification",     icon: "🗂️" },
  assessment_tool:    { label: "Assessment Tool",    icon: "📏" },
  clinical_reasoning: { label: "Clinical Reasoning", icon: "🧠" },
  procedure:          { label: "Procedure",          icon: "🩺" },
  evidence:           { label: "Evidence",           icon: "📑" },
  other:              { label: "Other",              icon: "📄" },
};
