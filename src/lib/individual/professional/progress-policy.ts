import type { ContextOption, PolicyDef } from "../policy";

// ── MY PROFESSIONAL PROGRESS AND DOCUMENT STUDIO: NO-CODE GOVERNANCE ── COMPETEN-PROFESSIONAL-PROGRESS-01 s12 ──────────────
//
// The Stage 8 policies, held in the EXISTING Individual policy store (WCE): versioned on publish, audited, clamped on read.
// Document types and templates are their own governed document (src/lib/individual/documents-config.ts). Nothing names a
// profession, a country, a career ladder or a document style.
//
// ⚠ WHAT NO SETTING CAN WIDEN: nothing is shared or sent, documents go only to the person, no score is ever computed, a
// recommendation never creates a goal, modifies evidence, starts a purchase or requests verification, and missing
// evidence never reads as incompetence.

export const PROGRESS_VIEWS = [
  ["overview", "Overview"], ["time", "Development over time"], ["competencies", "Competency progress"], ["learning", "Learning & CPD"],
  ["career", "Career & professional journey"], ["evaluation", "My Professional Evaluation"], ["documents", "Document Studio"],
] as const;
export type ProgressView = (typeof PROGRESS_VIEWS)[number][0];
export const PERIODS = [["week", "Weeks"], ["month", "Months"], ["quarter", "Quarters"], ["year", "Years"], ["phase", "Professional phases"]] as const;
export type PeriodKind = (typeof PERIODS)[number][0];
export const PROGRESS_RULES = [
  ["first_steps", "Useful first steps for a new professional"],
  ["review_goal_after_learning", "Review a goal after related learning"],
  ["reflect_on_training", "Reflect on completed training"],
  ["organise_evidence", "Organise supporting evidence"],
  ["consider_practical_assessment", "Consider practical assessment where application evidence is limited"],
  ["credential_expiry", "Review an approaching credential expiry"],
  ["explore_aspiration_learning", "Explore learning related to a career aspiration"],
  ["review_stale_goal", "Review a goal not reviewed for a while"],
] as const;
export type ProgressRule = (typeof PROGRESS_RULES)[number][0];

const opt = (labels: string[]): ContextOption[] => labels.map(label => ({ code: label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), label }));
export const DEFAULT_MILESTONE_CATEGORIES = opt(["Registration", "Qualification", "New role", "Specialty", "Leadership", "Teaching", "Research", "Quality improvement", "Course completed", "Independent decision"]);
export const DEFAULT_CAREER_CATEGORIES = opt(["Education and graduation", "Registration", "Employment and practice", "Specialty development", "Qualifications", "Leadership and teaching", "Research and quality improvement", "Career transitions", "Future aspirations"]);

export const PROFESSIONAL_PROGRESS_POLICIES: readonly PolicyDef[] = [
  {
    key: "professional_progress_views", kind: "sequence", product: "Professional",
    label: "Progress views, in order",
    help: "Which views My Professional Progress offers, and in what order. Overview is always offered.",
    options: PROGRESS_VIEWS.map(([value, label]) => ({ value, label })), fallback: PROGRESS_VIEWS.map(([v]) => v), fixed: ["overview"],
    limitReason: "Only these views. Overview is always first-class.",
  },
  {
    key: "professional_progress_periods", kind: "set", product: "Professional",
    label: "Reporting periods",
    help: "The periods a person may view their development by. Changing the period never changes a record or its dates.",
    options: PERIODS.map(([value, label]) => ({ value, label })), fallback: PERIODS.map(([v]) => v),
    limitReason: "Only these periods. Years is always offered.",
  },
  {
    key: "professional_progress_default_period", kind: "choice", product: "Professional",
    label: "Default reporting period",
    help: "The period Development over time opens with. The person can change it, and save it as their own default.",
    options: PERIODS.map(([value, label]) => ({ value, label })), fallback: "year",
    limitReason: "One of the reporting periods.",
  },
  {
    key: "professional_progress_recommendation_rules", kind: "set", product: "Professional",
    label: "Progress recommendation rules",
    help: "Which deterministic next steps My Professional Progress may suggest. Each names the finding behind it and opens the module that owns the work. Nothing is created for the person.",
    options: PROGRESS_RULES.map(([value, label]) => ({ value, label })), fallback: PROGRESS_RULES.map(([v]) => v),
    limitReason: "Only these rules. None creates a goal, changes evidence, starts a purchase or requests verification.",
  },
  {
    key: "professional_progress_recent_days", kind: "int", product: "Professional", unit: "days",
    label: "Recent achievements and milestones",
    help: "How far back the Overview looks for recent achievements and milestones, and how soon before an expiry it says so.",
    fallback: 180, min: 30, max: 730, limitReason: "From a month to two years.",
  },
  {
    key: "professional_milestone_categories", kind: "options", product: "Professional", max: 30, noun: "milestone category",
    label: "Professional milestone categories",
    help: "The words milestones are grouped under on the Overview and the timeline. They group records, never rank them.",
    fallback: DEFAULT_MILESTONE_CATEGORIES, emptyMeans: "Not grouped", limitReason: "At most 30, each up to 160 characters.",
  },
  {
    key: "professional_career_categories", kind: "options", product: "Professional", max: 30, noun: "career category",
    label: "Career journey categories",
    help: "The headings of the Career & professional journey. No ladder: the person defines their own direction.",
    fallback: DEFAULT_CAREER_CATEGORIES, emptyMeans: "Not grouped", limitReason: "At most 30, each up to 160 characters.",
  },
  {
    key: "professional_documents_ai", kind: "choice", product: "Professional",
    label: "AI help in the Document Studio",
    help: "Whether a person may ask the personal AI to draft a summary from the records they chose. AI fair use and model eligibility apply. Nothing is used unless the person accepts it, and the Studio works fully without AI.",
    options: [{ value: "on", label: "On, when the person asks" }, { value: "off", label: "Off" }], fallback: "on",
    limitReason: "Two choices.",
  },
];
