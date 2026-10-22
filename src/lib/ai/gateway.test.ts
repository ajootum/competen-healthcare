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

describe("recordAiUsage attribution columns", () => {
  const row = () => insert.mock.calls[0][0];

  it("a Practice workspace goes to workspace_id and never to tenant_id", async () => {
    insert.mockResolvedValue({ error: null });
    await recordAiUsage({ status: "ok", attribution: { scope: "workspace", workspaceId: "ws-1" } });
    expect(row()).toMatchObject({ tenant_id: null, workspace_id: "ws-1", attribution_scope: "workspace" });
  });

  it("an Enterprise tenant goes to tenant_id", async () => {
    insert.mockResolvedValue({ error: null });
    await recordAiUsage({ status: "ok", attribution: { scope: "tenant", tenantId: "t-1" } });
    expect(row()).toMatchObject({ tenant_id: "t-1", workspace_id: null, attribution_scope: "tenant" });
  });

  it("an Individual call is the person alone", async () => {
    insert.mockResolvedValue({ error: null });
    await recordAiUsage({ status: "ok", actorId: "u-1", attribution: { scope: "person" } });
    expect(row()).toMatchObject({ actor_id: "u-1", tenant_id: null, workspace_id: null, attribution_scope: "person" });
  });

  // ⚠ The code ships before the owner applies migration 371. Without this the new columns would cost
  // every usage row until then -- the same silent loss this change exists to end.
  it("before migration 371, lands the row without the new columns instead of losing it", async () => {
    insert
      .mockResolvedValueOnce({ error: { code: "PGRST204", message: "Could not find the 'attribution_scope' column of 'plat_ai_requests' in the schema cache" } })
      .mockResolvedValueOnce({ error: null });
    await recordAiUsage({ status: "ok", attribution: { scope: "workspace", workspaceId: "ws-1" } });
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[1][0]).not.toHaveProperty("workspace_id");
    expect(insert.mock.calls[1][0]).toMatchObject({ tenant_id: null });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // The message text is PostgREST's own, captured on staging. PGRST204 names ANY missing column, so the
  // fallback must not swallow a schema fault that has nothing to do with 371.
  it("does not retry around a different missing column, and reports it", async () => {
    insert.mockResolvedValue({ error: { code: "PGRST204", message: "Could not find the 'cost_usd' column of 'plat_ai_requests' in the schema cache" } });
    await recordAiUsage({ status: "ok", operation: "practice_ai_summary", attribution: { scope: "workspace", workspaceId: "ws-1" } });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toMatch(/NOT recorded: Could not find the 'cost_usd' column/);
  });

  it("does not retry a foreign-key refusal either", async () => {
    insert.mockResolvedValue({ error: { code: "23503", message: "violates foreign key constraint \"plat_ai_requests_workspace_id_fkey\"" } });
    await recordAiUsage({ status: "ok", attribution: { scope: "workspace", workspaceId: "gone" } });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
