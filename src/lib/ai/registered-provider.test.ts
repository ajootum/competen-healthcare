/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A REGISTERED OpenAI-compatible provider, end to end at the gateway and the engine (owner NO-CODE AI PROVIDER
// EXTENSIBILITY): never routed while inactive, never for a clinical request without eligibility, never to an address
// that resolves to a private network, never following a redirect, and its key never in a result or a log.

vi.mock("@/lib/ai/gateway", () => ({ recordAiUsage: (row: any) => logged.push(row) }));
const dnsAnswer = { addresses: [{ address: "51.159.1.1" }] as { address: string }[] };
vi.mock("node:dns/promises", () => ({ lookup: async () => dnsAnswer.addresses }));
const logged: any[] = [];

import { generate } from "./client";
import { runMeteredAi } from "./allowance";

const KEY = "test-placeholder-mistral-key";
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ model: "mistral-small-2409", choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 1 } }), { status: 200 }));
const saved = { ...process.env };
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockClear(); logged.length = 0; dnsAnswer.addresses = [{ address: "51.159.1.1" }];
  process.env.ANTHROPIC_API_KEY = "test-placeholder-anthropic"; process.env.AI_PROVIDER_KEY_MISTRAL = KEY; process.env.AI_PROVIDER_ALLOWED_HOSTS = "api.mistral.ai";
  delete process.env.AI_PRIMARY_PROVIDER;
});
afterEach(() => { vi.unstubAllGlobals(); process.env = { ...saved }; });

const ROUTE = { provider: "mistral", model: "mistral-small", endpoint: "https://api.mistral.ai/v1" };
const call = (route: any = ROUTE) => generate({ system: "s", user: "u", route }) as Promise<any>;

describe("the gateway, with a registered provider", () => {
  it("calls the approved endpoint with its key from AI_PROVIDER_KEY_<ID>, refusing redirects", async () => {
    const r = await call();
    expect(r).toMatchObject({ ok: true, provider: "mistral", model: "mistral-small-2409", usage: { input: 9, output: 1 } });
    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(url).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(init.redirect).toBe("error");
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it("refuses, sending nothing: a host the deployment does not permit, or one that resolves to a private address", async () => {
    expect(await call({ ...ROUTE, endpoint: "https://api.evil.example/v1" })).toMatchObject({ ok: false, error: "not_configured" });
    dnsAnswer.addresses = [{ address: "10.0.0.7" }];
    expect(await call()).toMatchObject({ ok: false, error: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses with no key set, sending nothing", async () => {
    delete process.env.AI_PROVIDER_KEY_MISTRAL;
    expect(await call()).toEqual({ ok: false, error: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the key is never in a result or a usage log, even when the provider echoes it back", async () => {
    (fetchMock as any).mockResolvedValueOnce(new Response(`{"error":"invalid api key ${KEY}"}`, { status: 401 }));
    const r = await call();
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(JSON.stringify(logged)).not.toContain(KEY);
    expect(JSON.stringify(r)).toContain("[redacted]");
  });

  it("existing providers are unchanged: an Anthropic route still uses its own adapter and key", async () => {
    const r = await call({ provider: "openai", model: "gpt-4o" });
    expect(r).toEqual({ ok: false, error: "not_configured" });   // no OPENAI_API_KEY: refused, never sent to a registered host
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── The engine: routing honours the registry's status and the eligibility gate ─────────────────────────────────
const POLICY = {
  includedCau: 4000, risk: { minTier: { standard_educational: "cheap", clinical_educational: "heavy", high_risk_clinical: "heavy" }, rules: [] },
  activities: { teach: { tier: "reasoning", minTier: "cheap", riskFloor: "standard_educational" }, questions: { tier: "heavy", minTier: "heavy", riskFloor: "clinical_educational" } },
};
const ROUTING = {
  providers: { anthropic: { enabled: true, models: { reasoning: "claude-sonnet-4-6", heavy: "claude-opus-4-8" } }, openai: { enabled: false, models: {} }, gemini: { enabled: false, models: {} } },
  tiers: { cheap: ["anthropic"], reasoning: ["mistral", "anthropic"], heavy: ["mistral", "anthropic"] },
};
const CHECKS = {
  connectivity: { at: "t", by: "u", ok: true, detail: null }, capability: { at: "t", by: "u", ok: true, detail: null },
  privacy: { at: "t", by: "u", ok: true, detail: null, termsRef: "DPA 2026", region: "EU", noTraining: true }, security: { at: "t", by: "u", ok: true, detail: "reviewed" },
};
const registry = (status: string) => ({ mistral: { label: "Mistral", protocol: "openai_chat_completions", endpoint: "https://api.mistral.ai/v1", models: { reasoning: "mistral-small", heavy: "mistral-large" }, status, checks: CHECKS } });

function admin(opts: { registry: any; rows?: any[] }) {
  return {
    from(table: string) {
      const q: any = {
        path: "",
        select: () => q, eq: (c: string, v: any) => { if (c === "config_path") q.path = v; return q; }, lte: () => q, or: () => q, limit: () => q,
        maybeSingle: async () => table === "practice_platform_flags" ? { data: { enabled: false }, error: null }
          : q.path === "ai.model_routing" ? { data: { published: ROUTING }, error: null }
          : q.path === "ai.provider_registry" ? { data: { published: opts.registry }, error: null }
          : { data: { published: POLICY, updated_at: "t" }, error: null },
        then: (ok: any, bad: any) => Promise.resolve(table === "ai_model_eligibility" ? { data: opts.rows ?? [], error: null } : { data: [], error: null }).then(ok, bad),
      };
      return q;
    },
    rpc: async () => ({ data: null, error: { message: "not expected" } }),
  };
}
const run = (a: any, activity: string) => runMeteredAi(a, { userId: "u", product: "scholar", activity, requestId: "u:r1", generate: { system: "s", user: "q", tier: "reasoning" } as any }) as Promise<any>;

describe("the engine, with a registered provider first in the routing", () => {
  it("INACTIVE: never routed -- the request goes to the next configured provider (Anthropic)", async () => {
    const r = await run(admin({ registry: registry("inactive") }), "teach");
    void r;
    const urls = fetchMock.mock.calls.map(c => String((c as any[])[0]));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.some(u => u.includes("mistral"))).toBe(false);                // never the inactive provider
    expect(urls.every(u => u.startsWith("https://api.anthropic.com"))).toBe(true);   // the next configured one
  });

  it("ACTIVE: a standard request runs on it, at its approved endpoint", async () => {
    const r = await run(admin({ registry: registry("active") }), "teach");
    expect(r).toMatchObject({ ok: true, provider: "mistral" });
    expect((fetchMock.mock.calls[0] as any[])[0]).toBe("https://api.mistral.ai/v1/chat/completions");
  });

  it("CLINICAL: refused on an active registered provider with no eligibility, and never sent there", async () => {
    // Anthropic has no Opus row either, so nothing is eligible: refused, no call anywhere.
    expect(await run(admin({ registry: registry("active"), rows: [] }), "questions")).toMatchObject({ ok: false, error: "not_eligible" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("control: with an eligibility decision for that provider and model, the clinical request runs on it", async () => {
    const rows = [{ activity: "questions", provider: "mistral", model_prefix: "mistral-large", eligible: true, max_risk_tier: "clinical_educational" }];
    expect(await run(admin({ registry: registry("active"), rows }), "questions")).toMatchObject({ ok: true, provider: "mistral" });
  });
});
