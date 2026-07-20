import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isAdmin, isSuper, assertRowScope } from "@/lib/api-auth";

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();

  let q = c.admin
    .from("governance_committees")
    .select("id, name, level, quorum, is_active, committee_members(id, role, profiles(id, full_name))")
    .order("level");
  // Tenant scope: only the caller's hospital (super = all).
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? "__none__");
  const { data } = await q;
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();

  const { name, level, quorum } = await req.json();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const { data, error } = await c.admin.from("governance_committees").insert({
    name,
    level: level ?? "facility",
    quorum: quorum ?? 1,
    hospital_id: c.hospitalId,
    organisation_id: c.organisationId,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();

  const { id, action, ...fields } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  // The target committee must belong to the caller's hospital.
  const scopeErr = await assertRowScope(c, "governance_committees", id);
  if (scopeErr) return scopeErr;

  if (action === "add_member") {
    const { profile_id, role } = fields;
    if (!profile_id) return NextResponse.json({ error: "profile_id required" }, { status: 400 });
    await c.admin.from("committee_members").upsert(
      { committee_id: id, profile_id, role: role ?? "member" },
      { onConflict: "committee_id,profile_id" }
    );
    return NextResponse.json({ ok: true });
  }
  if (action === "remove_member") {
    const { profile_id } = fields;
    await c.admin.from("committee_members").delete().eq("committee_id", id).eq("profile_id", profile_id);
    return NextResponse.json({ ok: true });
  }

  const allowed = ["name", "level", "quorum", "is_active"];
  const update = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));
  if (Object.keys(update).length) await c.admin.from("governance_committees").update(update).eq("id", id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  // The target committee must belong to the caller's hospital.
  const scopeErr = await assertRowScope(c, "governance_committees", id);
  if (scopeErr) return scopeErr;
  await c.admin.from("governance_committees").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
