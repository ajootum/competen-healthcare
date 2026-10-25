/* eslint-disable @typescript-eslint/no-explicit-any */
import { isNotProvisioned } from "../access";
import { ORIGIN } from "./vocabulary";

// ── MY PROFESSIONAL PROGRESS: WHAT IT STORES ── COMPETEN-PROFESSIONAL-PROGRESS-01 s3, migration 550 ─────────────────────────
//
// THE ONE WRITER of 550's progress tables, by the person's own id: their display preference, named saved views (a view, a
// period and simple filters), their decisions on next steps (append-only, latest wins) and progress snapshots they ask
// for (counts and record keys only, immutable). Nothing here writes a source record: a next step only OPENS its owning
// module, so accepting one never creates a goal, changes evidence, starts a purchase or requests verification.

export type Write = { ok: true; id: string | null } | { ok: false; status: number; error: string };
const failed = (what: string, error?: any): Write => isNotProvisioned(error)
  ? { ok: false, status: 409, error: "Saving progress settings is not set up on this environment yet." }
  : { ok: false, status: 500, error: `Your ${what} could not be saved just now. Try again shortly.` };

export type ProgressState = {
  provisioned: boolean;
  preference: { default_period: string; default_view: string } | null;
  views: { id: string; name: string; view_code: string; period_code: string; filters: Record<string, unknown> }[] | null;
  decisions: { recommendation_key: string; decision: string; deferred_until: string | null; decided_at: string }[] | null;
  snapshots: { id: string; period_code: string; period_from: string | null; period_to: string | null; summary: any; created_at: string }[] | null;
};

export async function loadProgressState(admin: any, userId: string): Promise<ProgressState> {
  let provisioned = true;
  const settle = async (p: PromiseLike<any>): Promise<any[] | null> => {
    try { const r = await p; if (r?.error && isNotProvisioned(r.error)) { provisioned = false; return []; } return r?.error ? null : (r?.data ?? []); } catch { return null; }
  };
  const [pref, views, decisions, snapshots] = await Promise.all([
    settle(admin.from("individual_professional_progress_preference").select("default_period, default_view").eq("user_id", userId).limit(1)),
    settle(admin.from("individual_professional_progress_view").select("id, name, view_code, period_code, filters").eq("user_id", userId).order("created_at").limit(50)),
    settle(admin.from("individual_professional_progress_decision").select("recommendation_key, decision, deferred_until, decided_at").eq("user_id", userId).order("decided_at", { ascending: false }).limit(2000)),
    settle(admin.from("individual_professional_progress_snapshot").select("id, period_code, period_from, period_to, summary, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50)),
  ]);
  if (!provisioned) return { provisioned, preference: null, views: [], decisions: [], snapshots: [] };
  return { provisioned, preference: pref ? pref[0] ?? null : null, views, decisions, snapshots };
}

export async function decideStep(admin: any, userId: string, key: string, decision: "accepted" | "deferred" | "dismissed", deferredUntil: string | null): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_progress_decision").insert({
    user_id: userId, experience_code: ORIGIN, recommendation_key: key, decision, deferred_until: decision === "deferred" ? deferredUntil : null,
  }).select("id").single();
  return error || !data ? failed("decision", error) : { ok: true, id: data.id };
}

export async function savePreference(admin: any, userId: string, v: { period: string; view: string }): Promise<Write> {
  const { error } = await admin.from("individual_professional_progress_preference").upsert({
    user_id: userId, experience_code: ORIGIN, default_period: v.period, default_view: v.view, updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  return error ? failed("preference", error) : { ok: true, id: null };
}

export async function saveView(admin: any, userId: string, v: { name: string; view: string; period: string; filters: Record<string, unknown> }): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_progress_view").insert({
    user_id: userId, experience_code: ORIGIN, name: v.name, view_code: v.view, period_code: v.period, filters: v.filters,
  }).select("id").single();
  return error || !data ? failed("saved view", error) : { ok: true, id: data.id };
}

export async function deleteView(admin: any, userId: string, id: string): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_progress_view").delete().eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) return failed("saved view", error);
  return data ? { ok: true, id } : { ok: false, status: 404, error: "That view is not yours." };
}

/** An explicitly requested snapshot: counts by kind and the record keys shown, never their content. */
export async function saveSnapshot(admin: any, userId: string, v: { period: string; from: string | null; to: string | null; summary: Record<string, unknown>; configVersion: string | null }): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_progress_snapshot").insert({
    user_id: userId, experience_code: ORIGIN, period_code: v.period, period_from: v.from, period_to: v.to, summary: v.summary, config_version: v.configVersion,
  }).select("id").single();
  return error || !data ? failed("snapshot", error) : { ok: true, id: data.id };
}
