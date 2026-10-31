/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PlanAiLimit } from "./commerce";
import { REMINDER_HORIZON_DAYS } from "./professional/vocabulary";
import { SHARE_DAYS_MAX } from "./professional/share";
import {
  DEFAULT_UPLOAD_MB, FORMAT_LABEL, INSIGHT_MIN_ANSWERS, INSIGHT_WINDOW_DAYS, LEARN_ACTIONS, LEARN_ACTION_LABEL, MAX_MATERIALS_PER_PERSON, MAX_PDF_PAGES, MAX_PPTX_SLIDES,
  MAX_SESSION_FILES, MAX_SESSION_MB, MAX_UPLOAD_BYTES, QUESTIONS_PER_REQUEST, REVISION_FORMATS, REVISION_FORMAT_LABEL, REVISION_MODES, REVISION_MODE_LABEL, REVISION_QUANTITY_MAX, ADAPTIVE_FORMATS, ADAPTIVE_LENGTH_MAX, ADAPTIVE_LENGTH_MIN,
  SESSION_MAX_STEPS, TUTOR_MAX_TURNS, UPLOAD_SESSION_MINUTES, CASE_CONTEXTS, CASE_CONTEXT_LABEL, CASE_ENTRIES, CASE_ENTRY_LABEL, CASE_DIMENSION_LABEL,
  type CaseContext, type CaseEntry,
  type AdaptiveFormat, type ExplanationDepth, type LearnAction, type RevisionDifficulty, type RevisionFormat, type RevisionMode, type UploadFormat,
} from "./scholar/config";
import { STUDY_ACHIEVEMENT, STUDY_ACHIEVEMENT_KINDS, type StudyAchievementKind } from "./scholar/passport-items";
import { COUNTRIES } from "../countries";
import { PROFESSIONAL_EVALUATION_POLICIES } from "./professional/evaluation-policy";
import { PROFESSIONAL_PROGRESS_POLICIES, type PeriodKind, type ProgressRule, type ProgressView } from "./professional/progress-policy";
import type { ConfidenceFactor, RecommendationRule, ScopeKind } from "./professional/evaluation-vocabulary";
import {
  DEFAULT_PRACTICE_SETTINGS, DEFAULT_QUALIFICATION_TYPES, DEFAULT_STATUSES, DOCUMENT_KINDS, FIELD_LABEL, ITEM_LABEL, OPTIONAL_FIELDS, PROFILE_SECTIONS, SECTION_LABEL,
  REGISTRATION_STANDING, REMINDER_KINDS, REMINDER_OFFSETS, SHAREABLE_SECTIONS, VERIFIABLE_KINDS,
  type ItemKind, type OptionalField, type ProfileSection, type ReminderKind,
} from "./professional/profile-vocabulary";
import {
  DEFAULT_NEED_CATEGORIES, DEFAULT_NEED_MOTIVATIONS, DEFAULT_NEED_PRIORITIES, DEFAULT_REFLECTION_TEMPLATES, NEED_FIELDS, NEED_FIELD_LABEL,
  NEED_SOURCE_LABEL, NEED_STAGES, NEED_STAGE_LABEL, PICKABLE_SOURCES, type NeedField, type NeedSource, type NeedStage,
} from "./professional/needs-vocabulary";
import {
  ACTIVITY_STATUSES, ACTIVITY_STATUS_TEXT, DEFAULT_ACTIVITY_TYPES, DEFAULT_EVIDENCE_KINDS, DEFAULT_GOAL_PRIORITIES, DEFAULT_GOAL_TEMPLATES, DEFAULT_GOAL_TYPES,
  DEFAULT_MILESTONE_TYPES, GOAL_FIELDS, GOAL_FIELD_LABEL, GOAL_STATUSES, GOAL_STATUS_TEXT, REVIEW_FIELDS, REVIEW_FIELD_LABEL,
  type ActivityStatus, type GoalField, type GoalStatus as PlanGoalStatus, type ReviewField,
} from "./professional/plan-vocabulary";
import {
  DEFAULT_COMPETENCY_CATEGORIES, DEFAULT_CONFIDENCE, DEFAULT_EVIDENCE_TYPES, DEFAULT_RELATIONS, SHARE_PARTS, SHARE_PART_LABEL, type SharePart,
} from "./professional/competency-vocabulary";
import { CATEGORY_LABEL as PASSPORT_CATEGORY_LABEL, DEFAULT_PURPOSES, PASSPORT_CATEGORIES, type PassportCategory } from "./passport-vocabulary";

// ── COMPETEN INDIVIDUAL POLICY ── COMPETEN-CONFIG-002 items 4-7 ─────────────────────────────────────────
//
// The values an Individual Product Administrator may set without code, held in the EXISTING Workspace
// Configuration Engine (migration 076) and written through its shared lifecycle
// (src/lib/config/workspace-config-write.ts). Not a second configuration system.
//
// ⚠ WHERE THEY LIVE. workspace_config_overrides at scope_type 'platform', scope_ref 'individual', one row
// per policy at config_path 'individual.policy.<key>'. The super-admin WCE door pins platform scope to
// scope_ref 'platform', so a workspace publish never sweeps an Individual draft into its version, and the
// other way round. Versions and audit are workspace_config_versions and workspace_config_audit.
//
// ⚠ THE HARD LIMITS ARE HERE, IN CODE, AND NOTHING WRITES THEM. Every policy has an immutable range. A
// write outside it is REFUSED (the route answers 422). A value read back outside it -- written by another
// door, restored by a rollback, or typed into the table by hand -- is CLAMPED, so no stored value can take
// a consumer past its limit. An unreadable store, an absent row or a malformed value falls back to the
// constant the consumer used before this file existed, so turning the engine off changes nothing.
//
// ⚠ EFFECTIVE MEANS PUBLISHED. WCE has no effective-date column: a value takes effect when its version is
// published (workspace_config_versions.created_at, the database clock). Scheduling a future date needs a
// schema addition, proposed in the build record and not built.
//
// ⚠ NOT HERE, ON PURPOSE: the Individual release gate (owner-only activation, CONFIG-002 item 3), and
// the limits the schema enforces (the 10 MB upload cap, the MIME types, four answer options). A policy
// can only ever be as wide as what the database already allows.

export const POLICY_SCOPE = { scopeType: "platform", scopeRef: "individual" } as const;
export const POLICY_PATH_PREFIX = "individual.policy.";

/** The estate default (src/lib/ai/quota.ts HOURLY_LIMIT without AI_HOURLY_LIMIT set). */
export const INDIVIDUAL_AI_HOURLY_DEFAULT = 30;

export type IntPolicyKey = "reminder_horizon_days" | "professional_need_review_days" | "professional_goal_review_days" | "professional_plan_reminder_days" | "professional_competency_reassess_days" | "share_link_max_days" | "professional_learning_match_days" | "ai_hourly_limit" | "scholar_questions_per_request" | "scholar_materials_per_person"
  | "scholar_insight_min_answers" | "scholar_insight_window_days" | "scholar_upload_max_mb" | "scholar_pdf_max_pages" | "scholar_pptx_max_slides"
  | "scholar_upload_session_files" | "scholar_upload_session_mb" | "scholar_session_max_steps" | "scholar_tutor_turns"
  | "scholar_revision_quantity" | "scholar_srs_mastery_reps" | "scholar_srs_mastery_days" | "scholar_srs_max_interval_days" | "scholar_srs_harder_interval_percent"
  | "scholar_evaluation_min_evidence" | "scholar_evaluation_recency_days" | "scholar_evaluation_min_sources" | "scholar_evaluation_band_strong"
  | "scholar_evaluation_band_developing" | "scholar_evaluation_fresh_quantity" | "scholar_progress_periods" | "scholar_progress_next_max"
  | "professional_evaluation_sufficiency" | "professional_evaluation_recency_days" | "professional_evaluation_period_days" | "professional_evaluation_history_shown"
  | "professional_progress_recent_days" | "scholar_exam_web_daily_max" | "scholar_exam_research_cache_days"
  | "scholar_research_daily_max" | "scholar_research_daily_cost_cents" | "scholar_recovery_max_results" | "scholar_recovery_timeout_ms"
  | "scholar_osce_duration_minutes" | "scholar_osce_checklist_min" | "scholar_osce_checklist_max"
  | "scholar_adaptive_length" | "scholar_adaptive_max_length" | "scholar_flashcards_per_generation" | "scholar_flashcard_deck_max";
export type SetPolicyKey = "passport_achievement_kinds" | "scholar_onboarding_fields" | "professional_registration_required" | "professional_document_kinds"
  | "professional_verification_kinds" | "professional_reminder_kinds" | "professional_reminder_offsets" | "professional_reminder_standings" | "professional_share_sections"
  | "professional_need_sources" | "professional_competency_share_parts" | "passport_shareable_kinds" | "scholar_upload_formats" | "scholar_learning_actions"
  | "scholar_revision_formats" | "scholar_revision_modes" | "scholar_case_contexts" | "scholar_case_entries" | "scholar_case_dimensions"
  | "scholar_evaluation_methods" | "scholar_evaluation_evidence" | "scholar_progress_sections" | "scholar_progress_next_rules"
  | "professional_evaluation_scopes" | "professional_evaluation_confidence_factors" | "professional_evaluation_recommendation_rules"
  | "professional_progress_periods" | "professional_progress_recommendation_rules" | "scholar_exam_evidence_sources" | "scholar_learn_source_modes" | "scholar_recovery_providers"
  | "scholar_recovery_evidence_types" | "scholar_adaptive_formats" | "scholar_flashcard_source_modes" | "scholar_flashcard_exports";
/** COMPETEN-SCHOLAR-01 S1: which shared catalogues (framework ids) each experience may offer. */
export type CataloguePolicyKey = "scholar_catalogues" | "professional_catalogues" | "scholar_reference_collections";
/** COMPETEN-SCHOLAR-JOIN-01: the educational context a person gives when they join Scholar. */
export type ProgrammesPolicyKey = "scholar_onboarding_programmes";
export type OptionsPolicyKey = "scholar_institutions" | "professional_evaluation_templates" | "professional_milestone_categories" | "professional_career_categories"
  | "professional_professions" | "professional_titles" | "professional_jurisdictions" | "professional_statuses" | "professional_qualification_types"
  | "professional_registration_bodies" | "professional_practice_settings" | "professional_specialties" | "professional_career_interests"
  | "professional_need_categories" | "professional_need_motivations" | "professional_need_priorities" | "professional_reflection_templates"
  | "professional_goal_types" | "professional_goal_priorities" | "professional_activity_types" | "professional_milestone_types"
  | "professional_goal_templates" | "professional_goal_evidence_kinds"
  | "professional_competency_categories" | "professional_self_assessment_confidence" | "professional_evidence_types" | "professional_evidence_relations"
  | "passport_purposes" | "scholar_exam_web_domains";
/** COMPETEN-PROFESSIONAL-PROFILE-01: an ORDERED choice from a fixed list (form fields, profile sections). */
export type SequencePolicyKey = "professional_progress_views" | "professional_registration_fields" | "professional_profile_sections" | "professional_need_fields" | "professional_need_stages"
  | "professional_goal_fields" | "professional_goal_statuses" | "professional_activity_statuses" | "professional_goal_review_fields"
  | "professional_self_assessment_fields" | "passport_sections" | "scholar_recovery_provider_order";
export type LevelsPolicyKey = "scholar_programme_levels";
/** One value from a fixed list. P0: the least-reviewed content status Scholar offers (migration 394). */
export type ChoicePolicyKey = "scholar_catalogue_min_status" | "professional_profile_ai"
  | "professional_need_reopen" | "professional_need_competency_links" | "professional_need_ai_suggestions" | "professional_need_rule_suggestions"
  | "professional_need_learning" | "professional_reflection_ai"
  | "professional_goal_reopen" | "professional_plan_competency_links" | "professional_plan_learning" | "professional_plan_ai" | "professional_plan_ai_reflections"
  | "professional_competency_personal" | "professional_competency_ai"
  | "passport_recipient_label" | "passport_presentation" | "passport_validity_display" | "passport_export" | "passport_ai"
  | "scholar_default_action" | "scholar_beyond_notes" | "scholar_explanation_depth" | "scholar_check_behaviour" | "scholar_learning_objectives" | "scholar_learning_history"
  | "scholar_revision_difficulty" | "scholar_revision_feedback" | "scholar_revision_generation" | "scholar_revision_recommendations" | "scholar_short_answer_marking"
  | "scholar_case_generation" | "scholar_case_mode" | "scholar_case_reasoning_feedback" | "scholar_evaluation_recommendations"
  | "scholar_exam_papers" | "scholar_exam_web_provider" | "scholar_exam_research_depth" | "scholar_exam_scanned_pages"
  | "scholar_progress_period" | "scholar_passport_evaluations"
  | "professional_evaluation_sharing" | "professional_evaluation_ai" | "professional_evaluation_ai_reflections" | "professional_evaluation_corrections"
  | "professional_progress_default_period" | "professional_documents_ai" | "scholar_recovery_default_mode" | "scholar_recovery_external"
  | "scholar_recovery_evidence_indexed" | "scholar_recovery_evidence_on_topic"
  | "scholar_osce" | "scholar_adaptive_exams" | "scholar_flashcards" | "scholar_flashcard_difficulty" | "scholar_flashcard_level_mix"
  | "scholar_study_sessions";
export type PolicyKey = IntPolicyKey | SetPolicyKey | CataloguePolicyKey | ChoicePolicyKey | ProgrammesPolicyKey | OptionsPolicyKey | LevelsPolicyKey | SequencePolicyKey;

type Common = { label: string; help: string; product: "Professional" | "Scholar" | "Competen Individual"; limitReason: string };
export type IntPolicy = Common & { key: IntPolicyKey; kind: "int"; unit: string; fallback: number; min: number; max: number };
export type SetPolicy = Common & { key: SetPolicyKey; kind: "set"; options: readonly { value: string; label: string }[]; fallback: readonly string[] };
/** A list of framework ids. Options are not fixed in code: the route checks each against the library. */
/** `emptyMeans`: what an empty list does, where that is not "nothing is offered". */
export type CataloguePolicy = Common & { key: CataloguePolicyKey; kind: "catalogues"; max: number; emptyMeans?: string };
/** Programme codes (rows of individual_scholar_programme, migration 387). The route checks each is an active row. */
export type ProgrammesPolicy = Common & { key: ProgrammesPolicyKey; kind: "programmes"; max: number };
/** A governed list of options, each a code and the label shown. The code is derived from the label once. */
/** `noun`: one entry, for the administrator's form. `fallback`: the list in force while nothing is published (a
 *  published empty list means none). `emptyMeans`: what an empty list does for the person. */
export type OptionsPolicy = Common & { key: OptionsPolicyKey; kind: "options"; max: number; noun?: string; fallback?: readonly ContextOption[]; emptyMeans?: string };
/** Members chosen from `options`, in the administrator's order. `fixed` members can never be left out. */
export type SequencePolicy = Common & { key: SequencePolicyKey; kind: "sequence"; options: readonly { value: string; label: string }[]; fallback: readonly string[]; fixed?: readonly string[] };
/** Per programme, its own list of levels. */
export type LevelsPolicy = Common & { key: LevelsPolicyKey; kind: "levels"; maxPerProgramme: number };
export type ChoicePolicy = Common & { key: ChoicePolicyKey; kind: "choice"; options: readonly { value: string; label: string }[]; fallback: string };
export type PolicyDef = IntPolicy | SetPolicy | CataloguePolicy | ChoicePolicy | ProgrammesPolicy | OptionsPolicy | LevelsPolicy | SequencePolicy;
/** Content statuses from least to most reviewed (migration 394). "At least draft" offers draft and approved. */
export const CONTENT_STATUS_ORDER = ["unreviewed", "draft", "approved"] as const;
export type ContentStatusLevel = (typeof CONTENT_STATUS_ORDER)[number];
/** Pure: whether a competency's content status meets the policy minimum. An unknown status never does,
 *  except at the lowest minimum, where everything is offered (and labelled). */
export function meetsMinStatus(status: string, min: ContentStatusLevel): boolean {
  const i = (CONTENT_STATUS_ORDER as readonly string[]).indexOf(status);
  return min === "unreviewed" || (i > -1 && i >= CONTENT_STATUS_ORDER.indexOf(min));
}
export const CATALOGUES_MAX = 50;
export type ContextOption = { code: string; label: string };
const OPTION_CODE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PROGRAMME_CODE = /^[a-z0-9][a-z0-9-]{1,62}$/;
/** Pure: the code an option label is stored under -- lower case, dashes, at most 63 characters. */
export const optionCode = (label: string) => label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63).replace(/-+$/g, "");

/** COMPETEN-SCHOLAR-EXAM-PAPERS-01: the authoritative publishers web research may use until HQ publishes its own list. */
export const EXAM_WEB_DOMAINS_DEFAULT = ["who.int", "health.go.ug", "nice.org.uk", "nhs.uk", "cdc.gov", "nih.gov", "cochranelibrary.com", "resus.org.uk", "sign.ac.uk"] as const;
export type ExamEvidenceSource = "notes" | "library" | "web";
export type ExamResearchDepth = "quick" | "standard" | "deep";
/** COMPETEN-SCHOLAR-EXAM-PAPERS-01 (570), as configured. */
/** COMPETEN-RESEARCH-01: the three Learn modes. "notes" is always offered and is the default. */
export const LEARN_SOURCE_MODES = ["notes", "library", "research"] as const;
export type LearnSourceMode = (typeof LEARN_SOURCE_MODES)[number];
export type ScholarResearchPolicy = {
  /** The modes Scholar offers, in order. Always includes "notes". "research" is SHOWN only while the engine has it operational. */
  modes: LearnSourceMode[];
  /** Per learner per day: fresh research searches, and research-answer AI spend in US cents. */
  dailyMax: number;
  dailyCostCents: number;
};
/** SCHOLAR-SQIE-02: where evidence recovery may look. Notes, then the library, then (references only) external sources. */
export const RECOVERY_MODES = ["notes_only", "notes_and_library", "notes_and_references"] as const;
export type RecoveryMode = (typeof RECOVERY_MODES)[number];
export type RecoveryProvider = "pubmed" | "pmc" | "openalex" | "crossref" | "google_scholar_link" | "guidelines";
export type ScholarRecoveryPolicy = {
  defaultMode: RecoveryMode;
  /** Whether a learner may ask for external scholarly sources at all. Default off. */
  external: "off" | "offer";
  /** The sources recovery may use, in priority order. Default none. Each must ALSO be Active in the research engine. */
  providers: RecoveryProvider[];
  maxResults: number;
  timeoutMs: number;
  /**
   * SCHOLAR-SOURCE-QUALITY-01 (owner GO 30 Oct 2026): which external items may GROUND an explanation. An item that
   * fails stays a reading suggestion, never generation input. pubmed_only: a PMID PubMed itself returned.
   * any_verified: that or a DOI Crossref confirmed.
   */
  evidenceIndexed: "pubmed_only" | "any_verified";
  /** The PubMed publication types that may ground (codes of RECOVERY_EVIDENCE_TYPES). An item of no known type never does. */
  evidenceTypes: RecoveryEvidenceType[];
  /** title: one of the question's specific topic words must be in the item's title. off: no topic check. */
  evidenceOnTopic: "title" | "off";
};
/**
 * SCHOLAR-SOURCE-QUALITY-01: the PubMed publication types (esummary pubtype, exactly as PubMed writes them) Scholar may
 * let ground an explanation. The code is what HQ stores, the label is what HQ and the learner read.
 */
export const RECOVERY_EVIDENCE_TYPES = [
  { value: "review", label: "Review", pubmed: "Review" },
  { value: "systematic_review", label: "Systematic Review", pubmed: "Systematic Review" },
  { value: "meta_analysis", label: "Meta-Analysis", pubmed: "Meta-Analysis" },
  { value: "practice_guideline", label: "Practice Guideline", pubmed: "Practice Guideline" },
  { value: "guideline", label: "Guideline", pubmed: "Guideline" },
  { value: "randomized_controlled_trial", label: "Randomized Controlled Trial", pubmed: "Randomized Controlled Trial" },
  { value: "clinical_trial", label: "Clinical Trial", pubmed: "Clinical Trial" },
] as const;
export type RecoveryEvidenceType = (typeof RECOVERY_EVIDENCE_TYPES)[number]["value"];
/** SCHOLAR-PRACTICE-EXAMS-01 (720): simulated OSCE practice. Formative, never an observed assessment. */
export type ScholarOscePolicy = { enabled: boolean; durationMinutes: number; checklistMin: number; checklistMax: number };
export type ScholarExamPolicy = {
  enabled: boolean;
  sources: ExamEvidenceSource[];
  webProvider: "none" | "anthropic_web_search";
  depth: ExamResearchDepth;
  domains: string[];
  webDailyMax: number;
  cacheDays: number;
  scannedPages: "off" | "ai_transcription";
};
// ── COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1: REGISTRATION AND PROFILE, NO CODE (owner GO s8) ──────────────────
// The same engine, versions and change trail as every policy here. Nothing names a country or a profession: the
// jurisdiction default is the full country list, and professions, titles, specialties, bodies and interests default
// to free text. A published list replaces the default, and the label is COPIED onto the person's record when they
// choose it (migration 450), so renaming or retiring an option never rewrites what they recorded.
const asOptions = (labels: readonly string[]): ContextOption[] => labels.map(label => ({ code: optionCode(label), label })).filter(o => OPTION_CODE.test(o.code));
const PROFESSIONAL_PROFILE_POLICIES: readonly PolicyDef[] = [
  {
    key: "professional_professions", kind: "options", product: "Professional", max: 300, noun: "profession",
    label: "Professions",
    help: "The professions a person may choose when they register for Competen Professional or change profession. With none listed, they type it, and the shared profession vocabulary is offered as suggestions.",
    emptyMeans: "Typed by the person, with the shared vocabulary as suggestions",
    limitReason: "At most 300, each up to 160 characters. A person may always choose Other and type their own.",
  },
  {
    key: "professional_titles", kind: "options", product: "Professional", max: 200, noun: "title",
    label: "Professional titles",
    help: "Titles a person may choose, such as a grade or designation.",
    emptyMeans: "Typed by the person",
    limitReason: "At most 200, each up to 160 characters. A person may always choose Other.",
  },
  {
    key: "professional_jurisdictions", kind: "options", product: "Professional", max: 400, noun: "country or jurisdiction",
    label: "Countries and jurisdictions of practice",
    help: "Where a person may say they practise. Add a state, province or other jurisdiction where registration is not national.",
    fallback: asOptions(COUNTRIES), emptyMeans: "Typed by the person",
    limitReason: "At most 400, each up to 160 characters. Default: every country.",
  },
  {
    key: "professional_statuses", kind: "options", product: "Professional", max: 30, noun: "status",
    label: "Professional-status options",
    help: "How a person describes their current professional status. Always asked at registration.",
    fallback: DEFAULT_STATUSES, emptyMeans: "Typed by the person",
    limitReason: "At most 30, each up to 160 characters. Default: practising, part time, newly qualified, awaiting registration, career break, not practising, retired.",
  },
  {
    key: "professional_qualification_types", kind: "options", product: "Professional", max: 50, noun: "qualification type",
    label: "Qualification types",
    help: "The kinds of qualification a person may record under Qualifications and education.",
    fallback: DEFAULT_QUALIFICATION_TYPES, emptyMeans: "Not asked",
    limitReason: "At most 50, each up to 160 characters.",
  },
  {
    key: "professional_registration_bodies", kind: "options", product: "Professional", max: 300, noun: "registration body",
    label: "Registration bodies",
    help: "Councils, boards and regulators a person may choose for a registration or licence.",
    emptyMeans: "Typed by the person, with the shared vocabulary as suggestions",
    limitReason: "At most 300, each up to 160 characters. A person may always choose Other.",
  },
  {
    key: "professional_practice_settings", kind: "options", product: "Professional", max: 50, noun: "practice setting",
    label: "Practice settings",
    help: "Where a person practises, for registration and for each role in their employment history.",
    fallback: DEFAULT_PRACTICE_SETTINGS, emptyMeans: "Typed by the person",
    limitReason: "At most 50, each up to 160 characters.",
  },
  {
    key: "professional_specialties", kind: "options", product: "Professional", max: 400, noun: "specialty",
    label: "Specialties and practice areas",
    help: "Specialties a person may choose as their primary specialty and in their profile. Also used to suggest competency catalogues.",
    emptyMeans: "Typed by the person",
    limitReason: "At most 400, each up to 160 characters. A person may always choose Other.",
  },
  {
    key: "professional_career_interests", kind: "options", product: "Professional", max: 200, noun: "career interest",
    label: "Career and professional interests",
    help: "Interests a person may add to their profile, such as leadership, education or research.",
    emptyMeans: "Typed by the person",
    limitReason: "At most 200, each up to 160 characters.",
  },
  {
    key: "professional_registration_fields", kind: "sequence", product: "Professional",
    label: "Optional questions at registration, in order",
    help: "Which optional questions the registration form asks after the three required ones, and in what order. A question not asked here can still be answered later in the profile.",
    options: OPTIONAL_FIELDS.map(v => ({ value: v, label: FIELD_LABEL[v] })), fallback: OPTIONAL_FIELDS,
    limitReason: "Profession, jurisdiction and status are always asked and always required. A registration number, licence, employment record or document can never be asked at registration.",
  },
  {
    key: "professional_registration_required", kind: "set", product: "Professional",
    label: "Optional questions made required",
    help: "Which of the optional questions a person must answer to finish registration. Only questions asked above count. Default: none, so every optional question can be skipped.",
    options: OPTIONAL_FIELDS.map(v => ({ value: v, label: FIELD_LABEL[v] })), fallback: [],
    limitReason: "Only the optional questions above. The product contract asks for minimal initial fields.",
  },
  {
    key: "professional_profile_sections", kind: "sequence", product: "Professional",
    label: "Profile sections, in order",
    help: "Which sections the Professional profile shows, and in what order. Records in a hidden section are kept, and show again if the section is shown again.",
    options: PROFILE_SECTIONS.map(v => ({ value: v, label: SECTION_LABEL[v] })), fallback: PROFILE_SECTIONS, fixed: ["overview"],
    limitReason: "The six sections of the profile. The overview is always shown.",
  },
  {
    key: "professional_document_kinds", kind: "set", product: "Professional",
    label: "Records a supporting document may be attached to",
    help: "Verification policy: where a person may attach a certificate or letter. A document makes a record document-supported. It never makes it verified.",
    options: DOCUMENT_KINDS.map(v => ({ value: v, label: ITEM_LABEL[v] })), fallback: DOCUMENT_KINDS,
    limitReason: "Only qualifications, registrations and employment (migration 450). A document is never required.",
  },
  {
    key: "professional_profile_ai", kind: "choice", product: "Professional",
    label: "Personal AI may read the professional profile",
    help: "Privacy rule: whether the person's own personal AI may use their profile (overview, qualifications, roles, specialties, aspirations) when they ask it for a summary or development suggestions.",
    options: [{ value: "on", label: "Yes, when the person asks it" }, { value: "off", label: "No: the profile stays out of AI requests" }],
    fallback: "on",
    limitReason: "Two choices. Whatever is chosen, registration and profile editing work without AI.",
  },
  // ── Part B (owner continuation GO, 25 Oct 2026): verification, reminders and sharing ──
  {
    key: "professional_verification_kinds", kind: "set", product: "Professional",
    label: "Records a person may ask Competen to verify",
    help: "Verification policy: which profile records offer the option to ask Competen to verify them. Verification is always optional, and nobody can verify until the owner appoints a Professional Credential Verifier.",
    options: VERIFIABLE_KINDS.map(v => ({ value: v, label: ITEM_LABEL[v] })), fallback: VERIFIABLE_KINDS,
    limitReason: "Only qualifications, registrations and employment (migration 451). Turning one off stops new requests. Earlier outcomes keep showing.",
  },
  {
    key: "professional_reminder_kinds", kind: "set", product: "Professional",
    label: "What expiry reminders are sent about",
    help: "Reminder eligibility: which kinds of record the daily reminder email covers. Each person still chooses whether to get reminder emails at all.",
    options: REMINDER_KINDS.map(([value, label]) => ({ value, label })), fallback: REMINDER_KINDS.map(([v]) => v),
    limitReason: "Only these four. Default: all.",
  },
  {
    key: "professional_reminder_offsets", kind: "set", product: "Professional",
    label: "Reminder schedule for profile registrations and qualifications",
    help: "How many days before a profile record expires it is reminded. One email for each point reached, never twice for the same point and date. The primary registration and credentials keep the single lead time above.",
    options: REMINDER_OFFSETS.map(v => ({ value: v, label: `${v} days before` })), fallback: ["60"],
    limitReason: "From 180 days to 7. Default: 60 days, the same lead time as the primary registration.",
  },
  {
    key: "professional_reminder_standings", kind: "set", product: "Professional",
    label: "Registration standings that are reminded",
    help: "Reminder eligibility: a registration recorded as lapsed, suspended or retired is not reminded unless it is listed here. A registration with no standing recorded is always reminded.",
    options: REGISTRATION_STANDING.map(o => ({ value: o.code, label: o.label })), fallback: ["active", "provisional"],
    limitReason: "The five standings of the registration record. Default: active and provisional.",
  },
  {
    key: "professional_share_sections", kind: "set", product: "Professional",
    label: "Profile sections a person may put on a Passport link",
    help: "Sharing rule: which parts of the profile a person can choose to carry on a Passport link. Nothing is shared unless the person picks it, record by record, for that link.",
    options: SHAREABLE_SECTIONS.map(v => ({ value: v, label: SECTION_LABEL[v] })), fallback: SHAREABLE_SECTIONS,
    limitReason: "The six profile sections. Registration numbers and documents are never shared.",
  },
];

// ── COMPETEN-PROFESSIONAL-NEEDS-01, Professional Stage 2: DEVELOPMENT NEEDS, NO CODE (owner GO s12) ──────────────
// Categories, sources, motivations, the form's fields and their order, priorities, which stages are offered and in
// what order, whether an addressed or retired need may be reopened, reflection templates, competency links, AI and
// rule suggestions, learning discovery, AI on reflections, and how often a need is suggested for review. Same engine,
// versions and change trail. Nothing names a profession or a country, and no stage sequence is enforced.
const PROFESSIONAL_NEEDS_POLICIES: readonly PolicyDef[] = [
  {
    key: "professional_need_categories", kind: "options", product: "Professional", max: 50, noun: "category",
    label: "Development need categories", help: "Categories a person may give a development need. Optional on the form.",
    fallback: DEFAULT_NEED_CATEGORIES, emptyMeans: "Not asked", limitReason: "At most 50, each up to 160 characters.",
  },
  {
    key: "professional_need_sources", kind: "set", product: "Professional",
    label: "Where a development need can come from",
    help: "The sources a person may choose when they record a need. Needs made from a reflection, an aspiration or a Passport competency say so on their own.",
    options: PICKABLE_SOURCES.map(v => ({ value: v, label: NEED_SOURCE_LABEL[v] })), fallback: PICKABLE_SOURCES,
    limitReason: "Only the sources migration 470 records. Every source makes the same kind of need.",
  },
  {
    key: "professional_need_motivations", kind: "options", product: "Professional", max: 50, noun: "motivation",
    label: "Motivations", help: "What may motivate a development need. Optional on the form.",
    fallback: DEFAULT_NEED_MOTIVATIONS, emptyMeans: "Not asked", limitReason: "At most 50, each up to 160 characters.",
  },
  {
    key: "professional_need_fields", kind: "sequence", product: "Professional",
    label: "Optional development-need fields, in order",
    help: "Which optional fields the development-need form shows, and in what order. The only required field is always \"What would you like to develop?\".",
    options: NEED_FIELDS.map(v => ({ value: v, label: NEED_FIELD_LABEL[v] })), fallback: NEED_FIELDS,
    limitReason: "Only these fields. None can be made required: a need can always be saved with its description alone.",
  },
  {
    key: "professional_need_priorities", kind: "options", product: "Professional", max: 10, noun: "priority",
    label: "Priorities", help: "The priorities a person may give a development need. Words, not scores.",
    fallback: DEFAULT_NEED_PRIORITIES, emptyMeans: "Not asked", limitReason: "At most 10, each up to 160 characters. Never a numerical score.",
  },
  {
    key: "professional_need_stages", kind: "sequence", product: "Professional",
    label: "Development need stages, in order",
    help: "The stages a person may move a need between, in the order they are listed. Any stage may follow any other: there is no required sequence.",
    options: NEED_STAGES.map(v => ({ value: v, label: NEED_STAGE_LABEL[v] })), fallback: NEED_STAGES, fixed: ["identified"],
    limitReason: "The seven stages of migration 470. Identified is always offered. A need in a stage no longer offered keeps it until the person moves it.",
  },
  {
    key: "professional_need_reopen", kind: "choice", product: "Professional",
    label: "Reopening addressed or retired needs",
    help: "Lifecycle rule: whether a person may move an addressed or retired need back to an open stage. Its history is kept either way.",
    options: [{ value: "on", label: "Allowed" }, { value: "off", label: "Not allowed: a closed need stays closed" }], fallback: "on",
    limitReason: "Two choices. Default: allowed.",
  },
  {
    key: "professional_reflection_templates", kind: "options", product: "Professional", max: 20, noun: "reflection prompt",
    label: "Reflection templates", help: "Prompts a person may start a private reflection from.",
    fallback: DEFAULT_REFLECTION_TEMPLATES, emptyMeans: "No prompt: a blank reflection", limitReason: "At most 20, each up to 160 characters.",
  },
  {
    key: "professional_need_competency_links", kind: "choice", product: "Professional",
    label: "Linking needs to competencies",
    help: "Whether a person may link a development need to competencies from the catalogues Professional offers (the allowlist above).",
    options: [{ value: "offered", label: "Allowed, from the offered catalogues" }, { value: "off", label: "Off" }], fallback: "offered",
    limitReason: "Only catalogues already allowed for Professional. With none allowed, nothing is offered and needs work without one.",
  },
  {
    key: "professional_need_rule_suggestions", kind: "choice", product: "Professional",
    label: "Suggested needs from the person's own record",
    help: "Whether Professional suggests needs from the person's own career aspirations and expiring registrations, without AI. Each suggestion says why and needs the person's acceptance.",
    options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }], fallback: "on",
    limitReason: "Two choices. A suggestion is never a need until the person accepts it.",
  },
  {
    key: "professional_need_ai_suggestions", kind: "choice", product: "Professional",
    label: "AI-suggested development needs",
    help: "Whether a person may ask the personal AI to suggest development needs from their own record. AI fair use and model eligibility apply. Each suggestion says why and needs the person's acceptance.",
    options: [{ value: "on", label: "On, when the person asks" }, { value: "off", label: "Off" }], fallback: "on",
    limitReason: "Two choices. Development needs work fully without AI.",
  },
  {
    key: "professional_need_learning", kind: "choice", product: "Professional",
    label: "Learning opportunities on a need",
    help: "Whether a need shows learning it may be served by: catalogue learning where Competen Learning is on, and ways to develop that need no course.",
    options: [{ value: "on", label: "Show" }, { value: "off", label: "Do not show" }], fallback: "on",
    limitReason: "Two choices. Nothing is ever required: no purchase and no enrolment.",
  },
  {
    key: "professional_reflection_ai", kind: "choice", product: "Professional",
    label: "AI on private reflections",
    help: "Privacy rule: whether a person may ask the personal AI to summarise one of their private reflections. Only that reflection is sent, only when they ask, and nothing is stored.",
    options: [{ value: "on", label: "On, when the person asks" }, { value: "off", label: "Off: reflections never reach AI" }], fallback: "on",
    limitReason: "Two choices. Reflections are never shared, whatever is chosen.",
  },
  {
    key: "professional_need_review_days", kind: "int", product: "Professional", unit: "days",
    label: "Suggest reviewing an open need after", help: "Review reminder: an open need not reviewed for this long is marked for review in the person's workspace.",
    fallback: 90, min: 14, max: 365, limitReason: "From two weeks to a year. In-app only: no email.",
  },
];

// ── COMPETEN-PROFESSIONAL-PLAN-01, Professional Stage 3: DEVELOPMENT PLANNING, NO CODE (owner GO) ────────────────
// Goal types, templates, activity and milestone types, statuses, priorities, review questions, reminders, evidence
// expectations, learning recommendations, competency links, AI and its privacy. Same engine, versions and change
// trail. Nothing names a profession or a country, no template is compulsory, and no timeline or pathway is enforced.
const PROFESSIONAL_PLAN_POLICIES: readonly PolicyDef[] = [
  {
    key: "professional_goal_types", kind: "options", product: "Professional", max: 30, noun: "goal type",
    label: "Goal types", help: "Types a person may give a development goal. Optional on the form.",
    fallback: DEFAULT_GOAL_TYPES, emptyMeans: "Not asked", limitReason: "At most 30, each up to 160 characters.",
  },
  {
    key: "professional_goal_priorities", kind: "options", product: "Professional", max: 10, noun: "priority",
    label: "Goal priorities", help: "The priorities a person may give a goal. Words, not scores.",
    fallback: DEFAULT_GOAL_PRIORITIES, emptyMeans: "Not asked", limitReason: "At most 10, each up to 160 characters. Never a numerical score.",
  },
  {
    key: "professional_goal_templates", kind: "options", product: "Professional", max: 10, noun: "planning template",
    label: "Planning templates",
    help: "Templates a person may plan a goal with. Write each as \"Name: first prompt | second prompt | ...\". A template is always optional.",
    fallback: DEFAULT_GOAL_TEMPLATES, emptyMeans: "No templates offered", limitReason: "At most 10, each up to 160 characters, at most 8 prompts. Never compulsory.",
  },
  {
    key: "professional_goal_fields", kind: "sequence", product: "Professional",
    label: "Optional goal fields, in order",
    help: "Which optional fields the goal form shows, and in what order. The only required field is always \"What do you want to achieve?\".",
    options: GOAL_FIELDS.map(v => ({ value: v, label: GOAL_FIELD_LABEL[v] })), fallback: GOAL_FIELDS,
    limitReason: "Only these fields. None can be made required: a goal can always be saved with its description alone.",
  },
  {
    key: "professional_goal_statuses", kind: "sequence", product: "Professional",
    label: "Goal statuses, in order",
    help: "The statuses a person may move a goal between. Any may follow any other. Addressed is the person's own judgement and never verifies competence.",
    options: GOAL_STATUSES.map(v => ({ value: v, label: GOAL_STATUS_TEXT[v] })), fallback: GOAL_STATUSES, fixed: ["planned"],
    limitReason: "The five statuses of migration 480. Planned is always offered.",
  },
  {
    key: "professional_goal_reopen", kind: "choice", product: "Professional",
    label: "Reopening addressed or retired goals",
    help: "Workflow rule: whether a person may move an addressed or retired goal back to an open status. Its history is kept either way.",
    options: [{ value: "on", label: "Allowed" }, { value: "off", label: "Not allowed: a closed goal stays closed" }], fallback: "on",
    limitReason: "Two choices. Default: allowed.",
  },
  {
    key: "professional_activity_types", kind: "options", product: "Professional", max: 50, noun: "activity type",
    label: "Development activity types",
    help: "Kinds of development activity a person may plan: courses, workshops, study, mentorship, learning at work, teaching, research and more.",
    fallback: DEFAULT_ACTIVITY_TYPES, emptyMeans: "Not asked", limitReason: "At most 50, each up to 160 characters.",
  },
  {
    key: "professional_activity_statuses", kind: "sequence", product: "Professional",
    label: "Activity statuses, in order",
    help: "The statuses a person may give a planned activity. Completed follows the record of what happened: a CPD entry or a learning record.",
    options: ACTIVITY_STATUSES.map(v => ({ value: v, label: ACTIVITY_STATUS_TEXT[v] })), fallback: ACTIVITY_STATUSES, fixed: ["planned", "completed"],
    limitReason: "The five statuses of migration 480. Planned and completed are always offered.",
  },
  {
    key: "professional_milestone_types", kind: "options", product: "Professional", max: 20, noun: "milestone type",
    label: "Milestone types", help: "Kinds of milestone a person may add to a goal. Milestones are always optional.",
    fallback: DEFAULT_MILESTONE_TYPES, emptyMeans: "Not asked", limitReason: "At most 20, each up to 160 characters.",
  },
  {
    key: "professional_goal_evidence_kinds", kind: "options", product: "Professional", max: 20, noun: "evidence kind",
    label: "Evidence a person may expect",
    help: "Kinds of evidence shown as ideas when a person writes what evidence they expect. Nothing is required, and expecting evidence verifies nothing.",
    fallback: DEFAULT_EVIDENCE_KINDS, emptyMeans: "No ideas shown", limitReason: "At most 20, each up to 160 characters.",
  },
  {
    key: "professional_goal_review_fields", kind: "sequence", product: "Professional",
    label: "Goal review questions, in order",
    help: "The questions a person may answer when they review a goal. Every answer is optional, and a review is private.",
    options: REVIEW_FIELDS.map(v => ({ value: v, label: REVIEW_FIELD_LABEL[v] })), fallback: REVIEW_FIELDS,
    limitReason: "The five questions of migration 480's review.",
  },
  {
    key: "professional_goal_review_days", kind: "int", product: "Professional", unit: "days",
    label: "Suggest reviewing an open goal after",
    help: "Review reminder: an open goal with no review date, not reviewed for this long, is marked for review in the person's plan.",
    fallback: 90, min: 14, max: 365, limitReason: "From two weeks to a year. In-app only: no email.",
  },
  {
    key: "professional_plan_reminder_days", kind: "int", product: "Professional", unit: "days",
    label: "Plan reminder lead time",
    help: "How many days ahead a target date, review date or milestone is shown as coming up in the person's plan.",
    fallback: 14, min: 1, max: 90, limitReason: "From one day to 90. In-app only: no email.",
  },
  {
    key: "professional_plan_competency_links", kind: "choice", product: "Professional",
    label: "Linking goals and activities to competencies",
    help: "Whether a person may link goals and activities to competencies and outcomes from the catalogues Professional offers. The framework version is kept with each link.",
    options: [{ value: "offered", label: "Allowed, from the offered catalogues" }, { value: "off", label: "Off" }], fallback: "offered",
    limitReason: "Only catalogues already allowed for Professional. With none allowed, plans work without one.",
  },
  {
    key: "professional_plan_learning", kind: "choice", product: "Professional",
    label: "Learning recommendations on a goal",
    help: "Which Competen Learning a goal suggests where Learning is on: by the competencies linked to it, or also by the words of the goal. Adding a course is always optional and never a purchase.",
    options: [{ value: "competency", label: "By linked competencies" }, { value: "search", label: "By linked competencies and the goal's words" }, { value: "off", label: "Do not suggest" }],
    fallback: "competency", limitReason: "Three choices. Manual and external activities work either way.",
  },
  {
    key: "professional_plan_ai", kind: "choice", product: "Professional",
    label: "AI help with planning",
    help: "Whether a person may ask the personal AI for goal, activity and milestone ideas, an evidence summary or review questions. AI fair use and model eligibility apply. Nothing is saved unless the person accepts it.",
    options: [{ value: "on", label: "On, when the person asks" }, { value: "off", label: "Off" }], fallback: "on",
    limitReason: "Two choices. Planning works fully without AI.",
  },
  {
    key: "professional_plan_ai_reflections", kind: "choice", product: "Professional",
    label: "Reflections in AI planning help",
    help: "Privacy rule: planning help never sends a person's private reflections. This cannot be widened here.",
    options: [{ value: "off", label: "Never sent" }], fallback: "off",
    limitReason: "One choice. Reflections stay private; AI on a reflection is the separate, per-reflection rule above.",
  },
];

// ── COMPETEN-PROFESSIONAL-COMPETENCY-01, Professional Stage 5: COMPETENCIES, SELF-ASSESSMENT, EVIDENCE, NO CODE ─────────
// Competency presentation groups, the self-assessment template, confidence, evidence classifications, mapping
// relationships, the Passport parts that may be shared, AI help and the reassessment reminder. Proficiency scales are
// the CFCA scoring scales themselves. Verification methods, rubrics, assessor scopes, workflows and outcomes are the
// Verification Studio's (C5). Nothing names a profession, a country, a method or a scale.
const SELF_ASSESSMENT_FIELDS = ["outcome", "confidence", "reflection", "interest"] as const;
export type SelfAssessmentField = (typeof SELF_ASSESSMENT_FIELDS)[number];
const SELF_ASSESSMENT_FIELD_LABEL: Record<SelfAssessmentField, string> = {
  outcome: "A specific learning outcome", confidence: "Confidence in the assessment", reflection: "An optional private reflection", interest: "Mark as a development interest",
};
const PROFESSIONAL_COMPETENCY_POLICIES: readonly PolicyDef[] = [
  {
    key: "professional_competency_categories", kind: "options", product: "Professional", max: 30, noun: "competency group",
    label: "Competency groups", help: "How My Competencies groups personal entries. Catalogue entries keep their catalogue layer.",
    fallback: DEFAULT_COMPETENCY_CATEGORIES, emptyMeans: "Not grouped", limitReason: "At most 30, each up to 160 characters.",
  },
  {
    key: "professional_competency_personal", kind: "choice", product: "Professional",
    label: "Personal competencies in the person's own words",
    help: "Whether a person may add a competency in their own words, to self-assess and organise evidence when no approved catalogue is offered. A personal entry is never verified.",
    options: [{ value: "on", label: "Allowed" }, { value: "off", label: "Catalogue competencies only" }], fallback: "on",
    limitReason: "Two choices. Default: allowed, so the portfolio works without a catalogue.",
  },
  {
    key: "professional_self_assessment_fields", kind: "sequence", product: "Professional",
    label: "Self-assessment template, in order",
    help: "What the self-assessment asks beyond the level, which always comes from the CFCA proficiency scale. Every part is optional to answer.",
    options: SELF_ASSESSMENT_FIELDS.map(v => ({ value: v, label: SELF_ASSESSMENT_FIELD_LABEL[v] })), fallback: SELF_ASSESSMENT_FIELDS,
    limitReason: "Only these parts. A self-assessment is always labelled self-reported.",
  },
  {
    key: "professional_self_assessment_confidence", kind: "options", product: "Professional", max: 10, noun: "confidence word",
    label: "Confidence in a self-assessment", help: "How sure a person may say they are. Words, never a score.",
    fallback: DEFAULT_CONFIDENCE, emptyMeans: "Not asked", limitReason: "At most 10, each up to 160 characters.",
  },
  {
    key: "professional_competency_reassess_days", kind: "int", product: "Professional", unit: "days",
    label: "Suggest reassessing after", help: "In-app only: a competency not self-assessed for this long is suggested for reassessment. Earlier assessments are always kept.",
    fallback: 180, min: 30, max: 730, limitReason: "From a month to two years. In-app only: no email.",
  },
  {
    key: "professional_evidence_types", kind: "options", product: "Professional", max: 30, noun: "evidence type",
    label: "Evidence classifications",
    help: "Kinds of additional supporting evidence a person may record: observations, feedback, teaching, research, quality improvement and more. Recorded in the existing evidence record.",
    fallback: DEFAULT_EVIDENCE_TYPES, emptyMeans: "Not asked", limitReason: "At most 30, each up to 160 characters.",
  },
  {
    key: "professional_evidence_relations", kind: "options", product: "Professional", max: 10, noun: "mapping relationship",
    label: "Evidence mapping relationships",
    help: "What a piece of evidence may be said to support for a learning outcome: knowledge, application, practical performance, experience, independent verification.",
    fallback: DEFAULT_RELATIONS, limitReason: "At most 10, each up to 160 characters. Supporting evidence is never verification.",
  },
  {
    key: "professional_competency_share_parts", kind: "set", product: "Professional",
    label: "What of a competency may be shared on a Passport link",
    help: "Privacy and sharing: which parts a person may choose to carry on a link. Nothing is shared unless the person ticks it, and private reflections are never shared.",
    options: SHARE_PARTS.map(v => ({ value: v, label: SHARE_PART_LABEL[v] })), fallback: SHARE_PARTS,
    limitReason: "Only these parts. Reflections have no path here.",
  },
  {
    key: "professional_competency_ai", kind: "choice", product: "Professional",
    label: "AI help with competencies",
    help: "Whether a person may ask the personal AI to explore a competency, reflect on a self-assessment, suggest evidence mappings or summarise evidence. AI fair use and model eligibility apply. Nothing is saved unless the person accepts it, and AI never verifies.",
    options: [{ value: "on", label: "On, when the person asks" }, { value: "off", label: "Off" }], fallback: "on",
    limitReason: "Two choices. Competencies and evidence work fully without AI.",
  },
];

// ── COMPETEN-PROFESSIONAL-PASSPORT-01, Professional Stage 7: THE LIFELONG PASSPORT, NO CODE ─────────────────────────
// Sections and their order, which kinds of record may be shared, purposes, whether a recipient must be named, how much
// provenance a recipient sees, how lapsed records are shown, exports and AI. Link lifetimes are share_link_max_days.
// Trust classes and their words are NOT configurable: a recipient relies on them. Record-level selection, revocation,
// minimum disclosure and the draft-then-activate rule are enforced beneath configuration (540 and /verify).
const PASSPORT_POLICIES: readonly PolicyDef[] = [
  {
    key: "passport_sections", kind: "sequence", product: "Professional",
    label: "Passport sections, in order",
    help: "The order in which a Passport and a shared view group their records. A section left out is shown last, never hidden.",
    options: PASSPORT_CATEGORIES.map(v => ({ value: v, label: PASSPORT_CATEGORY_LABEL[v] })), fallback: PASSPORT_CATEGORIES,
    limitReason: "Only these sections. Order only: nothing a person chose to share is ever dropped.",
  },
  {
    key: "passport_shareable_kinds", kind: "set", product: "Professional",
    label: "Kinds of record a person may put on a Passport link",
    help: "Eligible source records and sensitive exclusions. A kind left out is never offered on a link. Private reflections, AI conversations and plans are never shareable, whatever is chosen.",
    options: PASSPORT_CATEGORIES.map(v => ({ value: v, label: PASSPORT_CATEGORY_LABEL[v] })), fallback: PASSPORT_CATEGORIES,
    limitReason: "Only these kinds, each chosen record by record by the person.",
  },
  {
    key: "passport_purposes", kind: "options", product: "Professional", max: 20, noun: "purpose",
    label: "Passport view purposes", help: "What a person may say a shared view is for. Shown to the recipient.",
    fallback: DEFAULT_PURPOSES, emptyMeans: "No purpose asked", limitReason: "At most 20, each up to 160 characters.",
  },
  {
    key: "passport_recipient_label", kind: "choice", product: "Professional",
    label: "Naming the recipient", help: "Recipient restriction: whether a person must say who a view is for. It is a label for them and the recipient, never an account or an address.",
    options: [{ value: "optional", label: "Optional" }, { value: "required", label: "Required" }], fallback: "optional",
    limitReason: "Two choices.",
  },
  {
    key: "passport_presentation", kind: "choice", product: "Professional",
    label: "Verification presentation", help: "How much provenance a recipient sees for each record: source, issuer, date, version, method and authority, or just its trust, validity and meaning.",
    options: [{ value: "detailed", label: "Full provenance" }, { value: "plain", label: "Trust, validity and meaning only" }], fallback: "detailed",
    limitReason: "Two choices. Trust, validity and meaning are always shown.",
  },
  {
    key: "passport_validity_display", kind: "choice", product: "Professional",
    label: "Expired, superseded or revoked records on a link",
    help: "Validity display: show such a record labelled as it is, or leave it off the link. It is never shown as current.",
    options: [{ value: "show", label: "Show, labelled" }, { value: "hide", label: "Leave off the link" }], fallback: "show",
    limitReason: "Two choices.",
  },
  {
    key: "passport_export", kind: "choice", product: "Professional",
    label: "Printable export of a shared view",
    help: "Export template: whether a person may print or save a shared view. It carries its issue date and the link to check current status, and says that a saved copy cannot be recalled.",
    options: [{ value: "on", label: "Allowed" }, { value: "off", label: "Off" }], fallback: "on",
    limitReason: "Two choices.",
  },
  {
    key: "passport_ai", kind: "choice", product: "Professional",
    label: "AI help with the Passport",
    help: "Whether a person may ask the personal AI to draft a view's summary or explain credential categories. AI fair use applies. It never shares, never creates or changes a record, an issuer or a status, and nothing is used unless the person keeps it.",
    options: [{ value: "on", label: "On, when the person asks" }, { value: "off", label: "Off" }], fallback: "on",
    limitReason: "Two choices. The Passport, sharing and verification work fully without AI.",
  },
];

export const POLICIES: readonly PolicyDef[] = [
  {
    key: "reminder_horizon_days", kind: "int", product: "Professional", unit: "days",
    label: "Reminder lead time",
    help: "How many days before a recorded credential or registration expires that the person is reminded, in the app and (if they opted in) by email.",
    fallback: REMINDER_HORIZON_DAYS, min: 7, max: 180,
    limitReason: "Under a week leaves no time to renew. Over six months reminds about something not yet actionable.",
  },
  {
    // Owner (double-counted CPD hours): "automatic removal is best" -- of the duplicate HOURS, never the entry.
    key: "professional_learning_match_days", kind: "int", product: "Professional", unit: "days",
    label: "CPD and Competen Learning match window",
    help: "A CPD entry the person logged is counted once with a Competen Learning course they completed when the titles are the same, it is a course or workshop, any recorded providers agree, and its date is within this many days of the completion. The person can always say it is a different activity.",
    fallback: 7, min: 0, max: 30,
    limitReason: "0 means the same day only. Over a month risks treating a repeat of a course as the same activity, which would hide real hours.",
  },
  {
    key: "share_link_max_days", kind: "int", product: "Professional", unit: "days",
    label: "Longest share-link lifetime",
    help: "The longest a person may make a Passport share link last. They still choose, and the form suggests 30 days or this limit if lower.",
    fallback: SHARE_DAYS_MAX, min: 1, max: SHARE_DAYS_MAX,
    limitReason: "A year is the estate share route's own limit. No link is ever made that does not expire.",
  },
  {
    key: "ai_hourly_limit", kind: "int", product: "Competen Individual", unit: "requests per hour",
    label: "AI requests per person per hour",
    help: "How many Personal AI and Scholar AI requests one person may make in an hour.",
    fallback: INDIVIDUAL_AI_HOURLY_DEFAULT, min: 1, max: INDIVIDUAL_AI_HOURLY_DEFAULT,
    limitReason: "It can tighten the estate AI limit, never exceed it. The estate limit is also applied at runtime and is unchanged.",
  },
  {
    key: "scholar_questions_per_request", kind: "int", product: "Scholar", unit: "questions",
    label: "Practice questions per request",
    help: "How many practice questions or scenarios Scholar writes from one passage at a time.",
    fallback: QUESTIONS_PER_REQUEST, min: 1, max: QUESTIONS_PER_REQUEST,
    limitReason: "Three is the reviewed generation size. Raising it changes the prompt and needs an owner decision.",
  },
  {
    key: "scholar_materials_per_person", kind: "int", product: "Scholar", unit: "materials",
    label: "Study materials per person",
    help: "How many study materials one person may keep uploaded at once.",
    fallback: MAX_MATERIALS_PER_PERSON, min: 1, max: MAX_MATERIALS_PER_PERSON,
    limitReason: "Fifty is the reviewed storage allowance. Each file stays capped at 10 MB by the database.",
  },
  // COMPETEN-SCHOLAR-01 S5 (Learning Intelligence). The two thresholds its measures honour, so how much data a
  // figure needs, and over what window engagement is counted, are governed here rather than hard-coded.
  {
    key: "scholar_insight_min_answers", kind: "int", product: "Scholar", unit: "answers",
    label: "Answers needed before a progress figure is shown",
    help: "How many practice questions, scenarios or revision reviews a person must have answered before Scholar shows an accuracy or recall figure for them. Below it, the page says there is too little practice to say.",
    fallback: INSIGHT_MIN_ANSWERS, min: 3, max: 50,
    limitReason: "Under three, one answer swings a percentage by a third or more. Over fifty hides progress from most students.",
  },
  {
    key: "scholar_insight_window_days", kind: "int", product: "Scholar", unit: "days",
    label: "Engagement window",
    help: "Over how many recent days Scholar counts study days, answers and revision reviews for the engagement measure.",
    fallback: INSIGHT_WINDOW_DAYS, min: 7, max: 90,
    limitReason: "Under a week is noise. Over three months stops reflecting current study habits.",
  },
  {
    key: "passport_achievement_kinds", kind: "set", product: "Scholar",
    label: "Study achievements a person may add to their Passport",
    help: "Which kinds of self-directed study a person may choose to show in their Passport. Turning one off stops new choices of that kind. Achievements a person already chose keep showing: their record is not rewritten.",
    options: STUDY_ACHIEVEMENT_KINDS.map(k => ({ value: k, label: STUDY_ACHIEVEMENT[k].name })),
    fallback: STUDY_ACHIEVEMENT_KINDS,
    limitReason: "Only the kinds migration 375 records can be offered.",
  },
  // ⚠ COMPETEN-SCHOLAR-01 S1: EMPTY UNTIL HQ CHOOSES. No catalogue reaches a person by existing -- not the
  // shared frameworks already in the library, not a newly published one. Unreadable is empty too.
  {
    key: "scholar_catalogues", kind: "catalogues", product: "Scholar", max: CATALOGUES_MAX,
    label: "Competency catalogues Scholar may map study to",
    help: "The shared competency catalogues Scholar may link a person's study materials to. Nothing is offered until a catalogue is chosen here.",
    limitReason: "Only shared, active, published catalogues can be chosen, at most 50. Empty by default: nothing is offered automatically.",
  },
  // ── LEARN-01 (Stage 3 acceptance, item 5): THE GOVERNED REFERENCES LEARN TEACHES TOWARDS ──
  // Empty (the default) keeps the CFCA: each student's programme catalogue, i.e. the catalogues scholar_catalogues
  // already allows. A list names the governed collections exactly -- the CFCA catalogues too, if they stay -- and a
  // new clinically approved collection is added here, with no code. Shared, active and published only, checked when
  // chosen and again on every read. Whatever the source, "clinically approved" is 395's, for that exact content.
  {
    key: "scholar_reference_collections", kind: "catalogues", product: "Scholar", max: CATALOGUES_MAX,
    label: "Governed reference collections for Learn",
    help: "The collections whose competencies and learning outcomes Learn may name as what a student is working towards. List every collection to use, the CFCA catalogues included. A reference is labelled clinically approved only where clinical review approved that exact content.",
    limitReason: "Only shared, active, published catalogues can be chosen, at most 50. Empty by default: each student's programme catalogue (the CFCA catalogues allowed above).",
    emptyMeans: "Each student's programme catalogue (the CFCA catalogues Scholar is allowed)",
  },
  // ── COMPETEN-SCHOLAR-JOIN-01: THE EDUCATIONAL CONTEXT ASKED AT JOIN ── owner ruling CONFIGURATION ──
  // Governed here, in the existing engine, not in a Scholar-specific one. A programme itself is a row of
  // individual_scholar_programme (387), because the competency mapping keys on it. What HQ governs here is
  // which programmes are offered, each programme's levels, the institutions, and which fields are asked.
  {
    key: "scholar_onboarding_programmes", kind: "programmes", product: "Scholar", max: 100,
    label: "Programmes offered when a person joins Scholar",
    help: "Which study programmes a person may choose when they join Competen Scholar or change their programme. A programme a person already chose keeps its name in their history.",
    limitReason: "Only active Scholar programmes can be offered, at most 100. Default: every active programme.",
  },
  {
    key: "scholar_programme_levels", kind: "levels", product: "Scholar", maxPerProgramme: 20,
    label: "Levels within each programme",
    help: "The levels a person may choose within their programme, such as a year of study. A programme with no levels listed asks for none.",
    limitReason: "At most 20 levels per programme, each up to 120 characters. Default: none.",
  },
  {
    key: "scholar_institutions", kind: "options", product: "Scholar", max: 300,
    label: "Institutions a person may name",
    help: "The schools, colleges and universities a person may choose when they join. Naming one is always optional.",
    limitReason: "At most 300, each up to 160 characters. Default: none, so no institution is asked.",
  },
  // COMPETEN-SCHOLAR-UPLOAD, Stage 2: what a student may upload, governed here rather than hard-coded. Each can
  // only TIGHTEN what the database enforces (372: 10 MB, the MIME list; 405 adds plain text).
  {
    key: "scholar_upload_formats", kind: "set", product: "Scholar",
    label: "Formats a student may upload",
    help: "Which kinds of study material can be uploaded. Plain text covers a .txt file and text pasted into the page. Turning a format off stops new uploads of it; materials already uploaded are kept.",
    options: (["pdf", "docx", "pptx", "text"] as const).map(v => ({ value: v, label: FORMAT_LABEL[v] })),
    // ⚠ Plain text is OFF by default: it needs migration 405 (the bucket and the material CHECK). Turn it on
    // only where 405 is applied -- until then an upload of it could not be saved. PowerPoint is OFF by default
    // for the same reason: it needs migration 406 (UPLOAD-01 U1).
    fallback: ["pdf", "docx"],
    limitReason: "Only formats Scholar can read on its own servers. Photos of notes need text recognition (OCR), which is not available.",
  },
  {
    key: "scholar_upload_max_mb", kind: "int", product: "Scholar", unit: "MB",
    label: "Largest file a student may upload",
    help: "The size limit for one uploaded file.",
    // Owner GO 2026-10-24: the ceiling is 25 MB, the value stays 10 MB until HQ raises it. Above 10 needs migration
    // 413 (the database CHECK and the bucket): raise it only where 413 is applied.
    fallback: DEFAULT_UPLOAD_MB, min: 1, max: MAX_UPLOAD_BYTES / 1024 / 1024,
    limitReason: "The database and the private storage bucket cap every file at 25 MB (migration 413; 10 MB where it is not applied). Processing a 25 MB file was measured well inside the server's time and memory limits.",
  },
  {
    key: "scholar_upload_session_files", kind: "int", product: "Scholar", unit: "files",
    label: "Most files in one upload session",
    help: `How many files a student may upload at once, and keep within ${UPLOAD_SESSION_MINUTES} minutes. More are refused with a message to try again later.`,
    fallback: MAX_SESSION_FILES, min: 1, max: MAX_SESSION_FILES,
    limitReason: "Ten files is the reviewed size of one upload session.",
  },
  {
    key: "scholar_upload_session_mb", kind: "int", product: "Scholar", unit: "MB",
    label: "Most data in one upload session",
    help: `The combined size of the files a student may upload at once, and keep within ${UPLOAD_SESSION_MINUTES} minutes.`,
    fallback: MAX_SESSION_MB, min: 10, max: MAX_SESSION_MB,
    limitReason: "One hundred megabytes is the reviewed combined size of one upload session. It is never below one file at the size limit.",
  },
  {
    key: "scholar_pdf_max_pages", kind: "int", product: "Scholar", unit: "pages",
    label: "Most pages in one uploaded PDF",
    help: "A longer PDF is refused with a message asking the student to split it.",
    fallback: MAX_PDF_PAGES, min: 10, max: MAX_PDF_PAGES,
    limitReason: "Three hundred pages is the reviewed extraction size for one material.",
  },
  {
    key: "scholar_pptx_max_slides", kind: "int", product: "Scholar", unit: "slides",
    label: "Most slides in one uploaded PowerPoint",
    help: "A longer presentation is refused with a message asking the student to split it.",
    fallback: 150, min: 5, max: MAX_PPTX_SLIDES,
    limitReason: "Three hundred slides is the reviewed extraction size for one material.",
  },
  {
    key: "scholar_onboarding_fields", kind: "set", product: "Scholar",
    label: "Fields asked when a person joins Scholar",
    help: "Which parts of their educational context a person is asked for after choosing a programme. The programme itself is always asked.",
    options: [{ value: "level", label: "Level within the programme" }, { value: "institution", label: "Institution (always optional)" }],
    fallback: ["level", "institution"],
    limitReason: "Only these two can be asked. A field with nothing configured behind it is not shown.",
  },
  // ── COMPETEN-SCHOLAR-LEARN-01 L5: how Scholar teaches, governed here. Each default is today's behaviour or the
  // owner's stated default (Teach Me first). Security, privacy and clinical-safety rules are NOT settings: the
  // grounding check, the identifier screen, the labels and the background rules apply whatever is chosen.
  {
    key: "scholar_learning_actions", kind: "set", product: "Scholar",
    label: "Learning actions offered to students",
    help: "Which ways of learning the Learn workspace offers. An action switched off is not shown and is refused if asked for.",
    options: LEARN_ACTIONS.map(v => ({ value: v, label: LEARN_ACTION_LABEL[v] })),
    fallback: [...LEARN_ACTIONS],
    limitReason: "Only the seven actions Scholar implements. Default: all.",
  },
  {
    key: "scholar_default_action", kind: "choice", product: "Scholar",
    label: "The learning action a session starts with",
    help: "What Start learning opens with. A student can switch at any time.",
    options: LEARN_ACTIONS.map(v => ({ value: v, label: LEARN_ACTION_LABEL[v] })),
    fallback: "teach",
    limitReason: "One of the learning actions. Default: Teach me. If it is switched off, the first action that is on is used.",
  },
  {
    key: "scholar_beyond_notes", kind: "choice", product: "Scholar",
    label: "Background beyond the student's notes",
    help: "Whether Go deeper, Teach me and Give examples may add general background that is not in the notes. It is always shown apart, labelled, and withheld if it carries figures, doses or citations.",
    options: [{ value: "labelled", label: "Allowed, shown apart and labelled" }, { value: "off", label: "Off: notes only" }],
    fallback: "labelled",
    limitReason: "Two choices. The background rules themselves are fixed.",
  },
  {
    key: "scholar_explanation_depth", kind: "choice", product: "Scholar",
    label: "Default explanation depth",
    help: "How long and detailed explanations are for a student who has not chosen. A student may choose their own.",
    options: [{ value: "brief", label: "Brief" }, { value: "standard", label: "Standard" }, { value: "detailed", label: "Detailed" }],
    fallback: "standard",
    limitReason: "Three depths. Default: standard.",
  },
  {
    key: "scholar_session_max_steps", kind: "int", product: "Scholar", unit: "steps",
    label: "Most steps in one suggested learning session",
    help: "A session's suggested sequence is at most this long. Students may skip, revisit and reorder steps, and explore freely.",
    fallback: 8, min: 3, max: SESSION_MAX_STEPS,
    limitReason: "Each step teaches up to three sections. Twenty steps is the reviewed length of one session.",
  },
  {
    key: "scholar_check_behaviour", kind: "choice", product: "Scholar",
    label: "Informal understanding checks",
    help: "Whether Scholar offers a quick check after teaching a step. A check is formative: never an assessment, never competence.",
    options: [{ value: "offer", label: "Offered after each step (the student chooses)" }, { value: "prompt", label: "Suggested after each step" }, { value: "off", label: "Off" }],
    fallback: "offer",
    limitReason: "Three choices. Checks never become assessment results, whatever is chosen.",
  },
  {
    key: "scholar_learning_objectives", kind: "choice", product: "Scholar",
    label: "Learning objectives in a session",
    help: "Whether a session shows the learning outcomes (from the programme's competency catalogue) that its sections support.",
    options: [{ value: "outcomes", label: "Show competency learning outcomes" }, { value: "off", label: "Do not show" }],
    fallback: "outcomes",
    limitReason: "Outcomes come only from links the student's notes have to the catalogue, labelled with their review state.",
  },
  {
    key: "scholar_tutor_turns", kind: "int", product: "Scholar", unit: "turns",
    label: "Conversation turns Scholar keeps in view",
    help: "How many earlier turns of a conversation (asking, clarifying) Scholar is shown again. Turns are not stored.",
    fallback: TUTOR_MAX_TURNS, min: 2, max: 10,
    limitReason: "Two to ten. More turns cost more per answer and add little.",
  },
  {
    key: "scholar_learning_history", kind: "choice", product: "Scholar",
    label: "Learning history",
    help: "Whether Scholar records learning sessions (the steps, the sections used, the actions taken and informal check outcomes) so a student can resume. It never records what the AI said or what the student typed.",
    options: [{ value: "record", label: "Record structured history (no conversation text)" }, { value: "off", label: "Off: nothing is recorded, sessions cannot be resumed" }],
    fallback: "record",
    limitReason: "Structure only, by design. A student can erase their history with their materials.",
  },
  // ── COMPETEN-SCHOLAR-REVISION-01 (Stage 4): REVISION, in the existing engine (owner GO s9) ──
  // What is offered and its defaults. The rules beneath are not settings: grounding and the identifier screen on
  // every generated item, private_formative only (416), deterministic marking where the kind allows it, AI
  // evaluation always labelled, and nothing here ever becomes assessment or competence.
  {
    key: "scholar_revision_formats", kind: "set", product: "Scholar",
    label: "Revision question formats",
    help: "Which question formats Revision may generate and offer. Questions already saved in a format that is switched off are kept, and not offered.",
    options: REVISION_FORMATS.map(v => ({ value: v, label: REVISION_FORMAT_LABEL[v] })),
    fallback: [...REVISION_FORMATS],
    limitReason: "Only the formats migrations 416 and 710 store. Structured (multi-part) is offered only where 710 is applied. Default: all.",
  },
  {
    key: "scholar_revision_modes", kind: "set", product: "Scholar",
    label: "Revision modes offered",
    help: "Which ways of revising the Revision workspace offers. A mode switched off is not shown and is refused if asked for.",
    options: REVISION_MODES.map(v => ({ value: v, label: REVISION_MODE_LABEL[v] })),
    fallback: [...REVISION_MODES],
    limitReason: "Only the modes Scholar implements. Default: all.",
  },
  {
    key: "scholar_revision_quantity", kind: "int", product: "Scholar", unit: "questions",
    label: "Default number of questions in a revision session",
    help: "How many questions a session offers when the student does not choose. A student may choose up to the fixed limit.",
    fallback: 10, min: 3, max: REVISION_QUANTITY_MAX,
    limitReason: "Three to fifty: migration 417 holds at most fifty questions in one session.",
  },
  {
    key: "scholar_revision_difficulty", kind: "choice", product: "Scholar",
    label: "Default revision difficulty",
    help: "Which questions a session prefers when the student does not choose. Questions with no recorded difficulty count as standard.",
    options: [{ value: "any", label: "Any" }, { value: "easy", label: "Easier" }, { value: "standard", label: "Standard" }, { value: "harder", label: "Harder" }],
    fallback: "any",
    limitReason: "Four choices. Default: any.",
  },
  {
    key: "scholar_revision_feedback", kind: "choice", product: "Scholar",
    label: "Revision feedback",
    help: "When a student sees whether an answer was right: straight away, or at the end of the session. Mock practice always gives it at the end.",
    options: [{ value: "immediate", label: "Immediately after each answer" }, { value: "end", label: "At the end of the session" }],
    fallback: "immediate",
    limitReason: "Two choices. Default: immediately.",
  },
  {
    key: "scholar_revision_generation", kind: "choice", product: "Scholar",
    label: "New revision questions",
    help: "Whether Revision may write new questions from a student's notes when their saved ones are not enough. Saved questions are always reused first, and replaying saved ones never uses AI.",
    options: [{ value: "generate", label: "Reuse saved questions, write new ones for the shortfall" }, { value: "saved_only", label: "Saved questions only: no new AI" }],
    fallback: "generate",
    limitReason: "Two choices. New questions pass the same checks whatever is chosen.",
  },
  {
    key: "scholar_short_answer_marking", kind: "choice", product: "Scholar",
    label: "Short-answer marking",
    help: "How a short answer that does not match a stored accepted answer is marked: by AI evaluation where it is available (labelled as such), or by the student comparing with the accepted answers.",
    options: [{ value: "ai_then_self", label: "AI evaluation where available, otherwise the student's own judgement" }, { value: "self", label: "The student's own judgement only" }],
    // Owner Stage 7 closure (D5-v2): AI marking of short answers is OFF by default, so no unpublished setting can send
    // a clinical answer to a model. Code marking and the student's own grading are unchanged. Publishing
    // "ai_then_self" turns it on, and the model-eligibility gate (#99) still decides.
    fallback: "self",
    limitReason: "A match with an accepted answer is always marked by code first. AI evaluation is always labelled. Default: the student's own judgement.",
  },
  {
    key: "scholar_revision_recommendations", kind: "choice", product: "Scholar",
    label: "Revision recommendations",
    help: "Whether the Revision workspace suggests what to revise next, from the student's own answers and reviews.",
    options: [{ value: "on", label: "Show recommendations" }, { value: "off", label: "Do not show" }],
    fallback: "on",
    limitReason: "Recommendations come only from recorded answers and reviews, each with its reason.",
  },
  // ── SCHOLAR-PRACTICE-EXAMS-01: ADAPTIVE EXAMS, on the revision engine ──
  // What is offered and its defaults. The rule beneath is not a setting: transparent rule-based adaptation (three right
  // in a row up, two of the last three missed down), formative only, never a calibrated score or an examination.
  {
    key: "scholar_adaptive_exams", kind: "choice", product: "Scholar",
    label: "Adaptive exams",
    help: "Whether Revise offers adaptive exams: a practice exam whose next question is harder or easier by a stated rule on the student's own answers. Formative practice only.",
    options: [{ value: "on", label: "Offer adaptive exams" }, { value: "off", label: "Do not offer" }],
    fallback: "on",
    limitReason: "Rule-based adaptation only. The report always says it is a practice estimate, not a calibrated score, an examination result or verified competence.",
  },
  {
    key: "scholar_adaptive_length", kind: "int", product: "Scholar", unit: "questions",
    label: "Default length of an adaptive exam",
    help: "How many questions an adaptive exam has when the student does not choose. Never more than the maximum below.",
    fallback: 15, min: ADAPTIVE_LENGTH_MIN, max: ADAPTIVE_LENGTH_MAX,
    limitReason: "Five to fifty: the rule needs answers to act on, and migration 417 holds at most fifty questions in one session.",
  },
  {
    key: "scholar_adaptive_max_length", kind: "int", product: "Scholar", unit: "questions",
    label: "Longest adaptive exam a student may choose",
    help: "The most questions a student may choose for one adaptive exam.",
    fallback: 30, min: ADAPTIVE_LENGTH_MIN, max: ADAPTIVE_LENGTH_MAX,
    limitReason: "Five to fifty: migration 417 holds at most fifty questions in one session.",
  },
  {
    key: "scholar_adaptive_formats", kind: "set", product: "Scholar",
    label: "Adaptive exam question formats",
    help: "Which question formats an adaptive exam may use. Only formats Revision also offers are used. Flashcards are self-graded recall and are never part of an exam.",
    options: ADAPTIVE_FORMATS.map(v => ({ value: v, label: REVISION_FORMAT_LABEL[v] })),
    fallback: [...ADAPTIVE_FORMATS],
    limitReason: "Only the formats migrations 416 and 710 store. Structured (multi-part) needs 710 and feedback after each answer. Default: all of these.",
  },
  // ── SCHOLAR-FLASHCARDS-01: FLASHCARDS, on the revision engine (owner, 31 Oct 2026) ──
  // What is offered and its limits. The rules beneath are not settings: a card is a revision question (416), its schedule
  // the shared SM-2 (the spaced review settings below apply to cards too), grounding, the identifier screen, dedupe and
  // the one-concept recall check on every generated card, governed library first, private and formative always.
  {
    key: "scholar_flashcards", kind: "choice", product: "Scholar",
    label: "Flashcards",
    help: "Whether Revise offers Flashcards: decks of recall cards from the student's own notes, the Competen library and their learning gaps, cards they write themselves, two-button recall on the spaced review schedule, and downloadable decks and revision guides. Formative practice only.",
    options: [{ value: "on", label: "Offer flashcards" }, { value: "off", label: "Do not offer" }],
    fallback: "on",
    limitReason: "Decks, hand-written cards, bookmarks and notes need migration 730. Without it, flashcards from notes and the library still work. Default: offered.",
  },
  {
    key: "scholar_flashcards_per_generation", kind: "int", product: "Scholar", unit: "cards",
    label: "Most new flashcards written at one time",
    help: "However many cards a student asks for, at most this many new ones are written by AI in one go. Saved and library cards are reused first and do not count.",
    fallback: 10, min: 1, max: 30,
    limitReason: "One to thirty, and never more than the revision generation calls allow. Default: ten.",
  },
  {
    key: "scholar_flashcard_deck_max", kind: "int", product: "Scholar", unit: "cards",
    label: "Most cards in one deck",
    help: "A deck may hold at most this many cards. One study run takes up to fifty of them, due cards first.",
    fallback: 200, min: 10, max: 1000,
    limitReason: "Ten to a thousand. A study run is a revision session, which holds at most fifty cards (migration 417). Default: two hundred.",
  },
  {
    key: "scholar_flashcard_source_modes", kind: "set", product: "Scholar",
    label: "Where new flashcards may come from",
    help: "The sources a student may choose for new flashcards: their notes only, or their notes with the clinically approved references linked to them. Governed library cards are always offered first.",
    options: [{ value: "notes", label: "Notes only" }, { value: "notes_and_references", label: "Notes and approved references" }],
    fallback: ["notes", "notes_and_references"],
    limitReason: "Two modes. Notes only is always allowed (an empty choice means notes only). Default: both.",
  },
  {
    key: "scholar_flashcard_difficulty", kind: "choice", product: "Scholar",
    label: "Default flashcard difficulty",
    help: "Which cards a study run prefers, and the level new cards are written at, when the student does not choose.",
    options: [{ value: "any", label: "Any" }, { value: "easy", label: "Easier" }, { value: "standard", label: "Standard" }, { value: "harder", label: "Harder" }],
    fallback: "any",
    limitReason: "Four choices. Default: any (the programme level, adapted to recent answers).",
  },
  {
    // SCHOLAR-FLASHCARDS-QA-01: the mix of cognitive levels new cards are written to (question-intel.ts
    // flashcardLevelMix). Only the levels a passage can support are ever asked for; the rest fall back to recall and
    // understanding, and why is recorded on the generation audit row.
    key: "scholar_flashcard_level_mix", kind: "choice", product: "Scholar",
    label: "Mix of new flashcards",
    help: "The mix of recall, understanding, application and clinical reasoning cards written by AI. By programme level: mostly recall and understanding for enrolled and certificate programmes, balanced for diplomas and degrees, more application and clinical reasoning for master's and doctoral study. Application and reasoning cards are written only where the notes describe a situation and give a reason; otherwise recall and understanding cards are written instead.",
    options: [
      { value: "programme", label: "By programme level" }, { value: "recall", label: "Mostly recall and understanding" },
      { value: "balanced", label: "Balanced" }, { value: "applied", label: "More application and clinical reasoning" },
    ],
    fallback: "programme",
    limitReason: "Four choices. A level the notes cannot support is never asked for. Default: by programme level (balanced where the programme names no level).",
  },
  // SCHOLAR-SESSION-AI-02 (740): connected study sessions. OFF by default, and off in effect while migration 740 is
  // absent (isStudySessionsOn), so switching it on before 740 is applied changes nothing (CLAUDE.md Database state 3).
  {
    key: "scholar_study_sessions", kind: "choice", product: "Scholar",
    label: "Connected study sessions",
    help: "Whether a student may start a study session that carries one focus (a topic, a document or a learning objective) across Learn, Revise, Apply and Evaluate, resume it on any device, and ask the Personal AI with that session in mind. Formative only: nothing in a study session is assessment evidence or verified competence.",
    options: [{ value: "on", label: "Offered" }, { value: "off", label: "Not offered" }],
    fallback: "off",
    limitReason: "Needs migration 740. Without it the setting has no effect and study sessions stay off. Default: not offered.",
  },
  {
    key: "scholar_flashcard_exports", kind: "set", product: "Scholar",
    label: "Flashcard downloads offered",
    help: "Which downloads a student may make from their own cards: a deck of flashcards, printable cards, and a multi-page revision guide. Each is a PDF of the student's own cards only.",
    options: [{ value: "deck", label: "This deck (flashcards)" }, { value: "print", label: "Printable cards" }, { value: "guide", label: "Revision guide" }],
    fallback: ["deck", "print", "guide"],
    limitReason: "Three formats. Default: all.",
  },
  {
    key: "scholar_srs_mastery_reps", kind: "int", product: "Scholar", unit: "reviews",
    label: "Spaced review: consecutive good reviews for a long interval",
    help: "How many reviews in a row graded Okay or better move a card to a long interval.",
    fallback: 5, min: 3, max: 10,
    limitReason: "The rule the Holdings reinforcement cards use is five. Three to ten.",
  },
  {
    key: "scholar_srs_mastery_days", kind: "int", product: "Scholar", unit: "days",
    label: "Spaced review: the interval that counts as long",
    help: "A card whose interval reaches this, after enough good reviews, moves to a long interval.",
    fallback: 60, min: 14, max: 365,
    limitReason: "Two weeks to a year. Default: sixty days.",
  },
  {
    key: "scholar_srs_max_interval_days", kind: "int", product: "Scholar", unit: "days",
    label: "Spaced review: longest interval between reviews",
    help: "However well a card is remembered, it comes back within this many days.",
    fallback: 3650, min: 30, max: 3650,
    limitReason: "One month to ten years. Default: ten years (no practical cap).",
  },
  {
    key: "scholar_srs_harder_interval_percent", kind: "int", product: "Scholar", unit: "percent",
    label: "Spaced review: interval for harder questions",
    help: "Harder questions come back sooner: their interval is this share of the usual one.",
    fallback: 100, min: 50, max: 100,
    limitReason: "Fifty to one hundred percent. Default: one hundred (no difference).",
  },
  // ── COMPETEN-SCHOLAR-CLINICAL-REASONING-01 (Stage 5A): CLINICAL REASONING, in the existing engine (owner GO s8) ──
  // Beneath configuration, fixed: a private case is private_formative and grounded in the notes, linear, screened for
  // identifiers; choices are marked by their key; safety criteria are machine-checked; AI feedback is labelled; a
  // library case is played only through the shared delivery, and only when published and approved for that version.
  {
    key: "scholar_case_contexts", kind: "set", product: "Scholar",
    label: "Clinical contexts offered for cases",
    help: "The clinical contexts a student may choose for a practice case. The context shapes the case the AI writes from their notes and which library cases are offered.",
    options: CASE_CONTEXTS.map(v => ({ value: v, label: CASE_CONTEXT_LABEL[v] })),
    fallback: [...CASE_CONTEXTS],
    limitReason: "Only the contexts Scholar names. Default: all.",
  },
  {
    key: "scholar_case_entries", kind: "set", product: "Scholar",
    label: "Ways to start a clinical case",
    help: "Which ways of starting a case are offered. Choosing an existing case also needs the case library switched on.",
    options: CASE_ENTRIES.map(v => ({ value: v, label: CASE_ENTRY_LABEL[v] })),
    fallback: [...CASE_ENTRIES],
    limitReason: "Only the four entries Scholar implements. Default: all.",
  },
  {
    key: "scholar_case_dimensions", kind: "set", product: "Scholar",
    label: "Reasoning dimensions cases are written and fed back on",
    help: "The dimensions of clinical reasoning a private case's decisions name, and its debrief reports on.",
    options: Object.entries(CASE_DIMENSION_LABEL).map(([value, label]) => ({ value, label })),
    fallback: Object.keys(CASE_DIMENSION_LABEL),
    limitReason: "The six dimensions of the shared case blueprint. Default: all.",
  },
  {
    key: "scholar_case_generation", kind: "choice", product: "Scholar",
    label: "Private cases from a student's notes",
    help: "Whether Scholar may write a new practice case from a student's notes. Stored cases are always replayable, and library cases need no AI.",
    options: [{ value: "generate", label: "Write new cases from the notes" }, { value: "stored_only", label: "Stored and library cases only: no new AI" }],
    fallback: "generate",
    limitReason: "Two choices. A written case passes the same checks whatever is chosen.",
  },
  // COMPETEN-SCHOLAR-EXAM-PAPERS-01 (570): studying uploaded examination papers. Every outward-facing part -- live web
  // research, AI transcription of scanned pages -- is OFF until the owner publishes it here: each sends data to a
  // processor, and web research sends query text through a search provider (docs/COMPETEN-SCHOLAR-EXAM-PAPERS-01.md).
  {
    key: "scholar_exam_papers", kind: "choice", product: "Scholar",
    label: "Studying examination papers",
    help: "Whether a student may study an uploaded past or practice paper question by question: attempt, reveal a suggested answer with its evidence, ask follow-ups and turn answers into revision.",
    options: [{ value: "on", label: "Offered" }, { value: "off", label: "Not offered" }],
    fallback: "on",
    limitReason: "Needs migration 570. Default: offered (with your notes and the Competen library as evidence, no web research).",
  },
  {
    key: "scholar_exam_evidence_sources", kind: "set", product: "Scholar",
    label: "Evidence a suggested answer may draw on",
    help: "Your notes: the student's own materials. Competen library: the governed CFCA competencies and outcomes. Live web research: current public sources from the allowed domains, only when a web provider is also chosen.",
    options: [{ value: "notes", label: "The student's own notes" }, { value: "library", label: "The governed Competen library" }, { value: "web", label: "Live web research" }],
    fallback: ["notes", "library"],
    limitReason: "Web research also needs a provider below. Default: notes and the library.",
  },
  {
    key: "scholar_exam_web_provider", kind: "choice", product: "Scholar",
    label: "Live web research provider",
    help: "Who runs web searches. Only the examination question is sent as the research request: never the student's notes, answers, name or other uploads. Results are public sources, cached and reused.",
    options: [{ value: "none", label: "None (no web research)" }, { value: "anthropic_web_search", label: "Anthropic web search (through the existing AI provider)" }],
    fallback: "none",
    limitReason: "Off by default: an owner decision (a search processor in the privacy notice, search cost and funding).",
  },
  {
    key: "scholar_exam_research_depth", kind: "choice", product: "Scholar",
    label: "Default research depth",
    help: "Quick: one search, a few sources. Standard: up to three searches. Deep: up to five searches and more sources. A student may choose a lighter depth.",
    options: [{ value: "quick", label: "Quick" }, { value: "standard", label: "Standard" }, { value: "deep", label: "Deep" }],
    fallback: "standard",
    limitReason: "Three depths. Default: standard.",
  },
  {
    key: "scholar_exam_web_domains", kind: "options", product: "Scholar", max: 60, noun: "domain",
    label: "Sources web research may use",
    help: "The domains web research may search and cite, one per line (for example who.int). Only these are used, so every web source is from a source you chose as authoritative.",
    fallback: EXAM_WEB_DOMAINS_DEFAULT.map(d => ({ code: optionCode(d), label: d })),
    limitReason: "At most 60. Default: a short list of international and national guideline and evidence publishers.",
  },
  {
    key: "scholar_exam_web_daily_max", kind: "int", product: "Scholar", unit: "research requests",
    label: "Web research requests per student per day",
    help: "How many fresh web research requests one student may make in a day. A cached result does not count.",
    fallback: 10, min: 0, max: 200,
    limitReason: "Zero to two hundred. Default: ten.",
  },
  {
    key: "scholar_exam_research_cache_days", kind: "int", product: "Scholar", unit: "days",
    label: "How long public research results are reused",
    help: "Web research results (public sources only, never a student's material) are reused for this many days, then researched again. Zero turns reuse off.",
    fallback: 30, min: 0, max: 365,
    limitReason: "Zero to a year. Default: thirty days.",
  },
  // SCHOLAR-PRACTICE-EXAMS-01 (720): simulated OSCE practice under Apply. Formative practice only -- never an observed
  // clinical skills assessment, never verified competence. Offered by default because it degrades safely: where 720 is
  // absent Apply says OSCE practice is not available here yet, and nothing else changes.
  {
    key: "scholar_osce", kind: "choice", product: "Scholar",
    label: "OSCE practice stations",
    help: "Whether a student may practise simulated OSCE stations alone: a timed scenario, written responses, then a self-check against the station checklist, with optional AI feedback. Never an observed assessment and never verified competence.",
    options: [{ value: "on", label: "Offered" }, { value: "off", label: "Not offered" }],
    fallback: "on",
    limitReason: "Needs migrations 720 and 721. Default: offered.",
  },
  {
    key: "scholar_osce_duration_minutes", kind: "int", product: "Scholar", unit: "minutes",
    label: "Default OSCE practice station length",
    help: "How long a new practice station runs for, unless the station sets its own length. The timer warns at one minute and stops at the end, keeping what was written.",
    fallback: 8, min: 3, max: 20,
    limitReason: "Three to twenty minutes (720 allows no other). Default: eight.",
  },
  {
    key: "scholar_osce_checklist_min", kind: "int", product: "Scholar", unit: "items",
    label: "Fewest checklist items in a station written from notes",
    help: "A station written by AI from a student's notes is withheld if fewer grounded checklist items than this survive the checks.",
    fallback: 8, min: 1, max: 60,
    limitReason: "One to sixty (the 721 structural bound). Eight to twelve is the design default, and a clinically justified station may differ. Never above the most. Default: eight.",
  },
  {
    key: "scholar_osce_checklist_max", kind: "int", product: "Scholar", unit: "items",
    label: "Most checklist items in a station written from notes",
    help: "At most this many checklist items are kept from a station written by AI from a student's notes.",
    fallback: 12, min: 1, max: 60,
    limitReason: "One to sixty (the 721 structural bound). Eight to twelve is the design default. Default: twelve.",
  },
  // COMPETEN-RESEARCH-01 (owner direction 2026-10-28): governed academic research for Learn, through the shared
  // Holdings research service (src/lib/holdings/research). OFF until the owner publishes a provider AND the Research &
  // Explain mode: only topic keywords leave (screened for patient identifiers), never a learner's notes or identity.
  {
    key: "scholar_learn_source_modes", kind: "set", product: "Scholar",
    label: "What Learn may draw on",
    help: "My notes only is always offered and is the default. My notes + approved Competen library adds the governed library entries that match the topic. Research & Explain also searches the research sources the Research & Evidence Engine has Active, only when the learner chooses it, and labels what it found as external research.",
    options: [{ value: "notes", label: "My notes only" }, { value: "library", label: "My notes + approved Competen library" }, { value: "research", label: "Research & Explain (external academic research)" }],
    fallback: ["notes"],
    limitReason: "My notes only cannot be removed. Research & Explain is shown only while the Research & Evidence Engine has it operational (HQ, AI and Intelligence, Research Sources). Default: notes only.",
  },
  {
    key: "scholar_research_daily_max", kind: "int", product: "Scholar", unit: "research requests",
    label: "Research requests per learner per day",
    help: "Fresh research searches one learner may run in a day. A reused result does not count. At the limit, Learn answers from the notes (and library) and says why.",
    fallback: 5, min: 0, max: 50,
    limitReason: "Zero to fifty. Default: five.",
  },
  {
    key: "scholar_research_daily_cost_cents", kind: "int", product: "Scholar", unit: "US cents",
    label: "Research AI spend per learner per day",
    help: "The most AI spend Research & Explain answers may use for one learner in a day, from the recorded cost of those answers. At the limit, Learn answers from the notes (and library) and says why.",
    fallback: 25, min: 0, max: 500,
    limitReason: "Zero to five dollars. Default: twenty-five cents.",
  },
  // SCHOLAR-SQIE-02 s5-8 (owner, 30 Oct 2026): EVIDENCE RECOVERY when an answer was withheld or the notes were not enough.
  // Notes first, then the approved Competen library, then -- only if the learner chose references AND HQ switched it on
  // AND the Research & Evidence Engine has the source Active -- external scholarly sources. Default: notes + library.
  {
    key: "scholar_recovery_default_mode", kind: "choice", product: "Scholar",
    label: "Finding more learning resources: where to look by default",
    help: "When Scholar could not fully explain a topic from a learner's notes, where it looks for more evidence unless the learner chooses otherwise. Notes and the approved Competen library never leave Competen. Approved references also searches external scholarly sources, and only when the setting below and the Research & Evidence Engine both allow it.",
    options: [{ value: "notes_only", label: "My notes only" }, { value: "notes_and_library", label: "My notes + approved Competen library" }, { value: "notes_and_references", label: "My notes + approved references" }],
    fallback: "notes_and_library",
    limitReason: "Default: notes and the approved library. External sources still need the setting below and an Active source.",
  },
  {
    key: "scholar_recovery_external", kind: "choice", product: "Scholar",
    label: "Finding more learning resources: external scholarly sources",
    help: "Whether a learner may ask Scholar to search external scholarly sources (PubMed, OpenAlex and the others enabled below) for a topic their notes do not cover. Only topic keywords are sent, with names, numbers and dates removed. Never the learner's notes.",
    options: [{ value: "off", label: "Off" }, { value: "offer", label: "Offer to the learner" }],
    fallback: "off",
    limitReason: "Default: off. Each source must also be Active in HQ, AI and Intelligence, Research Sources.",
  },
  {
    key: "scholar_recovery_providers", kind: "set", product: "Scholar",
    label: "Finding more learning resources: sources Scholar may use",
    help: "Of the research sources, the ones evidence recovery may use. A source must ALSO be Active in the Research & Evidence Engine before anything is sent to it. Approved guideline publishers are links to the publishers listed for examination research: nothing is fetched from them.",
    options: [
      { value: "pubmed", label: "PubMed" }, { value: "pmc", label: "PubMed Central (open-access links)" }, { value: "openalex", label: "OpenAlex" },
      { value: "crossref", label: "Crossref (DOI verification)" }, { value: "google_scholar_link", label: "Google Scholar (search link only)" }, { value: "guidelines", label: "Approved guideline publishers (links only)" },
    ],
    fallback: [],
    limitReason: "Default: none. Without Crossref, a reference without a PubMed id cannot be verified and is not shown.",
  },
  {
    key: "scholar_recovery_provider_order", kind: "sequence", product: "Scholar",
    label: "Finding more learning resources: source priority",
    help: "The order the enabled sources are searched and shown in. Where the Research & Evidence Engine has its own order for Scholar, that order is used.",
    options: [
      { value: "pubmed", label: "PubMed" }, { value: "pmc", label: "PubMed Central" }, { value: "openalex", label: "OpenAlex" },
      { value: "crossref", label: "Crossref" }, { value: "google_scholar_link", label: "Google Scholar link" }, { value: "guidelines", label: "Approved guideline publishers" },
    ],
    fallback: ["pubmed", "pmc", "openalex", "crossref", "google_scholar_link", "guidelines"],
    limitReason: "Only these sources. The notes, then the library, always come first.",
  },
  {
    key: "scholar_recovery_max_results", kind: "int", product: "Scholar", unit: "references",
    label: "Finding more learning resources: references per search",
    help: "The most external references one search returns. The Research & Evidence Engine's own limit applies too, whichever is lower.",
    fallback: 5, min: 1, max: 10,
    limitReason: "One to ten. Default: five.",
  },
  {
    key: "scholar_recovery_timeout_ms", kind: "int", product: "Scholar", unit: "milliseconds",
    label: "Finding more learning resources: time allowed per source",
    help: "How long one external source may take to answer before Scholar carries on without it.",
    fallback: 6000, min: 1000, max: 15000,
    limitReason: "One to fifteen seconds. Default: six seconds.",
  },
  // SCHOLAR-SOURCE-QUALITY-01 (owner GO 30 Oct 2026): which external references may be used to EXPLAIN. Every reference
  // found is still shown to the learner as reading; only those passing all three rules are given to the AI.
  {
    key: "scholar_recovery_evidence_indexed", kind: "choice", product: "Scholar",
    label: "Finding more learning resources: which references may be used to explain",
    help: "Which external references Scholar may use to write an explanation. PubMed-indexed only: the reference has a PubMed id that PubMed itself returned. Any verified reference: also one whose DOI Crossref confirmed (for example from OpenAlex). Every other reference found is still shown to the learner as reading, never used to explain.",
    options: [{ value: "pubmed_only", label: "PubMed-indexed only" }, { value: "any_verified", label: "Any verified reference" }],
    fallback: "pubmed_only",
    limitReason: "Default: PubMed-indexed only. The publication type rule below still applies, and only PubMed records give a type.",
  },
  {
    key: "scholar_recovery_evidence_types", kind: "set", product: "Scholar",
    label: "Finding more learning resources: publication types that may be used to explain",
    help: "The kinds of publication, as PubMed lists them, that Scholar may use to write an explanation. Case reports, letters, editorials, comments, news, retractions and preprints are never used. A reference whose type is not known, or is not one chosen here, is shown as reading only.",
    options: RECOVERY_EVIDENCE_TYPES.map(t => ({ value: t.value, label: t.label })),
    fallback: RECOVERY_EVIDENCE_TYPES.map(t => t.value),
    limitReason: "Default: all seven. Choosing none means no external reference is used to explain.",
  },
  {
    key: "scholar_recovery_evidence_on_topic", kind: "choice", product: "Scholar",
    label: "Finding more learning resources: references must be on the topic",
    help: "Whether a reference may be used to explain only when its title names the topic of the question (for example pyelonephritis), not just general words such as treatment, management or care. A reference that does not is shown as reading only.",
    options: [{ value: "title", label: "Topic must be in the title" }, { value: "off", label: "Off" }],
    fallback: "title",
    limitReason: "Default: the topic must be in the title.",
  },
  {
    key: "scholar_exam_scanned_pages", kind: "choice", product: "Scholar",
    label: "Scanned examination pages",
    help: "A scanned page has no text to read. Off: it is flagged as unreadable and nothing is guessed. AI transcription: with the student's AI consent, the page is sent to the existing AI provider to transcribe, every transcribed question is labelled, and anything it cannot read is flagged.",
    options: [{ value: "off", label: "Flag as unreadable" }, { value: "ai_transcription", label: "AI transcription (existing provider)" }],
    fallback: "off",
    limitReason: "Off by default: page images are sent to the AI provider, an owner decision.",
  },
  {
    key: "scholar_case_mode", kind: "choice", product: "Scholar",
    label: "Default way of playing a case",
    help: "Guided shows the case's governed hints; independent does not. A student may choose either.",
    options: [{ value: "guided", label: "Guided (hints shown)" }, { value: "independent", label: "Independent reasoning" }],
    fallback: "guided",
    limitReason: "Two choices. Default: guided.",
  },
  {
    key: "scholar_case_reasoning_feedback", kind: "choice", product: "Scholar",
    label: "Feedback on written reasoning",
    help: "How a written answer in a case gets feedback: AI reasoning feedback where it is available (labelled), or the student compares it with what a good answer contains.",
    options: [{ value: "ai_then_self", label: "AI feedback where available, otherwise the student's own review" }, { value: "self", label: "The student's own review only" }],
    // Owner D5-v2: case-reasoning AI feedback is DISABLED until a recorded model eligibility covers it. Off by
    // default, so nothing depends on someone publishing "self". Publishing "ai_then_self" turns it on, and even
    // then the model-eligibility gate decides.
    fallback: "self",
    limitReason: "Choices are always marked by their key first. AI feedback is always labelled. Default: the student's own review.",
  },
  // ── EVALUATION-01 (Stage 6): how an evaluation reads and interprets evidence. A band describes, it never
  // certifies: there is no pass mark, and no setting can make an evaluation verified competence. ──
  {
    key: "scholar_evaluation_methods", kind: "set", product: "Scholar",
    label: "Evaluation methods offered",
    help: "How a student may evaluate their learning: from the evidence they already have, with a fresh knowledge check, or both combined.",
    options: [{ value: "existing", label: "From existing evidence" }, { value: "fresh", label: "A fresh knowledge check" }, { value: "combined", label: "Existing evidence and a fresh check" }],
    fallback: ["existing", "fresh", "combined"],
    limitReason: "The three methods Scholar implements. Default: all.",
  },
  {
    key: "scholar_evaluation_evidence", kind: "set", product: "Scholar",
    label: "Evidence an evaluation reads",
    help: "Which learning activity an evaluation interprets. Teach Me checks are always shown as informal and never counted as knowledge; AI explanations are never read.",
    options: [{ value: "teach_checks", label: "Teach Me checks (informal)" }, { value: "revision", label: "Revision answers" }, { value: "spaced_review", label: "Spaced review recall" }, { value: "clinical_reasoning", label: "Clinical reasoning decisions" }],
    fallback: ["teach_checks", "revision", "spaced_review", "clinical_reasoning"],
    limitReason: "The four evidence sources Scholar records. Default: all.",
  },
  {
    key: "scholar_evaluation_min_evidence", kind: "int", product: "Scholar", unit: "pieces of evidence",
    label: "Evidence needed before a figure is shown",
    help: "Independent pieces of evidence (one question, or one decision of one case, however often it was answered) a dimension needs before it shows a figure. Below it, the evaluation says there is too little to say.",
    fallback: 5, min: 1, max: 50,
    limitReason: "1 to 50. A figure from one or two answers would mislead.",
  },
  {
    key: "scholar_evaluation_min_sources", kind: "int", product: "Scholar", unit: "sections",
    label: "Breadth needed for more than limited confidence",
    help: "How many different sections of the notes the evidence must come from before an evaluation is more than limited in confidence.",
    fallback: 2, min: 1, max: 20,
    limitReason: "1 to 20.",
  },
  {
    key: "scholar_evaluation_recency_days", kind: "int", product: "Scholar", unit: "days",
    label: "Evidence counted as recent",
    help: "Evidence older than this still counts, but confidence says it may not reflect what the student knows now.",
    fallback: 90, min: 7, max: 730,
    limitReason: "7 to 730 days.",
  },
  {
    key: "scholar_evaluation_band_strong", kind: "int", product: "Scholar", unit: "percent",
    label: "Performance band: strong from",
    help: "The share of independent evidence right at or above which an area is described as a strength. A description of practice, not a pass mark.",
    fallback: 80, min: 50, max: 100,
    limitReason: "50 to 100 percent.",
  },
  {
    key: "scholar_evaluation_band_developing", kind: "int", product: "Scholar", unit: "percent",
    label: "Performance band: developing from",
    help: "At or above this share an area is developing; below it, a learning gap. Always below the strong band: a higher value is read as one below it.",
    fallback: 50, min: 10, max: 95,
    limitReason: "10 to 95 percent.",
  },
  {
    key: "scholar_evaluation_fresh_quantity", kind: "int", product: "Scholar", unit: "questions",
    label: "Questions in a fresh knowledge check",
    help: "How many questions a fresh knowledge check asks. Saved questions are reused first; feedback is held to the end.",
    fallback: 10, min: 3, max: 30,
    limitReason: "3 to 30.",
  },
  {
    key: "scholar_evaluation_recommendations", kind: "choice", product: "Scholar",
    label: "Evaluation recommendations",
    help: "Whether an evaluation suggests next steps (Teach Me, Revision, Spaced Review, a clinical case, a material), each from a finding.",
    options: [{ value: "on", label: "Suggest next steps from the findings" }, { value: "off", label: "Show findings only" }],
    fallback: "on",
    limitReason: "Two choices. Default: on.",
  },
  // ── PROGRESS-01 (Progress, Stage 8 of 8): what the Progress workspace shows, over what periods, and what it suggests.
  // Engagement and coverage are never shown as understanding, and nothing here can make progress verified competence. ──
  {
    key: "scholar_progress_sections", kind: "set", product: "Scholar",
    label: "Progress workspace sections",
    help: "Which parts of the Progress workspace a student sees. Each dimension stays on its own: none is ever summed into one figure.",
    options: [
      { value: "coverage", label: "Knowledge coverage" }, { value: "understanding", label: "Understanding" }, { value: "retention", label: "Retention" },
      { value: "application", label: "Application and clinical reasoning" }, { value: "engagement", label: "Learning engagement" }, { value: "confidence", label: "Evidence confidence" },
      { value: "history", label: "Development over time" }, { value: "competencies", label: "By competency framework" },
    ],
    fallback: ["coverage", "understanding", "retention", "application", "engagement", "confidence", "history", "competencies"],
    limitReason: "The sections Scholar implements. Recommended next steps are always shown. Default: all.",
  },
  {
    key: "scholar_progress_period", kind: "choice", product: "Scholar",
    label: "Default period for development over time",
    help: "How Progress groups a student's development over time by default. A student can switch.",
    options: [{ value: "week", label: "By week" }, { value: "month", label: "By month" }, { value: "programme", label: "By educational context (programme and level)" }],
    fallback: "week",
    limitReason: "Three choices. Default: by week.",
  },
  {
    key: "scholar_progress_periods", kind: "int", product: "Scholar", unit: "periods",
    label: "Periods shown over time",
    help: "How many weeks or months the history shows, ending now.",
    fallback: 8, min: 4, max: 26,
    limitReason: "4 to 26.",
  },
  {
    key: "scholar_progress_next_rules", kind: "set", product: "Scholar",
    label: "Next-step rules",
    help: "Which deterministic rules may suggest a next step. Each step comes from a recorded finding and opens the Scholar activity it names.",
    options: [
      { value: "teach", label: "A learning gap: Teach Me, then Revision" }, { value: "spaced", label: "Recall that did not hold: spaced review" },
      { value: "case", label: "Weaker clinical reasoning: a clinical case" }, { value: "evaluate", label: "Too little evidence: a fresh knowledge check" },
      { value: "classify", label: "A material not classified yet: review its topics" }, { value: "advance", label: "Strong, repeated performance: harder questions" },
    ],
    fallback: ["teach", "spaced", "case", "evaluate", "classify", "advance"],
    limitReason: "The six rules Scholar implements. Default: all.",
  },
  {
    key: "scholar_progress_next_max", kind: "int", product: "Scholar", unit: "steps",
    label: "Next steps shown",
    help: "At most this many recommended next steps, the best-supported first.",
    fallback: 5, min: 1, max: 10,
    limitReason: "1 to 10.",
  },
  {
    key: "scholar_passport_evaluations", kind: "choice", product: "Scholar",
    label: "Educational evaluations in the Passport",
    help: "Whether a student may choose to show a kept evaluation in their Competen Passport, labelled educational and formative, never verified. Nothing is shown unless the student chooses it.",
    options: [{ value: "offer", label: "Students may choose to show them" }, { value: "off", label: "Not offered" }],
    fallback: "offer",
    limitReason: "Two choices. Default: offered. Never shown without the student choosing it.",
  },
  {
    key: "professional_catalogues", kind: "catalogues", product: "Professional", max: CATALOGUES_MAX,
    label: "Competency catalogues Professional may offer",
    help: "The shared competency catalogues a person may link a development need or evidence to in Competen Professional. Links already made keep their names.",
    limitReason: "Only shared, active, published catalogues can be chosen, at most 50. Empty by default: nothing is offered automatically.",
  },
  // P0 controlled catalogues (migration 394), owner direction 2026-10-24: LABEL, DO NOT HIDE. By default every
  // competency of a chosen catalogue is offered, each labelled with its content status. Raising the minimum
  // withholds less-reviewed content from mapping -- a filter HQ can set and undo, never a silent one.
  {
    key: "scholar_catalogue_min_status", kind: "choice", product: "Scholar",
    label: "Least-reviewed competency content Scholar offers",
    help: "Which competencies of the chosen catalogues Scholar may link study to, by content status. Every competency shown is labelled with its status either way.",
    options: [
      { value: "unreviewed", label: "All, labelled (including not clinically reviewed)" },
      { value: "draft", label: "Draft and approved content only" },
      { value: "approved", label: "Approved content only" },
    ],
    fallback: "unreviewed",
    limitReason: "Only the three content statuses of migration 394. Default: everything, labelled.",
  },
  ...PROFESSIONAL_EVALUATION_POLICIES,
  ...PROFESSIONAL_PROGRESS_POLICIES,
  ...PROFESSIONAL_PROFILE_POLICIES,
  ...PROFESSIONAL_NEEDS_POLICIES,
  ...PROFESSIONAL_PLAN_POLICIES,
  ...PROFESSIONAL_COMPETENCY_POLICIES,
  ...PASSPORT_POLICIES,
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const policyPath = (key: PolicyKey) => `${POLICY_PATH_PREFIX}${key}`;
export const policyDef = (key: string): PolicyDef | undefined => POLICIES.find(p => p.key === key);
const byPath = new Map(POLICIES.map(p => [policyPath(p.key), p]));

/** Pure: an integer policy's effective value from a stored settings object. Never outside [min, max]. */
export function clampInt(p: IntPolicy, settings: any): number {
  const n = Number(settings?.value);
  if (settings == null || !Number.isFinite(n)) return p.fallback;
  return Math.min(p.max, Math.max(p.min, Math.floor(n)));
}

/** Pure: a set policy's effective members from a stored settings object. Only known options, in catalogue order. */
export function clampSet(p: SetPolicy, settings: any): string[] {
  if (settings == null || !Array.isArray(settings.enabled)) return [...p.fallback];
  const chosen = new Set(settings.enabled.filter((v: unknown) => typeof v === "string"));
  return p.options.map(o => o.value).filter(v => chosen.has(v));
}

/** Pure: a catalogue allowlist from a stored settings object. Well-formed ids only, deduplicated, capped. */
export function clampCatalogues(p: CataloguePolicy, settings: any): string[] {
  if (settings == null || !Array.isArray(settings.ids)) return [];
  return [...new Set(settings.ids.filter((v: unknown): v is string => typeof v === "string" && UUID.test(v)).map((v: string) => v.toLowerCase()))].slice(0, p.max) as string[];
}

/** Pure: the programmes offered at join, or null for "every active programme" (nothing published). */
export function clampProgrammes(p: ProgrammesPolicy, settings: any): string[] | null {
  if (settings == null || !Array.isArray(settings.codes)) return null;
  return [...new Set(settings.codes.filter((v: unknown): v is string => typeof v === "string" && PROGRAMME_CODE.test(v)))].slice(0, p.max) as string[];
}

const cleanOptions = (raw: unknown, max: number, labelMax: number): ContextOption[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>(); const out: ContextOption[] = [];
  for (const o of raw) {
    const code = typeof o?.code === "string" ? o.code : ""; const label = typeof o?.label === "string" ? o.label.trim() : "";
    if (!OPTION_CODE.test(code) || !label || label.length > labelMax || seen.has(code)) continue;
    seen.add(code); out.push({ code, label });
    if (out.length >= max) break;
  }
  return out;
};

/** Pure: a governed option list from a stored settings object. Well-formed, deduplicated by code, capped. */
export function clampOptions(p: OptionsPolicy, settings: any): ContextOption[] {
  if (settings == null && p.fallback) return [...p.fallback];
  return cleanOptions(settings?.options, p.max, 160);
}

/** Pure: a sequence policy's members in the administrator's order. Known options only, once each, fixed ones always. */
export function clampSequence(p: SequencePolicy, settings: any): string[] {
  if (settings == null || !Array.isArray(settings.order)) return [...p.fallback];
  const known = new Set(p.options.map(o => o.value));
  const out = [...new Set(settings.order.filter((v: unknown): v is string => typeof v === "string" && known.has(v)))] as string[];
  for (const f of [...(p.fixed ?? [])].reverse()) if (!out.includes(f)) out.unshift(f);
  return out;
}

/** Pure: each programme's levels from a stored settings object. */
export function clampLevels(p: LevelsPolicy, settings: any): Record<string, ContextOption[]> {
  const by = settings?.byProgramme;
  if (by == null || typeof by !== "object" || Array.isArray(by)) return {};
  const out: Record<string, ContextOption[]> = {};
  for (const [code, list] of Object.entries(by)) {
    if (!PROGRAMME_CODE.test(code)) continue;
    const levels = cleanOptions(list, p.maxPerProgramme, 120);
    if (levels.length) out[code] = levels;
  }
  return out;
}

/** Pure: labels typed by an administrator, one per entry, as stored options -- or why they are refused. */
function labelsToOptions(raw: unknown, max: number, labelMax: number, what: string): { ok: true; options: ContextOption[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.some(v => typeof v !== "string")) return { ok: false, error: `${what}: send a list of names.` };
  const labels = raw.map(v => v.trim()).filter(Boolean);
  if (labels.length > max) return { ok: false, error: `${what}: at most ${max}. That limit is fixed.` };
  const options: ContextOption[] = []; const seen = new Set<string>();
  for (const label of labels) {
    if (label.length > labelMax) return { ok: false, error: `${what}: "${label.slice(0, 40)}" is longer than ${labelMax} characters.` };
    const code = optionCode(label);
    if (!OPTION_CODE.test(code)) return { ok: false, error: `${what}: "${label.slice(0, 40)}" needs at least one letter or digit.` };
    if (seen.has(code)) return { ok: false, error: `${what}: "${label.slice(0, 40)}" is listed twice.` };
    seen.add(code); options.push({ code, label });
  }
  return { ok: true, options };
}

/** Pure: a choice policy's effective value. Only a listed option; anything else is the fallback. */
export function clampChoice(p: ChoicePolicy, settings: any): string {
  const v = settings?.value;
  return typeof v === "string" && p.options.some(o => o.value === v) ? v : p.fallback;
}

/**
 * Pure: a draft as the administrator sent it, or why it is refused. Out of range is REFUSED here (not
 * silently clamped) so the administrator sees the limit rather than a different number than they typed.
 */
export function validateDraft(key: unknown, raw: unknown): { ok: true; def: PolicyDef; settings: Record<string, unknown> } | { ok: false; error: string } {
  const def = typeof key === "string" ? policyDef(key) : undefined;
  if (!def) return { ok: false, error: "That is not a Competen Individual policy." };
  if (def.kind === "int") {
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    if (!Number.isInteger(n)) return { ok: false, error: `${def.label} must be a whole number.` };
    if (n < def.min || n > def.max) return { ok: false, error: `${def.label} must be between ${def.min} and ${def.max} ${def.unit}. That limit is fixed.` };
    return { ok: true, def, settings: { value: n } };
  }
  if (def.kind === "programmes") {
    if (!Array.isArray(raw) || raw.some(v => typeof v !== "string" || !PROGRAMME_CODE.test(v))) return { ok: false, error: `${def.label}: send the list of programme codes to offer.` };
    const codes = [...new Set(raw as string[])];
    if (codes.length > def.max) return { ok: false, error: `${def.label}: at most ${def.max}. That limit is fixed.` };
    // Whether each code is an active programme row is checked by the route.
    return { ok: true, def, settings: { codes } };
  }
  if (def.kind === "options") {
    const r = labelsToOptions(raw, def.max, 160, def.label);
    return r.ok ? { ok: true, def, settings: { options: r.options } } : r;
  }
  if (def.kind === "levels") {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: `${def.label}: send each programme's levels.` };
    const byProgramme: Record<string, ContextOption[]> = {};
    for (const [code, list] of Object.entries(raw as Record<string, unknown>)) {
      if (!PROGRAMME_CODE.test(code)) return { ok: false, error: `${def.label}: ${code.slice(0, 40)} is not a programme code.` };
      const r = labelsToOptions(list, def.maxPerProgramme, 120, `${def.label} (${code})`);
      if (!r.ok) return r;
      if (r.options.length) byProgramme[code] = r.options;
    }
    // Whether each programme code is a programme row is checked by the route.
    return { ok: true, def, settings: { byProgramme } };
  }
  if (def.kind === "catalogues") {
    if (!Array.isArray(raw) || raw.some(v => typeof v !== "string" || !UUID.test(v))) return { ok: false, error: `${def.label}: send the list of catalogue ids to allow.` };
    const ids = [...new Set(raw.map(v => v.toLowerCase()))];
    if (ids.length > def.max) return { ok: false, error: `${def.label}: at most ${def.max} catalogues. That limit is fixed.` };
    // Whether each id is a shared, active, published framework is checked by the route, against the library.
    return { ok: true, def, settings: { ids } };
  }
  if (def.kind === "choice") {
    if (typeof raw !== "string" || !def.options.some(o => o.value === raw)) return { ok: false, error: `${def.label}: choose one of ${def.options.map(o => o.label).join("; ")}.` };
    return { ok: true, def, settings: { value: raw } };
  }
  if (def.kind === "sequence") {
    if (!Array.isArray(raw) || raw.some(v => typeof v !== "string")) return { ok: false, error: `${def.label}: send the list in order.` };
    const known = new Set(def.options.map(o => o.value));
    const unknown = raw.filter(v => !known.has(v));
    if (unknown.length) return { ok: false, error: `${def.label}: ${unknown.join(", ")} is not one of the options.` };
    if (new Set(raw).size !== raw.length) return { ok: false, error: `${def.label}: each option may appear once.` };
    const missing = (def.fixed ?? []).filter(f => !raw.includes(f));
    if (missing.length) return { ok: false, error: `${def.label}: ${missing.map(m => def.options.find(o => o.value === m)?.label ?? m).join(", ")} is always included. That limit is fixed.` };
    return { ok: true, def, settings: { order: raw } };
  }
  if (!Array.isArray(raw) || raw.some(v => typeof v !== "string")) return { ok: false, error: `${def.label}: send the list of kinds to allow.` };
  const known = new Set(def.options.map(o => o.value));
  const unknown = raw.filter(v => !known.has(v));
  if (unknown.length) return { ok: false, error: `${def.label}: ${unknown.join(", ")} is not a kind that can be offered.` };
  return { ok: true, def, settings: { enabled: def.options.map(o => o.value).filter(v => raw.includes(v)) } };
}

export type IndividualPolicy = {
  reminderHorizonDays: number;
  /** Owner (double-counted CPD hours): days between a CPD entry and a Learning completion for them to be one activity. */
  professionalLearningMatchDays: number;
  /** COMPETEN-PROFESSIONAL-EVALUATION-01: My Professional Evaluation, as configured. */
  professionalEvaluation: ProfessionalEvaluationPolicy;
  /** COMPETEN-PROFESSIONAL-PROGRESS-01: My Professional Progress and the Document Studio, as configured. */
  professionalProgress: ProfessionalProgressPolicy;
  professionalDocuments: { ai: "on" | "off" };
  shareLinkMaxDays: number;
  aiHourlyLimit: number;
  scholarQuestionsPerRequest: number;
  scholarMaterialsPerPerson: number;
  /** Stage 2: which formats may be uploaded, the size limit (MB) and the PDF page limit. */
  scholarUploadFormats: UploadFormat[];
  scholarUploadMaxMb: number;
  scholarPdfMaxPages: number;
  /** UPLOAD-01 U1: the slide limit for one PowerPoint. */
  scholarPptxMaxSlides: number;
  /** COMPETEN-SCHOLAR-LEARN-01 L5. */
  scholarLearningActions: LearnAction[];
  scholarDefaultAction: LearnAction;
  scholarBeyondNotes: "labelled" | "off";
  scholarExplanationDepth: ExplanationDepth;
  scholarSessionMaxSteps: number;
  scholarCheckBehaviour: "offer" | "prompt" | "off";
  scholarLearningObjectives: "outcomes" | "off";
  scholarTutorTurns: number;
  scholarLearningHistory: "record" | "off";
  /** Upload limits (owner GO 2026-10-24): files and combined MB in one upload session. */
  scholarUploadSessionFiles: number;
  scholarUploadSessionMb: number;
  scholarInsightMinAnswers: number;
  scholarInsightWindowDays: number;
  passportAchievementKinds: StudyAchievementKind[];
  /** S1: framework ids each experience may offer. Empty by default. */
  scholarCatalogues: string[];
  professionalCatalogues: string[];
  /** LEARN-01 item 5: the governed reference collections. Empty = the student's programme catalogue (the CFCA). */
  scholarReferenceCollections: string[];
  /** REVISION-01 (Stage 4). */
  scholarRevisionFormats: RevisionFormat[];
  scholarRevisionModes: RevisionMode[];
  scholarRevisionQuantity: number;
  scholarRevisionDifficulty: RevisionDifficulty;
  scholarRevisionFeedback: "immediate" | "end";
  scholarRevisionGeneration: "generate" | "saved_only";
  scholarShortAnswerMarking: "ai_then_self" | "self";
  scholarRevisionRecommendations: "on" | "off";
  /** SCHOLAR-PRACTICE-EXAMS-01: adaptive exams. */
  scholarAdaptiveExams: "on" | "off";
  scholarAdaptiveLength: number;
  scholarAdaptiveMaxLength: number;
  scholarAdaptiveFormats: AdaptiveFormat[];
  /** SCHOLAR-FLASHCARDS-01. */
  scholarFlashcards: "on" | "off";
  scholarFlashcardsPerGeneration: number;
  scholarFlashcardDeckMax: number;
  /** Always includes notes. */
  scholarFlashcardSourceModes: ("notes" | "notes_and_references")[];
  scholarFlashcardDifficulty: RevisionDifficulty;
  scholarFlashcardExports: ("deck" | "print" | "guide")[];
  scholarFlashcardLevelMix: "programme" | "recall" | "balanced" | "applied";
  /** SCHOLAR-SESSION-AI-02. Whether connected study sessions are offered. Read it through isStudySessionsOn, which also needs 740. */
  scholarStudySessions: boolean;
  scholarSrsMasteryReps: number;
  scholarSrsMasteryDays: number;
  scholarSrsMaxIntervalDays: number;
  scholarSrsHarderIntervalPercent: number;
  /** CLINICAL-REASONING-01 (Stage 5A). */
  scholarCaseContexts: CaseContext[];
  scholarCaseEntries: CaseEntry[];
  scholarCaseDimensions: string[];
  scholarCaseGeneration: "generate" | "stored_only";
  scholarCaseMode: "guided" | "independent";
  scholarCaseReasoningFeedback: "ai_then_self" | "self";
  /** EVALUATION-01 (Stage 6). */
  scholarEvaluationMethods: ("existing" | "fresh" | "combined")[];
  scholarEvaluationEvidence: ("teach_checks" | "revision" | "spaced_review" | "clinical_reasoning")[];
  scholarEvaluationMinEvidence: number;
  scholarEvaluationMinSources: number;
  scholarEvaluationRecencyDays: number;
  scholarEvaluationBandStrong: number;
  scholarEvaluationBandDeveloping: number;
  scholarEvaluationFreshQuantity: number;
  scholarEvaluationRecommendations: "on" | "off";
  /** PROGRESS-01 (Progress, Stage 8 of 8). */
  scholarProgressSections: string[];
  scholarProgressPeriod: "week" | "month" | "programme";
  scholarProgressPeriods: number;
  scholarProgressNextRules: string[];
  scholarProgressNextMax: number;
  scholarPassportEvaluations: "offer" | "off";
  /** JOIN-01: programme codes offered at join, or null for every active programme. */
  scholarOnboardingProgrammes: string[] | null;
  scholarProgrammeLevels: Record<string, ContextOption[]>;
  scholarInstitutions: ContextOption[];
  /** COMPETEN-SCHOLAR-EXAM-PAPERS-01 (570). */
  scholarExams: ScholarExamPolicy;
  /** SCHOLAR-PRACTICE-EXAMS-01 (720). */
  scholarOsce: ScholarOscePolicy;
  /** COMPETEN-RESEARCH-01: the Learn source modes and governed academic research. */
  scholarResearch: ScholarResearchPolicy;
  /** SCHOLAR-SQIE-02: evidence recovery after a withheld or insufficient answer. */
  scholarRecovery: ScholarRecoveryPolicy;
  scholarOnboardingFields: ("level" | "institution")[];
  /** P0: the least-reviewed content status Scholar offers. Default "unreviewed": everything, labelled. */
  scholarCatalogueMinStatus: ContentStatusLevel;
  /** COMPETEN-PROFESSIONAL-PROFILE-01: the registration form and profile, as configured. */
  professionalProfile: ProfessionalProfilePolicy;
  /** COMPETEN-PROFESSIONAL-NEEDS-01: development needs, as configured. */
  professionalNeeds: ProfessionalNeedsPolicy;
  /** COMPETEN-PROFESSIONAL-PLAN-01: development planning, as configured. */
  professionalPlan: ProfessionalPlanPolicy;
  /** COMPETEN-PROFESSIONAL-COMPETENCY-01: competencies, self-assessment and evidence, as configured. */
  professionalCompetency: ProfessionalCompetencyPolicy;
  /** COMPETEN-PROFESSIONAL-PASSPORT-01: the lifelong Passport and its shared views, as configured. */
  professionalPassport: PassportPolicy;
};

/** COMPETEN-PROFESSIONAL-PASSPORT-01 (Stage 7): the Passport and its shared views, as configured. */
export type PassportPolicy = {
  sections: PassportCategory[]; shareable: PassportCategory[]; purposes: ContextOption[]; recipient: "optional" | "required";
  presentation: "detailed" | "plain"; validity: "show" | "hide"; exportOn: "on" | "off"; ai: "on" | "off";
};

/** COMPETEN-PROFESSIONAL-COMPETENCY-01 (Stage 5): competencies, self-assessment and evidence, as configured. */
export type ProfessionalCompetencyPolicy = {
  categories: ContextOption[]; confidence: ContextOption[]; evidenceTypes: ContextOption[]; relations: ContextOption[];
  personal: "on" | "off"; fields: SelfAssessmentField[]; shareParts: SharePart[]; ai: "on" | "off"; reassessDays: number;
};

/** COMPETEN-PROFESSIONAL-PLAN-01 (Stage 3): development planning, as configured. */
export type ProfessionalPlanPolicy = {
  goalTypes: ContextOption[]; priorities: ContextOption[]; templates: ContextOption[]; activityTypes: ContextOption[];
  milestoneTypes: ContextOption[]; evidenceKinds: ContextOption[];
  fields: GoalField[]; goalStatuses: PlanGoalStatus[]; activityStatuses: ActivityStatus[]; reviewFields: ReviewField[];
  reopen: "on" | "off"; competencyLinks: "offered" | "off"; learning: "competency" | "search" | "off"; ai: "on" | "off"; aiReflections: "off";
  reviewDays: number; reminderDays: number;
};

export type ProfessionalProfilePolicy = {
  /** Option lists. Empty means the person types the value (free text). */
  professions: ContextOption[]; titles: ContextOption[]; jurisdictions: ContextOption[]; statuses: ContextOption[];
  qualificationTypes: ContextOption[]; registrationBodies: ContextOption[]; practiceSettings: ContextOption[];
  specialties: ContextOption[]; careerInterests: ContextOption[];
  registrationFields: OptionalField[]; registrationRequired: OptionalField[]; sections: ProfileSection[]; documentKinds: ItemKind[];
  ai: "on" | "off";
  /** Part B. Offsets are days before expiry, largest first. */
  verificationKinds: ItemKind[]; reminderKinds: ReminderKind[]; reminderOffsets: number[]; reminderStandings: string[]; shareSections: ProfileSection[];
};

/** COMPETEN-PROFESSIONAL-NEEDS-01 (Stage 2): development needs, as configured. */
export type ProfessionalNeedsPolicy = {
  categories: ContextOption[]; motivations: ContextOption[]; priorities: ContextOption[]; templates: ContextOption[];
  sources: NeedSource[]; fields: NeedField[]; stages: NeedStage[];
  reopen: "on" | "off"; competencyLinks: "offered" | "off"; ruleSuggestions: "on" | "off"; aiSuggestions: "on" | "off";
  learning: "on" | "off"; reflectionAi: "on" | "off"; reviewDays: number;
};

type Row = { config_path: string; published: any };

/** Pure: the effective policy from the partition's rows. Drafts are never read. */
export function resolvePolicy(rows: readonly Row[]): IndividualPolicy {
  const published = new Map(rows.filter(r => byPath.has(r.config_path)).map(r => [r.config_path, r.published]));
  const int = (key: IntPolicyKey) => clampInt(policyDef(key) as IntPolicy, published.get(policyPath(key)));
  return {
    reminderHorizonDays: int("reminder_horizon_days"),
    professionalLearningMatchDays: int("professional_learning_match_days"),
    shareLinkMaxDays: int("share_link_max_days"),
    aiHourlyLimit: int("ai_hourly_limit"),
    scholarQuestionsPerRequest: int("scholar_questions_per_request"),
    scholarMaterialsPerPerson: int("scholar_materials_per_person"),
    scholarUploadFormats: clampSet(policyDef("scholar_upload_formats") as SetPolicy, published.get(policyPath("scholar_upload_formats"))) as UploadFormat[],
    scholarUploadMaxMb: int("scholar_upload_max_mb"),
    scholarPdfMaxPages: int("scholar_pdf_max_pages"),
    scholarPptxMaxSlides: int("scholar_pptx_max_slides"),
    scholarLearningActions: clampSet(policyDef("scholar_learning_actions") as SetPolicy, published.get(policyPath("scholar_learning_actions"))) as LearnAction[],
    scholarDefaultAction: clampChoice(policyDef("scholar_default_action") as ChoicePolicy, published.get(policyPath("scholar_default_action"))) as LearnAction,
    scholarBeyondNotes: clampChoice(policyDef("scholar_beyond_notes") as ChoicePolicy, published.get(policyPath("scholar_beyond_notes"))) as "labelled" | "off",
    scholarExplanationDepth: clampChoice(policyDef("scholar_explanation_depth") as ChoicePolicy, published.get(policyPath("scholar_explanation_depth"))) as ExplanationDepth,
    scholarSessionMaxSteps: int("scholar_session_max_steps"),
    scholarCheckBehaviour: clampChoice(policyDef("scholar_check_behaviour") as ChoicePolicy, published.get(policyPath("scholar_check_behaviour"))) as "offer" | "prompt" | "off",
    scholarLearningObjectives: clampChoice(policyDef("scholar_learning_objectives") as ChoicePolicy, published.get(policyPath("scholar_learning_objectives"))) as "outcomes" | "off",
    scholarTutorTurns: int("scholar_tutor_turns"),
    scholarLearningHistory: clampChoice(policyDef("scholar_learning_history") as ChoicePolicy, published.get(policyPath("scholar_learning_history"))) as "record" | "off",
    scholarUploadSessionFiles: int("scholar_upload_session_files"),
    scholarUploadSessionMb: int("scholar_upload_session_mb"),
    scholarInsightMinAnswers: int("scholar_insight_min_answers"),
    scholarInsightWindowDays: int("scholar_insight_window_days"),
    passportAchievementKinds: clampSet(policyDef("passport_achievement_kinds") as SetPolicy, published.get(policyPath("passport_achievement_kinds"))) as StudyAchievementKind[],
    scholarCatalogues: clampCatalogues(policyDef("scholar_catalogues") as CataloguePolicy, published.get(policyPath("scholar_catalogues"))),
    professionalCatalogues: clampCatalogues(policyDef("professional_catalogues") as CataloguePolicy, published.get(policyPath("professional_catalogues"))),
    scholarReferenceCollections: clampCatalogues(policyDef("scholar_reference_collections") as CataloguePolicy, published.get(policyPath("scholar_reference_collections"))),
    scholarRevisionFormats: clampSet(policyDef("scholar_revision_formats") as SetPolicy, published.get(policyPath("scholar_revision_formats"))) as RevisionFormat[],
    scholarRevisionModes: clampSet(policyDef("scholar_revision_modes") as SetPolicy, published.get(policyPath("scholar_revision_modes"))) as RevisionMode[],
    scholarRevisionQuantity: int("scholar_revision_quantity"),
    scholarRevisionDifficulty: clampChoice(policyDef("scholar_revision_difficulty") as ChoicePolicy, published.get(policyPath("scholar_revision_difficulty"))) as RevisionDifficulty,
    scholarRevisionFeedback: clampChoice(policyDef("scholar_revision_feedback") as ChoicePolicy, published.get(policyPath("scholar_revision_feedback"))) as "immediate" | "end",
    scholarRevisionGeneration: clampChoice(policyDef("scholar_revision_generation") as ChoicePolicy, published.get(policyPath("scholar_revision_generation"))) as "generate" | "saved_only",
    scholarShortAnswerMarking: clampChoice(policyDef("scholar_short_answer_marking") as ChoicePolicy, published.get(policyPath("scholar_short_answer_marking"))) as "ai_then_self" | "self",
    scholarRevisionRecommendations: clampChoice(policyDef("scholar_revision_recommendations") as ChoicePolicy, published.get(policyPath("scholar_revision_recommendations"))) as "on" | "off",
    scholarAdaptiveExams: clampChoice(policyDef("scholar_adaptive_exams") as ChoicePolicy, published.get(policyPath("scholar_adaptive_exams"))) as "on" | "off",
    scholarAdaptiveMaxLength: int("scholar_adaptive_max_length"),
    // The default never exceeds the maximum, whatever was published.
    scholarAdaptiveLength: Math.min(int("scholar_adaptive_length"), int("scholar_adaptive_max_length")),
    scholarAdaptiveFormats: clampSet(policyDef("scholar_adaptive_formats") as SetPolicy, published.get(policyPath("scholar_adaptive_formats"))) as AdaptiveFormat[],
    scholarFlashcards: clampChoice(policyDef("scholar_flashcards") as ChoicePolicy, published.get(policyPath("scholar_flashcards"))) as "on" | "off",
    scholarFlashcardsPerGeneration: int("scholar_flashcards_per_generation"),
    scholarFlashcardDeckMax: int("scholar_flashcard_deck_max"),
    scholarFlashcardSourceModes: (() => { const m = clampSet(policyDef("scholar_flashcard_source_modes") as SetPolicy, published.get(policyPath("scholar_flashcard_source_modes"))) as ("notes" | "notes_and_references")[]; return m.includes("notes") ? m : ["notes" as const, ...m]; })(),
    scholarFlashcardDifficulty: clampChoice(policyDef("scholar_flashcard_difficulty") as ChoicePolicy, published.get(policyPath("scholar_flashcard_difficulty"))) as RevisionDifficulty,
    scholarFlashcardExports: clampSet(policyDef("scholar_flashcard_exports") as SetPolicy, published.get(policyPath("scholar_flashcard_exports"))) as ("deck" | "print" | "guide")[],
    scholarFlashcardLevelMix: clampChoice(policyDef("scholar_flashcard_level_mix") as ChoicePolicy, published.get(policyPath("scholar_flashcard_level_mix"))) as "programme" | "recall" | "balanced" | "applied",
    scholarStudySessions: clampChoice(policyDef("scholar_study_sessions") as ChoicePolicy, published.get(policyPath("scholar_study_sessions"))) === "on",
    scholarSrsMasteryReps: int("scholar_srs_mastery_reps"),
    scholarSrsMasteryDays: int("scholar_srs_mastery_days"),
    scholarSrsMaxIntervalDays: int("scholar_srs_max_interval_days"),
    scholarSrsHarderIntervalPercent: int("scholar_srs_harder_interval_percent"),
    scholarCaseContexts: clampSet(policyDef("scholar_case_contexts") as SetPolicy, published.get(policyPath("scholar_case_contexts"))) as CaseContext[],
    scholarCaseEntries: clampSet(policyDef("scholar_case_entries") as SetPolicy, published.get(policyPath("scholar_case_entries"))) as CaseEntry[],
    scholarCaseDimensions: clampSet(policyDef("scholar_case_dimensions") as SetPolicy, published.get(policyPath("scholar_case_dimensions"))),
    scholarCaseGeneration: clampChoice(policyDef("scholar_case_generation") as ChoicePolicy, published.get(policyPath("scholar_case_generation"))) as "generate" | "stored_only",
    scholarCaseMode: clampChoice(policyDef("scholar_case_mode") as ChoicePolicy, published.get(policyPath("scholar_case_mode"))) as "guided" | "independent",
    scholarCaseReasoningFeedback: clampChoice(policyDef("scholar_case_reasoning_feedback") as ChoicePolicy, published.get(policyPath("scholar_case_reasoning_feedback"))) as "ai_then_self" | "self",
    scholarEvaluationMethods: clampSet(policyDef("scholar_evaluation_methods") as SetPolicy, published.get(policyPath("scholar_evaluation_methods"))) as ("existing" | "fresh" | "combined")[],
    scholarEvaluationEvidence: clampSet(policyDef("scholar_evaluation_evidence") as SetPolicy, published.get(policyPath("scholar_evaluation_evidence"))) as ("teach_checks" | "revision" | "spaced_review" | "clinical_reasoning")[],
    scholarEvaluationMinEvidence: int("scholar_evaluation_min_evidence"),
    scholarEvaluationMinSources: int("scholar_evaluation_min_sources"),
    scholarEvaluationRecencyDays: int("scholar_evaluation_recency_days"),
    scholarEvaluationBandStrong: int("scholar_evaluation_band_strong"),
    scholarEvaluationBandDeveloping: int("scholar_evaluation_band_developing"),
    scholarEvaluationFreshQuantity: int("scholar_evaluation_fresh_quantity"),
    scholarEvaluationRecommendations: clampChoice(policyDef("scholar_evaluation_recommendations") as ChoicePolicy, published.get(policyPath("scholar_evaluation_recommendations"))) as "on" | "off",
    scholarProgressSections: clampSet(policyDef("scholar_progress_sections") as SetPolicy, published.get(policyPath("scholar_progress_sections"))),
    scholarProgressPeriod: clampChoice(policyDef("scholar_progress_period") as ChoicePolicy, published.get(policyPath("scholar_progress_period"))) as "week" | "month" | "programme",
    scholarProgressPeriods: int("scholar_progress_periods"),
    scholarProgressNextRules: clampSet(policyDef("scholar_progress_next_rules") as SetPolicy, published.get(policyPath("scholar_progress_next_rules"))),
    scholarProgressNextMax: int("scholar_progress_next_max"),
    scholarPassportEvaluations: clampChoice(policyDef("scholar_passport_evaluations") as ChoicePolicy, published.get(policyPath("scholar_passport_evaluations"))) as "offer" | "off",
    scholarOnboardingProgrammes: clampProgrammes(policyDef("scholar_onboarding_programmes") as ProgrammesPolicy, published.get(policyPath("scholar_onboarding_programmes"))),
    scholarProgrammeLevels: clampLevels(policyDef("scholar_programme_levels") as LevelsPolicy, published.get(policyPath("scholar_programme_levels"))),
    scholarInstitutions: clampOptions(policyDef("scholar_institutions") as OptionsPolicy, published.get(policyPath("scholar_institutions"))),
    scholarExams: resolveScholarExams(published),
    scholarOsce: resolveScholarOsce(published),
    scholarResearch: resolveScholarResearch(published),
    scholarRecovery: resolveScholarRecovery(published),
    scholarOnboardingFields: clampSet(policyDef("scholar_onboarding_fields") as SetPolicy, published.get(policyPath("scholar_onboarding_fields"))) as ("level" | "institution")[],
    scholarCatalogueMinStatus: clampChoice(policyDef("scholar_catalogue_min_status") as ChoicePolicy, published.get(policyPath("scholar_catalogue_min_status"))) as ContentStatusLevel,
    professionalEvaluation: resolveProfessionalEvaluation(published),
    professionalProgress: resolveProfessionalProgress(published),
    professionalDocuments: { ai: clampChoice(policyDef("professional_documents_ai") as ChoicePolicy, published.get(policyPath("professional_documents_ai"))) as "on" | "off" },
    professionalProfile: resolveProfessionalProfile(published),
    professionalNeeds: resolveProfessionalNeeds(published),
    professionalPlan: resolveProfessionalPlan(published),
    professionalCompetency: resolveProfessionalCompetency(published),
    professionalPassport: resolvePassport(published),
  };
}

function resolvePassport(published: Map<string, any>): PassportPolicy {
  const choice = (key: ChoicePolicyKey) => clampChoice(policyDef(key) as ChoicePolicy, published.get(policyPath(key)));
  return {
    sections: clampSequence(policyDef("passport_sections") as SequencePolicy, published.get(policyPath("passport_sections"))) as PassportCategory[],
    shareable: clampSet(policyDef("passport_shareable_kinds") as SetPolicy, published.get(policyPath("passport_shareable_kinds"))) as PassportCategory[],
    purposes: clampOptions(policyDef("passport_purposes") as OptionsPolicy, published.get(policyPath("passport_purposes"))),
    recipient: choice("passport_recipient_label") as "optional" | "required", presentation: choice("passport_presentation") as "detailed" | "plain",
    validity: choice("passport_validity_display") as "show" | "hide", exportOn: choice("passport_export") as "on" | "off", ai: choice("passport_ai") as "on" | "off",
  };
}

function resolveProfessionalCompetency(published: Map<string, any>): ProfessionalCompetencyPolicy {
  const opts = (key: OptionsPolicyKey) => clampOptions(policyDef(key) as OptionsPolicy, published.get(policyPath(key)));
  const choice = (key: ChoicePolicyKey) => clampChoice(policyDef(key) as ChoicePolicy, published.get(policyPath(key)));
  return {
    categories: opts("professional_competency_categories"), confidence: opts("professional_self_assessment_confidence"),
    evidenceTypes: opts("professional_evidence_types"), relations: opts("professional_evidence_relations"),
    personal: choice("professional_competency_personal") as "on" | "off",
    fields: clampSequence(policyDef("professional_self_assessment_fields") as SequencePolicy, published.get(policyPath("professional_self_assessment_fields"))) as SelfAssessmentField[],
    shareParts: clampSet(policyDef("professional_competency_share_parts") as SetPolicy, published.get(policyPath("professional_competency_share_parts"))) as SharePart[],
    ai: choice("professional_competency_ai") as "on" | "off",
    reassessDays: clampInt(policyDef("professional_competency_reassess_days") as IntPolicy, published.get(policyPath("professional_competency_reassess_days"))),
  };
}

function resolveProfessionalPlan(published: Map<string, any>): ProfessionalPlanPolicy {
  const opts = (key: OptionsPolicyKey) => clampOptions(policyDef(key) as OptionsPolicy, published.get(policyPath(key)));
  const seq = (key: SequencePolicyKey) => clampSequence(policyDef(key) as SequencePolicy, published.get(policyPath(key)));
  const choice = (key: ChoicePolicyKey) => clampChoice(policyDef(key) as ChoicePolicy, published.get(policyPath(key)));
  const int = (key: IntPolicyKey) => clampInt(policyDef(key) as IntPolicy, published.get(policyPath(key)));
  return {
    goalTypes: opts("professional_goal_types"), priorities: opts("professional_goal_priorities"), templates: opts("professional_goal_templates"),
    activityTypes: opts("professional_activity_types"), milestoneTypes: opts("professional_milestone_types"), evidenceKinds: opts("professional_goal_evidence_kinds"),
    fields: seq("professional_goal_fields") as GoalField[], goalStatuses: seq("professional_goal_statuses") as PlanGoalStatus[],
    activityStatuses: seq("professional_activity_statuses") as ActivityStatus[], reviewFields: seq("professional_goal_review_fields") as ReviewField[],
    reopen: choice("professional_goal_reopen") as "on" | "off", competencyLinks: choice("professional_plan_competency_links") as "offered" | "off",
    learning: choice("professional_plan_learning") as "competency" | "search" | "off", ai: choice("professional_plan_ai") as "on" | "off",
    aiReflections: "off",
    reviewDays: int("professional_goal_review_days"), reminderDays: int("professional_plan_reminder_days"),
  };
}

function resolveProfessionalNeeds(published: Map<string, any>): ProfessionalNeedsPolicy {
  const opts = (key: OptionsPolicyKey) => clampOptions(policyDef(key) as OptionsPolicy, published.get(policyPath(key)));
  const seq = (key: SequencePolicyKey) => clampSequence(policyDef(key) as SequencePolicy, published.get(policyPath(key)));
  const choice = (key: ChoicePolicyKey) => clampChoice(policyDef(key) as ChoicePolicy, published.get(policyPath(key)));
  return {
    categories: opts("professional_need_categories"), motivations: opts("professional_need_motivations"),
    priorities: opts("professional_need_priorities"), templates: opts("professional_reflection_templates"),
    sources: clampSet(policyDef("professional_need_sources") as SetPolicy, published.get(policyPath("professional_need_sources"))) as NeedSource[],
    fields: seq("professional_need_fields") as NeedField[], stages: seq("professional_need_stages") as NeedStage[],
    reopen: choice("professional_need_reopen") as "on" | "off", competencyLinks: choice("professional_need_competency_links") as "offered" | "off",
    ruleSuggestions: choice("professional_need_rule_suggestions") as "on" | "off", aiSuggestions: choice("professional_need_ai_suggestions") as "on" | "off",
    learning: choice("professional_need_learning") as "on" | "off", reflectionAi: choice("professional_reflection_ai") as "on" | "off",
    reviewDays: clampInt(policyDef("professional_need_review_days") as IntPolicy, published.get(policyPath("professional_need_review_days"))),
  };
}

function resolveProfessionalProfile(published: Map<string, any>): ProfessionalProfilePolicy {
  const opts = (key: OptionsPolicyKey) => clampOptions(policyDef(key) as OptionsPolicy, published.get(policyPath(key)));
  const seq = (key: SequencePolicyKey) => clampSequence(policyDef(key) as SequencePolicy, published.get(policyPath(key)));
  const set = (key: SetPolicyKey) => clampSet(policyDef(key) as SetPolicy, published.get(policyPath(key)));
  const fields = seq("professional_registration_fields") as OptionalField[];
  return {
    professions: opts("professional_professions"), titles: opts("professional_titles"), jurisdictions: opts("professional_jurisdictions"),
    statuses: opts("professional_statuses"), qualificationTypes: opts("professional_qualification_types"),
    registrationBodies: opts("professional_registration_bodies"), practiceSettings: opts("professional_practice_settings"),
    specialties: opts("professional_specialties"), careerInterests: opts("professional_career_interests"),
    registrationFields: fields,
    // Required counts only for a question that is asked.
    registrationRequired: (set("professional_registration_required") as OptionalField[]).filter(f => fields.includes(f)),
    sections: seq("professional_profile_sections") as ProfileSection[],
    documentKinds: set("professional_document_kinds") as ItemKind[],
    ai: clampChoice(policyDef("professional_profile_ai") as ChoicePolicy, published.get(policyPath("professional_profile_ai"))) as "on" | "off",
    verificationKinds: set("professional_verification_kinds") as ItemKind[],
    reminderKinds: set("professional_reminder_kinds") as ReminderKind[],
    reminderOffsets: set("professional_reminder_offsets").map(Number).sort((a, b) => b - a),
    reminderStandings: set("professional_reminder_standings"),
    shareSections: set("professional_share_sections") as ProfileSection[],
  };
}

/** COMPETEN-PROFESSIONAL-EVALUATION-01 (Stage 6): My Professional Evaluation, as configured. */
/** COMPETEN-PROFESSIONAL-PROGRESS-01 (Stage 8): My Professional Progress, as configured. */
export type ProfessionalProgressPolicy = {
  views: ProgressView[]; periods: PeriodKind[]; defaultPeriod: PeriodKind; rules: ProgressRule[]; recentDays: number;
  milestoneCategories: ContextOption[]; careerCategories: ContextOption[];
};

function resolveProfessionalProgress(published: Map<string, any>): ProfessionalProgressPolicy {
  const periods = clampSet(policyDef("professional_progress_periods") as SetPolicy, published.get(policyPath("professional_progress_periods"))) as PeriodKind[];
  const withYears = periods.includes("year") ? periods : [...periods, "year" as const];
  const def = clampChoice(policyDef("professional_progress_default_period") as ChoicePolicy, published.get(policyPath("professional_progress_default_period"))) as PeriodKind;
  return {
    views: clampSequence(policyDef("professional_progress_views") as SequencePolicy, published.get(policyPath("professional_progress_views"))) as ProgressView[],
    periods: withYears, defaultPeriod: withYears.includes(def) ? def : "year",
    rules: clampSet(policyDef("professional_progress_recommendation_rules") as SetPolicy, published.get(policyPath("professional_progress_recommendation_rules"))) as ProgressRule[],
    recentDays: clampInt(policyDef("professional_progress_recent_days") as IntPolicy, published.get(policyPath("professional_progress_recent_days"))),
    milestoneCategories: clampOptions(policyDef("professional_milestone_categories") as OptionsPolicy, published.get(policyPath("professional_milestone_categories"))),
    careerCategories: clampOptions(policyDef("professional_career_categories") as OptionsPolicy, published.get(policyPath("professional_career_categories"))),
  };
}

export type ProfessionalEvaluationPolicy = {
  scopes: ScopeKind[]; confidenceFactors: ConfidenceFactor[]; rules: RecommendationRule[]; templates: ContextOption[];
  sufficiency: number; recencyDays: number; periodDays: number; historyShown: number;
  sharing: "offer" | "off"; ai: "on" | "off"; aiReflections: "off"; corrections: "linked" | "off";
};

function resolveProfessionalEvaluation(published: Map<string, any>): ProfessionalEvaluationPolicy {
  const set = (key: SetPolicyKey) => clampSet(policyDef(key) as SetPolicy, published.get(policyPath(key)));
  const int = (key: IntPolicyKey) => clampInt(policyDef(key) as IntPolicy, published.get(policyPath(key)));
  const choice = (key: ChoicePolicyKey) => clampChoice(policyDef(key) as ChoicePolicy, published.get(policyPath(key)));
  const scopes = set("professional_evaluation_scopes") as ScopeKind[];
  return {
    // "My development as a whole" is always offered: the workspace must stay useful with every other scope off.
    scopes: scopes.includes("development") ? scopes : ["development", ...scopes],
    confidenceFactors: set("professional_evaluation_confidence_factors") as ConfidenceFactor[],
    rules: set("professional_evaluation_recommendation_rules") as RecommendationRule[],
    templates: clampOptions(policyDef("professional_evaluation_templates") as OptionsPolicy, published.get(policyPath("professional_evaluation_templates"))),
    sufficiency: int("professional_evaluation_sufficiency"), recencyDays: int("professional_evaluation_recency_days"),
    periodDays: int("professional_evaluation_period_days"), historyShown: int("professional_evaluation_history_shown"),
    sharing: choice("professional_evaluation_sharing") as "offer" | "off", ai: choice("professional_evaluation_ai") as "on" | "off",
    aiReflections: "off", corrections: choice("professional_evaluation_corrections") as "linked" | "off",
  };
}

export const DEFAULT_POLICY: IndividualPolicy = resolvePolicy([]);

/**
 * SCHOLAR-SESSION-AI-02. Connected study sessions are on only where HQ switched them on AND migration 740 is present
 * (store.ts studySessionSchema). Either missing: off, so the feature fails closed while 740 is absent.
 */
export const isStudySessionsOn = (policy: Pick<IndividualPolicy, "scholarStudySessions">, schema740: boolean): boolean =>
  policy.scholarStudySessions === true && schema740 === true;

/** The effective policy now. Fail-soft: anything unreadable is today's constant. */
export async function loadIndividualPolicy(admin: any): Promise<IndividualPolicy> {
  try {
    const { data, error } = await admin.from("workspace_config_overrides").select("config_path, published")
      .eq("scope_type", POLICY_SCOPE.scopeType).eq("scope_ref", POLICY_SCOPE.scopeRef).like("config_path", `${POLICY_PATH_PREFIX}%`);
    return error ? DEFAULT_POLICY : resolvePolicy(data ?? []);
  } catch { return DEFAULT_POLICY; }
}

/**
 * The Individual AI hourly check: the estate quota (src/lib/ai/quota.ts, unchanged) AND the Individual
 * limit, whichever is tighter. Same `used` count, because it is the same person's AI use.
 *
 * ⚠ FAILS CLOSED. When the count could not be read (`unreadable`), the estate quota still answers ok (it
 * treats the limit as protection); Individual does not. An unreadable count is a refusal here, with
 * `unreadable` set so the route can say "could not be checked" rather than "limit reached".
 *
 * AI FAIR USE PER PLAN (P1 Commercial): `plan` is individualPlanAiLimit's answer (src/lib/individual/commerce.ts).
 * A live paid plan that sets its own limit replaces the policy base for that person -- already clamped to
 * the Individual hard limit -- and the estate limit still applies. `off` and `none` change nothing, and a
 * plan that could not be read is refused exactly like an unreadable count.
 */
export function individualAiQuota(estate: { ok: boolean; used: number; limit: number; unreadable?: boolean }, policy: IndividualPolicy, plan: PlanAiLimit = { state: "off" }) {
  const limit = Math.min(estate.limit, plan.state === "limit" ? plan.limit : policy.aiHourlyLimit);
  const unreadable = estate.unreadable === true || plan.state === "unreadable";
  return { ok: !unreadable && estate.ok && estate.used < limit, used: estate.used, limit, unreadable };
}

/** What an Individual AI route answers when its quota refuses: 503 when unreadable, 429 at the limit. */
export function individualQuotaRefusal(quota: { ok: boolean; limit: number; unreadable: boolean }, noun = "AI requests"): { status: number; error: string } | null {
  if (quota.unreadable) return { status: 503, error: "Your AI allowance could not be checked just now, so nothing was sent. Try again shortly." };
  if (!quota.ok) return { status: 429, error: `You have reached the limit of ${quota.limit} ${noun} an hour. Try again later.` };
  return null;
}

/** COMPETEN-SCHOLAR-EXAM-PAPERS-01 (570). Web research is on only with "web" among the sources AND a provider chosen. */
function resolveScholarExams(published: Map<string, unknown>): ScholarExamPolicy {
  const choice = (key: ChoicePolicyKey) => clampChoice(policyDef(key) as ChoicePolicy, published.get(policyPath(key)));
  const int = (key: IntPolicyKey) => clampInt(policyDef(key) as IntPolicy, published.get(policyPath(key)));
  const domains = clampOptions(policyDef("scholar_exam_web_domains") as OptionsPolicy, published.get(policyPath("scholar_exam_web_domains")))
    .map(o => o.label.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter(d => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d));
  return {
    enabled: choice("scholar_exam_papers") === "on",
    sources: clampSet(policyDef("scholar_exam_evidence_sources") as SetPolicy, published.get(policyPath("scholar_exam_evidence_sources"))) as ExamEvidenceSource[],
    webProvider: choice("scholar_exam_web_provider") as "none" | "anthropic_web_search",
    depth: choice("scholar_exam_research_depth") as ExamResearchDepth,
    domains: [...new Set(domains)],
    webDailyMax: int("scholar_exam_web_daily_max"),
    cacheDays: int("scholar_exam_research_cache_days"),
    scannedPages: choice("scholar_exam_scanned_pages") as "off" | "ai_transcription",
  };
}

/** SCHOLAR-PRACTICE-EXAMS-01 (720). The bounds made coherent: the fewest never above the most. */
function resolveScholarOsce(published: Map<string, unknown>): ScholarOscePolicy {
  const int = (key: IntPolicyKey) => clampInt(policyDef(key) as IntPolicy, published.get(policyPath(key)));
  const max = int("scholar_osce_checklist_max");
  return {
    enabled: clampChoice(policyDef("scholar_osce") as ChoicePolicy, published.get(policyPath("scholar_osce"))) === "on",
    durationMinutes: int("scholar_osce_duration_minutes"),
    checklistMin: Math.min(int("scholar_osce_checklist_min"), max),
    checklistMax: max,
  };
}

/** COMPETEN-RESEARCH-01. Scholar's own settings. Whether research can run is the engine's (src/lib/holdings/research). */
function resolveScholarResearch(published: Map<string, unknown>): ScholarResearchPolicy {
  const int = (key: IntPolicyKey) => clampInt(policyDef(key) as IntPolicy, published.get(policyPath(key)));
  const chosen = clampSet(policyDef("scholar_learn_source_modes") as SetPolicy, published.get(policyPath("scholar_learn_source_modes"))) as LearnSourceMode[];
  return { modes: LEARN_SOURCE_MODES.filter(m => m === "notes" || chosen.includes(m)), dailyMax: int("scholar_research_daily_max"), dailyCostCents: int("scholar_research_daily_cost_cents") };
}

/** SCHOLAR-SQIE-02. Evidence recovery as configured: the enabled sources, in priority order. */
function resolveScholarRecovery(published: Map<string, unknown>): ScholarRecoveryPolicy {
  const int = (key: IntPolicyKey) => clampInt(policyDef(key) as IntPolicy, published.get(policyPath(key)));
  const choice = (key: ChoicePolicyKey) => clampChoice(policyDef(key) as ChoicePolicy, published.get(policyPath(key)));
  const enabled = clampSet(policyDef("scholar_recovery_providers") as SetPolicy, published.get(policyPath("scholar_recovery_providers")));
  const order = clampSequence(policyDef("scholar_recovery_provider_order") as SequencePolicy, published.get(policyPath("scholar_recovery_provider_order")));
  // A source enabled but left out of the order still counts, last.
  const providers = [...order.filter(p => enabled.includes(p)), ...enabled.filter(p => !order.includes(p))] as RecoveryProvider[];
  return {
    defaultMode: choice("scholar_recovery_default_mode") as RecoveryMode, external: choice("scholar_recovery_external") as "off" | "offer",
    providers, maxResults: int("scholar_recovery_max_results"), timeoutMs: int("scholar_recovery_timeout_ms"),
    evidenceIndexed: choice("scholar_recovery_evidence_indexed") as ScholarRecoveryPolicy["evidenceIndexed"],
    evidenceTypes: clampSet(policyDef("scholar_recovery_evidence_types") as SetPolicy, published.get(policyPath("scholar_recovery_evidence_types"))) as RecoveryEvidenceType[],
    evidenceOnTopic: choice("scholar_recovery_evidence_on_topic") as ScholarRecoveryPolicy["evidenceOnTopic"],
  };
}

/** COMPETEN-RESEARCH-01 ADDENDUM V2: the modes a learner is SHOWN. An inactive mode is never shown as available. */
export const shownLearnModes = (p: ScholarResearchPolicy, researchOperational: boolean): LearnSourceMode[] =>
  p.modes.filter(m => m !== "research" || researchOperational);
