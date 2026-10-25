/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

// THE DEFECT (main session, 25 October 2026): eligibility gated only the metered path. With ai_fair_use OFF -- the path
// production uses at activation -- every clinical activity ran on whatever its tier resolved to (Sonnet 4.6, which the
// owner has NOT approved for clinical activities). Now, metered or not, a clinical-risk activity runs only on an
// eligible model, and is otherwise refused not_eligible without any call. Standard educational ones are unchanged.

const generate = vi.fn(async (a: any) => { return ({ ok: true, text: "x", model: `model-for-${a?.tier}`, provider: "anthropic", usage: { input: 1, output: 1 } }); });
vi.mock("./client", () => ({ generate: (a: unknown) => generate(a) }));
vi.mock("./config", () => ({ AI_PROVIDERS: ["anthropic", "openai", "gemini"], aiStatus: () => ({ provider: "anthropic", canGenerate: true, available: ["anthropic"], models: { cheap: "claude-haiku-4-5", reasoning: "claude-sonnet-4-6", heavy: "claude-opus-4-8", embedding: "e" } }) }));

import { getAiStanding, NOT_ELIGIBLE_REASON, runMeteredAi, unmeteredGate } from "./allowance";
import { activityState } from "../individual/scholar/ai-standing";

const POLICY = {
  includedCau: 4000, risk: { minTier: { standard_educational: "cheap", clinical_educational: "heavy", high_risk_clinical: "heavy" }, rules: [] },
  activities: {
    teach: { tier: "reasoning", minTier: "cheap", riskFloor: "standard_educational" },
    questions: { tier: "heavy", minTier: "heavy", riskFloor: "clinical_educational" },
    case_steps: { tier: "heavy", minTier: "heavy", riskFloor: "high_risk_clinical" },
  },
};
const OPUS = (activity: string, tier: string) => ({ activity, provider: "anthropic", model_prefix: "claude-opus-4-8", eligible: true, max_risk_tier: tier });

function admin(opts: { meteringOn?: boolean; policy?: any; policyError?: boolean; rows?: any[] | null; routing?: any }) {
  return {
    from(table: string) {
      const q: any = {
        path: "",
        select: () => q, eq: (c: string, v: any) => { if (c === "config_path") q.path = v; return q; }, lte: () => q, or: () => q, limit: () => q,
        maybeSingle: async () => table === "practice_platform_flags" ? { data: { enabled: !!opts.meteringOn }, error: null }
          : table === "workspace_config_overrides" && q.path === "ai.model_routing" ? { data: opts.routing === undefined ? null : { published: opts.routing }, error: null }
          : table === "workspace_config_overrides" ? (opts.policyError ? { data: null, error: { message: "down" } } : { data: opts.policy === undefined ? { published: POLICY, updated_at: "t" } : opts.policy, error: null })
          : { data: null, error: null },
        then: (ok: any, bad: any) => Promise.resolve(table === "ai_model_eligibility" ? (opts.rows === null ? { data: null, error: { message: "down" } } : { data: opts.rows ?? [], error: null }) : { data: [], error: null }).then(ok, bad),
      };
      return q;
    },
    rpc: async () => ({ data: null, error: { message: "metered path not expected" } }),
  };
}
const run = (a: any, activity: string) => runMeteredAi(a, { userId: "u", product: "scholar", activity, requestId: "u:r1", generate: { system: "s", user: "q", tier: "reasoning" } as any });

beforeEach(() => generate.mockClear());

describe("metering OFF: eligibility still gates clinical-risk activities", () => {
  it("THE DEFECT: a clinical activity with no eligible model is refused not_eligible, and no model is called", async () => {
    const r: any = await run(admin({ rows: [] }), "questions");
    expect(r).toMatchObject({ ok: false, error: "not_eligible" });
    expect(r.standing.activities.questions.reason).toBe(NOT_ELIGIBLE_REASON);
    expect(generate).not.toHaveBeenCalled();
  });

  it("never falls back: a row for another model (Sonnet), a lower tier, or another activity does not open it", async () => {
    for (const rows of [[{ ...OPUS("questions", "clinical_educational"), model_prefix: "claude-sonnet-4-6" }], [OPUS("case_steps", "clinical_educational")], [OPUS("teach", "high_risk_clinical")]]) {
      const act = rows[0].activity === "case_steps" ? "case_steps" : "questions";
      expect(await run(admin({ rows }), act)).toMatchObject({ ok: false, error: "not_eligible" });
    }
    expect(generate).not.toHaveBeenCalled();
  });

  it("control: with an eligible row it runs, on the model the published routing names (heavy), not the caller's tier", async () => {
    const r: any = await run(admin({ rows: [OPUS("questions", "clinical_educational")] }), "questions");
    expect(r.ok).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].tier).toBe("heavy");
  });

  it("control: a standard-educational activity is unchanged -- it runs with the caller's request as before", async () => {
    const r: any = await run(admin({ rows: [] }), "teach");
    expect(r.ok).toBe(true);
    expect(generate.mock.calls[0][0].tier).toBe("reasoning");
  });

  it("fails closed: an activity the policy does not define, an unpublished policy, an unreadable policy or eligibility", async () => {
    expect(await run(admin({ rows: [] }), "made_up")).toMatchObject({ ok: false, error: "unknown_activity" });
    expect(await run(admin({ policy: null, rows: [] }), "teach")).toMatchObject({ ok: false, error: "unknown_activity" });
    expect(await run(admin({ policyError: true }), "teach")).toMatchObject({ ok: false, error: "unreadable" });
    expect(await run(admin({ rows: null }), "questions")).toMatchObject({ ok: false, error: "unreadable" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("the standing says the same, so nothing is offered and then refused", async () => {
    const s = await getAiStanding(admin({ rows: [] }) as any, { userId: "u", product: "scholar" });
    expect(s.metered).toBe(false);
    expect(s.activities.teach.available).toBe(true);
    expect(s.activities.questions).toMatchObject({ available: false, reason: NOT_ELIGIBLE_REASON });
    expect(activityState(s, "questions").available).toBe(false);
    expect(activityState(s, "teach").available).toBe(true);
    const ok = await getAiStanding(admin({ rows: [OPUS("questions", "clinical_educational")] }) as any, { userId: "u", product: "scholar" });
    expect(activityState(ok, "questions").available).toBe(true);
  });

  it("the gate on its own: standard is unchanged (no tier), clinical needs the row", async () => {
    expect(await unmeteredGate(admin({ rows: [] }), "scholar", "teach")).toEqual({ ok: true, tier: null, route: null });
    expect(await unmeteredGate(admin({ rows: [OPUS("case_steps", "high_risk_clinical")] }), "scholar", "case_steps")).toEqual({ ok: true, tier: "heavy", route: { provider: "anthropic", model: "claude-opus-4-8" } });
  });
});
