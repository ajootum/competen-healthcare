import { describe, it, expect } from "vitest";
import {
  PREVIEW_COOKIE, PREVIEW_TTL_SECONDS, previewCookieOptions, previewCookieClear, isUuid, livePreview, consumePreviewTicket, openPreview,
} from "./session";
import { previewOrigin, returnOriginFor, isRegisteredOrigin, sameOrigin, isDevHost } from "./origins";

/* eslint-disable @typescript-eslint/no-explicit-any */
const U = "11111111-2222-4333-8444-555555555555";
const fake = (data: any, error: any = null) => ({ rpc: async () => ({ data, error }), from: () => ({}) } as any);

describe("the preview cookie", () => {
  it("is HttpOnly, SameSite=Lax, path /, with NO domain (host-only) and the 60 minute TTL", () => {
    const o = previewCookieOptions(undefined, true) as Record<string, unknown>;
    expect(o).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 3600 });
    expect("domain" in o).toBe(false);
    expect(PREVIEW_COOKIE).toBe("cmp_scholar_preview");
    expect(PREVIEW_TTL_SECONDS).toBe(3600);
  });
  it("is Secure in production and not Secure on http dev", () => {
    expect(previewCookieOptions(undefined, true).secure).toBe(true);
    expect(previewCookieOptions(undefined, false).secure).toBe(false);
  });
  it("never outlives the session: capped at the TTL, floored at zero", () => {
    expect(previewCookieOptions(99999, true).maxAge).toBe(3600);
    expect(previewCookieOptions(-5, true).maxAge).toBe(0);
    expect(previewCookieOptions(1200.9, true).maxAge).toBe(1200);
  });
  it("clears with the same attributes so the browser matches it", () => {
    expect(previewCookieClear(true)).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  });
});

describe("the database wrappers fail closed", () => {
  it("livePreview is null for a malformed, missing or unknown token and for any error", async () => {
    expect(await livePreview(fake([{ learner_id: U }]), "not-a-uuid")).toBeNull();
    expect(await livePreview(fake([{ learner_id: U }]), undefined)).toBeNull();
    expect(await livePreview(fake([]), U)).toBeNull();
    expect(await livePreview(fake(null, { code: "42883", message: "function does not exist" }), U)).toBeNull();
  });
  it("livePreview returns the learner, mode and actor of a live row", async () => {
    const s = await livePreview(fake([{ learner_id: U, mode: "read_only", expires_at: "2026-11-02T10:00:00Z", actor_id: "a", return_origin: "https://www.competenhealthcare.com", session_id: "s" }]), U);
    expect(s).toMatchObject({ learnerId: U, mode: "read_only", actorId: "a", token: U });
  });
  it("consumePreviewTicket is null for a bad ticket and for no row", async () => {
    expect(await consumePreviewTicket(fake([{ token: U }]), "x")).toBeNull();
    expect(await consumePreviewTicket(fake([]), U)).toBeNull();
    expect((await consumePreviewTicket(fake([{ token: U, learner_id: U, mode: "testing", expires_at: "t", session_id: "s", actor_id: "a" }]), U))?.mode).toBe("testing");
  });
  it("openPreview names a missing designation and a missing migration plainly", async () => {
    expect(await openPreview(fake(null, { message: "scholar_preview no_learner: none" }), U, "read_only", "https://www.competenhealthcare.com")).toMatchObject({ ok: false, code: "NO_LEARNER" });
    expect(await openPreview(fake(null, { code: "PGRST202", message: "x" }), U, "read_only", "https://www.competenhealthcare.com")).toMatchObject({ ok: false, code: "NOT_SET_UP" });
    expect(await openPreview(fake([{ ticket: U, ticket_expires_at: "t", session_id: "s" }]), U, "read_only", "https://www.competenhealthcare.com")).toMatchObject({ ok: true, ticket: U });
  });
  it("isUuid", () => { expect(isUuid(U)).toBe(true); expect(isUuid("abc")).toBe(false); expect(isUuid(null)).toBe(false); });
});

describe("origins", () => {
  it("derives the preview origin from the request host, never from input", () => {
    expect(previewOrigin("www.competenhealthcare.com")).toBe("https://preview.competenhealthcare.com");
    expect(previewOrigin("staff.competenhealthcare.com")).toBe("https://preview.competenhealthcare.com");
    expect(previewOrigin("localhost:3100")).toBe("http://preview.localhost:3100");
    expect(previewOrigin("staff.localhost:3100")).toBe("http://preview.localhost:3100");
    expect(previewOrigin("evil.test")).toBe("https://preview.competenhealthcare.com");
  });
  it("derives the return origin from a registered host only", () => {
    expect(returnOriginFor("staff.competenhealthcare.com")).toBe("https://staff.competenhealthcare.com");
    expect(returnOriginFor("localhost:3100")).toBe("http://localhost:3100");
    expect(returnOriginFor("evil.test")).toBe("https://www.competenhealthcare.com");
    expect(returnOriginFor(null)).toBe("https://www.competenhealthcare.com");
    expect(returnOriginFor("my-app-git-x.vercel.app")).toBe("https://www.competenhealthcare.com");
  });
  it("accepts only an exact registered origin", () => {
    for (const o of ["https://www.competenhealthcare.com", "https://staff.competenhealthcare.com", "http://localhost:3100", "http://staff.localhost:3100"])
      expect(isRegisteredOrigin(o), o).toBe(true);
    for (const o of ["https://evil.test", "https://www.competenhealthcare.com/", "https://www.competenhealthcare.com/x", "http://www.competenhealthcare.com",
      "https://www.competenhealthcare.com.evil.test", "https://user@www.competenhealthcare.com", "javascript:alert(1)", "", null, "https://preview.competenhealthcare.com", "http://preview.localhost:3100"])
      expect(isRegisteredOrigin(o as any), String(o)).toBe(false);
  });
  it("checks the Origin header against the request's own host", () => {
    expect(sameOrigin("https://www.competenhealthcare.com", "www.competenhealthcare.com", "https")).toBe(true);
    expect(sameOrigin("https://evil.test", "www.competenhealthcare.com", "https")).toBe(false);
    expect(sameOrigin(null, "www.competenhealthcare.com", "https")).toBe(false);
    expect(sameOrigin("http://localhost:3100", "localhost:3100", "http")).toBe(true);
    expect(isDevHost("preview.localhost:3100")).toBe(true);
    expect(isDevHost("www.competenhealthcare.com")).toBe(false);
  });
});
