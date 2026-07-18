import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// Consensus + rollup recompute, shared by /api/assessments (single-score path)
// and /api/assess/submit (Conduct Assessment session path). Aggregates raw
// per-assessor `assessments` rows into competency_scores, then rolls up to
// domain_scores and framework_scores using the Benner scale (migration 009).

export async function recomputeAll(admin: Admin, cycleId: string, competencyId: string) {
  // 1. Get all complete assessments for this competency in this cycle
  const { data: assessments } = await admin
    .from("assessments")
    .select("score, assessor_id")
    .eq("cycle_id", cycleId)
    .eq("competency_id", competencyId)
    .eq("status", "complete")
    .not("score", "is", null);

  if (!assessments?.length) return;

  // 2. Check consensus rule — only finalise once min_assessors have submitted
  const { data: cycle } = await admin
    .from("competency_cycles")
    .select("min_assessors, consensus_rule")
    .eq("id", cycleId)
    .returns<{ min_assessors?: number | null; consensus_rule?: string | null }[]>()
    .single();

  const minAssessors = cycle?.min_assessors ?? 1;
  const consensusRule = cycle?.consensus_rule ?? "any";
  const uniqueAssessors = new Set(assessments.map(a => a.assessor_id)).size;

  if (uniqueAssessors < minAssessors) return; // quorum not reached

  const scores = assessments.map(a => a.score as number);

  let finalScore: number;
  if (consensusRule === "unanimous") {
    // All scores must agree — use lowest (most conservative)
    finalScore = Math.min(...scores);
  } else {
    // majority or any — use mean
    finalScore = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  }

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
  admin: Admin,
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
  admin: Admin,
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
