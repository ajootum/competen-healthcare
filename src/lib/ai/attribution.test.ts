import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// AI usage attribution, at the call sites (COMPETEN-AI-LOG-001).
//
// ⚠ TWO PRODUCTS PUT A NON-TENANT ID IN THE TENANT COLUMN. Practice passed its workspace id and the
// Enterprise copilots passed profiles.hospital_id as `tenantId`; plat_ai_requests.tenant_id references
// tenants(id), and on production 0 of 11 hospital ids and 0 of 1 workspace ids are tenant ids -- so the
// database would refuse every one of those usage rows. The fix replaced the bare tenantId with a scoped
// AiAttribution. These tests hold the call sites to it.

const generate = vi.fn();
vi.mock("@/lib/ai/client", () => ({ generate: (...a: unknown[]) => generate(...a) }));

import { phraseFactSections } from "@/lib/practice/document-phrasing";

const fact = {
  key: "practice_encounter:1", category: "encounter", sourceTable: "practice_encounter", sourceId: "1",
  label: "Seen for review", detail: null, scope: "patient", recordedOn: null,
} as never;

describe("Practice attributes AI usage to its workspace, never to a tenant", () => {
  it("document phrasing passes the workspace as a workspace", async () => {
    generate.mockResolvedValue({ ok: false, error: "failed" });
    await phraseFactSections({
      sections: [{ heading: "Encounter", facts: [fact] }], typed: [],
      enabled: true, canGenerate: true, workspaceId: "ws-1", userId: "u-1",
    });
    const context = generate.mock.calls[0][0].context;
    expect(context.attribution).toEqual({ scope: "workspace", workspaceId: "ws-1" });
    expect(context).not.toHaveProperty("tenantId");
  });
});

// Every generate() caller, read from source. A unit test cannot reach the twelve copilot routes without
// standing each one up, and the defect was a pattern copied twelve times -- so the pattern is what is
// checked.
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return sources(p);
    return /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [p] : [];
  });
}
const SRC = path.resolve(__dirname, "../..");
const files = sources(SRC).map(f => ({ f: path.relative(SRC, f), text: fs.readFileSync(f, "utf8") }));

describe("no AI caller passes a non-tenant id as the tenant", () => {
  it("no generate() context carries a bare tenantId any more", () => {
    const bare = files.filter(({ text }) => /context:\s*\{[^{}]*\btenantId:/.test(text)).map(x => x.f);
    expect(bare).toEqual([]);
  });

  it("every tenant-scoped attribution reads a tenant id, not a hospital or workspace id", () => {
    const tenantScoped = files.flatMap(({ f, text }) =>
      [...text.matchAll(/scope:\s*"tenant",\s*tenantId:\s*([^}]*)\}/g)].map(m => ({ f, expr: m[1].trim() })));
    expect(tenantScoped.length).toBeGreaterThanOrEqual(13); // 12 copilot routes + CGR link suggestion
    expect(tenantScoped.filter(x => /hospital|workspace|\bhid\b/i.test(x.expr))).toEqual([]);
  });

  it("Practice callers attribute to the workspace", () => {
    for (const f of ["lib/practice/ai-assistant.ts", "lib/practice/document-phrasing.ts"]) {
      const text = files.find(x => x.f.replace(/\\/g, "/") === f)!.text;
      expect(text).toMatch(/attribution:\s*\{\s*scope:\s*"workspace",\s*workspaceId:/);
    }
  });
});
