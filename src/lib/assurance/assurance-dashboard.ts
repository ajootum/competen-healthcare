/* eslint-disable @typescript-eslint/no-explicit-any */
// CAPA-009 — Organizational Assurance Dashboard. The executive consolidation layer: it COMPOSES all the live CAPA
// engines — assessor reliability (005), competency drift (006), assessment quality (003), evidence integrity
// (004) — plus corrective-action closure (op_quality_actions) into ONE enterprise assurance SCORE with a
// per-domain breakdown and a consolidated, ranked risk list. Every domain score is a real signal from its engine;
// domains with no data are shown honestly (null), not faked. Each risk deep-links to the surface that owns it.
// No new data — pure consolidation. Enterprise-wide (super-admin).

import { loadAssessorReliability } from "@/lib/assurance/assessor-reliability";
import { loadCompetencyDrift } from "@/lib/assurance/competency-drift";
import { loadAssessmentQuality } from "@/lib/assurance/assessment-quality";
import { loadEvidenceIntegrity } from "@/lib/assurance/evidence-integrity";

type Admin = any;

const band = (s: number) => (s >= 85 ? { label: "Assured", tone: "emerald" } : s >= 70 ? { label: "Watch", tone: "amber" } : { label: "At risk", tone: "rose" });
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export async function loadAssuranceDashboard(admin: Admin, hid: string | null, isSuper: boolean) {
  const cnt = (q: any) => Promise.resolve(q).then((r: any) => (r.error ? null : r.count ?? 0)).catch(() => null);
  const [rel, drift, aq, ev, totalActions, completedActions, overdueActions]: any[] = await Promise.all([
    loadAssessorReliability(admin, hid, isSuper).catch(() => ({ provisioned: false })),
    loadCompetencyDrift(admin, hid, isSuper).catch(() => ({ provisioned: false })),
    loadAssessmentQuality(admin, hid, isSuper).catch(() => ({ provisioned: false })),
    loadEvidenceIntegrity(admin, hid, isSuper).catch(() => ({ provisioned: false })),
    cnt(admin.from("op_quality_actions").select("id", { count: "exact", head: true })),
    cnt(admin.from("op_quality_actions").select("id", { count: "exact", head: true }).eq("status", "completed")),
    cnt(admin.from("op_quality_actions").select("id", { count: "exact", head: true }).eq("status", "overdue")),
  ]);

  // ── Per-domain scores (null = no data, shown honestly) ──
  const relJudged = rel?.provisioned && !rel?.empty ? rel.kpis.judged : 0;
  const relScore = relJudged ? clamp((rel.kpis.withinTolerance / relJudged) * 100) : null;
  const driftLive = drift?.provisioned && !drift?.empty;
  const currencyScore = driftLive ? clamp(drift.kpis.achievedPct) : null;
  const stabilityScore = driftLive ? clamp(100 - drift.kpis.driftIndex) : null;
  const aqLive = aq?.provisioned && !aq?.empty;
  const assessmentScore = aqLive ? clamp(aq.kpis.itemHealth) : null;
  const evLive = ev?.provisioned && !ev?.empty;
  const evidenceScore = evLive ? clamp(ev.kpis.verificationRate) : null;
  const capaScore = totalActions ? clamp((completedActions / totalActions) * 100) : null;

  const domains = [
    { key: "Competency currency", score: currencyScore, href: "/super-admin/assurance/drift", note: driftLive ? `${drift.kpis.achievedPct}% of held competencies current` : "no decisions" },
    { key: "Competency stability", score: stabilityScore, href: "/super-admin/assurance/drift", note: driftLive ? `drift index ${drift.kpis.driftIndex}` : "no decisions" },
    { key: "Assessor reliability", score: relScore, href: "/super-admin/assurance/assessor-reliability", note: relJudged ? `${rel.kpis.withinTolerance}/${relJudged} within tolerance` : "no scored assessments" },
    { key: "Assessment quality", score: assessmentScore, href: "/super-admin/assurance/assessment-quality", note: aqLive ? `${aq.kpis.flagged} of ${aq.kpis.items} items flagged` : "no attempts" },
    { key: "Corrective action", score: capaScore, href: "/unit-manager/capa", note: totalActions ? `${completedActions}/${totalActions} closed` : "no actions" },
    { key: "Evidence integrity", score: evidenceScore, href: "/super-admin/assurance/evidence", note: evLive ? `${ev.kpis.verified}/${ev.kpis.total} verified` : "no evidence" },
  ];

  const scored = domains.filter(d => d.score != null) as { key: string; score: number; href: string; note: string }[];
  const overall = scored.length ? clamp(scored.reduce((a, d) => a + d.score, 0) / scored.length) : null;

  // ── Consolidated, ranked risk list ──
  const risks: { tone: string; title: string; detail: string; href: string }[] = [];
  if (driftLive && drift.kpis.highRiskStaff) risks.push({ tone: "red", title: `${drift.kpis.highRiskStaff} staff with critical competency gaps`, detail: "Expired or failing critical competencies on the current record.", href: "/super-admin/assurance/drift" });
  if (driftLive && drift.kpis.expired) risks.push({ tone: "red", title: `${drift.kpis.expired} competencies expired`, detail: "Currency has lapsed — reassessment overdue.", href: "/super-admin/assurance/drift" });
  if (overdueActions) risks.push({ tone: "amber", title: `${overdueActions} corrective actions overdue`, detail: "Improvement actions past their target date.", href: "/unit-manager/capa" });
  if (relJudged && rel.kpis.watchlist) risks.push({ tone: "amber", title: `${rel.kpis.watchlist} assessors outside scoring tolerance`, detail: "Leniency/severity or inconsistency past the peer band — candidates for calibration.", href: "/super-admin/assurance/assessor-reliability" });
  if (aqLive && aq.kpis.flagged) risks.push({ tone: "amber", title: `${aq.kpis.flagged} assessment items flagged`, detail: "Questions too easy/hard or discriminating poorly — review the item bank.", href: "/super-admin/assurance/assessment-quality" });
  if (evLive && ev.kpis.pending) risks.push({ tone: "amber", title: `${ev.kpis.pending} evidence items pending verification`, detail: "Uploaded competency evidence is awaiting review.", href: "/super-admin/assurance/evidence" });
  if (evLive && (ev.kpis.flagged || ev.kpis.expired)) risks.push({ tone: "amber", title: `${ev.kpis.flagged + ev.kpis.expired} evidence integrity issues`, detail: "Flagged or expired evidence needs attention.", href: "/super-admin/assurance/evidence" });
  if (driftLive && drift.kpis.decayed) risks.push({ tone: "gray", title: `${drift.kpis.decayed} competencies decayed on reassessment`, detail: "Maturity dropped or lapsed versus the prior decision.", href: "/super-admin/assurance/drift" });
  if (driftLive && drift.hotspots?.[0]) risks.push({ tone: "gray", title: `Top drift: ${drift.hotspots[0].competency} (${drift.hotspots[0].rate}%)`, detail: `${drift.hotspots[0].drifting} of ${drift.hotspots[0].total} holders drifting.`, href: "/super-admin/assurance/drift" });
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
