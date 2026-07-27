// OGS-009 Office Lifecycle Intelligence & AI Governance Engine. The live LLM copilot (AiCopilotPanel →
// /api/office-governance/copilot) is the genuine generative layer; this loader composes the real
// governance command-centre read-model + plat_ai_requests telemetry and derives TRANSPARENT rule-based
// risk/recommendation/strength signals (advisory only — AI never appoints, votes or certifies).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadOgsCommandCentre } from "@/lib/ogs/ogs-data";

export async function loadOgsAi(admin: any, hid: string | null, isSuper: boolean) {
  const d = await loadOgsCommandCentre(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };
  const k = d.kpis;

  // AI telemetry — real usage of the governance + related copilots.
  let aiUsage = { govCalls: 0, totalCalls: 0, tokens: 0 };
  try {
    const { data } = await admin.from("plat_ai_requests").select("operation, total_tokens").limit(20000);
    const rows = (data ?? []) as any[];
    aiUsage = { totalCalls: rows.length, govCalls: rows.filter(r => /office_governance|governance|competency_intelligence|priority_orchestration/.test(String(r.operation))).length, tokens: rows.reduce((s, r) => s + Number(r.total_tokens || 0), 0) };
  } catch { /* optional */ }

  // Rule-based governance risk intelligence (transparent, from the alerts + office health).
  const risk = d.alerts.filter((a: any) => a.tone !== "emerald").map((a: any) => ({ label: a.title, detail: a.detail, level: a.tone === "rose" ? "High" : a.tone === "amber" ? "Medium" : "Low", tone: a.tone }));
  const predictedRisk = risk.filter(r => r.level === "High").length;

  const recommendations = risk.slice(0, 5).map(r => ({ title: r.label.replace(/^Offices?/, "Address offices").replace(/Delegations expiring/, "Renew expiring delegations").replace(/Decisions pending/, "Clear pending decisions"), impact: r.level, tone: r.tone }));

  const strengths = d.performance.map((p: any) => ({ label: p.label, pct: p.pct }));

  return {
    provisioned: true as const,
    kpis: {
      officeHealth: k.complianceScore, predictedRisk, aiRecs: recommendations.length,
      decisionThroughput: d.performance.find((p: any) => p.label === "Decision throughput")?.pct ?? null,
      activeRate: d.performance.find((p: any) => p.label === "Active rate")?.pct ?? null,
      aiCalls: aiUsage.govCalls,
    },
    risk, recommendations, strengths, aiUsage,
    officeHealthNow: k.complianceScore,
  };
}
