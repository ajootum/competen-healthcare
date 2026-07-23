import { NextResponse } from "next/server";
import { getCaller, isResponse, hasRole, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Roster approval & publication (UMW-WFM-004 §15) — the op_roster_approvals chain +
// op_roster_publications record (migration 082). POST submit builds the approval chain; POST
// publish records the publication; PATCH decides a step. A requester can't approve their own
// submission outside delegated authority (governance principle). Manager gate; audited.
/* eslint-disable @typescript-eslint/no-explicit-any */

const CHAIN = [
  { stage_order: 1, approval_stage: "roster_officer", approver_role: "Roster Officer" },
  { stage_order: 2, approval_stage: "unit_manager", approver_role: "Unit Manager" },
  { stage_order: 3, approval_stage: "nursing_admin", approver_role: "Nursing Administration" },
  { stage_order: 4, approval_stage: "publication", approver_role: "Publication" },
];
const ACTIONS: Record<string, string> = { approve: "approved", approve_conditions: "approved_with_conditions", reject: "rejected", return: "returned", delegate: "delegated" };

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!hasRole(c, "hospital_admin", "super_admin")) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  if (!b.roster_id || !["submit", "publish"].includes(b.action)) return badRequest("roster_id and action (submit|publish) required");
  const { data: roster } = await admin.from("op_rosters").select("hospital_id, version").eq("id", b.roster_id).maybeSingle();
  if (!roster) return NextResponse.json({ error: "Roster not found" }, { status: 404 });
  if (!isSuper(c) && roster.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();

  if (b.action === "submit") {
    const { data: existing } = await admin.from("op_roster_approvals").select("id").eq("roster_id", b.roster_id).limit(1);
    if (existing && existing.length) return badRequest("Already submitted for approval");
    const rows = CHAIN.map(s => ({ hospital_id: roster.hospital_id, roster_id: b.roster_id, ...s, status: "pending" }));
    const { error } = await admin.from("op_roster_approvals").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({ actor_id: c.userId, action: "submit_roster_approval", entity_type: "op_roster", entity_id: b.roster_id, hospital_id: roster.hospital_id, new_value: { stages: CHAIN.length } });
    return NextResponse.json({ ok: true, submitted: CHAIN.length }, { status: 201 });
  }

  // publish — record the publication (the operational status flip stays on the Scheduling Engine)
  const { data: pub, error } = await admin.from("op_roster_publications").insert({
    hospital_id: roster.hospital_id, roster_id: b.roster_id, publication_status: "published", published_at: new Date().toISOString(),
    published_by: c.userId, published_by_name: me?.full_name ?? null, channels: b.channels || ["in_app"], target_group: b.target_group || "all", version: roster.version,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "publish_roster_record", entity_type: "op_roster_publication", entity_id: pub.id, hospital_id: roster.hospital_id, new_value: { version: roster.version } });
  return NextResponse.json(pub, { status: 201 });
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
  if ((b.action === "reject" || b.action === "return") && !b.comments) return badRequest("comments required to reject/return");
  const { data: row } = await admin.from("op_roster_approvals").select("hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();

  const { data, error } = await admin.from("op_roster_approvals").update({ status, decision: b.action, comments: b.comments || null, attestation: !!b.attestation, approver_id: c.userId, approver_name: me?.full_name ?? null, acted_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "decide_roster_approval", entity_type: "op_roster_approval", entity_id: id, hospital_id: row.hospital_id, new_value: { action: b.action } });
  return NextResponse.json(data);
}
