import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { isPassing, getBennerLabel } from "@/lib/benner";

// POST — submit skill scores for a cycle
// Body: { cycle_id, scores: [{ skill_id, competency_id, domain_id, framework_id, score }] }
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await createAdminClient().from("profiles").select("role").eq("id", user.id).single();
  if (!["super_admin", "hospital_admin", "assessor", "educator"].includes(profile?.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { cycle_id, scores } = await req.json();
  if (!cycle_id || !Array.isArray(scores) || !scores.length) {
    return NextResponse.json({ error: "cycle_id and scores[] required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Upsert all skill scores
  const rows = scores.map((s: { skill_id: string; competency_id: string; domain_id: string; framework_id: string; score: number; notes?: string }) => ({
    cycle_id,
    skill_id:      s.skill_id,
    competency_id: s.competency_id,
    domain_id:     s.domain_id,
    framework_id:  s.framework_id,
    assessor_id:   user.id,
    score:         s.score,
    notes:         s.notes ?? null,
    assessed_at:   new Date().toISOString(),
  }));

  const { error: skillErr } = await admin.from("skill_scores").upsert(rows, { onConflict: "cycle_id,skill_id,assessor_id" });
  if (skillErr) return NextResponse.json({ error: skillErr.message }, { status: 500 });

  // Aggregate skill → competency scores
  const competencyIds = [...new Set(scores.map((s: { competency_id: string }) => s.competency_id))];
  for (const competency_id of competencyIds) {
    const { data: skillScores } = await admin
      .from("skill_scores")
      .select("score, domain_id, framework_id")
      .eq("cycle_id", cycle_id)
      .eq("competency_id", competency_id);

    if (!skillScores?.length) continue;
    const avg = skillScores.reduce((s, r) => s + r.score, 0) / skillScores.length;
    const final = Math.round(avg);
    const benner = getBennerLabel(final);
    const { domain_id, framework_id } = skillScores[0];

    await admin.from("competency_scores").upsert({
      cycle_id,
      competency_id,
      domain_id,
      framework_id,
      assessor_count: skillScores.length,
      avg_score:   parseFloat(avg.toFixed(2)),
      final_score: final,
      level_label: benner.label,
      is_passing:  isPassing(final),
    }, { onConflict: "cycle_id,competency_id" });
  }

  // Aggregate competency → domain scores
  const domainIds = [...new Set(scores.map((s: { domain_id: string }) => s.domain_id))];
  for (const domain_id of domainIds) {
    const { data: compScores } = await admin
      .from("competency_scores")
      .select("avg_score, is_passing, framework_id")
      .eq("cycle_id", cycle_id)
      .eq("domain_id", domain_id);

    if (!compScores?.length) continue;
    const avg = compScores.reduce((s, r) => s + (r.avg_score ?? 0), 0) / compScores.length;
    const passing = compScores.filter(r => r.is_passing).length;
    const { framework_id } = compScores[0];

    await admin.from("domain_scores").upsert({
      cycle_id,
      domain_id,
      framework_id,
      avg_score:        parseFloat(avg.toFixed(2)),
      competency_count: compScores.length,
      passing_count:    passing,
      is_passing:       passing === compScores.length,
    }, { onConflict: "cycle_id,domain_id" });
  }

  return NextResponse.json({ success: true, scored: rows.length });
}

// GET — fetch skill scores for a cycle
// ?cycle_id=xxx&competency_id=xxx (optional)
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const cycle_id = params.get("cycle_id");
  const competency_id = params.get("competency_id");
  if (!cycle_id) return NextResponse.json({ error: "cycle_id required" }, { status: 400 });

  const admin = createAdminClient();
  let query = admin
    .from("skill_scores")
    .select("id, skill_id, competency_id, domain_id, score, notes, assessed_at, assessor_id, competency_skills(name)")
    .eq("cycle_id", cycle_id);

  if (competency_id) query = query.eq("competency_id", competency_id);

  const { data, error } = await query.order("assessed_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
