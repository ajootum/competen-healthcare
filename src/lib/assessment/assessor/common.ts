// Assessor workspace (Checklist Studio S4): shared types and helpers. Pure, no database access.
//
// WHO MAY READ WHAT. This directory is the ONLY code in the HQ plane that reads the capture tables (instances, answers,
// evidence, comments, outcomes, grants, pinned layouts). Two rules keep that narrow, and the assessment-core harness
// proves both by reading the source:
//   1. every read of an instance or a grant is filtered by the actor: respondent_id (my work), granted_by (the grants I
//      made). The one exception is progression.ts, which reads the SUBJECT's submitted assessor-evaluated outcomes to
//      compute a stage on the server, and returns nothing of them.
//   2. every read of an answer, an evidence row, a comment or an outcome takes an OwnedInstance, a value only own() can make.
// Decisions about progression are NEVER read here: asmt_progression_decision has no entry in the plane allowlist.
import type { createAdminClient } from "@/lib/supabase/server";

export type Admin = ReturnType<typeof createAdminClient>;

export const ASSESS_CAPABILITY = "hq.assessment.instrument.assess";
export const ASSIGN_CAPABILITY = "hq.assessment.assessor.assign";

/** Shown where the capture tables are not applied on this environment. A page fails closed rather than erroring. */
export const NOT_SET_UP = "Checklist assessments are not set up on this environment yet (migrations 890 to 892).";

export type Res<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
export const okRes = <T>(value: T): Res<T> => ({ ok: true, value });
export const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** The text a database guard raised, without the table prefix, for showing to a person. Unknown errors are not echoed. */
export function guardMessage(err: { message?: string; code?: string } | null | undefined): string {
  const m = String(err?.message ?? "");
  const hit = /^asmt_[a-z_]+:\s*([\s\S]+)$/.exec(m);
  if (hit) return hit[1].split("\n")[0].trim();
  return "The database refused that change.";
}

/** A database error that means the migration is not applied here (a missing table or function). */
export function isMissingRelation(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  const c = String(err.code ?? "");
  return c === "42P01" || c === "42883" || c === "PGRST205" || c === "PGRST202" || /does not exist|could not find the (table|function)/i.test(String(err.message ?? ""));
}

// ── grants ───────────────────────────────────────────────────────────────────────────────────────────────────
export type GrantRow = {
  id: string; instrument_id: string; subject_kind: string; subject_id: string; subject_user_id: string | null;
  respondent_id: string; respondent_role: string; appointment_id: string; granted_by: string; reason: string;
  valid_from: string; valid_until: string | null; accepted_at: string | null; ended_at: string | null; end_reason: string | null; created_at: string;
};
export const GRANT_COLS = "id, instrument_id, subject_kind, subject_id, subject_user_id, respondent_id, respondent_role, appointment_id, granted_by, reason, valid_from, valid_until, accepted_at, ended_at, end_reason, created_at";

export type GrantState = "ended" | "expired" | "pending" | "not_yet" | "live";

/** The state of a grant now. Live only when accepted, not ended and inside its dates: the same rule as asmt_grant_is_live. */
export function grantState(g: Pick<GrantRow, "accepted_at" | "ended_at" | "valid_from" | "valid_until">, now: Date = new Date()): GrantState {
  if (g.ended_at) return "ended";
  const t = now.getTime();
  if (g.valid_until && new Date(g.valid_until).getTime() <= t) return "expired";
  if (!g.accepted_at) return "pending";
  if (new Date(g.valid_from).getTime() > t) return "not_yet";
  return "live";
}

export const GRANT_STATE_LABEL: Record<GrantState, string> = {
  ended: "Ended", expired: "Expired", pending: "Waiting for the person to accept", not_yet: "Starts later", live: "Ready",
};

// ── instances ────────────────────────────────────────────────────────────────────────────────────────────────
export type InstanceRow = {
  id: string; instrument_version_id: string; subject_kind: string; subject_id: string; subject_user_id: string | null;
  respondent_role: string; respondent_id: string | null; respondent_snapshot: Record<string, unknown>; grant_id: string | null;
  owner_scope: string; status: "in_progress" | "submitted" | "withdrawn"; attestation: string; amends_instance_id: string | null;
  started_at: string; submitted_at: string | null;
};
export const INSTANCE_COLS = "id, instrument_version_id, subject_kind, subject_id, subject_user_id, respondent_role, respondent_id, respondent_snapshot, grant_id, owner_scope, status, attestation, amends_instance_id, started_at, submitted_at";

declare const ownedBrand: unique symbol;
/** An instance row proved to belong to the actor as assessor. Only own() makes one. */
export type OwnedInstance = InstanceRow & { readonly [ownedBrand]: true };

/** "checklist_assessor" -> "Checklist assessor" */
export const humanize = (code: string): string => {
  const s = code.replace(/[_-]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
};
