// Licensing & Subscription Centre (POP-001 §5) loader — plans, subscriptions,
// seats, MRR and renewals from plat_plans + plat_subscriptions. All live data;
// billing history is not stored, so MRR is derived from plan price × live subs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const LIVE = (s: any) => s.status === "active" || s.status === "trialing";
const DAY = 86400000;

export async function loadLicensing(admin: any) {
  const [planRes, subRes, prodRes, flagRes, tenRes] = await Promise.all([
    admin.from("plat_plans").select("id, code, name, price_monthly, currency, entitlements, is_active, sort").order("sort"),
    admin.from("plat_subscriptions").select("id, tenant_id, plan_id, status, seats_purchased, renews_at, trial_ends_at").limit(8000),
    admin.from("plat_products").select("code, name, is_core").order("sort"),
    admin.from("plat_feature_flags").select("key, description, default_on, product_code").order("key"),
    admin.from("tenants").select("id, name").limit(8000),
  ]);
  const plans = (planRes.data ?? []) as any[];
  const subs = (subRes.error ? [] : (subRes.data ?? [])) as any[];
  const products = (prodRes.error ? [] : (prodRes.data ?? [])) as any[];
  const flags = (flagRes.error ? [] : (flagRes.data ?? [])) as any[];
  const tenantName = new Map<string, string>(((tenRes.data ?? []) as any[]).map(t => [t.id, t.name]));

  // One live subscription per tenant.
  const subByTenant = new Map<string, any>();
  for (const s of subs) if (LIVE(s) && !subByTenant.has(s.tenant_id)) subByTenant.set(s.tenant_id, s);
  const liveSubs = [...subByTenant.values()];

  const priceOf = new Map<string, number>(plans.map(p => [p.id, p.price_monthly ?? 0]));
  const tenantsPerPlan = new Map<string, number>();
  const seatsPerPlan = new Map<string, number>();
  let mrr = 0, totalSeats = 0;
  for (const s of liveSubs) {
    tenantsPerPlan.set(s.plan_id, (tenantsPerPlan.get(s.plan_id) ?? 0) + 1);
    seatsPerPlan.set(s.plan_id, (seatsPerPlan.get(s.plan_id) ?? 0) + (s.seats_purchased ?? 0));
    mrr += priceOf.get(s.plan_id) ?? 0;
    totalSeats += s.seats_purchased ?? 0;
  }

  const planRows = plans.map(p => ({
    id: p.id, code: p.code, name: p.name, price: p.price_monthly ?? 0, currency: p.currency ?? "USD",
    active: !!p.is_active, entitlements: p.entitlements ?? {},
    tenants: tenantsPerPlan.get(p.id) ?? 0, seats: seatsPerPlan.get(p.id) ?? 0,
  }));

  const now = Date.now();
  const renewals = liveSubs
    .filter(s => s.renews_at)
    .map(s => ({ tenant: tenantName.get(s.tenant_id) ?? "—", plan: plans.find(p => p.id === s.plan_id)?.name ?? "—", renewsAt: s.renews_at, days: Math.round((new Date(s.renews_at).getTime() - now) / DAY) }))
    .sort((a, b) => a.days - b.days)
    .slice(0, 8);
  const renewingSoon = liveSubs.filter(s => s.renews_at && new Date(s.renews_at).getTime() - now < 30 * DAY && new Date(s.renews_at).getTime() >= now).length;

  const summary = {
    plans: plans.length, activePlans: plans.filter(p => p.is_active).length,
    subscriptions: liveSubs.length, seats: totalSeats,
    mrr, currency: plans[0]?.currency ?? "USD",
    trials: liveSubs.filter(s => s.status === "trialing").length, renewingSoon,
    products: products.length, featureFlags: flags.length,
    billingMetered: false,
  };
  return { planRows, summary, renewals, products, flags };
}
