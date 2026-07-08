import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

async function requireSuperAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const { data: profile } = await createAdminClient().from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") return { error: "Forbidden", status: 403 as const };
  return { user };
}

export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { practice_id, name, description, code, risk_category, complexity, reassessment_months, sort_order } = await req.json();
  if (!practice_id || !name) return NextResponse.json({ error: "practice_id and name required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: cpu, error } = await admin.from("clinical_practice_units").insert({
    practice_id, name,
    description: description ?? null,
    code: code ?? null,
    risk_category: risk_category ?? "standard",
    complexity: complexity ?? 2,
    reassessment_months: reassessment_months ?? 12,
    sort_order: sort_order ?? 0,
    pub_status: "draft",
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Seed a default assessment blueprint so the CPU is immediately configurable
  await admin.from("assessment_blueprints").insert({
    cpu_id: cpu.id,
    min_score: 4,
    min_assessors: 1,
    consensus_rule: "any",
    reassessment_months: reassessment_months ?? 12,
  });

  return NextResponse.json(cpu, { status: 201 });
}

export async function PATCH(req: Request) {
  const auth = await requireSuperAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id, ...fields } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const allowed = ["name", "description", "code", "risk_category", "complexity", "reassessment_months", "sort_order", "pub_status"];
  const update = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));

  const admin = createAdminClient();
  const { error } = await admin.from("clinical_practice_units").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const auth = await requireSuperAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = createAdminClient();
  // Detach any competencies from this CPU before deleting (keep the competencies)
  await admin.from("framework_competencies").update({ cpu_id: null }).eq("cpu_id", id);
  const { error } = await admin.from("clinical_practice_units").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
