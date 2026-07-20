// Global Tenant Registry (LCP-001 §1) — reads the REAL tenants table (created in
// migration 041), not the organisations-as-tenants relabelling. Defensive so the
// app keeps working before the migrations are applied (empty/loading state).
/* eslint-disable @typescript-eslint/no-explicit-any */

export type RegistryTenant = {
  id: string; name: string; slug: string | null; tenant_type: string; status: string;
  primary_country: string | null; created_at: string | null;
  organisations: number; facilities: number; users: number;
  plan: string | null;
};

export async function loadTenantRegistry(admin: any) {
  try {
    const [{ data: tenants, error }, { data: statuses }, { data: orgs }, { data: hosps }, { data: profs }, { data: subs }, { data: plans }] = await Promise.all([
      admin.from("tenants").select("id, name, slug, tenant_type, status, primary_country, created_at").order("created_at", { ascending: false }).limit(3000),
      admin.from("plat_tenant_status").select("code, label, sort").order("sort"),
      admin.from("organisations").select("tenant_id").limit(20000),
      admin.from("hospitals").select("tenant_id").limit(20000),
      admin.from("profiles").select("tenant_id").limit(60000),
      admin.from("plat_subscriptions").select("tenant_id, plan_id, status").in("status", ["active", "trialing"]).limit(20000),
      admin.from("plat_plans").select("id, code").limit(200),
    ]);
    if (error) return { ready: false, tenants: [] as RegistryTenant[], statusBars: [] as { code: string; label: string; count: number }[], total: 0 };

    const planCode = new Map<string, string>((plans ?? []).map((p: any) => [p.id, p.code]));
    // Active subscription wins; fall back to a trialing one (fresh trials).
    const activePlan = new Map<string, string>();
    const trialPlan = new Map<string, string>();
    for (const s of subs ?? []) {
      if (!s.tenant_id || !s.plan_id) continue;
      const code = planCode.get(s.plan_id) ?? "—";
      if (s.status === "active") activePlan.set(s.tenant_id, code);
      else if (!trialPlan.has(s.tenant_id)) trialPlan.set(s.tenant_id, code);
    }
    const planByTenant = new Map<string, string>();
    for (const [tid, code] of trialPlan) planByTenant.set(tid, code);
    for (const [tid, code] of activePlan) planByTenant.set(tid, code);
    const count = (rows: any[]) => { const m = new Map<string, number>(); for (const r of rows ?? []) if (r.tenant_id) m.set(r.tenant_id, (m.get(r.tenant_id) ?? 0) + 1); return m; };
    const orgC = count(orgs ?? []), hospC = count(hosps ?? []), userC = count(profs ?? []);

    const rows: RegistryTenant[] = (tenants ?? []).map((t: any) => ({
      id: t.id, name: t.name, slug: t.slug, tenant_type: t.tenant_type, status: t.status,
      primary_country: t.primary_country, created_at: t.created_at,
      organisations: orgC.get(t.id) ?? 0, facilities: hospC.get(t.id) ?? 0, users: userC.get(t.id) ?? 0,
      plan: planByTenant.get(t.id) ?? null,
    }));

    const statusList = (statuses ?? []).length ? statuses : [{ code: "active", label: "Active", sort: 30 }];
    const statusBars = (statusList as any[]).map(s => ({ code: s.code, label: s.label, count: rows.filter(r => r.status === s.code).length }));

    return { ready: true, tenants: rows, statusBars, total: rows.length };
  } catch {
    return { ready: false, tenants: [] as RegistryTenant[], statusBars: [] as { code: string; label: string; count: number }[], total: 0 };
  }
}
