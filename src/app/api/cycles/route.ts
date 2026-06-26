import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// POST /api/cycles — create a new competency cycle for a nurse
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: admin } = await supabase
    .from("profiles")
    .select("role, hospital_id")
    .eq("id", user.id)
    .single();

  if (!admin || !["hospital_admin", "super_admin"].includes(admin.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { nurse_id, cycle_type, framework_ids, end_date, notes } = body as {
    nurse_id: string;
    cycle_type: string;
    framework_ids: string[];
    end_date?: string;
    notes?: string;
  };

  if (!nurse_id || !cycle_type || !Array.isArray(framework_ids)) {
    return NextResponse.json({ error: "nurse_id, cycle_type, and framework_ids[] are required" }, { status: 400 });
  }

  const service = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Expire any existing active cycles for this nurse
  await service
    .from("competency_cycles")
    .update({ status: "expired" })
    .eq("nurse_id", nurse_id)
    .eq("status", "active");

  // Create new cycle
  const { data: cycle, error: cycleErr } = await service
    .from("competency_cycles")
    .insert({
      nurse_id,
      hospital_id: admin.hospital_id,
      cycle_type,
      status: "active",
      start_date: new Date().toISOString().split("T")[0],
      end_date: end_date ?? null,
      created_by: user.id,
      notes: notes ?? null,
    })
    .select("id")
    .single();

  if (cycleErr || !cycle) {
    return NextResponse.json({ error: cycleErr?.message ?? "Cycle creation failed" }, { status: 500 });
  }

  // Assign frameworks
  if (framework_ids.length > 0) {
    await service.from("cycle_framework_assignments").insert(
      framework_ids.map(fid => ({ cycle_id: cycle.id, framework_id: fid }))
    );
  }

  return NextResponse.json({ success: true, cycle_id: cycle.id });
}
