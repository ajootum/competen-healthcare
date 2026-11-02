import { COMPETEN_DOMAIN as D } from "@/lib/identity/domains";
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
    const s = await livePreview(fake([{ learner_id: U, mode: "read_only", expires_at: "2026-11-02T10:00:00Z", actor_id: "a", return_origin: `https://www.${D}`, session_id: "s" }]), U);
    expect(s).toMatchObject({ learnerId: U, mode: "read_only", actorId: "a", token: U });
  });
  it("consumePreviewTicket is null for a bad ticket and for no row", async () => {
    expect(await consumePreviewTicket(fake([{ token: U }]), "x")).toBeNull();
    expect(await consumePreviewTicket(fake([]), U)).toBeNull();
    expect((await consumePreviewTicket(fake([{ token: U, learner_id: U, mode: "testing", expires_at: "t", session_id: "s", actor_id: "a" }]), U))?.mode).toBe("testing");
  });
  it("openPreview names a missing designation and a missing migration plainly", async () => {
    expect(await openPreview(fake(null, { message: "scholar_preview no_learner: none" }), U, "read_only", `https://www.${D}`)).toMatchObject({ ok: false, code: "NO_LEARNER" });
    expect(await openPreview(fake(null, { code: "PGRST202", message: "x" }), U, "read_only", `https://www.${D}`)).toMatchObject({ ok: false, code: "NOT_SET_UP" });
    expect(await openPreview(fake([{ ticket: U, ticket_expires_at: "t", session_id: "s" }]), U, "read_only", `https://www.${D}`)).toMatchObject({ ok: true, ticket: U });
  });
  it("isUuid", () => { expect(isUuid(U)).toBe(true); expect(isUuid("abc")).toBe(false); expect(isUuid(null)).toBe(false); });
});

describe("origins", () => {
  it("derives the preview origin from the request host, never from input", () => {
    expect(previewOrigin(`www.${D}`)).toBe(`https://preview.${D}`);
    expect(previewOrigin(`staff.${D}`)).toBe(`https://preview.${D}`);
    expect(previewOrigin("localhost:3100")).toBe("http://preview.localhost:3100");
    expect(previewOrigin("staff.localhost:3100")).toBe("http://preview.localhost:3100");
    expect(previewOrigin("evil.test")).toBe(`https://preview.${D}`);
  });
  it("derives the return origin from a registered host only", () => {
    expect(returnOriginFor(`staff.${D}`)).toBe(`https://staff.${D}`);
    expect(returnOriginFor("localhost:3100")).toBe("http://localhost:3100");
    expect(returnOriginFor("evil.test")).toBe(`https://www.${D}`);
    expect(returnOriginFor(null)).toBe(`https://www.${D}`);
    expect(returnOriginFor("my-app-git-x.vercel.app")).toBe(`https://www.${D}`);
  });
  it("accepts only an exact registered origin", () => {
    for (const o of [`https://www.${D}`, `https://staff.${D}`, "http://localhost:3100", "http://staff.localhost:3100"])
      expect(isRegisteredOrigin(o), o).toBe(true);
    for (const o of ["https://evil.test", `https://www.${D}/`, `https://www.${D}/x`, `http://www.${D}`,
      `https://www.${D}.evil.test`, `https://user@www.${D}`, "javascript:alert(1)", "", null, `https://preview.${D}`, "http://preview.localhost:3100"])
      expect(isRegisteredOrigin(o as any), String(o)).toBe(false);
  });
  it("checks the Origin header against the request's own host", () => {
    expect(sameOrigin(`https://www.${D}`, `www.${D}`, "https")).toBe(true);
    expect(sameOrigin("https://evil.test", `www.${D}`, "https")).toBe(false);
    expect(sameOrigin(null, `www.${D}`, "https")).toBe(false);
    expect(sameOrigin("http://localhost:3100", "localhost:3100", "http")).toBe(true);
    expect(isDevHost("preview.localhost:3100")).toBe(true);
    expect(isDevHost(`www.${D}`)).toBe(false);
  });
});
