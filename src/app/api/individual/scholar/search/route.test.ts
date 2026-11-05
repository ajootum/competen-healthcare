// Global Search's boundary: signed in, offered, and only the modules this person may see are read.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  refuse: false, policy: { scholarGlobalSearch: "on", scholarLearningLibrary: "on" } as Record<string, string>,
  planOn: true, saved: true, modules: new Set<string>(), access: null as any, calls: 0, // eslint-disable-line @typescript-eslint/no-explicit-any
}));

vi.mock("@/lib/individual/guard", () => ({
  requireIndividualContext: async () => (h.refuse ? NextResponse.json({ error: "Sign in." }, { status: 401 }) : { admin: {}, userId: "u1" }),
  isGuardRefusal: (x: unknown) => x instanceof NextResponse,
}));
vi.mock("@/lib/individual/policy", () => ({ loadIndividualPolicy: async () => h.policy, isMyPlanOn: () => h.planOn }));
vi.mock("@/lib/individual/scholar/module-access", () => ({ scholarModulesFor: async () => h.modules }));
vi.mock("@/lib/individual/scholar/store", () => ({ studyPlanSchema: async () => true, librarySchema: async () => h.saved }));
vi.mock("@/lib/individual/scholar/global-search", () => ({
  parseGlobalQuery: (q: string | null) => (q && q.trim().length >= 2 ? q.trim() : null),
  globalSearch: async (_c: unknown, access: unknown) => { h.calls++; h.access = access; return []; },
}));

import { GET } from "./route";

const get = (q = "sepsis") => GET(new Request(`http://x/api/individual/scholar/search?q=${encodeURIComponent(q)}`));

beforeEach(() => { h.refuse = false; h.policy = { scholarGlobalSearch: "on", scholarLearningLibrary: "on" }; h.planOn = true; h.saved = true; h.modules = new Set(); h.access = null; h.calls = 0; });

describe("GET /api/individual/scholar/search", () => {
  it("refuses someone not signed in, and reads nothing", async () => {
    h.refuse = true;
    expect((await get()).status).toBe(401);
    expect(h.calls).toBe(0);
  });
  it("is not there at all until HQ publishes it", async () => {
    h.policy.scholarGlobalSearch = "off";
    expect((await get()).status).toBe(404);
    expect(h.calls).toBe(0);
  });
  it("asks for at least two letters", async () => {
    expect((await get("a")).status).toBe(400);
    expect(h.calls).toBe(0);
  });
  it("passes the person's real access to the search", async () => {
    h.planOn = false; h.saved = false;
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(h.access).toMatchObject({ planOn: false, savedOn: false });
    expect(h.access.modules.has("competencies")).toBe(false);
  });
  it("saved learning needs both the policy and the install", async () => {
    h.policy.scholarLearningLibrary = "off";
    await get();
    expect(h.access.savedOn).toBe(false);
  });
});
