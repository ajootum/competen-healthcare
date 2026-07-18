import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { notify } from "@/lib/notify";

// Passport Centre "Request Evidence" action: notifies the clinician to upload
// supporting evidence to their logbook. Assessor roles only; audit-logged.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Only assessor roles can request evidence" }, { status: 403 });
  }

  const { nurse_id, note } = await req.json().catch(() => ({}));
  if (!nurse_id) return NextResponse.json({ error: "nurse_id is required" }, { status: 400 });
  const { data: nurse } = await admin.from("profiles").select("id, full_name, hospital_id").eq("id", nurse_id).single();
  if (!nurse) return NextResponse.json({ error: "Clinician not found" }, { status: 404 });
  if (me?.hospital_id && nurse.hospital_id !== me.hospital_id && !roles.includes("super_admin")) {
    return NextResponse.json({ error: "You can only request evidence from clinicians in your hospital" }, { status: 403 });
  }

  await admin.from("audit_log").insert({
    actor_id: user.id, actor_name: me?.full_name ?? null,
    action: "request_passport_evidence", entity_type: "profile", entity_id: nurse_id, entity_name: nurse.full_name,
  });
  await notify([nurse_id], {
    type: "evidence_requested",
    title: "Evidence requested for your passport",
    body: `${me?.full_name ?? "An assessor"} asked you to log and evidence recent practice${note?.trim() ? ` — “${note.trim()}”` : ""}. Add entries with photos or documents in your Skills Logbook.`,
    href: "/dashboard/logbook",
  });
  return NextResponse.json({ ok: true });
}
