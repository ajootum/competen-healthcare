/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// generate() with a route runs that provider's adapter with that model, using that provider's key from the
// ENVIRONMENT -- never configuration. A routed provider with no key is not configured, never served by another.
// The keys below are inert test placeholders for a mocked fetch: nothing leaves the test.

vi.mock("@/lib/ai/gateway", () => ({ recordAiUsage: () => {} }));
import { generate } from "./client";

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ model: "gpt-4o-2024-08-06", choices: [{ message: { content: "hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), { status: 200 }));
const saved = { ...process.env };

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  process.env.ANTHROPIC_API_KEY = "test-placeholder-anthropic";
  process.env.OPENAI_API_KEY = "test-placeholder-openai";
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_PRIMARY_PROVIDER;
});
afterEach(() => { vi.unstubAllGlobals(); process.env = { ...saved }; });

describe("generate() with a Holdings route", () => {
  it("runs the routed provider's adapter with the routed model, though the deployment's primary is Anthropic", async () => {
    const r: any = await generate({ system: "s", user: "u", route: { provider: "openai", model: "gpt-4o" } });
    expect(r).toMatchObject({ ok: true, provider: "openai", model: "gpt-4o-2024-08-06", usage: { input: 3, output: 2 } });
    expect(String((fetchMock.mock.calls[0] as any[])[0])).toBe("https://api.openai.com/v1/chat/completions");
    expect(JSON.parse((fetchMock.mock.calls[0] as any[])[1].body).model).toBe("gpt-4o");
  });

  it("a routed provider with no key is not configured -- nothing is sent anywhere", async () => {
    const r: any = await generate({ system: "s", user: "u", route: { provider: "gemini", model: "gemini-2.0-pro" } });
    expect(r).toEqual({ ok: false, error: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a refusal from the routed provider is returned as a refusal, not retried elsewhere", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: "content_filter" }], usage: { prompt_tokens: 1, completion_tokens: 0 } }), { status: 200 }));
    const r: any = await generate({ system: "s", user: "u", route: { provider: "openai", model: "gpt-4o" } });
    expect(r).toMatchObject({ ok: false, error: "refusal" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
