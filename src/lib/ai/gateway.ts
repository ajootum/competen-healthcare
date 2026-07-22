// AI Runtime Gateway governance (PFS-000 §15). Centralises usage accounting for
// every server-side AI generation: the shared generate() choke point records
// one plat_ai_requests row per call (model, tier, tokens, latency, status, cost),
// and this module estimates cost from list pricing and aggregates the analytics
// that power the AI Operations widget and the AI Gateway console. Fail-soft: all
// DB access is best-effort so AI still works before RUN-ME-055 is applied.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createAdminClient } from "@/lib/supabase/server";

// Anthropic list pricing, USD per 1M tokens (input / output). Keyed by the model
// id prefix so dated snapshots match. Update when pricing changes.
const PRICING: { prefix: string; in: number; out: number }[] = [
  { prefix: "claude-fable-5", in: 10, out: 50 },
  { prefix: "claude-opus-4-8", in: 5, out: 25 },
  { prefix: "claude-opus-4-7", in: 5, out: 25 },
  { prefix: "claude-opus-4-6", in: 5, out: 25 },
  { prefix: "claude-opus-4", in: 5, out: 25 },
  { prefix: "claude-sonnet-5", in: 3, out: 15 },
  { prefix: "claude-sonnet-4", in: 3, out: 15 },
  { prefix: "claude-haiku-4-5", in: 1, out: 5 },
];

export function estimateCost(model: string | null | undefined, input: number, output: number): number | null {
  if (!model) return null;
  const p = PRICING.find(x => model.startsWith(x.prefix));
  if (!p) return null;
  return +((input / 1e6) * p.in + (output / 1e6) * p.out).toFixed(6);
}

export type AiUsageEntry = {
  operation?: string | null; tier?: string | null; provider?: string | null; model?: string | null;
  inputTokens?: number | null; outputTokens?: number | null; latencyMs?: number | null;
  status: "ok" | "refusal" | "error" | "not_configured"; error?: string | null;
  actorId?: string | null; tenantId?: string | null;
};

// Best-effort insert of one usage row. Never throws — logging must not break the
// AI call that produced it.
export async function recordAiUsage(e: AiUsageEntry) {
  try {
    const admin = createAdminClient() as any;
    const input = e.inputTokens ?? 0, output = e.outputTokens ?? 0;
    await admin.from("plat_ai_requests").insert({
      actor_id: e.actorId ?? null, tenant_id: e.tenantId ?? null,
      operation: e.operation ?? null, tier: e.tier ?? null, provider: e.provider ?? null, model: e.model ?? null,
      input_tokens: input, output_tokens: output, total_tokens: input + output,
      latency_ms: e.latencyMs ?? null, status: e.status, error: e.error ? String(e.error).slice(0, 500) : null,
      cost_usd: estimateCost(e.model, input, output),
    });
  } catch { /* pre-migration / non-fatal */ }
}

const DAY = 86400000;
const round = (n: number, d = 2) => +n.toFixed(d);

// Usage analytics for the AI Gateway console + the AI Operations widget.
export async function loadAiGovernance(admin: any) {
  const res = await admin.from("plat_ai_requests")
    .select("operation, tier, model, input_tokens, output_tokens, total_tokens, latency_ms, status, cost_usd, created_at")
    .order("created_at", { ascending: false }).limit(5000);
  const ready = !res.error;
  const rows = (ready ? res.data ?? [] : []) as any[];
  const since = Date.now() - DAY;
  const d = rows.filter(r => new Date(r.created_at).getTime() >= since);

  const sum = (a: any[], k: string) => a.reduce((n, r) => n + (r[k] ?? 0), 0);
  const byKey = (a: any[], k: string) => {
    const m = new Map<string, { n: number; tokens: number; cost: number }>();
    for (const r of a) { const key = r[k] ?? "—"; const g = m.get(key) ?? { n: 0, tokens: 0, cost: 0 }; g.n++; g.tokens += r.total_tokens ?? 0; g.cost += Number(r.cost_usd ?? 0); m.set(key, g); }
    return [...m.entries()].map(([label, g]) => ({ label, n: g.n, tokens: g.tokens, cost: round(g.cost, 4) })).sort((a, b) => b.n - a.n);
  };
  const okLat = d.filter(r => r.latency_ms != null).map(r => r.latency_ms);

  const summary = {
    ready,
    requests24h: d.length,
    tokens24h: sum(d, "total_tokens"),
    cost24h: round(d.reduce((n, r) => n + Number(r.cost_usd ?? 0), 0), 4),
    errors24h: d.filter(r => r.status === "error").length,
    refusals24h: d.filter(r => r.status === "refusal").length,
    avgLatencyMs: okLat.length ? Math.round(okLat.reduce((a, b) => a + b, 0) / okLat.length) : null,
    totalRequests: rows.length,
    totalCost: round(rows.reduce((n, r) => n + Number(r.cost_usd ?? 0), 0), 2),
  };
  return {
    summary,
    byModel: byKey(d, "model").slice(0, 8),
    byOperation: byKey(d, "operation").slice(0, 8),
    byTier: byKey(d, "tier"),
    recent: rows.slice(0, 15).map(r => ({ operation: r.operation, model: r.model, tier: r.tier, tokens: r.total_tokens, latency: r.latency_ms, status: r.status, cost: r.cost_usd, at: r.created_at })),
  };
}
