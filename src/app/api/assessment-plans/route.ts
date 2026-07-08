import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!["super_admin", "hospital_admin", "educator", "assessor"].includes(profile?.role ?? "")) return { error: "Forbidden", status: 403 as const };
  return { user, admin, profile };
}

// POST — create an assessment plan (+ optional items/assessors)
export async function POST(req: Request) {
  const auth = await requireStaff();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { name, programme_type, scheduling_rule, nurse_id, is_template, due_date, cpu_ids, assessor_ids } = await req.json();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const { data: plan, error } = await auth.admin.from("assessment_plans").insert({
    name,
    hospital_id: auth.profile?.hospital_id ?? null,
    programme_type: programme_type ?? "annual",
    scheduling_rule: scheduling_rule ?? "fixed",
    nurse_id: nurse_id ?? null,
    is_template: !!is_template,
    due_date: due_date ?? null,
    status: "draft",
    created_by: auth.user.id,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (Array.isArray(cpu_ids) && cpu_ids.length) {
    await auth.admin.from("plan_items").insert(cpu_ids.map((cid: string) => ({ plan_id: plan.id, cpu_id: cid })));
  }
  if (Array.isArray(assessor_ids) && assessor_ids.length) {
    await auth.admin.from("plan_assessors").insert(
      assessor_ids.map((aid: string, i: number) => ({ plan_id: plan.id, assessor_id: aid, role: i === 0 ? "primary" : "secondary" }))
    );
  }
  return NextResponse.json(plan, { status: 201 });
}

// PATCH — update status/fields
export async function PATCH(req: Request) {
  const auth = await requireStaff();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id, ...fields } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const allowed = ["name", "programme_type", "scheduling_rule", "status", "due_date", "nurse_id"];
  const update = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));
  if (Object.keys(update).length) await auth.admin.from("assessment_plans").update(update).eq("id", id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const auth = await requireStaff();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await auth.admin.from("assessment_plans").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
