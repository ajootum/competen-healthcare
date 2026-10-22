import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// recordAiUsage, tested by RUNNING it against a stubbed admin client.
//
// ⚠ THE SILENT DROP THIS CLOSES. supabase-js reports a failed insert as { error }, it does not throw,
// so the old `try { await insert } catch {}` caught nothing and logged nothing. Every Practice AI call
// passed its workspace id as tenant_id, plat_ai_requests.tenant_id is a foreign key to tenants(id)
// (migration 055), and a Practice workspace is not a tenant -- so every one of those rows was refused
// by the database and the AI Gateway console simply never heard about Practice usage.

const insert = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ from: () => ({ insert }) }),
}));

import { recordAiUsage } from "@/lib/ai/gateway";

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { insert.mockReset(); errorSpy = vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { errorSpy.mockRestore(); });

describe("recordAiUsage failure reporting", () => {
  it("reports an insert the database refused, instead of dropping it silently", async () => {
    insert.mockResolvedValue({ error: { message: 'insert or update on table "plat_ai_requests" violates foreign key constraint "plat_ai_requests_tenant_id_fkey"' } });
    await expect(recordAiUsage({ status: "ok", operation: "practice_ai_summary" })).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toMatch(/practice_ai_summary.*NOT recorded.*foreign key/);
  });

  it("still never throws when the client itself throws, and says so", async () => {
    insert.mockImplementation(() => { throw new Error("no service role key"); });
    await expect(recordAiUsage({ status: "error" })).resolves.toBeUndefined();
    expect(String(errorSpy.mock.calls[0][0])).toMatch(/NOT recorded: no service role key/);
  });

  it("stays quiet when the row lands", async () => {
    insert.mockResolvedValue({ error: null });
    await recordAiUsage({ status: "ok", operation: "admin_assistant" });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
