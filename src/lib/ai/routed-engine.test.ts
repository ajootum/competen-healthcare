/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

// The engine with a PUBLISHED Holdings model routing (owner MULTI-PROVIDER direction): the route reaches generate(),
// a keyless primary is skipped for a keyed alternative, and a clinical request never goes to a non-eligible model.

const generate = vi.fn(async (a: any) => ({ ok: true, text: "x", model: a?.route?.model ?? "legacy", provider: a?.route?.provider ?? "anthropic", usage: { input: 1, output: 1 } }));
vi.mock("./client", () => ({ generate: (a: unknown) => generate(a) }));
vi.mock("./config", () => ({ AI_PROVIDERS: ["anthropic", "openai", "gemini"], aiStatus: () => ({ provider: "anthropic", canGenerate: true, available: ["anthropic"], models: { cheap: "claude-haiku-4-5", reasoning: "claude-sonnet-4-6", heavy: "claude-opus-4-8", embedding: "e" } }) }));

import { getAiStanding, runMeteredAi } from "./allowance";

const POLICY = {
  includedCau: 4000, risk: { minTier: { standard_educational: "cheap", clinical_educational: "heavy", high_risk_clinical: "heavy" }, rules: [
    // C1 (28 Oct 2026): the gate now classifies the subject, so the fixture needs rules a subject can match.
    { id: "clinical", all: [["nurs*"]], tier: "clinical_educational", label: "Clinical", frameworks: [], competencyRisk: [] },
    { id: "standard", all: [["revision"]], tier: "standard_educational", label: "Study", frameworks: [], competencyRisk: [] },
  ] },
  activities: { teach: { tier: "reasoning", minTier: "cheap", riskFloor: "standard_educational" }, questions: { tier: "heavy", minTier: "heavy", riskFloor: "clinical_educational" } },
};
// OpenAI first for every tier, Anthropic second. This deployment has only an Anthropic key.
const ROUTING = {
  providers: { anthropic: { enabled: true, models: { reasoning: "claude-sonnet-4-6", heavy: "claude-opus-4-8" } }, openai: { enabled: true, models: { reasoning: "gpt-4o", heavy: "gpt-4o" } }, gemini: { enabled: false, models: {} } },
  tiers: { cheap: ["anthropic"], reasoning: ["openai", "anthropic"], heavy: ["openai", "anthropic"] },
};
const OPUS_Q = { activity: "questions", provider: "anthropic", model_prefix: "claude-opus-4-8", eligible: true, max_risk_tier: "clinical_educational" };

function admin(opts: { routing?: any; rows?: any[] }) {
  return {
    from(table: string) {
      const q: any = {
        path: "",
        select: () => q, eq: (c: string, v: any) => { if (c === "config_path") q.path = v; return q; }, lte: () => q, or: () => q, limit: () => q,
        maybeSingle: async () => table === "practice_platform_flags" ? { data: { enabled: false }, error: null }
          : q.path === "ai.model_routing" ? { data: opts.routing === undefined ? null : { published: opts.routing }, error: null }
          : { data: { published: POLICY, updated_at: "t" }, error: null },
        then: (ok: any, bad: any) => Promise.resolve(table === "ai_model_eligibility" ? { data: opts.rows ?? [], error: null } : { data: [], error: null }).then(ok, bad),
      };
      return q;
    },
    rpc: async () => ({ data: null, error: { message: "not expected" } }),
  };
}
const run = (a: any, activity: string) => runMeteredAi(a, { userId: "u", product: "scholar", activity, requestId: "u:r1", generate: { system: "s", user: "q", tier: "reasoning" } as any, risk: { text: activity === "teach" ? "revision" : "nursing" } });

beforeEach(() => generate.mockClear());

describe("the engine with published model routing (metering off)", () => {
  it("unpublished: no route is passed -- generate() runs exactly as before", async () => {
    await run(admin({}), "teach");
    expect(generate.mock.calls[0][0].route).toBeUndefined();
  });

  it("a keyless primary (OpenAI) is skipped for the keyed alternative (Anthropic) -- the pilot is not held up", async () => {
    await run(admin({ routing: ROUTING }), "teach");
    expect(generate.mock.calls[0][0].route).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
  });

  it("CLINICAL: runs on the eligible Opus route, and with no eligible candidate is refused with no call", async () => {
    await run(admin({ routing: ROUTING, rows: [OPUS_Q] }), "questions");
    expect(generate.mock.calls[0][0].route).toEqual({ provider: "anthropic", model: "claude-opus-4-8" });
    generate.mockClear();
    expect(await run(admin({ routing: ROUTING, rows: [] }), "questions")).toMatchObject({ ok: false, error: "not_eligible" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("a provider disabled in routing is never used, even when it is the only keyed one", async () => {
    const off = { ...ROUTING, providers: { ...ROUTING.providers, anthropic: { ...ROUTING.providers.anthropic, enabled: false } } };
    const r: any = await run(admin({ routing: off }), "teach");
    expect(r.ok).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it("the standing agrees: questions offered only when an eligible routed candidate exists", async () => {
    const no = await getAiStanding(admin({ routing: ROUTING, rows: [] }) as any, { userId: "u", product: "scholar" });
    expect(no.activities.questions.available).toBe(false);
    const yes = await getAiStanding(admin({ routing: ROUTING, rows: [OPUS_Q] }) as any, { userId: "u", product: "scholar" });
    expect(yes.activities.questions.available).toBe(true);
    expect(yes.activities.teach.available).toBe(true);
  });
});
