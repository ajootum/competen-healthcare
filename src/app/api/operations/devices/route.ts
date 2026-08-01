import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest, isAssignedToPatient } from "@/lib/api-auth";

// Patient devices & lines API (migration 158, HWW-ICU-001 Critical Devices).
// Operational tracker only — insertion documentation stays in the clinical
// record. POST adds a device; PATCH records removal. Access: the assigned
// bedside nurse or staff tier; subject-scoped tenancy; audited.
/* eslint-disable @typescript-eslint/no-explicit-any */

const DEVICE_TYPES = ["central_line", "peripheral_iv", "arterial_line", "urinary_catheter", "ng_tube", "peg_tube", "chest_drain", "wound_drain", "tracheostomy", "ett", "other"];
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 158 to enable the device tracker" }, { status: 409 }) : null;

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const b = await req.json().catch(() => ({}));
  if (!b.patient_id) return badRequest("patient_id required");
  if (!DEVICE_TYPES.includes(b.device_type)) return badRequest(`device_type must be one of: ${DEVICE_TYPES.join(", ")}`);
  const admin = c.admin as any;

  const { data: p } = await admin.from("op_patients").select("id, label, hospital_id").eq("id", b.patient_id).maybeSingle();
  if (!p) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  if (!isSuper(c) && p.hospital_id !== c.hospitalId) return forbidden("Patient out of scope");
  if (!isStaff(c) && !(await isAssignedToPatient(c, b.patient_id))) return forbidden("Not your patient");

  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await admin.from("op_patient_devices").insert({
    hospital_id: p.hospital_id, patient_id: p.id, device_type: b.device_type,
    site: String(b.site ?? "").trim() || null,
    inserted_at: b.inserted_at ?? new Date().toISOString(),
    inserted_by: c.userId, inserted_by_name: me?.full_name ?? null,
    notes: String(b.notes ?? "").trim() || null,
  }).select().single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({ trace_id: c.traceId,
    actor_id: c.userId, actor_name: me?.full_name ?? null, action: "device_recorded",
    entity_type: "op_patient_device", entity_id: data.id, entity_name: `${b.device_type} — ${p.label}`,
    hospital_id: p.hospital_id, new_value: { device_type: b.device_type, site: data.site },
  }).then((x: any) => x, () => {});
  return NextResponse.json({ ok: true, device: data }, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const b = await req.json().catch(() => ({}));
  if (!b.id) return badRequest("id required");
  const admin = c.admin as any;

  const { data: d, error: de } = await admin.from("op_patient_devices").select("id, patient_id, hospital_id, device_type, removed_at").eq("id", b.id).maybeSingle();
  if (de) return migrationGate(de) ?? NextResponse.json({ error: de.message }, { status: 500 });
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && d.hospital_id && d.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  if (!isStaff(c) && !(await isAssignedToPatient(c, d.patient_id))) return forbidden("Not your patient");
  if (d.removed_at) return badRequest("Device already removed");

  const { data, error } = await admin.from("op_patient_devices")
    .update({ removed_at: new Date().toISOString(), removed_by: c.userId }).eq("id", d.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();
  await admin.from("audit_log").insert({ trace_id: c.traceId,
    actor_id: c.userId, actor_name: me?.full_name ?? null, action: "device_removed",
    entity_type: "op_patient_device", entity_id: d.id, hospital_id: d.hospital_id,
    new_value: { device_type: d.device_type },
  }).then((x: any) => x, () => {});
  return NextResponse.json({ ok: true, device: data });
}
