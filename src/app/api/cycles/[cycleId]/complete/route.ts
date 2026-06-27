import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ cycleId: string }> }
) {
  const { cycleId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role, hospital_id").eq("id", user.id).single();
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

  return NextResponse.json({ ok: true, clinical_readiness_score: clinicalReadinessScore });
}
