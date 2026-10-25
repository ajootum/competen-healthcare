/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PlanAiLimit } from "./commerce";
import { REMINDER_HORIZON_DAYS } from "./professional/vocabulary";
import { SHARE_DAYS_MAX } from "./professional/share";
import {
  DEFAULT_UPLOAD_MB, FORMAT_LABEL, INSIGHT_MIN_ANSWERS, INSIGHT_WINDOW_DAYS, LEARN_ACTIONS, LEARN_ACTION_LABEL, MAX_MATERIALS_PER_PERSON, MAX_PDF_PAGES, MAX_PPTX_SLIDES,
  MAX_SESSION_FILES, MAX_SESSION_MB, MAX_UPLOAD_BYTES, QUESTIONS_PER_REQUEST, REVISION_FORMATS, REVISION_FORMAT_LABEL, REVISION_MODES, REVISION_MODE_LABEL, REVISION_QUANTITY_MAX,
  SESSION_MAX_STEPS, TUTOR_MAX_TURNS, UPLOAD_SESSION_MINUTES, CASE_CONTEXTS, CASE_CONTEXT_LABEL, CASE_ENTRIES, CASE_ENTRY_LABEL, CASE_DIMENSION_LABEL,
  type CaseContext, type CaseEntry,
  type ExplanationDepth, type LearnAction, type RevisionDifficulty, type RevisionFormat, type RevisionMode, type UploadFormat,
} from "./scholar/config";
import { STUDY_ACHIEVEMENT, STUDY_ACHIEVEMENT_KINDS, type StudyAchievementKind } from "./scholar/passport-items";
import { COUNTRIES } from "../countries";
import {
  DEFAULT_PRACTICE_SETTINGS, DEFAULT_QUALIFICATION_TYPES, DEFAULT_STATUSES, DOCUMENT_KINDS, FIELD_LABEL, ITEM_LABEL, OPTIONAL_FIELDS, PROFILE_SECTIONS, SECTION_LABEL,
  REGISTRATION_STANDING, REMINDER_KINDS, REMINDER_OFFSETS, SHAREABLE_SECTIONS, VERIFIABLE_KINDS,
  type ItemKind, type OptionalField, type ProfileSection, type ReminderKind,
} from "./professional/profile-vocabulary";

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

export type IntPolicyKey = "reminder_horizon_days" | "share_link_max_days" | "ai_hourly_limit" | "scholar_questions_per_request" | "scholar_materials_per_person"
  | "scholar_insight_min_answers" | "scholar_insight_window_days" | "scholar_upload_max_mb" | "scholar_pdf_max_pages" | "scholar_pptx_max_slides"
  | "scholar_upload_session_files" | "scholar_upload_session_mb" | "scholar_session_max_steps" | "scholar_tutor_turns"
  | "scholar_revision_quantity" | "scholar_srs_mastery_reps" | "scholar_srs_mastery_days" | "scholar_srs_max_interval_days" | "scholar_srs_harder_interval_percent";
export type SetPolicyKey = "passport_achievement_kinds" | "scholar_onboarding_fields" | "professional_registration_required" | "professional_document_kinds"
  | "professional_verification_kinds" | "professional_reminder_kinds" | "professional_reminder_offsets" | "professional_reminder_standings" | "professional_share_sections" | "scholar_upload_formats" | "scholar_learning_actions"
  | "scholar_revision_formats" | "scholar_revision_modes" | "scholar_case_contexts" | "scholar_case_entries" | "scholar_case_dimensions";
/** COMPETEN-SCHOLAR-01 S1: which shared catalogues (framework ids) each experience may offer. */
export type CataloguePolicyKey = "scholar_catalogues" | "professional_catalogues" | "scholar_reference_collections";
/** COMPETEN-SCHOLAR-JOIN-01: the educational context a person gives when they join Scholar. */
export type ProgrammesPolicyKey = "scholar_onboarding_programmes";
export type OptionsPolicyKey = "scholar_institutions"
  | "professional_professions" | "professional_titles" | "professional_jurisdictions" | "professional_statuses" | "professional_qualification_types"
  | "professional_registration_bodies" | "professional_practice_settings" | "professional_specialties" | "professional_career_interests";
/** COMPETEN-PROFESSIONAL-PROFILE-01: an ORDERED choice from a fixed list (form fields, profile sections). */
export type SequencePolicyKey = "professional_registration_fields" | "professional_profile_sections";
export type LevelsPolicyKey = "scholar_programme_levels";
/** One value from a fixed list. P0: the least-reviewed content status Scholar offers (migration 394). */
export type ChoicePolicyKey = "scholar_catalogue_min_status" | "professional_profile_ai"
  | "scholar_default_action" | "scholar_beyond_notes" | "scholar_explanation_depth" | "scholar_check_behaviour" | "scholar_learning_objectives" | "scholar_learning_history"
  | "scholar_revision_difficulty" | "scholar_revision_feedback" | "scholar_revision_generation" | "scholar_revision_recommendations" | "scholar_short_answer_marking"
  | "scholar_case_generation" | "scholar_case_mode" | "scholar_case_reasoning_feedback";
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

export const POLICIES: readonly PolicyDef[] = [
  {
    key: "reminder_horizon_days", kind: "int", product: "Professional", unit: "days",
    label: "Reminder lead time",
    help: "How many days before a recorded credential or registration expires that the person is reminded, in the app and (if they opted in) by email.",
    fallback: REMINDER_HORIZON_DAYS, min: 7, max: 180,
    limitReason: "Under a week leaves no time to renew. Over six months reminds about something not yet actionable.",
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
    limitReason: "Only the six formats migration 416 stores. Default: all.",
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
    fallback: "ai_then_self",
    limitReason: "A match with an accepted answer is always marked by code first. AI evaluation is always labelled.",
  },
  {
    key: "scholar_revision_recommendations", kind: "choice", product: "Scholar",
    label: "Revision recommendations",
    help: "Whether the Revision workspace suggests what to revise next, from the student's own answers and reviews.",
    options: [{ value: "on", label: "Show recommendations" }, { value: "off", label: "Do not show" }],
    fallback: "on",
    limitReason: "Recommendations come only from recorded answers and reviews, each with its reason.",
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
  ...PROFESSIONAL_PROFILE_POLICIES,
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
  /** JOIN-01: programme codes offered at join, or null for every active programme. */
  scholarOnboardingProgrammes: string[] | null;
  scholarProgrammeLevels: Record<string, ContextOption[]>;
  scholarInstitutions: ContextOption[];
  scholarOnboardingFields: ("level" | "institution")[];
  /** P0: the least-reviewed content status Scholar offers. Default "unreviewed": everything, labelled. */
  scholarCatalogueMinStatus: ContentStatusLevel;
  /** COMPETEN-PROFESSIONAL-PROFILE-01: the registration form and profile, as configured. */
  professionalProfile: ProfessionalProfilePolicy;
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

type Row = { config_path: string; published: any };

/** Pure: the effective policy from the partition's rows. Drafts are never read. */
export function resolvePolicy(rows: readonly Row[]): IndividualPolicy {
  const published = new Map(rows.filter(r => byPath.has(r.config_path)).map(r => [r.config_path, r.published]));
  const int = (key: IntPolicyKey) => clampInt(policyDef(key) as IntPolicy, published.get(policyPath(key)));
  return {
    reminderHorizonDays: int("reminder_horizon_days"),
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
    scholarOnboardingProgrammes: clampProgrammes(policyDef("scholar_onboarding_programmes") as ProgrammesPolicy, published.get(policyPath("scholar_onboarding_programmes"))),
    scholarProgrammeLevels: clampLevels(policyDef("scholar_programme_levels") as LevelsPolicy, published.get(policyPath("scholar_programme_levels"))),
    scholarInstitutions: clampOptions(policyDef("scholar_institutions") as OptionsPolicy, published.get(policyPath("scholar_institutions"))),
    scholarOnboardingFields: clampSet(policyDef("scholar_onboarding_fields") as SetPolicy, published.get(policyPath("scholar_onboarding_fields"))) as ("level" | "institution")[],
    scholarCatalogueMinStatus: clampChoice(policyDef("scholar_catalogue_min_status") as ChoicePolicy, published.get(policyPath("scholar_catalogue_min_status"))) as ContentStatusLevel,
    professionalProfile: resolveProfessionalProfile(published),
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

export const DEFAULT_POLICY: IndividualPolicy = resolvePolicy([]);

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
