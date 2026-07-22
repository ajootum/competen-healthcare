import Anthropic from "@anthropic-ai/sdk";
import { aiStatus } from "@/lib/ai/config";
import { recordAiUsage } from "@/lib/ai/gateway";

// ============================================================
// Anthropic client wrapper (Book IV — Clinical Intelligence Engine)
// Uses the official @anthropic-ai/sdk. Grounded, explainable generation
// with the reasoning-tier model. Returns null-safe results when no key is set.
// ============================================================

let _client: Anthropic | null = null;

function client(): Anthropic | null {
  const status = aiStatus();
  if (!status.configured || status.provider !== "anthropic") return null;
  if (!_client) _client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  return _client;
}

export type GenerateArgs = {
  system: string;
  user: string;
  tier?: "cheap" | "reasoning" | "heavy";
  maxTokens?: number;
  // Optional attribution for the AI Runtime Gateway usage log (PFS-000 §15).
  // Usage (tokens/latency/cost/status) is always recorded; context adds who/what.
  context?: { userId?: string | null; tenantId?: string | null; operation?: string };
};

export type GenerateResult =
  | { ok: true; text: string; model: string; usage: { input: number; output: number } }
  | { ok: false; error: "not_configured" | "refusal" | "failed"; detail?: string };

/**
 * Single-shot grounded generation. Streams under the hood (SDK timeout
 * protection) and returns the assembled final message. Keep max_tokens modest
 * for interactive latency on constrained runtimes.
 */
export async function generate({ system, user, tier = "reasoning", maxTokens = 1500, context }: GenerateArgs): Promise<GenerateResult> {
  const c = client();
  const status = aiStatus();
  if (!c || !status.models) return { ok: false, error: "not_configured" };

  const model = status.models[tier];
  const base = { operation: context?.operation ?? null, tier, provider: status.provider, model, actorId: context?.userId ?? null, tenantId: context?.tenantId ?? null };
  const t0 = Date.now();

  try {
    const stream = c.messages.stream({
      model,
      max_tokens: maxTokens,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
    });
    const message = await stream.finalMessage();
    const latencyMs = Date.now() - t0;
    const usage = { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };

    if (message.stop_reason === "refusal") {
      void recordAiUsage({ ...base, ...usage, latencyMs, status: "refusal" });
      return { ok: false, error: "refusal" };
    }
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text)
      .join("");

    void recordAiUsage({ ...base, ...usage, latencyMs, status: "ok" });
    return {
      ok: true,
      text,
      model: message.model,
      usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
    };
  } catch (e) {
    void recordAiUsage({ ...base, latencyMs: Date.now() - t0, status: "error", error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: "failed", detail: e instanceof Error ? e.message : String(e) };
  }
}
