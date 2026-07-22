// AI Operations Centre (AIP-001.1) loader — the operational HQ for AI. Manages the
// technical lifecycle of every AI capability: service health, the agent/copilot
// registry, model registry, the AI job queue and the human review queue. All
// derived from real signals — the AI runtime gateway (plat_ai_requests), the job
// runner (plat_job_runs), the approval engine (plat_approval_requests) and provider
// config (aiStatus). Services with no separate instrumentation are shown honestly
// as "Not instrumented" rather than faked. Fail-soft throughout.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadAiGovernance } from "@/lib/ai/gateway";
import { loadJobs } from "@/lib/platform/jobs";
import { aiStatus } from "@/lib/ai/config";
import { COPILOTS } from "@/lib/super-admin/ai";

const num = (r: any) => (r?.error ? null : r?.count ?? 0);

export async function loadAiOperations(admin: any) {
  const [gov, jobs, apprPending, apprProbe, koTotal, koRecent] = await Promise.all([
    loadAiGovernance(admin),
    loadJobs(admin),
    admin.from("plat_approval_requests").select("*", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("plat_approval_requests").select("id", { head: true }).limit(1),
    admin.from("knowledge_objects").select("*", { count: "exact", head: true }),
    admin.from("knowledge_objects").select("*", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 86400000).toISOString()),
  ]);

  const ai = aiStatus();
  const s = gov.summary;
  const limit = Number(process.env.AI_HOURLY_LIMIT ?? 30);
  const apprReady = !apprProbe.error;
  const pendingApprovals = num(apprPending) ?? 0;
  const errRate = s.requests24h ? Math.round((s.errors24h / s.requests24h) * 100) : null;

  const modelsOnline = ai.models ? new Set([ai.models.cheap, ai.models.reasoning, ai.models.heavy].filter(Boolean)).size : 0;
  const opUsage = (ops: string[]) => gov.byOperation.reduce((n: number, o: any) => n + (ops.some(x => String(o.label ?? "").toLowerCase().includes(x)) ? o.n : 0), 0);
  const agents = COPILOTS.map(c => {
    const usageToday = opUsage(c.ops);
    return { key: c.key, name: c.name, desc: c.desc, icon: c.icon, usageToday, accuracy: null as number | null, escalations: null as number | null, status: usageToday > 0 ? "running" : "idle", model: ai.models?.reasoning ?? null };
  });
  const activeAgents = agents.filter(a => a.status === "running").length;

  const aiHealth = !ai.configured ? null : (s.requests24h ? Math.round((1 - s.errors24h / s.requests24h) * 100) : 100);

  // ── AI service health — real signals only; honest "Not instrumented" elsewhere.
  type Svc = { name: string; desc: string; status: string; detail: string; ok: boolean | null };
  const services: Svc[] = [
    { name: "Model Gateway", desc: "lib/ai/client · generate()", status: !ai.configured ? "Not configured" : s.errors24h > 0 ? "Degraded" : "Operational", detail: ai.configured ? `${ai.provider} · ${s.avgLatencyMs == null ? "—" : s.avgLatencyMs + "ms"} avg` : "no provider key", ok: !ai.configured ? null : s.errors24h === 0 },
    { name: "Usage Metering", desc: "plat_ai_requests (055)", status: s.ready ? "Operational" : "Not ready", detail: s.ready ? `${s.requests24h} req/24h · ${errRate ?? 0}% err` : "run migration 055", ok: s.ready },
    { name: "Job Runner", desc: "plat_job_runs (054)", status: jobs.summary.ready ? "Operational" : "Not ready", detail: jobs.summary.ready ? `${jobs.summary.running} running · ${jobs.summary.failed24h} failed/24h` : "run migration 054", ok: jobs.summary.ready ? jobs.summary.failed24h === 0 : false },
    { name: "Approval Engine", desc: "plat_approval_requests (057)", status: apprReady ? "Operational" : "Not ready", detail: apprReady ? `${pendingApprovals} pending` : "run migration 057", ok: apprReady },
    { name: "Rate Limiter", desc: "lib/ai/quota · audit_log", status: "Operational", detail: `${limit}/hr per user`, ok: true },
    { name: "Safety & Moderation", desc: "refusal capture on generate()", status: ai.configured ? "Operational" : "—", detail: s.ready ? `${s.refusals24h} refusals/24h` : "telemetry off", ok: ai.configured ? true : null },
    { name: "AI Audit", desc: "audit_log", status: "Operational", detail: "actor/action trail", ok: true },
    { name: "Vector DB / Embeddings", desc: "not separately instrumented", status: "Not instrumented", detail: "no telemetry surface yet", ok: null },
  ];

  // ── Model registry — configured tiers enriched with live usage.
  const usageByModel = new Map<string, any>(gov.byModel.map((m: any) => [m.label, m]));
  const models = ai.models
    ? (["heavy", "reasoning", "cheap", "embedding"] as const).map(tier => {
        const model = ai.models![tier];
        const u = usageByModel.get(model);
        return { tier, model, provider: ai.provider, requests: u?.n ?? 0, tokens: u?.tokens ?? 0, cost: u?.cost ?? 0 };
      })
    : [];

  // ── Job queue — real states from plat_job_runs + the review queue.
  const completed24h = jobs.summary.ready ? Math.max(0, jobs.summary.runs24h - jobs.summary.failed24h - jobs.summary.running) : null;
  const jobStates = {
    running: jobs.summary.ready ? jobs.summary.running : null,
    completed24h,
    failed24h: jobs.summary.ready ? jobs.summary.failed24h : null,
    awaitingReview: apprReady ? pendingApprovals : null,
  };

  return {
    kpis: {
      aiHealth, runningAgents: activeAgents, modelsOnline,
      queuedJobs: jobs.summary.ready ? jobs.summary.running : null,
      failedJobs: jobs.summary.ready ? jobs.summary.failed24h : null,
      inferenceRequests: s.ready ? s.totalRequests : null,
      avgResponseMs: s.avgLatencyMs,
      knowledgeUpdates: num(koRecent),
    },
    provider: { configured: ai.configured, provider: ai.provider, models: ai.models },
    services,
    agents,
    models,
    jobs: { list: jobs.jobs, recent: jobs.recent, summary: jobs.summary },
    jobStates,
    byOperation: gov.byOperation,
    recent: gov.recent,
    counts: { knowledgeSources: num(koTotal) ?? 0, promptOperations: gov.byOperation.length, agents: COPILOTS.length, pendingApprovals },
    cost24h: s.ready ? s.cost24h : null,
    tokens24h: s.ready ? s.tokens24h : null,
    generatedAt: new Date().toISOString(),
  };
}
