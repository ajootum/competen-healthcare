import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { notify, hospitalVerifierIds } from "@/lib/notify";

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
  // Staff can record a credential for any nurse; a clinician can self-submit
  // their OWN licence/registration (§A) — it lands as pending_verification.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, hospital_id, full_name").eq("id", user.id).single();
  const isStaff = ["super_admin", "hospital_admin", "educator"].includes(me?.role ?? "");

  const { nurse_id, credential_type, title, issuing_body, credential_number, issue_date, expiry_date } = await req.json();
  const targetNurse = nurse_id || user.id;
  if (!title?.trim()) return NextResponse.json({ error: "title required" }, { status: 400 });
  if (targetNurse !== user.id && !isStaff) {
    return NextResponse.json({ error: "You can only add credentials to your own profile" }, { status: 403 });
  }

  const { data: nurse } = await admin.from("profiles").select("hospital_id").eq("id", targetNurse).single();
  const { data, error } = await admin.from("professional_credentials").insert({
    nurse_id: targetNurse,
    hospital_id: nurse?.hospital_id ?? me?.hospital_id ?? null,
    credential_type: credential_type ?? "professional_license",
    title: title.trim(),
    issuing_body: issuing_body?.trim() || null,
    credential_number: credential_number?.trim() || null,
    issue_date: issue_date || null,
    expiry_date: expiry_date || null,
    status: "pending_verification",
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (targetNurse === user.id) {
    // Self-submitted — let the hospital's verifiers know it needs review.
    await notify(await hospitalVerifierIds(nurse?.hospital_id ?? me?.hospital_id ?? null, user.id), {
      type: "credential_submitted",
      title: "Credential submitted for verification",
      body: `${me?.full_name ?? "A clinician"} added "${title.trim()}"`,
      href: "/dashboard/certificates",
    });
  } else {
    await notify([targetNurse], {
      type: "credential_added",
      title: "Credential added to your profile",
      body: `"${title.trim()}" was recorded by ${me?.full_name ?? "your organisation"}`,
      href: "/dashboard/certificates",
    });
  }
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
