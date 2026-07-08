import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generateDecisionsForCycle } from "@/lib/engines/decisions";

// POST — (re)generate formal competency decisions for a cycle from current scores.
export async function POST(_req: Request, { params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, full_name").eq("id", user.id).single();
  if (!["hospital_admin", "super_admin", "educator"].includes(profile?.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await generateDecisionsForCycle(admin, cycleId, user.id, profile?.full_name ?? null);
    await admin.from("audit_log").insert({
      actor_id: user.id,
      actor_name: profile?.full_name ?? null,
      action: "finalize_decisions",
      entity_type: "cycle",
      entity_id: cycleId,
      new_value: { decisions_created: result.created },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

// GET — list decisions for a cycle.
export async function GET(_req: Request, { params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("competency_decisions")
    .select("id, competency_id, outcome, maturity, effective_date, expiry_date, critical_failure")
    .eq("cycle_id", cycleId)
    .order("created_at", { ascending: false });
  return NextResponse.json(data ?? []);
}
