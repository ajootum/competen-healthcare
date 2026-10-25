/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The HQ acts on a registered provider: a browser can never set its status or checks, activation needs every check,
// the server's checks never carry the key, and what HQ is shown never contains it.

let stored: any = null;
vi.mock("@/lib/config/workspace-config-write", () => ({
  setOverride: async (_a: any, _actor: any, _scope: any, _path: string, value: any) => { stored = JSON.parse(JSON.stringify(value)); return { ok: true }; },
  publishScope: async () => ({ ok: true }),
}));
const generate = vi.fn(async () => ({ ok: false, error: "failed", detail: "mistral 401: bad key test-placeholder-mistral-key" }));
vi.mock("./client", () => ({ generate: () => generate() }));

import { loadProviderRegistryView, runProviderChecks, saveProviderRegistration, setProviderStatus } from "./fair-use-admin";

const KEY = "test-placeholder-mistral-key";
const saved = { ...process.env };
beforeEach(() => { stored = null; generate.mockClear(); process.env.AI_PROVIDER_ALLOWED_HOSTS = "api.mistral.ai"; process.env.AI_PROVIDER_KEY_MISTRAL = KEY; });
afterEach(() => { process.env = { ...saved }; });

const admin = (draft: any = null) => ({
  from: () => { const q: any = { select: () => q, eq: () => q, limit: () => Promise.resolve({ data: [{ draft, published: null }], error: null }) }; return q; },
});
const actor = { userId: "u1", name: "Admin" } as any;
const REG = { id: "mistral", label: "Mistral", protocol: "openai_chat_completions", endpoint: "https://api.mistral.ai/v1", models: { cheap: "mistral-small" } };

describe("registering a provider from HQ", () => {
  it("a browser cannot set status or checks: a crafted 'active' registration is stored inactive, with no checks", async () => {
    const r = await saveProviderRegistration(admin() as any, actor, { ...REG, status: "active", checks: { connectivity: { at: "t", ok: true }, capability: { at: "t", ok: true } } });
    expect(r.ok).toBe(true);
    expect(stored.mistral).toMatchObject({ status: "inactive", checks: {} });
  });

  it("refused: an unsupported protocol (reported as needing an adapter), a built-in name, an unapproved host", async () => {
    expect(await saveProviderRegistration(admin() as any, actor, { ...REG, protocol: "anthropic_messages" })).toMatchObject({ ok: false, error: expect.stringMatching(/needs an adapter written in the gateway/) });
    expect(await saveProviderRegistration(admin() as any, actor, { ...REG, id: "openai" })).toMatchObject({ ok: false });
    expect(await saveProviderRegistration(admin() as any, actor, { ...REG, endpoint: "https://api.evil.example/v1" })).toMatchObject({ ok: false, error: expect.stringMatching(/does not permit/) });
    expect(stored).toBeNull();
  });

  it("activation is refused until every check is recorded", async () => {
    const r: any = await setProviderStatus(admin({ mistral: { ...REG, status: "inactive", checks: {} } }) as any, actor, "mistral", "active");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/connectivity/);
    expect(stored).toBeNull();
  });

  it("a failed server check records the failure, deactivates, and never stores the key", async () => {
    const r = await runProviderChecks(admin({ mistral: { ...REG, status: "inactive", checks: {} } }) as any, actor, "mistral");
    expect(r.ok).toBe(true);
    expect(stored.mistral.checks.connectivity.ok).toBe(false);
    expect(stored.mistral.status).toBe("inactive");
    expect(JSON.stringify(stored)).not.toContain(KEY);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it("what HQ is shown says whether the key is set and its variable NAME, never the value", async () => {
    const v = await loadProviderRegistryView(admin({ mistral: { ...REG } }) as any);
    expect(v?.keyed).toEqual({ mistral: true });
    expect(v?.credentialNames).toEqual({ mistral: "AI_PROVIDER_KEY_MISTRAL" });
    expect(JSON.stringify(v)).not.toContain(KEY);
  });
});
