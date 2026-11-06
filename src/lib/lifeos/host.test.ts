import { describe, expect, it } from "vitest";
import { txtMatches } from "./core/tenants";
import { isFirstPartyHost, lifeosTenantRoute, normaliseHost, validTenantHostname } from "./host";

describe("the host rule cannot affect the main application", () => {
  const FIRST_PARTY = [
    "competenhealthcare.com", "www.competenhealthcare.com", "practice.competenhealthcare.com", "staff.competenhealthcare.com",
    "individual.competenhealthcare.com", "preview.competenhealthcare.com", "lifeos.competenhealthcare.com",
    "competen-v5-semacast.vercel.app", "localhost", "localhost:3000", "app.localhost:3000", "127.0.0.1:3100", "[::1]:3000",
  ];
  it("switched off, it answers nothing for any host at all", () => {
    for (const h of [...FIRST_PARTY, "acme.example.org"]) expect(lifeosTenantRoute(h, "/super-admin", false)).toBeNull();
  });
  it("switched on, it still answers nothing for every first-party host", () => {
    for (const h of FIRST_PARTY) {
      expect(lifeosTenantRoute(h, "/", true)).toBeNull();
      expect(lifeosTenantRoute(h, "/practice/home", true)).toBeNull();
    }
  });
  it("no host means no rule", () => {
    expect(lifeosTenantRoute(null, "/", true)).toBeNull();
    expect(lifeosTenantRoute("", "/", true)).toBeNull();
  });
  it("a lookalike of our domain is not first-party", () => {
    expect(isFirstPartyHost("competenhealthcare.com.evil.org")).toBe(false);
    expect(isFirstPartyHost("evilcompetenhealthcare.com")).toBe(false);
    expect(isFirstPartyHost("evilvercel.app")).toBe(false);
  });
});

describe("a tenant's host serves LifeOS and nothing else", () => {
  const route = (p: string) => lifeosTenantRoute("plan.acme.org:443", p, true);
  it("the root opens LifeOS", () => { expect(route("/")).toEqual({ kind: "rewrite", pathname: "/lifeos" }); });
  it("LifeOS and its API pass", () => {
    for (const p of ["/lifeos", "/lifeos/today", "/api/lifeos/v1/me", "/_next/static/x.js"]) expect(route(p)).toEqual({ kind: "pass" });
  });
  it("every other product is blocked", () => {
    for (const p of ["/login", "/super-admin", "/individual", "/practice/home", "/api/v1/practice/signup", "/api/auth/oauth/google", "/lifeosx", "/api/lifeosx"]) {
      expect(route(p)).toEqual({ kind: "block" });
    }
  });
});

describe("hostnames", () => {
  it("normalises case and port", () => { expect(normaliseHost("Plan.ACME.org:8443")).toBe("plan.acme.org"); });
  it("accepts a real public name", () => { expect(validTenantHostname(" Plan.Acme.org ")).toBe("plan.acme.org"); });
  it("refuses ours, and anything malformed", () => {
    for (const h of ["lifeos.competenhealthcare.com", "x.vercel.app", "localhost", "127.0.0.1", "no-dot", "-bad.example.org", "a b.example.org", "exa_mple.org", "https://acme.org", `${"a".repeat(250)}.org`]) {
      expect(validTenantHostname(h)).toBeNull();
    }
  });
  it("a TXT record must match whole, including when split into chunks", () => {
    expect(txtMatches([["abc", "def"]], "abcdef")).toBe(true);
    expect(txtMatches([["other"], ["abcdef"]], "abcdef")).toBe(true);
    expect(txtMatches([["abcde"]], "abcdef")).toBe(false);
    expect(txtMatches([], "abcdef")).toBe(false);
  });
});
