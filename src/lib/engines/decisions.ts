import { createAdminClient } from "@/lib/supabase/server";
import { generatePathwayForNurse } from "@/lib/engines/pathways";
import { maturityFromScore, outcomeFor } from "@/lib/engines/outcomes";
import { transitionLifecycle, mapDecisionToState } from "@/lib/competency/lifecycle-state";
import { notify } from "@/lib/notify";

export { maturityFromScore, outcomeFor };

type Admin = ReturnType<typeof createAdminClient>;

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

  // Employer stamp (Lifetime Passport spec §6): decisions carry the employer
  // at decision time so the competency's provenance survives job changes.
  const { data: placement } = await admin
    .from("profiles").select("hospital_id, organisation_id").eq("id", nurseId).single();

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

  // XWI P2-10 — WHICH VERSION OF THE STANDARD WAS THIS JUDGED AGAINST?
  // The row already records which framework a decision belongs to and not which version of it was in
  // force. "Found competent" and "found competent against version 1.0.0" are different claims, and only
  // the second survives the standard being revised. Read here, at decision time, because reading it later
  // gives you today's version rather than the one that applied.
  //
  // The semver columns, not the numeric version_num: version_num is 0 on all 15 frameworks while the
  // semver carries the real 1.0.0, so stamping the field that is actually maintained is the point.
  const fwIds = [...new Set((scores ?? []).map((s: { framework_id: string | null }) => s.framework_id).filter(Boolean))] as string[];
  const fwVersion = new Map<string, string>();
  if (fwIds.length) {
    const { data: fws } = await admin
      .from("frameworks")
      .select("id, version_major, version_minor, version_revision")
      .in("id", fwIds)
      .returns<{ id: string; version_major: number | null; version_minor: number | null; version_revision: number | null }[]>();
    for (const f of fws ?? []) {
      // Absent parts read as 0 rather than being skipped: "1.0.0" is a claim, "1..0" is a bug.
      fwVersion.set(f.id, `${f.version_major ?? 0}.${f.version_minor ?? 0}.${f.version_revision ?? 0}`);
    }
  }

  // Any critical-failure evidence flagged on these assessments?
  const { data: critAssessments } = await admin
    .from("assessments")
    .select("competency_id")
    .eq("cycle_id", cycleId)
    .eq("score", 0)
    .returns<{ competency_id: string }[]>();
  const zeroScored = new Set((critAssessments ?? []).map(a => a.competency_id));

  // Evidence sufficiency (§E): documentary evidence the learner has linked to these
  // competencies. Wired into each decision below — recorded as the decision's
  // evidentiary basis (evidence_summary), and a validated 'competent' sign-off with
  // NO evidence on file is stepped to competent_with_conditions (still passing; the
  // condition is that supporting evidence be filed). Direct assessment stays primary.
  const { data: evidenceRows } = await admin
    .from("evidence")
    .select("competency_id, file_name, note")
    .eq("owner_id", nurseId)
    .in("competency_id", compIds)
    .returns<{ competency_id: string | null; file_name: string | null; note: string | null }[]>();
  const evByComp = new Map<string, { count: number; labels: string[] }>();
  for (const e of evidenceRows ?? []) {
    if (!e.competency_id) continue;
    const g = evByComp.get(e.competency_id) ?? { count: 0, labels: [] };
    g.count++;
    if (g.labels.length < 3) g.labels.push((e.note?.trim() || e.file_name || "evidence").slice(0, 60));
    evByComp.set(e.competency_id, g);
  }

  // ARCHIVE BEFORE REPLACE (XWI P2-10) -- read the decisions this run will overwrite, before building
  // their replacements, so each replacement can carry the next version number.
  const prior = await admin.from("competency_decisions").select("*").eq("cycle_id", cycleId);
  if (prior.error) throw new Error(prior.error.message);
  const priorRows = (prior.data ?? []) as Record<string, unknown>[];
  const priorVersion = new Map<string, number>();
  for (const p of priorRows) {
    const k = String(p.competency_id);
    priorVersion.set(k, Math.max(priorVersion.get(k) ?? 0, Number(p.version_num) || 1));
  }

  const today = new Date();
  const rows = scores.map(s => {
    const score = s.score as number | null;
    const isPassing = !!s.is_passing;
    const validated = !!s.educator_validated;
    const criticalFailure = zeroScored.has(s.competency_id);
    const baseOutcome = outcomeFor(score, isPassing, validated, criticalFailure);

    // Evidence as an input: record the evidentiary basis, and step a validated
    // 'competent' with no filed evidence to competent_with_conditions.
    const ev = evByComp.get(s.competency_id);
    const evCount = ev?.count ?? 0;
    const outcome = baseOutcome === "competent" && evCount === 0 ? "competent_with_conditions" : baseOutcome;
    const evidenceSummary = evCount > 0
      ? `${evCount} evidence item${evCount === 1 ? "" : "s"} on file: ${ev!.labels.join("; ")}${evCount > ev!.labels.length ? "; …" : ""}.`
      : baseOutcome === "competent"
        ? "Competent on assessment; no documentary evidence filed — supporting evidence to be added."
        : "No documentary evidence linked.";

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
      framework_version: s.framework_id ? (fwVersion.get(s.framework_id) ?? null) : null,
      version_num: (priorVersion.get(s.competency_id) ?? 0) + 1,
      outcome,
      maturity: score != null ? maturityFromScore(score) : null,
      decided_by: decidedBy,
      decided_by_name: decidedByName,
      effective_date: today.toISOString().slice(0, 10),
      expiry_date: passing ? expiry.toISOString().slice(0, 10) : null,
      critical_failure: criticalFailure,
      evidence_summary: evidenceSummary,
      validated_by: validated ? decidedBy : null,
      validated_at: validated ? today.toISOString() : null,
      validation_outcome: validated ? "validated" : null,
      hospital_id: placement?.hospital_id ?? null,
      organisation_id: placement?.organisation_id ?? null,
    };
  });

  // Re-running a cycle used to DELETE its decisions outright, destroying the record that a clinician was
  // ever found not_yet_competent, suspended or in critical failure. The docblock above has always claimed
  // this function "supersedes ... by inserting a fresh versioned decision"; it did not, and every one of
  // the 77 live decisions still sat at version_num 1 because the row that would have been version 1 was
  // deleted first.
  if (priorRows.length) {
    // ON CONFLICT DO NOTHING on decision_id: if a previous run archived these rows but failed before the
    // delete, retrying must be possible. Without this the engine would deadlock on its own successful
    // first half and the cycle could never be re-run.
    const { error: histErr } = await admin.from("competency_decision_history").upsert(priorRows.map(p => ({
      decision_id: p.id, cycle_id: p.cycle_id, nurse_id: p.nurse_id, cpu_id: p.cpu_id,
      competency_id: p.competency_id, framework_id: p.framework_id, framework_version: p.framework_version ?? null,
      outcome: p.outcome, maturity: p.maturity, decided_by: p.decided_by, decided_by_name: p.decided_by_name,
      effective_date: p.effective_date, expiry_date: p.expiry_date, evidence_summary: p.evidence_summary,
      critical_failure: p.critical_failure, validated_by: p.validated_by, validated_at: p.validated_at,
      validation_outcome: p.validation_outcome, version_num: p.version_num ?? 1,
      hospital_id: p.hospital_id ?? null, organisation_id: p.organisation_id ?? null,
      decided_at: p.created_at, superseded_by: decidedBy, supersede_reason: "Cycle decisions re-run",
    })), { onConflict: "decision_id", ignoreDuplicates: true });
    // DELIBERATELY NOT FAIL-SOFT. If the archive cannot be written the delete below would destroy the
    // record with nothing kept -- silently restoring exactly the bug this replaces. A decision run that
    // cannot preserve what it is about to overwrite must not run.
    if (histErr) {
      throw new Error(
        /does not exist|schema cache/i.test(histErr.message)
          ? "Run migration 182 (competency_decision_history) before re-running cycle decisions - the previous decisions cannot be archived and must not be discarded."
          : `Could not archive prior decisions: ${histErr.message}`,
      );
    }
  }

  await admin.from("competency_decisions").delete().eq("cycle_id", cycleId);
  let { error } = await admin.from("competency_decisions").insert(rows);
  if (error && /hospital_id|organisation_id/.test(error.message)) {
    // Migration 027 not applied yet — insert without the employer stamp
    ({ error } = await admin.from("competency_decisions")
      .insert(rows.map(r => Object.fromEntries(
        Object.entries(r).filter(([k]) => k !== "hospital_id" && k !== "organisation_id")))));
  }
  if (error) throw new Error(error.message);

  // COMP-017 — advance the persisted competency lifecycle state for each decided competency (fail-soft; migration 126).
  for (const r of rows) {
    await transitionLifecycle(admin, { hospitalId: r.hospital_id ?? null, nurseId, competencyId: r.competency_id, toState: mapDecisionToState(r.outcome, r.expiry_date), reason: "Assessment decision recorded" });
  }

  // Refresh the nurse's learning pathway from the new decision gaps (best-effort)
  try { await generatePathwayForNurse(admin, nurseId); } catch { /* non-fatal */ }

  const passingCount = rows.filter(r => r.expiry_date).length;
  await notify([nurseId], {
    type: "decisions_issued",
    title: "New competency decisions issued",
    body: `${rows.length} decision${rows.length === 1 ? "" : "s"} recorded${passingCount ? ` (${passingCount} passing)` : ""} by ${decidedByName ?? "your organisation"}`,
    href: "/dashboard/passport",
  });

  return { created: rows.length };
}
