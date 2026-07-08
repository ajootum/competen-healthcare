import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id, organisation_id").eq("id", user.id).single();
  if (!["super_admin", "hospital_admin"].includes(profile?.role ?? "")) return { error: "Forbidden", status: 403 as const };
  return { user, profile, admin };
}

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data } = await auth.admin
    .from("governance_committees")
    .select("id, name, level, quorum, is_active, committee_members(id, role, profiles(id, full_name))")
    .order("level");
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { name, level, quorum } = await req.json();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const { data, error } = await auth.admin.from("governance_committees").insert({
    name,
    level: level ?? "facility",
    quorum: quorum ?? 1,
    hospital_id: auth.profile?.hospital_id ?? null,
    organisation_id: auth.profile?.organisation_id ?? null,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id, action, ...fields } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (action === "add_member") {
    const { profile_id, role } = fields;
    if (!profile_id) return NextResponse.json({ error: "profile_id required" }, { status: 400 });
    await auth.admin.from("committee_members").upsert(
      { committee_id: id, profile_id, role: role ?? "member" },
      { onConflict: "committee_id,profile_id" }
    );
    return NextResponse.json({ ok: true });
  }
  if (action === "remove_member") {
    const { profile_id } = fields;
    await auth.admin.from("committee_members").delete().eq("committee_id", id).eq("profile_id", profile_id);
    return NextResponse.json({ ok: true });
  }

  const allowed = ["name", "level", "quorum", "is_active"];
  const update = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));
  if (Object.keys(update).length) await auth.admin.from("governance_committees").update(update).eq("id", id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await auth.admin.from("governance_committees").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
