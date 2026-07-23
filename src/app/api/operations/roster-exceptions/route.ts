import { NextResponse } from "next/server";
import { getCaller, isResponse, hasRole, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Roster Governance exceptions (UMW-WFM-004 §14) — persist a detected roster exception and
// progress its lifecycle in op_roster_exceptions (migration 082). A controlled override records
// a reason and never silently changes the rule (§14.7). Manager gate (hospital_admin/super_admin);
// audited.
/* eslint-disable @typescript-eslint/no-explicit-any */

const ACTIONS: Record<string, string> = { review: "under_review", propose: "correction_proposed", await_approval: "awaiting_approval", resolve: "resolved", override: "accepted_with_mitigation", reject: "rejected", reopen: "reopened" };

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!hasRole(c, "hospital_admin", "super_admin")) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  if (!b.roster_id || !b.category) return badRequest("roster_id and category required");
  const { data: roster } = await admin.from("op_rosters").select("hospital_id").eq("id", b.roster_id).maybeSingle();
  if (!roster) return NextResponse.json({ error: "Roster not found" }, { status: 404 });
  if (!isSuper(c) && roster.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { data, error } = await admin.from("op_roster_exceptions").insert({
    hospital_id: roster.hospital_id, roster_id: b.roster_id, category: b.category,
    severity: b.severity || "moderate", status: "detected", description: b.description || null,
    unit_name: b.unit_name || null, staff_name: b.staff_name || null, proposed_resolution: b.resolution || null,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "record_roster_exception", entity_type: "op_roster_exception", entity_id: data.id, hospital_id: roster.hospital_id, new_value: { category: b.category, severity: b.severity } });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!hasRole(c, "hospital_admin", "super_admin")) return forbidden();
  const admin = c.admin as any;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  const status = ACTIONS[b.action];
  if (!status) return badRequest("valid action required");
  if (b.action === "override" && !b.override_reason) return badRequest("override_reason required to override");
  const { data: row } = await admin.from("op_roster_exceptions").select("hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const patch: any = { status };
  if (b.action === "override") { patch.override_required = true; patch.override_reason = b.override_reason; patch.override_risk = b.override_risk || null; }
  if (b.resolution_evidence) patch.resolution_evidence = b.resolution_evidence;
  if (["resolved", "rejected", "accepted_with_mitigation"].includes(status)) { patch.resolved_by = c.userId; patch.resolved_at = new Date().toISOString(); }
  const { data, error } = await admin.from("op_roster_exceptions").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "record_roster_exception", entity_type: "op_roster_exception", entity_id: id, hospital_id: row.hospital_id, new_value: { action: b.action } });
  return NextResponse.json(data);
}
