import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { missing } from "@/lib/priorities/engine";

// PPE-001 objective authoring + lifecycle (write layer over the read-only ppe_ model). Super-admin only —
// PPE authoring is platform-scope. Every mutation writes ppe_audit (what the Governance UI surfaces); submitting
// for approval materialises a ppe_approvals row into the governance queue. Fail-soft pre-migration (107).
/* eslint-disable @typescript-eslint/no-explicit-any */

const FRAMEWORKS = ["okr", "bsc", "custom"];
const SCOPES = ["platform", "enterprise"]; // MVP: broad scopes need no scope_ref; hospital/dept scoping is a later refinement
const clampPct = (n: any) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

async function audit(admin: any, actorId: string, entityId: string, action: string, detail: string, scopeType?: string | null, scopeRef?: string | null) {
  await admin.from("ppe_audit").insert({ entity_type: "objective", entity_id: entityId, action, actor_id: actorId, detail, scope_type: scopeType ?? "platform", scope_ref: scopeRef ?? null }).then((r: any) => r, () => {});
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Priority authoring is super-admin only");
  const b = await req.json().catch(() => ({}));
  const title = String(b.title ?? "").trim();
  if (!title) return badRequest("Title is required");
  const framework = FRAMEWORKS.includes(b.framework) ? b.framework : "okr";
  const scope_type = SCOPES.includes(b.scope_type) ? b.scope_type : "platform";

  const row = {
    title: title.slice(0, 300),
    description: b.description ? String(b.description).slice(0, 2000) : null,
    theme_id: b.theme_id || null,
    framework, scope_type, scope_ref: null,
    owner_id: c.userId, target_pct: clampPct(b.target_pct ?? 100), progress_pct: 0,
    status: "draft", version: 1, created_by: c.userId,
  };
  const { data, error } = await c.admin.from("ppe_objectives").insert(row).select("id").single();
  if (error) return missing(error) ? badRequest("Priority framework not provisioned (apply migration 107)") : NextResponse.json({ error: error.message }, { status: 500 });
  await audit(c.admin, c.userId, data.id, "created", `Objective “${title}” created as draft`, scope_type, null);
  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Priority authoring is super-admin only");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  const { data: obj, error: readErr } = await c.admin.from("ppe_objectives").select("*").eq("id", id).maybeSingle();
  if (readErr && missing(readErr)) return badRequest("Priority framework not provisioned (apply migration 107)");
  if (!obj) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // ── Field edit ──
  if (b.action === "update") {
    const patch: Record<string, any> = {};
    if (b.title !== undefined) patch.title = String(b.title).trim().slice(0, 300);
    if (b.description !== undefined) patch.description = b.description ? String(b.description).slice(0, 2000) : null;
    if (b.target_pct !== undefined) patch.target_pct = clampPct(b.target_pct);
    if (b.progress_pct !== undefined) patch.progress_pct = clampPct(b.progress_pct);
    if (b.theme_id !== undefined) patch.theme_id = b.theme_id || null;
    if (!Object.keys(patch).length) return badRequest("Nothing to update");
    if (!patch.title && !obj.title) return badRequest("Title cannot be empty");
    const { error } = await c.admin.from("ppe_objectives").update(patch).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit(c.admin, c.userId, id, "updated", `Objective “${obj.title}” edited`, obj.scope_type, obj.scope_ref);
    return NextResponse.json({ ok: true });
  }

  // ── Status transition ──
  const s = obj.status;
  let next: string | null = null;
  if (b.action === "submit" && s === "draft") next = "pending";
  else if (b.action === "publish" && (s === "draft" || s === "pending")) next = "published";
  else if (b.action === "archive" && s === "published") next = "archived";
  else if (b.action === "withdraw" && s === "pending") next = "draft";
  else return badRequest(`Cannot ${b.action ?? "transition"} an objective that is ${s}`);

  const { error } = await c.admin.from("ppe_objectives").update({ status: next }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Submitting materialises an approval into the governance queue (dedup: don't stack pending ones).
  if (b.action === "submit") {
    const { data: open } = await c.admin.from("ppe_approvals").select("id").eq("entity_type", "objective").eq("entity_id", id).eq("state", "pending").maybeSingle();
    if (!open) await c.admin.from("ppe_approvals").insert({ entity_type: "objective", entity_id: id, entity_title: obj.title, scope_type: obj.scope_type, scope_ref: obj.scope_ref, workflow: "standard", step: 1, total_steps: 1, state: "pending", requested_by: c.userId }).then((r: any) => r, () => {});
  }
  const verb = b.action === "submit" ? "submitted for approval" : b.action === "publish" ? "published" : b.action === "archive" ? "archived" : "withdrawn to draft";
  await audit(c.admin, c.userId, id, b.action, `Objective “${obj.title}” ${verb}`, obj.scope_type, obj.scope_ref);
  return NextResponse.json({ ok: true, status: next });
}
