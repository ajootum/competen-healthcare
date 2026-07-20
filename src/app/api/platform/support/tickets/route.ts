/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getLandlordCaller, landlordCan, landlordAudit } from "@/lib/platform/landlord";

// Support tickets (SUP-001). POST creates; PATCH updates status.
const STATUSES = ["open", "pending", "resolved", "closed"];
const PRIORITIES = ["low", "normal", "high", "urgent"];

export async function POST(req: Request) {
  const caller = await getLandlordCaller();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!landlordCan(caller, "platform_operations", "platform_super_admin", "support", "customer_success")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  if (!b?.subject?.trim()) return NextResponse.json({ error: "subject is required" }, { status: 400 });
  const priority = PRIORITIES.includes(b.priority) ? b.priority : "normal";

  const { data, error } = await caller.admin.from("plat_support_tickets").insert({
    tenant_id: b.tenantId || null, subject: String(b.subject).trim(), body: b.body ? String(b.body) : null,
    priority, requester_name: b.requesterName ? String(b.requesterName) : null, created_by: caller.userId,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await landlordAudit(caller.admin, caller, { action: "support_ticket_created", entity_type: "support_ticket", entity_id: data.id, entity_name: b.subject, tenant_id: b.tenantId || null });
  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(req: Request) {
  const caller = await getLandlordCaller();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!landlordCan(caller, "platform_operations", "platform_super_admin", "support", "customer_success")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  if (!b?.id || !STATUSES.includes(b.status)) return NextResponse.json({ error: "id and valid status required" }, { status: 400 });

  const { error } = await caller.admin.from("plat_support_tickets").update({ status: b.status, updated_at: new Date().toISOString() }).eq("id", b.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
