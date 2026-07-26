// Seed the AI Services Platform Phase 1 (migration 111): the provider + model registry (mirroring the AI Runtime
// Gateway's real list pricing in src/lib/ai/gateway.ts) and a realistic set of demo plat_ai_requests telemetry rows
// (so the AIS-011 observability console is populated — real telemetry is written live by generate() once the platform
// makes AI calls; this backfills a demo week). Idempotent. Run:  node scripts/seed-ai-services.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ins = async (t, rows) => { const { error } = await db.from(t).insert(rows); if (error) { console.error(`${t}:`, error.message); process.exit(1); } };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rint = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

await db.from("ais_models").delete().neq("id", "00000000-0000-0000-0000-000000000000");
await db.from("ais_providers").delete().neq("id", "00000000-0000-0000-0000-000000000000");

// ── Providers (anthropic is the configured provider; others registered for abstraction/fallback) ──
await ins("ais_providers", [
  { code: "anthropic", name: "Anthropic (Claude)", status: "active", priority: 1, base_url: "https://api.anthropic.com", notes: "Primary provider — used by the AI Runtime Gateway and clinical intelligence." },
  { code: "openai", name: "OpenAI", status: "inactive", priority: 2, base_url: "https://api.openai.com", notes: "Registered for provider abstraction / fallback; not currently configured." },
  { code: "gemini", name: "Google Gemini", status: "inactive", priority: 3, base_url: "https://generativelanguage.googleapis.com", notes: "Registered for provider abstraction; not currently configured." },
]);

// ── Models — mirrors the gateway's real PRICING (USD / 1M tokens) ──
const MODELS = [
  ["anthropic", "claude-fable-5", "Claude Fable 5", "heavy", 10, 50, 1000000, 128000, ["reasoning", "long-context", "agentic"], "active", false],
  ["anthropic", "claude-opus-4-8", "Claude Opus 4.8", "reasoning", 5, 25, 1000000, 64000, ["reasoning", "vision", "tools", "clinical"], "active", true],
  ["anthropic", "claude-opus-4-7", "Claude Opus 4.7", "reasoning", 5, 25, 1000000, 64000, ["reasoning", "vision", "tools"], "active", false],
  ["anthropic", "claude-opus-4-6", "Claude Opus 4.6", "reasoning", 5, 25, 1000000, 64000, ["reasoning", "tools"], "deprecated", false],
  ["anthropic", "claude-sonnet-5", "Claude Sonnet 5", "reasoning", 3, 15, 1000000, 64000, ["reasoning", "vision", "tools", "fast"], "active", false],
  ["anthropic", "claude-sonnet-4-6", "Claude Sonnet 4.6", "reasoning", 3, 15, 1000000, 64000, ["reasoning", "tools"], "active", false],
  ["anthropic", "claude-haiku-4-5", "Claude Haiku 4.5", "cheap", 1, 5, 200000, 32000, ["fast", "cheap", "classification"], "active", false],
  ["openai", "gpt-5", "GPT-5", "reasoning", null, null, 400000, 128000, ["reasoning", "tools"], "preview", false],
  ["gemini", "gemini-2.5-pro", "Gemini 2.5 Pro", "reasoning", null, null, 1000000, 65000, ["reasoning", "long-context"], "preview", false],
];
await ins("ais_models", MODELS.map(([provider_code, model_id, display_name, tier, input_price, output_price, context_window, max_output, capabilities, status, is_default]) => ({ provider_code, model_id, display_name, tier, input_price, output_price, context_window, max_output, capabilities, status, is_default })));

// ── Demo telemetry (plat_ai_requests) — realistic AI usage across operations over the last 7 days ──
const actor = (await db.from("profiles").select("id").ilike("email", "%@amu.competen.demo").limit(1)).data?.[0]?.id ?? null;
const tenant = (await db.from("tenants").select("id").limit(1)).data?.[0]?.id ?? null;
const PRICE = { "claude-opus-4-8": [5, 25], "claude-sonnet-5": [3, 15], "claude-haiku-4-5": [1, 5], "claude-fable-5": [10, 50], "claude-sonnet-4-6": [3, 15] };
const OPS = [["coach", "reasoning", "claude-opus-4-8"], ["assess", "reasoning", "claude-opus-4-8"], ["report", "heavy", "claude-fable-5"], ["copilot", "reasoning", "claude-sonnet-5"], ["summarize", "cheap", "claude-haiku-4-5"], ["recommend", "reasoning", "claude-sonnet-5"], ["classify", "cheap", "claude-haiku-4-5"], ["explain", "reasoning", "claude-opus-4-8"]];
const already = (await db.from("plat_ai_requests").select("id", { count: "exact", head: true })).count ?? 0;
const rows = [];
if (already < 50) {
  for (let i = 0; i < 140; i++) {
    const [operation, tier, model] = pick(OPS);
    const input = rint(400, 6000), output = rint(120, 2400);
    const [pin, pout] = PRICE[model] ?? [3, 15];
    const roll = Math.random();
    const status = roll > 0.96 ? "error" : roll > 0.92 ? "refusal" : "ok";
    rows.push({
      actor_id: actor, tenant_id: tenant, operation, tier, provider: "anthropic", model,
      input_tokens: input, output_tokens: output, total_tokens: input + output,
      latency_ms: tier === "cheap" ? rint(300, 1200) : tier === "heavy" ? rint(3000, 12000) : rint(900, 4500),
      status, error: status === "error" ? "upstream_timeout" : null,
      cost_usd: +((input / 1e6) * pin + (output / 1e6) * pout).toFixed(6),
      created_at: new Date(Date.now() - rint(0, 7 * 24 * 60) * 60000).toISOString(),
    });
  }
  await ins("plat_ai_requests", rows);
}

console.log(`✅ Seeded AI Services registry: 3 providers, ${MODELS.length} models (mirrors gateway pricing). Telemetry: ${already < 50 ? rows.length + " demo plat_ai_requests rows" : "left existing " + already + " real rows untouched"}.`);
