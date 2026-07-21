// Platform Operations overview loader (POP-001) — the operational console for the
// Competen SaaS platform. Aggregates the KPI ribbon, platform-services registry,
// tenant + workspace summaries, activity, deployments and resource usage. Real
// data from the plat_* control-plane tables (tenants, plans, products,
// subscriptions, feature flags) + profiles/audit; genuine infrastructure telemetry
// the platform does not meter (API/AI request rates, storage, per-service CPU/
// latency, deployments, resource usage) is surfaced as honest "not monitored"
// states rather than fabricated numbers. Optional tables are probed fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */

import pkg from "../../../package.json";

const WORKSPACE: Record<string, string> = {
  nurse: "Healthcare Worker", assessor: "Assessor", educator: "Educator", senior_educator: "Educator",
  clinical_educator: "Educator", hospital_admin: "Organisation Admin", quality_reviewer: "Quality & Safety",
  program_director: "Executive", education_administrator: "Education Admin", super_admin: "Platform Owner",
};
const rolesOf = (p: any): string[] => (p.roles?.length ? p.roles : [p.role]).filter(Boolean);

export async function loadPlatformOps(admin: any) {
  const [tenRes, statusRes, planRes, subRes, prodRes, flagRes, profRes] = await Promise.all([
    admin.from("tenants").select("id, name, tenant_type, status, primary_country, region_code, created_at").limit(4000),
    admin.from("plat_tenant_status").select("code, label, sort").order("sort"),
    admin.from("plat_plans").select("id, code, name, price_monthly, currency, is_active, sort").order("sort"),
    admin.from("plat_subscriptions").select("tenant_id, plan_id, status, renews_at, seats_purchased").limit(8000),
    admin.from("plat_products").select("code, name, description, is_core, default_on, sort").order("sort"),
    admin.from("plat_feature_flags").select("key, default_on, product_code").limit(2000),
    admin.from("profiles").select("id, role, roles, created_at").limit(60000),
  ]);
  const tenants = (tenRes.data ?? []) as any[];
  const statuses = (statusRes.error ? [] : (statusRes.data ?? [])) as any[];
  const plans = (planRes.error ? [] : (planRes.data ?? [])) as any[];
  const subs = (subRes.error ? [] : (subRes.data ?? [])) as any[];
  const products = (prodRes.error ? [] : (prodRes.data ?? [])) as any[];
  const flags = (flagRes.error ? [] : (flagRes.data ?? [])) as any[];
  const profiles = (profRes.data ?? []) as any[];

  // Fail-soft signals: open alerts + platform activity.
  const [escRes, platAuditRes, auditRes] = await Promise.all([
    admin.from("op_escalations").select("severity, level, status").neq("status", "resolved").limit(2000),
    admin.from("plat_audit_events").select("actor_name, action, entity_type, entity_name, created_at").order("created_at", { ascending: false }).limit(12),
    admin.from("audit_log").select("actor_name, action, entity_type, entity_name, created_at").order("created_at", { ascending: false }).limit(12),
  ]);
  const escalations = escRes.error ? [] : ((escRes.data ?? []) as any[]);
  const openAlerts = escRes.error ? null : escalations.length;
  const criticalAlerts = escRes.error ? 0 : escalations.filter(e => Number(e.level) >= 4 || ["emergency", "critical"].includes(String(e.severity ?? "").toLowerCase())).length;

  // ── KPI ribbon ────────────────────────────────────────────────────────────
  const statusLabel = new Map<string, string>(statuses.map(s => [s.code, s.label]));
  const kpis = {
    health: "Healthy" as string, // refined below once services are derived
    tenants: tenants.length,
    activeUsers: profiles.length,
    apiRequests: null as number | null, // no request telemetry
    aiRequests: null as number | null,
    storageBytes: null as number | null, // no storage metering
    openAlerts, criticalAlerts,
  };

  // ── Platform services (from the product registry; live health not metered) ─
  const services = products.map(p => ({
    code: p.code, name: p.name, core: !!p.is_core, enabledByDefault: !!p.default_on,
    status: p.is_core ? "operational" : p.default_on ? "available" : "optional",
  }));
  const servicesSummary = { total: services.length, core: services.filter(s => s.core).length, optional: services.length - services.filter(s => s.core).length, monitored: false };
  // Overall health: healthy while the core platform responds (all core queries ok).
  const anyCoreError = tenRes.error || profRes.error;
  kpis.health = anyCoreError ? "Degraded" : criticalAlerts > 0 ? "Attention" : "Healthy";

  // ── Tenant summary (by status + by plan) ─────────────────────────────────
  const tenantByStatus = new Map<string, number>();
  for (const t of tenants) { const s = t.status ?? "unknown"; tenantByStatus.set(s, (tenantByStatus.get(s) ?? 0) + 1); }
  const planName = new Map<string, string>(plans.map(p => [p.id, p.name]));
  const subByTenant = new Map<string, any>();
  // Only a live (active/trialing) subscription determines a tenant's current plan,
  // so a stale/cancelled row can't misattribute the tenant.
  for (const s of subs) if ((s.status === "active" || s.status === "trialing") && !subByTenant.has(s.tenant_id)) subByTenant.set(s.tenant_id, s);
  const tenantByPlan = new Map<string, number>();
  for (const t of tenants) { const sub = subByTenant.get(t.id); const pn = sub ? planName.get(sub.plan_id) ?? "Unplanned" : "Unplanned"; tenantByPlan.set(pn, (tenantByPlan.get(pn) ?? 0) + 1); }
  const tenantSummary = {
    total: tenants.length,
    byStatus: [...tenantByStatus.entries()].map(([code, n]) => ({ label: statusLabel.get(code) ?? code, code, n })).sort((a, b) => b.n - a.n),
    byPlan: [...tenantByPlan.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n),
  };

  // ── Workspace summary (users per workspace role) ─────────────────────────
  const wsCount = new Map<string, number>();
  // Count each PERSON once per workspace — the educator family (educator/
  // senior_educator/clinical_educator) collapses to one "Educator" workspace.
  for (const p of profiles) { const wss = new Set(rolesOf(p).map(r => WORKSPACE[r]).filter(Boolean)); for (const ws of wss) wsCount.set(ws, (wsCount.get(ws) ?? 0) + 1); }
  const totalRoleUsers = Math.max(1, [...wsCount.values()].reduce((a, b) => a + b, 0));
  const workspaceSummary = [...wsCount.entries()].map(([name, users]) => ({ name, users, pct: Math.round((users / totalRoleUsers) * 100) })).sort((a, b) => b.users - a.users);

  // ── Licensing snapshot (real) ────────────────────────────────────────────
  const activeSubs = subs.filter(s => s.status === "active" || s.status === "trialing").length;
  const seats = subs.reduce((n, s) => n + (s.seats_purchased ?? 0), 0);
  const licensing = { plans: plans.length, activeSubscriptions: activeSubs, seats, featureFlags: flags.length };

  // ── Platform activity (plat_audit_events → audit_log fallback) ────────────
  const ICON: Record<string, string> = { organisation: "🏛️", hospital: "🏥", framework: "📐", profile: "👤", template: "📦", enterprise: "🌐" };
  const platEvents = platAuditRes.error ? [] : ((platAuditRes.data ?? []) as any[]);
  const auditEvents = auditRes.error ? [] : ((auditRes.data ?? []) as any[]);
  const activity = platEvents.length
    ? platEvents.map(e => ({ icon: ICON[e.entity_type ?? ""] ?? "•", title: e.entity_name || (e.action ?? "").replace(/_/g, " ") || "Platform event", detail: [(e.action ?? "").replace(/_/g, " "), e.actor_name].filter(Boolean).join(" · "), at: e.created_at }))
    : auditEvents.map(a => ({ icon: ICON[a.entity_type ?? ""] ?? "•", title: a.entity_name || (a.action ?? "").replace(/_/g, " ") || "Platform event", detail: a.entity_name ? [(a.action ?? "").replace(/_/g, " "), a.actor_name].filter(Boolean).join(" · ") : (a.actor_name ?? ""), at: a.created_at }));
  const activityReady = !platAuditRes.error || !auditRes.error;

  return {
    kpis, services, servicesSummary, tenantSummary, workspaceSummary, licensing, activity, activityReady,
    version: (pkg as any).version ?? "—",
    generatedAt: new Date().toISOString(),
  };
}
