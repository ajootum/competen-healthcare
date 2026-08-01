import { NextResponse } from "next/server";
import { getCaller, isResponse, isAdmin, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// OGS write-workflow — digital sign-off (e-sign) on a governance record: a decision, a charter, or a
// meeting's minutes. The caller signs AS THEMSELVES. Authorised to an active office member (appointee) or an
// admin. Idempotent (one signature per record per signer), tenant-scoped, audit-logged.
/* eslint-disable @typescript-eslint/no-explicit-any */

const ENTITY = ["decision", "charter", "minutes"];
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 120 to enable signatures" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;

  const b = await req.json().catch(() => ({}));
  const entityType = ENTITY.includes(b.entity_type) ? b.entity_type : null;
  const entityId = typeof b.entity_id === "string" ? b.entity_id : "";
  if (!entityType || !entityId) return badRequest("entity_type (decision|charter|minutes) and entity_id required");

  // Resolve the owning office + hospital from the signed entity.
  let officeId: string | null = null, hospitalId: string | null = null;
  if (entityType === "decision") {
    const { data, error } = await c.admin.from("ogs_decisions").select("office_id, hospital_id").eq("id", entityId).maybeSingle();
    if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Decision not found" }, { status: 404 });
    officeId = data.office_id; hospitalId = data.hospital_id;
  } else if (entityType === "minutes") {
    const { data, error } = await c.admin.from("ogs_meetings").select("office_id, hospital_id").eq("id", entityId).maybeSingle();
    if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    officeId = data.office_id; hospitalId = data.hospital_id;
  } else {
    const { data, error } = await c.admin.from("ogs_office_charters").select("office_id").eq("id", entityId).maybeSingle();
    if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Charter not found" }, { status: 404 });
    officeId = data.office_id;
    const { data: off } = await c.admin.from("ogs_offices").select("hospital_id").eq("id", officeId).maybeSingle();
    hospitalId = off?.hospital_id ?? null;
  }

  if (!isSuper(c) && hospitalId && hospitalId !== c.hospitalId) return forbidden("Out of scope");

  // Authorise: an active appointee of the office signs in their office role; admins may also sign.
  let signerRole = "administrator";
  const { data: appt } = await c.admin.from("ogs_office_appointments").select("role").eq("office_id", officeId).eq("person_id", c.userId).eq("status", "active").maybeSingle();
  if (appt) signerRole = appt.role;
  else if (!isAdmin(c)) return forbidden("Only office members or admins may sign");

  // Idempotent — one signature per record per signer.
  const { data: existing } = await c.admin.from("ogs_signatures").select("id").eq("entity_type", entityType).eq("entity_id", entityId).eq("signer_id", c.userId).maybeSingle();
  if (existing) return NextResponse.json({ id: existing.id, already: true });

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data: sig, error } = await c.admin.from("ogs_signatures").insert({ entity_type: entityType, entity_id: entityId, office_id: officeId, hospital_id: hospitalId, signer_id: c.userId, signer_name: me?.full_name ?? null, signer_role: signerRole, statement: clean(b.statement) }).select("id").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, actor_name: me?.full_name ?? null, action: `sign_${entityType}`, entity_type: `ogs_${entityType}`, entity_id: entityId, hospital_id: hospitalId, new_value: { signer_role: signerRole } });
  return NextResponse.json(sig, { status: 201 });
}
