/* eslint-disable @typescript-eslint/no-explicit-any */
import { isNotProvisioned } from "../access";
import type { ProfessionalProfilePolicy } from "../policy";
import type { ContextColumns, ItemInput } from "./profile-form";
import { missingForCompletion } from "./profile-form";
import type { ProfileItem } from "./profile-records";
import type { RegistrationStep, WithdrawReason } from "./profile-vocabulary";
import { ORIGIN } from "./vocabulary";

// ── THE PROFESSIONAL PROFILE, READ AND WRITTEN ── COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1, migration 450 ─────
//
// The ONE reader and writer of 450's columns and tables, by the person's own id and nothing else.
//
// ⚠ NOT PROVISIONED IS NOT UNREADABLE (record.ts's rule). Before 450 is applied the columns and tables do not
// exist: `provisioned` is false, and every page behaves exactly as the Professional MVP did -- no form, no
// sections, no writes. A failed read is null, and the page says it could not be checked.
//
// ⚠ THE HISTORY IS THE DATABASE'S. Nothing here writes individual_professional_profile_context: 450's trigger
// does, on every change of a context field, whoever makes it. A record is never updated in place: a change
// inserts a new version naming the one it supersedes, and 450's trigger closes the old one.

const POINTER_450 = "profession_code, self_declared_profession, practice_jurisdiction_code, self_declared_practice_jurisdiction, "
  + "professional_status_code, self_declared_professional_status, primary_specialty_code, self_declared_primary_specialty, "
  + "professional_title_code, self_declared_professional_title, practice_setting_code, self_declared_practice_setting, "
  + "self_declared_current_role, self_declared_years_experience, self_declared_summary, registration_step, registration_completed_at, "
  + "self_declared_registration_body, self_declared_registration_number, self_declared_registration_country, self_declared_registration_expires_on, updated_at";
const HISTORY_COLUMNS = "self_declared_profession, self_declared_practice_jurisdiction, self_declared_professional_status, self_declared_primary_specialty, "
  + "self_declared_professional_title, self_declared_practice_setting, self_declared_current_role, self_declared_years_experience, "
  + "self_declared_registration_body, self_declared_registration_country, effective_from, effective_to";
const ITEM_COLUMNS = "id, section, title, type_code, type_label, organisation, jurisdiction, self_declared_identifier, started_on, ended_on, expires_on, "
  + "target_on, detail, document_name, evidence_class, supersedes_id, superseded_at, withdrawn_at, withdrawn_reason, created_at";

export type ProfilePointer = ContextColumns & {
  self_declared_summary: string | null; registration_step: RegistrationStep | null; registration_completed_at: string | null;
  self_declared_registration_body: string | null; self_declared_registration_number: string | null;
  self_declared_registration_country: string | null; self_declared_registration_expires_on: string | null; updated_at: string | null;
};
export type ContextPeriod = {
  self_declared_profession: string | null; self_declared_practice_jurisdiction: string | null; self_declared_professional_status: string | null;
  self_declared_primary_specialty: string | null; self_declared_professional_title: string | null; self_declared_practice_setting: string | null;
  self_declared_current_role: string | null; self_declared_years_experience: number | null;
  self_declared_registration_body: string | null; self_declared_registration_country: string | null;
  effective_from: string; effective_to: string | null;
};
export type ProfessionalProfileView = {
  /** False when migration 450 is not applied here. */
  provisioned: boolean;
  /** undefined: read, no row yet. null: could not be read. */
  pointer: ProfilePointer | undefined | null;
  history: ContextPeriod[] | null;
  items: ProfileItem[] | null;
};

export async function loadProfessionalProfile(admin: any, userId: string): Promise<ProfessionalProfileView> {
  let provisioned = true;
  const settle = async (p: PromiseLike<any>): Promise<any[] | null> => {
    try {
      const r = await p;
      if (r?.error && isNotProvisioned(r.error)) { provisioned = false; return []; }
      return r?.error ? null : (r?.data ?? []);
    } catch { return null; }
  };
  const [pointer, history, items] = await Promise.all([
    settle(admin.from("individual_professional_profile").select(POINTER_450).eq("user_id", userId).limit(1)),
    settle(admin.from("individual_professional_profile_context").select(HISTORY_COLUMNS).eq("user_id", userId).order("effective_from", { ascending: false }).limit(200)),
    settle(admin.from("individual_professional_profile_item").select(ITEM_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }).limit(1000)),
  ]);
  if (!provisioned) return { provisioned, pointer: undefined, history: [], items: [] };
  return { provisioned, pointer: pointer === null ? null : (pointer[0] ?? undefined), history, items };
}

/** Where registration stands. `not_provisioned`: 450 is absent, so the MVP behaviour applies unchanged. */
export type RegistrationState = "not_provisioned" | "unreadable" | "complete" | "incomplete";
export function registrationState(view: ProfessionalProfileView): RegistrationState {
  if (!view.provisioned) return "not_provisioned";
  if (view.pointer === null) return "unreadable";
  return view.pointer?.registration_completed_at ? "complete" : "incomplete";
}

type Write = { ok: true; id: string | null; created: boolean } | { ok: false; status: number; error: string };
const failed = (what: string): Write => ({ ok: false, status: 500, error: `Your ${what} could not be saved just now. Try again shortly.` });

/**
 * Save context fields, the summary and where registration stands, on the person's own pointer row. Creates
 * the row the first time (373's own reminder mark is left alone). `complete` finishes registration -- once,
 * and only with every required fact present; the schema refuses it otherwise.
 */
export async function saveContext(admin: any, userId: string, policy: ProfessionalProfilePolicy, change: {
  columns: Partial<ContextColumns>; summary?: string | null; step?: RegistrationStep | null; complete?: boolean;
}): Promise<Write & { missing?: string[] }> {
  const { data: existing, error: readErr } = await admin.from("individual_professional_profile")
    .select(POINTER_450 + ", id").eq("user_id", userId).maybeSingle();
  if (readErr) return isNotProvisioned(readErr) ? { ok: false, status: 409, error: "Professional registration is not set up on this environment yet." } : failed("details");

  const patch: Record<string, unknown> = { ...change.columns };
  if (change.summary !== undefined) patch.self_declared_summary = change.summary;
  if (change.step !== undefined && !existing?.registration_completed_at) patch.registration_step = change.step;
  if (change.complete && !existing?.registration_completed_at) {
    const merged = { ...(existing ?? {}), ...change.columns };
    const missing = missingForCompletion(merged, policy);
    if (missing.length) return { ok: false, status: 400, error: "Some required details are missing.", missing };
    patch.registration_completed_at = new Date().toISOString();
    patch.registration_step = null;
  }
  if (!Object.keys(patch).length) return { ok: true, id: existing?.id ?? null, created: false };

  if (existing) {
    const { error } = await admin.from("individual_professional_profile")
      .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", existing.id).eq("user_id", userId);
    return error ? failed("details") : { ok: true, id: existing.id, created: false };
  }
  const { data, error } = await admin.from("individual_professional_profile")
    .insert({ ...patch, user_id: userId, experience_code: ORIGIN }).select("id").single();
  return error || !data ? failed("details") : { ok: true, id: data.id, created: true };
}

/** A new profile record, or a new version of one (supersedes_id). The 450 trigger closes the old version. */
export async function addItem(admin: any, userId: string, input: ItemInput, doc: Record<string, unknown> | null): Promise<Write & { evidenceClass?: string }> {
  if (input.supersedes_id) {
    const { data: before, error } = await admin.from("individual_professional_profile_item")
      .select("id, section, superseded_at, withdrawn_at").eq("id", input.supersedes_id).eq("user_id", userId).maybeSingle();
    if (error) return failed("record");
    if (!before || before.section !== input.section) return { ok: false, status: 404, error: "That record is not on your profile." };
    if (before.superseded_at || before.withdrawn_at) return { ok: false, status: 409, error: "That record has already been changed or withdrawn. Refresh to see the current version." };
  }
  const { data, error } = await admin.from("individual_professional_profile_item")
    .insert({ ...input, ...(doc ?? {}), user_id: userId, experience_code: ORIGIN }).select("id, evidence_class").single();
  if (error || !data) return isNotProvisioned(error) ? { ok: false, status: 409, error: "The professional profile is not set up on this environment yet." } : failed("record");
  return { ok: true, id: data.id, created: true, evidenceClass: data.evidence_class };
}

/** The document of the version being superseded, carried to the new version when no new file replaces it. */
export async function documentOf(admin: any, userId: string, id: string): Promise<Record<string, unknown> | null> {
  const { data } = await admin.from("individual_professional_profile_item")
    .select("document_path, document_name, document_mime, document_bytes").eq("id", id).eq("user_id", userId).maybeSingle();
  return data?.document_path ? data : null;
}

/** Withdraw a current record. Kept in history, never deleted. Only the owner, only once. */
export async function withdrawItem(admin: any, userId: string, id: string, reason: WithdrawReason): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_profile_item")
    .update({ withdrawn_at: new Date().toISOString(), withdrawn_reason: reason })
    .eq("id", id).eq("user_id", userId).is("superseded_at", null).is("withdrawn_at", null).select("id").maybeSingle();
  if (error) return failed("change");
  return data ? { ok: true, id: data.id, created: false } : { ok: false, status: 404, error: "That record is not a current record on your profile." };
}
