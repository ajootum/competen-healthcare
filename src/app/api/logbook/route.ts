import { NextResponse } from "next/server";
import { notify, hospitalVerifierIds } from "@/lib/notify";
import { getCaller, isResponse, assertProfileScope } from "@/lib/api-auth";

// Skills Logbook API (Skills Logbook Redesign spec).
// POST — a worker logs a skill they performed (status: pending).
// PATCH — an assessor/educator/admin verifies, rejects or requests changes.
// Both actions are audit-logged.

const SUPERVISION = new Set(["observed", "assisted", "supervised", "independent"]);
const VERDICTS = new Set(["verified", "rejected", "changes_requested", "escalated"]);

export async function POST(req: Request) {
  // Any authenticated clinician may log their OWN skill (self-log).
  const c = await getCaller();
  if (isResponse(c)) return c;
  const admin = c.admin;

  const { skill_id, skill_name, competency_id, cpu_id, performed_at, location, supervision_level, notes } = await req.json();
  if (!skill_name?.trim() || !SUPERVISION.has(supervision_level)) {
    return NextResponse.json({ error: "skill_name and a valid supervision_level are required" }, { status: 400 });
  }

  const { data, error } = await admin.from("skill_log_entries").insert({
    nurse_id: c.userId,
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

  const { data: me } = await admin.from("profiles").select("full_name, hospital_id").eq("id", c.userId).single();
  await admin.from("audit_log").insert({
    actor_id: c.userId, actor_name: me?.full_name ?? null,
    action: "log_skill", entity_type: "skill_log_entry", entity_id: data.id, entity_name: skill_name.trim(),
  });

  await notify(await hospitalVerifierIds(me?.hospital_id ?? c.hospitalId ?? null, c.userId), {
    type: "logbook_pending",
    title: "Skill log entry awaiting verification",
    body: `${me?.full_name ?? "A colleague"} logged "${skill_name.trim()}"`,
    href: "/assessor/logbook",
  });

  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const admin = c.admin;

  const roles = c.roles;
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Only assessors, educators or admins can verify entries" }, { status: 403 });
  }
  const { data: me } = await admin.from("profiles")
    .select("full_name, hospital_id, is_senior_assessor").eq("id", c.userId).single();
  const isSenior = !!me?.is_senior_assessor || roles.some(r => ["hospital_admin", "super_admin"].includes(r));

  const { id, status, comment } = await req.json();
  if (!id || !VERDICTS.has(status)) {
    return NextResponse.json({ error: "id and a valid status are required" }, { status: 400 });
  }
  const { data: entry } = await admin.from("skill_log_entries").select("id, nurse_id, skill_name, status").eq("id", id).single();
  if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  // A verifier may only act on entries for a learner in their own hospital
  // (skill_log_entries has no hospital_id — scope via the learner's profile).
  const scopeErr = await assertProfileScope(c, entry.nurse_id);
  if (scopeErr) return scopeErr;
  if (entry.nurse_id === c.userId) {
    return NextResponse.json({ error: "You cannot verify your own logbook entry" }, { status: 400 });
  }

  // Escalation to a senior assessor (spec: Escalate to Senior Assessor)
  if (status === "escalated") {
    if (!["pending", "changes_requested"].includes(entry.status)) {
      return NextResponse.json({ error: "Only open entries can be escalated" }, { status: 400 });
    }
    const { error: escErr } = await admin.from("skill_log_entries").update({
      status: "escalated",
      escalated_by: c.userId,
      escalated_by_name: me?.full_name ?? null,
      escalated_at: new Date().toISOString(),
      escalation_reason: comment?.trim() || null,
    }).eq("id", id);
    if (escErr) return NextResponse.json({ error: escErr.message }, { status: 500 });

    await admin.from("audit_log").insert({
      actor_id: c.userId, actor_name: me?.full_name ?? null,
      action: "escalate_skill_entry", entity_type: "skill_log_entry", entity_id: id, entity_name: entry.skill_name,
    });
    // Notify the hospital's senior assessors
    const { data: seniors } = await admin.from("profiles").select("id")
      .eq("hospital_id", me?.hospital_id ?? "").eq("is_senior_assessor", true).neq("id", c.userId).limit(20);
    await notify((seniors ?? []).map(s => s.id), {
      type: "logbook_escalated",
      title: "Evidence escalated for senior review",
      body: `${me?.full_name ?? "An assessor"} escalated "${entry.skill_name}"${comment?.trim() ? ` — “${comment.trim()}”` : ""}`,
      href: "/assessor/logbook",
    });
    return NextResponse.json({ ok: true });
  }

  // Escalated entries can only be decided by senior assessors or admins
  if (entry.status === "escalated" && !isSenior) {
    return NextResponse.json({ error: "This entry is escalated — only a senior assessor can decide it" }, { status: 403 });
  }

  const { error } = await admin.from("skill_log_entries").update({
    status,
    verified_by: c.userId,
    verified_by_name: me?.full_name ?? null,
    verified_at: new Date().toISOString(),
    verifier_comment: comment?.trim() || null,
  }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    actor_id: c.userId, actor_name: me?.full_name ?? null,
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
