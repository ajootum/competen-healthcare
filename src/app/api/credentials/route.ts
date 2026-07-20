import { NextResponse } from "next/server";
import { notify, hospitalVerifierIds } from "@/lib/notify";
import { getCaller, isResponse, isStaff, assertProfileScope, assertRowScope } from "@/lib/api-auth";

export async function POST(req: Request) {
  // Staff can record a credential for any nurse; a clinician can self-submit
  // their OWN licence/registration (§A) — it lands as pending_verification.
  const c = await getCaller();
  if (isResponse(c)) return c;
  const staff = isStaff(c);
  const admin = c.admin;

  const { nurse_id, credential_type, title, issuing_body, credential_number, issue_date, expiry_date } = await req.json();
  const targetNurse = nurse_id || c.userId;
  if (!title?.trim()) return NextResponse.json({ error: "title required" }, { status: 400 });
  if (targetNurse !== c.userId && !staff) {
    return NextResponse.json({ error: "You can only add credentials to your own profile" }, { status: 403 });
  }
  // Staff acting for another clinician: that nurse must be in the caller's hospital.
  if (targetNurse !== c.userId) {
    const scopeErr = await assertProfileScope(c, targetNurse);
    if (scopeErr) return scopeErr;
  }

  const { data: nurse } = await admin.from("profiles").select("hospital_id").eq("id", targetNurse).single();
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await admin.from("professional_credentials").insert({
    nurse_id: targetNurse,
    hospital_id: nurse?.hospital_id ?? c.hospitalId ?? null,
    credential_type: credential_type ?? "professional_license",
    title: title.trim(),
    issuing_body: issuing_body?.trim() || null,
    credential_number: credential_number?.trim() || null,
    issue_date: issue_date || null,
    expiry_date: expiry_date || null,
    status: "pending_verification",
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (targetNurse === c.userId) {
    // Self-submitted — let the hospital's verifiers know it needs review.
    await notify(await hospitalVerifierIds(nurse?.hospital_id ?? c.hospitalId ?? null, c.userId), {
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
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, action, ...fields } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  // The target credential must belong to the caller's hospital.
  const scopeErr = await assertRowScope(c, "professional_credentials", id);
  if (scopeErr) return scopeErr;

  if (action === "verify") {
    await c.admin.from("professional_credentials").update({
      verified: true, status: "active", verified_by: c.userId, verified_at: new Date().toISOString(),
    }).eq("id", id);
    return NextResponse.json({ ok: true });
  }

  const allowed = ["credential_type", "title", "issuing_body", "issue_date", "expiry_date", "status"];
  const update = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));
  if (Object.keys(update).length) await c.admin.from("professional_credentials").update(update).eq("id", id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const scopeErr = await assertRowScope(c, "professional_credentials", id);
  if (scopeErr) return scopeErr;
  await c.admin.from("professional_credentials").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
