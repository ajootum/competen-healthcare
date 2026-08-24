import Anthropic from "@anthropic-ai/sdk";
import { aiStatus, providerKey, type AiProvider } from "@/lib/ai/config";
import { recordAiUsage } from "@/lib/ai/gateway";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// PROVIDER-NEUTRAL GENERATION (Book IV — Clinical Intelligence Engine)
//
// One contract, three adapters. A caller says what it wants generated; it does not know or care which
// vendor answered. Everything downstream of this file -- the assistant, document phrasing, the
// grounding verifier -- is provider-independent, and that is deliberate rather than incidental:
// verifyGrounded checks the OUTPUT against the record, so it does not weaken or strengthen with the
// vendor behind it.
//
// Adapters use fetch for OpenAI and Gemini, matching embed.ts, which already speaks to both that way.
// Anthropic keeps its SDK because it is already a dependency. No new packages.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type GenerateArgs = {
  system: string;
  user: string;
  tier?: "cheap" | "reasoning" | "heavy";
  maxTokens?: number;
  // Optional attribution for the AI Runtime Gateway usage log (PFS-000 §15).
  // Usage (tokens/latency/cost/status) is always recorded; context adds who/what.
  context?: { userId?: string | null; tenantId?: string | null; operation?: string };
};

export type GenerateFailure = "not_configured" | "refusal" | "failed";

export type GenerateResult =
  | {
      ok: true;
      text: string;
      /** Which vendor answered. Recorded alongside the model, and shown to practice owners. */
      provider: AiProvider;
      model: string;
      usage: { input: number; output: number };
    }
  | { ok: false; error: GenerateFailure; detail?: string };

/** What every adapter returns, before the dispatcher records usage and normalises the result. */
type AdapterResult =
  | { ok: true; text: string; model: string; input: number; output: number }
  | { ok: false; kind: "refusal" | "failed"; detail?: string };

type AdapterArgs = { system: string; user: string; model: string; maxTokens: number; key: string };

// ── Anthropic ───────────────────────────────────────────────────────────────────────────────────────

let _anthropic: Anthropic | null = null;

async function anthropicAdapter(a: AdapterArgs): Promise<AdapterResult> {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: a.key });
  const stream = _anthropic.messages.stream({
    model: a.model,
    max_tokens: a.maxTokens,
    system: [{ type: "text", text: a.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: a.user }],
  });
  const message = await stream.finalMessage();

  // A refusal is the model declining, which is a RESULT, not a transport failure. The distinction
  // matters to the fallback policy below: a refusal must never be retried elsewhere.
  if (message.stop_reason === "refusal") return { ok: false, kind: "refusal" };

  return {
    ok: true,
    text: message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join(""),
    model: message.model,
    input: message.usage.input_tokens,
    output: message.usage.output_tokens,
  };
}

// ── OpenAI ──────────────────────────────────────────────────────────────────────────────────────────

async function openaiAdapter(a: AdapterArgs): Promise<AdapterResult> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.key}` },
    body: JSON.stringify({
      model: a.model,
      max_tokens: a.maxTokens,
      messages: [
        { role: "system", content: a.system },
        { role: "user", content: a.user },
      ],
    }),
  });
  if (!res.ok) return { ok: false, kind: "failed", detail: `openai ${res.status}: ${(await res.text()).slice(0, 200)}` };

  const j = await res.json();
  const choice = j.choices?.[0];
  // OpenAI signals a content-policy stop here. Same class as an Anthropic refusal.
  if (choice?.finish_reason === "content_filter") return { ok: false, kind: "refusal" };

  return {
    ok: true,
    text: String(choice?.message?.content ?? ""),
    model: String(j.model ?? a.model),
    input: Number(j.usage?.prompt_tokens ?? 0),
    output: Number(j.usage?.completion_tokens ?? 0),
  };
}

// ── Gemini ──────────────────────────────────────────────────────────────────────────────────────────

async function geminiAdapter(a: AdapterArgs): Promise<AdapterResult> {
  // The key goes in the header, not the query string: a URL is logged by proxies and appears in error
  // messages. embed.ts puts it in the query and should be moved to match, which is its own change.
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(a.model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": a.key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: a.system }] },
        contents: [{ role: "user", parts: [{ text: a.user }] }],
        generationConfig: { maxOutputTokens: a.maxTokens },
      }),
    },
  );
  if (!res.ok) return { ok: false, kind: "failed", detail: `gemini ${res.status}: ${(await res.text()).slice(0, 200)}` };

  const j = await res.json();
  const candidate = j.candidates?.[0];

  // Gemini reports a blocked prompt separately from a blocked candidate. Both are refusals.
  if (j.promptFeedback?.blockReason) return { ok: false, kind: "refusal" };
  if (candidate?.finishReason === "SAFETY" || candidate?.finishReason === "PROHIBITED_CONTENT") {
    return { ok: false, kind: "refusal" };
  }

  return {
    ok: true,
    text: (candidate?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join(""),
    model: String(j.modelVersion ?? a.model),
    input: Number(j.usageMetadata?.promptTokenCount ?? 0),
    output: Number(j.usageMetadata?.candidatesTokenCount ?? 0),
  };
}

const ADAPTERS: Record<AiProvider, (a: AdapterArgs) => Promise<AdapterResult>> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  gemini: geminiAdapter,
};

// ── fallback: architected, and deliberately off ─────────────────────────────────────────────────────
//
// ⚠ DISABLED UNTIL A FALLBACK POLICY EXISTS, by owner decision 2026-08-24. The structure below is the
// shape a fallback would take, so adding one is a policy decision rather than a rewrite -- but nothing
// fails over today.
//
// ⚠ AND THE HARD RULE, WHICH SURVIVES ANY FUTURE POLICY: a safety REFUSAL, a grounding failure, or
// invalid output must NEVER be retried against another vendor. Those are answers, not outages. Retrying
// them is provider shopping -- asking vendors in turn until one agrees to say the thing the first
// declined to say -- and in a clinical product that is the worst thing this file could learn to do.
//
// Only a transport-class failure could ever be eligible, and even that needs a policy naming which
// error classes and how many attempts. FAILOVER_ELIGIBLE encodes the ceiling now so a later change
// widening it has to edit this line and read this comment.
const FALLBACK_ENABLED = false;

/**
 * The ceiling on what a future policy may fail over, encoded now.
 *
 * "failed" is transport: the vendor was unreachable, refused the connection, or returned a 5xx. That
 * is an outage, and an outage is the only thing another vendor could legitimately answer instead.
 * "refusal" is deliberately absent and must stay absent.
 */
const FAILOVER_ELIGIBLE: ReadonlyArray<"failed"> = ["failed"];

/**
 * Single-shot generation against this deployment's provider.
 *
 * Returns the text plus which vendor and model produced it. Never throws.
 */
export async function generate(
  { system, user, tier = "reasoning", maxTokens = 1500, context }: GenerateArgs,
): Promise<GenerateResult> {
  const status = aiStatus();
  if (!status.provider || !status.canGenerate || !status.models) {
    return { ok: false, error: "not_configured" };
  }

  const provider = status.provider;
  const key = providerKey(provider);
  if (!key) return { ok: false, error: "not_configured" };

  const model = status.models[tier];
  const base = {
    operation: context?.operation ?? null,
    tier,
    provider,
    model,
    actorId: context?.userId ?? null,
    tenantId: context?.tenantId ?? null,
  };

  const t0 = Date.now();
  try {
    const result = await ADAPTERS[provider]({ system, user, model, maxTokens, key });
    const latencyMs = Date.now() - t0;

    if (!result.ok) {
      void recordAiUsage({ ...base, latencyMs, status: result.kind === "refusal" ? "refusal" : "error", error: result.detail });

      // The fallback that is not enabled. Written as a guarded branch rather than omitted, so the rule
      // above is visible at the point it would be broken.
      if (FALLBACK_ENABLED && result.kind !== "refusal" && FAILOVER_ELIGIBLE.includes(result.kind)) {
        // A policy would choose the next provider here. There is no policy, so there is no next.
      }
      return result.kind === "refusal"
        ? { ok: false, error: "refusal" }
        : { ok: false, error: "failed", detail: result.detail };
    }

    void recordAiUsage({ ...base, model: result.model, inputTokens: result.input, outputTokens: result.output, latencyMs, status: "ok" });
    return {
      ok: true,
      text: result.text,
      provider,
      model: result.model,
      usage: { input: result.input, output: result.output },
    };
  } catch (e) {
    void recordAiUsage({
      ...base, latencyMs: Date.now() - t0, status: "error",
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, error: "failed", detail: e instanceof Error ? e.message : String(e) };
  }
}
