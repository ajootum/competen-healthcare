/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI-FAIR-USE-01 -- STAGING SEED of PROVISIONAL accounting rates, model eligibility and product AI policies
 * (needs migrations 410 and 411).
 *
 *   npx tsx scripts/seed-staging-ai-fair-use.ts            create (idempotent: skips a row already in force at the same value)
 *   npx tsx scripts/seed-staging-ai-fair-use.ts --verify   read only: what is in force
 *
 * STAGING ONLY: it refuses unless STAGING_SUPABASE_URL is a confirmed non-production project.
 *
 * ⚠ PROVISIONAL, LABELLED, NOT POLICY. Every row it writes says "provisional staging seed" in its note. The figures
 * are the owner's decisions of 2026-10-24 for a provisional pilot, never final commercial policy:
 *   D2  Anthropic list prices in USD, as this repository records them (src/lib/ai/gateway.ts), with their source.
 *       They must be checked against the provider's current published list before any production use.
 *   D3  a UGX reference rate. The value here is a PLACEHOLDER labelled as such -- not the Bank of Uganda's
 *       published rate. The owner replaces it with the month's BoU reference rate through the HQ page.
 *       A 10 pct buffer widens holds only.
 *   D4  1 CAU = UGX 1.
 *   D5  Scholar, and Professional separately with the same values: included 4,000 a month, reserve 500 for
 *       permitted essential activities only, a rolling 5-hour window of 1,000, monthly reset on the subscription
 *       anniversary, exhaustion leading to Learning Continuity.
 *   D1  Anthropic is the default provider. OpenAI and Gemini are permitted but NOT clinically eligible (evaluation
 *       pending). No model is made eligible for a clinically sensitive activity here: eligibility needs evaluation
 *       evidence, which does not exist yet, so on staging every sensitive activity is refused while metering is on.
 * Activity tiers and clinical sensitivity below are a provisional classification for the pilot, for the owner to
 * confirm on the HQ page.
 *
 * It does not switch metering on. The ai_fair_use flag is the owner's.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { setOverride, publishScope } from "../src/lib/config/workspace-config-write";
import { FAIR_USE_SCOPE, fairUsePath, AI_PRODUCTS, type AiProduct } from "../src/lib/ai/fair-use-policy";
import { settingsFor } from "../src/lib/ai/fair-use-admin";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const verify = process.argv.includes("--verify");
const NOTE = "provisional staging seed (AI-FAIR-USE-01 owner decisions 2026-10-24, provisional pilot, not commercial policy)";
const FX_NOTE = "PLACEHOLDER, not the Bank of Uganda reference rate: provisional staging seed (AI-FAIR-USE-01 D3). Replace with the month's BoU reference rate.";
const PRICE_SOURCE = "https://docs.claude.com/en/docs/about-claude/pricing (list price as recorded in src/lib/ai/gateway.ts, to verify before production)";

export const PROVISIONAL = {
  ugxPerUsdPlaceholder: 3700, ugxPerCau: 1, fxBufferPct: 10,
  includedCau: 4000, reserveCau: 500, windowMinutes: 300, windowCapCau: 1000, maxUnreconciledCau: 400,
  levels: { optimisedBelowPct: 30, essentialBelowPct: 10 },
};
const PRICES = [
  { provider: "anthropic", model_prefix: "claude-haiku-4-5", input_per_mtok_usd: 1, output_per_mtok_usd: 5 },
  { provider: "anthropic", model_prefix: "claude-sonnet-4", input_per_mtok_usd: 3, output_per_mtok_usd: 15 },
  { provider: "anthropic", model_prefix: "claude-opus-4", input_per_mtok_usd: 5, output_per_mtok_usd: 25 },
];
type A = { label: string; class?: "essential"; tier: string; minTier: string; maxOutputTokens: number; clinicallySensitive: boolean; reserveEligible?: boolean };
const a = (label: string, tier: string, minTier: string, maxOutputTokens: number, clinicallySensitive: boolean, essential = false): A =>
  ({ label, tier, minTier, maxOutputTokens, clinicallySensitive, ...(essential ? { class: "essential" as const, reserveEligible: true } : {}) });
const ACTIVITIES: Record<AiProduct, Record<string, A>> = {
  scholar: {
    teach: a("Teaching a topic", "reasoning", "cheap", 1500, false),
    explain: a("Explanations", "reasoning", "cheap", 1500, false),
    simplify: a("Simpler explanations", "cheap", "cheap", 800, false),
    deeper: a("Going deeper", "reasoning", "reasoning", 1800, false),
    examples: a("Worked examples", "reasoning", "cheap", 1200, false),
    summary: a("Summaries", "cheap", "cheap", 900, false),
    ask: a("Questions about your material", "reasoning", "cheap", 900, false),
    check: a("Checking your answers", "reasoning", "reasoning", 1000, true),
    clarify: a("Clarify an existing explanation", "cheap", "cheap", 600, false, true),
    tutor_continue: a("Finish an interrupted tutoring session", "reasoning", "cheap", 900, false, true),
    map: a("Competency mapping", "reasoning", "cheap", 2000, false),
    questions: a("Practice questions", "reasoning", "reasoning", 2000, true),
    case_steps: a("Clinical cases", "reasoning", "reasoning", 2500, true),
    assistant: a("Personal AI questions", "reasoning", "cheap", 900, false),
  },
  professional: {
    assistant: a("CPD planning and reflection drafting", "reasoning", "cheap", 900, false),
    map: a("Competency suggestions", "reasoning", "cheap", 2000, false),
  },
};
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
  const probe = await admin.from("ai_model_eligibility").select("id").limit(0);
  if (probe.error) { console.error(`Migration 411 is not applied here (${probe.error.message}). Nothing written.`); process.exit(1); }
  if (!verify) {
    for (const p of PRICES) {
      console.log(`  price ${p.model_prefix}: ` + await replace("ai_price", { provider: p.provider, model_prefix: p.model_prefix },
        { input_per_mtok_usd: p.input_per_mtok_usd, output_per_mtok_usd: p.output_per_mtok_usd, source_kind: "list", source_ref: PRICE_SOURCE, price_version: "provisional-2026-10" },
        c => +c.input_per_mtok_usd === p.input_per_mtok_usd && +c.output_per_mtok_usd === p.output_per_mtok_usd && c.source_ref === PRICE_SOURCE));
    }
    console.log("  CAU basis: " + await replace("ai_cau_basis", { currency: "UGX" }, { currency_per_cau: PROVISIONAL.ugxPerCau }, c => +c.currency_per_cau === PROVISIONAL.ugxPerCau));
    console.log("  UGX rate: " + await replace("ai_fx_rate", { currency: "UGX" }, { per_usd: PROVISIONAL.ugxPerUsdPlaceholder, note: FX_NOTE }, c => +c.per_usd === PROVISIONAL.ugxPerUsdPlaceholder && c.note === FX_NOTE));
    // Permitted but not clinically eligible, evaluation pending (D1). One row per sensitive activity and provider.
    for (const product of AI_PRODUCTS) for (const [code, act] of Object.entries(ACTIVITIES[product])) {
      if (!act.clinicallySensitive) continue;
      for (const o of OTHER_PROVIDERS) {
        console.log(`  eligibility ${product}/${code}/${o.provider}: ` + await replace("ai_model_eligibility", { product, activity: code, provider: o.provider, model_prefix: o.model_prefix },
          { eligible: false, evidence_ref: null }, c => c.eligible === false));
      }
    }
    const actor = { userId: null as unknown as string, name: "IND-007 agent session (AI-FAIR-USE-01 provisional staging seed)" };
    // publishScope publishes every draft in the scope: refuse if someone else has one pending.
    const { data: rows } = await admin.from("workspace_config_overrides").select("config_path, draft, published").eq("scope_type", FAIR_USE_SCOPE.scopeType).eq("scope_ref", FAIR_USE_SCOPE.scopeRef);
    const others = (rows ?? []).filter((r: any) => !AI_PRODUCTS.map(fairUsePath).includes(r.config_path) && JSON.stringify(r.draft) !== JSON.stringify(r.published));
    if (others.length) throw new Error(`other drafts are pending in the AI fair-use scope -- not publishing them`);
    for (const product of AI_PRODUCTS) {
      const s = await setOverride(admin, actor, FAIR_USE_SCOPE, fairUsePath(product), settingsFor(product, {
        includedCau: PROVISIONAL.includedCau, reserveCau: PROVISIONAL.reserveCau,
        windowMinutes: PROVISIONAL.windowMinutes, windowCapCau: PROVISIONAL.windowCapCau,
        levels: PROVISIONAL.levels, reset: { rule: "subscription_anniversary" },
        currency: "UGX", fxBufferPct: PROVISIONAL.fxBufferPct, maxUnreconciledCau: PROVISIONAL.maxUnreconciledCau,
        activities: ACTIVITIES[product],
      }));
      if (!s.ok) throw new Error(s.error);
    }
    const p = await publishScope(admin, actor, FAIR_USE_SCOPE, { label: "Provisional pilot AI policies (owner D1-D5)", note: NOTE });
    if (!p.ok) throw new Error(p.error);
  }
  const [prices, basis, fx, elig, pol] = await Promise.all([
    admin.from("ai_price").select("provider, model_prefix, input_per_mtok_usd, output_per_mtok_usd, source_kind, price_version").is("effective_to", null),
    admin.from("ai_cau_basis").select("currency, currency_per_cau").is("effective_to", null),
    admin.from("ai_fx_rate").select("currency, per_usd, note").is("effective_to", null),
    admin.from("ai_model_eligibility").select("product, activity, provider, eligible").is("effective_to", null),
    admin.from("workspace_config_overrides").select("config_path, published").eq("scope_ref", FAIR_USE_SCOPE.scopeRef),
  ]);
  console.log(JSON.stringify({
    prices: prices.data, basis: basis.data, fx: fx.data, eligible: (elig.data ?? []).filter((e: any) => e.eligible).length, notEligible: (elig.data ?? []).filter((e: any) => !e.eligible).length,
    policies: (pol.data ?? []).map((r: any) => ({ path: r.config_path, includedCau: r.published?.includedCau, reserveCau: r.published?.reserveCau, window: [r.published?.windowMinutes, r.published?.windowCapCau], reset: r.published?.reset?.rule, activities: Object.keys(r.published?.activities ?? {}).length })),
  }, null, 1));
}

main().catch(e => { console.error(e.message ?? e); process.exit(1); });
