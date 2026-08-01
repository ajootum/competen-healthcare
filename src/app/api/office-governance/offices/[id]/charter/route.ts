import { NextResponse } from "next/server";
import { getCaller, isResponse, isAdmin, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// OGS write-workflow — amend an office charter (OGS-001). POST creates a new charter version, supersedes the
// prior versions and points the office at the new version + review date. Admin-tier, tenant-scoped, audit-logged.
/* eslint-disable @typescript-eslint/no-explicit-any */

const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migrations 116/117 to enable the office model" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
const today = () => new Date().toISOString().slice(0, 10);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden("Amending a charter requires admin authority");
  const id = (await params).id;

  const { data: office, error: oErr } = await c.admin.from("ogs_offices").select("id, hospital_id, charter_version").eq("id", id).maybeSingle();
  if (oErr) return migrationGate(oErr) ?? NextResponse.json({ error: oErr.message }, { status: 500 });
  if (!office) return NextResponse.json({ error: "Office not found" }, { status: 404 });
  if (!isSuper(c) && office.hospital_id && office.hospital_id !== c.hospitalId) return forbidden("Office out of scope");

  const b = await req.json().catch(() => ({}));
  const version = clean(b.version);
  if (!version) return badRequest("Charter version required (e.g. v1.1)");
  const approvalStatus = ["draft", "pending", "approved"].includes(b.approval_status) ? b.approval_status : "approved";
  const reviewDate = clean(b.review_date);

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const actor = me?.full_name ?? null;

  // Supersede prior versions, then record the new one.
  await c.admin.from("ogs_office_charters").update({ approval_status: "superseded" }).eq("office_id", id).neq("approval_status", "superseded");
  const { data: charter, error } = await c.admin.from("ogs_office_charters").insert({
    office_id: id, version, purpose: clean(b.purpose), mandate: clean(b.mandate),
    quorum_rule: clean(b.quorum_rule), decision_rule: clean(b.decision_rule),
    effective_from: clean(b.effective_from) ?? today(), review_date: reviewDate,
    approved_by: actor, approval_status: approvalStatus,
  }).select("id, version").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  const officeUpdate: any = { charter_version: version };
  if (reviewDate) officeUpdate.next_review_date = reviewDate;
  await c.admin.from("ogs_offices").update(officeUpdate).eq("id", id);

  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, actor_name: actor, action: "amend_charter", entity_type: "ogs_office", entity_id: id, hospital_id: office.hospital_id ?? null, old_value: { charter_version: office.charter_version }, new_value: { charter_version: version, approval_status: approvalStatus } });
  return NextResponse.json(charter, { status: 201 });
}
