/* eslint-disable @typescript-eslint/no-explicit-any */
import { REMINDER_HORIZON_DAYS } from "./professional/vocabulary";
import { SHARE_DAYS_MAX } from "./professional/share";
import { INSIGHT_MIN_ANSWERS, INSIGHT_WINDOW_DAYS, MAX_MATERIALS_PER_PERSON, QUESTIONS_PER_REQUEST } from "./scholar/config";
import { STUDY_ACHIEVEMENT, STUDY_ACHIEVEMENT_KINDS, type StudyAchievementKind } from "./scholar/passport-items";

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
  | "scholar_insight_min_answers" | "scholar_insight_window_days";
export type SetPolicyKey = "passport_achievement_kinds";
/** COMPETEN-SCHOLAR-01 S1: which shared catalogues (framework ids) each experience may offer. */
export type CataloguePolicyKey = "scholar_catalogues" | "professional_catalogues";
export type PolicyKey = IntPolicyKey | SetPolicyKey | CataloguePolicyKey;

type Common = { label: string; help: string; product: "Professional" | "Scholar" | "Competen Individual"; limitReason: string };
export type IntPolicy = Common & { key: IntPolicyKey; kind: "int"; unit: string; fallback: number; min: number; max: number };
export type SetPolicy = Common & { key: SetPolicyKey; kind: "set"; options: readonly { value: string; label: string }[]; fallback: readonly string[] };
/** A list of framework ids. Options are not fixed in code: the route checks each against the library. */
export type CataloguePolicy = Common & { key: CataloguePolicyKey; kind: "catalogues"; max: number };
export type PolicyDef = IntPolicy | SetPolicy | CataloguePolicy;
export const CATALOGUES_MAX = 50;

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
  {
    key: "professional_catalogues", kind: "catalogues", product: "Professional", max: CATALOGUES_MAX,
    label: "Competency catalogues Professional may offer",
    help: "The shared competency catalogues a person may link a development need or evidence to in Competen Professional. Links already made keep their names.",
    limitReason: "Only shared, active, published catalogues can be chosen, at most 50. Empty by default: nothing is offered automatically.",
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

/** Pure: a catalogue allowlist from a stored settings object. Well-formed ids only, deduplicated, capped. */
export function clampCatalogues(p: CataloguePolicy, settings: any): string[] {
  if (settings == null || !Array.isArray(settings.ids)) return [];
  return [...new Set(settings.ids.filter((v: unknown): v is string => typeof v === "string" && UUID.test(v)).map((v: string) => v.toLowerCase()))].slice(0, p.max) as string[];
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
  if (def.kind === "catalogues") {
    if (!Array.isArray(raw) || raw.some(v => typeof v !== "string" || !UUID.test(v))) return { ok: false, error: `${def.label}: send the list of catalogue ids to allow.` };
    const ids = [...new Set(raw.map(v => v.toLowerCase()))];
    if (ids.length > def.max) return { ok: false, error: `${def.label}: at most ${def.max} catalogues. That limit is fixed.` };
    // Whether each id is a shared, active, published framework is checked by the route, against the library.
    return { ok: true, def, settings: { ids } };
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
  scholarInsightMinAnswers: number;
  scholarInsightWindowDays: number;
  passportAchievementKinds: StudyAchievementKind[];
  /** S1: framework ids each experience may offer. Empty by default. */
  scholarCatalogues: string[];
  professionalCatalogues: string[];
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
    scholarInsightMinAnswers: int("scholar_insight_min_answers"),
    scholarInsightWindowDays: int("scholar_insight_window_days"),
    passportAchievementKinds: clampSet(policyDef("passport_achievement_kinds") as SetPolicy, published.get(policyPath("passport_achievement_kinds"))) as StudyAchievementKind[],
    scholarCatalogues: clampCatalogues(policyDef("scholar_catalogues") as CataloguePolicy, published.get(policyPath("scholar_catalogues"))),
    professionalCatalogues: clampCatalogues(policyDef("professional_catalogues") as CataloguePolicy, published.get(policyPath("professional_catalogues"))),
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
 */
export function individualAiQuota(estate: { ok: boolean; used: number; limit: number; unreadable?: boolean }, policy: IndividualPolicy) {
  const limit = Math.min(estate.limit, policy.aiHourlyLimit);
  const unreadable = estate.unreadable === true;
  return { ok: !unreadable && estate.ok && estate.used < limit, used: estate.used, limit, unreadable };
}

/** What an Individual AI route answers when its quota refuses: 503 when unreadable, 429 at the limit. */
export function individualQuotaRefusal(quota: { ok: boolean; limit: number; unreadable: boolean }, noun = "AI requests"): { status: number; error: string } | null {
  if (quota.unreadable) return { status: 503, error: "Your AI allowance could not be checked just now, so nothing was sent. Try again shortly." };
  if (!quota.ok) return { status: 429, error: `You have reached the limit of ${quota.limit} ${noun} an hour. Try again later.` };
  return null;
}
