import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { DATASET_COLUMNS } from "@/lib/report-datasets";

// Saved report definitions (Report Builder → Report Library).

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
  const { data } = await auth.admin.from("report_definitions")
    .select("id, name, dataset, config, created_by_name, created_at")
    .eq("hospital_id", auth.me.hospital_id ?? "").order("created_at", { ascending: false }).limit(100);
  return NextResponse.json({ definitions: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireStaff();
  if (!auth) return NextResponse.json({ error: "Only assessor roles can save reports" }, { status: 403 });
  const { admin, me, userId } = auth;

  const { name, dataset, config } = await req.json().catch(() => ({}));
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!DATASET_COLUMNS[dataset]) return NextResponse.json({ error: "Unknown dataset" }, { status: 400 });

  const { data: row, error } = await admin.from("report_definitions").insert({
    hospital_id: me.hospital_id ?? null,
    name: n, dataset,
    config: config && typeof config === "object" ? config : {},
    created_by: userId, created_by_name: me.full_name ?? null,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    actor_id: userId, actor_name: me.full_name ?? null,
    action: "save_report", entity_type: "report_definition", entity_id: row.id, entity_name: n,
    new_value: { dataset },
  });
  return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
}

export async function DELETE(req: Request) {
  const auth = await requireStaff();
  if (!auth) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const { data: row } = await auth.admin.from("report_definitions").select("id, created_by, name").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.created_by !== auth.userId && !auth.roles.some(r => ["hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Only the owner or an admin can delete a saved report" }, { status: 403 });
  }
  await auth.admin.from("report_definitions").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
