// Learning Analytics & Intelligence Centre (LDS-006) — the enterprise analytics + AI intelligence layer
// for the whole Learning & Development suite. Per the spec (§6 Data Sources / Developer Footnotes) this is
// a CONSOLIDATION layer: it composes the authoritative LDS loaders rather than inventing a new store —
//   Learning Health   ← LDS-001/002 (mandatory compliance)      Competency ← CMO (competency_decisions)
//   Compliance        ← LDS-002 (mandatory learning)            Assessments ← CMO assessments
//   Professional Dev  ← LDS-003 (cpd_logs)                      Career      ← LDS-004 (workforce readiness)
//   Education Plans    ← LDS-005 (education_planning)
// Real: the six health KPIs, a composite Learning Health Score, the capability radar (the five LDS pillars),
// a competency-coverage heatmap (domain × Benner maturity band, from competency_decisions), rule-based AI
// recommendations bucketed by audience, and a compliance-risk table — all from live composed sources.
// Honest next-phase: the learning-event stream (§9 — daily logins / study minutes / videos watched has no
// events store), pre/post assessment-gain analytics, and the persisted analytics_snapshots history (§7) that
// full trend sparklines need. Tenant-scoped; every source is fail-soft, so the page degrades honestly.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadMandatoryCompliance } from "@/lib/operations/mandatory-compliance";
import { loadPdCpd } from "@/lib/operations/pd-cpd";
import { loadCareerPathways } from "@/lib/operations/career-pathways";
import { loadEducationPlanning } from "@/lib/operations/education-planning";
import { loadCmoDashboard } from "@/lib/cmo-dashboard";

const NONE = "00000000-0000-0000-0000-000000000000";
const PASSING = ["competent", "competent_with_conditions", "provisionally_competent"];
// Benner maturity bands (competency_decisions.maturity) folded to the five coverage columns; mentor/authority
// roll up into Expert.
const BANDS: { key: string; label: string; matches: string[] }[] = [
  { key: "novice", label: "Novice", matches: ["novice"] },
  { key: "advanced_beginner", label: "Adv. Beginner", matches: ["advanced_beginner"] },
  { key: "competent", label: "Competent", matches: ["competent"] },
  { key: "proficient", label: "Proficient", matches: ["proficient"] },
  { key: "expert", label: "Expert", matches: ["expert", "mentor", "authority"] },
];
const bandOfMaturity = (m: string | null) => BANDS.find(b => b.matches.includes(m ?? ""))?.key ?? null;
const healthBand = (s: number) => (s >= 85 ? "Excellent" : s >= 70 ? "Good" : s >= 55 ? "Fair" : "At Risk");

export async function loadLearningAnalytics(admin: any, hid: string | null, isSuper: boolean) {
  const T = new Date().toISOString().slice(0, 10);

  // ── Compose the authoritative LDS / CMO loaders (all fail-soft) + the coverage-heatmap query ──────
  const [mc, pd, career, edu, cmo, heat] = await Promise.all([
    loadMandatoryCompliance(admin, hid, isSuper).catch(() => null) as Promise<any>,
    loadPdCpd(admin, hid, isSuper).catch(() => null) as Promise<any>,
    loadCareerPathways(admin, hid, isSuper).catch(() => null) as Promise<any>,
    loadEducationPlanning(admin, hid, isSuper).catch(() => null) as Promise<any>,
    loadCmoDashboard(admin, hid, isSuper).catch(() => null) as Promise<any>,
    loadCoverageHeatmap(admin, hid, isSuper).catch(() => ({ provisioned: false, levels: BANDS.map(b => b.label), rows: [] })),
  ]);

  const careerReady = career?.ready === true;

  // ── Six health KPIs (the header cards) ───────────────────────────────────────────────────────────
  const mandatory = {
    provisioned: !!mc?.provisioned && (mc?.kpis?.totalLearners ?? 0) > 0,
    compliance: mc?.kpis?.overallCompliance ?? 0,
    totalLearners: mc?.kpis?.totalLearners ?? 0,
    donut: {
      compliant: mc?.status?.compliant ?? 0,
      dueSoon: mc?.status?.dueSoon ?? 0,
      overdue: mc?.status?.overdue ?? 0,
      notStarted: mc?.status?.notStarted ?? 0,
      exempt: mc?.status?.exempt ?? 0,
    },
  };
  const competency = {
    ready: !!cmo?.ready,
    readiness: cmo?.readiness?.score ?? 0,
    complianceScore: cmo?.complianceScore ?? 0,
    trend: cmo?.trends?.readiness ?? null, // {series, delta} — hospital scope only (migration 088)
    domains: cmo?.domains ?? [],
  };
  const professional = {
    provisioned: !!pd?.provisioned && (pd?.kpis?.activeLearners ?? 0) > 0,
    points: pd?.kpis?.pointsEarned ?? 0,
    approved: pd?.kpis?.approved ?? 0,
    awaiting: pd?.kpis?.awaiting ?? 0,
    avgPerStaff: pd?.kpis?.avgPerStaff ?? 0,
    meetingTarget: pd?.kpis?.meetingTarget ?? 0,
    activeLearners: pd?.kpis?.activeLearners ?? 0,
    target: pd?.kpis?.target ?? 25,
    monthlyTrend: pd?.monthlyTrend ?? [],
    expiringCerts: pd?.expiringCerts ?? 0,
  };
  const careerBlk = {
    ready: careerReady,
    readiness: careerReady ? career.kpis.readiness : 0,
    band: careerReady ? career.kpis.band : "—",
    progressionReady: careerReady ? career.kpis.progressionReady : 0,
    requiringDev: careerReady ? career.kpis.requiringDev : 0,
    bands: careerReady ? career.bands : { fullyDeployable: 0, renewalDue: 0, awaitingRenewal: 0, awaitingValidation: 0 },
    total: careerReady ? career.kpis.total : 0,
  };
  const education = {
    provisioned: !!edu?.provisioned,
    hasData: !!edu?.hasData,
    avgProgress: edu?.kpis?.avgProgress ?? 0,
    activePlans: edu?.kpis?.activePlans ?? 0,
    milestonesCompleted: edu?.kpis?.milestonesCompleted ?? 0,
    milestonesTotal: edu?.kpis?.milestonesTotal ?? 0,
    plansAtRisk: edu?.kpis?.plansAtRisk ?? 0,
  };

  // ── Composite Learning Health Score (§10 AI Services) — mean of the provisioned pillars ──────────
  const pdAttain = professional.provisioned && professional.activeLearners ? Math.round((professional.meetingTarget / professional.activeLearners) * 100) : null;
  const components: { label: string; value: number }[] = [];
  if (mandatory.provisioned) components.push({ label: "Mandatory compliance", value: mandatory.compliance });
  if (competency.ready) components.push({ label: "Competency readiness", value: competency.readiness });
  if (pdAttain != null) components.push({ label: "CPD attainment", value: pdAttain });
  if (careerBlk.ready) components.push({ label: "Career readiness", value: careerBlk.readiness });
  if (education.hasData) components.push({ label: "Education progress", value: education.avgProgress });
  const healthScore = components.length ? Math.round(components.reduce((n, c) => n + c.value, 0) / components.length) : 0;
  const health = { score: healthScore, band: healthBand(healthScore), components, hasData: components.length > 0 };

  // ── Capability radar — the five LDS pillars as real 0-100 axes (a real "effectiveness" proxy) ────
  const radar = [
    { axis: "Compliance", value: mandatory.compliance },
    { axis: "Competency", value: competency.readiness },
    { axis: "Development", value: pdAttain ?? 0 },
    { axis: "Progression", value: careerBlk.readiness },
    { axis: "Education", value: education.hasData ? education.avgProgress : 0 },
    { axis: "Validation", value: competency.complianceScore },
  ];

  // ── Learning activity roll-up (real counts) — replaces the fabricated event metrics ──────────────
  // The engagement EVENT stream (daily logins / study minutes / videos watched / simulations, §9) has no
  // events store yet, so we surface only what is real and flag the event stream as next-phase on the page.
  const engagement = {
    provisioned: mandatory.provisioned || professional.provisioned,
    assignmentsIssued: mc?.kpis?.assignmentsIssued ?? 0,
    learners: mandatory.totalLearners,
    completions: mandatory.donut.compliant,
    cpdActivities: professional.approved + professional.awaiting,
    assessmentsToday: cmo?.assessments?.total ?? 0,
    validationQueue: cmo?.awaitingValidation ?? 0,
  };

  // ── AI Insights & Recommendations — bucketed by audience, all explainable + from live state ──────
  const ai: { audience: "learners" | "managers" | "educators" | "executives"; text: string; action: string; priority: "high" | "medium" | "low"; why: string }[] = [];
  const audOf = (action: string): "managers" | "educators" => (/validat|cycle|domain|review/i.test(action) ? "educators" : "managers");
  (cmo?.ai ?? []).forEach((r: any) => ai.push({ audience: audOf(r.action), text: r.text, action: r.action, priority: r.priority, why: r.why }));
  if (careerBlk.progressionReady > 0) ai.push({ audience: "executives", text: `${careerBlk.progressionReady} staff are progression-ready — review for promotion or stretch roles`, action: "View candidates", priority: "medium", why: "Fully deployable against the next career rung" });
  if ((mc?.kpis?.overdueLearners ?? 0) > 0) ai.push({ audience: "managers", text: `${mc.kpis.overdueLearners} learner(s) have overdue mandatory training — escalate before lapse`, action: "View learners", priority: "high", why: "Overdue mandatory learning is a compliance risk" });
  if (education.plansAtRisk > 0) ai.push({ audience: "managers", text: `${education.plansAtRisk} education plan(s) at risk from overdue milestones`, action: "Review plans", priority: "medium", why: "Overdue academic milestones delay qualification" });
  if (professional.expiringCerts > 0) ai.push({ audience: "learners", text: `${professional.expiringCerts} professional certificate(s) expire within 90 days — plan renewal CPD`, action: "Plan CPD", priority: "medium", why: "Lapsed certificates block deployment" });
  (cmo?.expiringPeople ?? []).slice(0, 3).forEach((p: any) => ai.push({ audience: "learners", text: `${p.name}: ${p.competency} expires${p.days != null ? ` in ${p.days} days` : " soon"}`, action: "Book reassessment", priority: p.days != null && p.days <= 14 ? "high" : "medium", why: "Renew before expiry to hold readiness" }));
  if (health.hasData) ai.push({ audience: "executives", text: `Learning health ${health.score}% (${health.band}) across ${components.length} pillar(s)`, action: "Open reports", priority: healthScore >= 70 ? "low" : "high", why: "Composite of compliance, competency, CPD, progression and education" });

  // ── Compliance Risk Alert table — real ratios per area, ranked by risk score ─────────────────────
  const risks: { level: "High" | "Medium" | "Low"; area: string; affected: number; score: number; due: string; kind: string }[] = [];
  const levelOf = (score: number): "High" | "Medium" | "Low" => (score >= 75 ? "High" : score >= 50 ? "Medium" : "Low");
  (mc?.topGaps ?? []).forEach((g: any) => { const score = mandatory.totalLearners ? Math.min(100, Math.round((g.affected / mandatory.totalLearners) * 100)) : 0; risks.push({ level: levelOf(score), area: g.requirement, affected: g.affected, score, due: "mandatory", kind: "Mandatory learning" }); });
  (cmo?.highRiskUnits ?? []).slice(0, 4).forEach((u: any) => { const score = 100 - u.pct; risks.push({ level: levelOf(score), area: `${u.name} readiness`, affected: Math.max(0, u.total - u.current), score, due: "ongoing", kind: "Competency readiness" }); });
  if ((cmo?.expiring?.d30 ?? 0) > 0) { const affected = cmo.expiring.individuals ?? cmo.expiring.d30; const score = Math.min(100, 40 + cmo.expiring.d30); risks.push({ level: levelOf(score), area: "Competencies expiring ≤30 days", affected, score, due: "≤30 days", kind: "Competency expiry" }); }
  if (professional.expiringCerts > 0) risks.push({ level: "Medium", area: "Professional certificates expiring", affected: professional.expiringCerts, score: 55, due: "≤90 days", kind: "Credential" });
  const riskRows = risks.sort((a, b) => b.score - a.score).slice(0, 8);

  const activity = (cmo?.activity ?? []).slice(0, 8);

  const ready = mandatory.provisioned || competency.ready || professional.provisioned || careerBlk.ready || education.hasData;

  return {
    ready, scope: isSuper ? "Enterprise" : "Hospital", asOf: T,
    health, mandatory, competency, professional, career: careerBlk, education,
    radar, heatmap: heat, engagement, ai, risks: riskRows, activity,
  };
}

// Competency-coverage heatmap — latest decision per nurse:competency → domain × Benner maturity band.
// Real distribution from competency_decisions; each cell is the % of the domain's achieved decisions at that
// maturity band (rows sum ~100). Fail-soft + provisioned-aware.
export async function loadCoverageHeatmap(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const levels = BANDS.map(b => b.label);
  const { data, error } = await scope(admin.from("competency_decisions")
    .select("nurse_id, competency_id, outcome, maturity, created_at")
    .order("created_at", { ascending: false }).limit(20000));
  if (error) throw error;

  // Latest per nurse:competency, achieved (passing) only — coverage is about attained maturity.
  const seen = new Set<string>();
  const latest: any[] = [];
  for (const d of data ?? []) { const k = `${d.nurse_id}:${d.competency_id}`; if (seen.has(k)) continue; seen.add(k); latest.push(d); }
  const achieved = latest.filter(d => PASSING.includes(d.outcome) && bandOfMaturity(d.maturity));
  if (!achieved.length) return { provisioned: latest.length > 0, levels, rows: [] };

  // competency → domain name.
  const compIds = [...new Set(achieved.map(d => d.competency_id).filter(Boolean))];
  const compDomain = new Map<string, string>();
  const domName = new Map<string, string>();
  try {
    const { data: comps } = await admin.from("framework_competencies").select("id, domain_id").in("id", compIds).limit(20000);
    (comps ?? []).forEach((c: any) => c.domain_id && compDomain.set(c.id, c.domain_id));
    const domIds = [...new Set([...compDomain.values()])];
    if (domIds.length) { const { data: doms } = await admin.from("framework_domains").select("id, name").in("id", domIds).limit(5000); (doms ?? []).forEach((d: any) => domName.set(d.id, d.name)); }
  } catch { /* fail-soft — fall through to Unassigned */ }

  // domain → per-band counts.
  const byDom = new Map<string, { total: number; bands: Record<string, number> }>();
  achieved.forEach(d => {
    const dom = domName.get(compDomain.get(d.competency_id) ?? "") ?? "Unassigned";
    const g = byDom.get(dom) ?? { total: 0, bands: Object.fromEntries(BANDS.map(b => [b.key, 0])) };
    g.total++; g.bands[bandOfMaturity(d.maturity)!]++; byDom.set(dom, g);
  });
  const rows = [...byDom.entries()]
    .map(([domain, g]) => ({ domain, total: g.total, cells: BANDS.map(b => ({ level: b.label, count: g.bands[b.key], pct: g.total ? Math.round((g.bands[b.key] / g.total) * 100) : 0 })) }))
    .sort((a, b) => b.total - a.total).slice(0, 10);
  return { provisioned: true, levels, rows };
}
