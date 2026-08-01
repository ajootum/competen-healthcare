// PW-014 P5 / §4, §15 — governed emergency-access (break-glass) service. Records time-boxed, reasoned, audited
// grants; scope logic consults hasActiveBreakGlass() to permit emergency access beyond normal scope. Every invoke
// writes audit_log + a domain event. Fail-soft to 'not_provisioned' until migration 104 is applied. Service-role
// (admin client) only. Access is NEVER elevated silently — a grant always carries a reason, an expiry and a trail.
import { emitDomainEvent, EVENT } from "./events";
import { currentTraceId } from "@/lib/trace";
/* eslint-disable @typescript-eslint/no-explicit-any */

const notProvisioned = (msg: string) => /does not exist|schema cache/i.test(msg ?? "");
const MAX_MINUTES = 240; // hard ceiling on any single grant window

export type BreakGlassInput = { reason: string; targetType?: string | null; targetRef?: string | null; scope?: "read" | "act"; minutes?: number };
export type BreakGlassResult = { ok: true; grant: any } | { ok: false; reason: "not_provisioned" | "invalid_reason" | string };

export async function requestBreakGlass(admin: any, userId: string, input: BreakGlassInput): Promise<BreakGlassResult> {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 8) return { ok: false, reason: "invalid_reason" }; // mandatory, meaningful justification
  const minutes = Math.min(MAX_MINUTES, Math.max(5, Number(input.minutes) || 60));
  const expiresAt = new Date(Date.now() + minutes * 60000).toISOString();

  let me: any = null;
  try { me = (await admin.from("profiles").select("full_name, hospital_id, tenant_id").eq("id", userId).maybeSingle()).data; } catch { /* fail-soft */ }

  try {
    const { data, error } = await admin.from("break_glass_grant").insert({
      actor_id: userId, actor_name: me?.full_name ?? null, tenant_id: me?.tenant_id ?? null, hospital_id: me?.hospital_id ?? null,
      target_type: input.targetType ?? null, target_ref: input.targetRef ?? null, reason, scope: input.scope === "act" ? "act" : "read", status: "active", expires_at: expiresAt,
    }).select("id, target_type, target_ref, scope, reason, granted_at, expires_at, status").single();
    if (error) return { ok: false, reason: notProvisioned(error.message) ? "not_provisioned" : error.message };

    // Accountability: audit + domain event (both fail-soft).
    await admin.from("audit_log").insert({ trace_id: await currentTraceId(), actor_id: userId, actor_name: me?.full_name ?? null, action: "break_glass_invoked", entity_type: "break_glass_grant", entity_id: data.id, hospital_id: me?.hospital_id ?? null, new_value: { reason, target_type: data.target_type, target_ref: data.target_ref, scope: data.scope, expires_at: data.expires_at } }).catch(() => {});
    await emitDomainEvent(admin, { event_type: EVENT.BREAK_GLASS_INVOKED, subject_type: "break_glass_grant", subject_id: data.id, hospital_id: me?.hospital_id ?? null, tenant_id: me?.tenant_id ?? null, actor_id: userId, actor_name: me?.full_name ?? null, sensitivity: "restricted", payload: { target_type: data.target_type, scope: data.scope, expires_at: data.expires_at } });
    return { ok: true, grant: data };
  } catch (e: any) {
    return { ok: false, reason: notProvisioned(String(e?.message)) ? "not_provisioned" : String(e?.message ?? "error") };
  }
}

// The caller's currently-active grants (non-expired, non-revoked). Expiry is enforced by predicate, so a lapsed
// grant is never returned even before a sweep marks it 'expired'.
export async function listActiveGrants(admin: any, userId: string): Promise<any[]> {
  try {
    const { data, error } = await admin.from("break_glass_grant").select("id, target_type, target_ref, scope, reason, granted_at, expires_at, status").eq("actor_id", userId).eq("status", "active").gt("expires_at", new Date().toISOString()).order("granted_at", { ascending: false }).limit(20);
    return error ? [] : (data ?? []);
  } catch { return []; }
}

// Scope-widening consult point: is there a live break-glass grant for this user (optionally for a specific target)?
export async function hasActiveBreakGlass(admin: any, userId: string, targetType?: string, targetRef?: string): Promise<boolean> {
  try {
    let q = admin.from("break_glass_grant").select("id", { count: "exact", head: true }).eq("actor_id", userId).eq("status", "active").gt("expires_at", new Date().toISOString());
    if (targetType) q = q.eq("target_type", targetType);
    if (targetRef) q = q.eq("target_ref", targetRef);
    const { count, error } = await q;
    return !error && (count ?? 0) > 0;
  } catch { return false; }
}

export async function revokeGrant(admin: any, grantId: string, userId: string): Promise<boolean> {
  try {
    const { data } = await admin.from("break_glass_grant").update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: userId }).eq("id", grantId).eq("actor_id", userId).eq("status", "active").select("id").maybeSingle();
    return !!data;
  } catch { return false; }
}
