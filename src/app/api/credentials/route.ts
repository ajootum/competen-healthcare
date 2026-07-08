import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id, full_name").eq("id", user.id).single();
  if (!["super_admin", "hospital_admin", "educator"].includes(profile?.role ?? "")) return { error: "Forbidden", status: 403 as const };
  return { user, admin, profile };
}

export async function POST(req: Request) {
  const auth = await requireStaff();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { nurse_id, credential_type, title, issuing_body, issue_date, expiry_date } = await req.json();
  if (!nurse_id || !title) return NextResponse.json({ error: "nurse_id and title required" }, { status: 400 });

  const { data: nurse } = await auth.admin.from("profiles").select("hospital_id").eq("id", nurse_id).single();
  const { data, error } = await auth.admin.from("professional_credentials").insert({
    nurse_id,
    hospital_id: nurse?.hospital_id ?? auth.profile?.hospital_id ?? null,
    credential_type: credential_type ?? "professional_license",
    title,
    issuing_body: issuing_body ?? null,
    issue_date: issue_date ?? null,
    expiry_date: expiry_date ?? null,
    status: "pending_verification",
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const auth = await requireStaff();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id, action, ...fields } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (action === "verify") {
    await auth.admin.from("professional_credentials").update({
      verified: true, status: "active", verified_by: auth.user.id, verified_at: new Date().toISOString(),
    }).eq("id", id);
    return NextResponse.json({ ok: true });
  }

  const allowed = ["credential_type", "title", "issuing_body", "issue_date", "expiry_date", "status"];
  const update = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));
  if (Object.keys(update).length) await auth.admin.from("professional_credentials").update(update).eq("id", id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const auth = await requireStaff();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await auth.admin.from("professional_credentials").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
