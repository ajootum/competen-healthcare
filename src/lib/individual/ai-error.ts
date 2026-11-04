// ── LEARNING-CLOSE-2026-11 D06 / LE-01: ONE SET OF WORDS WHEN THE AI PROVIDER CANNOT ANSWER ──────────────────────
//
// Pure. Every Individual AI route (Scholar and Professional, the Personal AI, the Professional assistant, mappings
// and document drafts) answers a provider outcome -- not set up, declined, did not answer -- with the SAME body:
// the person's words and a `code` the shared copy reads (ai-availability.ts reasonFromRefusal), so every surface
// explains it the same way and says what still works. Never "environment", never a provider or model name, never an
// internal reason: the governed non-AI functions stay usable and the words say so.

export type AiErrorKind = "not_configured" | "refusal" | "failed";

export const AI_ERROR: Record<AiErrorKind, { status: number; error: string; code: AiErrorKind }> = {
  not_configured: { status: 503, error: "AI help is not available right now, so nothing was sent. Everything you have saved still works.", code: "not_configured" },
  refusal: { status: 502, error: "The AI declined that request.", code: "refusal" },
  failed: { status: 502, error: "The AI could not answer just now. Try again shortly. Everything you have saved still works.", code: "failed" },
};

/** The kind for a gateway generation outcome (`result.error`): the provider not set up, a refusal, or anything else. */
export const aiErrorKindOf = (error: string | null | undefined): AiErrorKind =>
  error === "not_configured" ? "not_configured" : error === "refusal" ? "refusal" : "failed";

/** The response body for a kind: the words and the code, nothing else. */
export const aiErrorBody = (kind: AiErrorKind): { error: string; code: AiErrorKind } => ({ error: AI_ERROR[kind].error, code: AI_ERROR[kind].code });
