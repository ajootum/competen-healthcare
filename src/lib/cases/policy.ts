/* eslint-disable @typescript-eslint/no-explicit-any */

// ── THE CASE POLICY ── COMPETEN-HOLDINGS-AI-CONSUMPTION-01 s13: no-code, versioned, authorised, audited ──────────
//
// One CONFIG-002 document at scope platform / holdings_cases, path holdings.cases.policy, drafted and published
// through the Workspace Configuration Engine (every change versioned and in workspace_config_audit). The door that
// writes it is /api/hq/cases, behind hq.quality.case.publish.
//
// ⚠ POLICY TUNES, CODE AND THE DATABASE ENFORCE. Nothing here can open a boundary: the permission, the identifier
// screen, independence, scope, approval-before-publication and delivery-only-when-deliverable are 423, 422 and 395.
// Clinical approval counts stay where 395 keeps them (holdings.clinical.required_approvals).

import { CLASSIFICATION, type ClassificationKey } from "./blueprint";

export const CASE_SCOPE ={ scopeType: "platform", scopeRef: "holdings_cases" } as const;
export const CASE_POLICY_PATH = "holdings.cases.policy";

export type QueueWindow = "24h" | "7d" | "30d";
export type CasePolicy = {
  /** The attestation text a student agrees to when granting candidacy. A grant names the version it agreed to. */
  attestationVersion: string;
  /** Candidates nobody took into development are withdrawn and purged after this many days. */
  candidateRetentionDays: number;
  /** The queue's opening window. */
  queueWindow: QueueWindow;
  /** Offer a suitable library case before generating a private one (s10). */
  reuseFirst: boolean;
  /** How many library cases a search offers at most. */
  offerLimit: number;
  /** Whether a delivered case may pick values inside its approved variation rules. */
  variationsEnabled: boolean;
  /**
   * The classification a case must carry to be SUBMITTED for clinical review (owner, Stage 5B classification decision).
   * Never applied to saving a draft. Competencies are always required: 422 refuses a case that names none.
   */
  classificationRequired: Record<ClassificationKey, boolean>;
};

const NONE_REQUIRED = Object.fromEntries(CLASSIFICATION.map(k => [k, k === "competencies"])) as Record<ClassificationKey, boolean>;

export const DEFAULT_CASE_POLICY: CasePolicy = {
  attestationVersion: "case-attest/1", candidateRetentionDays: 180, queueWindow: "7d", reuseFirst: true, offerLimit: 5, variationsEnabled: true,
  classificationRequired: NONE_REQUIRED,
};

const int = (v: unknown, lo: number, hi: number, fb: number) => { const n = Number(v); return Number.isInteger(n) ? Math.min(hi, Math.max(lo, n)) : fb; };

/** Pure: a published case policy, clamped, over the defaults. */
export function resolveCasePolicy(s: any): CasePolicy {
  const d = DEFAULT_CASE_POLICY;
  return {
    attestationVersion: typeof s?.attestationVersion === "string" && /^case-attest\/\d{1,3}$/.test(s.attestationVersion) && ATTESTATION_TEXT[s.attestationVersion] ? s.attestationVersion : d.attestationVersion,
    candidateRetentionDays: int(s?.candidateRetentionDays, 7, 730, d.candidateRetentionDays),
    queueWindow: ["24h", "7d", "30d"].includes(s?.queueWindow) ? s.queueWindow : d.queueWindow,
    reuseFirst: typeof s?.reuseFirst === "boolean" ? s.reuseFirst : d.reuseFirst,
    offerLimit: int(s?.offerLimit, 1, 20, d.offerLimit),
    variationsEnabled: typeof s?.variationsEnabled === "boolean" ? s.variationsEnabled : d.variationsEnabled,
    classificationRequired: Object.fromEntries(CLASSIFICATION.map(k => [k, k === "competencies" || s?.classificationRequired?.[k] === true])) as Record<ClassificationKey, boolean>,
  };
}

/** The published case policy. Fail-soft to the defaults, which open nothing. */
export async function loadCasePolicy(admin: any): Promise<CasePolicy> {
  try {
    const { data, error } = await admin.from("workspace_config_overrides").select("published")
      .eq("scope_type", CASE_SCOPE.scopeType).eq("scope_ref", CASE_SCOPE.scopeRef).eq("config_path", CASE_POLICY_PATH).maybeSingle();
    return error ? { ...DEFAULT_CASE_POLICY } : resolveCasePolicy(data?.published);
  } catch { return { ...DEFAULT_CASE_POLICY }; }
}

/**
 * The attestation texts, by version. A student reads the text of the current version (Scholar renders it) and the
 * grant records which version it was. ⚠ PENDING LEGAL REVIEW: publishing student-derived cases is a production
 * dependency (owner Stage 5 approval). These words are a staging draft, not a legal instrument.
 */
export const ATTESTATION_TEXT: Record<string, { own_notes: string; licensed_to_share: string; terms: string }> = {
  "case-attest/1": {
    own_notes: "The material this case came from is my own notes, written by me.",
    licensed_to_share: "The material this case came from is material I am licensed to share for this purpose.",
    terms: "I agree that Competen may consider cases I choose to offer, one at a time, for a shared case library. An offered case is "
      + "screened to remove patient details and is never shown with my name. Educators may adapt it, and only a clinically approved "
      + "version is ever published. I can withdraw this permission at any time, and any case not yet taken into the library is then removed. "
      + "Offering a case never uses my AI allowance.",
  },
};

/**
 * THE GATE (CLAUDE.md, migration lifecycle state 3). Production may not have 422 and 423 when this code is on main, so
 * everything that would START case work -- granting candidacy, offering, the studio, searching, loading or starting a
 * library case -- runs only while the platform flag `case_library` is ON. Unwritten or unreadable is OFF. A student's
 * revocation, withdrawal and view of their own offers are NEVER gated: a privacy right does not wait for a launch.
 */
export const CASE_LIBRARY_FLAG = "case_library";
export const CASE_LIBRARY_OFF = "The case library is not switched on in this environment.";
export async function caseLibraryEnabled(admin: any): Promise<boolean> {
  try {
    const { data, error } = await admin.from("practice_platform_flags").select("enabled").eq("flag", CASE_LIBRARY_FLAG).maybeSingle();
    return !error && data?.enabled === true;
  } catch { return false; }
}
