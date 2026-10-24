/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI-FAIR-USE-01 and IND-007 D1-D5 -- STAGING SEED of PROVISIONAL prices, the allowance basis, model eligibility,
 * product AI policies and personal-assistant profiles (needs migrations 410, 411 and 412).
 *
 *   npx tsx scripts/seed-staging-ai-fair-use.ts            create (idempotent: skips a row already in force at the same value)
 *   npx tsx scripts/seed-staging-ai-fair-use.ts --verify   read only: what is in force
 *
 * STAGING ONLY: it refuses unless STAGING_SUPABASE_URL is a confirmed non-production project.
 *
 * ⚠ PROVISIONAL, LABELLED, NOT POLICY. Every row it writes says "provisional staging seed" in its note. The data is
 * scripts/ai-provisional-policy.ts, for the owner to confirm on the HQ page:
 *   D2  Anthropic list prices in USD, as this repository records them (src/lib/ai/gateway.ts), with their source.
 *   D4  1 CAU = UGX 1. The REFERENCE RATE IS NOT SET HERE: it is the Bank of Uganda's published rate, set through the
 *       governed rate path (scripts/set-staging-reference-rate.ts or the HQ page) with its date and source.
 *   D5  allowances: 4,000 included, 500 reserve, 5-hour window of 1,000, anniversary reset.
 *   D1  activities with their lowest clinical risk tier, the risk rules, and the per-tier model floor.
 *   D3  one personal AI: Scholar opens in Teach Me, Professional in professional development.
 *   Eligibility: OpenAI and Gemini permitted but NOT eligible for any activity (evaluation pending). No model is made
 *   eligible here. Only a recorded reviewer decision on an evaluation does that.
 *
 * It does not switch metering on. The ai_fair_use flag is the owner's.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { setOverride, publishScope } from "../src/lib/config/workspace-config-write";
import { FAIR_USE_SCOPE, fairUsePath, AI_PRODUCTS } from "../src/lib/ai/fair-use-policy";
import { settingsFor } from "../src/lib/ai/fair-use-admin";
import { assistantPath, resolveAssistantProfile } from "../src/lib/ai/personal-assistant";
import { PROVISIONAL_ACTIVITIES, PROVISIONAL_ALLOWANCE, PROVISIONAL_ASSISTANT, PROVISIONAL_RISK } from "./ai-provisional-policy";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const verify = process.argv.includes("--verify");
const NOTE = "provisional staging seed (IND-007 owner decisions 2026-10-24, provisional pilot, not commercial policy)";
const PRICE_SOURCE = "https://docs.claude.com/en/docs/about-claude/pricing (list price as recorded in src/lib/ai/gateway.ts, to verify before production)";
const PRICES = [
  { provider: "anthropic", model_prefix: "claude-haiku-4-5", input_per_mtok_usd: 1, output_per_mtok_usd: 5 },
  { provider: "anthropic", model_prefix: "claude-sonnet-4", input_per_mtok_usd: 3, output_per_mtok_usd: 15 },
  { provider: "anthropic", model_prefix: "claude-opus-4", input_per_mtok_usd: 5, output_per_mtok_usd: 25 },
];
const OTHER_PROVIDERS = [{ provider: "openai", model_prefix: "gpt-" }, { provider: "gemini", model_prefix: "gemini-" }];

async function inForce(table: string, match: Record<string, unknown>) {
  let q = admin.from(table).select("*").is("effective_to", null);
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const { data, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return data?.[0] ?? null;
}
async function replace(table: string, match: Record<string, unknown>, row: Record<string, unknown>, same: (cur: any) => boolean) {
  const cur = await inForce(table, match);
  if (cur && same(cur)) return "kept";
  if (cur) { const e = await admin.from(table).update({ effective_to: new Date().toISOString() }).eq("id", cur.id); if (e.error) throw new Error(e.error.message); }
  const r = await admin.from(table).insert({ ...match, note: NOTE, ...row });
  if (r.error) throw new Error(`${table}: ${r.error.message}`);
  return cur ? "replaced" : "added";
}

async function main() {
  console.log(`AI fair-use staging seed -- ${verify ? "verify" : "create"} -- target ${(verdict as any).ref}`);
  const probe = await admin.from("ai_usage_ledger").select("risk_tier").limit(0);
  if (probe.error) { console.error(`Migration 412 is not applied here (${probe.error.message}). Nothing written.`); process.exit(1); }
  if (!verify) {
    for (const p of PRICES) {
      console.log(`  price ${p.model_prefix}: ` + await replace("ai_price", { provider: p.provider, model_prefix: p.model_prefix },
        { input_per_mtok_usd: p.input_per_mtok_usd, output_per_mtok_usd: p.output_per_mtok_usd, source_kind: "list", source_ref: PRICE_SOURCE, price_version: "provisional-2026-10" },
        c => +c.input_per_mtok_usd === p.input_per_mtok_usd && +c.output_per_mtok_usd === p.output_per_mtok_usd && c.source_ref === PRICE_SOURCE));
    }
    console.log("  CAU basis: " + await replace("ai_cau_basis", { currency: "UGX" }, { currency_per_cau: 1 }, c => +c.currency_per_cau === 1));
    // Permitted but not eligible, evaluation pending: every activity, since any subject can be clinical (D1).
    for (const product of AI_PRODUCTS) for (const code of Object.keys(PROVISIONAL_ACTIVITIES[product])) for (const o of OTHER_PROVIDERS) {
      console.log(`  eligibility ${product}/${code}/${o.provider}: ` + await replace("ai_model_eligibility", { product, activity: code, provider: o.provider, model_prefix: o.model_prefix },
        { eligible: false, evidence_ref: null, max_risk_tier: null }, c => c.eligible === false));
    }
    const actor = { userId: null as unknown as string, name: "IND-007 agent session (provisional staging seed, owner decisions D1-D5)" };
    const ours = [...AI_PRODUCTS.map(fairUsePath), ...AI_PRODUCTS.map(assistantPath)];
    // publishScope publishes every draft in the scope: refuse if someone else has one pending.
    const { data: rows } = await admin.from("workspace_config_overrides").select("config_path, draft, published").eq("scope_type", FAIR_USE_SCOPE.scopeType).eq("scope_ref", FAIR_USE_SCOPE.scopeRef);
    const others = (rows ?? []).filter((r: any) => !ours.includes(r.config_path) && JSON.stringify(r.draft) !== JSON.stringify(r.published));
    if (others.length) throw new Error(`other drafts are pending in the AI fair-use scope -- not publishing them`);
    for (const product of AI_PRODUCTS) {
      const s = await setOverride(admin, actor, FAIR_USE_SCOPE, fairUsePath(product), settingsFor(product, {
        ...PROVISIONAL_ALLOWANCE, reset: { rule: "subscription_anniversary" }, currency: "UGX",
        activities: PROVISIONAL_ACTIVITIES[product], risk: PROVISIONAL_RISK,
      }));
      if (!s.ok) throw new Error(s.error);
      const a = await setOverride(admin, actor, FAIR_USE_SCOPE, assistantPath(product), resolveAssistantProfile(product, PROVISIONAL_ASSISTANT[product]));
      if (!a.ok) throw new Error(a.error);
    }
    const p = await publishScope(admin, actor, FAIR_USE_SCOPE, { label: "Provisional pilot AI policies and assistant profiles (owner D1-D5)", note: NOTE });
    if (!p.ok) throw new Error(p.error);
  }
  const [prices, basis, fx, elig, pol] = await Promise.all([
    admin.from("ai_price").select("provider, model_prefix, input_per_mtok_usd, output_per_mtok_usd, source_kind, price_version").is("effective_to", null),
    admin.from("ai_cau_basis").select("currency, currency_per_cau").is("effective_to", null),
    admin.from("ai_fx_rate").select("currency, per_usd, published_on, update_kind, note").is("effective_to", null),
    admin.from("ai_model_eligibility").select("product, activity, provider, eligible, max_risk_tier").is("effective_to", null),
    admin.from("workspace_config_overrides").select("config_path, published").eq("scope_ref", FAIR_USE_SCOPE.scopeRef),
  ]);
  console.log(JSON.stringify({
    prices: prices.data, basis: basis.data, fx: fx.data, eligible: (elig.data ?? []).filter((e: any) => e.eligible).length, notEligible: (elig.data ?? []).filter((e: any) => !e.eligible).length,
    policies: (pol.data ?? []).map((r: any) => ({ path: r.config_path, includedCau: r.published?.includedCau, activities: r.published?.activities ? Object.keys(r.published.activities).length : undefined,
      riskRules: r.published?.risk?.rules?.length, defaultMode: r.published?.defaultMode })),
  }, null, 1));
}

main().catch(e => { console.error(e.message ?? e); process.exit(1); });
