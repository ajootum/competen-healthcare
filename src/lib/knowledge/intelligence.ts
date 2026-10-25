/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { COHORT_DIMENSIONS, DATA_CONTRACT_VERSION, MEASURES, measureByCode, type CohortDimension, type MeasureCode } from "./data-contracts";
import { dbRefusal, type CkriPolicy } from "./governance";

// ── CKRI AGGREGATE INTELLIGENCE ── COMPETEN-KNOWLEDGE-RESEARCH-01 s4 (K2), migration 441 ───────────────────────────
//
// ⚠ THE APPLICATION NEVER SEES A ROW OF LEARNER EVIDENCE. ckri_build_snapshot (441) reads Scholar's structured records,
// applies the population (collective_analytics granted at build time), suppresses, rounds and stores cells. This file
// asks for a build with the published policy's settings and reads cells back. It names no individual_scholar_ table
// (harness K1-7).
//
// ⚠ SUPPRESSED IS NOT ZERO. A suppressed cell has no figure in the database (CHECK), and is shown as suppressed with
// the minimum that hid it -- never as 0 or blank.

export const RATE_MEANING: Record<MeasureCode, { rate?: string; rate_b?: string; rate_c?: string; events: string }> = {
  outcome_coverage: { events: "accepted mappings" },
  knowledge_gap: { rate: "share correct", events: "answers" },
  retention: { rate: "share still correct 7+ days after a correct answer", events: "later answers" },
  reasoning_difficulty: { rate: "share correct (deterministic marking)", rate_b: "share raising a safety criterion", rate_c: "share correct (AI-marked, not validated)", events: "decision points" },
  evaluation_performance: { events: "pending" },
  resource_demand: { events: "sessions" },
};

/** Pure: the policy version a snapshot records -- a hash of the resolved policy, so the same settings name themselves. */
export function policyVersion(p: CkriPolicy): string {
  return `ckri-policy:${createHash("sha256").update(JSON.stringify(p)).digest("hex").slice(0, 16)}`;
}

/** Pure: may this measure and dimension be built under this policy? */
export function buildRefusal(p: CkriPolicy, measure: string, dimension: string): string | null {
  const m = measureByCode(measure);
  if (!m) return "Unknown measure.";
  if (m.status !== "available") return `${m.label} is not available yet: ${m.limits}`;
  if (!p.measures[m.code]) return `${m.label} is switched off in the published CKRI policy.`;
  if (dimension !== "none" && !(COHORT_DIMENSIONS as readonly string[]).includes(dimension)) return "Unknown cohort dimension.";
  if (dimension !== "none" && !p.cohortDimensions.includes(dimension as CohortDimension)) return `Grouping by ${dimension} is switched off in the published CKRI policy.`;
  return null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function buildSnapshot(admin: any, actor: string, p: CkriPolicy, req: { measure: string; from: string; to: string; dimension: string })
  : Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const refusal = buildRefusal(p, req.measure, req.dimension);
  if (refusal) return { ok: false, error: refusal };
  if (!DAY.test(req.from) || !DAY.test(req.to) || req.to <= req.from) return { ok: false, error: "Give a period: a start date before an end date." };
  const { data, error } = await admin.rpc("ckri_build_snapshot", {
    p_measure: req.measure, p_from: req.from, p_to: req.to, p_grain: p.periodGrain, p_dimension: req.dimension,
    p_min: p.minCohort, p_round: p.roundTo, p_complementary: p.complementarySuppression,
    p_contract_version: DATA_CONTRACT_VERSION, p_policy_version: policyVersion(p), p_retain_days: p.snapshotRetentionDays, p_actor: actor,
  });
  if (error) return { ok: false, error: dbRefusal({ message: String(error.message ?? "").replace(/^ckri_build_snapshot/, "ckri_snapshot") }, "The snapshot could not be built.") };
  return { ok: true, id: data as string };
}

export async function listSnapshots(admin: any, measures?: MeasureCode[]) {
  let q = admin.from("ckri_snapshot").select("id, measure, period_grain, period_from, period_to, cohort_dimension, min_cohort, round_to, complementary, contract_version, policy_version, builder_version, population_rounded, cells_reported, cells_suppressed, built_at, retain_until")
    .order("built_at", { ascending: false }).limit(50);
  if (measures) q = q.in("measure", measures.length ? measures : ["(none)"]);
  const { data, error } = await q;
  return error ? null : (data ?? []);
}

export type Cell = { subject: string; subjectKind: string; subjectRef: string; cohort: string; period: string; suppressed: boolean; participants: number | null; events: number | null; rate: number | null; rate_b: number | null; rate_c: number | null };

/** A snapshot and its cells, with each subject's public catalogue name. */
export async function readSnapshot(admin: any, id: string, allowedMeasures?: MeasureCode[]) {
  const { data: s, error } = await admin.from("ckri_snapshot").select("*").eq("id", id).maybeSingle();
  if (error || !s) return null;
  if (allowedMeasures && !allowedMeasures.includes(s.measure)) return null;
  const { data: cells, error: ce } = await admin.from("ckri_snapshot_cell").select("subject_kind, subject_ref, cohort_value, period_start, suppressed, participants, events, rate, rate_b, rate_c")
    .eq("snapshot_id", id).order("period_start").limit(5000);
  if (ce) return null;
  const comp = [...new Set((cells ?? []).filter((c: any) => c.subject_kind === "competency").map((c: any) => c.subject_ref))];
  const cases = [...new Set((cells ?? []).filter((c: any) => c.subject_kind === "library_case").map((c: any) => c.subject_ref))];
  const [cn, kn] = await Promise.all([
    comp.length ? admin.from("framework_competencies").select("id, name").in("id", comp) : { data: [] },
    cases.length ? admin.from("case_library_case").select("id, code, title").in("id", cases) : { data: [] },
  ]);
  const names = new Map<string, string>([...(cn.data ?? []).map((r: any) => [r.id, r.name]), ...(kn.data ?? []).map((r: any) => [r.id, r.title ?? r.code])]);
  const out: Cell[] = (cells ?? []).map((c: any) => ({
    subject: names.get(c.subject_ref) ?? "(no longer in the catalogue)", subjectKind: c.subject_kind, subjectRef: c.subject_ref, cohort: c.cohort_value, period: c.period_start,
    suppressed: c.suppressed, participants: c.participants, events: c.events, rate: c.rate === null ? null : Number(c.rate), rate_b: c.rate_b === null ? null : Number(c.rate_b), rate_c: c.rate_c === null ? null : Number(c.rate_c),
  }));
  return { snapshot: s, cells: out, measure: MEASURES.find(m => m.code === s.measure)!, meaning: RATE_MEANING[s.measure as MeasureCode] };
}

export async function purgeExpired(admin: any): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc("ckri_purge_expired_snapshots");
  return error ? { ok: false, error: "Expired snapshots could not be purged." } : { ok: true, deleted: Number(data ?? 0) };
}
