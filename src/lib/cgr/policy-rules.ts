/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-008 — Competency Governance Policy & Rules Engine.
// Makes the governance rules EXPLICIT and shows population compliance per rule. The rules the platform actually
// enforces are scattered across real stores + the registry's completeness criteria; this consolidates them into
// one ruleset with live compliance, plus the configured thresholds that ARE stored:
//   • Compliance rules (§5.1-5.5) — ownership / regulatory / review-currency / evidence / framework-approval,
//     evaluated over the CGR-001 registry (the % of competencies that satisfy each).
//   • Risk-tiered policy (§5.4 / §9) — governance posture by risk tier (critical→low): the concrete "high-risk
//     needs stricter governance" view, from the registry.
//   • Configured thresholds — the real stored governance config: review intervals by risk
//     (clinical_practice_units.reassessment_months), approval rules (assessment_blueprints min_score /
//     min_assessors / consensus_rule) and evidence rules (evidence_matrix count / critical / validity).
// Authoring rules/policies lives in policy-manager + studio/rules (cross-linked). No migration; read model.

import { loadGovernanceRegistry } from "@/lib/cgr/registry";

type Admin = any;
const RISKS = ["critical", "high", "standard", "low"] as const;

export async function loadPolicyRules(admin: Admin) {
  const [reg, cpuRes, bpRes, emRes] = await Promise.all([
    loadGovernanceRegistry(admin).catch(() => ({ provisioned: false } as any)),
    admin.from("clinical_practice_units").select("risk_category, reassessment_months").limit(3000),
    admin.from("assessment_blueprints").select("min_score, min_assessors, consensus_rule").limit(3000),
    admin.from("evidence_matrix").select("is_critical, validity_months").limit(5000),
  ]);

  const r: any = reg?.provisioned ? reg : null;
  const recs: any[] = r ? r.records : [];
  const n = recs.length;
  const pct = (x: number) => (n ? Math.round((x / n) * 100) : 0);

  const reviewOk = recs.filter((x) => x.reviewDue && !x.reviewOverdue).length;
  const evidenceOk = recs.filter((x) => x.decisions > 0).length;
  const fwApproved = recs.filter((x) => x.frameworkStatus === "approved" || x.frameworkStatus === "published").length;

  const rules = r
    ? [
        { category: "Ownership", name: "Every competency has an accountable owner", compliance: r.kpis.ownerPct, met: r.kpis.withOwner, total: n },
        { category: "Compliance", name: "Every competency maps to ≥1 regulatory standard", compliance: r.kpis.standardsPct, met: r.kpis.withStandards, total: n },
        { category: "Lifecycle", name: "Review date is set and current (not overdue)", compliance: pct(reviewOk), met: reviewOk, total: n },
        { category: "Evidence", name: "Governed evidence supports the competency", compliance: r.kpis.evidencePct, met: evidenceOk, total: n },
        { category: "Approval", name: "Parent framework is approved or published", compliance: pct(fwApproved), met: fwApproved, total: n },
      ]
    : [];
  const avgCompliance = rules.length ? Math.round(rules.reduce((s, x) => s + x.compliance, 0) / rules.length) : null;

  const tiers = RISKS.map((risk) => {
    const t = recs.filter((x) => x.risk === risk);
    const c = t.length;
    if (!c) return null;
    return {
      risk,
      count: c,
      ownerPct: Math.round((t.filter((x) => x.owner).length / c) * 100),
      mappedPct: Math.round((t.filter((x) => x.standards > 0).length / c) * 100),
      reviewPct: Math.round((t.filter((x) => x.reviewDue && !x.reviewOverdue).length / c) * 100),
      avgScore: Math.round(t.reduce((s, x) => s + x.score, 0) / c),
    };
  }).filter(Boolean) as any[];

  // Configured review intervals by CPU risk tier.
  const cpus = (cpuRes.error ? [] : cpuRes.data ?? []) as any[];
  const reviewByRisk = RISKS.map((rc) => {
    const g = cpus.filter((c) => (c.risk_category ?? "standard") === rc);
    return g.length ? { risk: rc, count: g.length, avgMonths: Math.round(g.reduce((s, c) => s + (c.reassessment_months ?? 12), 0) / g.length) } : null;
  }).filter(Boolean) as any[];

  // Approval rules from blueprints.
  const bps = (bpRes.error ? [] : bpRes.data ?? []) as any[];
  const consensus = new Map<string, number>();
  let sumScore = 0, sumAssessors = 0;
  for (const b of bps) {
    consensus.set(b.consensus_rule ?? "any", (consensus.get(b.consensus_rule ?? "any") ?? 0) + 1);
    sumScore += b.min_score ?? 0;
    sumAssessors += b.min_assessors ?? 0;
  }
  const approvalRules = {
    count: bps.length,
    avgMinScore: bps.length ? (sumScore / bps.length).toFixed(1) : null,
    avgMinAssessors: bps.length ? (sumAssessors / bps.length).toFixed(1) : null,
    consensus: [...consensus.entries()].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count),
  };

  // Evidence rules from the evidence matrix.
  const ems = (emRes.error ? [] : emRes.data ?? []) as any[];
  const evidenceRules = {
    count: ems.length,
    critical: ems.filter((e) => e.is_critical).length,
    avgValidityMonths: ems.length ? Math.round(ems.reduce((s, e) => s + (e.validity_months ?? 12), 0) / ems.length) : null,
  };

  return {
    provisioned: !!r || cpus.length > 0 || bps.length > 0 || ems.length > 0,
    hasRegistry: !!r,
    n,
    rules,
    avgCompliance,
    tiers,
    reviewByRisk,
    approvalRules,
    evidenceRules,
    cpuCount: cpus.length,
  };
}
