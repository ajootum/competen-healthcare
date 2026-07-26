// AI Services Platform Phase 1 loaders (AIS-001 control plane / AIS-009 model registry / AIS-011 observability).
// A real control-plane over the existing AI Runtime Gateway: live provider config from aiStatus() (env detection),
// the ais_providers/ais_models registry (mirrors the gateway's real pricing), and telemetry aggregated from
// plat_ai_requests via the gateway's own loadAiGovernance(). Read model — the runtime itself is src/lib/ai/*.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadAiGovernance } from "./gateway";
import { aiStatus } from "./config";

export const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const soft = (p: any) => p.then((r: any) => r, () => ({ data: [], error: null }));

async function fetchRegistry(admin: any) {
  const [provRes, modelRes] = await Promise.all([
    soft(admin.from("ais_providers").select("*").order("priority")),
    soft(admin.from("ais_models").select("*").order("provider_code")),
  ]);
  return { providers: (provRes.data ?? []) as any[], models: (modelRes.data ?? []) as any[], provisioned: !(provRes.error && missing(provRes.error)) };
}

// ── AIS-001 Control Plane overview ──
export async function loadAiControlPlane(admin: any) {
  const [reg, gov] = await Promise.all([fetchRegistry(admin), loadAiGovernance(admin).catch(() => null as any)]);
  const status = aiStatus();
  const s = gov?.summary ?? {};

  const providers = reg.providers.map(p => ({ ...p, live: status.configured && status.provider === p.code }));
  const activeModels = reg.models.filter(m => m.status === "active");

  return {
    provisioned: reg.provisioned,
    aiConfigured: status.configured, activeProvider: status.provider,
    kpis: {
      requests24h: s.requests24h ?? 0, tokens24h: s.tokens24h ?? 0, cost24h: s.cost24h ?? 0,
      errors24h: s.errors24h ?? 0, refusals24h: s.refusals24h ?? 0, avgLatencyMs: s.avgLatencyMs ?? null,
      totalRequests: s.totalRequests ?? 0, totalCost: s.totalCost ?? 0,
      activeProviders: providers.filter(p => p.status === "active").length, activeModels: activeModels.length,
      telemetryReady: s.ready ?? false,
    },
    providers, byModel: gov?.byModel ?? [], byOperation: gov?.byOperation ?? [], byTier: gov?.byTier ?? [], recent: gov?.recent ?? [],
    defaultModel: reg.models.find(m => m.is_default) ?? null,
  };
}

// ── AIS-009 Model & Provider Registry ──
export async function loadAiModelRegistry(admin: any) {
  const [reg, gov] = await Promise.all([fetchRegistry(admin), loadAiGovernance(admin).catch(() => null as any)]);
  if (!reg.provisioned) return { provisioned: false as const };
  const status = aiStatus();
  const usageByModel = new Map<string, any>((gov?.byModel ?? []).map((m: any) => [m.label, m]));

  const providers = reg.providers.map(p => {
    const models = reg.models.filter(m => m.provider_code === p.code).map(m => ({ ...m, usage: usageByModel.get(m.model_id) ?? null }));
    return { ...p, live: status.configured && status.provider === p.code, models, modelCount: models.length };
  });

  return {
    provisioned: true as const,
    providers, aiConfigured: status.configured, activeProvider: status.provider,
    kpis: {
      providers: reg.providers.length, activeProviders: reg.providers.filter(p => p.status === "active").length,
      models: reg.models.length, activeModels: reg.models.filter(m => m.status === "active").length,
      deprecated: reg.models.filter(m => ["deprecated", "retired"].includes(m.status)).length,
      preview: reg.models.filter(m => m.status === "preview").length,
    },
    models: reg.models.map(m => ({ ...m, usage: usageByModel.get(m.model_id) ?? null })).sort((a, b) => (b.usage?.n ?? 0) - (a.usage?.n ?? 0)),
  };
}

// ── AIS-011 Observability (reuse the gateway's own aggregation over plat_ai_requests) ──
export async function loadAiObservability(admin: any) {
  const gov = await loadAiGovernance(admin).catch(() => null as any);
  if (!gov) return { provisioned: false as const };
  // 7-day daily request/cost series for the trend chart.
  const res = await soft(admin.from("plat_ai_requests").select("status, cost_usd, created_at, latency_ms").gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()).order("created_at"));
  const rows = (res.data ?? []) as any[];
  const days: Record<string, { n: number; cost: number; err: number }> = {};
  for (let i = 6; i >= 0; i--) days[new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)] = { n: 0, cost: 0, err: 0 };
  rows.forEach(r => { const d = String(r.created_at).slice(0, 10); if (d in days) { days[d].n++; days[d].cost += Number(r.cost_usd ?? 0); if (r.status !== "ok") days[d].err++; } });
  const trend = Object.entries(days).map(([d, v]) => ({ d: d.slice(5), n: v.n, cost: Math.round(v.cost * 100) / 100, err: v.err }));

  return { provisioned: true as const, summary: gov.summary, byModel: gov.byModel, byOperation: gov.byOperation, byTier: gov.byTier, recent: gov.recent, trend, windowRows: rows.length };
}
