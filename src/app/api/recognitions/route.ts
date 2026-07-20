import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isStaff, assertProfileScope, assertRowScope } from "@/lib/api-auth";

// POST — award a recognition
export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();

  const { nurse_id, recognition_type, title, description, awarded_at } = await req.json();
  if (!nurse_id || !title) return NextResponse.json({ error: "nurse_id and title required" }, { status: 400 });
  // The awardee must be in the caller's hospital.
  const scopeErr = await assertProfileScope(c, nurse_id);
  if (scopeErr) return scopeErr;

  const admin = c.admin;
  const { data: nurse } = await admin.from("profiles").select("hospital_id").eq("id", nurse_id).single();
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await admin.from("professional_recognitions").insert({
    nurse_id,
    hospital_id: nurse?.hospital_id ?? c.hospitalId ?? null,
    recognition_type: recognition_type ?? "excellence_award",
    title,
    description: description ?? null,
    awarded_at: awarded_at ?? undefined,
    awarded_by: c.userId,
    awarded_by_name: me?.full_name ?? null,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    actor_id: c.userId, actor_name: me?.full_name ?? null,
    action: "award_recognition", entity_type: "recognition", entity_id: data.id,
    new_value: { nurse_id, recognition_type, title },
  });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const scopeErr = await assertRowScope(c, "professional_recognitions", id);
  if (scopeErr) return scopeErr;
  await c.admin.from("professional_recognitions").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
