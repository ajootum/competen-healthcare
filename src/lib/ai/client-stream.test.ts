/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SCHOLAR-PAI-EXPERIENCE-01: generate()'s optional onText. The Anthropic adapter hands on the SAME stream's text as it
// arrives; the result (text, usage, outcome) is unchanged. Other adapters answer whole and hand the text over once,
// only on success. A reader that throws never cuts the answer short. Keys are inert placeholders; nothing leaves the test.

vi.mock("@/lib/ai/gateway", () => ({ recordAiUsage: () => {} }));
const pieces = ["Hel", "lo ", "there"];
let stopReason = "end_turn";
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error { status?: number }
  class Anthropic {
    static APIError = APIError;
    messages = {
      stream: () => {
        const handlers: ((t: string) => void)[] = [];
        return {
          on: (ev: string, fn: (t: string) => void) => { if (ev === "text") handlers.push(fn); },
          finalMessage: async () => {
            for (const p of pieces) handlers.forEach(h => h(p));
            return { stop_reason: stopReason, model: "claude-sonnet-4-6", content: [{ type: "text", text: pieces.join("") }], usage: { input_tokens: 7, output_tokens: 3 } };
          },
        };
      },
    };
  }
  return { default: Anthropic };
});
import { generate } from "./client";

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ model: "gpt-4o", choices: [{ message: { content: "whole answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), { status: 200 }));
const saved = { ...process.env };
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockClear(); stopReason = "end_turn";
  process.env.ANTHROPIC_API_KEY = "test-placeholder-anthropic"; process.env.OPENAI_API_KEY = "test-placeholder-openai";
});
afterEach(() => { vi.unstubAllGlobals(); process.env = { ...saved }; });

describe("generate() streaming", () => {
  it("Anthropic: each piece reaches onText, after onStart; the result is the same as without it", async () => {
    const order: string[] = [];
    const r: any = await generate({ system: "s", user: "u", route: { provider: "anthropic", model: "claude-sonnet-4-6" }, onStart: () => order.push("start"), onText: t => order.push(t) });
    expect(order).toEqual(["start", ...pieces]);
    const plain: any = await generate({ system: "s", user: "u", route: { provider: "anthropic", model: "claude-sonnet-4-6" } });
    expect(r).toEqual(plain);
    expect(r).toMatchObject({ ok: true, text: "Hello there", usage: { input: 7, output: 3 } });
  });

  it("a reader that throws does not cut the answer short", async () => {
    const r: any = await generate({ system: "s", user: "u", route: { provider: "anthropic", model: "claude-sonnet-4-6" }, onText: () => { throw new Error("gone"); } });
    expect(r).toMatchObject({ ok: true, text: "Hello there" });
  });

  it("a refusal mid-stream is still a refusal, billed as before (the caller discards what was streamed)", async () => {
    stopReason = "refusal";
    const seen: string[] = [];
    const r: any = await generate({ system: "s", user: "u", route: { provider: "anthropic", model: "claude-sonnet-4-6" }, onText: t => seen.push(t) });
    expect(r).toEqual({ ok: false, error: "refusal", usage: { input: 7, output: 3 } });
    expect(seen.length).toBe(3);
  });

  it("a non-streaming adapter hands the whole text over once, only on success", async () => {
    const seen: string[] = [];
    await generate({ system: "s", user: "u", route: { provider: "openai", model: "gpt-4o" }, onText: t => seen.push(t) });
    expect(seen).toEqual(["whole answer"]);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: "content_filter" }], usage: { prompt_tokens: 1, completion_tokens: 0 } }), { status: 200 }));
    await generate({ system: "s", user: "u", route: { provider: "openai", model: "gpt-4o" }, onText: t => seen.push(t) });
    expect(seen).toEqual(["whole answer"]);
  });
});
