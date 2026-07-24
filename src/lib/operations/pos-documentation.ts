// Operational Documentation loader (POS-109). Recent generated documents (op_documents, migration
// 085), status counts and the active-patient list for the generate picker. Fail-soft: pre-migration
// the store reports provisioned:false and the page degrades to an honest state.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => !!e && /does not exist|schema cache/i.test(e.message ?? "");

export async function loadDocumentation(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  let provisioned = true;
  let documents: any[] = [];
  const dRes = await scope(admin.from("op_documents")
    .select("id, template_key, doc_type, title, content, status, version, created_at, signed_at, patient_id, op_patients!patient_id(label), gen:profiles!generated_by(full_name), signer:profiles!signed_by(full_name)")
    .order("created_at", { ascending: false }).limit(60));
  if ((dRes as any).error) { provisioned = !missing((dRes as any).error); documents = []; }
  else documents = (dRes.data ?? []) as any[];

  // Active patients for the generate picker.
  let patients: any[] = [];
  const pRes = await scope(admin.from("op_patients").select("id, label, op_beds!bed_id(label)")
    .neq("operational_status", "discharged").order("created_at", { ascending: false }).limit(300));
  if (!(pRes as any).error) patients = (pRes.data ?? []).map((p: any) => ({ id: p.id, label: `${p.op_beds?.label ? p.op_beds.label + " · " : ""}${p.label}` }));

  const counts = {
    total: documents.length,
    signed: documents.filter(d => d.status === "signed").length,
    draft: documents.filter(d => d.status === "draft").length,
  };

  return { provisioned, documents, patients, counts };
}
