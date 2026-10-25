/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The D5 evaluation candidates, for EVERY provider the Holdings AI Gateway supports (owner MULTI-PROVIDER AI DIRECTION:
 * "the existing D5 framework applies to all providers"), and the one pinned call both runners make through the gateway.
 *
 * ⚠ THROUGH THE GATEWAY, NOT A VENDOR SDK. Each call is generate() with a route (src/lib/ai/client.ts): the same
 * adapters, keys from the environment, and usage records a student's request would get. A candidate whose provider has
 * no key in this environment is NOT EVALUATED, and is reported as such. It is never silently replaced by another.
 *
 * ⚠ CANDIDATES ARE NOT ASSUMED EQUIVALENT. Each model is scored on its own answers, and eligibility is recorded per
 * provider and model by a person (ai_model_eligibility). Nothing here makes a model eligible.
 */
import { availableProviders } from "../src/lib/ai/config";
import { generate } from "../src/lib/ai/client";
import { PROVIDER_REGISTRY_PATH, registeredAvailable, resolveRegistry } from "../src/lib/ai/provider-registry";

/** A built-in provider, or a registered one (provider-registry.ts) with its approved endpoint. */
export type Candidate = { provider: string; model: string; tier: "cheap" | "reasoning" | "heavy"; endpoint?: string };

export const ALL_CANDIDATES: readonly Candidate[] = [
  { provider: "anthropic", model: "claude-haiku-4-5-20251001", tier: "cheap" },
  { provider: "anthropic", model: "claude-sonnet-4-6", tier: "reasoning" },
  { provider: "anthropic", model: "claude-opus-4-8", tier: "heavy" },
  { provider: "openai", model: "gpt-4o-mini", tier: "cheap" },
  { provider: "openai", model: "gpt-4o", tier: "heavy" },
  { provider: "gemini", model: "gemini-2.0-flash", tier: "cheap" },
  { provider: "gemini", model: "gemini-2.0-pro", tier: "heavy" },
];

/** Pure over the environment: who can be evaluated here, and who cannot, with the reason. `--only provider,…` narrows. */
export function evaluationCandidates(only?: string): { candidates: Candidate[]; notEvaluated: { provider: string; why: string }[] } {
  const keyed: string[] = availableProviders();
  const wanted = only ? only.split(",").map(s => s.trim()) : null;
  const pool = ALL_CANDIDATES.filter(c => !wanted || wanted.includes(c.provider));
  const missing = [...new Set(pool.filter(c => !keyed.includes(c.provider)).map(c => c.provider))];
  return { candidates: pool.filter(c => keyed.includes(c.provider)), notEvaluated: missing.map(p => ({ provider: p, why: `no ${p.toUpperCase()} key in this environment` })) };
}

export type PinnedResult = { ok: true; text: string; model: string; input: number; output: number } | { ok: false; refusal: boolean; error: string; input: number | null; output: number | null };

/**
 * Registered providers that can be evaluated here: ACTIVE in the published registry of the target environment, with
 * their key in this environment and their host permitted. Same sets, same gateway. Eligibility still needs a person.
 */
export async function registeredCandidates(admin: any): Promise<Candidate[]> {
  const { data } = await admin.from("workspace_config_overrides").select("published").eq("scope_type", "platform").eq("scope_ref", "ai_fair_use").eq("config_path", PROVIDER_REGISTRY_PATH).maybeSingle();
  return Object.values(resolveRegistry(data?.published ?? null)).filter(p => registeredAvailable(p))
    .flatMap(p => (Object.entries(p.models) as [Candidate["tier"], string][]).map(([tier, model]) => ({ provider: p.id, model, tier, endpoint: p.endpoint })));
}

/** One call, pinned to a candidate, through the Holdings gateway. */
export async function pinnedCall(c: Candidate, g: { system: string; user: string; maxTokens?: number }): Promise<PinnedResult> {
  const r = await generate({ system: g.system, user: g.user, maxTokens: g.maxTokens ?? 1500, tier: c.tier, route: { provider: c.provider, model: c.model, ...(c.endpoint ? { endpoint: c.endpoint } : {}) }, context: { operation: "ai_model_evaluation" } });
  if (r.ok) return { ok: true, text: r.text, model: r.model, input: r.usage?.input ?? 0, output: r.usage?.output ?? 0 };
  const usage = "usage" in r && r.usage ? r.usage : null;
  return { ok: false, refusal: r.error === "refusal", error: r.error === "failed" && "detail" in r ? String(r.detail ?? "failed") : r.error, input: usage?.input ?? null, output: usage?.output ?? null };
}
