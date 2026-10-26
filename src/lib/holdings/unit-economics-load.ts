/* eslint-disable @typescript-eslint/no-explicit-any */

// ── HOLDINGS-FX-01: GATHER THE MEASURED INPUTS (fail-soft) ────────────────────────────────────────────────
//
// Reads what already exists and hands it to the pure engine. Every read is fail-soft: a table that is not
// there yet (560 before it is applied) or a read that fails becomes "not available", never a zero.
// Sources:
//   policy      workspace_config_overrides / _versions at {platform, holdings_finance}
//   price       individual_plan (active Scholar plan, UGX), normalised to 30 days
//   collections individual_checkout (paid Scholar checkouts in the window, with 560's fee and net)
//   users       individual_live_entitlement (live Scholar access, and how much of it is paid)
//   AI cost     ai_usage_ledger (settled, metered) when it has rows, else plat_ai_requests (list-price estimate)
//   reference   ai_fx_rate (the UGX row in force, 410/412)
//   actual      holdings_fx_event (560), with the USD reserve

import { minorToMajor } from "@/lib/commerce/gateway";
import { HOLDINGS_FINANCE_SCOPE, resolveUnitEconomicsPolicy, unitEconomicsPath, type UnitEconomicsPolicy, type UnitEconomicsProduct } from "./unit-economics-policy";
import { computeUnitEconomics, type UnitEconomics } from "./unit-economics";
import { loadFxLedger, summariseLedger, type FxEventRow, type LedgerSummary } from "./fx-ledger";

const DAY = 86400000;

export type UnitEconomicsView = {
  product: UnitEconomicsProduct;
  policy: UnitEconomicsPolicy;
  draft: any | null;
  draftDiffers: boolean;
  plan: { code: string; name: string; amountUgx: number; intervalDays: number } | null;
  collections: { paid: number; grossUgx: number; withFee: number };
  users: { active: number; paying: number };
  aiCostSource: "ledger" | "requests" | "none";
  ledger: { rows: FxEventRow[]; summary: LedgerSummary } | null;
  economics: UnitEconomics;
};

async function loadPolicy(admin: any, product: UnitEconomicsProduct) {
  const path = unitEconomicsPath(product);
  const { data } = await admin.from("workspace_config_overrides").select("draft, published")
    .eq("scope_type", HOLDINGS_FINANCE_SCOPE.scopeType).eq("scope_ref", HOLDINGS_FINANCE_SCOPE.scopeRef).eq("config_path", path).maybeSingle();
  let version: string | null = null;
  if (data?.published) {
    const { data: v } = await admin.from("workspace_config_versions").select("id, label, created_at")
      .eq("scope_type", HOLDINGS_FINANCE_SCOPE.scopeType).eq("scope_ref", HOLDINGS_FINANCE_SCOPE.scopeRef)
      .eq("status", "published").order("created_at", { ascending: false }).limit(1);
    const row = (v ?? [])[0];
    version = row ? (row.label || String(row.created_at).slice(0, 10)) : "published";
  }
  return {
    policy: resolveUnitEconomicsPolicy(product, data?.published ?? null, version),
    draft: data?.draft ?? null,
    draftDiffers: !!data?.draft && JSON.stringify(data.draft) !== JSON.stringify(data.published ?? null),
  };
}

async function costByUser(admin: any, since: Date): Promise<{ map: Map<string, number> | null; source: "ledger" | "requests" | "none" }> {
  const led = await admin.from("ai_usage_ledger").select("user_id, cost_usd")
    .eq("product", "scholar").gte("created_at", since.toISOString()).not("cost_usd", "is", null).limit(50000);
  if (!led.error && (led.data ?? []).length) {
    const m = new Map<string, number>();
    for (const r of led.data as any[]) if (r.user_id) m.set(r.user_id, (m.get(r.user_id) ?? 0) + Number(r.cost_usd ?? 0));
    return { map: m, source: "ledger" };
  }
  const req = await admin.from("plat_ai_requests").select("actor_id, cost_usd")
    .like("operation", "individual_scholar_%").gte("created_at", since.toISOString()).not("cost_usd", "is", null).limit(50000);
  if (req.error) return { map: led.error ? null : new Map(), source: "none" };
  const m = new Map<string, number>();
  for (const r of (req.data ?? []) as any[]) if (r.actor_id) m.set(r.actor_id, (m.get(r.actor_id) ?? 0) + Number(r.cost_usd ?? 0));
  return { map: m, source: m.size ? "requests" : "none" };
}

export async function loadUnitEconomics(admin: any, product: UnitEconomicsProduct, now = new Date()): Promise<UnitEconomicsView> {
  const { policy, draft, draftDiffers } = await loadPolicy(admin, product);
  const since = new Date(now.getTime() - policy.measurementWindowDays * DAY);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [planRes, liveRes, refRes, ledgerRows, cost, mtd] = await Promise.all([
    admin.from("individual_plan").select("plan_code, name, amount_minor, currency, interval_days")
      .eq("experience_code", product).eq("active", true).eq("currency", "UGX").order("amount_minor", { ascending: true }).limit(1),
    admin.from("individual_live_entitlement").select("user_id, source").eq("experience_code", product).limit(60000),
    admin.from("ai_fx_rate").select("per_usd, published_on, update_kind").eq("currency", "UGX").is("effective_to", null)
      .order("effective_from", { ascending: false }).limit(1),
    loadFxLedger(admin),
    costByUser(admin, since),
    costByUser(admin, monthStart),
  ]);

  // Paid checkouts, with 560's settlement columns where they exist.
  let chk = await admin.from("individual_checkout").select("amount_minor, currency, gateway_fee_minor, net_settled_minor")
    .eq("experience_code", product).eq("status", "paid").gte("settled_at", since.toISOString()).limit(20000);
  if (chk.error) chk = await admin.from("individual_checkout").select("amount_minor, currency")
    .eq("experience_code", product).eq("status", "paid").gte("settled_at", since.toISOString()).limit(20000);
  const paid = ((chk.error ? [] : chk.data) ?? []).filter((c: any) => c.currency === "UGX") as any[];
  const collections = paid.map(c => ({
    grossUgx: minorToMajor(Number(c.amount_minor), "UGX") ?? 0,
    feeUgx: c.gateway_fee_minor == null ? null : minorToMajor(Number(c.gateway_fee_minor), "UGX"),
    netUgx: c.net_settled_minor == null ? null : minorToMajor(Number(c.net_settled_minor), "UGX"),
  }));

  const planRow = planRes.error ? null : (planRes.data ?? [])[0];
  const plan = planRow ? { code: planRow.plan_code, name: planRow.name, amountUgx: minorToMajor(Number(planRow.amount_minor), "UGX") ?? 0, intervalDays: Number(planRow.interval_days) } : null;
  const live = (liveRes.error ? [] : liveRes.data ?? []) as any[];
  const activeUsers = new Set(live.map(r => r.user_id)).size;
  const payingUsers = new Set(live.filter(r => r.source === "payment").map(r => r.user_id)).size;
  const ref = refRes.error ? null : (refRes.data ?? [])[0];
  const summary = ledgerRows ? summariseLedger(ledgerRows, now, policy.executedRateWindowDays) : null;

  const economics = computeUnitEconomics({
    now, policy,
    planPriceUgxMonthly: plan ? Math.round(plan.amountUgx * 30 / Math.max(1, plan.intervalDays)) : null,
    collections, activeUsers, payingUsers,
    aiCostUsdByUser: cost.map, aiCostSource: cost.source,
    providerSpendMonthToDateUsd: mtd.map ? [...mtd.map.values()].reduce((n, v) => n + v, 0) : null,
    reference: ref ? { ugxPerUsd: Number(ref.per_usd), publishedOn: ref.published_on ?? null, placeholder: ref.update_kind === "placeholder" } : null,
    actual: summary?.actual ?? null,
    reserveUsd: summary ? summary.reserveUsd : null,
  });

  return {
    product, policy, draft, draftDiffers, plan,
    collections: { paid: paid.length, grossUgx: collections.reduce((n, c) => n + c.grossUgx, 0), withFee: collections.filter(c => c.feeUgx != null).length },
    users: { active: activeUsers, paying: payingUsers },
    aiCostSource: cost.source,
    ledger: ledgerRows && summary ? { rows: ledgerRows.slice(0, 50), summary } : null,
    economics,
  };
}
