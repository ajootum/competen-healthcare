import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
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

async function recomputeAll(
  admin: ReturnType<typeof createAdminClient>,
  cycleId: string,
  competencyId: string
) {
  // 1. Get all complete assessments for this competency in this cycle
  const { data: assessments } = await admin
    .from("assessments")
    .select("score")
    .eq("cycle_id", cycleId)
    .eq("competency_id", competencyId)
    .eq("status", "complete")
    .not("score", "is", null);

  if (!assessments?.length) return;

  const scores = assessments.map(a => a.score as number);
  const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
  const finalScore = Math.round(avg);

  // 2. Look up Benner level
  const { data: level } = await admin
    .from("scoring_levels")
    .select("score, label, is_passing, color")
    .eq("scale_id", "00000000-0000-0000-0000-000000000001")
    .eq("score", finalScore)
    .single();

  // 3. Get competency's domain + framework, and cycle's nurse_id
  const [compResult, cycleResult] = await Promise.all([
    admin.from("framework_competencies")
      .select("domain_id, framework_domains!domain_id(framework_id)")
      .eq("id", competencyId)
      .single(),
    admin.from("competency_cycles")
      .select("nurse_id")
      .eq("id", cycleId)
      .single(),
  ]);

  const domainId = compResult.data?.domain_id;
  const frameworkId = (compResult.data?.framework_domains as unknown as { framework_id: string } | null)?.framework_id;
  const nurseId = cycleResult.data?.nurse_id;

  // 4. Upsert competency_scores — column names match migration 009 schema
  await admin.from("competency_scores").upsert({
    cycle_id: cycleId,
    competency_id: competencyId,
    nurse_id: nurseId,
    domain_id: domainId,
    framework_id: frameworkId,
    score: finalScore,
    label: level?.label ?? null,
    is_passing: level?.is_passing ?? false,
    assessor_count: scores.length,
    assessed_at: new Date().toISOString(),
    educator_validated: false,
  }, { onConflict: "cycle_id,competency_id" });

  // 5. Recompute domain score (avg of competency scores in same domain)
  if (domainId) await recomputeDomainScore(admin, cycleId, domainId, nurseId, frameworkId);

  // 6. Recompute framework score (avg of domain scores in same framework)
  if (frameworkId) await recomputeFrameworkScore(admin, cycleId, frameworkId);
}

async function recomputeDomainScore(
  admin: ReturnType<typeof createAdminClient>,
  cycleId: string,
  domainId: string,
  nurseId: string | undefined,
  frameworkId: string | undefined
) {
  const { data: compScores } = await admin
    .from("competency_scores")
    .select("score")
    .eq("cycle_id", cycleId)
    .eq("domain_id", domainId)
    .not("score", "is", null);

  if (!compScores?.length) return;

  const avg = compScores.reduce((s, c) => s + c.score, 0) / compScores.length;
  const finalScore = Math.round(avg);

  const { data: level } = await admin
    .from("scoring_levels")
    .select("label, is_passing")
    .eq("scale_id", "00000000-0000-0000-0000-000000000001")
    .eq("score", finalScore)
    .single();

  await admin.from("domain_scores").upsert({
    cycle_id: cycleId,
    domain_id: domainId,
    nurse_id: nurseId,
    framework_id: frameworkId,
    score: avg,
    label: level?.label ?? null,
    is_passing: level?.is_passing ?? false,
    competency_count: compScores.length,
    assessed_at: new Date().toISOString(),
  }, { onConflict: "cycle_id,domain_id" });
}

async function recomputeFrameworkScore(
  admin: ReturnType<typeof createAdminClient>,
  cycleId: string,
  frameworkId: string
) {
  const { data: domainScores } = await admin
    .from("domain_scores")
    .select("score")
    .eq("cycle_id", cycleId)
    .eq("framework_id", frameworkId)
    .not("score", "is", null);

  if (!domainScores?.length) return;

  const avg = domainScores.reduce((s, d) => s + d.score, 0) / domainScores.length;
  const finalScore = Math.round(avg);

  const { data: level } = await admin
    .from("scoring_levels")
    .select("label, is_passing")
    .eq("scale_id", "00000000-0000-0000-0000-000000000001")
    .eq("score", finalScore)
    .single();

  // Update cycle_frameworks with framework score
  await admin.from("cycle_frameworks").update({
    framework_score: avg,
    status: "in_progress",
  }).eq("cycle_id", cycleId).eq("framework_id", frameworkId);

  // Upsert into framework_scores table
  await admin.from("framework_scores").upsert({
    cycle_id: cycleId,
    framework_id: frameworkId,
    score: avg,
    label: level?.label ?? null,
    is_passing: level?.is_passing ?? false,
    domain_count: domainScores.length,
    assessed_at: new Date().toISOString(),
  }, { onConflict: "cycle_id,framework_id" });
}
