/* eslint-disable @typescript-eslint/no-explicit-any */
import { COHORT_DIMENSIONS, MEASURES, type CohortDimension, type MeasureCode } from "./data-contracts";

// ── CKRI GOVERNANCE ── COMPETEN-KNOWLEDGE-RESEARCH-01 s3 (K1) and s10, migration 440 ──────────────────────────────
//
// Competen Knowledge & Research Intelligence reuses the Holdings engines and adds only what they lacked: a record of
// permitted purposes, the two optional participation choices, research-project approval, and disclosure control.
//
// ⚠ FOUR PERMISSIONS, FOUR RECORDS, NEVER ONE CONSENT.
//   personal_ai_learning   individual_scholar_consent (372), Scholar's own. CKRI never writes it.
//   collective_analytics   ckri_participation (440), one per person.
//   content_contribution   case_candidacy (423), per offered item. Owner-disabled, and CKRI never writes it.
//   research_study         ckri_participation (440), one per person per recruiting study.
// Each is shown, granted and withdrawn on its own. Declining or withdrawing any of the CKRI two removes no Scholar
// learning: nothing in Scholar reads ckri_participation (the harness proves it).
//
// ⚠ POLICY TUNES, CODE AND THE DATABASE ENFORCE. The no-code policy (CONFIG-002, scope platform / holdings_ckri,
// path holdings.ckri.policy, drafted and published through the Workspace Configuration Engine and audited in
// workspace_config_audit) can raise the minimum cohort, switch measures and cohort dimensions off, and set retention.
// It cannot add a field (data-contracts.ts), lower the cohort below the database floor of 5 (440, 441), give anyone
// row-level access (440 makes it unrepresentable) or open the gate below.
//
// ⚠ THE GATE (CLAUDE.md lifecycle state 3). Production may not have 440 to 443 when this code is on main. Everything
// that STARTS CKRI work -- a participation grant, a purpose, a project, a snapshot -- runs only while the platform flag
// `ckri_research` is ON. Unwritten or unreadable is OFF. A person's withdrawal and their view of their own choices are
// NEVER gated: a privacy right does not wait for a launch.

export const CKRI_SCOPE = { scopeType: "platform", scopeRef: "holdings_ckri" } as const;
export const CKRI_POLICY_PATH = "holdings.ckri.policy";
export const CKRI_FLAG = "ckri_research";
export const CKRI_OFF = "Knowledge & Research Intelligence is not switched on in this environment.";

export const PERMISSIONS = [
  { code: "personal_ai_learning", label: "Personal AI learning", record: "individual_scholar_consent", owner: "scholar",
    summary: "AI helps you learn from your own material. Nothing leaves your account for anyone else." },
  { code: "collective_analytics", label: "Collective educational analytics", record: "ckri_participation", owner: "ckri",
    summary: "Structured results of your learning (never your uploads, conversations or answers in your own words) are counted with many others to improve education. Only groups large enough to protect individuals are reported." },
  { code: "content_contribution", label: "Contribution of specific content", record: "case_candidacy", owner: "cases",
    summary: "You offer one specific item, such as a case, for a shared library. Not available during the pilot." },
  { code: "research_study", label: "Participation in an identified research study", record: "ckri_participation", owner: "ckri",
    summary: "You join one named, ethically approved study. Each study is a separate choice." },
] as const;
export type PermissionCode = (typeof PERMISSIONS)[number]["code"];
export type CkriPermission = "collective_analytics" | "research_study";

export type CkriPolicy = {
  /** Smallest cohort any reported cell may describe. The database refuses below 5 whatever this says. */
  minCohort: number;
  /** Also suppress the next-smallest cell of a group when exactly one was suppressed, so it cannot be subtracted back. */
  complementarySuppression: boolean;
  /** Counts are rounded to this base before they are stored (1, 5 or 10). */
  roundTo: 1 | 5 | 10;
  /** Measures that may be computed. A measure whose source is pending is never computed, whatever this says. */
  measures: Record<MeasureCode, boolean>;
  /** Cohort dimensions a snapshot may group by. Institution is off by default: its cohorts are the smallest. */
  cohortDimensions: CohortDimension[];
  /** Reporting period. */
  periodGrain: "month" | "quarter";
  /** A snapshot is deleted this many days after it was built. */
  snapshotRetentionDays: number;
  /** Measures educators may see in the educator intelligence view (K3). */
  educatorMeasures: MeasureCode[];
};

const ALL_MEASURES = MEASURES.map(m => m.code);
export const DEFAULT_CKRI_POLICY: CkriPolicy = {
  minCohort: 10, complementarySuppression: true, roundTo: 5,
  measures: Object.fromEntries(ALL_MEASURES.map(c => [c, false])) as Record<MeasureCode, boolean>,
  cohortDimensions: ["programme"], periodGrain: "month", snapshotRetentionDays: 365, educatorMeasures: [],
};
export const COHORT_FLOOR = 5;

const int = (v: unknown, lo: number, hi: number, fb: number) => { const n = Number(v); return Number.isInteger(n) ? Math.min(hi, Math.max(lo, n)) : fb; };

/** Pure: a published CKRI policy, clamped, over defaults that compute nothing. */
export function resolveCkriPolicy(s: any): CkriPolicy {
  const d = DEFAULT_CKRI_POLICY;
  const measures = Object.fromEntries(ALL_MEASURES.map(c => [c, s?.measures?.[c] === true && MEASURES.find(m => m.code === c)!.status === "available"])) as Record<MeasureCode, boolean>;
  const dims = Array.isArray(s?.cohortDimensions) ? COHORT_DIMENSIONS.filter(x => s.cohortDimensions.includes(x)) : d.cohortDimensions;
  return {
    minCohort: int(s?.minCohort, COHORT_FLOOR, 1000, d.minCohort),
    complementarySuppression: typeof s?.complementarySuppression === "boolean" ? s.complementarySuppression : d.complementarySuppression,
    roundTo: ([1, 5, 10] as const).includes(s?.roundTo) ? s.roundTo : d.roundTo,
    measures,
    cohortDimensions: dims.length ? dims : d.cohortDimensions,
    periodGrain: s?.periodGrain === "quarter" ? "quarter" : "month",
    snapshotRetentionDays: int(s?.snapshotRetentionDays, 30, 1825, d.snapshotRetentionDays),
    educatorMeasures: Array.isArray(s?.educatorMeasures) ? ALL_MEASURES.filter(c => s.educatorMeasures.includes(c) && measures[c]) : [],
  };
}

/** The published CKRI policy. Fail-soft to the defaults, which compute nothing. */
export async function loadCkriPolicy(admin: any): Promise<CkriPolicy> {
  try {
    const { data, error } = await admin.from("workspace_config_overrides").select("published")
      .eq("scope_type", CKRI_SCOPE.scopeType).eq("scope_ref", CKRI_SCOPE.scopeRef).eq("config_path", CKRI_POLICY_PATH).maybeSingle();
    return error ? { ...DEFAULT_CKRI_POLICY } : resolveCkriPolicy(data?.published);
  } catch { return { ...DEFAULT_CKRI_POLICY }; }
}

export async function ckriEnabled(admin: any): Promise<boolean> {
  try {
    const { data, error } = await admin.from("practice_platform_flags").select("enabled").eq("flag", CKRI_FLAG).maybeSingle();
    return !error && data?.enabled === true;
  } catch { return false; }
}

// ── The participation notice ── configuration, never code (the consent-gate.ts pattern) ───────────────────────
//
// A person can grant a CKRI permission only to a notice they can open: a version AND a URL, set per environment. No
// counsel-approved participation notice exists yet (docs/legal/drafts has none), so in production both are unset and
// every grant is refused. Withdrawal never needs the notice.
export type ParticipationNotice = { version: string; url: string } | null;
export function participationNotice(env: Record<string, string | undefined> = process.env): ParticipationNotice {
  const version = env.CKRI_PARTICIPATION_NOTICE_VERSION?.trim() ?? "";
  const url = env.CKRI_PARTICIPATION_NOTICE_URL?.trim() ?? "";
  return /^[a-z0-9][a-z0-9._/-]{0,58}$/i.test(version) && /^https:\/\//.test(url) ? { version, url } : null;
}
export const NOTICE_MISSING = "The research participation notice is not published yet, so this choice cannot be turned on. Nothing has changed.";

// ── A person's four choices, read from the four records ─────────────────────────────────────────────────────────

export type ChoiceState = { state: "granted" | "withdrawn" | "not_chosen" | "unavailable"; noticeVersion: string | null; at: string | null };
export type MyChoices = {
  personal_ai_learning: ChoiceState;
  collective_analytics: ChoiceState;
  content_contribution: ChoiceState;
  research_studies: { projectId: string; code: string; title: string; recruiting: boolean; choice: ChoiceState }[];
};

const none: ChoiceState = { state: "not_chosen", noticeVersion: null, at: null };
const fromRow = (r: any, grantedKey = "granted_at", offKey = "withdrawn_at"): ChoiceState => !r ? none
  : r.status === "granted" ? { state: "granted", noticeVersion: r.notice_version ?? r.attestation_version ?? null, at: r[grantedKey] ?? null }
  : { state: "withdrawn", noticeVersion: r.notice_version ?? r.attestation_version ?? null, at: r[offKey] ?? null };

/** Pure: shape the four records into four separate choices. */
export function shapeChoices(input: { consent: any; analytics: any; candidacy: any; studies: any[]; projects: any[] }): MyChoices {
  const byProject = new Map((input.studies ?? []).map(r => [r.project_id, r]));
  return {
    personal_ai_learning: fromRow(input.consent, "granted_at", "revoked_at"),
    collective_analytics: fromRow(input.analytics),
    content_contribution: input.candidacy ? fromRow(input.candidacy, "granted_at", "revoked_at") : { state: "unavailable", noticeVersion: null, at: null },
    research_studies: (input.projects ?? []).filter(p => p.status === "recruiting" || byProject.has(p.id)).map(p => ({
      projectId: p.id, code: p.code, title: p.title, recruiting: p.status === "recruiting", choice: fromRow(byProject.get(p.id)),
    })),
  };
}

export async function readMyChoices(admin: any, userId: string): Promise<{ ok: true; data: MyChoices } | { ok: false }> {
  try {
    const [consent, part, cand, projects] = await Promise.all([
      admin.from("individual_scholar_consent").select("status, notice_version, granted_at, revoked_at").eq("user_id", userId).eq("feature", "ai_processing_uploads").maybeSingle(),
      admin.from("ckri_participation").select("permission, project_id, status, notice_version, granted_at, withdrawn_at").eq("user_id", userId),
      admin.from("case_candidacy").select("status, attestation_version, granted_at, revoked_at").eq("user_id", userId).maybeSingle(),
      admin.from("ckri_research_project").select("id, code, title, status").in("status", ["recruiting", "closed", "withdrawn"]),
    ]);
    if (part.error || projects.error) return { ok: false };
    const rows = part.data ?? [];
    return { ok: true, data: shapeChoices({
      consent: consent.error ? null : consent.data, candidacy: cand.error ? null : cand.data,
      analytics: rows.find((r: any) => r.permission === "collective_analytics") ?? null,
      studies: rows.filter((r: any) => r.permission === "research_study"), projects: projects.data ?? [],
    }) };
  } catch { return { ok: false }; }
}

/**
 * Grant or withdraw ONE CKRI permission. The database decides whether a study is joinable (440) and writes the event.
 * The caller has already checked the gate and the notice for a grant. A withdrawal of a choice never made is a no-op.
 */
export async function setParticipation(admin: any, userId: string, permission: CkriPermission, projectId: string | null, grant: boolean, noticeVersion: string | null)
  : Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  if (permission === "research_study" && !projectId) return { ok: false, error: "Say which study." };
  if (permission === "collective_analytics" && projectId) return { ok: false, error: "Collective analytics is one choice, not per study." };
  const scopeKey = permission === "collective_analytics" ? "all" : projectId!;
  const { data: cur, error: readErr } = await admin.from("ckri_participation").select("id, status, notice_version")
    .eq("user_id", userId).eq("permission", permission).eq("scope_key", scopeKey).maybeSingle();
  if (readErr) return { ok: false, error: "Your choice could not be read just now. Nothing has changed." };
  if (!grant) {
    if (!cur || cur.status === "withdrawn") return { ok: true, changed: false };
    const { error } = await admin.from("ckri_participation").update({ status: "withdrawn" }).eq("id", cur.id);
    return error ? { ok: false, error: "Your withdrawal could not be saved. Try again." } : { ok: true, changed: true };
  }
  if (!noticeVersion) return { ok: false, error: NOTICE_MISSING };
  if (cur?.status === "granted" && cur.notice_version === noticeVersion) return { ok: true, changed: false };
  const write = cur
    ? admin.from("ckri_participation").update({ status: "granted", notice_version: noticeVersion }).eq("id", cur.id)
    : admin.from("ckri_participation").insert({ user_id: userId, permission, scope_key: scopeKey, project_id: projectId, status: "granted", notice_version: noticeVersion });
  const { error } = await write;
  if (error) return { ok: false, error: /recruiting/.test(error.message ?? "") ? "That study is not recruiting." : "Your choice could not be saved. Nothing has changed." };
  return { ok: true, changed: true };
}

/** Database refusals (440) carry their own sentence after the table name. Return that sentence, never the SQL. */
export function dbRefusal(error: any, fallback: string): string {
  const m = String(error?.message ?? "").match(/^ckri_[a-z_]+: (.{4,300})$/);
  return m ? m[1] : fallback;
}
