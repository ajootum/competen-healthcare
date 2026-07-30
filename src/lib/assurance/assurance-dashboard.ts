/* eslint-disable @typescript-eslint/no-explicit-any */
// CAPA-009 — Organizational Assurance Dashboard. The executive consolidation layer: it COMPOSES the live CAPA
// engines (CAPA-005 assessor reliability, CAPA-006 competency drift) plus direct signals (corrective-action
// closure over op_quality_actions, evidence-backed decisions over competency_decisions) into ONE enterprise
// assurance SCORE with a per-domain breakdown and a consolidated, ranked risk list. Every domain score is a mean
// of real signals; domains with no data are shown honestly (null), not faked. Each risk deep-links to the surface
// that owns it. No new data — pure consolidation. Enterprise-wide (super-admin).

import { loadAssessorReliability } from "@/lib/assurance/assessor-reliability";
import { loadCompetencyDrift } from "@/lib/assurance/competency-drift";

type Admin = any;

const band = (s: number) => (s >= 85 ? { label: "Assured", tone: "emerald" } : s >= 70 ? { label: "Watch", tone: "amber" } : { label: "At risk", tone: "rose" });
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export async function loadAssuranceDashboard(admin: Admin, hid: string | null, isSuper: boolean) {
  const cnt = (q: any) => Promise.resolve(q).then((r: any) => (r.error ? null : r.count ?? 0)).catch(() => null);
  const [rel, drift, totalActions, completedActions, overdueActions, totalDec, evidencedDec]: any[] = await Promise.all([
    loadAssessorReliability(admin, hid, isSuper).catch(() => ({ provisioned: false })),
    loadCompetencyDrift(admin, hid, isSuper).catch(() => ({ provisioned: false })),
    cnt(admin.from("op_quality_actions").select("id", { count: "exact", head: true })),
    cnt(admin.from("op_quality_actions").select("id", { count: "exact", head: true }).eq("status", "completed")),
    cnt(admin.from("op_quality_actions").select("id", { count: "exact", head: true }).eq("status", "overdue")),
    cnt(admin.from("competency_decisions").select("id", { count: "exact", head: true })),
    cnt(admin.from("competency_decisions").select("id", { count: "exact", head: true }).not("evidence_summary", "is", null)),
  ]);

  // ── Per-domain scores (null = no data, shown honestly) ──
  const relJudged = rel?.provisioned && !rel?.empty ? rel.kpis.judged : 0;
  const relScore = relJudged ? clamp((rel.kpis.withinTolerance / relJudged) * 100) : null;
  const driftLive = drift?.provisioned && !drift?.empty;
  const currencyScore = driftLive ? clamp(drift.kpis.achievedPct) : null;
  const stabilityScore = driftLive ? clamp(100 - drift.kpis.driftIndex) : null;
  const capaScore = totalActions ? clamp((completedActions / totalActions) * 100) : null;
  const evidenceScore = totalDec ? clamp((evidencedDec / totalDec) * 100) : null;

  const domains = [
    { key: "Competency currency", score: currencyScore, href: "/super-admin/assurance/drift", note: driftLive ? `${drift.kpis.achievedPct}% of held competencies current` : "no decisions" },
    { key: "Competency stability", score: stabilityScore, href: "/super-admin/assurance/drift", note: driftLive ? `drift index ${drift.kpis.driftIndex}` : "no decisions" },
    { key: "Assessor reliability", score: relScore, href: "/super-admin/assurance/assessor-reliability", note: relJudged ? `${rel.kpis.withinTolerance}/${relJudged} within tolerance` : "no scored assessments" },
    { key: "Corrective action", score: capaScore, href: "/unit-manager/capa", note: totalActions ? `${completedActions}/${totalActions} closed` : "no actions" },
    { key: "Evidence integrity", score: evidenceScore, href: "/super-admin/assurance", note: totalDec ? `${evidencedDec}/${totalDec} decisions evidenced` : "no decisions" },
  ];

  const scored = domains.filter(d => d.score != null) as { key: string; score: number; href: string; note: string }[];
  const overall = scored.length ? clamp(scored.reduce((a, d) => a + d.score, 0) / scored.length) : null;

  // ── Consolidated, ranked risk list ──
  const risks: { tone: string; title: string; detail: string; href: string }[] = [];
  if (driftLive && drift.kpis.highRiskStaff) risks.push({ tone: "red", title: `${drift.kpis.highRiskStaff} staff with critical competency gaps`, detail: "Expired or failing critical competencies on the current record.", href: "/super-admin/assurance/drift" });
  if (driftLive && drift.kpis.expired) risks.push({ tone: "red", title: `${drift.kpis.expired} competencies expired`, detail: "Currency has lapsed — reassessment overdue.", href: "/super-admin/assurance/drift" });
  if (overdueActions) risks.push({ tone: "amber", title: `${overdueActions} corrective actions overdue`, detail: "Improvement actions past their target date.", href: "/unit-manager/capa" });
  if (relJudged && rel.kpis.watchlist) risks.push({ tone: "amber", title: `${rel.kpis.watchlist} assessors outside scoring tolerance`, detail: "Leniency/severity or inconsistency past the peer band — candidates for calibration.", href: "/super-admin/assurance/assessor-reliability" });
  if (driftLive && drift.kpis.decayed) risks.push({ tone: "amber", title: `${drift.kpis.decayed} competencies decayed on reassessment`, detail: "Maturity dropped or lapsed versus the prior decision.", href: "/super-admin/assurance/drift" });
  if (driftLive && drift.hotspots?.[0]) risks.push({ tone: "gray", title: `Top drift: ${drift.hotspots[0].competency} (${drift.hotspots[0].rate}%)`, detail: `${drift.hotspots[0].drifting} of ${drift.hotspots[0].total} holders drifting.`, href: "/super-admin/assurance/drift" });
  if (evidenceScore != null && evidenceScore < 60) risks.push({ tone: "amber", title: `Evidence completeness ${evidenceScore}%`, detail: "A large share of competency decisions carry no evidence summary.", href: "/super-admin/assurance" });
  const TONE_RANK: Record<string, number> = { red: 0, amber: 1, gray: 2 };
  risks.sort((a, b) => (TONE_RANK[a.tone] ?? 3) - (TONE_RANK[b.tone] ?? 3));

  const provisioned = overall != null;
  return {
    provisioned,
    overall,
    band: overall != null ? band(overall) : null,
    domains,
    scoredCount: scored.length,
    risks,
    trend: driftLive ? drift.trend : [],
    headline: {
      assessed: driftLive ? drift.kpis.assessed : 0,
      assessors: rel?.provisioned && !rel?.empty ? rel.kpis.assessors : 0,
      actions: totalActions ?? 0,
      highRisk: driftLive ? drift.kpis.highRiskStaff : 0,
    },
  };
}
