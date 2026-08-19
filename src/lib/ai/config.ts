// ============================================================
// Provider-agnostic AI configuration (Book IV)
// No SDK dependency — the live client (config.ts's sibling client.ts, added
// once a provider is chosen) uses fetch against the provider's REST API.
// This module only reports whether/how AI is configured, so the rest of the
// app can degrade gracefully when no key is present.
// ============================================================

export type AiProvider = "anthropic" | "openai" | "gemini";

export type AiStatus = {
  configured: boolean;
  provider: AiProvider | null;
  /**
   * ⚠ WHETHER TEXT GENERATION ACTUALLY WORKS, WHICH IS NOT THE SAME AS `configured`.
   *
   * `configured` means a provider key is present, and for EMBEDDINGS that is enough -- embed.ts really
   * does implement all three (Voyage for anthropic, OpenAI, Gemini). GENERATION is Anthropic-only:
   * client.ts returns null for any other provider.
   *
   * So with OPENAI_API_KEY set, `configured` was true, every 503 "not configured" gate PASSED, the
   * client returned null, generation failed as not_configured, the caller got a generic 502 -- and the
   * status panel displayed "Provider: openai / Model: gpt-4o" as though it were live. A confident false
   * state is worse than a refusal, because the refusal names the thing to fix.
   *
   * ⚠ THIS IS NOT YET READ BY ALL 120 aiStatus CALL SITES. It is read by the generation paths this
   * change touches; converting the rest is a sweep, not a side effect of one. A gate still testing
   * `configured` is no worse than it was, and this field is what a correct one tests.
   */
  canGenerate: boolean;
  // Model tiers to use for different jobs (defaults tuned for Anthropic).
  models: { cheap: string; reasoning: string; heavy: string; embedding: string } | null;
};

/**
 * Detect provider from env. Set exactly one of:
 *   ANTHROPIC_API_KEY | OPENAI_API_KEY | GEMINI_API_KEY
 * Optionally override the default models with AI_MODEL_* env vars.
 */
export function aiStatus(): AiStatus {
  const anthropic = process.env.ANTHROPIC_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  const gemini = process.env.GEMINI_API_KEY;

  if (anthropic) {
    return {
      configured: true,
      // The only provider client.ts implements, so the only one that can generate.
      canGenerate: true,
      provider: "anthropic",
      models: {
        cheap:     process.env.AI_MODEL_CHEAP     ?? "claude-haiku-4-5-20251001",
        reasoning: process.env.AI_MODEL_REASONING ?? "claude-sonnet-4-6",
        heavy:     process.env.AI_MODEL_HEAVY     ?? "claude-opus-4-8",
        embedding: process.env.AI_MODEL_EMBEDDING ?? "voyage-3", // Anthropic recommends Voyage for embeddings
      },
    };
  }
  if (openai) {
    return {
      configured: true, provider: "openai", canGenerate: false,
      models: {
        cheap:     process.env.AI_MODEL_CHEAP     ?? "gpt-4o-mini",
        reasoning: process.env.AI_MODEL_REASONING ?? "gpt-4o",
        heavy:     process.env.AI_MODEL_HEAVY     ?? "gpt-4o",
        embedding: process.env.AI_MODEL_EMBEDDING ?? "text-embedding-3-small",
      },
    };
  }
  if (gemini) {
    return {
      configured: true, provider: "gemini", canGenerate: false,
      models: {
        cheap:     process.env.AI_MODEL_CHEAP     ?? "gemini-2.0-flash",
        reasoning: process.env.AI_MODEL_REASONING ?? "gemini-2.0-flash",
        heavy:     process.env.AI_MODEL_HEAVY     ?? "gemini-2.0-pro",
        embedding: process.env.AI_MODEL_EMBEDDING ?? "text-embedding-004",
      },
    };
  }
  return { configured: false, provider: null, canGenerate: false, models: null };
}
