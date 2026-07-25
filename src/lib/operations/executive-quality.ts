// Executive Quality Command Centre (UMG-QS-010) — the governance/orchestration layer over the whole Quality &
// Safety domain (QS-001..009). Composes loadQualityCommand (composite Enterprise Quality Score, patient-safety,
// compliance, risk heat + top risks, CAPA, accreditation, 6-month snapshot trend), loadClinicalIndicators
// (clinical performance = attainment) and loadAccreditationReadiness (regulatory frameworks), plus a competency
// read (workforce readiness) and the op_quality_actions register (improvement portfolio + executive actions).
// Real throughout, fail-soft. Governance committees + board-report packs need their own stores — honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadQualityCommand } from "@/lib/operations/quality-command";
import { loadClinicalIndicators } from "@/lib/operations/clinical-indicators";
import { loadAccreditationReadiness } from "@/lib/operations/accreditation-readiness";

const NONE = "00000000-0000-0000-0000-000000000000";
const band = (s: number | null) => (s == null ? "—" : s >= 85 ? "Good" : s >= 70 ? "In Progress" : s >= 60 ? "Moderate" : "At Risk");

export async function loadExecutiveQuality(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const [qc, ind, acc] = await Promise.all([
    loadQualityCommand(admin, hid, isSuper).catch(() => null) as Promise<any>,
    loadClinicalIndicators(admin, hid, isSuper).catch(() => null) as Promise<any>,
    (isSuper ? loadAccreditationReadiness(admin) : loadAccreditationReadiness(admin)).catch(() => null) as Promise<any>,
  ]);
  if (!qc || !qc.ready) return { provisioned: false as const };

  // Workforce readiness — % of competency decisions competent / provisionally competent.
  let workforce: number | null = null;
  try {
    const { data } = await scope(admin.from("competency_decisions").select("outcome")).limit(20000);
    const rows = data ?? []; const ok = rows.filter((r: any) => ["competent", "provisionally_competent"].includes(r.outcome)).length;
    workforce = rows.length ? Math.round((ok / rows.length) * 100) : null;
  } catch { /* fail-soft */ }

  // Improvement portfolio + executive actions — op_quality_actions register.
  let portfolio: any = null; let actions: any[] = [];
  try {
    const { data } = await scope(admin.from("op_quality_actions").select("id, title, action_type, status, priority, owner_name, due_date")).limit(5000);
    const qa = (data ?? []) as any[];
    const cnt = (f: (a: any) => boolean) => qa.filter(f).length;
    portfolio = {
      total: qa.length,
      onTrack: cnt(a => a.status === "in_progress"), atRisk: cnt(a => a.status === "open" && a.priority === "high"),
      delayed: cnt(a => a.status === "overdue"), completed: cnt(a => a.status === "completed"), notStarted: cnt(a => a.status === "open" && a.priority !== "high"),
    };
    const now = Date.now(); const soon = now + 7 * 86400000;
    actions = qa.filter(a => a.status !== "completed" && a.due_date).sort((a, b) => (a.due_date < b.due_date ? -1 : 1)).slice(0, 6)
      .map(a => ({ action: a.title, owner: a.owner_name ?? "—", due: a.due_date, priority: a.priority ?? "medium", status: a.status, dueSoon: new Date(a.due_date).getTime() <= soon }));
  } catch { /* fail-soft */ }
  const actionsDue = actions.filter(a => a.dueSoon).length || (qc.actionQueue?.length ?? 0);

  // Risk score from the residual heat matrix (mean residual → inverted health score).
  let riskScore: number | null = null;
  const heat = qc.risks?.heat;
  if (heat) { let sum = 0, cnt = 0; for (let l = 0; l < 5; l++) for (let i = 0; i < 5; i++) { const n = heat[l][i]; sum += n * (l + 1) * (i + 1); cnt += n; } riskScore = cnt ? Math.round(100 - (sum / cnt / 25) * 100) : null; }

  const kk = qc.kpis ?? {}; const tr = qc.trends ?? {};
  const kpis = {
    enterpriseQuality: qc.health?.score ?? null, enterpriseDelta: tr.quality?.delta ?? tr.health?.delta ?? null,
    patientSafety: kk.safetyIndex ?? null, safetyDelta: tr.safety?.delta ?? null,
    riskScore, riskDelta: tr.highRisks?.delta != null ? -tr.highRisks.delta : null,
    accreditation: kk.accreditationReadiness ?? acc?.kpis?.overall ?? null,
    clinical: ind?.kpis?.overallScore ?? null,
    workforce,
    actionsDue,
  };

  // Executive summary — gauge + AI-style briefing bullets derived from live signals + top risks.
  const bullets: string[] = [];
  if (kpis.enterpriseQuality != null) bullets.push(`Overall quality performance is ${band(kpis.enterpriseQuality).toLowerCase()} (${kpis.enterpriseQuality}%)${kpis.enterpriseDelta != null && kpis.enterpriseDelta > 0 ? " with an improving trend" : ""}.`);
  if (ind?.topUnderperformers?.length) { const w = ind.topUnderperformers[0]; bullets.push(`${w.name} is below target (${w.value}${w.unit === "percent" ? "%" : ""}) — the leading clinical concern.`); }
  if (qc.audits?.avgCompliance != null && qc.audits.avgCompliance < 90) bullets.push(`Audit compliance is ${qc.audits.avgCompliance}% — below the accreditation-readiness threshold in places.`);
  if (acc?.kpis?.highRisk) bullets.push(`${acc.kpis.highRisk} accreditation standard(s) require immediate attention.`);
  bullets.push(`${kpis.actionsDue} executive action(s) are due within the next 7 days.`);
  const summary = { score: qc.health?.score ?? null, band: band(qc.health?.score ?? null), bullets: bullets.slice(0, 5), topRisks: (qc.risks?.top ?? []).slice(0, 5).map((r: any) => ({ title: r.title, band: r.band })) };

  // Quality performance trend (real snapshot history — quality / safety / compliance).
  const t12 = tr.trend12 ?? [];
  const trend = { months: t12.map((p: any) => p.month), quality: t12.map((p: any) => p.quality), safety: t12.map((p: any) => p.safety), compliance: t12.map((p: any) => p.compliance), latest: { quality: kpis.enterpriseQuality, safety: kpis.patientSafety, clinical: kpis.clinical, accreditation: kpis.accreditation } };

  // Strategic priorities — derived from the worst clinical indicators (real signals framed as objectives).
  const strategicPriorities = (ind?.topUnderperformers ?? []).slice(0, 5).map((w: any, i: number) => {
    const progress = Math.min(100, w.attainment ?? 50);
    return { rank: i + 1, name: (w.direction === "lower_is_better" ? "Reduce " : "Improve ") + w.name.replace(/ Rate$| Compliance$/, ""), progress, status: progress >= 75 ? "On Track" : "At Risk" };
  });

  // Regulatory & accreditation frameworks.
  const regulatory = (acc?.frameworks ?? acc?.byFramework ?? []).slice(0, 6).map((f: any) => ({ name: f.name ?? f.framework ?? f.label, status: f.status ?? (f.readiness >= 90 ? "Compliant" : "In Progress"), compliance: f.readiness ?? f.compliance ?? null, due: f.nextReview ?? f.surveyDate ?? "Continuous" }));

  return {
    provisioned: true as const, scope: qc.scope, kpis, summary, trend, strategicPriorities, actions,
    committee: { provisioned: false },
    riskHeat: heat ?? null, riskTotals: { high: qc.risks?.high ?? 0, extreme: qc.risks?.extreme ?? 0, total: qc.risks?.total ?? 0 },
    portfolio, regulatory,
    boardReports: [{ name: "Monthly Board Pack", period: "This month", fmt: "PDF" }, { name: "Quarterly Quality Report", period: "This quarter", fmt: "PDF" }, { name: "Annual Quality Report", period: "This year", fmt: "PDF" }, { name: "Patient Safety Report", period: "This month", fmt: "PDF" }, { name: "Accreditation Report", period: "This month", fmt: "PDF" }],
  };
}
