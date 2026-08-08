import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { getChecklist, updateChecklist } from "@/lib/practice/checklist";
import { CHECKLIST_CAPABILITIES } from "@/lib/practice/checklist-constants";

// GET   /api/v1/practice/checklists/[id] -- the checklist, its items, its readiness, its completion records.
// PATCH /api/v1/practice/checklists/[id] -- edit a draft, including the whole item list.
//
// ⚠ THE ITEM LIST IS SENT WHOLE OR NOT AT ALL. `items` absent means "leave the list alone"; `items: []`
// means "this checklist has no items", which is a thing somebody may legitimately want on the way to
// rebuilding it. The two are different and the engine treats them differently -- a PATCH that could not
// tell them apart would empty a list every time somebody renamed a checklist.

export async function GET(_req: NextRequest, ctx: { params: Promise<{ checklistId: string }> }) {
  const auth = await requirePracticeContext(CHECKLIST_CAPABILITIES.view);
  if (isDenied(auth)) return auth;

  const { checklistId } = await ctx.params;
  const detail = await getChecklist(auth.caller.admin, auth.ctx.workspaceId, checklistId);
  if (detail.state === "not_found")
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });

  return NextResponse.json({ detail, correlationId: auth.caller.traceId });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ checklistId: string }> }) {
  const auth = await requirePracticeContext(CHECKLIST_CAPABILITIES.manage);
  if (isDenied(auth)) return auth;

  const { checklistId } = await ctx.params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await updateChecklist(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    checklistId,
    title: body.title !== undefined ? String(body.title) : undefined,
    purpose: body.purpose !== undefined ? (body.purpose ? String(body.purpose) : null) : undefined,
    specialty: body.specialty !== undefined ? (body.specialty ? String(body.specialty) : null) : undefined,
    tags: body.tags,
    ownerId: body.ownerId !== undefined ? (body.ownerId ? String(body.ownerId) : null) : undefined,
    runSubject: body.runSubject !== undefined ? String(body.runSubject) : undefined,
    effectiveFrom: body.effectiveFrom !== undefined ? (body.effectiveFrom ? String(body.effectiveFrom) : null) : undefined,
    reviewOn: body.reviewOn !== undefined ? (body.reviewOn ? String(body.reviewOn) : null) : undefined,
    items: Array.isArray(body.items)
      ? (body.items as Record<string, unknown>[]).map(i => ({
          itemKey: String(i.itemKey ?? ""),
          label: String(i.label ?? ""),
          section: i.section ? String(i.section) : null,
          detail: i.detail ? String(i.detail) : null,
          required: i.required !== false,
          isCritical: i.isCritical === true,
          condition: i.condition ?? null,
        }))
      : undefined,
    actorId: auth.ctx.userId,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
