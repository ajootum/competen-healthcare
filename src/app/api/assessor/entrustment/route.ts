import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { ENTRUSTMENT_LABELS } from "@/lib/ckcm";

// Records the assessor's final entrustment decision ("The Assessor Role" §16-17):
// one meaningful judgement, backed by the evidence underneath. Creates a
// clinical authorization at the chosen level (or a restriction record).

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, full_name, hospital_id").eq("id", user.id).single();
  if (!["assessor", "educator", "hospital_admin", "super_admin"].includes(profile?.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { nurse_id, cpu_id, entrustment_level, rationale } = await req.json();
  if (!nurse_id || !cpu_id || !entrustment_level) {
    return NextResponse.json({ error: "nurse_id, cpu_id and entrustment_level required" }, { status: 400 });
  }
  if (!ENTRUSTMENT_LABELS[entrustment_level]) {
    return NextResponse.json({ error: "invalid entrustment_level" }, { status: 400 });
  }

  const { data: cpu } = await admin.from("clinical_practice_units")
    .select("name, code, reassessment_months").eq("id", cpu_id).single();
  if (!cpu) return NextResponse.json({ error: "CPU not found" }, { status: 404 });

  // Scope matching (User Account Architecture §17): if this assessor holds any
  // active authorizations, the decision must fall within them.
  const { data: scopes, error: scopeErr } = await admin
    .from("assessor_authorizations")
    .select("cpu_id, hospital_id, valid_until")
    .eq("user_id", user.id).eq("status", "active");
  if (!scopeErr && scopes && scopes.length > 0) {
    const now = Date.now();
    const covered = scopes.some(s =>
      (!s.valid_until || new Date(s.valid_until).getTime() >= now) &&
      (!s.hospital_id || s.hospital_id === (profile?.hospital_id ?? null)) &&
      (!s.cpu_id || s.cpu_id === cpu_id));
    if (!covered) {
      return NextResponse.json({ error: "This CPU is outside your authorized assessment scope" }, { status: 403 });
    }
  }

  const { data: nurse } = await admin.from("profiles").select("hospital_id").eq("id", nurse_id).single();

  const grantsPractice = ["indirect_supervision", "independent", "may_supervise"].includes(entrustment_level);
  const level = entrustment_level === "direct_supervision" || entrustment_level === "not_permitted"
    ? "supervised" : "independent";
  const months = cpu.reassessment_months ?? 12;
  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + months);

  const { data: auth, error } = await admin.from("clinical_authorizations").insert({
    nurse_id,
    hospital_id: nurse?.hospital_id ?? profile?.hospital_id ?? null,
    authorization_type: "clinical_privilege",
    authorization_level: level,
    entrustment_level,
    status: entrustment_level === "not_permitted" ? "suspended" : "active",
    scope: `${cpu.name}${cpu.code ? ` (${cpu.code})` : ""} — ${ENTRUSTMENT_LABELS[entrustment_level]}`,
    conditions: rationale?.trim() || null,
    effective_date: new Date().toISOString().slice(0, 10),
    expiry_date: grantsPractice ? expiry.toISOString().slice(0, 10) : null,
    granted_by: user.id,
    granted_by_name: profile?.full_name ?? null,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("authorization_activities").insert({
    authorization_id: auth.id, cpu_id, label: cpu.name,
  });
  await admin.from("audit_log").insert({
    actor_id: user.id, actor_name: profile?.full_name ?? null,
    action: "entrustment_decision", entity_type: "clinical_authorization", entity_id: auth.id,
    new_value: { nurse_id, cpu: cpu.name, entrustment_level },
  });

  return NextResponse.json(auth, { status: 201 });
}
