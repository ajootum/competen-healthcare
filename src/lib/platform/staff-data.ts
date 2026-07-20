// Internal-staff workspace loaders (PLA-001): Customer Success (PCS-001),
// Finance (FIN-001), Support (SUP-001). All platform-wide, landlord-gated,
// defensive pre-migration.
/* eslint-disable @typescript-eslint/no-explicit-any */

const band = (n: number) => (n >= 70 ? "healthy" : n >= 40 ? "watch" : "at_risk");

// ── Customer Success: per-tenant health from adoption + lifecycle + subscription
export async function loadCustomerSuccess(admin: any) {
  try {
    const [{ data: tenants, error }, { data: profs }, { data: subs }] = await Promise.all([
      admin.from("tenants").select("id, name, status, created_at").not("status", "in", "(archived,deleted)").order("created_at", { ascending: false }).limit(3000),
      admin.from("profiles").select("tenant_id").limit(60000),
      admin.from("plat_subscriptions").select("tenant_id, status").in("status", ["active", "trialing"]).limit(20000),
    ]);
    if (error) return { ready: false, rows: [] as any[], summary: { total: 0, healthy: 0, watch: 0, atRisk: 0, onboarding: 0 } };
    const userC = new Map<string, number>();
    for (const p of profs ?? []) if (p.tenant_id) userC.set(p.tenant_id, (userC.get(p.tenant_id) ?? 0) + 1);
    const subStatus = new Map<string, string>();
    for (const s of subs ?? []) if (s.tenant_id) subStatus.set(s.tenant_id, s.status);
    const maxUsers = Math.max(1, ...[...userC.values()]);

    const rows = ((tenants ?? []) as any[]).map((t: any) => {
      const users = userC.get(t.id) ?? 0;
      const hasSub = subStatus.has(t.id);
      // Health: lifecycle (40) + adoption (40, relative) + subscription (20).
      let h = 0;
      h += t.status === "active" ? 40 : t.status === "trial" ? 20 : 0;
      h += Math.round((users / maxUsers) * 40);
      h += hasSub ? 20 : 0;
      const health = Math.min(100, h);
      return { id: t.id, name: t.name, status: t.status, users, subscription: subStatus.get(t.id) ?? null, health, band: band(health) };
    }).sort((a, b) => a.health - b.health);

    const summary = {
      total: rows.length,
      healthy: rows.filter(r => r.band === "healthy").length,
      watch: rows.filter(r => r.band === "watch").length,
      atRisk: rows.filter(r => r.band === "at_risk").length,
      onboarding: rows.filter(r => r.status === "trial" || r.status === "prospect").length,
    };
    return { ready: true, rows, summary };
  } catch {
    return { ready: false, rows: [] as any[], summary: { total: 0, healthy: 0, watch: 0, atRisk: 0, onboarding: 0 } };
  }
}

// ── Finance: subscriptions × plan price → MRR + plan mix + billing accounts
export async function loadFinance(admin: any) {
  try {
    const [{ data: subs, error }, { data: plans }, { data: billing }, { count: tenantsTotal }] = await Promise.all([
      admin.from("plat_subscriptions").select("tenant_id, plan_id, status, seats_purchased").in("status", ["active", "trialing"]).limit(20000),
      admin.from("plat_plans").select("id, code, name, price_monthly, currency").order("sort"),
      admin.from("plat_billing_accounts").select("id, tenant_id, currency, balance").limit(20000),
      admin.from("tenants").select("id", { count: "exact", head: true }).not("status", "in", "(archived,deleted)"),
    ]);
    if (error) return { ready: false, mrr: 0, currency: "USD", planMix: [] as any[], activeSubs: 0, trialing: 0, billingAccounts: 0, unsubscribed: 0 };
    const planById = new Map<string, any>((plans ?? []).map((p: any) => [p.id, p]));
    const baseCurrency = (plans ?? [])[0]?.currency ?? "USD";
    let mrr = 0; let activeSubs = 0; let trialing = 0;
    const mix = new Map<string, { name: string; count: number; mrr: number; currency: string }>();
    for (const s of subs ?? []) {
      const p = planById.get(s.plan_id); if (!p) continue;
      if (s.status === "active") activeSubs++; else if (s.status === "trialing") trialing++;
      const price = s.status === "active" ? Number(p.price_monthly ?? 0) : 0; // trials don't bill
      const cur = p.currency ?? baseCurrency;
      if (cur === baseCurrency) mrr += price; // aggregate MRR is single (base) currency only
      const m = mix.get(p.code) ?? { name: p.name, count: 0, mrr: 0, currency: cur };
      m.count++; m.mrr += price; mix.set(p.code, m);
    }
    const planMix = [...mix.entries()].map(([code, m]) => ({ code, ...m })).sort((a, b) => b.count - a.count);
    return {
      ready: true, mrr, currency: baseCurrency, planMix, activeSubs, trialing,
      billingAccounts: (billing ?? []).length,
      unsubscribed: Math.max(0, (tenantsTotal ?? 0) - (activeSubs + trialing)),
    };
  } catch {
    return { ready: false, mrr: 0, currency: "USD", planMix: [] as any[], activeSubs: 0, trialing: 0, billingAccounts: 0, unsubscribed: 0 };
  }
}

// ── Support: ticket queue
export async function loadSupport(admin: any) {
  try {
    const [{ data: tickets, error }, { data: tenants }] = await Promise.all([
      admin.from("plat_support_tickets").select("id, tenant_id, subject, status, priority, requester_name, created_at").order("created_at", { ascending: false }).limit(500),
      admin.from("tenants").select("id, name").limit(3000),
    ]);
    if (error) return { ready: false, tickets: [] as any[], counts: { open: 0, pending: 0, resolved: 0, closed: 0 }, tenants: [] as any[] };
    const name = new Map<string, string>((tenants ?? []).map((t: any) => [t.id, t.name]));
    const rows = (tickets ?? []).map((t: any) => ({ ...t, tenant_name: t.tenant_id ? name.get(t.tenant_id) ?? null : null }));
    const counts = { open: 0, pending: 0, resolved: 0, closed: 0 } as Record<string, number>;
    for (const t of rows) counts[t.status] = (counts[t.status] ?? 0) + 1;
    return { ready: true, tickets: rows, counts, tenants: (tenants ?? []).map((t: any) => ({ id: t.id, name: t.name })) };
  } catch {
    return { ready: false, tickets: [] as any[], counts: { open: 0, pending: 0, resolved: 0, closed: 0 }, tenants: [] as any[] };
  }
}
