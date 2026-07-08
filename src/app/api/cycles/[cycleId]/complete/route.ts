import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { generateDecisionsForCycle } from "@/lib/engines/decisions";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ cycleId: string }> }
) {
  const { cycleId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await createAdminClient().from("profiles").select("role, hospital_id, full_name").eq("id", user.id).single();
  if (!["hospital_admin","super_admin","educator"].includes(profile?.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Get the cycle's framework scores to compute clinical readiness score
  const { data: fwScores } = await admin
    .from("framework_scores")
    .select("score")
    .eq("cycle_id", cycleId);

  let clinicalReadinessScore: number | null = null;
  if (fwScores && fwScores.length > 0) {
    clinicalReadinessScore = Math.round(
      fwScores.reduce((s, f) => s + f.score, 0) / fwScores.length * 10
    ) / 10;
  }

  // Mark all in-progress cycle_frameworks as complete
  await admin
    .from("cycle_frameworks")
    .update({ status: "complete" })
    .eq("cycle_id", cycleId)
    .eq("status", "in_progress");

  // Close the cycle
  const { error } = await admin
    .from("competency_cycles")
    .update({
      status: "complete",
      completed_at: new Date().toISOString(),
      clinical_readiness_score: clinicalReadinessScore,
    })
    .eq("id", cycleId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── Competency Decision Engine ──────────────────────────────
  // Turn validated scores into formal governed competency decisions.
  let decisionsCreated = 0;
  try {
    const result = await generateDecisionsForCycle(admin, cycleId, user.id, profile?.full_name ?? null);
    decisionsCreated = result.created;
    await admin.from("audit_log").insert({
      actor_id: user.id,
      actor_name: profile?.full_name ?? null,
      action: "finalize_decisions",
      entity_type: "cycle",
      entity_id: cycleId,
      entity_name: null,
      new_value: { decisions_created: decisionsCreated, clinical_readiness_score: clinicalReadinessScore },
    });
  } catch {
    // Decision generation is best-effort; cycle completion already succeeded.
  }

  return NextResponse.json({ ok: true, clinical_readiness_score: clinicalReadinessScore, decisions_created: decisionsCreated });
}
