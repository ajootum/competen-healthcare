import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── NO SERVICE KEY IS "OFF", NOT A 500 ── found on Vercel Preview 2026-10-22 ─────────────────────────────
//
// Preview has no SUPABASE_SERVICE_ROLE_KEY. createAdminClient() throws "supabaseKey is required" at
// construction, so a gate that built its client that way answered 500 on /individual/access and
// /individual/home instead of 404. These run the REAL guard and the REAL server-client module with the
// key unset, and require DISABLED / 404 -- with no throw, and without ever reaching the session lookup.

const getUser = vi.fn();
vi.mock("next/server", async importOriginal => ({ ...(await importOriginal<typeof import("next/server")>()), connection: vi.fn(async () => {}) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser } }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));

const saved = { ...process.env };
beforeEach(() => {
  vi.resetModules();
  getUser.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://neutralised.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "neutralised";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});
afterEach(() => { process.env = { ...saved }; });

describe("the Individual guard with no service key", () => {
  it("control: the throwing constructor really does throw without the key", async () => {
    const { createAdminClient, createAdminClientOrNull } = await import("@/lib/supabase/server");
    expect(() => createAdminClient()).toThrow();
    expect(createAdminClientOrNull()).toBeNull();
  });

  it("resolves DISABLED -- no throw, no session lookup", async () => {
    const { resolveIndividualShell } = await import("./guard");
    await expect(resolveIndividualShell()).resolves.toEqual({ state: "DISABLED" });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("answers 404 to API callers", async () => {
    const { requireIndividualContext, isGuardRefusal } = await import("./guard");
    const r = await requireIndividualContext("scholar");
    expect(isGuardRefusal(r)).toBe(true);
    expect((r as Response).status).toBe(404);
  });
});
