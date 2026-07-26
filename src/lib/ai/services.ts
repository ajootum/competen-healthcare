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

const mean = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
const groupN = (rows: any[], key: string) => Object.entries(rows.reduce((acc: Record<string, number>, r) => { const k = r[key] ?? "other"; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {})).map(([label, n]) => ({ label, n: n as number })).sort((a, b) => b.n - a.n);

// ── AIS-007 Prompt & Conversation Framework (prompt templates + personas) ──
export async function loadAiPrompts(admin: any) {
  const [tplRes, persRes] = await Promise.all([soft(admin.from("ais_prompt_templates").select("*").order("usage", { ascending: false })), soft(admin.from("ais_personas").select("*"))]);
  if (tplRes.error && missing(tplRes.error)) return { provisioned: false as const };
  const templates = (tplRes.data ?? []) as any[]; const personas = (persRes.data ?? []) as any[];
  return {
    provisioned: true as const, templates, personas,
    kpis: { templates: templates.length, active: templates.filter(t => t.status === "active").length, personas: personas.length, usage: templates.reduce((a, t) => a + Number(t.usage || 0), 0), workspaces: new Set(templates.map(t => t.workspace).filter(Boolean)).size },
    byCategory: groupN(templates, "category"), byWorkspace: groupN(templates, "workspace"),
  };
}

// ── AIS-004 Skills & Plugin Framework ──
export async function loadAiSkills(admin: any) {
  const res = await soft(admin.from("ais_skills").select("*").order("invocations", { ascending: false }));
  if (res.error && missing(res.error)) return { provisioned: false as const };
  const skills = (res.data ?? []) as any[];
  return {
    provisioned: true as const, skills,
    kpis: { total: skills.length, active: skills.filter(s => s.status === "active").length, write: skills.filter(s => s.scope === "write").length, needApproval: skills.filter(s => s.requires_approval).length, external: skills.filter(s => s.category === "external").length, invocations: skills.reduce((a, s) => a + Number(s.invocations || 0), 0) },
    byCategory: groupN(skills, "category"),
  };
}

// ── AIS-012 Agent Framework ──
export async function loadAiAgents(admin: any) {
  const res = await soft(admin.from("ais_agents").select("*").order("runs", { ascending: false }));
  if (res.error && missing(res.error)) return { provisioned: false as const };
  const agents = (res.data ?? []) as any[];
  return {
    provisioned: true as const, agents,
    kpis: { total: agents.length, active: agents.filter(a => a.status === "active").length, act: agents.filter(a => a.autonomy === "act").length, runs: agents.reduce((a, x) => a + Number(x.runs || 0), 0), workspaces: new Set(agents.map(a => a.workspace).filter(Boolean)).size, avgSkills: agents.length ? Math.round(agents.reduce((a, x) => a + (x.skills?.length ?? 0), 0) / agents.length) : 0 },
    byAutonomy: [["assist", agents.filter(a => a.autonomy === "assist").length], ["suggest", agents.filter(a => a.autonomy === "suggest").length], ["act", agents.filter(a => a.autonomy === "act").length]].map(([label, n]) => ({ label, n })).filter(x => (x.n as number) > 0),
  };
}

// ── AIS-010 Configuration & No-Code ──
export async function loadAiConfig(admin: any) {
  const res = await soft(admin.from("ais_config").select("*").order("category"));
  if (res.error && missing(res.error)) return { provisioned: false as const };
  const items = (res.data ?? []) as any[];
  const CATS = ["copilot", "model", "safety", "routing", "feature", "knowledge"];
  return {
    provisioned: true as const, items,
    kpis: { total: items.length, active: items.filter(i => i.status === "active").length, inherited: items.filter(i => i.source === "inherited").length, local: items.filter(i => i.source === "local").length, categories: new Set(items.map(i => i.category)).size },
    byCategory: CATS.map(c => ({ category: c, items: items.filter(i => i.category === c) })).filter(g => g.items.length),
  };
}

// ── AIS-006 Recommendation & Prediction Engine (aggregate the platform's REAL AI rec/prediction data) ──
export async function loadAiRecommendations(admin: any) {
  const [admRes, paRes] = await Promise.all([
    soft(admin.from("adm_ai_recommendations").select("title, detail, category, confidence, impact, status")),
    soft(admin.from("pa_predictions").select("title, detail, kind, confidence, risk, impact, horizon, benefit")),
  ]);
  const adm = (admRes.data ?? []).map((r: any) => ({ source: "Administration", kind: "recommendation", title: r.title, detail: r.detail, category: r.category, confidence: Number(r.confidence || 0), impact: r.impact, status: r.status }));
  const pa = (paRes.data ?? []).map((r: any) => ({ source: "Performance", kind: r.kind, title: r.title, detail: r.detail, category: r.kind, confidence: Number(r.confidence || 0), impact: r.impact ?? r.risk, benefit: Number(r.benefit || 0), horizon: r.horizon }));
  const all = [...adm, ...pa];
  if (!all.length) return { provisioned: true as const, hasData: false, all: [] };
  return {
    provisioned: true as const, hasData: true,
    kpis: {
      total: all.length, recommendations: all.filter(r => r.kind === "recommendation").length, predictions: all.filter(r => r.kind === "prediction").length,
      risks: all.filter(r => r.kind === "risk" || r.impact === "high").length, avgConfidence: mean(all.map(r => r.confidence).filter(Boolean)),
      benefit: pa.reduce((a: number, r: any) => a + (r.benefit || 0), 0), highImpact: all.filter(r => r.impact === "high").length,
    },
    bySource: groupN(all, "source"), byKind: groupN(all, "kind"),
    top: [...all].sort((a, b) => b.confidence - a.confidence).slice(0, 12),
  };
}
