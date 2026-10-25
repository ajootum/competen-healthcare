/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { activationProblems, checkEndpoint, checkEndpointResolves, credentialEnvName, isNonPublicIp, redact, registeredAvailable, registeredKey, resolveRegistry } from "./provider-registry";

// Owner "NO-CODE AI PROVIDER EXTENSIBILITY" (25 October 2026): approved endpoints only, credentials never in
// configuration, and a new provider inactive and clinically unapproved until checked, activated and evaluated.

const ENV = { AI_PROVIDER_ALLOWED_HOSTS: "api.mistral.ai, api.together.xyz", AI_PROVIDER_KEY_MISTRAL: "test-placeholder-mistral-key" };
const CHECKS = {
  connectivity: { at: "2026-10-25T10:00:00Z", by: "u", ok: true, detail: null }, capability: { at: "2026-10-25T10:00:00Z", by: "u", ok: true, detail: null },
  privacy: { at: "2026-10-25T10:00:00Z", by: "u", ok: true, detail: null, termsRef: "DPA 2026-10", region: "EU", noTraining: true },
  security: { at: "2026-10-25T10:00:00Z", by: "u", ok: true, detail: "key in env, endpoint reviewed" },
};

describe("approved endpoints only (SSRF)", () => {
  it("an allowlisted https host is accepted, normalised to its base", () => {
    expect(checkEndpoint("https://api.mistral.ai/v1/", ENV)).toEqual({ ok: true, url: "https://api.mistral.ai/v1", host: "api.mistral.ai" });
  });

  it("refused: http, another port, credentials in the URL, a query, a host the deployment does not permit", () => {
    for (const u of ["http://api.mistral.ai/v1", "https://api.mistral.ai:8443/v1", "https://user:pw@api.mistral.ai/v1", "https://api.mistral.ai/v1?x=1", "https://api.evil.example/v1"])
      expect([u, checkEndpoint(u, ENV).ok]).toEqual([u, false]);
  });

  it("refused: loopback, private, link-local and metadata addresses and names, even if someone allowlisted them", () => {
    const env = { AI_PROVIDER_ALLOWED_HOSTS: "localhost,169.254.169.254,10.0.0.5,metadata.google.internal,db.internal" };
    for (const u of ["https://localhost/v1", "https://169.254.169.254/latest", "https://10.0.0.5/v1", "https://[::1]/v1", "https://metadata.google.internal/v1", "https://db.internal/v1"])
      expect([u, checkEndpoint(u, env).ok]).toEqual([u, false]);
  });

  it("isNonPublicIp knows the ranges, including IPv4-mapped IPv6", () => {
    for (const ip of ["10.1.2.3", "172.16.0.1", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:10.0.0.1"]) expect([ip, isNonPublicIp(ip)]).toEqual([ip, true]);
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect([ip, isNonPublicIp(ip)]).toEqual([ip, false]);
  });

  it("AT CALL TIME: a permitted host that resolves to a private address is refused (DNS rebinding)", async () => {
    expect(await checkEndpointResolves("https://api.mistral.ai/v1", ENV, async () => [{ address: "10.0.0.7" }])).toMatchObject({ ok: false });
    expect(await checkEndpointResolves("https://api.mistral.ai/v1", ENV, async () => [{ address: "1.2.3.4" }, { address: "::ffff:127.0.0.1" }])).toMatchObject({ ok: false });
    expect(await checkEndpointResolves("https://api.mistral.ai/v1", ENV, async () => [{ address: "51.159.1.1" }])).toEqual({ ok: true });
    expect(await checkEndpointResolves("https://api.mistral.ai/v1", { AI_PROVIDER_ALLOWED_HOSTS: "" }, async () => [{ address: "51.159.1.1" }])).toMatchObject({ ok: false });
  });
});

describe("credentials never in configuration", () => {
  it("the key's variable name is derived from the id, so configuration cannot name another secret", () => {
    expect(credentialEnvName("mistral")).toBe("AI_PROVIDER_KEY_MISTRAL");
    expect(registeredKey("mistral", ENV)).toBe("test-placeholder-mistral-key");
    expect(registeredKey("SUPABASE_SERVICE_ROLE_KEY", { SUPABASE_SERVICE_ROLE_KEY: "x" } as any)).toBeNull();
  });

  it("a key pasted into the registry is not kept, and redact() removes a key from text", () => {
    const reg = resolveRegistry({ mistral: { endpoint: "https://api.mistral.ai/v1", protocol: "openai_chat_completions", models: { cheap: "mistral-small" }, apiKey: "test-placeholder-mistral-key", key: "x" } }, ENV);
    expect(JSON.stringify(reg)).not.toMatch(/test-placeholder|apiKey|"key"/);
    expect(redact("401: invalid key test-placeholder-mistral-key", ENV.AI_PROVIDER_KEY_MISTRAL)).toBe("401: invalid key [redacted]");
  });
});

describe("inactive and unapproved by default", () => {
  const entry = (over: any = {}) => resolveRegistry({ mistral: { label: "Mistral", endpoint: "https://api.mistral.ai/v1", protocol: "openai_chat_completions", models: { cheap: "mistral-small" }, ...over } }, ENV).mistral;

  it("a new registration is inactive, and a draft claiming 'active' without the checks stays inactive", () => {
    expect(entry().status).toBe("inactive");
    expect(entry({ status: "active" }).status).toBe("inactive");
    expect(activationProblems(entry())).toHaveLength(4);
  });

  it("control: with every check recorded, an active entry is active; with any one missing it is not", () => {
    expect(entry({ status: "active", checks: CHECKS }).status).toBe("active");
    for (const k of Object.keys(CHECKS)) {
      const partial = { ...CHECKS, [k]: undefined };
      expect([k, entry({ status: "active", checks: partial }).status]).toEqual([k, "inactive"]);
    }
  });

  it("an unsupported protocol or an endpoint the deployment no longer permits keeps it inactive", () => {
    expect(entry({ status: "active", checks: CHECKS, protocol: "anthropic_messages" }).status).toBe("inactive");
    const reg = resolveRegistry({ mistral: { endpoint: "https://api.mistral.ai/v1", protocol: "openai_chat_completions", models: { cheap: "m" }, status: "active", checks: CHECKS } }, { AI_PROVIDER_ALLOWED_HOSTS: "" });
    expect(reg.mistral.status).toBe("inactive");
  });

  it("a built-in provider's name cannot be registered over it", () => {
    expect(resolveRegistry({ openai: { endpoint: "https://api.mistral.ai/v1", protocol: "openai_chat_completions", models: { cheap: "m" } } }, ENV)).toEqual({});
  });

  it("available only when active, keyed and still permitted", () => {
    const active = entry({ status: "active", checks: CHECKS });
    expect(registeredAvailable(active, ENV)).toBe(true);
    expect(registeredAvailable(active, { AI_PROVIDER_ALLOWED_HOSTS: ENV.AI_PROVIDER_ALLOWED_HOSTS })).toBe(false);   // no key
    expect(registeredAvailable(entry(), ENV)).toBe(false);                                                            // inactive
  });
});
