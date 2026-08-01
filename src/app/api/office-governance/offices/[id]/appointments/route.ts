import { NextResponse } from "next/server";
import { getCaller, isResponse, isAdmin, isSuper, forbidden, badRequest, assertProfileScope } from "@/lib/api-auth";
import { APPOINTMENT_ROLES } from "@/lib/ogs/lifecycle";

// OGS write-workflow — office appointments (appoint / remove members). POST appoints a person to an office
// role (authority ≠ membership: appointing does not grant technical admin). DELETE soft-removes an
// appointment. Admin-tier, tenant-scoped, audit-logged.
/* eslint-disable @typescript-eslint/no-explicit-any */

const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migrations 116/117 to enable the office model" }, { status: 409 }) : null;
const today = () => new Date().toISOString().slice(0, 10);

async function loadOfficeInScope(c: any, id: string) {
  const { data: office, error } = await c.admin.from("ogs_offices").select("id, chair_id, hospital_id").eq("id", id).maybeSingle();
  if (error) return { resp: migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!office) return { resp: NextResponse.json({ error: "Office not found" }, { status: 404 }) };
  if (!isSuper(c) && office.hospital_id && office.hospital_id !== c.hospitalId) return { resp: forbidden("Office out of scope") };
  return { office };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden("Appointing requires admin authority");
  const id = (await params).id;
  const { office, resp } = await loadOfficeInScope(c, id);
  if (resp) return resp;

  const b = await req.json().catch(() => ({}));
  const personId = typeof b.person_id === "string" ? b.person_id : "";
  if (!personId) return badRequest("person_id required");
  const role = APPOINTMENT_ROLES.includes(b.role) ? b.role : "member";
  const scope = await assertProfileScope(c, personId);
  if (scope) return scope;

  const { data: person } = await c.admin.from("profiles").select("full_name").eq("id", personId).maybeSingle();
  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const actor = me?.full_name ?? null;

  // One live appointment per person+office: update the role if they already hold one, else insert.
  const { data: existing } = await c.admin.from("ogs_office_appointments").select("id").eq("office_id", id).eq("person_id", personId).eq("status", "active").maybeSingle();
  let apptId: string;
  if (existing) {
    await c.admin.from("ogs_office_appointments").update({ role, term_end: b.term_end ?? null }).eq("id", existing.id);
    apptId = existing.id;
  } else {
    const { data: ins, error } = await c.admin.from("ogs_office_appointments").insert({ office_id: id, person_id: personId, person_name: person?.full_name ?? null, role, term_start: today(), term_end: b.term_end ?? null, status: "active", appointed_by: actor }).select("id").single();
    if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
    apptId = ins.id;
  }
  if (role === "chair") await c.admin.from("ogs_offices").update({ chair_id: personId, chair_name: person?.full_name ?? null }).eq("id", id);

  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, actor_name: actor, action: `appoint_${role}`, entity_type: "ogs_office", entity_id: id, hospital_id: office.hospital_id ?? null, new_value: { person: person?.full_name ?? personId, role } });
  return NextResponse.json({ id: apptId, role }, { status: 201 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden("Removing an appointment requires admin authority");
  const id = (await params).id;
  const { office, resp } = await loadOfficeInScope(c, id);
  if (resp) return resp;

  const apptId = new URL(req.url).searchParams.get("appointment");
  if (!apptId) return badRequest("appointment id required");
  const { data: appt } = await c.admin.from("ogs_office_appointments").select("id, office_id, person_id, role").eq("id", apptId).maybeSingle();
  if (!appt || appt.office_id !== id) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });

  await c.admin.from("ogs_office_appointments").update({ status: "removed" }).eq("id", apptId);
  if (appt.role === "chair" && office.chair_id === appt.person_id) await c.admin.from("ogs_offices").update({ chair_id: null, chair_name: null }).eq("id", id);

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, actor_name: me?.full_name ?? null, action: "remove_appointment", entity_type: "ogs_office", entity_id: id, hospital_id: office.hospital_id ?? null, old_value: { role: appt.role } });
  return NextResponse.json({ ok: true });
}
