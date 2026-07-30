/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-011 — Competency Governance Compliance Reporting & Regulatory Assurance.
// "Can we demonstrate, through reliable evidence, that our competency system meets regulatory, organisational and
// professional requirements?" Composes two real sources into a compliance report — nothing fabricated:
//   • CGR-001 registry — the §8 compliance-scoring dimensions (coverage/ownership, evidence quality, review
//     currency, regulatory alignment, governance maturity) → a compliance score + risk rating + evidence-pack
//     summary (§9).
//   • cmo_accreditations (mig 115) — the real accreditation REQUIREMENT register: per standard (JCI/…), each
//     requirement's compliance_status (compliant/partial/gap/not_mapped), coverage_pct and evidence_count →
//     the §7 Requirement → Evidence → Status → Action framework + accreditation-readiness by standard.
// Report BUILDING / submission stays owned by QAW accreditation + report datasets — cross-linked. No migration.

import { loadGovernanceRegistry } from "@/lib/cgr/registry";

type Admin = any;
const STATUS_SEV: Record<string, number> = { not_mapped: 0, gap: 1, partial: 2, compliant: 3 };

export async function loadComplianceReporting(admin: Admin) {
  const [reg, accRes] = await Promise.all([
    loadGovernanceRegistry(admin).catch(() => ({ provisioned: false } as any)),
    admin.from("cmo_accreditations").select("standard, requirement, mapped_competency, coverage_pct, compliance_status, evidence_count").limit(3000),
  ]);

  const r: any = reg?.provisioned ? reg : null;
  const recs: any[] = r ? r.records : [];
  const n = recs.length;
  const pct = (x: number) => (n ? Math.round((x / n) * 100) : 0);

  const reviewOk = recs.filter((x) => x.reviewDue && !x.reviewOverdue).length;

  const dimensions = r
    ? [
        { label: "Competency coverage", pct: r.kpis.ownerPct },
        { label: "Evidence quality", pct: r.kpis.evidencePct },
        { label: "Review currency", pct: pct(reviewOk) },
        { label: "Regulatory alignment", pct: r.kpis.standardsPct },
        { label: "Governance maturity", pct: r.kpis.avgScore },
      ]
    : [];
  const complianceScore = dimensions.length ? Math.round(dimensions.reduce((s, x) => s + x.pct, 0) / dimensions.length) : null;
  const riskRating = complianceScore == null ? "—" : complianceScore >= 80 ? "Low" : complianceScore >= 60 ? "Moderate" : complianceScore >= 40 ? "High" : "Critical";

  const acc = (accRes.error ? [] : accRes.data ?? []) as any[];
  const byStandard = new Map<string, any>();
  for (const a of acc) {
    const s = a.standard || "Other";
    const e = byStandard.get(s) ?? { compliant: 0, partial: 0, gap: 0, not_mapped: 0, total: 0, evidence: 0, covSum: 0, covN: 0 };
    e.total++;
    if (a.compliance_status in e) e[a.compliance_status]++;
    e.evidence += a.evidence_count ?? 0;
    if (a.coverage_pct != null) { e.covSum += a.coverage_pct; e.covN++; }
    byStandard.set(s, e);
  }
  const standards = [...byStandard.entries()]
    .map(([standard, e]) => ({
      standard,
      requirements: e.total,
      compliant: e.compliant,
      partial: e.partial,
      gap: e.gap + e.not_mapped,
      evidence: e.evidence,
      readiness: e.total ? Math.round((e.compliant / e.total) * 100) : 0,
      avgCoverage: e.covN ? Math.round(e.covSum / e.covN) : null,
    }))
    .sort((a, b) => a.readiness - b.readiness);

  const requirements = acc
    .filter((a) => a.compliance_status !== "compliant")
    .map((a) => ({ standard: a.standard ?? "Other", requirement: a.requirement, mapped: a.mapped_competency ?? null, status: a.compliance_status, coverage: a.coverage_pct, evidence: a.evidence_count ?? 0 }))
    .sort((a, b) => (STATUS_SEV[a.status] ?? 9) - (STATUS_SEV[b.status] ?? 9))
    .slice(0, 14);

  const accCompliant = acc.filter((a) => a.compliance_status === "compliant").length;

  return {
    provisioned: !!r || acc.length > 0,
    hasRegistry: !!r,
    n,
    complianceScore,
    riskRating,
    dimensions,
    summary: r
      ? { governed: n, assurance: r.kpis.avgScore, regulatory: r.kpis.standardsPct, evidence: r.kpis.evidencePct, overdue: r.kpis.overdue, atRisk: r.states.at_risk + r.states.ungoverned }
      : null,
    standards,
    requirements,
    accreditation: { total: acc.length, compliant: accCompliant, readiness: acc.length ? Math.round((accCompliant / acc.length) * 100) : null, standards: byStandard.size },
  };
}
