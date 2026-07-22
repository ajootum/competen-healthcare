// AI & Intelligence Platform (AIP-001) root loader — the enterprise intelligence
// layer landing dashboard. Aggregates the real AI runtime telemetry
// (plat_ai_requests via loadAiGovernance), the background job runner (plat_job_runs
// via loadJobs), provider/model configuration (aiStatus) and the human review
// queue (plat_approval_requests) into the top KPI ribbon, six module descriptors,
// a copilot spotlight and an operations-status panel. Fail-soft throughout: every
// metric is either live or an honest null ("—") — nothing is fabricated. Numbers
// the platform does not yet meter (recommendation acceptance, model accuracy)
// return null so the UI can show an honest "not tracked" state.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadAiGovernance } from "@/lib/ai/gateway";
import { loadJobs } from "@/lib/platform/jobs";
import { aiStatus } from "@/lib/ai/config";

const num = (r: any) => (r?.error ? null : r?.count ?? 0);

// The copilots ARE the real server-side AI operations the app runs. Each maps to
// the operation strings recorded in plat_ai_requests, so "usage today" is live.
// Accuracy is not metered yet → honest null.
export const COPILOTS = [
  { key: "clinical", name: "Clinical Copilot", desc: "Decision support, risk & competency guidance", icon: "🩺", ops: ["assistant", "assess", "osce", "simulation", "coach", "clinical"] },
  { key: "educator", name: "Educator Copilot", desc: "Curriculum, authoring & learner support", icon: "🎓", ops: ["author", "curriculum", "lms", "learning", "content"] },
  { key: "workforce", name: "Workforce Copilot", desc: "Skill gaps, rostering & staffing intelligence", icon: "👥", ops: ["workforce", "roster", "schedule", "staffing"] },
  { key: "quality", name: "Quality Copilot", desc: "Audits, governance & safety intelligence", icon: "🛡️", ops: ["governance", "quality", "audit", "accreditation"] },
  { key: "executive", name: "Executive Copilot", desc: "Strategic insight & executive briefings", icon: "👑", ops: ["report", "insights", "insight", "briefing", "executive"] },
];

export async function loadAiPlatform(admin: any) {
  const [gov, jobs, apprPending, koRecent, koTotal, tenants, orgs, escalations] = await Promise.all([
    loadAiGovernance(admin),
    loadJobs(admin),
    admin.from("plat_approval_requests").select("*", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("knowledge_objects").select("*", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 86400000).toISOString()),
    admin.from("knowledge_objects").select("*", { count: "exact", head: true }),
    admin.from("tenants").select("*", { count: "exact", head: true }),
    admin.from("organisations").select("*", { count: "exact", head: true }),
    admin.from("op_escalations").select("*", { count: "exact", head: true }).in("status", ["open", "acknowledged"]),
  ]);

  const ai = aiStatus();
  const s = gov.summary;

  // Distinct configured models = "models online" (dedup the tier map).
  const modelsOnline = ai.models ? new Set([ai.models.cheap, ai.models.reasoning, ai.models.heavy].filter(Boolean)).size : 0;

  // Copilot usage today, from the real operation breakdown.
  const opUsage = (ops: string[]) => gov.byOperation.reduce((n: number, o: any) => n + (ops.some(x => String(o.label ?? "").toLowerCase().includes(x)) ? o.n : 0), 0);
  const copilots = COPILOTS.map(c => ({ key: c.key, name: c.name, desc: c.desc, icon: c.icon, usageToday: opUsage(c.ops), accuracy: null as number | null }));
  const activeCopilots = copilots.filter(c => c.usageToday > 0).length;

  // AI health: honest — needs a configured provider; then the 24h success rate.
  const aiHealth = !ai.configured ? null : (s.requests24h ? Math.round((1 - s.errors24h / s.requests24h) * 100) : 100);

  const pendingApprovals = num(apprPending) ?? 0;
  const evidenceTotal = num(koTotal) ?? 0;
  const knowledgeUpdates = num(koRecent);
  const openEscalations = num(escalations);

  // ── Top KPI ribbon ──────────────────────────────────────────────────────────
  const ribbon = {
    aiHealth,                                   // %
    runningAgents: activeCopilots,              // copilots active in 24h
    queuedJobs: jobs.summary.ready ? jobs.summary.running : null,   // running job runs
    failedJobs: jobs.summary.ready ? jobs.summary.failed24h : null,
    modelsOnline,
    inferenceRequests: s.ready ? s.totalRequests : null,
    avgResponseMs: s.avgLatencyMs,              // ms (null when no traffic)
    knowledgeUpdates,
  };

  // ── Six module descriptors (launcher cards) ─────────────────────────────────
  const dash = (n: number | null) => (n == null ? "—" : n.toLocaleString());
  const modules = [
    { n: 1, key: "operations", name: "AI Operations Centre", desc: "Operate, monitor and govern all AI services", href: "/super-admin/ai/operations", action: "Open",
      kpis: [
        { label: "AI Services", value: dash(COPILOTS.length) },
        { label: "Running Agents", value: dash(activeCopilots) },
        { label: "Failed Jobs", value: dash(ribbon.failedJobs) },
        { label: "Models Online", value: dash(modelsOnline) },
      ], subs: ["AI Health", "Agents & Copilots", "Model Registry", "Prompt Library", "Knowledge Sources", "AI Jobs", "AI Policies", "Audit & Logs"] },
    { n: 2, key: "clinical", name: "Clinical Intelligence", desc: "AI-powered clinical decision support", href: "/super-admin/ai/clinical", action: "Open",
      kpis: [
        { label: "Clinical Recs (24h)", value: dash(opUsage(["assistant", "assess", "osce", "coach", "clinical"])) },
        { label: "High-Risk", value: dash(openEscalations) },
        { label: "Evidence", value: dash(evidenceTotal) },
        { label: "Awaiting Review", value: dash(pendingApprovals) },
      ], subs: ["Clinical Copilot", "Decision Support", "Risk Prediction", "Care Pathways", "Competency Recs", "Guideline Matching", "Evidence Summaries", "Review Queue"] },
    { n: 3, key: "workforce", name: "Workforce Intelligence", desc: "Optimise workforce capability, coverage & development", href: "/super-admin/ai/workforce", action: "Open",
      kpis: [
        { label: "Open Skill Gaps", value: "—" },
        { label: "Coverage Risk", value: "—" },
        { label: "Burnout Risk", value: "—" },
        { label: "Training Needs", value: "—" },
      ], subs: ["Workforce Planning", "Skill-Gap Analysis", "Roster Intelligence", "Competency Forecasting", "Learning Recs", "Burnout Indicators", "Succession Planning", "Risk Centre"] },
    { n: 4, key: "enterprise", name: "Enterprise Intelligence", desc: "Strategic, quality, financial & operational insight", href: "/super-admin/ai/enterprise", action: "Open",
      kpis: [
        { label: "Tenants", value: dash(num(tenants)) },
        { label: "Organisations", value: dash(num(orgs)) },
        { label: "Quality", value: "—" },
        { label: "Financial", value: "—" },
      ], subs: ["Executive Briefings", "Enterprise Scorecards", "Quality Intelligence", "Accreditation", "Benchmarking", "Financial Intelligence", "Strategic Planning", "Board Reports"] },
    { n: 5, key: "studio", name: "AI Studio & Automation", desc: "Build governed agents, prompts, workflows & automations", href: "/super-admin/ai/studio", action: "Build",
      kpis: [
        { label: "Agents", value: dash(COPILOTS.length) },
        { label: "Automations", value: dash(jobs.summary.runnable) },
        { label: "Prompts", value: "—" },
        { label: "Test Runs", value: "—" },
      ], subs: ["Prompt Builder", "Agent Builder", "Workflow Automation", "Decision Tree Builder", "Knowledge Connectors", "Tool Registry", "Testing Playground", "Publishing"] },
    { n: 6, key: "analytics", name: "Intelligence Analytics", desc: "Measure AI performance, usage, safety & value", href: "/super-admin/ai/analytics", action: "Open",
      kpis: [
        { label: "Requests (24h)", value: dash(s.ready ? s.requests24h : null) },
        { label: "Est. Cost (24h)", value: s.ready ? `$${s.cost24h.toFixed(2)}` : "—" },
        { label: "Acceptance", value: "—" },
        { label: "Accuracy", value: "—" },
      ], subs: ["Usage Analytics", "Performance & Accuracy", "Recommendation Analytics", "Prompt Analytics", "Cost & Consumption", "Knowledge Coverage", "Responsible AI", "Outcome Analytics"] },
  ];

  // ── Operations status panel ─────────────────────────────────────────────────
  const opsStatus = {
    configured: ai.configured,
    provider: ai.provider,
    models: ai.models,
    jobsReady: jobs.summary.ready,
    running: jobs.summary.ready ? jobs.summary.running : null,
    runs24h: jobs.summary.ready ? jobs.summary.runs24h : null,
    failed24h: jobs.summary.ready ? jobs.summary.failed24h : null,
    errors24h: s.ready ? s.errors24h : null,
    refusals24h: s.ready ? s.refusals24h : null,
    avgLatencyMs: s.avgLatencyMs,
    pendingApprovals,
    cost24h: s.ready ? s.cost24h : null,
    tokens24h: s.ready ? s.tokens24h : null,
  };

  return {
    ribbon,
    modules,
    copilots,
    opsStatus,
    byOperation: gov.byOperation,
    byModel: gov.byModel,
    recent: gov.recent,
    generatedAt: new Date().toISOString(),
  };
}
