// QAW-012 AI Quality Intelligence Centre — the AI lens over the whole workspace.
// The live LLM copilot (AiCopilotPanel → /api/quality-ai/copilot) is the genuine generative layer.
// This loader grounds the surrounding widgets in REAL data (loadQualityDashboard + gov_risks +
// op_incidents + gov_standard_assessments + plat_ai_requests telemetry). Any "predicted" figure is a
// TRANSPARENT rule-based projection from real trends — explicitly NOT a machine-learning model.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadQualityDashboard } from "@/lib/quality-accreditation-data";

const NONE = "00000000-0000-0000-0000-000000000000";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CAT_TONE = ["rose", "amber", "blue", "violet", "indigo", "teal", "emerald", "slate"];

export async function loadAiIntelligence(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const core = await loadQualityDashboard(admin, hid, isSuper);

  // Risks → high count + heatmap (category × severity band).
  let highRisks = 0; let riskHeat: { category: string; low: number; moderate: number; high: number; critical: number }[] = [];
  try {
    const { data } = await scope(admin.from("gov_risks").select("category, likelihood, impact, status").limit(4000));
    const risks = ((data ?? []) as any[]).filter(r => r.status !== "closed");
    highRisks = risks.filter(r => Number(r.likelihood) * Number(r.impact) >= 10).length;
    const catMap = new Map<string, any>();
    risks.forEach(r => {
      const s = Number(r.likelihood) * Number(r.impact);
      const c = catMap.get(r.category) ?? { category: (r.category || "other").replace(/_/g, " "), low: 0, moderate: 0, high: 0, critical: 0 };
      if (s >= 15) c.critical++; else if (s >= 10) c.high++; else if (s >= 5) c.moderate++; else c.low++;
      catMap.set(r.category, c);
    });
    riskHeat = [...catMap.values()].sort((a, b) => (b.critical + b.high) - (a.critical + a.high)).slice(0, 7);
  } catch { /* optional */ }

  // Incidents → pattern (by type) + rule-based 30-day projection from recent monthly rate.
  let incidentPattern: { label: string; value: number; tone: string }[] = []; let predictedIncidents: number | null = null;
  try {
    const { data } = await scope(admin.from("op_incidents").select("incident_type, created_at").limit(6000));
    const inc = (data ?? []) as any[];
    const m = new Map<string, number>();
    inc.forEach(i => m.set(i.incident_type, (m.get(i.incident_type) ?? 0) + 1));
    incidentPattern = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label: label.replace(/_/g, " "), value, tone: CAT_TONE[i % CAT_TONE.length] }));
    const cutoff = Date.now() - 90 * 86400000;
    const recent = inc.filter(i => Date.parse(i.created_at) >= cutoff).length;
    predictedIncidents = recent ? Math.round(recent / 3) : null;   // avg monthly rate over last 3 months
  } catch { /* optional */ }

  // Accreditation readiness — real %-met history + rule-based linear projection (2 months forward).
  let readinessTrend: { label: string; value: number; predicted?: boolean }[] = []; let predictedReadiness: number | null = null;
  try {
    const { data } = await scope(admin.from("gov_standard_assessments").select("reference_code, framework_id, status, assessed_at").order("assessed_at", { ascending: false }).limit(20000));
    const asmts = (data ?? []) as any[];
    const monthAgg = new Map<string, { met: number; assessed: number }>();
    asmts.forEach(a => { if (a.status === "not_assessed") return; const k = String(a.assessed_at).slice(0, 7); const g = monthAgg.get(k) ?? { met: 0, assessed: 0 }; g.assessed++; if (a.status === "met") g.met++; monthAgg.set(k, g); });
    const hist = [...monthAgg.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6).map(([k, v]) => ({ mk: k, value: v.assessed ? Math.round((v.met / v.assessed) * 100) : 0 }));
    readinessTrend = hist.map(h => ({ label: MONTHS[Number(h.mk.slice(5, 7)) - 1], value: h.value }));
    if (hist.length >= 2) {
      const slope = (hist[hist.length - 1].value - hist[0].value) / (hist.length - 1);
      const last = hist[hist.length - 1]; let lastMonth = Number(last.mk.slice(5, 7)) - 1;
      for (let n = 1; n <= 2; n++) { const p = Math.max(0, Math.min(100, Math.round(last.value + slope * n))); lastMonth = (lastMonth + 1) % 12; readinessTrend.push({ label: MONTHS[lastMonth], value: p, predicted: true }); }
      predictedReadiness = readinessTrend[readinessTrend.length - 1].value;
    }
  } catch { /* optional */ }

  // AI telemetry — real usage of the quality copilot (and platform AI), from plat_ai_requests.
  const aiUsage = { qualityCalls: 0, totalCalls: 0, tokens: 0 };
  try {
    const { data } = await admin.from("plat_ai_requests").select("operation, total_tokens").limit(20000);
    const rows = (data ?? []) as any[];
    aiUsage.totalCalls = rows.length;
    const qrows = rows.filter(r => /quality_intelligence|competency_intelligence|priority_orchestration|performance_intelligence|admin_assistant/.test(String(r.operation)));
    aiUsage.qualityCalls = qrows.length;
    aiUsage.tokens = rows.reduce((s, r) => s + Number(r.total_tokens || 0), 0);
  } catch { /* optional */ }

  // Rule-based, explainable insights + recommendations from the real signals above.
  const insights: { kind: string; title: string; tone: string }[] = [];
  if (core.findings.critical) insights.push({ kind: "Risk", title: `${core.findings.critical} critical audit finding${core.findings.critical > 1 ? "s" : ""} open — prioritise closure`, tone: "rose" });
  if (core.capa.overdue) insights.push({ kind: "CAPA", title: `${core.capa.overdue} corrective action${core.capa.overdue > 1 ? "s are" : " is"} overdue`, tone: "amber" });
  if (highRisks) insights.push({ kind: "Risk", title: `${highRisks} high/extreme risk${highRisks > 1 ? "s" : ""} on the register need active treatment`, tone: "rose" });
  if (predictedReadiness != null && core.accreditationReadiness != null) insights.push({ kind: predictedReadiness >= core.accreditationReadiness ? "Trend" : "Watch", title: `Readiness trending ${predictedReadiness >= core.accreditationReadiness ? "up" : "down"} — projected ${predictedReadiness}% vs ${core.accreditationReadiness}% now`, tone: predictedReadiness >= core.accreditationReadiness ? "emerald" : "amber" });
  if (predictedIncidents) insights.push({ kind: "Safety", title: `~${predictedIncidents} incidents projected next month at the current rate`, tone: "blue" });
  if (!insights.length) insights.push({ kind: "Stable", title: "No elevated quality signals detected in the current data", tone: "emerald" });

  const recommendations = [
    core.findings.critical ? { title: "Close open critical audit findings", impact: "high", tone: "rose" } : null,
    core.capa.overdue ? { title: "Clear the overdue corrective-action backlog", impact: "high", tone: "amber" } : null,
    highRisks ? { title: "Review treatment plans for high/extreme risks", impact: "high", tone: "rose" } : null,
    (predictedReadiness != null && predictedReadiness < 90) ? { title: "Target the largest accreditation gaps to lift readiness", impact: "medium", tone: "blue" } : null,
    core.capa.critical ? { title: "Escalate high-priority corrective actions", impact: "medium", tone: "amber" } : null,
  ].filter(Boolean).slice(0, 5) as any[];

  return {
    provisioned: true as const,
    kpis: {
      qualityScore: core.complianceScore, predictedReadiness, highRisks,
      auditPriority: core.findings.open, predictedIncidents, aiCalls: aiUsage.qualityCalls,
    },
    readinessTrend, riskHeat, incidentPattern, insights, recommendations, aiUsage,
    now: core.accreditationReadiness,
  };
}
