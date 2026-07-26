// HEX-002/010 Executive Intelligence & Decision Platform — the cross-domain AI/analytics lens.
// The live LLM copilot (AiCopilotPanel → /api/executive-ai/copilot) is the real generative layer.
// This loader aggregates the existing executive scorecard (loadExecutiveDashboard) + strategy (ppe_*)
// + risk register + latest ops snapshot + AI telemetry, and derives TRANSPARENT rule-based signals
// (explicitly not black-box ML). Tenant-scoped.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadExecutiveDashboard } from "@/lib/executive-data";
import { fetchFramework } from "@/lib/priorities/engine";

const NONE = "00000000-0000-0000-0000-000000000000";
const CAT_TONE = ["rose", "amber", "blue", "violet", "indigo", "teal", "emerald", "slate"];

export async function loadExecIntelligence(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const d = await loadExecutiveDashboard(admin, hid, isSuper);
  const fw = await fetchFramework(admin).catch(() => ({ provisioned: false }) as any);

  const objectives = fw.provisioned ? (fw.objectives ?? []).filter((o: any) => o.status === "published") : [];
  const strategyProgress = objectives.length ? Math.round(objectives.reduce((s: number, o: any) => s + Number(o.progress_pct || 0), 0) / objectives.length) : null;

  // Risk register (light) → exposure score + category mix.
  let riskExposure: number | null = null, highRisks = 0, riskByCat: any[] = [];
  try {
    const { data } = await scope(admin.from("gov_risks").select("category, likelihood, impact, status").limit(4000));
    const risks = ((data ?? []) as any[]).filter(r => r.status !== "closed");
    if (risks.length) {
      highRisks = risks.filter(r => Number(r.likelihood) * Number(r.impact) >= 10).length;
      const avg = risks.reduce((s, r) => s + Number(r.likelihood) * Number(r.impact), 0) / risks.length;
      riskExposure = Math.round((avg / 25) * 100);
      const m = new Map<string, number>(); risks.forEach(r => m.set(r.category, (m.get(r.category) ?? 0) + 1));
      riskByCat = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value], i) => ({ label: (label || "").replace(/_/g, " "), value, tone: CAT_TONE[i % CAT_TONE.length] }));
    }
  } catch { /* optional */ }

  // Latest ops snapshot + safety.
  let safetyIndex: number | null = null, occupancy: number | null = null;
  try { const { data } = await scope(admin.from("quality_score_snapshots").select("safety_index").order("snapshot_date", { ascending: false }).limit(1)); safetyIndex = data?.[0]?.safety_index != null ? Math.round(Number(data[0].safety_index)) : null; } catch { /* optional */ }
  try { const { data } = await scope(admin.from("op_ops_snapshots").select("occupancy_pct").eq("period_type", "day").order("period", { ascending: false }).limit(1)); occupancy = data?.[0]?.occupancy_pct != null ? Math.round(Number(data[0].occupancy_pct)) : null; } catch { /* optional */ }

  // AI telemetry (real).
  let aiUsage = { execCalls: 0, totalCalls: 0, tokens: 0 };
  try {
    const { data } = await admin.from("plat_ai_requests").select("operation, total_tokens").limit(20000);
    const rows = (data ?? []) as any[];
    aiUsage = { totalCalls: rows.length, execCalls: rows.filter(r => /executive_intelligence|quality_intelligence|priority_orchestration|performance_intelligence/.test(String(r.operation))).length, tokens: rows.reduce((s, r) => s + Number(r.total_tokens || 0), 0) };
  } catch { /* optional */ }

  // Rule-based predictive insights + recommendations + emerging signals.
  const insights: { title: string; detail: string; level: string; tone: string }[] = [];
  if (d.quality.capa.overdue) insights.push({ title: "Corrective-action backlog", detail: `${d.quality.capa.overdue} overdue actions may breach governance timelines`, level: "High", tone: "rose" });
  if (highRisks) insights.push({ title: "Elevated risk exposure", detail: `${highRisks} high/extreme risks open on the register`, level: highRisks > 5 ? "High" : "Medium", tone: highRisks > 5 ? "rose" : "amber" });
  if (d.hr.positions.vacant) insights.push({ title: "Workforce capacity", detail: `${d.hr.positions.vacant} established positions vacant`, level: "Medium", tone: "amber" });
  if (d.hr.learning.compliance != null && d.hr.learning.compliance < 85) insights.push({ title: "Learning compliance below target", detail: `mandatory training at ${d.hr.learning.compliance}%`, level: "Medium", tone: "amber" });
  if (!insights.length) insights.push({ title: "Stable outlook", detail: "No elevated cross-domain signals detected", level: "Info", tone: "emerald" });

  const focus = d.scorecard.map((s: any) => ({ label: s.name, pct: s.score ?? 0, has: s.score != null }));

  const recommendations = [
    d.quality.findings.critical ? "Close open critical audit findings" : null,
    highRisks ? "Review treatment plans for high/extreme risks" : null,
    d.hr.positions.vacant ? "Accelerate recruitment for vacant established roles" : null,
    (strategyProgress != null && strategyProgress < 70) ? "Refocus on lagging strategic objectives" : null,
  ].filter(Boolean).slice(0, 4) as string[];

  return {
    provisioned: true as const,
    kpis: {
      performanceIndex: d.readinessIndex, strategyProgress, riskExposure, highRisks,
      workforceReadiness: d.hr.competency.coverage ?? null, qualitySafety: safetyIndex ?? d.quality.complianceScore, occupancy,
    },
    summary: {
      readiness: d.readinessIndex,
      lines: [
        d.readinessIndex != null ? `Organisational readiness sits at ${d.readinessIndex}%.` : "Readiness index pending data.",
        d.quality.findings.critical ? `${d.quality.findings.critical} critical quality findings need attention.` : "No critical quality findings open.",
        highRisks ? `${highRisks} high/extreme enterprise risks are open.` : "Enterprise risk is within tolerance.",
        strategyProgress != null ? `Strategic objectives average ${strategyProgress}% progress.` : "Strategy progress pending data.",
      ],
    },
    insights, focus, riskByCat, recommendations, aiUsage,
  };
}
