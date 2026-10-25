import { describe, expect, it } from "vitest";
import { clinicalGate, eligibleFor, resolveModelRouting, routeCandidates, selectRoute, type Route } from "./model-routing";

// Owner "MULTI-PROVIDER AI DIRECTION" (25 October 2026): Anthropic, OpenAI and Gemini first-class, routing no-code,
// credentials outside configuration, and never a fallback to a model that is not eligible for a clinical request.

const OPUS: Route = { provider: "anthropic", model: "claude-opus-4-8" };
const SONNET: Route = { provider: "anthropic", model: "claude-sonnet-4-6" };
const GPT: Route = { provider: "openai", model: "gpt-4o" };
const GEMINI: Route = { provider: "gemini", model: "gemini-2.0-pro" };
const DOC = {
  providers: {
    anthropic: { enabled: true, models: { cheap: "claude-haiku-4-5", reasoning: "claude-sonnet-4-6", heavy: "claude-opus-4-8" } },
    openai: { enabled: true, models: { reasoning: "gpt-4o", heavy: "gpt-4o" } },
    gemini: { enabled: false, models: { heavy: "gemini-2.0-pro" } },
  },
  tiers: { cheap: ["anthropic"], reasoning: ["openai", "anthropic"], heavy: ["gemini", "openai", "anthropic"] },
  activities: { "scholar.case_steps": [OPUS, GPT] },
};
const row = (activity: string, r: Route, tier = "clinical_educational") => ({ activity, provider: r.provider, model_prefix: r.model, eligible: true, max_risk_tier: tier });

describe("the routing document", () => {
  it("unpublished: exactly today -- the deployment's primary provider and its model for the tier", () => {
    const r = resolveModelRouting(null);
    expect(r.published).toBe(false);
    expect(routeCandidates(r, SONNET, { product: "scholar", activity: "teach", tier: "reasoning" })).toEqual([SONNET]);
    expect(routeCandidates(r, null, { product: "scholar", activity: "teach", tier: "reasoning" })).toEqual([]);
  });

  it("published: the tier's providers in order, disabled ones dropped, an activity's own list overriding", () => {
    const r = resolveModelRouting(DOC);
    expect(routeCandidates(r, SONNET, { product: "scholar", activity: "teach", tier: "reasoning" })).toEqual([GPT, SONNET]);
    expect(routeCandidates(r, SONNET, { product: "scholar", activity: "explain", tier: "heavy" })).toEqual([GPT, OPUS]);   // gemini disabled
    expect(routeCandidates(r, SONNET, { product: "scholar", activity: "case_steps", tier: "heavy" })).toEqual([OPUS, GPT]);
  });

  it("no credential survives: unknown fields are dropped, and a model id must look like one", () => {
    const r = resolveModelRouting({ ...DOC, apiKey: "not-a-real-credential", providers: { ...DOC.providers, openai: { enabled: true, key: "not-a-real-credential", models: { reasoning: "gpt 4o; drop table" } } } });
    expect(JSON.stringify(r)).not.toMatch(/credential|key/i);
    expect(r.providers.openai.models.reasoning).toBeUndefined();
  });
});

describe("choosing a route", () => {
  const r = resolveModelRouting(DOC);
  const cands = (activity: string, tier: "reasoning" | "heavy") => routeCandidates(r, SONNET, { product: "scholar", activity, tier });

  it("a provider without a key is skipped, not an error -- the pilot runs on the keyed provider", () => {
    expect(selectRoute(cands("teach", "reasoning"), ["anthropic"], () => true)).toEqual(SONNET);
    expect(selectRoute(cands("teach", "reasoning"), ["anthropic", "openai"], () => true)).toEqual(GPT);
    expect(selectRoute(cands("teach", "reasoning"), [], () => true)).toBeNull();
  });

  it("CLINICAL: only an eligible candidate is ever chosen -- an alternative only if it is itself eligible", () => {
    const gate = clinicalGate([row("explain", OPUS)], "explain", "clinical_educational");
    expect(selectRoute(cands("explain", "heavy"), ["anthropic", "openai"], gate)).toEqual(OPUS);           // GPT first, not eligible: skipped
    expect(selectRoute(cands("explain", "heavy"), ["openai"], gate)).toBeNull();                           // never GPT instead
  });

  it("CLINICAL: no fallback to a non-eligible model, a lower tier, another activity, or with eligibility unreadable", () => {
    expect(selectRoute(cands("teach", "reasoning"), ["anthropic", "openai"], clinicalGate([], "teach", "clinical_educational"))).toBeNull();
    expect(selectRoute(cands("teach", "reasoning"), ["anthropic"], clinicalGate([row("teach", SONNET, "clinical_educational")], "teach", "high_risk_clinical"))).toBeNull();
    expect(selectRoute(cands("teach", "reasoning"), ["anthropic"], clinicalGate([row("ask", SONNET)], "teach", "clinical_educational"))).toBeNull();
    expect(selectRoute(cands("teach", "reasoning"), ["anthropic"], clinicalGate(null, "teach", "clinical_educational"))).toBeNull();
  });

  it("control: standard educational needs no eligibility", () => {
    expect(selectRoute(cands("teach", "reasoning"), ["anthropic"], clinicalGate(null, "teach", "standard_educational"))).toEqual(SONNET);
  });

  it("eligibility is per provider and model: an Opus decision does not cover GPT or Gemini", () => {
    expect(eligibleFor([row("explain", OPUS)], "explain", GPT, "clinical_educational")).toBe(false);
    expect(eligibleFor([row("explain", OPUS)], "explain", GEMINI, "clinical_educational")).toBe(false);
    expect(eligibleFor([row("explain", OPUS)], "explain", OPUS, "clinical_educational")).toBe(true);
  });
});
