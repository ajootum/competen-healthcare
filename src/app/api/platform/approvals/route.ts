import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { submitApproval, decide, workflowDef } from "@/lib/platform/approvals";

// POS-001D approval engine API. POST → open an approval request against a
// workflow. PATCH ?id=&source=approval|change_request → approve/reject. Super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!workflowDef(b.workflow_key)) return badRequest("Unknown workflow_key");
  const { data: me } = await (c.admin as any).from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
  const r = await submitApproval(c.admin as any, { workflowKey: b.workflow_key, entityName: typeof b.entity_name === "string" ? b.entity_name.slice(0, 160) : null, entityId: b.entity_id ?? null, payload: b.payload ?? null, requestedBy: c.userId, requestedByName: me?.full_name ?? null });
  if (!r.ok && r.error === "migration_required") return NextResponse.json({ error: "Run migration 057 to enable the approval engine" }, { status: 409 });
  return NextResponse.json(r, { status: r.ok ? 201 : 400 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const source = url.searchParams.get("source") === "change_request" ? "change_request" : "approval";
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  if (b.decision !== "approved" && b.decision !== "rejected") return badRequest("decision must be approved|rejected");
  const { data: me } = await (c.admin as any).from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
  const r = await decide(c.admin as any, { source, requestId: id, decision: b.decision, actorId: c.userId, actorName: me?.full_name ?? null, note: typeof b.note === "string" ? b.note.slice(0, 500) : null });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
