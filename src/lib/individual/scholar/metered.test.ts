import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateArgs, GenerateResult } from "@/lib/ai/client";

// AI-FAIR-USE-01, the Scholar swap: every Scholar AI call goes through the Holdings allowance (runMeteredAi), with
// Scholar's activity code and one request id per call within a student action. The engine is mocked here: this
// pins Scholar's side of the contract, not the engine (IND-007's tests cover that).

const calls: { activity: string; requestId: string; risk?: unknown }[] = [];
let refuseNext = false;
vi.mock("@/lib/ai/allowance", async orig => {
  const real = await orig<typeof import("@/lib/ai/allowance")>();
  return {
    ...real,
    runMeteredAi: vi.fn(async (_admin: unknown, args: { activity: string; requestId: string; generate: GenerateArgs; risk?: unknown }) => {
      calls.push({ activity: args.activity, requestId: args.requestId, risk: args.risk });
      if (refuseNext) return { ok: false, error: "level_insufficient", standing: { readable: true, metered: true, level: "essential", remaining: { band: "low", percent: 5 }, resetsAt: null, activities: {}, message: "Limited right now." } };
      return { ok: true, text: "[]", provider: "anthropic", model: "test-model", usage: { input: 1, output: 1 } } as GenerateResult;
    }),
  };
});

// D1: the sections links and topics the risk subject reads.
vi.mock("./store", async orig => ({
  ...(await orig<typeof import("./store")>()),
  sectionLinks: vi.fn(async () => [{ chunkId: "c1", competencyId: "comp-1", outcome: null, accepted: true }, { chunkId: "c1", competencyId: "comp-1", outcome: null, accepted: false }]),
  topicsOfSections: vi.fn(async () => new Map([["c1", ["oxygen therapy", "saturation"]]])),
}));

const { scholarAiRunner, scholarRisk, refusalWords } = await import("./http");
const { runQuestions, runExplain } = await import("./generation");

const ctx = { userId: "user-1", admin: {} } as unknown as Parameters<typeof scholarAiRunner>[0];
const RISK = { text: "Oxygen", competencyIds: ["comp-1"], topicTerms: ["oxygen therapy"] };
const req = (key?: string) => new Request("http://x", { headers: key ? { "x-request-id": key } : {} });
const passage = { chunkId: "c1", materialId: "m1", materialTitle: "Notes", ordinal: 1, pageFrom: 1, pageTo: 1, content: "Oxygen is prescribed to a target saturation range." };

beforeEach(() => { calls.length = 0; refuseNext = false; });

describe("the Scholar metered runner", () => {
  it("sends each call of one action with Scholar's activity and its own deterministic request id", async () => {
    const ai = scholarAiRunner(ctx, req("retry-key-1234"), "questions", RISK);
    // Nothing kept on the first attempt ("[]"), so the generator writes again once: two calls, two ids.
    const r = await runQuestions("user-1", "mcq", passage, 3, ai.run);
    expect(r.ok).toBe(true);
    expect(calls).toEqual([
      { activity: "questions", requestId: "user-1:retry-key-1234", risk: RISK },
      { activity: "questions", requestId: "user-1:retry-key-1234:retry", risk: RISK },
    ]);
    expect(ai.refusal()).toBeNull();
  });

  it("uses the client's key only when it is a well-formed retry key", async () => {
    const ai = scholarAiRunner(ctx, req("not a key!"), "explain", RISK);
    await runExplain("user-1", "Explain.", [passage], "explain", [], null, ai.run);
    expect(calls[0].requestId).toMatch(/^user-1:[0-9a-f-]{36}$/);
  });

  it("keeps a refusal, makes no further call in that action, and words it plainly -- never a quietly weaker model", async () => {
    refuseNext = true;
    const ai = scholarAiRunner(ctx, req(), "deeper", RISK);
    const r = await runExplain("user-1", "Go deeper.", [passage], "deeper", [], null, ai.run);
    expect(r.ok).toBe(false);
    const refusal = ai.refusal();
    expect(refusal?.error).toBe("level_insufficient");
    expect(refusalWords(refusal!)).toMatchObject({ insufficient: true });
    await ai.run({ system: "s", user: "u" } as GenerateArgs, "verify");
    expect(calls).toHaveLength(1);
  });
});

describe("D1: the risk subject every Scholar AI call carries", () => {
  it("is the student text and the sections, with their live competency links and topic terms, deduplicated", async () => {
    const r = await scholarRisk({}, "user-1", { text: "Why a target range?", passages: [passage] });
    expect(r).toEqual({ text: `Why a target range?

${passage.content}`, competencyIds: ["comp-1"], topicTerms: ["oxygen therapy", "saturation"] });
  });
  it("uses the competencies the caller names when it names them", async () => {
    expect((await scholarRisk({}, "user-1", { passages: [passage], competencyIds: ["named"] })).competencyIds).toEqual(["named"]);
  });
  it("the same subject goes on every call of one action -- verification and retry included", async () => {
    const ai = scholarAiRunner(ctx, req(), "explain", RISK);
    await ai.run({ system: "s", user: "u" } as GenerateArgs);
    await ai.run({ system: "s", user: "u" } as GenerateArgs, "verify");
    await ai.run({ system: "s", user: "u" } as GenerateArgs, "retry-verify");
    expect(calls.map(c => c.risk)).toEqual([RISK, RISK, RISK]);
  });
});

describe("REVISION-01 R4: a short answer, marked -- by code first, AI evaluation labelled, never invented", async () => {
  const { markShortAnswer, parseEvaluation, runEvaluate } = await import("./generation");
  const { MARKING_LABEL } = await import("./config");
  const accepted = ["a target saturation range"];

  it("code marks a match correct and never calls a non-match wrong", () => {
    expect(markShortAnswer("  A target-saturation range. ", accepted)).toBe(true);
    expect(markShortAnswer("within the prescribed range", accepted)).toBeNull();
    expect(markShortAnswer("", accepted)).toBeNull();
  });

  it("the evaluator's verdict is kept only with feedback that adds nothing to the passage, the key and the answer", () => {
    const g = [passage.content, ...accepted, "a range", "What is oxygen prescribed to?"];
    expect(parseEvaluation("VERDICT: partly\nYou said a range. The passage says a target saturation range.", g)).toEqual({ ok: true, verdict: "partly", score: 0.5, feedback: "You said a range. The passage says a target saturation range." });
    expect(parseEvaluation("The answer is fine.", g)).toEqual({ ok: false, reason: "malformed" });
    expect(parseEvaluation("NOT_IN_NOTES", g)).toEqual({ ok: false, reason: "not_in_notes" });
    expect(parseEvaluation("VERDICT: incorrect\nThe target is 94 to 98 percent.", g)).toMatchObject({ ok: false, reason: "ungrounded" });
  });

  it("runs as activity evaluate through the runner, and AI evaluation is labelled apart from code", async () => {
    const ai = scholarAiRunner(ctx, req("eval-key-1234"), "evaluate", RISK);
    await runEvaluate("user-1", { question: "What is oxygen prescribed to?", accepted, answer: "a range", passage }, ai.run);
    expect(calls).toEqual([{ activity: "evaluate", requestId: "user-1:eval-key-1234", risk: RISK }]);
    expect(MARKING_LABEL.ai_evaluation).toMatch(/^AI evaluation/);
    expect(MARKING_LABEL.deterministic).not.toMatch(/AI/);
  });
});
