import { describe, it, expect, vi } from "vitest";

// The estate AI quota keeps failing OPEN (`ok`), and now also reports `unreadable`, so a caller that must fail
// closed can (Competen Individual: src/lib/individual/policy.ts individualAiQuota).

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({}) }));
import { checkAiQuota } from "./quota";

const adminWith = (result: { count: number | null; error: unknown }) => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "gte", "limit"]) b[m] = () => b;
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
  return { from: () => b } as never;
};

describe("checkAiQuota", () => {
  it("a failed count: the estate still gets ok (unchanged), and unreadable is reported", async () => {
    expect(await checkAiQuota(adminWith({ count: null, error: { code: "57014" } }), "u")).toMatchObject({ ok: true, used: 0, unreadable: true });
  });
  it("a completed count is readable, and over the limit is not ok", async () => {
    expect(await checkAiQuota(adminWith({ count: 3, error: null }), "u")).toMatchObject({ ok: true, used: 3, unreadable: false });
    expect(await checkAiQuota(adminWith({ count: 999, error: null }), "u")).toMatchObject({ ok: false, unreadable: false });
  });
});
