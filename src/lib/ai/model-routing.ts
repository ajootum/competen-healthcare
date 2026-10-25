/* eslint-disable @typescript-eslint/no-explicit-any */
import { AI_PROVIDERS, type AiProvider } from "./config";
import type { AiTier } from "./fair-use-policy";
import { riskRank, type RiskTier } from "./clinical-risk";

// ── MODEL ROUTING ── owner "COMPETEN — MULTI-PROVIDER AI DIRECTION", 25 October 2026 ───────────────────────────────
//
// Anthropic, OpenAI and Gemini are first-class providers of ONE Holdings AI Gateway (client.ts). Which provider and
// model serve a request is no-code configuration -- the CONFIG-002 document `ai.model_routing` in the AI governance scope
// (platform / ai_fair_use), drafted on /super-admin/ai/fair-use under hq.platform.ai.manage and published with the
// other AI policies -- never code and never an environment variable alone:
//   providers   which are enabled, and the model each serves for each tier;
//   tiers       for each tier, the providers in order: the primary first, then the alternatives;
//   activities  for one product's activity, its own ordered candidates (primary and alternatives), overriding the tier.
//
// ⚠ CREDENTIALS NEVER LIVE HERE. A provider's key stays in the deployment environment (config.ts providerKey). The
// resolver keeps only the fields below, so a credential pasted into the document is dropped, never stored as policy.
// A provider with no key is simply not available: it is skipped, not an error.
//
// ⚠ NEVER A NON-ELIGIBLE MODEL. For a clinical-risk request the caller passes an eligibility gate, and only a
// candidate that passes it can be chosen. An ALTERNATIVE is used only when it is itself eligible. There is no
// "nearest model" fallback, and nothing is silently downgraded: the candidates are the ones the administrator
// configured for that tier or activity. Models from different providers are not assumed equivalent -- that is exactly
// what per-model eligibility records.
//
// ⚠ SELECTION-TIME ONLY. A disabled or keyless provider is skipped when choosing. A provider that FAILS mid-request is
// not retried on another (client.ts FALLBACK_ENABLED stays false): on the metered path that would need a reservation
// per attempt, and a refusal is never failed over at all (ai-provider-harness s4).
//
// ⚠ UNPUBLISHED MEANS TODAY. With no published document, routing is exactly the deployment's AI_PRIMARY_PROVIDER and
// its per-tier models, so nothing changes until an administrator publishes.

export const MODEL_ROUTING_PATH = "ai.model_routing";
export const TIERS: readonly AiTier[] = ["cheap", "reasoning", "heavy"];
export type Route = { provider: AiProvider; model: string };
export type ModelRouting = {
  published: boolean;
  providers: Record<AiProvider, { enabled: boolean; models: Partial<Record<AiTier, string>> }>;
  tiers: Record<AiTier, AiProvider[]>;
  /** `${product}.${activity}` → its own ordered candidates. */
  activities: Record<string, Route[]>;
};

const MODEL_ID = /^[a-z0-9][a-z0-9._:-]{1,79}$/i;
const ACTIVITY_KEY = /^(scholar|professional)\.[a-z][a-z0-9_]{1,40}$/;
const isProvider = (v: unknown): v is AiProvider => (AI_PROVIDERS as readonly string[]).includes(v as string);
const route = (v: any): Route | null => (isProvider(v?.provider) && typeof v?.model === "string" && MODEL_ID.test(v.model.trim()) ? { provider: v.provider, model: v.model.trim() } : null);

/** Pure: a routing document, kept to its known fields and clamped. null/absent = unpublished (today's behaviour). */
export function resolveModelRouting(s: any): ModelRouting {
  const providers = Object.fromEntries(AI_PROVIDERS.map(p => {
    const v = s?.providers?.[p];
    const models: Partial<Record<AiTier, string>> = {};
    for (const t of TIERS) if (typeof v?.models?.[t] === "string" && MODEL_ID.test(v.models[t].trim())) models[t] = v.models[t].trim();
    return [p, { enabled: v?.enabled === true, models }];
  })) as ModelRouting["providers"];
  const tiers = Object.fromEntries(TIERS.map(t => [t, [...new Set((Array.isArray(s?.tiers?.[t]) ? s.tiers[t] : []).filter(isProvider))] as AiProvider[]])) as ModelRouting["tiers"];
  const activities: Record<string, Route[]> = {};
  for (const [k, v] of Object.entries(s?.activities && typeof s.activities === "object" ? s.activities : {}).slice(0, 100)) {
    if (!ACTIVITY_KEY.test(k) || !Array.isArray(v)) continue;
    const rs = (v as any[]).map(route).filter((r): r is Route => !!r).slice(0, 5);
    if (rs.length) activities[k] = rs;
  }
  return { published: !!s && typeof s === "object", providers, tiers, activities };
}

/**
 * Pure: the ordered candidates for one request. Published: the activity's own list if it has one, else the tier's
 * providers with the model each serves for that tier, keeping only enabled providers. Unpublished: the deployment's
 * primary provider and its model for the tier (`legacy`), exactly as before.
 */
export function routeCandidates(r: ModelRouting, legacy: Route | null, ctx: { product: string; activity: string; tier: AiTier }): Route[] {
  if (!r.published) return legacy ? [legacy] : [];
  const own = r.activities[`${ctx.product}.${ctx.activity}`];
  const list = own ?? r.tiers[ctx.tier].map(p => (r.providers[p].models[ctx.tier] ? { provider: p, model: r.providers[p].models[ctx.tier]! } : null)).filter((x): x is Route => !!x);
  return list.filter(c => r.providers[c.provider].enabled);
}

export type EligibilityLike = { activity: string; provider: string; model_prefix: string; eligible: boolean; max_risk_tier: string | null };

/** Pure: whether an eligibility decision covers this activity, route and risk tier (the ai_reserve predicate, 412). */
export const eligibleFor = (rows: readonly EligibilityLike[], activity: string, c: Route, risk: RiskTier) =>
  rows.some(e => e.activity === activity && e.provider === c.provider && e.eligible && c.model.startsWith(e.model_prefix)
    && riskRank((e.max_risk_tier ?? "clinical_educational") as RiskTier) >= riskRank(risk));

/**
 * Pure: the route a request runs on, or null. The first candidate whose provider has a key and that passes the gate.
 * For a request above standard educational the gate is eligibility: an alternative is chosen only if it is eligible.
 */
export function selectRoute(cands: readonly Route[], available: readonly AiProvider[], gate: (c: Route) => boolean): Route | null {
  return cands.find(c => available.includes(c.provider) && gate(c)) ?? null;
}

/** The clinical gate for one request: none at standard educational, eligibility above it. */
export const clinicalGate = (rows: readonly EligibilityLike[] | null, activity: string, risk: RiskTier) =>
  (c: Route) => riskRank(risk) <= 0 || (!!rows && eligibleFor(rows, activity, c, risk));
