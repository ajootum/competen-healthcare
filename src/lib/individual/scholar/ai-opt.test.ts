import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateArgs, GenerateResult } from "@/lib/ai/client";

// COMPETEN-SCHOLAR-AI-OPT-01: every call of one student action carries one action id, the attempts recorded are the
// calls actually made, and a model's own "these notes cannot support it" is not paid for twice.

const sent: GenerateArgs[] = [];
let reply = "[]";
vi.mock("@/lib/ai/allowance", async orig => ({
  ...(await orig<typeof import("@/lib/ai/allowance")>()),
  runMeteredAi: vi.fn(async (_admin: unknown, args: { generate: GenerateArgs }) => {
    sent.push(args.generate);
    return { ok: true, text: reply, provider: "anthropic", model: "test-model", usage: { input: 1, output: 1 } } as GenerateResult;
  }),
}));

const { scholarAiRunner } = await import("./http");
const { runCase, runCaseBlueprint, runQuestions } = await import("./generation");
const { attemptsOf } = await import("./outcome");

const ctx = { userId: "user-1", admin: {} } as unknown as Parameters<typeof scholarAiRunner>[0];
const RISK = { text: "x", competencyIds: [], topicTerms: [] };
const passage = { chunkId: "c1", materialId: "m1", materialTitle: "Notes", ordinal: 1, pageFrom: 1, pageTo: 1, content: "A full set of observations includes respiratory rate and temperature." };
const runner = () => scholarAiRunner(ctx, new Request("http://x"), "case_steps", RISK);

beforeEach(() => { sent.length = 0; reply = "[]"; });

describe("one action, one id", () => {
  it("tags every call of the action with the same action id, and counts the calls by part", async () => {
    const ai = scholarAiRunner(ctx, new Request("http://x"), "questions", RISK);
    await runQuestions("user-1", "mcq", passage, 3, ai.run);
    expect(sent).toHaveLength(2);
    expect(new Set(sent.map(g => g.context?.actionId))).toEqual(new Set([ai.actionId]));
    expect(ai.actionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ai.calls()).toEqual({ main: 1, retry: 1 });
    expect(attemptsOf(ai.calls())).toEqual({ generation: 2, verify: 0 });
  });
  it("two actions never share an id", () => {
    expect(runner().actionId).not.toBe(runner().actionId);
  });
  it("attempts split writing from blind checking", () => {
    expect(attemptsOf({ main: 1, verify: 1, retry: 1, "retry-verify": 1 })).toEqual({ generation: 2, verify: 2 });
  });
});

describe("a model's own 'not enough in these notes' is not asked again", () => {
  it("step-by-step case: {steps: []} stops after one call, nothing kept", async () => {
    reply = '{"title": "", "steps": []}';
    const r = await runCase("user-1", passage, runner().run);
    expect(sent).toHaveLength(1);
    expect(r.ok && r.declaredInsufficient).toBe(true);
    expect(r.ok && r.steps).toEqual([]);
  });
  it("Apply case: {stages: []} stops after one call, nothing kept", async () => {
    reply = '{"stages": []}';
    const r = await runCaseBlueprint("user-1", { passages: [passage], competencies: [], context: "General", dimensions: ["recognition"] }, runner().run);
    expect(sent).toHaveLength(1);
    expect(r.ok && r.blueprint).toBeNull();
    expect(r.ok && r.declaredInsufficient).toBe(true);
  });
  it("case question: [] stops after one call", async () => {
    const r = await runQuestions("user-1", "case", passage, 3, runner().run);
    expect(sent).toHaveLength(1);
    expect(r.ok && r.declaredInsufficient).toBe(true);
  });
  it("multiple-choice questions keep their one retry: [] means nothing there", async () => {
    const r = await runQuestions("user-1", "mcq", passage, 3, runner().run);
    expect(sent).toHaveLength(2);
    expect(r.ok && r.declaredInsufficient).toBe(false);
  });
  it("a malformed case reply is still retried once, as before", async () => {
    reply = "not json";
    await runCase("user-1", passage, runner().run);
    expect(sent).toHaveLength(2);
  });
});
