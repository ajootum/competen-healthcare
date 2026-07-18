import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { notify } from "@/lib/notify";

// Assessment scheduling (Assessor Workspace redesign). Assessor roles create
// sessions for nurses in their hospital; both sides are notified; the nurse
// sees it via RLS. Completing/cancelling is restricted to the involved
// assessor. All actions audit-logged.

const METHODS = new Set(["direct_observation", "knowledge", "simulation", "osce", "concurrent_audit", "retrospective_audit", "logbook"]);
const ASSESSOR_ROLES = ["assessor", "educator", "hospital_admin", "super_admin"];

async function requireAssessor() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("id, full_name, role, roles, hospital_id").eq("id", user.id).single();
  if (!me) return null;
  const roles: string[] = me.roles?.length ? me.roles : [me.role].filter(Boolean);
  if (!roles.some(r => ASSESSOR_ROLES.includes(r))) return { admin, me, denied: true as const };
  return { admin, me, denied: false as const };
}

export async function POST(req: Request) {
  const auth = await requireAssessor();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.denied) return NextResponse.json({ error: "Only assessor roles can schedule assessments" }, { status: 403 });
  const { admin, me } = auth;

  const { nurse_id, competency_id, method, scheduled_for, location, note } = await req.json().catch(() => ({}));
  if (!nurse_id || !scheduled_for) {
    return NextResponse.json({ error: "nurse_id and scheduled_for are required" }, { status: 400 });
  }
  if (method && !METHODS.has(method)) {
    return NextResponse.json({ error: "Invalid assessment method" }, { status: 400 });
  }
  const when = new Date(scheduled_for);
  if (Number.isNaN(when.getTime())) {
    return NextResponse.json({ error: "scheduled_for must be a valid date/time" }, { status: 400 });
  }

  const { data: nurse } = await admin.from("profiles").select("id, full_name, hospital_id").eq("id", nurse_id).single();
  if (!nurse) return NextResponse.json({ error: "Nurse not found" }, { status: 404 });
  if (me.hospital_id && nurse.hospital_id !== me.hospital_id) {
    return NextResponse.json({ error: "You can only schedule for nurses in your hospital" }, { status: 403 });
  }

  const { data: row, error } = await admin.from("scheduled_assessments").insert({
    hospital_id: nurse.hospital_id ?? me.hospital_id ?? null,
    nurse_id, assessor_id: me.id,
    competency_id: competency_id || null,
    method: method || "direct_observation",
    scheduled_for: when.toISOString(),
    location: location?.trim() || null,
    note: note?.trim() || null,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const whenLabel = when.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  await admin.from("audit_log").insert({
    actor_id: me.id, actor_name: me.full_name ?? null,
    action: "schedule_assessment", entity_type: "scheduled_assessment", entity_id: row.id,
    entity_name: `${nurse.full_name} · ${whenLabel}`,
  });
  await notify([nurse_id], {
    type: "assessment_scheduled",
    title: "Assessment scheduled",
    body: `${me.full_name ?? "Your assessor"} scheduled a ${String(method || "direct observation").replace(/_/g, " ")} assessment for ${whenLabel}`,
    href: "/dashboard/notifications",
  });

  return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
}

export async function PATCH(req: Request) {
  const auth = await requireAssessor();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.denied) return NextResponse.json({ error: "Only assessor roles can manage schedules" }, { status: 403 });
  const { admin, me } = auth;

  const { id, status } = await req.json().catch(() => ({}));
  if (!id || !["completed", "cancelled"].includes(status)) {
    return NextResponse.json({ error: "id and a status of completed or cancelled are required" }, { status: 400 });
  }
  const { data: row } = await admin.from("scheduled_assessments")
    .select("id, assessor_id, nurse_id, scheduled_for, profiles!nurse_id(full_name)").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.assessor_id !== me.id) {
    return NextResponse.json({ error: "Only the scheduling assessor can update this session" }, { status: 403 });
  }

  const { error } = await admin.from("scheduled_assessments").update({ status }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    actor_id: me.id, actor_name: me.full_name ?? null,
    action: status === "cancelled" ? "cancel_scheduled_assessment" : "complete_scheduled_assessment",
    entity_type: "scheduled_assessment", entity_id: id,
    entity_name: (row.profiles as unknown as { full_name: string } | null)?.full_name ?? null,
  });
  if (status === "cancelled") {
    await notify([row.nurse_id], {
      type: "assessment_cancelled",
      title: "Scheduled assessment cancelled",
      body: `${me.full_name ?? "Your assessor"} cancelled the session planned for ${new Date(row.scheduled_for).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`,
      href: "/dashboard/notifications",
    });
  }
  return NextResponse.json({ ok: true });
}
