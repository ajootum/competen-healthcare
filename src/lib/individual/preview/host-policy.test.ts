import { describe, it, expect } from "vitest";
import { decidePreviewRequest, classifyPreviewPath, isTestingWritePath, normalisePath } from "./host-policy";

const PREVIEW = "preview.competenhealthcare.com";
const MAIN = "www.competenhealthcare.com";
const d = (path: string, method = "GET", mode: "read_only" | "testing" | null = "read_only", host = PREVIEW) =>
  decidePreviewRequest(host, path, method, mode);

describe("preview host: what is served", () => {
  it.each([
    "/individual/scholar", "/individual/scholar/study", "/individual/scholar/study/library", "/individual/home",
    "/individual/welcome", "/individual/learning/record", "/api/individual/scholar/materials", "/api/individual/assistant",
  ])("serves %s to a signed-in learner (session required)", p => {
    expect(d(p)).toEqual({ action: "allow", kind: "session" });
  });

  it.each(["/_next/static/chunks/a.js", "/_next/image", "/brand/scholar/competen-scholar-emblem-32.png", "/images/scholar/x.png", "/fonts/a.woff2", "/favicon.ico"])(
    "serves the asset %s with no session", p => {
      expect(d(p)).toEqual({ action: "allow", kind: "asset" });
    });

  it.each(["/preview/enter", "/preview/ended", "/preview/end"])("serves %s as a preview route", p => {
    expect(d(p)).toEqual({ action: "allow", kind: "preview" });
  });

  it.each([
    "/", "/login", "/signup", "/api/auth/login", "/api/auth/logout", "/super-admin", "/super-admin/individual/scholar", "/practice/home", "/practice",
    "/api/hq/individual/scholar-preview", "/api/hq", "/api/account/profile", "/dashboard", "/staff", "/enterprise", "/api/knowledge-objects",
    "/individual", "/individual/", "/individual/sign-in", "/individual/join", "/individual/billing", "/individual/access", "/individual/billing/portal",
    "/api/individual", "/preview", "/api", "/robots.txt", "/sw.js",
  ])("answers 404 for %s", p => {
    expect(d(p).action).toBe("not_found");
  });

  it("404s on every method for an unserved path, never 403 (the surface does not exist)", () => {
    for (const m of ["GET", "POST", "PUT", "DELETE"]) expect(d("/api/hq/anything", m).action).toBe("not_found");
  });

  it("does not let encoding, doubled slashes, dot segments or case reach a blocked or unserved surface", () => {
    for (const p of [
      "/individual/%73ign-in", "/individual/SIGN-IN", "/individual//billing", "/individual/./join", "/individual/../login",
      "/individual/scholar/../../super-admin", "/%73uper-admin", "//login", "/api//hq/users", "/api/%68q/users", "/individual/scholar/%2e%2e/%2e%2e/login",
      "/individual/%2fsign-in", "/individual/%5csign-in", "/individual/%zz", "/Individual/Access",
    ]) expect(d(p).action, p).toBe("not_found");
  });

  it("blocks the GET of billing, join and invitation APIs, not only their pages", () => {
    for (const f of ["billing", "join", "invitation"]) expect(d(`/api/individual/${f}/x`).action).toBe("not_found");
  });
});

describe("preview host: read-only refuses every write", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])("refuses %s to a Scholar API", m => {
    expect(d("/api/individual/scholar/materials", m, "read_only").action).toBe("forbidden");
  });
  it("refuses a POST to a page path (a server action) in both modes", () => {
    expect(d("/individual/scholar/study", "POST", "read_only").action).toBe("forbidden");
    expect(d("/individual/scholar/study", "POST", "testing").action).toBe("forbidden");
  });
  it("treats an unknown mode as read-only", () => {
    expect(d("/api/individual/scholar/materials", "POST", null).action).toBe("forbidden");
  });
  it("lets HEAD through like GET", () => {
    expect(d("/individual/scholar", "HEAD").action).toBe("allow");
  });
  it("is case-insensitive about the method", () => {
    expect(d("/api/individual/scholar/materials", "post", "read_only").action).toBe("forbidden");
    expect(d("/api/individual/scholar/materials", "get", "read_only").action).toBe("allow");
  });
});

describe("preview host: testing mode writes", () => {
  it.each([
    "/api/individual/scholar/materials", "/api/individual/scholar/learn/act", "/api/individual/scholar/revision/sessions",
    "/api/individual/scholar/clinical/cases", "/api/individual/assistant", "/api/individual/scholar/study-plan",
  ])("allows a POST to %s", p => {
    expect(d(p, "POST", "testing")).toEqual({ action: "allow", kind: "session" });
  });
  it.each([
    "/api/individual/scholar/erase", "/api/individual/scholar/erase/all", "/api/individual/scholar/passport-share", "/api/individual/scholar/passport-share/x",
    "/api/individual/learning/checkout", "/api/individual/billing/portal", "/api/individual/join", "/api/individual/invitation/accept",
    "/api/individual/identity", "/api/individual/terms", "/api/individual/professional", "/api/individual/professional-add", "/api/individual/profile-items",
    "/api/individual/preferences", "/api/individual/notifications", "/api/individual/ai-allowance",
  ])("refuses a POST to %s even in testing mode", p => {
    expect(d(p, "POST", "testing").action).toBe("forbidden");
  });
  it("does not widen by prefix: scholar-erase-like siblings and traversal are not the erase route", () => {
    expect(isTestingWritePath("/api/individual/scholarship")).toBe(false);
    expect(isTestingWritePath("/api/individual/scholar/%65rase")).toBe(false);
    expect(isTestingWritePath("/api/individual/scholar/passport-share")).toBe(false);
    expect(isTestingWritePath("/api/individual/scholar/../billing")).toBe(false);
  });
});

describe("the main host and lookalikes", () => {
  it("404s /preview/* on the main host and on every non-preview host", () => {
    for (const h of [MAIN, "competenhealthcare.com", "staff.competenhealthcare.com", "localhost", "localhost:3100", "127.0.0.1", null, undefined, ""])
      expect(decidePreviewRequest(h, "/preview/enter", "GET", null).action, String(h)).toBe("not_found");
  });
  it("leaves every other path on the main host untouched", () => {
    for (const p of ["/", "/login", "/super-admin", "/individual/scholar", "/api/hq/x", "/individual"])
      expect(decidePreviewRequest(MAIN, p, "POST", null).action, p).toBe("allow");
  });
  it("treats a lookalike host as the main host, so it gets no preview behaviour at all", () => {
    for (const h of ["notpreview.competenhealthcare.com", "preview.competenhealthcare.com.evil.test", "x.preview.competenhealthcare.com", "preview.localhost.evil.test"]) {
      expect(decidePreviewRequest(h, "/preview/enter", "GET", null).action, h).toBe("not_found");
      expect(decidePreviewRequest(h, "/super-admin", "GET", null).action, h).toBe("allow");
    }
  });
  it("recognises the dev host and a port", () => {
    expect(decidePreviewRequest("preview.localhost:3100", "/login", "GET", null).action).toBe("not_found");
    expect(decidePreviewRequest("preview.localhost:3100", "/individual/scholar", "GET", "read_only").action).toBe("allow");
    expect(decidePreviewRequest("PREVIEW.competenhealthcare.com", "/login", "GET", null).action).toBe("not_found");
  });
  it("leaves an unjudgeable path on the main host alone (only /preview is ours to refuse)", () => {
    expect(decidePreviewRequest(MAIN, "/a/%zz", "GET", null).action).toBe("allow");
  });
});

describe("path helpers", () => {
  it("normalises", () => {
    expect(normalisePath("/Individual//Scholar/")).toEqual(["individual", "scholar"]);
    expect(normalisePath("/a/%2e%2e")).toBeNull();
    expect(normalisePath("nope")).toBeNull();
  });
  it("classifies", () => {
    expect(classifyPreviewPath("/individual/scholar")).toBe("session");
    expect(classifyPreviewPath("/api/individual/scholar/x")).toBe("session");
    expect(classifyPreviewPath("/login")).toBeNull();
  });
});
