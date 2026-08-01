import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// Consensus + rollup recompute, shared by /api/assessments (single-score path)
// and /api/assess/submit (Conduct Assessment session path). Aggregates raw
// per-assessor `assessments` rows into competency_scores, then rolls up to
// domain_scores and framework_scores using the Benner scale (migration 009).

/**
 * ONE SCORE PER ASSESSOR, THE LATEST (XWI P2-12).
 *
 * `assessments` has no uniqueness constraint on (cycle, competency, assessor) -- verified against the live
 * database by inserting a duplicate, which was accepted. A double-submit, a retry on a slow network, or a
 * genuine re-assessment all produce a second row for the same assessor.
 *
 * The engine already knew assessors must be DISTINCT: the quorum check counts
 * `new Set(assessor_id).size`, so a duplicate cannot satisfy min_assessors on its own. It then forgot one
 * line later and averaged every ROW -- so the duplicating assessor carried double weight in the final
 * score, and assessor_count recorded more assessors than had actually assessed. The number a competency
 * decision rests on was wrong, and the record of how many people stood behind it was wrong with it.
 *
 * No unique constraint is added, because a re-assessment after remediation is legitimate. The later score
 * SUPERSEDES the earlier one, which is the same rule the competency-currency reduction applies to
 * decisions.
 */
export function latestPerAssessor<T extends { assessor_id?: string | null; assessed_at?: string | null; created_at?: string | null; id?: string | null }>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const key = r.assessor_id ?? `__row:${r.id ?? Math.random()}`;   // an unattributed row supersedes nothing
    const cur = best.get(key);
    if (!cur) { best.set(key, r); continue; }
    const at = (x: T) => `${x.assessed_at ?? ""}|${x.created_at ?? ""}`;
    if (at(r) > at(cur)) best.set(key, r);
  }
  return [...best.values()];
}

export async function recomputeAll(admin: Admin, cycleId: string, competencyId: string) {
  // 1. Get all complete assessments for this competency in this cycle
  const { data: assessments } = await admin
    .from("assessments")
    .select("id, score, assessor_id, assessed_at, created_at")
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
  // One row per assessor before ANY of this is counted -- quorum, the average, and the recorded
  // assessor_count all have to mean the same thing.
  const perAssessor = latestPerAssessor(assessments);
  const uniqueAssessors = perAssessor.length;

  if (uniqueAssessors < minAssessors) return; // quorum not reached

  const scores = perAssessor.map(a => a.score as number);

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
    assessor_count: uniqueAssessors,   // people, not rows
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
