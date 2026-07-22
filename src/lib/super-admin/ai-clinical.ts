// Clinical Intelligence (AIP-001.2) loader — evidence-informed clinical support
// grounded in approved Competen knowledge. It SUPPORTS, never replaces, clinical
// judgement. Aggregates the real clinical signal across the platform: live
// clinical AI usage (plat_ai_requests), high-risk safety alerts & escalations
// (op_safety_alerts / op_escalations), the approved knowledge inventory
// (knowledge_objects, CPUs, competencies, policies, pathways) and the human
// review queue (content_approvals / change_requests / plat_approval_requests).
// Recommendation acceptance is not stored yet → honest "—". Fail-soft throughout.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadAiGovernance } from "@/lib/ai/gateway";

const num = (r: any) => (r?.error ? null : r?.count ?? 0);

// Clinical server-side AI operations (map to plat_ai_requests.operation).
const CLINICAL_OPS = ["assistant", "assess", "osce", "coach", "simulation", "clinical", "insight", "report", "care", "guideline"];

export async function loadClinicalIntelligence(admin: any) {
  const head = (t: string) => admin.from(t).select("*", { count: "exact", head: true });
  const [gov, escOpen, safetyActive, koTotal, koEvidence, koType, cpu, pathways, policies, comps, cases, caPending, crOpen, apPending, escFeed] = await Promise.all([
    loadAiGovernance(admin),
    admin.from("op_escalations").select("*", { count: "exact", head: true }).in("status", ["open", "acknowledged"]),
    admin.from("op_safety_alerts").select("*", { count: "exact", head: true }).eq("active", true),
    head("knowledge_objects"),
    admin.from("knowledge_objects").select("*", { count: "exact", head: true }).eq("knowledge_type", "evidence"),
    admin.from("knowledge_objects").select("knowledge_type").limit(5000),
    head("clinical_practice_units"),
    head("learning_pathways"),
    head("policies"),
    head("framework_competencies"),
    head("clinical_cases"),
    admin.from("content_approvals").select("*", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("change_requests").select("*", { count: "exact", head: true }).eq("status", "open"),
    admin.from("plat_approval_requests").select("*", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("op_escalations").select("id, escalation_type, level, severity, summary, status, created_at").in("status", ["open", "acknowledged"]).order("created_at", { ascending: false }).limit(8),
  ]);

  // Live clinical AI usage from the runtime gateway.
  const clinicalOps = gov.byOperation.filter((o: any) => CLINICAL_OPS.some(x => String(o.label ?? "").toLowerCase().includes(x)));
  const clinicalReq24h = clinicalOps.reduce((n: number, o: any) => n + o.n, 0);

  // Approved-knowledge composition (real distribution by type).
  const typeRows = koType.error ? [] : (koType.data ?? []);
  const byType: Record<string, number> = {};
  for (const r of typeRows) { const t = r.knowledge_type ?? "other"; byType[t] = (byType[t] ?? 0) + 1; }
  const composition = Object.entries(byType).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);

  const awaitingReview = (num(caPending) ?? 0) + (num(crOpen) ?? 0) + (num(apPending) ?? 0);

  const kpis = {
    clinicalReq24h,
    highRiskAlerts: num(safetyActive),
    escalations: num(escOpen),
    pathways: num(pathways),
    competencies: num(comps),
    evidence: num(koEvidence),
    knowledgeTotal: num(koTotal),
    cpus: num(cpu),
    cases: num(cases),
    policies: num(policies),
    awaitingReview,
  };

  // Core clinical capabilities (from spec) — documents the supported surface.
  const capabilities = [
    { name: "Clinical Copilot", desc: "Contextual reasoning, deterioration, handover", href: "/super-admin/assistant" },
    { name: "Decision Support", desc: "Risk recognition, medication & infection safety", href: "/super-admin/assistant" },
    { name: "Risk Prediction", desc: "Deterioration & escalation signals", href: "/super-admin/platform-ops/monitoring" },
    { name: "Care Pathways", desc: "Suggested pathway, required competencies", href: "/super-admin/ckp/repository" },
    { name: "Competency Recommendations", desc: "Observed gap → CPU → validation", href: "/super-admin/ckp/competency" },
    { name: "Guideline Matching", desc: "Policy vs guideline retrieval", href: "/super-admin/policy-manager" },
    { name: "Evidence Summaries", desc: "Approved evidence, dated & cited", href: "/super-admin/ckp/repository" },
    { name: "Clinical Review Queue", desc: "Human review for high-risk output", href: "/super-admin/platform-ops/approvals" },
  ];

  // Safety controls (non-negotiable clinical guardrails, from spec).
  const safety = [
    "Human review for high-risk recommendations",
    "Source citation required on every output",
    "Confidence level displayed",
    "No autonomous diagnosis",
    "No autonomous treatment ordering",
    "Escalation to qualified professionals",
    "Complete interaction audit",
  ];

  return {
    kpis,
    clinicalOps,
    clinicalReq24h,
    composition,
    escalations: escFeed.error ? [] : (escFeed.data ?? []),
    capabilities,
    safety,
    aiReady: gov.summary.ready,
    generatedAt: new Date().toISOString(),
  };
}
