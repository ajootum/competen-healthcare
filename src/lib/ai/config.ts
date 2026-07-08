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
      configured: true, provider: "openai",
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
      configured: true, provider: "gemini",
      models: {
        cheap:     process.env.AI_MODEL_CHEAP     ?? "gemini-2.0-flash",
        reasoning: process.env.AI_MODEL_REASONING ?? "gemini-2.0-flash",
        heavy:     process.env.AI_MODEL_HEAVY     ?? "gemini-2.0-pro",
        embedding: process.env.AI_MODEL_EMBEDDING ?? "text-embedding-004",
      },
    };
  }
  return { configured: false, provider: null, models: null };
}
