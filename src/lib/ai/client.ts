import Anthropic from "@anthropic-ai/sdk";
import { AI_PROVIDERS, aiStatus, providerKey, type AiProvider } from "@/lib/ai/config";
import { recordAiUsage, type AiAttribution } from "@/lib/ai/gateway";
import { checkEndpointResolves, redact, registeredKey } from "@/lib/ai/provider-registry";

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
  // Usage (tokens/latency/cost/status) is always recorded; context adds who/what. The scope says which
  // kind of id the caller holds -- see AiAttribution for why there is no bare tenantId here.
  context?: { userId?: string | null; operation?: string; attribution?: AiAttribution; actionId?: string };
  /**
   * The provider and model the Holdings routing chose (model-routing.ts), already gated for eligibility by the engine.
   * Absent: this deployment's primary provider and its model for `tier`, exactly as before.
   */
  route?: { provider: string; model: string; endpoint?: string };
  /**
   * COMPETEN-SCHOLAR-EXAM-PAPERS-01. Anthropic only: let the provider run its web search tool, at most `maxUses` times and
   * only on `allowedDomains`. The sources it actually returned come back in `sources` -- never what the model claims.
   * Any other provider answers not_configured, billed nothing: a capability is never quietly dropped.
   */
  webSearch?: { maxUses: number; allowedDomains: readonly string[] };
  /** COMPETEN-SCHOLAR-EXAM-PAPERS-01. Anthropic only: PDF documents the model reads (transcribing scanned pages). */
  documents?: readonly { mediaType: "application/pdf"; data: string }[];
};

/** A web source the provider's search tool actually returned (not one the model wrote). */
export type WebSource = { url: string; title: string; pageAge: string | null; citedText: string[] };
const isBuiltin = (p: string): p is AiProvider => (AI_PROVIDERS as readonly string[]).includes(p);

export type GenerateFailure = "not_configured" | "refusal" | "failed";

export type GenerateResult =
  | {
      ok: true;
      text: string;
      /** Which vendor answered: a built-in provider or a registered one's id. Recorded alongside the model. */
      provider: string;
      model: string;
      usage: { input: number; output: number };
      /** With webSearch: the sources the search returned, and how many searches ran. */
      sources?: WebSource[];
      searches?: number;
    }
  | {
      ok: false; error: GenerateFailure; detail?: string;
      /** What the provider reported consuming before it declined, when it reported it (a refusal is billed).
       *  Absent for a transport failure or a timeout: unknown is never invented (AI-FAIR-USE-01). */
      usage?: { input: number; output: number };
      /** With no usage: "none" when the provider answered with an error before generating (not billed),
       *  "unknown" when the request may have reached the provider and no answer came back (a timeout, a broken
       *  connection or stream, an unreadable response). An unknown charge is reconciled, never guessed. */
      billing?: "none" | "unknown";
    };

/** What every adapter returns, before the dispatcher records usage and normalises the result. */
type AdapterResult =
  | { ok: true; text: string; model: string; input: number; output: number; sources?: WebSource[]; searches?: number }
  | { ok: false; kind: "refusal" | "failed"; detail?: string; input?: number; output?: number };

type AdapterArgs = {
  system: string; user: string; model: string; maxTokens: number; key: string;
  webSearch?: GenerateArgs["webSearch"]; documents?: GenerateArgs["documents"];
};

/** The web search tool version a model supports: the dynamic-filtering one on 4.6 and later, the basic one before. */
export function webSearchToolType(model: string): "web_search_20260209" | "web_search_20250305" {
  return /claude-(opus|sonnet)-(4-[6-9]|[5-9])|claude-(fable|mythos|haiku-5)/.test(model) ? "web_search_20260209" : "web_search_20250305";
}

/** Pure. The sources a response's web search actually returned, with the text the answer cited from each. */
export function webSourcesOf(content: readonly unknown[]): WebSource[] {
  const byUrl = new Map<string, WebSource>();
  for (const raw of content) {
    const b = raw as { type?: string; content?: unknown; citations?: unknown };
    if (b?.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content as { type?: string; url?: string; title?: string; page_age?: string | null }[])
        if (r?.type === "web_search_result" && typeof r.url === "string" && !byUrl.has(r.url))
          byUrl.set(r.url, { url: r.url, title: String(r.title ?? r.url), pageAge: r.page_age ?? null, citedText: [] });
    }
    if (b?.type === "text" && Array.isArray(b.citations)) {
      for (const c of b.citations as { type?: string; url?: string; title?: string; cited_text?: string }[]) {
        if (c?.type !== "web_search_result_location" || typeof c.url !== "string") continue;
        const s = byUrl.get(c.url) ?? { url: c.url, title: String(c.title ?? c.url), pageAge: null, citedText: [] };
        if (c.cited_text && !s.citedText.includes(c.cited_text)) s.citedText.push(c.cited_text);
        byUrl.set(c.url, s);
      }
    }
  }
  return [...byUrl.values()];
}

// ── Anthropic ───────────────────────────────────────────────────────────────────────────────────────

let _anthropic: Anthropic | null = null;

async function anthropicAdapter(a: AdapterArgs): Promise<AdapterResult> {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: a.key });
  const content: Anthropic.ContentBlockParam[] = [
    ...(a.documents ?? []).map(d => ({ type: "document" as const, source: { type: "base64" as const, media_type: d.mediaType, data: d.data } })),
    { type: "text" as const, text: a.user },
  ];
  const stream = _anthropic.messages.stream({
    model: a.model,
    max_tokens: a.maxTokens,
    system: [{ type: "text", text: a.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: a.documents?.length ? content : a.user }],
    ...(a.webSearch ? { tools: [{ type: webSearchToolType(a.model), name: "web_search", max_uses: a.webSearch.maxUses, allowed_domains: [...a.webSearch.allowedDomains] } as Anthropic.ToolUnion] } : {}),
  });
  const message = await stream.finalMessage();

  // A refusal is the model declining, which is a RESULT, not a transport failure. The distinction
  // matters to the fallback policy below: a refusal must never be retried elsewhere.
  if (message.stop_reason === "refusal") return { ok: false, kind: "refusal", input: message.usage.input_tokens, output: message.usage.output_tokens };

  return {
    ok: true,
    text: message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join(""),
    model: message.model,
    input: message.usage.input_tokens,
    output: message.usage.output_tokens,
    ...(a.webSearch ? { sources: webSourcesOf(message.content), searches: message.usage.server_tool_use?.web_search_requests ?? 0 } : {}),
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
  return chatCompletionsResult(await res.json(), a.model);
}

/** The OpenAI chat-completions response, read once for OpenAI and every registered compatible provider. */
type ChatCompletion = { model?: string; choices?: { finish_reason?: string; message?: { content?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
function chatCompletionsResult(j: ChatCompletion, requested: string): AdapterResult {
  const choice = j.choices?.[0];
  // OpenAI signals a content-policy stop here. Same class as an Anthropic refusal.
  if (choice?.finish_reason === "content_filter") return { ok: false, kind: "refusal", input: Number(j.usage?.prompt_tokens ?? 0), output: Number(j.usage?.completion_tokens ?? 0) };

  return {
    ok: true,
    text: String(choice?.message?.content ?? ""),
    model: String(j.model ?? requested),
    input: Number(j.usage?.prompt_tokens ?? 0),
    output: Number(j.usage?.completion_tokens ?? 0),
  };
}

// ── A registered OpenAI-compatible provider (provider-registry.ts) ─────────────────────────────────
//
// The same protocol as OpenAI, at the provider's APPROVED endpoint, which provider-registry.ts has already checked at
// registration and the dispatcher checks again here after DNS resolution. Redirects are refused, so an approved host
// cannot hand the request on. The key is redacted from anything the provider echoes back.
async function compatibleAdapter(endpoint: string, a: AdapterArgs): Promise<AdapterResult> {
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: "POST", redirect: "error",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.key}` },
    body: JSON.stringify({ model: a.model, max_tokens: a.maxTokens, messages: [{ role: "system", content: a.system }, { role: "user", content: a.user }] }),
  });
  if (!res.ok) return { ok: false, kind: "failed", detail: redact(`${new URL(endpoint).hostname} ${res.status}: ${(await res.text()).slice(0, 200)}`, a.key) };
  return chatCompletionsResult(await res.json(), a.model);
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
  if (j.promptFeedback?.blockReason) return { ok: false, kind: "refusal", input: Number(j.usageMetadata?.promptTokenCount ?? 0), output: 0 };
  if (candidate?.finishReason === "SAFETY" || candidate?.finishReason === "PROHIBITED_CONTENT") {
    return { ok: false, kind: "refusal", input: Number(j.usageMetadata?.promptTokenCount ?? 0), output: Number(j.usageMetadata?.candidatesTokenCount ?? 0) };
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
  { system, user, tier = "reasoning", maxTokens = 1500, context, route, webSearch, documents }: GenerateArgs,
): Promise<GenerateResult> {
  const status = aiStatus();
  // A routed request names its provider and model. Its key is still the environment's (never configuration's), and a
  // provider with no key is not configured -- never quietly served by another.
  if (!route && (!status.provider || !status.canGenerate || !status.models)) {
    return { ok: false, error: "not_configured" };
  }

  const provider = route?.provider ?? status.provider!;
  const registered = !isBuiltin(provider);
  // A registered provider: its key from AI_PROVIDER_KEY_<ID> only, and its endpoint re-checked after DNS resolution.
  const key = registered ? registeredKey(provider) : providerKey(provider);
  if (!key || (registered && !route?.endpoint)) return { ok: false, error: "not_configured" };
  if (registered) {
    const reach = await checkEndpointResolves(route!.endpoint!);
    if (!reach.ok) return { ok: false, error: "not_configured", detail: reach.reason, billing: "none" };
  }

  // Web search and document input exist on the Anthropic adapter only. Elsewhere the request is not configured -- never
  // answered without the capability it asked for.
  if ((webSearch || documents?.length) && provider !== "anthropic") return { ok: false, error: "not_configured", detail: "capability not supported by this provider", billing: "none" };
  const model = route?.model ?? status.models![tier];
  const base = {
    operation: context?.operation ?? null,
    tier,
    provider,
    model,
    actorId: context?.userId ?? null,
    attribution: context?.attribution ?? null,
    actionId: context?.actionId ?? null,
  };

  const t0 = Date.now();
  try {
    const args = { system, user, model, maxTokens, key, webSearch, documents };
    const result = registered ? await compatibleAdapter(route!.endpoint!, args) : await ADAPTERS[provider as AiProvider](args);
    const latencyMs = Date.now() - t0;

    if (!result.ok) {
      void recordAiUsage({ ...base, latencyMs, status: result.kind === "refusal" ? "refusal" : "error", error: result.detail,
        inputTokens: result.input ?? null, outputTokens: result.output ?? null });
      const billed = result.input != null || result.output != null ? { usage: { input: result.input ?? 0, output: result.output ?? 0 } } : { billing: "none" as const };

      // The fallback that is not enabled. Written as a guarded branch rather than omitted, so the rule
      // above is visible at the point it would be broken.
      if (FALLBACK_ENABLED && result.kind !== "refusal" && FAILOVER_ELIGIBLE.includes(result.kind)) {
        // A policy would choose the next provider here. There is no policy, so there is no next.
      }
      return result.kind === "refusal"
        ? { ok: false, error: "refusal", ...billed }
        : { ok: false, error: "failed", detail: result.detail, ...billed };
    }

    void recordAiUsage({ ...base, model: result.model, inputTokens: result.input, outputTokens: result.output, latencyMs, status: "ok" });
    return {
      ok: true,
      text: result.text,
      provider,
      model: result.model,
      usage: { input: result.input, output: result.output },
      ...(result.sources ? { sources: result.sources, searches: result.searches ?? 0 } : {}),
    };
  } catch (e) {
    void recordAiUsage({
      ...base, latencyMs: Date.now() - t0, status: "error",
      error: e instanceof Error ? e.message : String(e),
    });
    // The provider answering with an error status did not generate, so did not bill. Anything else thrown -- a
    // timeout, a broken connection or stream, an unreadable body -- may have been billed: unknown.
    const answeredWithError = e instanceof Anthropic.APIError && typeof e.status === "number";
    return { ok: false, error: "failed", detail: e instanceof Error ? e.message : String(e), billing: answeredWithError ? "none" : "unknown" };
  }
}
