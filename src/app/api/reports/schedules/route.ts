import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { DATASET_COLUMNS } from "@/lib/report-datasets";

// Scheduled reports. Executed by the daily platform cron (/api/cron/reports);
// delivery is an in-app notification per recipient. Email delivery would need
// an email service — deliberately not part of this module yet.

function nextRun(frequency: string, from = new Date()): Date {
  const d = new Date(from);
  d.setUTCHours(6, 0, 0, 0);
  if (frequency === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + (((8 - d.getUTCDay()) % 7) || 7));
  else { d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(1); }
  return d;
}

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

export async function GET() {
  const auth = await requireStaff();
  if (!auth) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { data } = await auth.admin.from("report_schedules")
    .select("id, name, dataset, definition_id, frequency, recipients, active, next_run_at, last_run_at, last_status, created_by")
    .eq("hospital_id", auth.me.hospital_id ?? "").order("created_at", { ascending: false }).limit(100);
  return NextResponse.json({ schedules: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireStaff();
  if (!auth) return NextResponse.json({ error: "Only assessor roles can schedule reports" }, { status: 403 });
  const { admin, me, userId } = auth;

  const { name, definition_id, dataset, frequency, recipient_ids } = await req.json().catch(() => ({}));
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!["daily", "weekly", "monthly"].includes(frequency)) {
    return NextResponse.json({ error: "frequency must be daily, weekly or monthly" }, { status: 400 });
  }
  if (!definition_id && !DATASET_COLUMNS[dataset]) {
    return NextResponse.json({ error: "Provide a saved definition_id or a valid dataset" }, { status: 400 });
  }
  if (definition_id) {
    const { data: def } = await admin.from("report_definitions").select("id, hospital_id").eq("id", definition_id).single();
    if (!def || def.hospital_id !== me.hospital_id) return NextResponse.json({ error: "Saved report not found" }, { status: 404 });
  }
  const recipients: string[] = [...new Set((Array.isArray(recipient_ids) ? recipient_ids : []).filter((x: unknown) => typeof x === "string"))] as string[];
  if (!recipients.length) return NextResponse.json({ error: "At least one recipient is required" }, { status: 400 });
  const { data: recips } = await admin.from("profiles").select("id, hospital_id").in("id", recipients);
  if ((recips ?? []).some(r => r.hospital_id !== me.hospital_id) && !auth.roles.includes("super_admin")) {
    return NextResponse.json({ error: "Recipients must be in your hospital" }, { status: 403 });
  }

  const { data: row, error } = await admin.from("report_schedules").insert({
    hospital_id: me.hospital_id ?? null,
    definition_id: definition_id ?? null,
    dataset: definition_id ? null : dataset,
    name: n, frequency, recipients,
    next_run_at: nextRun(frequency).toISOString(),
    created_by: userId,
  }).select("id, next_run_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    actor_id: userId, actor_name: me.full_name ?? null,
    action: "schedule_report", entity_type: "report_schedule", entity_id: row.id, entity_name: n,
    new_value: { frequency, recipients: recipients.length },
  });
  return NextResponse.json({ ok: true, id: row.id, next_run_at: row.next_run_at }, { status: 201 });
}

export async function PATCH(req: Request) {
  const auth = await requireStaff();
  if (!auth) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, active } = await req.json().catch(() => ({}));
  if (!id || typeof active !== "boolean") return NextResponse.json({ error: "id and active (boolean) are required" }, { status: 400 });
  const { data: row } = await auth.admin.from("report_schedules").select("id, hospital_id").eq("id", id).single();
  if (!row || row.hospital_id !== auth.me.hospital_id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { error } = await auth.admin.from("report_schedules").update({ active }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, active });
}

export async function DELETE(req: Request) {
  const auth = await requireStaff();
  if (!auth) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const { data: row } = await auth.admin.from("report_schedules").select("id, hospital_id, created_by").eq("id", id).single();
  if (!row || row.hospital_id !== auth.me.hospital_id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.created_by !== auth.userId && !auth.roles.some(r => ["hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Only the owner or an admin can delete a schedule" }, { status: 403 });
  }
  await auth.admin.from("report_schedules").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
