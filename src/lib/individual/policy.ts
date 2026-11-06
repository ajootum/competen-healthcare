/* eslint-disable @typescript-eslint/no-explicit-any */
import { cache } from "react";
import type { PlanAiLimit } from "./commerce";
import { REMINDER_HORIZON_DAYS } from "./professional/vocabulary";
import { SHARE_DAYS_MAX } from "./professional/share";
import {
  CLASSIC_LEARN_ACTIONS, DEFAULT_UPLOAD_MB, FORMAT_LABEL, INSIGHT_MIN_ANSWERS, INSIGHT_WINDOW_DAYS, LEARN_ACTIONS, LEARN_ACTION_LABEL, MAX_MATERIALS_PER_PERSON, MAX_PDF_PAGES, MAX_PPTX_SLIDES, MAX_SESSION_FILES, MAX_SESSION_MB, MAX_UPLOAD_BYTES, QUESTIONS_PER_REQUEST, REVISION_FORMATS, REVISION_FORMAT_LABEL, REVISION_MODES, REVISION_MODE_LABEL, REVISION_QUANTITY_MAX, ADAPTIVE_FORMATS, ADAPTIVE_LENGTH_MAX, ADAPTIVE_LENGTH_MIN, REVISION_FORMATS_OFF_BY_DEFAULT,
  SESSION_MAX_STEPS, TUTOR_MAX_TURNS, UPLOAD_SESSION_MINUTES, CASE_CONTEXTS, CASE_CONTEXT_LABEL, CASE_ENTRIES, CASE_ENTRY_LABEL, CASE_DIMENSION_LABEL,
  type CaseContext, type CaseEntry,
  VERIFY_FORMATS, VERIFY_FORMATS_DEFAULT, VERIFY_FORMAT_LABEL, type VerifyFormat,
  type AdaptiveFormat, type ExplanationDepth, type LearnAction, type RevisionDifficulty, type RevisionFormat, type RevisionMode, type UploadFormat,
} from "./scholar/config";
import { STUDY_ACHIEVEMENT, STUDY_ACHIEVEMENT_KINDS, type StudyAchievementKind } from "./scholar/passport-items";
import { COUNTRIES } from "../countries";
import { PARTICIPATION_CATEGORIES, isParticipationCategory, type ParticipationCategory } from "../hq/account-participation";
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
  | "scholar_adaptive_length" | "scholar_adaptive_max_length" | "scholar_flashcards_per_generation" | "scholar_flashcard_deck_max" | "scholar_learn_inline_recall_min_words"
  | "scholar_monthly_review_min_questions" | "scholar_monthly_review_max_questions" | "scholar_monthly_review_per_section" | "scholar_monthly_review_recommend_days"
  | "scholar_monthly_review_max_new"
  | "scholar_lesson_visuals_max_per_section" | "scholar_lesson_visuals_min_px" | "scholar_visual_text_words"
  | "scholar_plan_section_minutes" | "scholar_plan_max_weekly_minutes" | "scholar_learn_deeper_rounds_max" | "scholar_next_best_action_max"
  | "scholar_learning_state_min_evidence" | "scholar_learning_state_distinct_questions" | "scholar_learning_state_delay_days" | "scholar_learning_state_stale_days"
  | "scholar_adaptive_reteach_max" | "scholar_adaptive_prerequisite_misses"
  | "scholar_retrieval_misconception_percent" | "scholar_retrieval_exam_buffer_days" | "scholar_retrieval_minutes_per_topic" | "scholar_retrieval_share_percent"
  | "scholar_transfer_questions";
export type SetPolicyKey = "passport_achievement_kinds" | "scholar_onboarding_fields" | "professional_registration_required" | "professional_document_kinds"
  | "professional_verification_kinds" | "professional_reminder_kinds" | "professional_reminder_offsets" | "professional_reminder_standings" | "professional_share_sections"
  | "professional_need_sources" | "professional_competency_share_parts" | "passport_shareable_kinds" | "scholar_upload_formats" | "scholar_learning_actions"
  | "scholar_revision_formats" | "scholar_verify_formats" | "scholar_revision_modes" | "scholar_case_contexts" | "scholar_case_entries" | "scholar_case_dimensions"
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
  | "professional_self_assessment_fields" | "passport_sections" | "scholar_recovery_provider_order" | "scholar_plan_rule_order";
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
  | "scholar_calculation_tolerances" | "scholar_clinical_scoring_caps"
  | "scholar_case_generation" | "scholar_case_mode" | "scholar_case_reasoning_feedback" | "scholar_case_conversation" | "scholar_case_conversation_turns"
  | "scholar_case_deterioration" | "scholar_case_debrief_review" | "scholar_case_attempt_delete" | "scholar_evaluation_recommendations"
  | "scholar_exam_papers" | "scholar_exam_web_provider" | "scholar_exam_research_depth" | "scholar_exam_scanned_pages" | "scholar_material_image_slides"
  | "scholar_progress_period" | "scholar_passport_evaluations"
  | "professional_evaluation_sharing" | "professional_evaluation_ai" | "professional_evaluation_ai_reflections" | "professional_evaluation_corrections"
  | "professional_progress_default_period" | "professional_documents_ai" | "professional_global_search" | "scholar_recovery_default_mode" | "scholar_recovery_external"
  | "scholar_recovery_evidence_indexed" | "scholar_recovery_evidence_on_topic" | "scholar_recovery_sufficiency" | "scholar_research_relevance"
  | "scholar_osce" | "scholar_adaptive_exams" | "scholar_flashcards" | "scholar_flashcard_difficulty" | "scholar_flashcard_level_mix"
  | "scholar_study_sessions" | "scholar_learn_prepare_next" | "scholar_go_deeper_structured" | "scholar_mistake_notebook" | "scholar_study_plan" | "scholar_case_contribution"
  | "scholar_global_search" | "scholar_question_offering" | "scholar_question_offer_days" | "scholar_learning_library" | "scholar_next_best_action" | "scholar_active_notebook" | "scholar_search_history"
  | "scholar_monthly_review" | "scholar_monthly_review_mix" | "scholar_monthly_review_reminders" | "scholar_monthly_review_optout" | "scholar_study_calendar"
  | "scholar_learn_inline_recall" | "scholar_learn_inline_recall_placement" | "scholar_learn_inline_checks" | "scholar_learn_inline_application" | "scholar_learn_inline_skippable" | "scholar_learn_check_placement"
  | "scholar_learn_check_required" | "scholar_learn_save_missed_cards" | "scholar_learn_check_every"
  | "scholar_learn_style_guide" | "scholar_learn_style_challenge" | "scholar_learn_more_menu"
  | "scholar_lesson_visuals" | "scholar_visual_classify"
  | "scholar_my_plan" | "scholar_plan_proposal" | "scholar_plan_weekly_reflection" | "scholar_plan_started_signal"
  | "scholar_learning_state" | "scholar_adaptive_teaching"
  | "scholar_retrieval_schedule" | "scholar_prerequisite_suggestions" | "scholar_transfer_checks"
  | "scholar_application_evidence" | "scholar_competency_evidence_views";
/** PRIVATE MODULE DEVELOPMENT ACCESS (owner GO 2 Nov 2026): who may see a Scholar module that is still being developed. */
export type ModuleAccessPolicyKey = "scholar_module_courses_access" | "scholar_module_competencies_access";
/** CHECKLIST STUDIO S3: which assessment instruments (by permanent code) Scholar offers a learner. Empty by default: nothing is offered. */
export type InstrumentCodesPolicyKey = "scholar_assessment_instruments";
export type PolicyKey = IntPolicyKey | SetPolicyKey | CataloguePolicyKey | ChoicePolicyKey | ProgrammesPolicyKey | OptionsPolicyKey | LevelsPolicyKey | SequencePolicyKey | ModuleAccessPolicyKey | InstrumentCodesPolicyKey;

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
/** Who may see one Scholar module: stored as account ids and participation categories, never as emails or names. */
export type ModuleAccessPolicy = Common & { key: ModuleAccessPolicyKey; kind: "module_access"; maxUsers: number };
/** Instrument codes (asmt_instrument.code). The route checks each against the library; every read narrows to the published ones again. */
export type InstrumentCodesPolicy = Common & { key: InstrumentCodesPolicyKey; kind: "instrument_codes"; max: number };
export type PolicyDef = IntPolicy | SetPolicy | CataloguePolicy | ChoicePolicy | ProgrammesPolicy | OptionsPolicy | LevelsPolicy | SequencePolicy | ModuleAccessPolicy | InstrumentCodesPolicy;
export const MODULE_ACCESS_MODES = ["private", "pilot", "public"] as const;
export type ModuleAccessMode = (typeof MODULE_ACCESS_MODES)[number];
export type ModuleAccess = { mode: ModuleAccessMode; users: string[]; groups: ParticipationCategory[] };
export const MODULE_ACCESS_MAX_USERS = 50;
export const MODULE_ACCESS_MODE_LABEL: Record<ModuleAccessMode, string> = { private: "Private development", pilot: "Pilot", public: "Public" };
export const MODULE_ACCESS_MODE_MEANING: Record<ModuleAccessMode, string> = {
  private: "Only the accounts listed can see it. Nobody else sees any sign of it.",
  pilot: "The accounts listed, and every account in the participation categories chosen, can see it.",
  public: "Everyone who has Competen Scholar can see it.",
};
/** FAIL CLOSED: nothing stored, or anything unreadable, is private to nobody. */
export const MODULE_ACCESS_CLOSED: ModuleAccess = { mode: "private", users: [], groups: [] };
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
export const INSTRUMENT_CODES_MAX = 20;
/** The permanent shape of an instrument code (migration 890 asmt_instrument_code_check). */
export const INSTRUMENT_CODE = /^[A-Z][A-Z0-9-]{2,40}$/;
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
  /** SCHOLAR-RESEARCH-RELEVANCE-01: how closely a published item must match the lesson to be shown. Missing = standard. */
  relevance?: "strict" | "standard";
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
  /** SCHOLAR-PAI-RESEARCH-01: the share of a question's key terms the evidence must cover to count as sufficient (0.5, 0.6 or 0.7). */
  sufficiency: number;
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

// SCHOLAR-MONTHLY-REVIEW-01 (owner GO, 1 Nov 2026): the monthly learning review and the study calendar. One contiguous block.
// The review is OPTIONAL and formative: it is recommended, never required, and nothing waits on it. The calendar is a view.
const SCHOLAR_MONTHLY_POLICIES: readonly PolicyDef[] = [
  {
    key: "scholar_monthly_review", kind: "choice", product: "Scholar",
    label: "Monthly learning review",
    help: "Whether Evaluate offers a short optional review of what the student studied in a calendar month: a balanced test of questions from the sections they actually worked on, with feedback at the end and topic-level results. It is recommended, never required. Formative practice only: never verified competence.",
    options: [{ value: "on", label: "Offer the review" }, { value: "off", label: "Do not offer" }],
    fallback: "on",
    limitReason: "Needs no migration. Stored questions are used first. New ones are written only where revision generation, the student's AI consent and their allowance permit. Default: offered.",
  },
  {
    key: "scholar_monthly_review_min_questions", kind: "int", product: "Scholar", unit: "questions",
    label: "Monthly review: fewest questions",
    help: "A review is never shorter than this when enough questions can be found. Where fewer can be found (no AI, few stored questions) a shorter review is run and says so.",
    fallback: 10, min: 3, max: 50,
    limitReason: "Three to fifty, and never above the most questions. Default: ten.",
  },
  {
    key: "scholar_monthly_review_max_questions", kind: "int", product: "Scholar", unit: "questions",
    label: "Monthly review: most questions",
    help: "A review is never longer than this, however many sections the student worked on.",
    fallback: 30, min: 5, max: 50,
    limitReason: "Five to fifty (the revision session limit). Default: thirty.",
  },
  {
    key: "scholar_monthly_review_per_section", kind: "int", product: "Scholar", unit: "questions",
    label: "Monthly review: questions per section",
    help: "The length of a review is the number of sections the student worked on in the month times this, held between the fewest and the most questions.",
    fallback: 2, min: 1, max: 5,
    limitReason: "One to five. Default: two.",
  },
  {
    key: "scholar_monthly_review_max_new", kind: "int", product: "Scholar", unit: "questions",
    label: "Monthly review: most new questions written when it starts",
    help: "Where the student has too few stored questions, at most this many new ones are written (through the existing revision route, its consent, allowance and checks) when a review starts. The rest of the review is shorter, and it says so. Keeps the start quick and the AI cost bounded.",
    fallback: 10, min: 0, max: 30,
    limitReason: "Zero (stored questions only) to thirty. Default: ten.",
  },
  {
    key: "scholar_monthly_review_mix", kind: "choice", product: "Scholar",
    label: "Monthly review: balance of questions",
    help: "The share of a review that is core knowledge, application (scenario and case-step questions) and previously identified gaps (questions the student missed before). A kind with nothing stored for it hands its share to core knowledge, and the review says so.",
    options: [
      { value: "60_25_15", label: "Core 60%, application 25%, gaps 15%" },
      { value: "50_30_20", label: "Core 50%, application 30%, gaps 20%" },
      { value: "70_20_10", label: "Core 70%, application 20%, gaps 10%" },
      { value: "40_30_30", label: "Core 40%, application 30%, gaps 30%" },
    ],
    fallback: "60_25_15",
    limitReason: "Four fixed balances that each add up to a whole. Default: core 60, application 25, gaps 15.",
  },
  {
    key: "scholar_monthly_review_recommend_days", kind: "int", product: "Scholar", unit: "days",
    label: "Monthly review: days before month end it is recommended",
    help: "The calendar marks the recommended date for the review this many days before the end of the month. The student can move it, and can take the review any time, including after the month ends.",
    fallback: 5, min: 0, max: 20,
    limitReason: "Zero to twenty days. Default: five.",
  },
  {
    key: "scholar_monthly_review_reminders", kind: "choice", product: "Scholar",
    label: "Monthly review: in-app reminders",
    help: "Whether the calendar marks the recommended date and Progress and Evaluate show a banner when a review is due. In the app only: no email and no notification is sent.",
    options: [{ value: "on", label: "Remind in the app" }, { value: "off", label: "Do not remind" }],
    fallback: "on",
    limitReason: "In-app only. Default: remind.",
  },
  {
    key: "scholar_monthly_review_optout", kind: "choice", product: "Scholar",
    label: "Monthly review: students may opt out of suggestions",
    help: "Whether a student may choose not to be shown monthly review suggestions. Their choice is kept with their study calendar settings and is theirs to undo.",
    options: [{ value: "allowed", label: "Students may opt out" }, { value: "not_allowed", label: "Always suggest" }],
    fallback: "allowed",
    limitReason: "Keeping the choice needs migration 830. Without it the option is hidden. Default: allowed.",
  },
  {
    key: "scholar_study_calendar", kind: "choice", product: "Scholar",
    label: "Study calendar",
    help: "Whether Progress shows a month calendar of the student's planned study, cards due for revision, what they completed and the monthly review. A view of existing records: moving a planned activity or the review changes the plan only, never when a card is due.",
    options: [{ value: "on", label: "Offer the calendar" }, { value: "off", label: "Do not offer" }],
    fallback: "on",
    limitReason: "Moving planned activities and the review needs migration 830. Without it the calendar is shown without a Move button. Default: offered.",
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
  // ── PRIVATE MODULE DEVELOPMENT ACCESS ── owner GO "COMPETEN SCHOLAR -- Private Module Development Access" ──
  // Courses & Training and My Competencies are built but not released. Nothing published means PRIVATE TO NOBODY: a
  // module is seen only by the accounts named here (or, in Pilot, by a participation category), always IN ADDITION to
  // the person's Scholar entitlement, never instead of it. My Learning and the shared links are not governed here.
  {
    key: "scholar_module_courses_access", kind: "module_access", product: "Scholar", maxUsers: MODULE_ACCESS_MAX_USERS,
    label: "Courses & Training access",
    help: "Who can see Courses & Training in Competen Scholar. Private development: only the accounts listed. Pilot: the accounts listed and every account in the chosen participation categories. Public: everyone who has Scholar.",
    limitReason: "At most 50 named accounts. Accounts are stored by id. Default: private, with nobody listed, so the module is hidden from everyone until HQ opens it.",
  },
  {
    key: "scholar_module_competencies_access", kind: "module_access", product: "Scholar", maxUsers: MODULE_ACCESS_MAX_USERS,
    label: "My Competencies access",
    help: "Who can see My Competencies in Competen Scholar. Private development: only the accounts listed. Pilot: the accounts listed and every account in the chosen participation categories. Public: everyone who has Scholar.",
    limitReason: "At most 50 named accounts. Accounts are stored by id. Default: private, with nobody listed, so the module is hidden from everyone until HQ opens it.",
  },
  // ── CHECKLIST STUDIO S3: WHICH ASSESSMENT INSTRUMENTS SCHOLAR OFFERS ── owner decision D10, 3 Nov 2026 ──
  // EMPTY UNTIL HQ CHOOSES, and unreadable is empty too: no instrument reaches a learner by existing. A listed code is offered only
  // while the instrument has a published version that allows self-assessment (checked on every read, never trusted from here).
  {
    key: "scholar_assessment_instruments", kind: "instrument_codes", product: "Scholar", max: INSTRUMENT_CODES_MAX,
    label: "Assessment instruments Scholar may offer",
    help: "The codes of the published assessment instruments a Scholar learner may start as a self-assessment from My Competencies. Nothing is offered until a code is listed here.",
    limitReason: "Only existing instrument codes, at most 20. Empty by default: nothing is offered automatically.",
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
    limitReason: "Only the thirteen actions Scholar implements (the seven original ones and the six teaching ones). Default: all. A published set lists its actions explicitly, so a new action is off until it is ticked here.",
  },
  {
    key: "scholar_default_action", kind: "choice", product: "Scholar",
    label: "The learning action a session starts with",
    help: "What Start learning opens with. A student can switch at any time.",
    options: CLASSIC_LEARN_ACTIONS.map(v => ({ value: v, label: LEARN_ACTION_LABEL[v] })),
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
  // SCHOLAR-GUIDED-LEARNING-01 (owner, 31 Oct): prepare the NEXT lesson ahead, at most one, OFF by default. Through the same
  // metered runner, allowance and checks as a lesson the student asks for (learn/act { prepare: true }).
  {
    key: "scholar_learn_prepare_next", kind: "choice", product: "Scholar",
    label: "Prepare the next lesson ahead",
    help: "Whether Scholar may write the next lesson of a guided session in the background while the student reads the current one, so it opens at once. At most one lesson ahead, never the whole sequence, only when nothing is saved for it yet, and only while the student's AI allowance allows it. It uses the student's allowance like any lesson.",
    options: [{ value: "on", label: "Prepare one lesson ahead" }, { value: "off", label: "Off: each lesson is written when the student opens it" }],
    fallback: "off",
    limitReason: "One lesson ahead at most. Default: off, because a prepared lesson the student never opens still costs allowance.",
  },
  // SCHOLAR-GO-DEEPER-001 (owner, 6 Nov 2026): Learn's Go deeper as a structured round with three levels. Off: Go deeper is exactly as it was
  // (scholar-learn-deeper-v2). Saved rounds of either form are shown as they are whatever this says.
  {
    key: "scholar_go_deeper_structured", kind: "choice", product: "Scholar",
    label: "Learn: structured Go deeper",
    help: "Whether Go deeper teaches one major concept as a structured round: a focus question, sections that say whether they come from the student's notes or are Scholar's own explanation, misconceptions and limits, a reasoning check and takeaways, at three levels (Understand, Explore, Advanced). One AI call a round, as before. Published research is used only through the existing research controls. Off: Go deeper is as it was. Saved rounds are never changed.",
    options: [{ value: "on", label: "Structured rounds" }, { value: "off", label: "Off: Go deeper as it was" }],
    fallback: "off",
    limitReason: "Default: off until the owner activates it.",
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
    fallback: REVISION_FORMATS.filter(f => !REVISION_FORMATS_OFF_BY_DEFAULT.includes(f)),
    limitReason: "Only the formats migrations 416 and 710 store. Structured (multi-part) is offered only where 710 is applied. An evolving scenario is stored as a short answer (no migration), needs feedback after each answer, and is OFF by default (SCHOLAR-AI-COST-CONFIG-01, owner 3 Nov 2026: written on the stronger model, so chosen deliberately, never by default). Extended response is marked by AI on every answer, so it is off until ticked. Default: all but extended response and evolving scenario. The formats themselves are described in one place (scholar/question-formats.ts).",
  },
  {
    // SCHOLAR-SQIE-LEARNER-01: the formats whose new questions get a second, blind reader (a model that is not told the key and
    // answers the item; a disagreement or an unreadable verdict drops it). Each ticked format costs one more AI call per batch
    // written, on the same allowance. The default is exactly what ran before this setting existed.
    key: "scholar_verify_formats", kind: "set", product: "Scholar",
    label: "Blind check before storing new questions",
    help: "Which question formats get a second reader before a new question is stored. The reader sees the passage and the question but not the answer, and the question is kept only if it answers it the same way. Each format ticked here costs one more AI call per batch of questions written. A format that is not ticked is stored on its automatic checks alone.",
    options: VERIFY_FORMATS.map(v => ({ value: v, label: VERIFY_FORMAT_LABEL[v] })),
    fallback: [...VERIFY_FORMATS_DEFAULT],
    limitReason: "Only the formats Scholar can check. Default: multiple choice, case questions, multiple response and short answer, as before.",
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
  // ── SQIE-CLOSE-2026-11 WS-A: CALCULATION QUESTIONS (scoring-rules.ts; owner decision 4 Nov 2026, item 1) ──
  // ⚠ OWNER / CLINICAL DECISION: non-zero tolerances stay INACTIVE for clinical calculations until the clinical calculation policy is
  // approved. Until then every calculation is an exact match (with its question-defined rounding and validated equivalent units). A tenfold
  // or greater error is unsafe whatever this says: that check never depends on tolerance.
  // ── SQIE-CLOSE-2026-11 WS-B: THE CLINICAL SCORING CAPS (scoring-rules.ts rules v3; owner release decision 4 Nov 2026) ──
  // ⚠ OWNER / CLINICAL DECISION: the caps (an unsafe response at most 50% of the applicable score, a safety-critical failure 0%, each at the
  // scope the approved rubric defines) become active only after clinical approval of the safety-critical classifications. Until then the
  // flags are still detected, recorded and shown; only the marks wait.
  {
    key: "scholar_clinical_scoring_caps", kind: "choice", product: "Scholar",
    label: "Clinical scoring caps",
    help: "Whether an unsafe response (at most half the marks of that part, stage or item) and a missed or wrong safety-critical point (no marks for that part, stage or item) change practice marks. Turn on only once the safety-critical classifications are clinically approved. Off: the answer is still flagged and explained.",
    options: [{ value: "off", label: "Off: flag and explain only (until clinical approval)" }, { value: "on", label: "On: apply the caps at the rubric's scope" }],
    fallback: "off",
    limitReason: "Clinical approval of the safety-critical classifications required before on. Never applied to unrelated parts. Default: off.",
  },
  {
    key: "scholar_calculation_tolerances", kind: "choice", product: "Scholar",
    label: "Calculation tolerances",
    help: "Whether the absolute or percentage tolerance a calculation question sets is used. Off: every calculation must be exact. Turn on only once the clinical calculation policy is approved.",
    options: [{ value: "off", label: "Off: exact answers only (until the clinical calculation policy is approved)" }, { value: "on", label: "On: use each question's own tolerance" }],
    fallback: "off",
    limitReason: "Clinical calculation policy approval required before on. A tenfold error is unsafe either way. Default: off.",
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
  // SCHOLAR-LIBRARY-01 (owner, 1 Nov 2026): the personal library on Saved learning. Stored records only, no AI, no cost.
  {
    key: "scholar_learning_library", kind: "choice", product: "Scholar",
    label: "Personal learning library",
    help: "Whether Saved learning offers the student's own library: views (recently studied, continue, completed, saved for revision), filters, deterministic search over their saved teaching, notes, sessions and flashcards, earlier versions kept on refresh, their own notes, bookmarks and highlights, and PDF export of what they choose. Reads stored records only: no AI. Private to the student, never shared.",
    options: [{ value: "on", label: "Offer the library" }, { value: "off", label: "Do not offer" }],
    fallback: "on",
    limitReason: "Search, notes, kept versions and lesson links need migration 820. Without it, the library still lists and filters saved teaching, and search is a basic match over the newest 500. Default: offered.",
  },
  // SALE-2026-11 R3 (SALE-11, SALE-12): the learning workspace. New learner features, so OFF until HQ turns them on. No AI, no cost.
  {
    key: "scholar_next_best_action", kind: "choice", product: "Scholar",
    label: "My Plan: next best learning actions",
    help: "Whether Today in My Plan suggests a few next learning ACTIONS (review a misconception, a short retrieval exercise, apply it in a case, continue an unfinished lesson, revisit a prerequisite), each with a short reason from the learner's own records, goals, exam and placement dates, available time and priorities. Every suggestion can be added to today, snoozed or dismissed, and the choice is recorded. Nothing changes the plan unless the learner adds it.",
    options: [{ value: "on", label: "Suggest them" }, { value: "off", label: "Do not suggest" }],
    fallback: "off",
    limitReason: "Deterministic rules over existing records: no AI. Accept, snooze and dismiss need migration 975 (without it the suggestions are shown read only). Default: off.",
  },
  {
    key: "scholar_next_best_action_max", kind: "int", product: "Scholar", unit: "suggestions",
    label: "My Plan: next best learning actions shown at once",
    help: "How many next learning actions Today shows at once, best first.",
    fallback: 3, min: 1, max: 5,
    limitReason: "One to five. Default: three.",
  },
  {
    key: "scholar_active_notebook", kind: "choice", product: "Scholar",
    label: "Library: the active Notebook",
    help: "Whether the learning library offers the Notebook: the learner's own annotations and personal summaries, past misconceptions to revisit, related materials for each note, practice made from selected notes (through the existing Revise question generation and its routing), and a way back to the Notebook from the lesson or question they open. Learner-owned and private; citations are kept.",
    options: [{ value: "on", label: "Offer the Notebook" }, { value: "off", label: "Do not offer" }],
    fallback: "off",
    limitReason: "Personal summaries need migration 975 (without it the Notebook works without them). Practice uses the existing Revise generation, allowance and model routing unchanged. Default: off.",
  },
  // SCHOLAR-SEARCH-HISTORY-01 (owner directive 4 Nov 2026, P1, SALE learner continuity): My Search History in the library.
  {
    key: "scholar_global_search", kind: "choice", product: "Scholar",
    label: "Search: Global Search across Scholar",
    help: "Whether the Scholar header offers Global Search: one box that searches the learner's own materials, notes, sessions, saved learning, practice, evaluations and plan, and the competencies of their framework, grouped by where each result belongs. No AI. Each search box on a page is there either way.",
    options: [{ value: "on", label: "Offer Global Search" }, { value: "off", label: "Do not offer" }],
    fallback: "off",
    limitReason: "Reads only the signed-in learner's own records, and only the modules they may open. What is typed is kept only where My Search History is on, and only when a result is chosen. Default: off.",
  },
  {
    key: "professional_global_search", kind: "choice", product: "Professional",
    label: "Search: Global Search across Professional",
    help: "Whether the Professional header offers Global Search: one box that searches the professional's own competencies, evidence, CPD, development goals and needs, and registration, grouped by where each result belongs. No AI. Each search box on a page is there either way.",
    options: [{ value: "on", label: "Offer Global Search" }, { value: "off", label: "Do not offer" }],
    fallback: "off",
    limitReason: "Reads only the signed-in professional's own records, and nothing from Scholar. What is typed is not kept. Default: off.",
  },
  {
    key: "scholar_search_history", kind: "choice", product: "Scholar",
    label: "Library: My search history",
    help: "Whether the learning library offers My search history: one private, searchable list of the learner's own submitted searches and Ask Scholar questions, with their saved teaching and lessons, newest first, filtered by activity, material, topic and date. Saved answers reopen as saved (no AI). The learner can pin, save for revision, remove one entry or clear it all. Offering it starts it for each learner once they have seen a one-time notice, on by default and apart from AI help. Nothing is kept before they have seen it, and a learner who turns it off stays off. No HQ surface reads it, and it is never used as AI memory.",
    options: [{ value: "on", label: "Offer search history" }, { value: "off", label: "Do not offer" }],
    fallback: "off",
    limitReason: "Needs migration 992 (without it the history says it is not available yet and records nothing). Keeps the learner's words and references, never an answer. Kept until the learner deletes it. Default: off.",
  },
  // SCHOLAR-INLINE-CHECKS-01 (owner GO, 1 Nov 2026): short checks INSIDE the scrolling lesson. No new stage, engine or AI call: the
  // recall card reads the saved lesson, the quick check reads a stored question (writing one stays the learner's click), the
  // application check is the existing Apply link. Self-rated recall, code-marked checks and verified competence stay distinct.
  {
    key: "scholar_learn_inline_recall", kind: "choice", product: "Scholar",
    label: "Recall card inside a lesson",
    help: "Whether a lesson shows a short \"Check your recall\" card after its teaching: a question from the saved lesson, the learner turns it over and rates their own recall. Built from the saved lesson, so it uses no AI. Self-rated, not a test score.",
    options: [{ value: "on", label: "Show recall cards" }, { value: "off", label: "Do not show" }],
    fallback: "on",
    limitReason: "Only a lesson that already holds a check question or key points gets a card. Nothing is generated. Default: on.",
  },
  {
    key: "scholar_learn_inline_recall_placement", kind: "choice", product: "Scholar",
    label: "Where optional recall cards appear",
    help: "Used when the end-of-lesson recall check is optional (the required check follows the setting for how often it comes). After a substantial lesson (long enough, see the length below), after every lesson, or once after the last lesson.",
    options: [{ value: "substantial", label: "After a substantial lesson" }, { value: "every_lesson", label: "After every lesson" }, { value: "lesson_end", label: "Once, after the last lesson" }],
    fallback: "substantial",
    limitReason: "At most one recall card per lesson, and only where the saved lesson holds a question. Default: after a substantial lesson.",
  },


  {
    key: "scholar_learn_inline_recall_min_words", kind: "int", product: "Scholar", unit: "words",
    label: "A substantial lesson has at least",
    help: "A lesson counts as substantial for recall cards when its teaching text has at least this many words.",
    fallback: 180, min: 40, max: 1000,
    limitReason: "Forty to a thousand words. Used only when recall cards appear after a substantial lesson. Default: 180.",
  },
  {
    key: "scholar_learn_inline_checks", kind: "choice", product: "Scholar",
    label: "Quick knowledge check inside a lesson",
    help: "Whether a lesson offers a collapsed \"Quick check: 1 question\": a question already stored for the lesson's section, marked by code against the stored answer. Writing a new question remains the student's own click and uses their AI allowance. Formative, not verified competence.",
    options: [{ value: "on", label: "Offer the quick check" }, { value: "off", label: "Do not offer" }],
    fallback: "on",
    limitReason: "Uses stored questions first. A missed question reaches the mistake notebook and Revise as it already does. Default: on.",
  },
  {
    // LEARNING-CLOSE-2026-11 WS01 CYU-01: where a lesson's own check questions (Teach Me writes at most two) are shown.
    key: "scholar_learn_check_placement", kind: "choice", product: "Scholar",
    label: "Where a lesson's understanding checks appear",
    help: "A substantial lesson with two check questions shows the first after its teaching paragraphs and the second at the end, following the teaching sequence. A short lesson, or one question, keeps the check at the end. Checks are optional and never block reading.",
    options: [{ value: "distributed", label: "Distributed through the lesson" }, { value: "lesson_end", label: "All at the end of the lesson" }],
    fallback: "distributed",
    limitReason: "At most the lesson's own questions, never one per slide or paragraph. Default: distributed.",
  },
  {
    key: "scholar_learn_inline_application", kind: "choice", product: "Scholar",
    label: "Application check at the end of the journey",
    help: "Whether the last lesson offers one optional \"Apply it: try a short case\" card that opens the existing clinical case practice. Offered once, after the final lesson.",
    options: [{ value: "on", label: "Offer once at the end" }, { value: "off", label: "Do not offer" }],
    fallback: "on",
    limitReason: "The case itself is the existing Apply practice, with its own policy. Default: on.",
  },
  {
    key: "scholar_learn_check_required", kind: "choice", product: "Scholar",
    label: "End-of-lesson recall check",
    help: "Required: the next lesson and the lesson counting as complete wait until the student has revealed the answer and rated their own recall (either rating counts: it is not a pass mark). Optional: the check can be skipped. A lesson with no saved question has no check and nothing waits. It never blocks earlier lessons, navigation, saving or leaving.",
    options: [{ value: "required", label: "Required to continue" }, { value: "optional", label: "Optional" }],
    fallback: "required",
    limitReason: "Self-rated only: never a score, an assessment or verified competence. Default: required.",
  },
  {
    key: "scholar_learn_check_every", kind: "choice", product: "Scholar",
    label: "How often the required recall check comes",
    help: "The required end-of-lesson recall check comes as a block after every 1, 2 or 3 lessons (after lessons 2, 4, 6 by default), or once after the last lesson. A block always closes after the final lesson. A block holds one card for each lesson it covers, from that saved lesson's own content: nothing is generated, and a lesson with no saved question adds none.",
    options: [{ value: "1", label: "After every lesson" }, { value: "2", label: "After every 2 lessons" }, { value: "3", label: "After every 3 lessons" }, { value: "journey_end", label: "Once, after the last lesson" }],
    fallback: "2",
    limitReason: "Used while the check is required. Self-rated recall only, never a score. Default: every 2 lessons.",
  },
  {
    key: "scholar_learn_save_missed_cards", kind: "choice", product: "Scholar",
    label: "Offer to save a missed recall as a flashcard",
    help: "After \"Didn't remember\", whether \"Save as a flashcard to revise\" is ticked to begin with. The student can untick it. Saving makes their own card (no AI) when they continue or press Save.",
    options: [{ value: "on", label: "Ticked to begin with" }, { value: "off", label: "Unticked" }],
    fallback: "on",
    limitReason: "The card is the student's own, drafted from the saved lesson, with nothing generated. Default: ticked.",
  },
  {
    key: "scholar_learn_inline_skippable", kind: "choice", product: "Scholar",
    label: "Inline checks can be skipped",
    help: "Whether the student may skip an optional inline item (a recall card while the end-of-lesson check is optional, the application card). Ignored for the required end-of-lesson recall check. An inline check never blocks scrolling.",
    options: [{ value: "on", label: "Can be skipped" }, { value: "off", label: "Stays open until answered" }],
    fallback: "on",
    limitReason: "A check never blocks scrolling or the next lesson. Default: skippable.",
  },
  // SCHOLAR-COMPANION-01 P1: the mistake notebook reads the learner's own wrong attempts back. Data only, no AI, no cost.
  {
    key: "scholar_mistake_notebook", kind: "choice", product: "Scholar",
    label: "Mistake notebook",
    help: "Whether Revise and Saved learning link to the student's mistake notebook: their own wrong answers, newest first, grouped by material, with the key and the explanation already stored, and how often each was missed and whether a later answer corrected it. Reads existing answers only: no AI, no new storage. Formative practice only.",
    options: [{ value: "on", label: "Offer the mistake notebook" }, { value: "off", label: "Do not offer" }],
    fallback: "on",
    limitReason: "Reads the student's own revision answers (migrations 372 and 416). Costs nothing. Default: offered.",
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
  // SCHOLAR-COMPANION-01 (780): the study plan. OFF by default, and off in effect while migration 780 is absent
  // (isStudyPlanOn), so switching it on before 780 is applied changes nothing (CLAUDE.md Database state 3).
  {
    key: "scholar_study_plan", kind: "choice", product: "Scholar",
    label: "Study plan",
    help: "Whether a student may set an exam date, the time they have each week and their priority topics, and see a plan for the next seven days built from those and from their own practice. The plan is worked out by fixed rules, with no AI, and is a study aid: it is not an assessment of competence.",
    options: [{ value: "on", label: "Offered" }, { value: "off", label: "Not offered" }],
    fallback: "off",
    limitReason: "Needs migration 780. Without it the setting has no effect and the study plan stays off. Default: not offered.",
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
    key: "scholar_research_relevance", kind: "choice", product: "Scholar",
    label: "Research supporting a lesson: how closely it must match",
    help: "Published research is shown for a lesson only when it names the lesson's own distinctive concepts (for example Donabedian, structure process outcome), not just general words such as quality, safety or care. Standard needs two distinctive concepts or one multi-word concept. Strict needs a distinctive concept in the title and more overlap. Research below the bar is not shown at all.",
    options: [{ value: "standard", label: "Standard (default)" }, { value: "strict", label: "Strict" }],
    fallback: "standard",
    limitReason: "Standard or strict. Default: standard.",
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
    key: "scholar_recovery_sufficiency", kind: "choice", product: "Scholar",
    label: "Finding more learning resources: how much of a question the notes must cover",
    help: "The share of a question's key terms that the evidence found must contain before Scholar treats the notes as enough to explain from. Below it, the answer teaches the part the notes support and names what they do not cover. Lower is more permissive, higher is stricter.",
    options: [{ value: "0.5", label: "Half of the key terms" }, { value: "0.6", label: "Six in ten key terms (default)" }, { value: "0.7", label: "Seven in ten key terms" }],
    fallback: "0.6",
    limitReason: "One of 0.5, 0.6 or 0.7. Default: 0.6.",
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
    // SCHOLAR-UPLOAD-FIX: the same transcription runner as scanned examination pages, for a PowerPoint's picture-only
    // slides (slide-reading.ts). Learner-initiated, capped per material, labelled on every section it adds.
    key: "scholar_material_image_slides", kind: "choice", product: "Scholar",
    label: "Picture-only slides in study notes",
    help: "A PowerPoint slide that is only a picture has no text to read. Off: the material says which slides could not be read, and nothing is guessed. AI transcription: the student may ask, with their AI consent, for up to 10 such slides per material to be sent to the existing AI provider to transcribe. Each transcribed slide is screened for patient identifiers (a slide with one is not kept) and labelled as read by AI, to be checked against the slide.",
    options: [{ value: "off", label: "Say which slides could not be read" }, { value: "ai_transcription", label: "AI transcription on request (existing provider)" }],
    fallback: "off",
    limitReason: "Off by default: slide images (which may be clinical photographs) are sent to the AI provider, an owner decision.",
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
    key: "scholar_case_contribution", kind: "choice", product: "Scholar",
    label: "Offering cases to the case library",
    help: "Whether a student may allow their own cases to be considered for the shared case library and offer them one at a time. It follows the case library switch: until this is published it is on exactly where the case library is on, and off where it is off. Set Off to stop new permissions and new offers while the case library stays on for playing. A student can always withdraw a permission or an offer they made, whatever this says.",
    options: [{ value: "on", label: "Follows the case library switch" }, { value: "off", label: "Off" }],
    fallback: "on",
    limitReason: "Cannot open anything the case library switch keeps shut. Withdrawing is never blocked. Default: follows the case library switch.",
  },
  {
    // SQIE-LIBRARY-EXPANSION-01 (owner GO 31 Oct 2026, item F), migration 802.
    key: "scholar_question_offering", kind: "choice", product: "Scholar",
    label: "Offering questions to the Competen library",
    help: "Whether a student may give the separate permission to offer their own practice questions, one at a time, to the governed Competen question library, and offer them. Every offer is screened for patient details and for text copied from the student's notes, the student is never named to educators, and an educator draft from it still needs educator review, independent clinical approval and publication. Off by default. A student can always withdraw a permission or an offer they made, whatever this says. Offering never uses the student's AI allowance.",
    options: [{ value: "off", label: "Off" }, { value: "on", label: "On" }],
    fallback: "off",
    limitReason: "Off until HQ switches it on (and migration 802 is applied). Withdrawing is never blocked. Nothing is approved automatically.",
  },
  {
    // SQIE-LIBRARY-GAPS-01. Code only: an offer nobody has taken or declined expires and is withdrawn, its content purged.
    key: "scholar_question_offer_days", kind: "choice", product: "Scholar",
    label: "How long an untaken question offer waits",
    help: "How many days an offered question may wait in the educator queue. After that it is withdrawn and its content removed, as if the student had withdrawn it, and the student sees it as withdrawn. An offer an educator has already taken in is never affected.",
    options: [{ value: "30", label: "30 days" }, { value: "60", label: "60 days (default)" }, { value: "90", label: "90 days" }],
    fallback: "60",
    limitReason: "Only 30, 60 or 90 days. Applies to offers still waiting. Default 60.",
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
  {
    // SCHOLAR-CE-2026 CE-04 (owner GO 2 Nov 2026). Needs migration 880 to keep the turns. Off until HQ switches it on.
    key: "scholar_case_conversation", kind: "choice", product: "Scholar",
    label: "Talk to the patient in a case",
    help: "Whether a case that defines a patient or caregiver voice offers a Talk to the patient panel, where the student types questions and an AI answers in that person's voice using only what the case says they know at that stage. It uses the student's AI allowance (the same path as case feedback), is labelled as a simulated conversation, and the conversation is kept with the attempt for the debrief. The case works the same when it is off or the AI is unavailable.",
    options: [{ value: "off", label: "Off" }, { value: "on", label: "On" }],
    fallback: "off",
    limitReason: "Off until HQ switches it on (and migration 880 is applied). Only cases whose version defines a patient voice show the panel.",
  },
  {
    key: "scholar_case_conversation_turns", kind: "choice", product: "Scholar",
    label: "Questions allowed per case stage in Talk to the patient",
    help: "The most questions a student may ask the patient at each stage of a case. It bounds the AI cost of one case. Reaching the limit never stops the case.",
    options: [{ value: "10", label: "10" }, { value: "15", label: "15" }, { value: "20", label: "20 (default)" }, { value: "30", label: "30" }, { value: "40", label: "40" }],
    fallback: "20",
    limitReason: "Only 10, 15, 20, 30 or 40. Default 20.",
  },
  {
    // LEARNING-CLOSE-2026-11 CE-04C (SALE-13). No migration. Off until HQ switches it on.
    key: "scholar_case_deterioration", kind: "choice", product: "Scholar",
    label: "Deterioration timeline in library cases",
    help: "Whether a library case whose approved version defines a deterioration timeline plays it: the patient's observations change as simulated time passes, time moves on only with what the student does (each decision, each finding asked for, each question to the patient), and escalation is scored for recognition and timeliness. Everything in the timeline is written by the case author and clinically approved with the version; nothing is invented by AI and nothing runs on a real clock. Practice marks only, never verified competence.",
    options: [{ value: "off", label: "Off" }, { value: "on", label: "On" }],
    fallback: "off",
    limitReason: "Off until HQ switches it on. Only approved library cases that define a timeline are affected; a student's own case never has one.",
  },
  {
    // LEARNING-CLOSE-2026-11 CE-04 debrief (SALE-13). No migration. Off until HQ switches it on.
    key: "scholar_case_debrief_review", kind: "choice", product: "Scholar",
    label: "Case debrief: what went well, what was missed, what was unsafe",
    help: "Whether a finished case shows a debrief in three lists, worked out by code from the attempt: the decisions, the safety criteria, the handover marks, the findings never asked for, the escalation windows and the key questions to the patient. No AI. It is labelled as practice feedback and is never verified competence.",
    options: [{ value: "off", label: "Off" }, { value: "on", label: "On" }],
    fallback: "off",
    limitReason: "Off until HQ switches it on.",
  },
  {
    // LEARNING-CLOSE-2026-11 D05 (CE-04D). No migration: deleting the session cascades its answers, conversation (880) and kept record (810).
    key: "scholar_case_attempt_delete", kind: "choice", product: "Scholar",
    label: "Students may delete a case attempt",
    help: "Whether a student may delete one of their own case attempts. Deleting it removes the attempt with its answers, its simulated conversation and its kept record, as decision D05 requires. The case itself is not deleted.",
    options: [{ value: "off", label: "Off" }, { value: "on", label: "On" }],
    fallback: "off",
    limitReason: "Off until HQ switches it on (and any retention rule for simulation records is decided).",
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
      { value: "mastery", label: "Study next and learning progress by topic" },
    ],
    fallback: ["coverage", "understanding", "retention", "application", "engagement", "confidence", "history", "competencies", "mastery"],
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
  ...SCHOLAR_MONTHLY_POLICIES,
  // SCHOLAR-LEARN-STYLE-01 (owner GO, Teaching Style and Practice HFE redesign): three teaching styles, Explain always on. One contiguous block.
  {
    key: "scholar_learn_style_guide", kind: "choice", product: "Scholar",
    label: "Teaching style: Guide me",
    help: "Whether Learn offers \"Guide me\" (step-by-step learning with questions and prompts) as one of its three teaching styles. It runs the existing Guide action, with the same allowance and model checks. Explain is always offered.",
    options: [{ value: "on", label: "Offer Guide me" }, { value: "off", label: "Do not offer" }],
    fallback: "on",
    limitReason: "Only shown where the Guide action is also offered by the learning actions. Default: offered.",
  },
  {
    key: "scholar_learn_style_challenge", kind: "choice", product: "Scholar",
    label: "Teaching style: Challenge me",
    help: "Whether Learn offers \"Challenge me\" (questioning, teach-back and harder reasoning) as one of its three teaching styles. \"Ask me a question\" and \"Teach it back\" are its follow-on steps. Hidden, they move to the More menu. Explain is always offered.",
    options: [{ value: "on", label: "Offer Challenge me" }, { value: "off", label: "Do not offer" }],
    fallback: "on",
    limitReason: "Only shown where the Challenge action is also offered by the learning actions. Default: offered.",
  },
  {
    key: "scholar_learn_more_menu", kind: "choice", product: "Scholar",
    label: "Learn: the More menu",
    help: "Whether a lesson has a discreet \"More\" menu holding the other teaching actions (High-yield, Simplify, Summarise and the like). Explain my mistake appears on its own after a wrong check, whatever this says.",
    options: [{ value: "on", label: "Offer the More menu" }, { value: "off", label: "Do not offer" }],
    fallback: "on",
    limitReason: "Only actions the learning actions policy already offers appear. Default: offered.",
  },
  // SCHOLAR-LESSON-VISUALS-01 (owner GO "Competen Scholar: Visual Learning From Uploaded Presentations"): the learner's OWN pictures,
  // shown exactly as in their file beside the lesson that cites them. Read-only, no AI, no new storage. One contiguous block.
  {
    key: "scholar_lesson_visuals", kind: "choice", product: "Scholar",
    label: "Lesson pictures from the student's slides",
    help: "Whether a lesson shows the original pictures from the PowerPoint slides (and the image-only pages of a PDF) it was taught from, exactly as they are in the student's file, labelled as original and not AI-generated. Nothing is drawn, rewritten or generated. Logos, backgrounds and tiny images are left out by fixed rules.",
    options: [{ value: "on", label: "Show original pictures" }, { value: "off", label: "Do not show" }],
    fallback: "on",
    limitReason: "Needs no migration and no AI. Pictures that cannot be shown (EMF, WMF, SVG, linked) are counted, not shown. A PDF's text pages carry no extracted pictures. Default: on.",
  },
  {
    key: "scholar_lesson_visuals_max_per_section", kind: "int", product: "Scholar", unit: "pictures",
    label: "Lesson pictures: most shown with a lesson",
    help: "The most original pictures shown under one lesson section. The rest stay one tap away in the slide's own view.",
    fallback: 3, min: 1, max: 6,
    limitReason: "One to six. Default: three.",
  },
  {
    key: "scholar_lesson_visuals_min_px", kind: "int", product: "Scholar", unit: "pixels",
    label: "Lesson pictures: smallest side counted as a picture",
    help: "A picture whose shorter side is below this many pixels is treated as an icon or bullet and left out.",
    fallback: 120, min: 40, max: 600,
    limitReason: "Forty to six hundred pixels. Default: 120.",
  },
  // SCHOLAR-VISUAL-CLASSIFY-01 (owner GO "Intelligent Visual Content Classification"): what each picture is, from the page's own text.
  {
    key: "scholar_visual_classify", kind: "choice", product: "Scholar",
    label: "Lesson pictures: tell pictures of text from charts and diagrams",
    help: "Whether each page or slide is classified from its own text layer, or the AI reading already made of it: a picture of ordinary text (the section text teaches it), a chart, table or scoring tool (the picture first, the text only beside it, with a warning), or a title-only page with a picture. Nothing new is read, nothing is described and no score or threshold is ever generated. Off: every picture is simply shown.",
    options: [{ value: "on", label: "Classify" }, { value: "off", label: "Show every picture" }],
    fallback: "on",
    limitReason: "Fixed rules and keywords: no AI and no migration. Default: on.",
  },
  {
    key: "scholar_visual_text_words", kind: "int", product: "Scholar", unit: "words",
    label: "Lesson pictures: words that make a picture of text",
    help: "A page with no text layer whose existing AI reading holds at least this many words of ordinary sentences (under 15% digits, two or more sentences) is treated as a picture of text, not a diagram.",
    fallback: 40, min: 10, max: 200,
    limitReason: "Ten to two hundred words. Default: forty.",
  },
  // PLP-01..04 (owner GO "Personal Learning and Development Planning Engine"): My Plan, deterministic and without AI. One contiguous block.
  {
    key: "scholar_my_plan", kind: "choice", product: "Scholar",
    label: "My Plan: today, calendar and insights",
    help: "Whether Scholar offers My Plan: the one next activity for today with the reasons for it, a calendar, and study insights. Built from the student's own settings and records with fixed rules. No AI is used to plan, show or reschedule anything.",
    options: [{ value: "on", label: "Offer My Plan" }, { value: "off", label: "Do not offer" }],
    fallback: "on",
    limitReason: "Decisions, reflections, goal type and session minutes need migration 840. Without it My Plan works from the study plan and calendar alone. Default: offered.",
  },
  {
    key: "scholar_plan_started_signal", kind: "choice", product: "Scholar",
    label: "My Plan: what counts as a section started",
    help: "SCHOLAR-INDEPENDENT-LEARNING-01 P2. A section the student has started is not planned again as new. Learning: a lesson the student read (Mark as read), opened or was taught counts, as does a question answered on it. Practice only: only a question answered on it counts (the earlier rule). No AI either way.",
    options: [{ value: "learning", label: "A lesson read, opened or taught, or a question answered" }, { value: "practice", label: "Only a question answered" }],
    fallback: "learning",
    limitReason: "Default: learning. Lesson records need migration 414, and the read mark migration 920.",
  },
  {
    key: "scholar_plan_proposal", kind: "choice", product: "Scholar",
    label: "My Plan: propose a plan for each upload",
    help: "Whether the page shown when a student's notes are ready offers a suggested sequence, workload and revision points that the student may accept, change or decline. Learning never waits for the answer.",
    options: [{ value: "on", label: "Offer a proposal" }, { value: "off", label: "Do not offer" }],
    fallback: "on",
    limitReason: "Remembering the answer needs migration 840. Default: offered.",
  },
  {
    key: "scholar_plan_section_minutes", kind: "int", product: "Scholar", unit: "minutes",
    label: "My Plan: minutes estimated for one section",
    help: "The time a plan proposal allows for studying one section of a student's notes, used for the workload estimate.",
    fallback: 12, min: 5, max: 60,
    limitReason: "Five to sixty minutes. Default: twelve.",
  },
  {
    // LEARNING-CLOSE-2026-11 D02 / LE-04: the Go deeper limit, configurable in HQ (default three cumulative rounds, learn-context DEEPER_ROUNDS_MAX).
    key: "scholar_learn_deeper_rounds_max", kind: "int", product: "Scholar", unit: "rounds",
    label: "Learn: Go deeper rounds per lesson",
    help: "How many cumulative Go deeper rounds one lesson gets by AI. Beyond it Scholar answers \"depth reached\" from the notes, with no AI call. Fair-use and cost controls apply as before.",
    fallback: 3, min: 1, max: 10,
    limitReason: "One to ten rounds. Default: three.",
  },
  {
    // SALE-2026-11 R1 (SALE-04): the learner's learning state per topic, derived from existing records (Progress). Word states only.
    key: "scholar_learning_state", kind: "choice", product: "Scholar",
    label: "Progress: what your evidence shows, by topic",
    help: "Whether Progress shows, for each topic, the learner's evidence across exposure, understanding, misconceptions, recall, delayed recall, application, stated confidence, activity and evidence quality. Words only, never a score. Not enough evidence is said when evidence is thin. Never verified competence.",
    options: [{ value: "on", label: "Show it" }, { value: "off", label: "Do not show" }],
    fallback: "on",
    limitReason: "Derived each time from records that already exist: nothing new is stored. Default: on.",
  },
  {
    key: "scholar_learning_state_min_evidence", kind: "int", product: "Scholar", unit: "answers",
    label: "Learning state: evidence needed before anything is concluded",
    help: "Marked answers' worth of evidence a topic needs before its learning state says more than not enough evidence. App-marked answers count 1, AI-evaluated 0.5, self-rated 0.35, unmarked 0.",
    fallback: 2, min: 1, max: 20,
    limitReason: "One to twenty. Default: two.",
  },
  {
    key: "scholar_learning_state_distinct_questions", kind: "int", product: "Scholar", unit: "questions",
    label: "Learning state: different questions for some evidence of understanding",
    help: "How many DIFFERENT questions answered well a topic needs before understanding shows some evidence. One right answer is limited evidence.",
    fallback: 2, min: 2, max: 10,
    limitReason: "Two to ten. Default: two.",
  },
  {
    key: "scholar_learning_state_delay_days", kind: "int", product: "Scholar", unit: "days",
    label: "Learning state: days before a right answer counts as delayed recall",
    help: "A right answer this many days or more after the learner first met the topic (or after the previous answer to the same question) counts as delayed recall, which supports retention.",
    fallback: 3, min: 1, max: 60,
    limitReason: "One to sixty days. Default: three.",
  },
  {
    key: "scholar_learning_state_stale_days", kind: "int", product: "Scholar", unit: "days",
    label: "Learning state: days after which evidence is not recent",
    help: "When the newest marked answer on a topic is older than this, its evidence is called not recent.",
    fallback: 30, min: 7, max: 365,
    limitReason: "Seven to 365 days. Default: thirty.",
  },
  {
    // SALE-2026-11 R1 (SALE-05..07): after a lesson check, the next teaching step chosen by the rule table, with its reason. Skippable.
    key: "scholar_adaptive_teaching", kind: "choice", product: "Scholar",
    label: "Learn: suggest the next teaching step after a check",
    help: "After a lesson check, Scholar names the likely need (a missing fact, a gap in reasoning, a misconception, a missing foundation, or understood) and suggests one existing way of learning for it, with the reason, then a different question. The learner can always skip. Nothing runs until they choose it.",
    options: [{ value: "on", label: "Suggest it" }, { value: "off", label: "Do not suggest" }],
    fallback: "on",
    limitReason: "Uses only the existing Learn actions. Model eligibility and routing are unchanged. Default: on.",
  },
  {
    key: "scholar_adaptive_reteach_max", kind: "int", product: "Scholar", unit: "rounds",
    label: "Learn: corrective rounds per lesson before suggesting review",
    help: "How many corrective teaching steps in a row one lesson gets. Beyond it Scholar suggests leaving the topic for review (the missed check is already a revision card) instead of explaining it again.",
    fallback: 2, min: 1, max: 5,
    limitReason: "One to five rounds. Default: two.",
  },
  {
    key: "scholar_adaptive_prerequisite_misses", kind: "int", product: "Scholar", unit: "questions",
    label: "Learn: different questions missed before suggesting the earlier lesson",
    help: "How many different questions on a lesson's sections must be not answered well before Scholar suggests returning to the earlier lesson it builds on. Never from one miss.",
    fallback: 3, min: 2, max: 10,
    limitReason: "Two to ten. Default: three.",
  },
  {
    // SALE-2026-11 R2 / SALE-08: retrieval scheduled for concepts assessed in lessons, checks, questions and cases (not only flashcards).
    key: "scholar_retrieval_schedule", kind: "choice", product: "Scholar",
    label: "Retention: schedule retrieval of what was assessed",
    help: "Scholar works out, from the learner's own answers, when each topic they were assessed on is due to be recalled again: the shared spaced-repetition rule (SM-2 expanding intervals) over time since practice and recall success, sooner after a repeated misconception, before an exam date, within the study time they set. Shown as Due for retrieval on Revise and in Study next. A suggestion only: nothing is added to the learner's plan.",
    options: [{ value: "on", label: "Schedule it" }, { value: "off", label: "Do not schedule" }],
    fallback: "off",
    limitReason: "Derived each time from existing records, no AI and nothing stored. Default: off until HQ switches it on.",
  },
  {
    key: "scholar_retrieval_misconception_percent", kind: "int", product: "Scholar", unit: "%",
    label: "Retention: interval after a repeated misconception",
    help: "When the same misconception came up on different questions of a topic and the latest answer was not right, the next retrieval comes after this share of the usual interval.",
    fallback: 50, min: 10, max: 100,
    limitReason: "Ten to 100 per cent. Default: 50 (twice as soon). An uncalibrated starting value: recalibrate with pilot data.",
  },
  {
    key: "scholar_retrieval_exam_buffer_days", kind: "int", product: "Scholar", unit: "days",
    label: "Retention: days before the exam by which a topic is recalled",
    help: "With an exam date in the learner's plan, a topic whose next retrieval would fall after the exam is brought forward to this many days before it.",
    fallback: 2, min: 0, max: 14,
    limitReason: "Zero to fourteen days. Default: two.",
  },
  {
    key: "scholar_retrieval_minutes_per_topic", kind: "int", product: "Scholar", unit: "minutes",
    label: "Retention: minutes one topic's retrieval takes",
    help: "A short retrieval exercise on one topic (a few questions or cards). Used to say how long it takes and how many fit a study session.",
    fallback: 5, min: 2, max: 30,
    limitReason: "Two to thirty minutes. Default: five.",
  },
  {
    key: "scholar_retrieval_share_percent", kind: "int", product: "Scholar", unit: "%",
    label: "Retention: share of a study session for retrieval",
    help: "How much of one study session (the learner's own session length, or 30 minutes with none set) due retrieval may fill. What does not fit is shown for a later study day, spaced by the days a week the learner set.",
    fallback: 30, min: 10, max: 100,
    limitReason: "Ten to 100 per cent. Default: 30.",
  },
  {
    // SALE-2026-11 R2 / SALE-09: prerequisite-aware suggestions from approved framework prerequisite links and accepted section mappings.
    key: "scholar_prerequisite_suggestions", kind: "choice", product: "Scholar",
    label: "Retention: suggest a prerequisite review where justified",
    help: "When a learner has missed several different questions on a topic, and the published framework lists a prerequisite for a competency their notes on it are linked to, Scholar suggests a focused review of their own notes on that prerequisite, with the reason. Not suggested where a repeated misconception explains the difficulty better, or where their answers already show the prerequisite. Without a framework link, the lesson's earlier-lesson rule (R1) applies as before.",
    options: [{ value: "on", label: "Suggest it" }, { value: "off", label: "Do not suggest" }],
    fallback: "off",
    limitReason: "Only Holdings-scope prerequisite links within the learner's offered catalogue, and their accepted section links. Default: off until HQ switches it on.",
  },
  {
    // SALE-2026-11 R2 / SALE-10: a transfer check -- a different question outside the lesson where the concept was taught.
    key: "scholar_transfer_checks", kind: "choice", product: "Scholar",
    label: "Retention: offer transfer checks",
    help: "Once a learner has some evidence of understanding a topic, Scholar offers a short check on a question from outside the lesson where they learned it: an approved library question first, then one of their saved questions from other notes or sections, and only then a new question written through the existing revision route (same gate, allowance and model routing). The answer is recorded as transfer evidence in the topic's Applying it evidence. Formative only.",
    options: [{ value: "on", label: "Offer them" }, { value: "off", label: "Do not offer" }],
    fallback: "off",
    limitReason: "No new question bank and no new model routing. Default: off until HQ switches it on.",
  },
  {
    key: "scholar_transfer_questions", kind: "int", product: "Scholar", unit: "questions",
    label: "Retention: questions in one transfer check",
    help: "How many questions one transfer check asks.",
    fallback: 2, min: 1, max: 5,
    limitReason: "One to five. Default: two.",
  },
  {
    // SALE-2026-11 R4 (SALE-13): case, OSCE and simulation results as APPLICATION evidence on Progress. No migration. Off until HQ switches it on.
    key: "scholar_application_evidence", kind: "choice", product: "Scholar",
    label: "Progress: applying what you learned (cases, OSCE, simulation)",
    help: "Whether Progress shows completed clinical cases and OSCE practice as application evidence, by skill (clinical reasoning, prioritisation, interpreting findings, reassessing an evolving patient, structured handover, recognising deterioration, practical simulation), each linked to the competency and learning objective it was made for, with the framework version and whether that mapping was published. Cases made from the learner's notes also count towards Applying it in the learning state. When on, a completed case also keeps the competency provenance it was played against. Words only, never a score, never verified competence or a competency stage.",
    options: [{ value: "off", label: "Off" }, { value: "on", label: "On" }],
    fallback: "off",
    limitReason: "Derived from records that already exist. Off until HQ switches it on.",
  },
  {
    // SALE-2026-11 R4 (SALE-14): the three separate views on My Competencies. No migration. Off until HQ switches it on.
    key: "scholar_competency_evidence_views", kind: "choice", product: "Scholar",
    label: "My Competencies: self-assessment, learning evidence and verified competence as three views",
    help: "Whether My Competencies shows three separate views: what the learner believes they can do (their self-assessment), what their learning records show (each record with the competency, framework version and mapping status; a draft mapping is labelled and never counted as validated evidence) and what an authorised verification has established. Formative results never feed the verified view and never set a competency stage.",
    options: [{ value: "off", label: "Off" }, { value: "on", label: "On" }],
    fallback: "off",
    limitReason: "Read only, from records that already exist. Off until HQ switches it on.",
  },
  {
    key: "scholar_plan_rule_order", kind: "sequence", product: "Scholar",
    label: "My Plan: what comes first",
    help: "The order the planning rules are applied in when choosing the next activity. Revision that is due, topics showing gaps, unfinished lessons, the exam date, a deadline the student put in their calendar, consolidating what was recently studied, and covering all accepted notes. Rules left out are not used.",
    options: [
      { value: "due_revision", label: "Revision that is due" }, { value: "gaps", label: "Gaps shown by practice" }, { value: "unfinished", label: "Unfinished lessons" },
      { value: "exam", label: "Exam date" }, { value: "deadline", label: "Deadlines in the student calendar" }, { value: "consolidate", label: "Consolidate recent study" }, { value: "coverage", label: "Cover all accepted notes" },
      { value: "competency", label: "Competency gaps from a self-assessment" },
    ],
    fallback: ["due_revision", "gaps", "unfinished", "exam", "deadline", "consolidate", "coverage", "competency"],
    limitReason: "Only these eight rules. Default order as listed.",
  },
  {
    key: "scholar_plan_weekly_reflection", kind: "choice", product: "Scholar",
    label: "My Plan: weekly reflection",
    help: "Whether My Plan asks once a week if the workload felt manageable, too demanding or too light. The answer is private. It may lead to an offer to change session length, which the student accepts or ignores. Nothing changes by itself.",
    options: [{ value: "on", label: "Ask once a week" }, { value: "off", label: "Do not ask" }],
    fallback: "on",
    limitReason: "Keeping the answer needs migration 840. Default: ask.",
  },
  {
    key: "scholar_plan_max_weekly_minutes", kind: "int", product: "Scholar", unit: "minutes",
    label: "My Plan: most weekly minutes without confirmation",
    help: "The most study minutes a week a student can set, or be offered, without confirming the increase. A higher setting needs the student to confirm it. A student may still choose it.",
    fallback: 600, min: 60, max: 3000,
    limitReason: "Sixty to three thousand minutes. Default: six hundred.",
  },
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

/**
 * Pure: who may see one Scholar module, from a stored settings object. FAILS CLOSED: a missing, malformed or unreadable value,
 * or a mode that is not one of the three, is private with nobody listed. Only well-formed account ids (lower case, once each,
 * at most the limit) and known participation categories survive. A stored email or name is not an id and is dropped.
 */
export function clampModuleAccess(p: ModuleAccessPolicy, settings: any): ModuleAccess {
  if (settings == null || typeof settings !== "object" || Array.isArray(settings)) return { ...MODULE_ACCESS_CLOSED };
  const mode = (MODULE_ACCESS_MODES as readonly unknown[]).includes(settings.mode) ? (settings.mode as ModuleAccessMode) : null;
  if (mode === null) return { ...MODULE_ACCESS_CLOSED };
  const users = Array.isArray(settings.users)
    ? ([...new Set(settings.users.filter((v: unknown): v is string => typeof v === "string" && UUID.test(v)).map((v: string) => v.toLowerCase()))].slice(0, p.maxUsers) as string[])
    : [];
  const groups = Array.isArray(settings.groups) ? PARTICIPATION_CATEGORIES.filter(c => settings.groups.includes(c)) : [];
  return { mode, users, groups };
}

/** Pure: a catalogue allowlist from a stored settings object. Well-formed ids only, deduplicated, capped. */
export function clampCatalogues(p: CataloguePolicy, settings: any): string[] {
  if (settings == null || !Array.isArray(settings.ids)) return [];
  return [...new Set(settings.ids.filter((v: unknown): v is string => typeof v === "string" && UUID.test(v)).map((v: string) => v.toLowerCase()))].slice(0, p.max) as string[];
}

/** Pure: the instrument codes Scholar offers. Anything not a well-formed code is dropped, and nothing published is none. */
export function clampInstrumentCodes(p: InstrumentCodesPolicy, settings: any): string[] {
  if (settings == null || !Array.isArray(settings.codes)) return [];
  return [...new Set(settings.codes.filter((v: unknown): v is string => typeof v === "string" && INSTRUMENT_CODE.test(v)))].slice(0, p.max) as string[];
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
  if (def.kind === "instrument_codes") {
    if (!Array.isArray(raw) || raw.some(v => typeof v !== "string" || !INSTRUMENT_CODE.test(v))) return { ok: false, error: `${def.label}: send the list of instrument codes to offer.` };
    const codes = [...new Set(raw as string[])];
    if (codes.length > def.max) return { ok: false, error: `${def.label}: at most ${def.max}. That limit is fixed.` };
    // Whether each code is an instrument is checked by the route, against the library.
    return { ok: true, def, settings: { codes } };
  }
  if (def.kind === "catalogues") {
    if (!Array.isArray(raw) || raw.some(v => typeof v !== "string" || !UUID.test(v))) return { ok: false, error: `${def.label}: send the list of catalogue ids to allow.` };
    const ids = [...new Set(raw.map(v => v.toLowerCase()))];
    if (ids.length > def.max) return { ok: false, error: `${def.label}: at most ${def.max} catalogues. That limit is fixed.` };
    // Whether each id is a shared, active, published framework is checked by the route, against the library.
    return { ok: true, def, settings: { ids } };
  }
  if (def.kind === "module_access") {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: `${def.label}: send the mode, the accounts and the groups.` };
    const r = raw as Record<string, unknown>;
    if (!(MODULE_ACCESS_MODES as readonly unknown[]).includes(r.mode)) return { ok: false, error: `${def.label}: choose Private development, Pilot or Public.` };
    if (!Array.isArray(r.users) || r.users.some(v => typeof v !== "string" || !UUID.test(v))) return { ok: false, error: `${def.label}: send the accounts as account ids.` };
    const users = [...new Set((r.users as string[]).map(v => v.toLowerCase()))];
    if (users.length > def.maxUsers) return { ok: false, error: `${def.label}: at most ${def.maxUsers} accounts. That limit is fixed.` };
    if (!Array.isArray(r.groups) || r.groups.some(v => !isParticipationCategory(v))) return { ok: false, error: `${def.label}: a group must be Regular, Pilot or Staff tester.` };
    const groups = PARTICIPATION_CATEGORIES.filter(c => (r.groups as unknown[]).includes(c));
    // Whether each id is an account is checked by the route, against the profiles.
    return { ok: true, def, settings: { mode: r.mode, users, groups } };
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
  scholarVerifyFormats: VerifyFormat[];
  scholarRevisionModes: RevisionMode[];
  scholarRevisionQuantity: number;
  scholarRevisionDifficulty: RevisionDifficulty;
  scholarRevisionFeedback: "immediate" | "end";
  scholarRevisionGeneration: "generate" | "saved_only";
  scholarShortAnswerMarking: "ai_then_self" | "self";
  /** SQIE-CLOSE-2026-11 WS-A: whether question tolerances are used (off until the clinical calculation policy is approved). */
  scholarCalculationTolerances: "off" | "on";
  /** SQIE-CLOSE-2026-11 WS-B: whether the rules-v3 clinical scoring caps change marks (off until clinical approval). */
  scholarClinicalScoringCaps: "off" | "on";
  scholarRevisionRecommendations: "on" | "off";
  /** SCHOLAR-PRACTICE-EXAMS-01: adaptive exams. */
  scholarAdaptiveExams: "on" | "off";
  scholarAdaptiveLength: number;
  scholarAdaptiveMaxLength: number;
  scholarAdaptiveFormats: AdaptiveFormat[];
  /** SCHOLAR-FLASHCARDS-01. */
  scholarFlashcards: "on" | "off";
  /** SCHOLAR-COMPANION-01 P1. */
  scholarMistakeNotebook: "on" | "off";
  /** SCHOLAR-LIBRARY-01. */
  scholarLearningLibrary: "on" | "off";
  /** SALE-2026-11 R3: next best learning actions in My Plan (SALE-11) and the active Notebook (SALE-12). Default off. */
  scholarNextBestAction: "on" | "off";
  scholarNextBestActionMax: number;
  scholarActiveNotebook: "on" | "off";
  /** SCHOLAR-SEARCH-HISTORY-01: My Search History in the library (migration 992). Default off. */
  scholarSearchHistory: "on" | "off";
  scholarGlobalSearch: "on" | "off";
  /** SEARCH-STANDARD-01: Global Search across Professional. Default off. */
  professionalGlobalSearch: "on" | "off";
  /** SCHOLAR-INLINE-CHECKS-01: checks inside the scrolling lesson. */
  scholarLearnInlineRecall: "on" | "off";
  scholarLearnInlineRecallPlacement: "substantial" | "every_lesson" | "lesson_end";
  scholarLearnInlineRecallMinWords: number;
  scholarLearnInlineChecks: "on" | "off";
  /** LEARNING-CLOSE-2026-11 CYU-01: where a lesson's own check questions appear (learn-check-record.ts placeChecks). */
  scholarLearnCheckPlacement: "distributed" | "lesson_end";
  scholarLearnInlineApplication: "on" | "off";
  scholarLearnInlineSkippable: "on" | "off";
  scholarLearnCheckRequired: "required" | "optional";
  scholarLearnSaveMissedCards: "on" | "off";
  scholarLearnCheckEvery: "1" | "2" | "3" | "journey_end";
  scholarFlashcardsPerGeneration: number;
  scholarFlashcardDeckMax: number;
  /** Always includes notes. */
  scholarFlashcardSourceModes: ("notes" | "notes_and_references")[];
  scholarFlashcardDifficulty: RevisionDifficulty;
  scholarFlashcardExports: ("deck" | "print" | "guide")[];
  scholarFlashcardLevelMix: "programme" | "recall" | "balanced" | "applied";
  /** SCHOLAR-SESSION-AI-02. Whether connected study sessions are offered. Read it through isStudySessionsOn, which also needs 740. */
  scholarStudySessions: boolean;
  /** SCHOLAR-INTELLIGENCE-COMPLETE-01. "on" follows the case_library flag (the default); "off" stops new case-contribution permissions and offers. Withdrawal is never gated. */
  scholarCaseContribution: "on" | "off";
  /** SQIE-LIBRARY-EXPANSION-01 (802). Whether a student may grant the question-offering permission and offer a question. Default off. Withdrawal is never gated. */
  scholarQuestionOffering: "on" | "off";
  /** SQIE-LIBRARY-GAPS-01. Days an untaken question offer waits before it is withdrawn and purged (30, 60 or 90). */
  scholarQuestionOfferDays: 30 | 60 | 90;
  /** SCHOLAR-COMPANION-01. Whether the study plan is offered. Read it through isStudyPlanOn, which also needs 780. */
  scholarStudyPlan: boolean;
  /** SCHOLAR-GUIDED-LEARNING-01. Whether Learn may prepare the next lesson ahead (one at most). Default off. */
  scholarLearnPrepareNext: boolean;
  /** SCHOLAR-GO-DEEPER-001: Go deeper as a structured round. Default off. */
  scholarGoDeeperStructured: boolean;
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
  /** SCHOLAR-CE-2026 CE-04. Whether a case with a patient voice offers Talk to the patient (needs 880), and the questions allowed per stage. */
  scholarCaseConversation: "on" | "off";
  scholarCaseConversationTurns: 10 | 15 | 20 | 30 | 40;
  /** CE-04C: library cases play their approved deterioration timeline. Default off. */
  scholarCaseDeterioration: "on" | "off";
  /** CE-04: the went well / missed / unsafe debrief on a finished case. Default off. */
  scholarCaseDebriefReview: "on" | "off";
  /** D05: a student may delete their own case attempt (cascades the conversation and kept record). Default off. */
  scholarCaseAttemptDelete: "on" | "off";
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
  /** SCHOLAR-UPLOAD-FIX: picture-only PowerPoint slides read by AI on the learner's request. Off by default. */
  scholarMaterialImageSlides: "off" | "ai_transcription";
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
  /** SCHOLAR-MONTHLY-REVIEW-01. The optional monthly learning review and the study calendar. */
  scholarMonthlyReview: "on" | "off";
  scholarMonthlyReviewMinQuestions: number;
  scholarMonthlyReviewMaxQuestions: number;
  scholarMonthlyReviewPerSection: number;
  /** The most new questions written when a review starts (0 = stored only). */
  scholarMonthlyReviewMaxNew: number;
  /** "core_application_gaps" shares, for example "60_25_15". */
  scholarMonthlyReviewMix: "60_25_15" | "50_30_20" | "70_20_10" | "40_30_30";
  scholarMonthlyReviewRecommendDays: number;
  scholarMonthlyReviewReminders: "on" | "off";
  scholarMonthlyReviewOptout: "allowed" | "not_allowed";
  scholarStudyCalendar: "on" | "off";
  /** SCHOLAR-LEARN-STYLE-01: the Guide me and Challenge me teaching styles and the More menu (Explain is always on). */
  scholarLearnStyleGuide: "on" | "off";
  scholarLearnStyleChallenge: "on" | "off";
  scholarLearnMoreMenu: "on" | "off";
  /** SCHOLAR-LESSON-VISUALS-01: the student's own slide / page pictures beside a lesson. */
  scholarLessonVisuals: "on" | "off";
  scholarLessonVisualsMaxPerSection: number;
  scholarLessonVisualsMinPx: number;
  /** SCHOLAR-VISUAL-CLASSIFY-01. */
  scholarVisualClassify: "on" | "off";
  scholarVisualTextWords: number;
  /** PLP-01..04: My Plan. */
  scholarMyPlan: "on" | "off";
  /** Private module development access: who may see Courses & Training and My Competencies. Closed unless HQ publishes otherwise. */
  scholarModuleAccess: { courses: ModuleAccess; competencies: ModuleAccess };
  scholarPlanProposal: "on" | "off";
  /** SCHOLAR-INDEPENDENT-LEARNING-01 P2: what counts as a section started for My Plan (a lesson read / opened / taught, or only a question answered). */
  scholarPlanStartedSignal: "learning" | "practice";
  scholarPlanSectionMinutes: number;
  /** LE-04: cumulative Go deeper rounds one lesson gets by AI (D02 default three). */
  scholarLearnDeeperRoundsMax: number;
  /** SALE-2026-11 R1: the learning state on Progress, its thresholds, and the adaptive next step after a lesson check. */
  scholarLearningState: "on" | "off";
  scholarLearningStateMinEvidence: number;
  scholarLearningStateDistinctQuestions: number;
  scholarLearningStateDelayDays: number;
  scholarLearningStateStaleDays: number;
  scholarAdaptiveTeaching: "on" | "off";
  scholarAdaptiveReteachMax: number;
  scholarAdaptivePrerequisiteMisses: number;
  /** SALE-2026-11 R2: retrieval scheduling (SALE-08), prerequisite suggestions (SALE-09) and transfer checks (SALE-10). Learner features off by default. */
  scholarRetrievalSchedule: "on" | "off";
  scholarRetrievalMisconceptionPercent: number;
  scholarRetrievalExamBufferDays: number;
  scholarRetrievalMinutesPerTopic: number;
  scholarRetrievalSharePercent: number;
  scholarPrerequisiteSuggestions: "on" | "off";
  scholarTransferChecks: "on" | "off";
  scholarTransferQuestions: number;
  /** SALE-2026-11 R4: application evidence on Progress (SALE-13) and the three competency views on My Competencies (SALE-14). Both off by default. */
  scholarApplicationEvidence: "on" | "off";
  scholarCompetencyEvidenceViews: "on" | "off";
  /** The planning rules in the order they apply (due_revision, gaps, unfinished, exam, consolidate, coverage). */
  scholarPlanRuleOrder: string[];
  scholarPlanWeeklyReflection: "on" | "off";
  scholarPlanMaxWeeklyMinutes: number;
  /** CHECKLIST STUDIO S3: the assessment instrument codes offered to a Scholar learner. Empty: nothing is offered. */
  scholarAssessmentInstruments: string[];
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
    scholarVerifyFormats: clampSet(policyDef("scholar_verify_formats") as SetPolicy, published.get(policyPath("scholar_verify_formats"))) as VerifyFormat[],
    scholarRevisionModes: clampSet(policyDef("scholar_revision_modes") as SetPolicy, published.get(policyPath("scholar_revision_modes"))) as RevisionMode[],
    scholarRevisionQuantity: int("scholar_revision_quantity"),
    scholarRevisionDifficulty: clampChoice(policyDef("scholar_revision_difficulty") as ChoicePolicy, published.get(policyPath("scholar_revision_difficulty"))) as RevisionDifficulty,
    scholarRevisionFeedback: clampChoice(policyDef("scholar_revision_feedback") as ChoicePolicy, published.get(policyPath("scholar_revision_feedback"))) as "immediate" | "end",
    scholarRevisionGeneration: clampChoice(policyDef("scholar_revision_generation") as ChoicePolicy, published.get(policyPath("scholar_revision_generation"))) as "generate" | "saved_only",
    scholarShortAnswerMarking: clampChoice(policyDef("scholar_short_answer_marking") as ChoicePolicy, published.get(policyPath("scholar_short_answer_marking"))) as "ai_then_self" | "self",
    scholarCalculationTolerances: clampChoice(policyDef("scholar_calculation_tolerances") as ChoicePolicy, published.get(policyPath("scholar_calculation_tolerances"))) as "off" | "on",
    scholarClinicalScoringCaps: clampChoice(policyDef("scholar_clinical_scoring_caps") as ChoicePolicy, published.get(policyPath("scholar_clinical_scoring_caps"))) as "off" | "on",
    scholarRevisionRecommendations: clampChoice(policyDef("scholar_revision_recommendations") as ChoicePolicy, published.get(policyPath("scholar_revision_recommendations"))) as "on" | "off",
    scholarAdaptiveExams: clampChoice(policyDef("scholar_adaptive_exams") as ChoicePolicy, published.get(policyPath("scholar_adaptive_exams"))) as "on" | "off",
    scholarAdaptiveMaxLength: int("scholar_adaptive_max_length"),
    // The default never exceeds the maximum, whatever was published.
    scholarAdaptiveLength: Math.min(int("scholar_adaptive_length"), int("scholar_adaptive_max_length")),
    scholarAdaptiveFormats: clampSet(policyDef("scholar_adaptive_formats") as SetPolicy, published.get(policyPath("scholar_adaptive_formats"))) as AdaptiveFormat[],
    scholarFlashcards: clampChoice(policyDef("scholar_flashcards") as ChoicePolicy, published.get(policyPath("scholar_flashcards"))) as "on" | "off",
    scholarMistakeNotebook: clampChoice(policyDef("scholar_mistake_notebook") as ChoicePolicy, published.get(policyPath("scholar_mistake_notebook"))) as "on" | "off",
    scholarLearningLibrary: clampChoice(policyDef("scholar_learning_library") as ChoicePolicy, published.get(policyPath("scholar_learning_library"))) as "on" | "off",
    scholarNextBestAction: clampChoice(policyDef("scholar_next_best_action") as ChoicePolicy, published.get(policyPath("scholar_next_best_action"))) as "on" | "off",
    scholarNextBestActionMax: int("scholar_next_best_action_max"),
    scholarActiveNotebook: clampChoice(policyDef("scholar_active_notebook") as ChoicePolicy, published.get(policyPath("scholar_active_notebook"))) as "on" | "off",
    scholarSearchHistory: clampChoice(policyDef("scholar_search_history") as ChoicePolicy, published.get(policyPath("scholar_search_history"))) as "on" | "off",
    scholarGlobalSearch: clampChoice(policyDef("scholar_global_search") as ChoicePolicy, published.get(policyPath("scholar_global_search"))) as "on" | "off",
    professionalGlobalSearch: clampChoice(policyDef("professional_global_search") as ChoicePolicy, published.get(policyPath("professional_global_search"))) as "on" | "off",
    scholarLearnInlineRecall: clampChoice(policyDef("scholar_learn_inline_recall") as ChoicePolicy, published.get(policyPath("scholar_learn_inline_recall"))) as "on" | "off",
    scholarLearnInlineRecallPlacement: clampChoice(policyDef("scholar_learn_inline_recall_placement") as ChoicePolicy, published.get(policyPath("scholar_learn_inline_recall_placement"))) as "substantial" | "every_lesson" | "lesson_end",
    scholarLearnInlineRecallMinWords: int("scholar_learn_inline_recall_min_words"),
    scholarLearnInlineChecks: clampChoice(policyDef("scholar_learn_inline_checks") as ChoicePolicy, published.get(policyPath("scholar_learn_inline_checks"))) as "on" | "off",
    scholarLearnCheckPlacement: clampChoice(policyDef("scholar_learn_check_placement") as ChoicePolicy, published.get(policyPath("scholar_learn_check_placement"))) as "distributed" | "lesson_end",
    scholarLearnInlineApplication: clampChoice(policyDef("scholar_learn_inline_application") as ChoicePolicy, published.get(policyPath("scholar_learn_inline_application"))) as "on" | "off",
    scholarLearnInlineSkippable: clampChoice(policyDef("scholar_learn_inline_skippable") as ChoicePolicy, published.get(policyPath("scholar_learn_inline_skippable"))) as "on" | "off",
    scholarLearnCheckRequired: clampChoice(policyDef("scholar_learn_check_required") as ChoicePolicy, published.get(policyPath("scholar_learn_check_required"))) as "required" | "optional",
    scholarLearnCheckEvery: clampChoice(policyDef("scholar_learn_check_every") as ChoicePolicy, published.get(policyPath("scholar_learn_check_every"))) as "1" | "2" | "3" | "journey_end",
    scholarLearnSaveMissedCards: clampChoice(policyDef("scholar_learn_save_missed_cards") as ChoicePolicy, published.get(policyPath("scholar_learn_save_missed_cards"))) as "on" | "off",
    scholarFlashcardsPerGeneration: int("scholar_flashcards_per_generation"),
    scholarFlashcardDeckMax: int("scholar_flashcard_deck_max"),
    scholarFlashcardSourceModes: (() => { const m = clampSet(policyDef("scholar_flashcard_source_modes") as SetPolicy, published.get(policyPath("scholar_flashcard_source_modes"))) as ("notes" | "notes_and_references")[]; return m.includes("notes") ? m : ["notes" as const, ...m]; })(),
    scholarFlashcardDifficulty: clampChoice(policyDef("scholar_flashcard_difficulty") as ChoicePolicy, published.get(policyPath("scholar_flashcard_difficulty"))) as RevisionDifficulty,
    scholarFlashcardExports: clampSet(policyDef("scholar_flashcard_exports") as SetPolicy, published.get(policyPath("scholar_flashcard_exports"))) as ("deck" | "print" | "guide")[],
    scholarFlashcardLevelMix: clampChoice(policyDef("scholar_flashcard_level_mix") as ChoicePolicy, published.get(policyPath("scholar_flashcard_level_mix"))) as "programme" | "recall" | "balanced" | "applied",
    scholarStudySessions: clampChoice(policyDef("scholar_study_sessions") as ChoicePolicy, published.get(policyPath("scholar_study_sessions"))) === "on",
    scholarCaseContribution: clampChoice(policyDef("scholar_case_contribution") as ChoicePolicy, published.get(policyPath("scholar_case_contribution"))) as "on" | "off",
    scholarQuestionOffering: clampChoice(policyDef("scholar_question_offering") as ChoicePolicy, published.get(policyPath("scholar_question_offering"))) as "on" | "off",
    scholarQuestionOfferDays: Number(clampChoice(policyDef("scholar_question_offer_days") as ChoicePolicy, published.get(policyPath("scholar_question_offer_days")))) as 30 | 60 | 90,
    scholarStudyPlan: clampChoice(policyDef("scholar_study_plan") as ChoicePolicy, published.get(policyPath("scholar_study_plan"))) === "on",
    scholarLearnPrepareNext: clampChoice(policyDef("scholar_learn_prepare_next") as ChoicePolicy, published.get(policyPath("scholar_learn_prepare_next"))) === "on",
    scholarGoDeeperStructured: clampChoice(policyDef("scholar_go_deeper_structured") as ChoicePolicy, published.get(policyPath("scholar_go_deeper_structured"))) === "on",
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
    scholarCaseConversation: clampChoice(policyDef("scholar_case_conversation") as ChoicePolicy, published.get(policyPath("scholar_case_conversation"))) as "on" | "off",
    scholarCaseConversationTurns: Number(clampChoice(policyDef("scholar_case_conversation_turns") as ChoicePolicy, published.get(policyPath("scholar_case_conversation_turns")))) as 10 | 15 | 20 | 30 | 40,
    scholarCaseDeterioration: clampChoice(policyDef("scholar_case_deterioration") as ChoicePolicy, published.get(policyPath("scholar_case_deterioration"))) as "on" | "off",
    scholarCaseDebriefReview: clampChoice(policyDef("scholar_case_debrief_review") as ChoicePolicy, published.get(policyPath("scholar_case_debrief_review"))) as "on" | "off",
    scholarCaseAttemptDelete: clampChoice(policyDef("scholar_case_attempt_delete") as ChoicePolicy, published.get(policyPath("scholar_case_attempt_delete"))) as "on" | "off",
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
    scholarMaterialImageSlides: clampChoice(policyDef("scholar_material_image_slides") as ChoicePolicy, published.get(policyPath("scholar_material_image_slides"))) as "off" | "ai_transcription",
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
    // SCHOLAR-MONTHLY-REVIEW-01: one contiguous block.
    scholarMonthlyReview: clampChoice(policyDef("scholar_monthly_review") as ChoicePolicy, published.get(policyPath("scholar_monthly_review"))) as "on" | "off",
    scholarMonthlyReviewMinQuestions: Math.min(int("scholar_monthly_review_min_questions"), int("scholar_monthly_review_max_questions")),
    scholarMonthlyReviewMaxQuestions: int("scholar_monthly_review_max_questions"),
    scholarMonthlyReviewPerSection: int("scholar_monthly_review_per_section"),
    scholarMonthlyReviewMaxNew: int("scholar_monthly_review_max_new"),
    scholarMonthlyReviewMix: clampChoice(policyDef("scholar_monthly_review_mix") as ChoicePolicy, published.get(policyPath("scholar_monthly_review_mix"))) as "60_25_15" | "50_30_20" | "70_20_10" | "40_30_30",
    scholarMonthlyReviewRecommendDays: int("scholar_monthly_review_recommend_days"),
    scholarMonthlyReviewReminders: clampChoice(policyDef("scholar_monthly_review_reminders") as ChoicePolicy, published.get(policyPath("scholar_monthly_review_reminders"))) as "on" | "off",
    scholarMonthlyReviewOptout: clampChoice(policyDef("scholar_monthly_review_optout") as ChoicePolicy, published.get(policyPath("scholar_monthly_review_optout"))) as "allowed" | "not_allowed",
    scholarStudyCalendar: clampChoice(policyDef("scholar_study_calendar") as ChoicePolicy, published.get(policyPath("scholar_study_calendar"))) as "on" | "off",
    scholarLearnStyleGuide: clampChoice(policyDef("scholar_learn_style_guide") as ChoicePolicy, published.get(policyPath("scholar_learn_style_guide"))) as "on" | "off",
    scholarLearnStyleChallenge: clampChoice(policyDef("scholar_learn_style_challenge") as ChoicePolicy, published.get(policyPath("scholar_learn_style_challenge"))) as "on" | "off",
    scholarLearnMoreMenu: clampChoice(policyDef("scholar_learn_more_menu") as ChoicePolicy, published.get(policyPath("scholar_learn_more_menu"))) as "on" | "off",
    // SCHOLAR-LESSON-VISUALS-01: one contiguous block.
    scholarLessonVisuals: clampChoice(policyDef("scholar_lesson_visuals") as ChoicePolicy, published.get(policyPath("scholar_lesson_visuals"))) as "on" | "off",
    scholarLessonVisualsMaxPerSection: int("scholar_lesson_visuals_max_per_section"),
    scholarLessonVisualsMinPx: int("scholar_lesson_visuals_min_px"),
    scholarVisualClassify: clampChoice(policyDef("scholar_visual_classify") as ChoicePolicy, published.get(policyPath("scholar_visual_classify"))) as "on" | "off",
    scholarVisualTextWords: int("scholar_visual_text_words"),
    scholarMyPlan: clampChoice(policyDef("scholar_my_plan") as ChoicePolicy, published.get(policyPath("scholar_my_plan"))) as "on" | "off",
    scholarModuleAccess: {
      courses: clampModuleAccess(policyDef("scholar_module_courses_access") as ModuleAccessPolicy, published.get(policyPath("scholar_module_courses_access"))),
      competencies: clampModuleAccess(policyDef("scholar_module_competencies_access") as ModuleAccessPolicy, published.get(policyPath("scholar_module_competencies_access"))),
    },
    scholarPlanProposal: clampChoice(policyDef("scholar_plan_proposal") as ChoicePolicy, published.get(policyPath("scholar_plan_proposal"))) as "on" | "off",
    scholarPlanStartedSignal: clampChoice(policyDef("scholar_plan_started_signal") as ChoicePolicy, published.get(policyPath("scholar_plan_started_signal"))) as "learning" | "practice",
    scholarPlanSectionMinutes: int("scholar_plan_section_minutes"),
    scholarLearnDeeperRoundsMax: int("scholar_learn_deeper_rounds_max"),
    scholarLearningState: clampChoice(policyDef("scholar_learning_state") as ChoicePolicy, published.get(policyPath("scholar_learning_state"))) as "on" | "off",
    scholarLearningStateMinEvidence: int("scholar_learning_state_min_evidence"),
    scholarLearningStateDistinctQuestions: int("scholar_learning_state_distinct_questions"),
    scholarLearningStateDelayDays: int("scholar_learning_state_delay_days"),
    scholarLearningStateStaleDays: int("scholar_learning_state_stale_days"),
    scholarAdaptiveTeaching: clampChoice(policyDef("scholar_adaptive_teaching") as ChoicePolicy, published.get(policyPath("scholar_adaptive_teaching"))) as "on" | "off",
    scholarAdaptiveReteachMax: int("scholar_adaptive_reteach_max"),
    scholarAdaptivePrerequisiteMisses: int("scholar_adaptive_prerequisite_misses"),
    scholarRetrievalSchedule: clampChoice(policyDef("scholar_retrieval_schedule") as ChoicePolicy, published.get(policyPath("scholar_retrieval_schedule"))) as "on" | "off",
    scholarRetrievalMisconceptionPercent: int("scholar_retrieval_misconception_percent"),
    scholarRetrievalExamBufferDays: int("scholar_retrieval_exam_buffer_days"),
    scholarRetrievalMinutesPerTopic: int("scholar_retrieval_minutes_per_topic"),
    scholarRetrievalSharePercent: int("scholar_retrieval_share_percent"),
    scholarPrerequisiteSuggestions: clampChoice(policyDef("scholar_prerequisite_suggestions") as ChoicePolicy, published.get(policyPath("scholar_prerequisite_suggestions"))) as "on" | "off",
    scholarTransferChecks: clampChoice(policyDef("scholar_transfer_checks") as ChoicePolicy, published.get(policyPath("scholar_transfer_checks"))) as "on" | "off",
    scholarTransferQuestions: int("scholar_transfer_questions"),
    scholarApplicationEvidence: clampChoice(policyDef("scholar_application_evidence") as ChoicePolicy, published.get(policyPath("scholar_application_evidence"))) as "on" | "off",
    scholarCompetencyEvidenceViews: clampChoice(policyDef("scholar_competency_evidence_views") as ChoicePolicy, published.get(policyPath("scholar_competency_evidence_views"))) as "on" | "off",
    scholarPlanRuleOrder: clampSequence(policyDef("scholar_plan_rule_order") as SequencePolicy, published.get(policyPath("scholar_plan_rule_order"))),
    scholarPlanWeeklyReflection: clampChoice(policyDef("scholar_plan_weekly_reflection") as ChoicePolicy, published.get(policyPath("scholar_plan_weekly_reflection"))) as "on" | "off",
    scholarPlanMaxWeeklyMinutes: int("scholar_plan_max_weekly_minutes"),
    scholarAssessmentInstruments: clampInstrumentCodes(policyDef("scholar_assessment_instruments") as InstrumentCodesPolicy, published.get(policyPath("scholar_assessment_instruments"))),
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

/**
 * SCHOLAR-COMPANION-01. The study plan is on only where HQ switched it on AND migration 780 is present
 * (store.ts studyPlanSchema). Either missing: off, so the feature fails closed while 780 is absent.
 */
export const isStudyPlanOn = (policy: Pick<IndividualPolicy, "scholarStudyPlan">, schema780: boolean): boolean =>
  policy.scholarStudyPlan === true && schema780 === true;

/**
 * PLP-01..04. My Plan is on only where HQ switched it on AND the study plan table (780) is present. The parts that need 840
 * (decisions, reflections, proposal memory, goal type, session minutes) are separately gated on learningPlanSchema.
 */
export const isMyPlanOn = (policy: Pick<IndividualPolicy, "scholarMyPlan" | "scholarStudyPlan">, schema780: boolean): boolean =>
  policy.scholarMyPlan === "on" && policy.scholarStudyPlan === true && schema780 === true;

/** The effective policy now. Fail-soft: anything unreadable is today's constant. */
export async function loadIndividualPolicy(admin: any): Promise<IndividualPolicy> {
  try {
    const { data, error } = await admin.from("workspace_config_overrides").select("config_path, published")
      .eq("scope_type", POLICY_SCOPE.scopeType).eq("scope_ref", POLICY_SCOPE.scopeRef).like("config_path", `${POLICY_PATH_PREFIX}%`);
    return error ? DEFAULT_POLICY : resolvePolicy(data ?? []);
  } catch { return DEFAULT_POLICY; }
}

/** MY PLAN PERF: the same read, once per server render (React cache(), a plain call outside a render): the shell layout and the page both ask for it. */
export const loadIndividualPolicyOnce = cache(loadIndividualPolicy);

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
  return { modes: LEARN_SOURCE_MODES.filter(m => m === "notes" || chosen.includes(m)), dailyMax: int("scholar_research_daily_max"), dailyCostCents: int("scholar_research_daily_cost_cents"),
    relevance: clampChoice(policyDef("scholar_research_relevance") as ChoicePolicy, published.get(policyPath("scholar_research_relevance"))) as "strict" | "standard" };
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
    sufficiency: Number(choice("scholar_recovery_sufficiency")),
  };
}

/** COMPETEN-RESEARCH-01 ADDENDUM V2: the modes a learner is SHOWN. An inactive mode is never shown as available. */
export const shownLearnModes = (p: ScholarResearchPolicy, researchOperational: boolean): LearnSourceMode[] =>
  p.modes.filter(m => m !== "research" || researchOperational);
