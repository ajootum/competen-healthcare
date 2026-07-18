import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { recomputeAll } from "@/lib/engines/scoring";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await createAdminClient().from("profiles").select("role").eq("id", user.id).single();
  if (!["assessor","educator","hospital_admin","super_admin"].includes(profile?.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { cycle_id, competency_id, method, score, notes } = await req.json();
  if (!cycle_id || !competency_id || !method) {
    return NextResponse.json({ error: "cycle_id, competency_id, and method required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.from("assessments").insert({
    cycle_id,
    competency_id,
    assessor_id: user.id,
    method,
    score: score ?? null,
    notes: notes ?? null,
    status: score != null ? "complete" : "in_progress",
    assessed_at: score != null ? new Date().toISOString() : null,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (score != null) {
    await recomputeAll(admin, cycle_id, competency_id);
  }

  return NextResponse.json(data, { status: 201 });
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const cycleId = searchParams.get("cycle_id");
  const assessorId = searchParams.get("assessor_id");

  const admin = createAdminClient();
  let q = admin.from("assessments").select(`
    id, cycle_id, competency_id, method, status, score, notes, assessed_at,
    profiles!assessor_id(id, full_name),
    framework_competencies!competency_id(id, name,
      framework_domains!domain_id(id, name, frameworks!framework_id(id, name))
    )
  `).order("created_at", { ascending: false });

  if (cycleId) q = q.eq("cycle_id", cycleId);
  if (assessorId) q = q.eq("assessor_id", assessorId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
