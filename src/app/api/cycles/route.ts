import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!["hospital_admin","super_admin","educator"].includes(profile?.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { nurse_id, cycle_type, start_date, end_date, notes, framework_ids } = await req.json();
  if (!nurse_id || !cycle_type) return NextResponse.json({ error: "nurse_id and cycle_type required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: nurse } = await admin.from("profiles").select("hospital_id").eq("id", nurse_id).single();
  if (!nurse?.hospital_id) return NextResponse.json({ error: "Nurse has no hospital assigned" }, { status: 400 });

  const { data: cycle, error } = await admin.from("competency_cycles").insert({
    nurse_id,
    hospital_id: nurse.hospital_id,
    cycle_type,
    start_date: start_date ?? new Date().toISOString().split("T")[0],
    end_date: end_date ?? null,
    notes: notes ?? null,
    created_by: user.id,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (Array.isArray(framework_ids) && framework_ids.length > 0) {
    await admin.from("cycle_frameworks").insert(
      framework_ids.map((fid: string) => ({ cycle_id: cycle.id, framework_id: fid }))
    );
  }

  return NextResponse.json(cycle, { status: 201 });
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const nurseId = searchParams.get("nurse_id");
  const hospitalId = searchParams.get("hospital_id");
  const status = searchParams.get("status");

  const admin = createAdminClient();
  let q = admin.from("competency_cycles").select(`
    id, cycle_type, status, start_date, end_date, created_at, notes,
    profiles!nurse_id(id, full_name, role),
    cycle_frameworks(id, framework_id, status, framework_score, frameworks(id, name, library))
  `).order("created_at", { ascending: false });

  if (nurseId) q = q.eq("nurse_id", nurseId);
  if (hospitalId) q = q.eq("hospital_id", hospitalId);
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
