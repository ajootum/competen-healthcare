import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { notify } from "@/lib/notify";

// Interventions — remediation plan lifecycle: planned → in_progress → review
// → completed (outcome required at completion). Learner notified on creation;
// everything audit-logged.

const STATUSES = ["planned", "in_progress", "review", "completed"] as const;
const OUTCOMES = new Set(["successful", "partially_successful", "unsuccessful"]);

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
  if (!auth) return NextResponse.json({ error: "Only educator roles can create interventions" }, { status: 403 });
  const { admin, me, userId } = auth;

  const { nurse_id, reason, objectives, activities, review_date, competency_name } = await req.json().catch(() => ({}));
  const why = typeof reason === "string" ? reason.trim() : "";
  if (!nurse_id || !why) return NextResponse.json({ error: "nurse_id and reason are required" }, { status: 400 });

  const { data: nurse } = await admin.from("profiles").select("id, full_name, hospital_id").eq("id", nurse_id).single();
  if (!nurse) return NextResponse.json({ error: "Learner not found" }, { status: 404 });
  if (me.hospital_id && nurse.hospital_id !== me.hospital_id && !auth.roles.includes("super_admin")) {
    return NextResponse.json({ error: "You can only create interventions for learners in your hospital" }, { status: 403 });
  }

  const { data: row, error } = await admin.from("interventions").insert({
    hospital_id: nurse.hospital_id ?? me.hospital_id ?? null,
    nurse_id,
    competency_name: (competency_name ?? "").trim() || null,
    reason: why.slice(0, 2000),
    objectives: (objectives ?? "").trim() || null,
    activities: (activities ?? "").trim() || null,
    review_date: review_date || null,
    created_by: userId, created_by_name: me.full_name ?? null,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    actor_id: userId, actor_name: me.full_name ?? null,
    action: "create_intervention", entity_type: "intervention", entity_id: row.id, entity_name: nurse.full_name,
    new_value: { reason: why.slice(0, 200), review_date: review_date ?? null },
  });
  await notify([nurse_id], {
    type: "intervention_created",
    title: "A development intervention was created for you",
    body: `${me.full_name ?? "Your educator"} set up a supported development plan${competency_name?.trim() ? ` for ${competency_name.trim()}` : ""}. They will guide you through the objectives and review progress together.`,
    href: "/dashboard/learning",
  });
  return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
}

export async function PATCH(req: Request) {
  const auth = await requireEducator();
  if (!auth) return NextResponse.json({ error: "Only educator roles can manage interventions" }, { status: 403 });
  const { admin, me, userId } = auth;

  const { id, status, outcome, outcome_note } = await req.json().catch(() => ({}));
  if (!id || !STATUSES.includes(status)) {
    return NextResponse.json({ error: `id and status (${STATUSES.join(" | ")}) are required` }, { status: 400 });
  }
  const { data: row } = await admin.from("interventions").select("id, nurse_id, hospital_id, status").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Intervention not found" }, { status: 404 });
  if (me.hospital_id && row.hospital_id !== me.hospital_id && !auth.roles.includes("super_admin")) {
    return NextResponse.json({ error: "You can only manage interventions in your hospital" }, { status: 403 });
  }
  if (STATUSES.indexOf(status) <= STATUSES.indexOf(row.status as typeof STATUSES[number]) && status !== row.status) {
    return NextResponse.json({ error: `Cannot move a ${row.status} intervention back to ${status}` }, { status: 400 });
  }
  if (status === "completed" && !OUTCOMES.has(outcome)) {
    return NextResponse.json({ error: "Completing an intervention requires an outcome (successful | partially_successful | unsuccessful)" }, { status: 400 });
  }

  const { error } = await admin.from("interventions").update({
    status,
    outcome: status === "completed" ? outcome : null,
    outcome_note: (outcome_note ?? "").trim() || null,
    completed_at: status === "completed" ? new Date().toISOString() : null,
  }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    actor_id: userId, actor_name: me.full_name ?? null,
    action: "update_intervention", entity_type: "intervention", entity_id: id,
    new_value: { from: row.status, to: status, outcome: status === "completed" ? outcome : null },
  });
  return NextResponse.json({ ok: true, status });
}
