// Tenant Operations (POP-001 §2) loaders — directory + single-tenant profile.
// Tenants are the platform's customers (tenants table); plan comes from the
// active plat_subscription, usage from the org/facility/user rows that carry the
// tenant_id, feature state from plat_feature_flags + per-tenant assignments.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const TENANT_TYPES = ["hospital", "clinic", "university", "nursing_school", "ministry", "ngo", "health_network", "multinational_group", "individual"] as const;
export const TENANT_STATUSES = ["prospect", "trial", "active", "suspended", "archived", "deleted"] as const;
const LIVE_SUB = (s: any) => s.status === "active" || s.status === "trialing";

export async function loadTenantDirectory(admin: any) {
  const [tenRes, subRes, planRes, statusRes, orgRes, hospRes, profRes] = await Promise.all([
    admin.from("tenants").select("id, name, slug, tenant_type, status, primary_country, created_at").order("created_at", { ascending: false }).limit(4000),
    admin.from("plat_subscriptions").select("tenant_id, plan_id, status, seats_purchased, renews_at").limit(8000),
    admin.from("plat_plans").select("id, code, name").limit(1000),
    admin.from("plat_tenant_status").select("code, label").limit(50),
    admin.from("organisations").select("tenant_id").limit(8000),
    admin.from("hospitals").select("tenant_id").limit(8000),
    admin.from("profiles").select("tenant_id").limit(60000),
  ]);
  const tenants = (tenRes.data ?? []) as any[];
  const subs = (subRes.error ? [] : (subRes.data ?? [])) as any[];
  const planName = new Map<string, string>(((planRes.data ?? []) as any[]).map(p => [p.id, p.name]));
  const statusLabel = new Map<string, string>(((statusRes.error ? [] : statusRes.data ?? []) as any[]).map(s => [s.code, s.label]));

  const subByTenant = new Map<string, any>();
  for (const s of subs) if (LIVE_SUB(s) && !subByTenant.has(s.tenant_id)) subByTenant.set(s.tenant_id, s);
  const countBy = (rows: any[]) => { const m = new Map<string, number>(); for (const r of rows) if (r.tenant_id) m.set(r.tenant_id, (m.get(r.tenant_id) ?? 0) + 1); return m; };
  const usersBy = countBy((profRes.data ?? []) as any[]);
  const facsBy = countBy((hospRes.data ?? []) as any[]);
  const orgsBy = countBy((orgRes.data ?? []) as any[]);

  const rows = tenants.map(t => {
    const sub = subByTenant.get(t.id);
    return {
      id: t.id, name: t.name, slug: t.slug, type: t.tenant_type, status: t.status, country: t.primary_country ?? "—",
      plan: sub ? planName.get(sub.plan_id) ?? null : null, seats: sub?.seats_purchased ?? null,
      users: usersBy.get(t.id) ?? 0, facilities: facsBy.get(t.id) ?? 0, orgs: orgsBy.get(t.id) ?? 0,
    };
  });
  const by = (s: string) => rows.filter(r => r.status === s).length;
  const summary = {
    total: rows.length, active: by("active"), trial: by("trial") + by("prospect"), suspended: by("suspended"),
    archived: by("archived") + by("deleted"), unplanned: rows.filter(r => !r.plan && !["archived", "deleted"].includes(r.status)).length,
  };
  const byStatus = [...statusLabel.keys()].map(code => ({ code, label: statusLabel.get(code) ?? code, n: by(code) })).filter(x => x.n > 0);
  return { rows, summary, byStatus, plans: (planRes.data ?? []) as any[] };
}

export async function loadTenantProfile(admin: any, id: string) {
  const { data: t } = await admin.from("tenants").select("*").eq("id", id).maybeSingle();
  if (!t) return null;

  const [subRes, planRes, flagRes, ffaRes, orgRes, hospRes, profRes, auditRes] = await Promise.all([
    admin.from("plat_subscriptions").select("*").eq("tenant_id", id).order("started_at", { ascending: false }),
    admin.from("plat_plans").select("id, code, name, price_monthly, currency, entitlements").limit(1000),
    admin.from("plat_feature_flags").select("key, description, default_on").order("key"),
    admin.from("plat_feature_flag_assignments").select("flag_key, scope_type, scope_ref, enabled").eq("scope_type", "tenant").eq("scope_ref", id),
    admin.from("organisations").select("id, name").eq("tenant_id", id).limit(2000),
    admin.from("hospitals").select("id, name, admin_id").eq("tenant_id", id).limit(4000),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", id),
    admin.from("audit_log").select("actor_name, action, entity_name, created_at").eq("entity_type", "tenant").eq("entity_id", id).order("created_at", { ascending: false }).limit(25),
  ]);
  const subs = (subRes.error ? [] : (subRes.data ?? [])) as any[];
  const activeSub = subs.find(LIVE_SUB) ?? subs[0] ?? null;
  const plans = (planRes.data ?? []) as any[];
  const plan = activeSub ? plans.find(p => p.id === activeSub.plan_id) ?? null : null;
  const ent = plan?.entitlements ?? {};
  const orgs = (orgRes.data ?? []) as any[];
  const facilities = (hospRes.data ?? []) as any[];
  const userCount = profRes.count ?? 0;
  const audit = auditRes.error ? [] : ((auditRes.data ?? []) as any[]);

  const flags = (flagRes.error ? [] : (flagRes.data ?? [])) as any[];
  const override = new Map<string, boolean>(((ffaRes.error ? [] : ffaRes.data ?? []) as any[]).map((a: any) => [a.flag_key, a.enabled]));
  const features = flags.map(f => ({ key: f.key, description: f.description, enabled: override.has(f.key) ? !!override.get(f.key) : !!f.default_on, overridden: override.has(f.key) }));

  // Usage vs entitlement (real counts; storage/AI not metered → limit only).
  const usage = [
    { label: "Users", used: userCount, limit: ent.max_users ?? null },
    { label: "Facilities", used: facilities.length, limit: ent.max_hospitals ?? null },
    { label: "Storage (GB)", used: null, limit: ent.storage_gb ?? null, note: "not metered" },
    { label: "AI credits", used: null, limit: ent.ai_credits ?? null, note: "not metered" },
  ];
  const overLimit = usage.some(u => u.used != null && u.limit != null && u.used > u.limit);

  return {
    tenant: {
      id: t.id, name: t.name, slug: t.slug, type: t.tenant_type, status: t.status, country: t.primary_country ?? null,
      language: t.default_language, timezone: t.timezone, currency: t.currency, customDomain: t.custom_domain ?? null, createdAt: t.created_at,
      health: t.status === "suspended" ? "Suspended" : overLimit ? "Over limit" : ["active"].includes(t.status) ? "Healthy" : t.status === "trial" || t.status === "prospect" ? "Trial" : "Inactive",
    },
    subscription: activeSub ? { status: activeSub.status, seats: activeSub.seats_purchased, renews: activeSub.renews_at, trialEnds: activeSub.trial_ends_at } : null,
    plan: plan ? { id: plan.id, name: plan.name, code: plan.code, price: plan.price_monthly, currency: plan.currency, entitlements: ent } : null,
    plans: plans.map(p => ({ id: p.id, name: p.name, code: p.code })),
    usage, features,
    orgs, facilities: facilities.map(f => ({ id: f.id, name: f.name, hasAdmin: !!f.admin_id })), userCount,
    audit, auditReady: !auditRes.error,
  };
}
