// Commercial-engine write operations (LCP-001 §3/§4/§9): tenant lifecycle
// transitions, subscription (plan) changes, and feature-flag assignments. Each
// writes the change, records a landlord audit event and emits a platform event.
// Callers (API routes) must have already enforced landlord access.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { landlordAudit } from "./landlord";
import { emitPlatformEvent } from "./events";

const LIFECYCLE = ["prospect", "trial", "active", "suspended", "archived", "deleted"];
const TERMINAL = ["archived", "deleted"];
// Allowed lifecycle transitions FROM each state — the raw API is authoritative,
// not the UI. 'deleted' is terminal; 'archived' may be restored to 'active'.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  prospect: ["trial", "active", "suspended", "archived"],
  trial: ["active", "suspended", "archived"],
  active: ["suspended", "archived"],
  suspended: ["active", "archived"],
  archived: ["active"],
  deleted: [],
};

type Caller = { userId: string; fullName: string | null };

export async function changeTenantStatus(admin: any, caller: Caller, tenantId: string, status: string, reason?: string | null) {
  if (!LIFECYCLE.includes(status)) return { ok: false, error: `Invalid status "${status}"` };
  const { data: t } = await admin.from("tenants").select("id, name, status").eq("id", tenantId).maybeSingle();
  if (!t) return { ok: false, error: "Tenant not found" };
  if (t.status === status) return { ok: false, error: `Tenant is already ${status}` };
  if (!(ALLOWED_TRANSITIONS[t.status] ?? []).includes(status)) return { ok: false, error: `Cannot transition ${t.status} → ${status}` };

  const patch: any = { status };
  if (status === "archived") patch.archived_at = new Date().toISOString();
  if (!TERMINAL.includes(status)) patch.archived_at = null;
  const { error } = await admin.from("tenants").update(patch).eq("id", tenantId);
  if (error) return { ok: false, error: error.message };

  await landlordAudit(admin, caller, { action: `tenant_${status}`, entity_type: "tenant", entity_id: tenantId, entity_name: t.name, tenant_id: tenantId, old_value: { status: t.status }, new_value: { status }, reason: reason ?? null });
  await emitPlatformEvent(admin, { event_type: `tenant.${status}`, tenant_id: tenantId, severity: status === "suspended" ? "warning" : "info", payload: { from: t.status, to: status } });
  return { ok: true };
}

export async function changeSubscription(admin: any, caller: Caller, tenantId: string, planCode: string) {
  const { data: t } = await admin.from("tenants").select("id, name").eq("id", tenantId).maybeSingle();
  if (!t) return { ok: false, error: "Tenant not found" };
  const { data: plan } = await admin.from("plat_plans").select("id, code, name").eq("code", planCode).eq("is_active", true).maybeSingle();
  if (!plan) return { ok: false, error: `Unknown plan "${planCode}"` };

  // Insert the new subscription FIRST, then cancel the previous ones — so a
  // failed insert can never leave the tenant with zero active subscription.
  const { data: added, error } = await admin.from("plat_subscriptions").insert({ tenant_id: tenantId, plan_id: plan.id, status: "active", started_at: new Date().toISOString() }).select("id").single();
  if (error || !added) return { ok: false, error: error?.message ?? "Subscription create failed" };
  await admin.from("plat_subscriptions").update({ status: "canceled" }).eq("tenant_id", tenantId).in("status", ["active", "trialing"]).neq("id", added.id);

  await landlordAudit(admin, caller, { action: "subscription_changed", entity_type: "tenant", entity_id: tenantId, entity_name: t.name, tenant_id: tenantId, new_value: { plan: plan.code } });
  await emitPlatformEvent(admin, { event_type: "subscription.changed", tenant_id: tenantId, severity: "info", payload: { plan: plan.code } });
  return { ok: true, plan: plan.code };
}

export async function setFlagAssignment(admin: any, caller: Caller, a: { flagKey: string; scopeType: string; scopeRef?: string | null; enabled: boolean }) {
  const scopes = ["global", "tenant", "country", "plan", "cohort"];
  if (!scopes.includes(a.scopeType)) return { ok: false, error: "Invalid scope" };
  const ref = a.scopeType === "global" ? null : (a.scopeRef?.trim() || null);
  if (a.scopeType !== "global" && !ref) return { ok: false, error: `${a.scopeType} scope needs a reference` };

  const { data: flag } = await admin.from("plat_feature_flags").select("key").eq("key", a.flagKey).maybeSingle();
  if (!flag) return { ok: false, error: "Unknown flag" };

  // Atomic upsert on the (flag_key, scope_type, scope_ref) unique index — one
  // assignment per scope, no delete-then-insert window, no duplicates.
  const { error } = await admin.from("plat_feature_flag_assignments").upsert(
    { flag_key: a.flagKey, scope_type: a.scopeType, scope_ref: ref, enabled: a.enabled, created_by: caller.userId },
    { onConflict: "flag_key,scope_type,scope_ref" },
  );
  if (error) return { ok: false, error: error.message };

  await landlordAudit(admin, caller, { action: "feature_flag_set", entity_type: "feature_flag", entity_name: a.flagKey, new_value: { scope: a.scopeType, ref, enabled: a.enabled } });
  return { ok: true };
}
