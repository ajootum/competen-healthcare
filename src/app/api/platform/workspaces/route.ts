import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { workspaceCatalogue } from "@/lib/platform/workspaces";

// Workspace Management (POP-001 §3) — upsert sparse per-workspace overrides
// (enable/disable, label, icon, description, accent, audience) keyed by the code
// catalogue key; "reset" clears the override back to code defaults. Super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */

const clean = (v: any, max = 160) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const HEX = /^#[0-9a-fA-F]{6}$/;

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;

  const key = new URL(req.url).searchParams.get("key");
  if (!key) return badRequest("key required");
  const entry = workspaceCatalogue().find(w => w.key === key);
  if (!entry) return badRequest("Unknown workspace key");
  const b = await req.json().catch(() => ({}));

  // Reset — drop the override row so the workspace reverts to code defaults.
  if (b.action === "reset") {
    const { error } = await admin.from("plat_workspaces").delete().eq("key", key);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({ actor_id: c.userId, action: "workspace_reset", entity_type: "workspace", entity_id: null, entity_name: entry.name });
    return NextResponse.json({ ok: true, reset: true });
  }

  // Build the sparse override patch from provided fields only.
  const patch: any = { key, updated_by: c.userId, updated_at: new Date().toISOString() };
  if (b.is_enabled !== undefined) patch.is_enabled = !!b.is_enabled;
  if (b.label !== undefined) patch.label = clean(b.label, 80);
  if (b.icon !== undefined) patch.icon = clean(b.icon, 8);
  if (b.description !== undefined) patch.description = clean(b.description, 240);
  if (b.accent !== undefined) { if (b.accent && !HEX.test(b.accent)) return badRequest("accent must be a #RRGGBB hex"); patch.accent = b.accent || null; }
  if (b.audience !== undefined) {
    if (!Array.isArray(b.audience)) return badRequest("audience must be an array");
    patch.audience = [...new Set(b.audience.filter((x: any) => typeof x === "string" && x.trim()).map((x: string) => x.trim().slice(0, 40)))].slice(0, 24);
  }
  if (b.sort !== undefined) patch.sort = Number.isFinite(Number(b.sort)) ? Number(b.sort) : null;
  if (Object.keys(patch).length <= 3) return badRequest("no valid fields");

  const { data, error } = await admin.from("plat_workspaces").upsert(patch, { onConflict: "key" }).select().single();
  if (error) {
    if (/relation .*plat_workspaces.* does not exist/i.test(error.message)) return NextResponse.json({ error: "Run migration 053 to enable workspace management" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await admin.from("audit_log").insert({ actor_id: c.userId, action: b.is_enabled === false ? "workspace_disabled" : "workspace_updated", entity_type: "workspace", entity_id: null, entity_name: entry.name });
  return NextResponse.json(data);
}
