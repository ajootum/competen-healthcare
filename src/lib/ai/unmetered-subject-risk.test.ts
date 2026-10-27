/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

// SCHOLAR-READINESS-02 C1 (owner GO, 28 Oct 2026). With metering OFF, the unmetered gate applied only the activity's
// risk floor, so a standard activity on a clinical subject ran on Sonnet 4.6, which is not clinically approved. Seen in
// production on 27 Oct: Personal AI answered "sepsis vs SIRS" and Teach explained vital signs on Sonnet. The gate now
// classifies the subject with the same classifyRisk as the metered path. These cases use the production policy rules,
// routing and eligibility rows (published 27 Oct 2026), trimmed to what each case needs.

const generate = vi.fn(async (a: any) => ({ ok: true, text: "x", model: a?.route?.model ?? `model-for-${a?.tier}`, provider: "anthropic", usage: { input: 1, output: 1 } }));
vi.mock("./client", () => ({ generate: (a: unknown) => generate(a) }));
vi.mock("./config", () => ({ AI_PROVIDERS: ["anthropic", "openai", "gemini"], aiStatus: () => ({ provider: "anthropic", canGenerate: true, available: ["anthropic"], models: { cheap: "claude-haiku-4-5-20251001", reasoning: "claude-sonnet-4-6", heavy: "claude-opus-4-8", embedding: "e" } }) }));

import { runMeteredAi } from "./allowance";

const POLICY = {
  includedCau: 4000,
  risk: {
    minTier: { high_risk_clinical: "reasoning", clinical_educational: "reasoning", standard_educational: "cheap" },
    rules: [
      { id: "high.emergency", all: [["emergenc*", "resuscitat*", "cardiac arrest", "sepsis", "septic shock"]], tier: "high_risk_clinical", label: "Emergencies", frameworks: [], competencyRisk: [] },
      { id: "clinical.topics", all: [["patient*", "clinical", "nurs*", "vital sign*", "observation*", "respirat*", "blood pressure", "escalat*"]], tier: "clinical_educational", label: "Clinical education", frameworks: [], competencyRisk: [] },
      { id: "standard.study-and-career", all: [["revision", "revise", "study plan*", "exams"]], tier: "standard_educational", label: "Study skills", frameworks: [], competencyRisk: [] },
    ],
  },
  activities: {
    teach: { tier: "reasoning", class: "standard", label: "Teach me", minTier: "cheap", riskFloor: "standard_educational" },
    ask: { tier: "reasoning", class: "standard", label: "Ask Scholar", minTier: "cheap", riskFloor: "standard_educational" },
    questions: { tier: "reasoning", class: "standard", label: "Practice questions", minTier: "reasoning", riskFloor: "clinical_educational" },
    case_steps: { tier: "reasoning", class: "standard", label: "Clinical cases", minTier: "reasoning", riskFloor: "high_risk_clinical" },
  },
};
const ROUTING = {
  tiers: { cheap: ["anthropic"], heavy: ["anthropic"], reasoning: ["anthropic"] },
  providers: { anthropic: { enabled: true, models: { cheap: "claude-haiku-4-5-20251001", reasoning: "claude-sonnet-4-6", heavy: "claude-opus-4-8" } }, openai: { enabled: false, models: {} }, gemini: { enabled: false, models: {} } },
  activities: {
    "scholar.questions": [{ provider: "anthropic", model: "claude-sonnet-4-6" }, { provider: "anthropic", model: "claude-opus-4-8" }],
    "scholar.case_steps": [{ provider: "anthropic", model: "claude-sonnet-4-6" }, { provider: "anthropic", model: "claude-opus-4-8" }],
  },
};
const OPUS = (activity: string, tier: string) => ({ activity, provider: "anthropic", model_prefix: "claude-opus-4-8", eligible: true, max_risk_tier: tier });
// The four production rows (27 Oct 2026).
const ROWS = [OPUS("questions", "clinical_educational"), OPUS("case_steps", "high_risk_clinical"), OPUS("teach", "clinical_educational"), OPUS("ask", "clinical_educational")];

function admin(routing: any = ROUTING) {
  return {
    from(table: string) {
      const q: any = {
        path: "",
        select: () => q, eq: (c: string, v: any) => { if (c === "config_path") q.path = v; return q; }, in: () => q, lte: () => q, or: () => q, limit: () => q,
        maybeSingle: async () => table === "practice_platform_flags" ? { data: { enabled: false }, error: null }
          : table === "workspace_config_overrides" && q.path === "ai.model_routing" ? { data: { published: routing }, error: null }
          : table === "workspace_config_overrides" && q.path.startsWith("ai.fair_use.") ? { data: { published: POLICY, updated_at: "t" }, error: null }
          : { data: null, error: null },
        then: (ok: any, bad: any) => Promise.resolve(table === "ai_model_eligibility" ? { data: ROWS, error: null } : { data: [], error: null }).then(ok, bad),
      };
      return q;
    },
    rpc: async () => ({ data: null, error: { message: "metered path not expected" } }),
  };
}
const run = (activity: string, text: string, a = admin()) =>
  runMeteredAi(a, { userId: "u", product: "scholar", activity, requestId: "u:r1", generate: { system: "s", user: text, tier: "reasoning" } as any, risk: { text } });

beforeEach(() => generate.mockClear());

describe("C1: subject-level clinical risk is enforced with metering OFF", () => {
  it("clinical Teach (vital signs) is no longer sent to Sonnet: refused not_eligible, no model called", async () => {
    const r: any = await run("teach", "Explain why respiratory rate is the earliest vital sign of deterioration");
    expect(r).toMatchObject({ ok: false, error: "not_eligible", risk: { tier: "clinical_educational", rule: "clinical.topics" } });
    expect(generate).not.toHaveBeenCalled();
  });

  it("control: clinical Teach runs on the eligible model once routing offers it (eligibility unchanged)", async () => {
    const routing = { ...ROUTING, activities: { ...ROUTING.activities, "scholar.teach": [{ provider: "anthropic", model: "claude-sonnet-4-6" }, { provider: "anthropic", model: "claude-opus-4-8" }] } };
    const r: any = await run("teach", "Explain why respiratory rate is the earliest vital sign of deterioration", admin(routing));
    expect(r.ok).toBe(true);
    expect(generate.mock.calls[0][0].route).toEqual({ provider: "anthropic", model: "claude-opus-4-8" });
  });

  it("Personal AI clinical question (sepsis vs SIRS, the production case) is refused: high-risk, Teach is eligible only to clinical-educational", async () => {
    const r: any = await run("teach", "Explain the difference between sepsis and SIRS in simple terms.");
    expect(r).toMatchObject({ ok: false, error: "not_eligible", risk: { tier: "high_risk_clinical", rule: "high.emergency" } });
    expect(generate).not.toHaveBeenCalled();
  });

  it("high-risk practice questions are refused: Opus is eligible for questions only to clinical-educational", async () => {
    const r: any = await run("questions", "Sepsis is a life-threatening response to infection. Septic shock needs senior review.");
    expect(r).toMatchObject({ ok: false, error: "not_eligible", risk: { tier: "high_risk_clinical" } });
    expect(generate).not.toHaveBeenCalled();
  });

  it("control: clinical-educational practice questions still run on Opus, never Sonnet", async () => {
    const r: any = await run("questions", "A full set of observations includes respiratory rate and blood pressure.");
    expect(r.ok).toBe(true);
    expect(generate.mock.calls[0][0].route).toEqual({ provider: "anthropic", model: "claude-opus-4-8" });
  });

  it("authorised step-by-step cases on a high-risk subject still run on Opus", async () => {
    const r: any = await run("case_steps", "Sepsis warning signs include a raised respiratory rate and new confusion.");
    expect(r.ok).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].route).toEqual({ provider: "anthropic", model: "claude-opus-4-8" });
  });

  it("nonclinical learning is unchanged: a study-skills Teach runs on the caller's request", async () => {
    const r: any = await run("teach", "How should I plan revision for the next four weeks before exams?");
    expect(r.ok).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].tier).toBe("reasoning");
  });

  it("fails closed: a subject no rule recognises, or no subject at all, is high-risk and refused for Teach", async () => {
    expect(await run("teach", "Tell me about quaternions")).toMatchObject({ ok: false, error: "not_eligible", risk: { tier: "high_risk_clinical", rule: "unknown:no_rule" } });
    const none: any = await runMeteredAi(admin(), { userId: "u", product: "scholar", activity: "teach", requestId: "u:r2", generate: { system: "s", user: "q", tier: "reasoning" } as any });
    expect(none).toMatchObject({ ok: false, error: "not_eligible", risk: { rule: "unknown:no_subject" } });
    expect(generate).not.toHaveBeenCalled();
  });
});
