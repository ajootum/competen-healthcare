import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { notify } from "@/lib/notify";

// Referrals — escalate a learner to a named colleague or an external service.
// Sensitive by design: only the reason travels; the learner is not notified,
// and reads are limited to referrer + referee (see migration 036 RLS).

const STATUSES = ["open", "accepted", "resolved", "declined"] as const;
const TRANSITIONS: Record<string, string[]> = {
  open: ["accepted", "resolved", "declined"],
  accepted: ["resolved", "declined"],
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
  if (!auth) return NextResponse.json({ error: "Only educator roles can create referrals" }, { status: 403 });
  const { admin, me, userId } = auth;

  const { nurse_id, referred_to_id, referred_to_text, reason, urgency } = await req.json().catch(() => ({}));
  const why = typeof reason === "string" ? reason.trim() : "";
  if (!nurse_id || !why) return NextResponse.json({ error: "nurse_id and reason are required" }, { status: 400 });
  if (!referred_to_id && !(typeof referred_to_text === "string" && referred_to_text.trim())) {
    return NextResponse.json({ error: "referred_to_id (internal) or referred_to_text (external) is required" }, { status: 400 });
  }

  const { data: nurse } = await admin.from("profiles").select("id, full_name, hospital_id").eq("id", nurse_id).single();
  if (!nurse) return NextResponse.json({ error: "Learner not found" }, { status: 404 });
  if (me.hospital_id && nurse.hospital_id !== me.hospital_id && !auth.roles.includes("super_admin")) {
    return NextResponse.json({ error: "You can only refer learners in your hospital" }, { status: 403 });
  }
  if (referred_to_id) {
    const { data: referee } = await admin.from("profiles").select("id, hospital_id").eq("id", referred_to_id).single();
    if (!referee) return NextResponse.json({ error: "Referee not found" }, { status: 404 });
    if (me.hospital_id && referee.hospital_id !== me.hospital_id && !auth.roles.includes("super_admin")) {
      return NextResponse.json({ error: "Referee must be in your hospital" }, { status: 403 });
    }
  }

  const { data: row, error } = await admin.from("referrals").insert({
    hospital_id: nurse.hospital_id ?? me.hospital_id ?? null,
    nurse_id,
    referred_to_id: referred_to_id || null,
    referred_to_text: (referred_to_text ?? "").trim() || null,
    reason: why.slice(0, 2000),
    urgency: ["low", "medium", "high"].includes(urgency) ? urgency : "medium",
    created_by: userId, created_by_name: me.full_name ?? null,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    actor_id: userId, actor_name: me.full_name ?? null,
    action: "create_referral", entity_type: "referral", entity_id: row.id, entity_name: nurse.full_name,
    new_value: { urgency: urgency ?? "medium", internal: !!referred_to_id },
  });
  if (referred_to_id) {
    await notify([referred_to_id], {
      type: "referral_created",
      title: "A learner has been referred to you",
      body: `${me.full_name ?? "An educator"} referred ${nurse.full_name} to you: ${why.slice(0, 160)}`,
    });
  }
  return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
}

export async function PATCH(req: Request) {
  const auth = await requireEducator();
  if (!auth) return NextResponse.json({ error: "Only educator roles can manage referrals" }, { status: 403 });
  const { admin, me, userId } = auth;

  const { id, status, resolution_note } = await req.json().catch(() => ({}));
  if (!id || !STATUSES.includes(status)) {
    return NextResponse.json({ error: `id and status (${STATUSES.join(" | ")}) are required` }, { status: 400 });
  }
  const { data: row } = await admin.from("referrals").select("id, hospital_id, status, created_by").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Referral not found" }, { status: 404 });
  if (me.hospital_id && row.hospital_id !== me.hospital_id && !auth.roles.includes("super_admin")) {
    return NextResponse.json({ error: "You can only manage referrals in your hospital" }, { status: 403 });
  }
  if (!(TRANSITIONS[row.status] ?? []).includes(status)) {
    return NextResponse.json({ error: `Cannot move a ${row.status} referral to ${status}` }, { status: 400 });
  }

  const terminal = ["resolved", "declined"].includes(status);
  const { error } = await admin.from("referrals").update({
    status,
    resolution_note: (resolution_note ?? "").trim() || null,
    resolved_at: terminal ? new Date().toISOString() : null,
  }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    actor_id: userId, actor_name: me.full_name ?? null,
    action: "update_referral", entity_type: "referral", entity_id: id,
    new_value: { from: row.status, to: status },
  });
  if (terminal && row.created_by && row.created_by !== userId) {
    await notify([row.created_by], {
      type: "referral_resolved",
      title: `Referral ${status}`,
      body: `${me.full_name ?? "A colleague"} marked your referral as ${status}${(resolution_note ?? "").trim() ? `: ${(resolution_note as string).trim().slice(0, 160)}` : "."}`,
    });
  }
  return NextResponse.json({ ok: true, status });
}
