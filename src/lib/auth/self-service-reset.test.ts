import { describe, expect, it, vi } from "vitest";
import { requestSelfServiceReset, selfServiceResetReturnUrl } from "./self-service-reset";

// The production defect (28 Oct 2026): a browser-side (PKCE) reset link opened on another device failed with
// "PKCE code verifier not found". The request is now made server-side with an implicit-flow client.

const client = (error: { message: string; status?: number } | null = null) => {
  const resetPasswordForEmail = vi.fn(async () => ({ error }));
  return { c: { auth: { resetPasswordForEmail } }, resetPasswordForEmail };
};

describe("self-service password reset, sent from the server", () => {
  it("sends to the address, lower-cased, with the configured return URL (never the request's origin)", async () => {
    const { c, resetPasswordForEmail } = client();
    const r = await requestSelfServiceReset("  Learner@Example.org ", c);
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(resetPasswordForEmail).toHaveBeenCalledWith("learner@example.org", { redirectTo: selfServiceResetReturnUrl() });
    expect(selfServiceResetReturnUrl()).toMatch(/^https?:\/\/[^/]+\/reset-password$/);
  });

  it("refuses a malformed address before any call", async () => {
    const { c, resetPasswordForEmail } = client();
    for (const bad of [null, "", "no-at-sign", "a@b", 42, "x".repeat(400) + "@example.org"])
      expect((await requestSelfServiceReset(bad, c)).status).toBe(400);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("does not reveal whether an account exists: an unknown address answers exactly like a known one", async () => {
    const known = await requestSelfServiceReset("known@example.org", client().c);
    const unknown = await requestSelfServiceReset("nobody@example.org", client().c);
    expect(unknown).toEqual(known);
  });

  it("a provider rate limit is a 429 with a neutral message, and other failures are a 502 that does not echo the address", async () => {
    expect(await requestSelfServiceReset("a@example.org", client({ message: "For security purposes, you can only request this after 42 seconds.", status: 429 }).c))
      .toEqual({ status: 429, body: { error: "Please wait a minute before asking for another link." } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await requestSelfServiceReset("a@example.org", client({ message: 'Error sending recovery email to "a@example.org"' }).c);
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toContain("a@example.org");
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("a@example.org");
    warn.mockRestore();
  });

  it("fails closed with 503 when no client can be built", async () => {
    expect((await requestSelfServiceReset("a@example.org", null)).status).toBe(503);
  });
});
