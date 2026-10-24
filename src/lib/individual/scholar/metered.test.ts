import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateArgs, GenerateResult } from "@/lib/ai/client";

// AI-FAIR-USE-01, the Scholar swap: every Scholar AI call goes through the Holdings allowance (runMeteredAi), with
// Scholar's activity code and one request id per call within a student action. The engine is mocked here: this
// pins Scholar's side of the contract, not the engine (IND-007's tests cover that).

const calls: { activity: string; requestId: string }[] = [];
let refuseNext = false;
vi.mock("@/lib/ai/allowance", async orig => {
  const real = await orig<typeof import("@/lib/ai/allowance")>();
  return {
    ...real,
    runMeteredAi: vi.fn(async (_admin: unknown, args: { activity: string; requestId: string; generate: GenerateArgs }) => {
      calls.push({ activity: args.activity, requestId: args.requestId });
      if (refuseNext) return { ok: false, error: "level_insufficient", standing: { readable: true, metered: true, level: "essential", remaining: { band: "low", percent: 5 }, resetsAt: null, activities: {}, message: "Limited right now." } };
      return { ok: true, text: "[]", provider: "anthropic", model: "test-model", usage: { input: 1, output: 1 } } as GenerateResult;
    }),
  };
});

const { scholarAiRunner, refusalWords } = await import("./http");
const { runQuestions, runExplain } = await import("./generation");

const ctx = { userId: "user-1", admin: {} } as unknown as Parameters<typeof scholarAiRunner>[0];
const req = (key?: string) => new Request("http://x", { headers: key ? { "x-request-id": key } : {} });
const passage = { chunkId: "c1", materialId: "m1", materialTitle: "Notes", ordinal: 1, pageFrom: 1, pageTo: 1, content: "Oxygen is prescribed to a target saturation range." };

beforeEach(() => { calls.length = 0; refuseNext = false; });

describe("the Scholar metered runner", () => {
  it("sends each call of one action with Scholar's activity and its own deterministic request id", async () => {
    const ai = scholarAiRunner(ctx, req("retry-key-1234"), "questions");
    // Nothing kept on the first attempt ("[]"), so the generator writes again once: two calls, two ids.
    const r = await runQuestions("user-1", "mcq", passage, 3, ai.run);
    expect(r.ok).toBe(true);
    expect(calls).toEqual([
      { activity: "questions", requestId: "user-1:retry-key-1234" },
      { activity: "questions", requestId: "user-1:retry-key-1234:retry" },
    ]);
    expect(ai.refusal()).toBeNull();
  });

  it("uses the client's key only when it is a well-formed retry key", async () => {
    const ai = scholarAiRunner(ctx, req("not a key!"), "explain");
    await runExplain("user-1", "Explain.", [passage], "explain", [], null, ai.run);
    expect(calls[0].requestId).toMatch(/^user-1:[0-9a-f-]{36}$/);
  });

  it("keeps a refusal, makes no further call in that action, and words it plainly -- never a quietly weaker model", async () => {
    refuseNext = true;
    const ai = scholarAiRunner(ctx, req(), "deeper");
    const r = await runExplain("user-1", "Go deeper.", [passage], "deeper", [], null, ai.run);
    expect(r.ok).toBe(false);
    const refusal = ai.refusal();
    expect(refusal?.error).toBe("level_insufficient");
    expect(refusalWords(refusal!)).toMatchObject({ insufficient: true });
    await ai.run({ system: "s", user: "u" } as GenerateArgs, "verify");
    expect(calls).toHaveLength(1);
  });
});
