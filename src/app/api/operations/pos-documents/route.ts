import { NextResponse } from "next/server";
import { getCaller, isResponse, hasRole, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { docTemplateByKey, generateDocContent } from "@/lib/operations/doc-templates";
import { loadPatientOps } from "@/lib/operations/patient-ops";

// Operational Documentation API (POS-109). Generate a document from the live operational dataset,
// sign it (electronic signature §6) or supersede it with a fresh version (immutable history §3.2).
//   POST action=generate  { template_key, patient_id } → build content snapshot, insert draft
//   POST action=sign      { id }                       → finalise + sign (immutable thereafter)
//   POST action=supersede { id }                       → regenerate a new version, mark old superseded
// Manager-gated, tenant-scoped, audited. No PHI — operational labels only.
/* eslint-disable @typescript-eslint/no-explicit-any */

async function buildContent(admin: any, hid: string | null, isSuperCaller: boolean, templateKey: string, patientId: string) {
  const po: any = await loadPatientOps(admin, hid, isSuperCaller);
  if (!po.ready) return { error: "operational data not available" as const };
  const pt = po.patients.find((p: any) => p.id === patientId);
  if (!pt) return { error: "patient not found on the operational register" as const };
  // Latest submitted forms for this patient (payloads) so documents reflect what was recorded.
  const scope = (q: any) => (isSuperCaller ? q : q.eq("hospital_id", hid ?? "00000000-0000-0000-0000-000000000000"));
  const fRes = await scope(admin.from("op_form_instances").select("template_key, payload, created_at").eq("patient_id", patientId).in("state", ["submitted", "awaiting_verification", "verified", "finalised"]).order("created_at", { ascending: false }).limit(50));
  const forms = (fRes as any).error ? [] : (fRes.data ?? []);
  return { pt, content: generateDocContent(templateKey, pt, { forms }) };
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!hasRole(c, "hospital_admin", "super_admin")) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  const now = new Date().toISOString();

  if (b.action === "generate") {
    const tpl = docTemplateByKey(b.template_key);
    if (!tpl) return badRequest("valid template_key required");
    if (!b.patient_id) return badRequest("patient_id required");
    const { data: pat } = await admin.from("op_patients").select("hospital_id, department_id, label").eq("id", b.patient_id).maybeSingle();
    if (!pat) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    if (!isSuper(c) && pat.hospital_id !== c.hospitalId) return forbidden("Out of scope");
    const built = await buildContent(admin, pat.hospital_id, isSuper(c), tpl.key, b.patient_id);
    if ("error" in built) return badRequest(built.error);
    const { data, error } = await admin.from("op_documents").insert({
      hospital_id: pat.hospital_id, department_id: pat.department_id ?? null, patient_id: b.patient_id,
      template_key: tpl.key, doc_type: tpl.docType, title: `${tpl.name} — ${pat.label}`,
      content: built.content, status: "draft", version: 1, generated_by: c.userId,
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({ actor_id: c.userId, action: "generate_pos_document", entity_type: "op_document", entity_id: data.id, hospital_id: pat.hospital_id, new_value: { template: tpl.key } });
    return NextResponse.json(data, { status: 201 });
  }

  if (b.action === "sign") {
    if (!b.id) return badRequest("id required");
    const { data: doc } = await admin.from("op_documents").select("*").eq("id", b.id).maybeSingle();
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!isSuper(c) && doc.hospital_id !== c.hospitalId) return forbidden("Out of scope");
    if (doc.status === "signed") return badRequest("Document already signed");
    if (doc.status === "superseded") return badRequest("Superseded document cannot be signed");
    const { data, error } = await admin.from("op_documents").update({ status: "signed", signed_by: c.userId, signed_at: now, updated_at: now }).eq("id", b.id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({ actor_id: c.userId, action: "sign_pos_document", entity_type: "op_document", entity_id: b.id, hospital_id: doc.hospital_id, new_value: { template: doc.template_key } });
    return NextResponse.json(data);
  }

  if (b.action === "supersede") {
    if (!b.id) return badRequest("id required");
    const { data: doc } = await admin.from("op_documents").select("*").eq("id", b.id).maybeSingle();
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!isSuper(c) && doc.hospital_id !== c.hospitalId) return forbidden("Out of scope");
    if (!doc.patient_id) return badRequest("Cannot regenerate a document without a patient");
    const built = await buildContent(admin, doc.hospital_id, isSuper(c), doc.template_key, doc.patient_id);
    if ("error" in built) return badRequest(built.error);
    const { data: fresh, error } = await admin.from("op_documents").insert({
      hospital_id: doc.hospital_id, department_id: doc.department_id, patient_id: doc.patient_id,
      template_key: doc.template_key, doc_type: doc.doc_type, title: doc.title,
      content: built.content, status: "draft", version: (doc.version ?? 1) + 1, supersedes_id: doc.id, generated_by: c.userId,
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("op_documents").update({ status: "superseded", updated_at: now }).eq("id", doc.id);
    await admin.from("audit_log").insert({ actor_id: c.userId, action: "supersede_pos_document", entity_type: "op_document", entity_id: fresh.id, hospital_id: doc.hospital_id, new_value: { supersedes: doc.id, version: fresh.version } });
    return NextResponse.json(fresh, { status: 201 });
  }

  return badRequest("valid action required (generate|sign|supersede)");
}
