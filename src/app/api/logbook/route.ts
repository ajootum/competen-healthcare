import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { notify, hospitalVerifierIds } from "@/lib/notify";

// Skills Logbook API (Skills Logbook Redesign spec).
// POST — a worker logs a skill they performed (status: pending).
// PATCH — an assessor/educator/admin verifies, rejects or requests changes.
// Both actions are audit-logged.

const SUPERVISION = new Set(["observed", "assisted", "supervised", "independent"]);
const VERDICTS = new Set(["verified", "rejected", "changes_requested"]);

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { skill_id, skill_name, competency_id, cpu_id, performed_at, location, supervision_level, notes } = await req.json();
  if (!skill_name?.trim() || !SUPERVISION.has(supervision_level)) {
    return NextResponse.json({ error: "skill_name and a valid supervision_level are required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.from("skill_log_entries").insert({
    nurse_id: user.id,
    skill_id: skill_id || null,
    skill_name: skill_name.trim(),
    competency_id: competency_id || null,
    cpu_id: cpu_id || null,
    performed_at: performed_at || undefined,
    location: location?.trim() || null,
    supervision_level,
    notes: notes?.trim() || null,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: me } = await admin.from("profiles").select("full_name, hospital_id").eq("id", user.id).single();
  await admin.from("audit_log").insert({
    actor_id: user.id, actor_name: me?.full_name ?? null,
    action: "log_skill", entity_type: "skill_log_entry", entity_id: data.id, entity_name: skill_name.trim(),
  });

  await notify(await hospitalVerifierIds(me?.hospital_id ?? null, user.id), {
    type: "logbook_pending",
    title: "Skill log entry awaiting verification",
    body: `${me?.full_name ?? "A colleague"} logged "${skill_name.trim()}"`,
    href: "/assessor/logbook",
  });

  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles, full_name").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Only assessors, educators or admins can verify entries" }, { status: 403 });
  }

  const { id, status, comment } = await req.json();
  if (!id || !VERDICTS.has(status)) {
    return NextResponse.json({ error: "id and a valid status are required" }, { status: 400 });
  }

  const { data: entry } = await admin.from("skill_log_entries").select("id, nurse_id, skill_name").eq("id", id).single();
  if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  if (entry.nurse_id === user.id) {
    return NextResponse.json({ error: "You cannot verify your own logbook entry" }, { status: 400 });
  }

  const { error } = await admin.from("skill_log_entries").update({
    status,
    verified_by: user.id,
    verified_by_name: me?.full_name ?? null,
    verified_at: new Date().toISOString(),
    verifier_comment: comment?.trim() || null,
  }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    actor_id: user.id, actor_name: me?.full_name ?? null,
    action: status === "verified" ? "verify_skill_entry" : status === "rejected" ? "reject_skill_entry" : "request_skill_entry_changes",
    entity_type: "skill_log_entry", entity_id: id, entity_name: entry.skill_name,
  });

  const verdict = status === "verified" ? "verified" : status === "rejected" ? "rejected" : "returned with change requests";
  await notify([entry.nurse_id], {
    type: `logbook_${status}`,
    title: `Skill log ${verdict}`,
    body: `"${entry.skill_name}" was ${verdict} by ${me?.full_name ?? "a verifier"}${comment?.trim() ? ` — “${comment.trim()}”` : ""}`,
    href: "/dashboard/logbook",
  });

  return NextResponse.json({ ok: true });
}
