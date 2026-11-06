// Professional Global Search boundary: signed in, offered, only the modules Professional lists, and only the person's own records.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  refuse: false, policy: { professionalGlobalSearch: "on" } as Record<string, string>, calls: 0,
  access: null as any, ctx: null as any, asked: null as string | null, // eslint-disable-line @typescript-eslint/no-explicit-any
}));

vi.mock("@/lib/individual/guard", () => ({
  requireIndividualContext: async (x?: string) => { h.asked = x ?? null; return h.refuse ? NextResponse.json({ error: "Sign in." }, { status: 401 }) : { admin: {}, userId: "u1" }; },
  isGuardRefusal: (x: unknown) => x instanceof NextResponse,
}));
vi.mock("@/lib/individual/policy", () => ({ loadIndividualPolicy: async () => h.policy }));
vi.mock("@/lib/individual/professional/global-search", () => ({
  parseProfessionalQuery: (q: string | null) => (q && q.trim().length >= 2 ? q.trim() : null),
  professionalGlobalSearch: async (c: unknown, access: unknown) => { h.calls++; h.ctx = c; h.access = access; return []; },
}));

import { GET } from "./route";

const get = (q = "sepsis") => GET(new Request(`http://x/api/individual/professional/search?q=${encodeURIComponent(q)}`));

beforeEach(() => { h.refuse = false; h.policy = { professionalGlobalSearch: "on" }; h.calls = 0; h.access = null; h.ctx = null; h.asked = null; });

describe("GET /api/individual/professional/search", () => {
  it("asks for the Professional experience, and refuses someone not signed in without reading", async () => {
    h.refuse = true;
    expect((await get()).status).toBe(401);
    expect(h.asked).toBe("professional");
    expect(h.calls).toBe(0);
  });
  it("is not there at all until HQ publishes it", async () => {
    h.policy.professionalGlobalSearch = "off";
    expect((await get()).status).toBe(404);
    expect(h.calls).toBe(0);
  });
  it("is not turned on by the Scholar key", async () => {
    h.policy = { scholarGlobalSearch: "on", professionalGlobalSearch: "off" };
    expect((await get()).status).toBe(404);
    expect(h.calls).toBe(0);
  });
  it("asks for at least two letters", async () => {
    expect((await get("a")).status).toBe(400);
    expect(h.calls).toBe(0);
  });
  it("searches as the signed-in person, with the Professional modules, uncached", async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(h.ctx.userId).toBe("u1");
    expect([...h.access.modules].sort()).toEqual(["competencies", "cpd", "development", "evidence", "registration"]);
  });
});
