import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { notify } from "@/lib/notify";

// CAPA workflow (Quality & Governance). POST creates a corrective/preventive
// action; PATCH advances its status (open → in_progress → completed →
// verified → closed) and records evidence notes. Assessor roles only.

const STATUSES = ["open", "in_progress", "completed", "verified", "closed"] as const;

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("id, full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) return null;
  return { admin, me: me!, userId: user.id, roles };
}

export async function POST(req: Request) {
  const auth = await requireStaff();
  if (!auth) return NextResponse.json({ error: "Only assessor roles can manage CAPA actions" }, { status: 403 });
  const { admin, me, userId } = auth;

  const { title, description, priority, due_date, owner_id } = await req.json().catch(() => ({}));
  const t = typeof title === "string" ? title.trim() : "";
  if (!t) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (priority != null && !["low", "medium", "high"].includes(priority)) {
    return NextResponse.json({ error: "priority must be low, medium or high" }, { status: 400 });
  }

  let owner: { id: string; full_name: string } | null = null;
  if (owner_id) {
    const { data } = await admin.from("profiles").select("id, full_name, hospital_id").eq("id", owner_id).single();
    if (!data) return NextResponse.json({ error: "Owner not found" }, { status: 404 });
    if (me.hospital_id && data.hospital_id !== me.hospital_id && !auth.roles.includes("super_admin")) {
      return NextResponse.json({ error: "Owner must be in your hospital" }, { status: 403 });
    }
    owner = data;
  }

  const { data: row, error } = await admin.from("capa_actions").insert({
    hospital_id: me.hospital_id ?? null,
    title: t,
    description: (description ?? "").trim() || null,
    priority: priority ?? "medium",
    due_date: due_date || null,
    owner_id: owner?.id ?? userId,
    owner_name: owner?.full_name ?? me.full_name ?? null,
    created_by: userId,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    actor_id: userId, actor_name: me.full_name ?? null,
    action: "create_capa", entity_type: "capa", entity_id: row.id, entity_name: t,
    new_value: { priority: priority ?? "medium", due_date: due_date ?? null },
  });
  if (owner && owner.id !== userId) {
    await notify([owner.id], {
      type: "capa_assigned",
      title: "Improvement action assigned to you",
      body: `${me.full_name ?? "A colleague"} assigned you a ${priority ?? "medium"}-priority CAPA: ${t}${due_date ? ` (due ${due_date})` : ""}.`,
      href: "/assessor/quality/capa",
    });
  }
  return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
}

export async function PATCH(req: Request) {
  const auth = await requireStaff();
  if (!auth) return NextResponse.json({ error: "Only assessor roles can manage CAPA actions" }, { status: 403 });
  const { admin, me, userId } = auth;

  const { id, status, evidence_note } = await req.json().catch(() => ({}));
  if (!id || !STATUSES.includes(status)) {
    return NextResponse.json({ error: `id and status (${STATUSES.join(" | ")}) are required` }, { status: 400 });
  }
  const { data: row } = await admin.from("capa_actions").select("id, title, status, hospital_id").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "CAPA action not found" }, { status: 404 });
  if (me.hospital_id && row.hospital_id !== me.hospital_id && !auth.roles.includes("super_admin")) {
    return NextResponse.json({ error: "You can only manage CAPA actions in your hospital" }, { status: 403 });
  }
  if (STATUSES.indexOf(status) < STATUSES.indexOf(row.status as typeof STATUSES[number])) {
    return NextResponse.json({ error: `Cannot move a ${row.status} action back to ${status}` }, { status: 400 });
  }

  const { error } = await admin.from("capa_actions").update({
    status,
    evidence_note: (evidence_note ?? "").trim() || undefined,
    closed_at: status === "closed" ? new Date().toISOString() : null,
  }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    actor_id: userId, actor_name: me.full_name ?? null,
    action: "update_capa", entity_type: "capa", entity_id: id, entity_name: row.title,
    new_value: { from: row.status, to: status },
  });
  return NextResponse.json({ ok: true, status });
}
