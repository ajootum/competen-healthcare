import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { notify } from "@/lib/notify";

// Support sessions (coaching / progress review / validation meeting).
// POST schedules (learner notified); PATCH completes with notes or cancels.

const TYPES = new Set(["coaching", "progress_review", "validation_meeting", "other"]);
const TYPE_LABEL: Record<string, string> = {
  coaching: "Coaching session", progress_review: "Progress review",
  validation_meeting: "Validation meeting", other: "Support session",
};

async function requireEducator() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("id, full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["educator", "hospital_admin", "super_admin"].includes(r))) return null;
  return { admin, me: me!, userId: user.id, roles };
}

export async function POST(req: Request) {
  const auth = await requireEducator();
  if (!auth) return NextResponse.json({ error: "Only educator roles can schedule support sessions" }, { status: 403 });
  const { admin, me, userId } = auth;

  const { nurse_id, session_type, scheduled_for, focus, goals, follow_up_date } = await req.json().catch(() => ({}));
  if (!nurse_id || !scheduled_for) return NextResponse.json({ error: "nurse_id and scheduled_for are required" }, { status: 400 });
  const type = TYPES.has(session_type) ? session_type : "coaching";

  const { data: nurse } = await admin.from("profiles").select("id, full_name, hospital_id").eq("id", nurse_id).single();
  if (!nurse) return NextResponse.json({ error: "Learner not found" }, { status: 404 });
  if (me.hospital_id && nurse.hospital_id !== me.hospital_id && !auth.roles.includes("super_admin")) {
    return NextResponse.json({ error: "You can only schedule for learners in your hospital" }, { status: 403 });
  }

  const { data: row, error } = await admin.from("support_sessions").insert({
    hospital_id: nurse.hospital_id ?? me.hospital_id ?? null,
    nurse_id, educator_id: userId, educator_name: me.full_name ?? null,
    session_type: type, scheduled_for,
    focus: (focus ?? "").trim() || null,
    goals: (goals ?? "").trim() || null,
    follow_up_date: follow_up_date || null,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    actor_id: userId, actor_name: me.full_name ?? null,
    action: "schedule_support_session", entity_type: "support_session", entity_id: row.id, entity_name: nurse.full_name,
    new_value: { session_type: type, scheduled_for },
  });
  await notify([nurse_id], {
    type: "coaching_scheduled",
    title: `${TYPE_LABEL[type]} scheduled`,
    body: `${me.full_name ?? "Your educator"} scheduled a ${TYPE_LABEL[type].toLowerCase()} with you${focus?.trim() ? ` — focus: ${focus.trim()}` : ""}.`,
  });
  return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
}

export async function PATCH(req: Request) {
  const auth = await requireEducator();
  if (!auth) return NextResponse.json({ error: "Only educator roles can manage support sessions" }, { status: 403 });
  const { admin, me, userId } = auth;

  const { id, status, notes, follow_up_date } = await req.json().catch(() => ({}));
  if (!id || !["completed", "cancelled"].includes(status)) {
    return NextResponse.json({ error: "id and status (completed | cancelled) are required" }, { status: 400 });
  }
  const { data: row } = await admin.from("support_sessions").select("id, nurse_id, hospital_id, status, session_type").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (me.hospital_id && row.hospital_id !== me.hospital_id && !auth.roles.includes("super_admin")) {
    return NextResponse.json({ error: "You can only manage sessions in your hospital" }, { status: 403 });
  }
  if (row.status !== "scheduled") return NextResponse.json({ error: `Session is already ${row.status}` }, { status: 400 });

  const { error } = await admin.from("support_sessions").update({
    status,
    notes: (notes ?? "").trim() || null,
    follow_up_date: follow_up_date || undefined,
  }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    actor_id: userId, actor_name: me.full_name ?? null,
    action: status === "completed" ? "complete_support_session" : "cancel_support_session",
    entity_type: "support_session", entity_id: id,
  });
  if (status === "cancelled") {
    await notify([row.nurse_id], {
      type: "coaching_cancelled",
      title: `${TYPE_LABEL[row.session_type] ?? "Support session"} cancelled`,
      body: `${me.full_name ?? "Your educator"} cancelled the session.`,
    });
  }
  return NextResponse.json({ ok: true, status });
}
