/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI-FAIR-USE-01 -- STAGING SEED of PROVISIONAL accounting rates and product AI policies (needs migration 410).
 *
 *   npx tsx scripts/seed-staging-ai-fair-use.ts            create (idempotent: skips a rate already in force at the same value)
 *   npx tsx scripts/seed-staging-ai-fair-use.ts --verify   read only: what is in force
 *
 * STAGING ONLY: it refuses unless STAGING_SUPABASE_URL is a confirmed non-production project.
 *
 * ⚠ PROVISIONAL, LABELLED, NOT POLICY. Every row it writes says "provisional staging seed" in its note. The
 * figures are the owner's planning parameters (AI-FAIR-USE-01 s11), never final commercial policy:
 *   UGX 3,700 per USD (illustrative), 1 CAU = USD 0.001
 *   Scholar: standard ceiling UGX 4,000 a month, essential reserve UGX 500  ->  in CAU through the FX row
 *   Professional: the same provisional figures, until it has its own
 * Provider prices: Anthropic list prices as the gateway already records them (src/lib/ai/gateway.ts), for the
 * model prefixes this deployment uses. They must be checked against the provider's current list before use.
 *
 * It does not switch metering on. The ai_fair_use flag is the owner's.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { setOverride, publishScope } from "../src/lib/config/workspace-config-write";
import { FAIR_USE_SCOPE, fairUsePath, AI_PRODUCTS } from "../src/lib/ai/fair-use-policy";
import { settingsFor } from "../src/lib/ai/fair-use-admin";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const verify = process.argv.includes("--verify");
const NOTE = "provisional staging seed (AI-FAIR-USE-01 planning parameter, not commercial policy)";
export const PROVISIONAL = { ugxPerUsd: 3700, usdPerCau: 0.001, ceilingUgx: 4000, reserveUgx: 500 };
const PRICES = [
  { provider: "anthropic", model_prefix: "claude-haiku-4-5", input_per_mtok_usd: 1, output_per_mtok_usd: 5 },
  { provider: "anthropic", model_prefix: "claude-sonnet-4", input_per_mtok_usd: 3, output_per_mtok_usd: 15 },
  { provider: "anthropic", model_prefix: "claude-opus-4", input_per_mtok_usd: 5, output_per_mtok_usd: 25 },
];
const cauFromUgx = (ugx: number) => Math.round((ugx / PROVISIONAL.ugxPerUsd) / PROVISIONAL.usdPerCau);

async function inForce(table: string, match: Record<string, unknown>) {
  let q = admin.from(table).select("*").is("effective_to", null);
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const { data } = await q;
  return data?.[0] ?? null;
}

async function main() {
  console.log(`AI fair-use staging seed -- ${verify ? "verify" : "create"} -- target ${(verdict as any).ref}`);
  const probe = await admin.from("ai_usage_ledger").select("id").limit(0);
  if (probe.error) { console.error(`Migration 410 is not applied here (${probe.error.message}). Nothing written.`); process.exit(1); }
  if (!verify) {
    for (const p of PRICES) {
      const cur = await inForce("ai_price", { provider: p.provider, model_prefix: p.model_prefix });
      if (cur && Number(cur.input_per_mtok_usd) === p.input_per_mtok_usd && Number(cur.output_per_mtok_usd) === p.output_per_mtok_usd) continue;
      if (cur) await admin.from("ai_price").update({ effective_to: new Date().toISOString() }).eq("id", cur.id);
      const r = await admin.from("ai_price").insert({ ...p, note: NOTE });
      if (r.error) throw new Error(r.error.message);
    }
    const cau = await inForce("ai_cau_rate", {});
    if (!cau || Number(cau.usd_per_cau) !== PROVISIONAL.usdPerCau) {
      if (cau) await admin.from("ai_cau_rate").update({ effective_to: new Date().toISOString() }).eq("id", cau.id);
      const r = await admin.from("ai_cau_rate").insert({ usd_per_cau: PROVISIONAL.usdPerCau, note: NOTE }); if (r.error) throw new Error(r.error.message);
    }
    const fx = await inForce("ai_fx_rate", { currency: "UGX" });
    if (!fx || Number(fx.per_usd) !== PROVISIONAL.ugxPerUsd) {
      if (fx) await admin.from("ai_fx_rate").update({ effective_to: new Date().toISOString() }).eq("id", fx.id);
      const r = await admin.from("ai_fx_rate").insert({ currency: "UGX", per_usd: PROVISIONAL.ugxPerUsd, note: NOTE }); if (r.error) throw new Error(r.error.message);
    }
    const actor = { userId: null as unknown as string, name: "IND-007 agent session (AI-FAIR-USE-01 provisional staging seed)" };
    // publishScope publishes every draft in the scope: refuse if someone else has one pending.
    const { data: rows } = await admin.from("workspace_config_overrides").select("config_path, draft, published").eq("scope_type", FAIR_USE_SCOPE.scopeType).eq("scope_ref", FAIR_USE_SCOPE.scopeRef);
    const others = (rows ?? []).filter((r: any) => !AI_PRODUCTS.map(fairUsePath).includes(r.config_path) && JSON.stringify(r.draft) !== JSON.stringify(r.published));
    if (others.length) throw new Error(`other drafts are pending in the AI fair-use scope -- not publishing them`);
    for (const product of AI_PRODUCTS) {
      const s = await setOverride(admin, actor, FAIR_USE_SCOPE, fairUsePath(product), settingsFor(product, {
        includedCau: cauFromUgx(PROVISIONAL.ceilingUgx), reserveCau: cauFromUgx(PROVISIONAL.reserveUgx),
        windowMinutes: 60, windowCapCau: Math.round(cauFromUgx(PROVISIONAL.ceilingUgx) / 4),
        levels: { optimisedBelowPct: 30, essentialBelowPct: 10 }, reset: { rule: "entitlement_cycle", cycleDays: 30 },
      }));
      if (!s.ok) throw new Error(s.error);
    }
    const p = await publishScope(admin, actor, FAIR_USE_SCOPE, { label: "Provisional staging AI policies", note: NOTE });
    if (!p.ok) throw new Error(p.error);
  }
  const [prices, cau, fx, pol] = await Promise.all([
    admin.from("ai_price").select("provider, model_prefix, input_per_mtok_usd, output_per_mtok_usd, note").is("effective_to", null),
    admin.from("ai_cau_rate").select("usd_per_cau, note").is("effective_to", null),
    admin.from("ai_fx_rate").select("currency, per_usd, note").is("effective_to", null),
    admin.from("workspace_config_overrides").select("config_path, published").eq("scope_ref", FAIR_USE_SCOPE.scopeRef),
  ]);
  console.log(JSON.stringify({ prices: prices.data, cau: cau.data, fx: fx.data, policies: (pol.data ?? []).map((r: any) => ({ path: r.config_path, includedCau: r.published?.includedCau, reserveCau: r.published?.reserveCau })) }, null, 1));
}

main().catch(e => { console.error(e.message ?? e); process.exit(1); });
