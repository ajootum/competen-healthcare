// ============================================================
// Provider-agnostic AI configuration (Book IV)
// No SDK dependency here — this module only reports which provider this
// deployment runs on and whether it is usable, so the rest of the app can
// degrade gracefully when nothing is configured.
// ============================================================

export const AI_PROVIDERS = ["anthropic", "openai", "gemini"] as const;
export type AiProvider = typeof AI_PROVIDERS[number];

/**
 * ⚠ A KEY IS AVAILABILITY, NOT PREFERENCE. THIS IS THE WHOLE POINT OF THIS FILE.
 *
 * Until 2026-08-24 the provider was whichever key happened to be present, tested in a fixed order:
 * Anthropic, then OpenAI, then Gemini. That is inference, and it has two failure modes that both
 * showed up in practice. Adding a second key to try something changed nothing, silently, because the
 * first branch still won. And removing the first key changed the vendor every patient record is sent
 * to, silently, because the second branch then won.
 *
 * A deployment now says which provider it runs on, in AI_PRIMARY_PROVIDER. Keys answer a different
 * question -- "could this provider be used" -- and answering it no longer decides anything.
 */
const KEY_ENV: Record<AiProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

const DEFAULT_MODELS: Record<AiProvider, { cheap: string; reasoning: string; heavy: string; embedding: string }> = {
  anthropic: {
    cheap: "claude-haiku-4-5-20251001",
    reasoning: "claude-sonnet-4-6",
    heavy: "claude-opus-4-8",
    embedding: "voyage-3", // Anthropic recommends Voyage for embeddings
  },
  openai: {
    cheap: "gpt-4o-mini",
    reasoning: "gpt-4o",
    heavy: "gpt-4o",
    embedding: "text-embedding-3-small",
  },
  gemini: {
    cheap: "gemini-2.0-flash",
    reasoning: "gemini-2.0-flash",
    heavy: "gemini-2.0-pro",
    embedding: "text-embedding-004",
  },
};

export type AiStatus = {
  /** The PRIMARY provider's key is present, so this deployment can actually reach it. */
  configured: boolean;
  /**
   * The provider this deployment runs on -- what AI_PRIMARY_PROVIDER names, whether or not its key is
   * present. Null only when that variable names something that is not a provider.
   *
   * ⚠ IT NO LONGER MEANS "THE KEY WE FOUND". A deployment naming gemini with only an Anthropic key
   * reports provider gemini and configured false -- a misconfiguration stated plainly, rather than
   * quietly served by whichever vendor happened to have a key.
   */
  provider: AiProvider | null;
  /**
   * ⚠ WHETHER TEXT GENERATION ACTUALLY WORKS, WHICH IS NOT THE SAME AS `configured`.
   *
   * These came apart once already: with OPENAI_API_KEY set, `configured` was true, every 503 "not
   * configured" gate PASSED, the client returned null because only Anthropic had an adapter,
   * generation failed as not_configured, the caller got a generic 502 -- and the status panel showed
   * "Provider: openai / Model: gpt-4o" as though it were live. A confident false state is worse than a
   * refusal, because the refusal names the thing to fix.
   *
   * All three providers have adapters now, so this equals `configured` today. It stays a separate
   * field because the two answer different questions, and the next provider added will have a period
   * where they differ again.
   *
   * ⚠ NOT READ BY EVERY aiStatus CALL SITE. Converting the rest is a sweep, not a side effect of one
   * change. A gate still testing `configured` is no worse than it was; this is what a correct one tests.
   */
  canGenerate: boolean;
  /** Model tiers for the primary provider. */
  models: { cheap: string; reasoning: string; heavy: string; embedding: string } | null;
  /**
   * Which providers hold a key. Diagnostics only -- an operator answering "what could I switch to".
   * Nothing chooses from this list.
   */
  available: AiProvider[];
};

const isProvider = (v: string | undefined): v is AiProvider =>
  !!v && (AI_PROVIDERS as readonly string[]).includes(v);

/**
 * The provider this deployment runs on.
 *
 * ⚠ THE DEFAULT IS A FIXED CONSTANT, NOT A GUESS FROM THE KEYS. When AI_PRIMARY_PROVIDER is unset the
 * answer is anthropic every time -- including on a deployment that holds only a Gemini key, which then
 * reports configured false rather than quietly switching vendor. That is the behaviour this file
 * exists to prevent, so the default must not reintroduce it.
 *
 * The default exists so that setting the variable can be a deployment step rather than a prerequisite;
 * production ran without it the day this landed. Set it explicitly.
 */
export function primaryProvider(): AiProvider | null {
  const named = process.env.AI_PRIMARY_PROVIDER?.trim().toLowerCase();
  if (!named) return "anthropic";
  return isProvider(named) ? named : null;
}

/** Which providers hold a key. Availability, and nothing else. */
export function availableProviders(): AiProvider[] {
  return AI_PROVIDERS.filter(p => !!process.env[KEY_ENV[p]]);
}

/** The key for a provider, or null. Adapters ask; nothing else should need to. */
export function providerKey(p: AiProvider): string | null {
  return process.env[KEY_ENV[p]] ?? null;
}

export function aiStatus(): AiStatus {
  const provider = primaryProvider();
  const available = availableProviders();
  if (!provider) {
    // AI_PRIMARY_PROVIDER names something that is not a provider. Refusing is the honest answer:
    // falling back to a key would be the inference this file removed.
    return { configured: false, provider: null, canGenerate: false, models: null, available };
  }

  const configured = available.includes(provider);
  return {
    configured,
    provider,
    canGenerate: configured,
    models: configured
      ? {
          cheap: process.env.AI_MODEL_CHEAP ?? DEFAULT_MODELS[provider].cheap,
          reasoning: process.env.AI_MODEL_REASONING ?? DEFAULT_MODELS[provider].reasoning,
          heavy: process.env.AI_MODEL_HEAVY ?? DEFAULT_MODELS[provider].heavy,
          embedding: process.env.AI_MODEL_EMBEDDING ?? DEFAULT_MODELS[provider].embedding,
        }
      : null,
    available,
  };
}
