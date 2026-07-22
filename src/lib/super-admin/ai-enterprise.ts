// Enterprise Intelligence (AIP-001.4) loader — converts organisational, clinical,
// workforce, quality and financial data into strategic insight. Platform-wide,
// fail-soft. The enterprise scorecard is filled ONLY with defensible direct
// metrics; dimensions without a clean signal (Patient Safety %, and Financial
// Health when no billing data) show an honest "—" and the Overall score is the
// mean of the dimensions that ARE computed. An auto-generated executive briefing
// is rule-derived from the same live signals.
/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (r: any) => (r?.error ? null : r?.count ?? 0);
const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const CLOSED = new Set(["completed", "closed", "done", "resolved", "verified"]);

export async function loadEnterpriseIntelligence(admin: any) {
  const head = (t: string) => admin.from(t).select("*", { count: "exact", head: true });
  const [scores, comps, audits, capa, esc, subs, safety, enterprises, orgs, hospitals, profiles] = await Promise.all([
    admin.from("competency_scores").select("competency_id, is_passing, educator_validated").limit(60000),
    admin.from("framework_competencies").select("id").limit(20000),
    admin.from("audits").select("compliance_pct, items_not_met").limit(5000),
    admin.from("capa_actions").select("status, priority").limit(4000),
    admin.from("op_escalations").select("status").limit(8000),
    admin.from("plat_subscriptions").select("status").limit(4000),
    admin.from("op_safety_alerts").select("*", { count: "exact", head: true }).eq("active", true),
    head("enterprises"), head("organisations"), head("hospitals"), head("profiles"),
  ]);

  // ── Competency & workforce readiness ────────────────────────────────────────
  const scoreRows = (scores.error ? [] : scores.data ?? []) as any[];
  const totalComps = comps.error ? 0 : (comps.data ?? []).length;
  const passRate = scoreRows.length ? Math.round((scoreRows.filter(s => s.is_passing).length / scoreRows.length) * 100) : null;
  const validatedCovered = new Set(scoreRows.filter(s => s.is_passing && s.educator_validated).map(s => s.competency_id)).size;
  const workforceReadiness = totalComps ? Math.round((validatedCovered / totalComps) * 100) : null;

  // ── Quality / accreditation / compliance (audits + capa) ────────────────────
  const auditRows = (audits.error ? [] : audits.data ?? []) as any[];
  const qualityPerformance = mean(auditRows.map(a => a.compliance_pct).filter((x: any) => x != null).map(Number));
  const accreditationReadiness = auditRows.length ? Math.round((auditRows.filter(a => (a.items_not_met ?? 0) === 0).length / auditRows.length) * 100) : null;
  const capaRows = (capa.error ? [] : capa.data ?? []) as any[];
  const compliance = capaRows.length ? Math.round((capaRows.filter(c => CLOSED.has(String(c.status ?? "").toLowerCase())).length / capaRows.length) * 100) : null;
  const openCapaHigh = capaRows.filter(c => String(c.priority ?? "").toLowerCase() === "high" && !CLOSED.has(String(c.status ?? "").toLowerCase())).length;

  // ── Operational efficiency (incident resolution rate) ───────────────────────
  const escRows = (esc.error ? [] : esc.data ?? []) as any[];
  const escResolved = escRows.filter(e => String(e.status ?? "").toLowerCase() === "resolved").length;
  const operationalEfficiency = escRows.length ? Math.round((escResolved / escRows.length) * 100) : null;
  const openEscalations = escRows.length - escResolved;

  // ── Financial health (subscription activation) ──────────────────────────────
  const subRows = (subs.error ? [] : subs.data ?? []) as any[];
  const activeSubs = subRows.filter(s => ["active", "trialing"].includes(String(s.status ?? "").toLowerCase())).length;
  const financialHealth = subRows.length ? Math.round((activeSubs / subRows.length) * 100) : null;

  const safetyAlerts = num(safety);

  // ── Enterprise scorecard (real where defensible, else honest null) ──────────
  const dims = [
    { key: "competency", label: "Competency Readiness", value: passRate },
    { key: "quality", label: "Quality Performance", value: qualityPerformance },
    { key: "safety", label: "Patient Safety", value: null as number | null },   // no clean %; counts shown in panel
    { key: "workforce", label: "Workforce Readiness", value: workforceReadiness },
    { key: "accreditation", label: "Accreditation Readiness", value: accreditationReadiness },
    { key: "operational", label: "Operational Efficiency", value: operationalEfficiency },
    { key: "financial", label: "Financial Health", value: financialHealth },
    { key: "compliance", label: "Compliance", value: compliance },
  ];
  const computed = dims.map(d => d.value).filter((v): v is number => v != null);
  const overall = mean(computed);

  // ── Auto-generated executive briefing (rule-derived from live signals) ──────
  const briefing: string[] = [];
  if (overall != null) briefing.push(`Overall enterprise score is ${overall}% across ${computed.length} measured dimension${computed.length === 1 ? "" : "s"}.`);
  if (workforceReadiness != null) briefing.push(`Validated competency coverage stands at ${workforceReadiness}% (${validatedCovered}/${totalComps}).`);
  if (qualityPerformance != null) briefing.push(`Audit compliance is averaging ${qualityPerformance}% across ${auditRows.length} audit${auditRows.length === 1 ? "" : "s"}.`);
  if (openCapaHigh > 0) briefing.push(`${openCapaHigh} high-priority corrective action${openCapaHigh === 1 ? "" : "s"} remain open.`);
  if ((safetyAlerts ?? 0) > 0 || openEscalations > 0) briefing.push(`${safetyAlerts ?? 0} active safety alert${safetyAlerts === 1 ? "" : "s"} and ${openEscalations} open escalation${openEscalations === 1 ? "" : "s"} require oversight.`);
  if (subRows.length) briefing.push(`${activeSubs}/${subRows.length} tenant subscription${subRows.length === 1 ? "" : "s"} active.`);
  if (briefing.length === 0) briefing.push("Insufficient enterprise signal to generate a briefing — connect audits, subscriptions and competency data.");

  const capabilities = [
    { name: "Executive Briefings", desc: "Structured summaries for CxO & board", href: "/super-admin/reports" },
    { name: "Enterprise Scorecards", desc: "Cross-dimension readiness", href: "/super-admin/command-centre" },
    { name: "Quality Intelligence", desc: "Audit trends & action tracking", href: "/super-admin/governance/committees" },
    { name: "Accreditation Readiness", desc: "Standard coverage & gaps", href: "/super-admin/governance/committees" },
    { name: "Benchmarking", desc: "Across facilities & networks", href: "/super-admin/enterprise" },
    { name: "Financial Intelligence", desc: "Licence & subscription utilisation", href: "/super-admin/platform-ops/licensing" },
    { name: "Strategic Planning", desc: "Scenario modelling", href: "/super-admin/enterprise/structure" },
    { name: "Board & Governance Reports", desc: "Decision-ready packs", href: "/super-admin/reports" },
  ];

  return {
    scorecard: { overall, dims, computedCount: computed.length },
    quality: { audits: auditRows.length, avgCompliance: qualityPerformance, fullyMet: auditRows.filter(a => (a.items_not_met ?? 0) === 0).length, openCapa: capaRows.filter(c => !CLOSED.has(String(c.status ?? "").toLowerCase())).length, openCapaHigh, safetyAlerts, openEscalations },
    financial: { subscriptions: subRows.length, active: activeSubs, health: financialHealth },
    structure: { enterprises: num(enterprises), organisations: num(orgs), facilities: num(hospitals), users: num(profiles) },
    briefing,
    capabilities,
    generatedAt: new Date().toISOString(),
  };
}
