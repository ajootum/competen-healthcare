/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-023 — Competency Governance AI Agent & Autonomous Assurance.
// "How can AI continuously support governance while maintaining human accountability?" The governed-AI view over
// real stores (the AI platform operator console stays in AIS — cross-linked):
//   • plat_ai_requests (mig 055) — the governed AI request log: operation, provider, model, tokens, latency,
//     status. Everything runs through the governed gateway, so this is the real AI activity under governance.
//   • ais_models (mig 111) — the model registry: provider, tier, status (active/preview/deprecated/retired), default.
// From them: governed-AI activity (volume, success, tokens, latency) with the governance-domain slice highlighted,
// the model registry health, and the 5 governance AGENTS (§5) mapped to the LIVE surfaces they operate over. The
// human-in-the-loop boundary (§4.1/§7 — AI never approves/alters/overrides) is surfaced explicitly. No migration.

type Admin = any;
const DAY = 86400000;
const GOV_OP = /cgr|governance|assur|capa|capm|competency|audit|risk|complian/i;

export async function loadGovernanceAI(admin: Admin) {
  const [reqRes, modelRes] = await Promise.all([
    admin.from("plat_ai_requests").select("operation, tier, provider, model, total_tokens, latency_ms, status, created_at").order("created_at", { ascending: false }).limit(4000),
    admin.from("ais_models").select("provider_code, display_name, tier, status, is_default").limit(300),
  ]);

  const reqs = (reqRes.error ? [] : reqRes.data ?? []) as any[];
  const models = (modelRes.error ? [] : modelRes.data ?? []) as any[];
  const now = Date.now();

  const total = reqs.length;
  const ok = reqs.filter((r) => r.status === "ok").length;
  const tokens = reqs.reduce((t, r) => t + (r.total_tokens ?? 0), 0);
  const avgLatency = total ? Math.round(reqs.reduce((t, r) => t + (r.latency_ms ?? 0), 0) / total) : null;
  const govCount = reqs.filter((r) => GOV_OP.test(r.operation || "")).length;
  const last7 = reqs.filter((r) => now - new Date(r.created_at).getTime() <= 7 * DAY).length;

  const byOp = new Map<string, number>();
  const byProvider = new Map<string, number>();
  const byTier = new Map<string, number>();
  for (const r of reqs) {
    byOp.set(r.operation || "unknown", (byOp.get(r.operation || "unknown") ?? 0) + 1);
    byProvider.set(r.provider || "—", (byProvider.get(r.provider || "—") ?? 0) + 1);
    byTier.set(r.tier || "—", (byTier.get(r.tier || "—") ?? 0) + 1);
  }
  const operations = [...byOp.entries()].map(([op, count]) => ({ op, count, governance: GOV_OP.test(op) })).sort((a, b) => b.count - a.count).slice(0, 10);
  const providers = [...byProvider.entries()].map(([provider, count]) => ({ provider, count })).sort((a, b) => b.count - a.count);
  const tiers = [...byTier.entries()].map(([tier, count]) => ({ tier, count })).sort((a, b) => b.count - a.count);

  const modelStatus: Record<string, number> = { active: 0, preview: 0, deprecated: 0, retired: 0 };
  for (const m of models) if (m.status in modelStatus) modelStatus[m.status]++;
  const defaultModel = models.find((m) => m.is_default)?.display_name ?? null;

  return {
    provisioned: total > 0 || models.length > 0,
    kpis: {
      requests: total,
      successRate: total ? Math.round((ok / total) * 100) : null,
      tokens,
      avgLatency,
      governanceShare: total ? Math.round((govCount / total) * 100) : null,
      last7,
      activeModels: modelStatus.active,
    },
    operations,
    providers,
    tiers,
    models: { total: models.length, status: modelStatus, defaultModel },
  };
}
