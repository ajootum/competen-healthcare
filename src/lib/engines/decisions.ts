import { createAdminClient } from "@/lib/supabase/server";
import type { DecisionOutcome, Maturity } from "@/lib/ckcm";
import { generatePathwayForNurse } from "@/lib/engines/pathways";

type Admin = ReturnType<typeof createAdminClient>;

/** Benner maturity from a 0–6 score. */
export function maturityFromScore(score: number): Maturity {
  if (score <= 1) return "novice";
  if (score === 2) return "advanced_beginner";
  if (score <= 4) return "competent";
  if (score === 5) return "proficient";
  return "expert";
}

/**
 * Derive a governed competency outcome from a validated score.
 * Critical failure always blocks competency regardless of score (Book I Ch.10).
 */
export function outcomeFor(
  score: number | null,
  isPassing: boolean,
  validated: boolean,
  criticalFailure: boolean,
): DecisionOutcome {
  if (criticalFailure) return "not_yet_competent";
  if (score == null) return "not_yet_competent";
  if (isPassing) return validated ? "competent" : "provisionally_competent";
  if (score >= 2) return "requires_remediation";
  return "not_yet_competent";
}

/**
 * Generate formal competency decisions for every scored competency in a cycle.
 * Idempotent-ish: supersedes any prior decision rows for the same nurse+competency
 * in this cycle by inserting a fresh versioned decision.
 */
export async function generateDecisionsForCycle(
  admin: Admin,
  cycleId: string,
  decidedBy: string | null,
  decidedByName: string | null,
): Promise<{ created: number }> {
  const { data: cycle } = await admin
    .from("competency_cycles")
    .select("nurse_id")
    .eq("id", cycleId)
    .single();
  if (!cycle) return { created: 0 };
  const nurseId = cycle.nurse_id as string;

  // Validated/aggregated scores for this cycle
  const { data: scores } = await admin
    .from("competency_scores")
    .select("competency_id, domain_id, framework_id, score, is_passing, educator_validated")
    .eq("cycle_id", cycleId);
  if (!scores?.length) return { created: 0 };

  // Reassessment interval: competency → CPU → blueprint/CPU months (default 12)
  const compIds = scores.map(s => s.competency_id);
  const { data: comps } = await admin
    .from("framework_competencies")
    .select("id, cpu_id")
    .in("id", compIds)
    .returns<{ id: string; cpu_id: string | null }[]>();
  const cpuByComp = new Map((comps ?? []).map(c => [c.id, c.cpu_id]));

  const cpuIds = [...new Set((comps ?? []).map(c => c.cpu_id).filter(Boolean))] as string[];
  const cpuMonths = new Map<string, number>();
  if (cpuIds.length) {
    const { data: cpus } = await admin
      .from("clinical_practice_units")
      .select("id, reassessment_months")
      .in("id", cpuIds)
      .returns<{ id: string; reassessment_months: number | null }[]>();
    for (const c of cpus ?? []) cpuMonths.set(c.id, c.reassessment_months ?? 12);
  }

  // Any critical-failure evidence flagged on these assessments?
  const { data: critAssessments } = await admin
    .from("assessments")
    .select("competency_id")
    .eq("cycle_id", cycleId)
    .eq("score", 0)
    .returns<{ competency_id: string }[]>();
  const zeroScored = new Set((critAssessments ?? []).map(a => a.competency_id));

  const today = new Date();
  const rows = scores.map(s => {
    const score = s.score as number | null;
    const isPassing = !!s.is_passing;
    const validated = !!s.educator_validated;
    const criticalFailure = zeroScored.has(s.competency_id);
    const outcome = outcomeFor(score, isPassing, validated, criticalFailure);

    const cpuId = cpuByComp.get(s.competency_id) ?? null;
    const months = (cpuId && cpuMonths.get(cpuId)) || 12;
    const expiry = new Date(today);
    expiry.setMonth(expiry.getMonth() + months);
    const passing = outcome === "competent" || outcome === "provisionally_competent" || outcome === "competent_with_conditions";

    return {
      cycle_id: cycleId,
      nurse_id: nurseId,
      cpu_id: cpuId,
      competency_id: s.competency_id,
      framework_id: s.framework_id,
      outcome,
      maturity: score != null ? maturityFromScore(score) : null,
      decided_by: decidedBy,
      decided_by_name: decidedByName,
      effective_date: today.toISOString().slice(0, 10),
      expiry_date: passing ? expiry.toISOString().slice(0, 10) : null,
      critical_failure: criticalFailure,
      validated_by: validated ? decidedBy : null,
      validated_at: validated ? today.toISOString() : null,
      validation_outcome: validated ? "validated" : null,
    };
  });

  // Replace any existing decisions for this cycle so re-running reflects latest scores
  await admin.from("competency_decisions").delete().eq("cycle_id", cycleId);
  const { error } = await admin.from("competency_decisions").insert(rows);
  if (error) throw new Error(error.message);

  // Refresh the nurse's learning pathway from the new decision gaps (best-effort)
  try { await generatePathwayForNurse(admin, nurseId); } catch { /* non-fatal */ }

  return { created: rows.length };
}
