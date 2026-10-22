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

// WHO A GENERATION IS ATTRIBUTED TO — one typed contract for every product (COMP-ARCH-PSA-001).
// There is deliberately no bare `tenantId`: plat_ai_requests.tenant_id references tenants(id), and two
// products passed ids that are not tenants into it -- Practice its workspace id, the Enterprise copilots
// profiles.hospital_id -- so the database refused every one of those rows. The scope makes the caller
// say which kind of id it holds, and the gateway decides the column.
//   tenant     Enterprise / estate. tenants.id, which IS the organisation id (migration 041 reuses the
//              organisation uuid as the tenant id). Read profiles.tenant_id -- never hospital_id.
//              Null when the caller has no tenant (super_admin, an unattached profile).
//   workspace  Practice. practice_workspace.id. A workspace is not a tenant (the two-gate split).
//   person     Individual. The actor alone: no tenant, no workspace.
export type AiAttribution =
  | { scope: "tenant"; tenantId: string | null }
  | { scope: "workspace"; workspaceId: string }
  | { scope: "person" };

export type AiUsageEntry = {
  operation?: string | null; tier?: string | null; provider?: string | null; model?: string | null;
  inputTokens?: number | null; outputTokens?: number | null; latencyMs?: number | null;
  status: "ok" | "refusal" | "error" | "not_configured"; error?: string | null;
  actorId?: string | null; attribution?: AiAttribution | null;
};

// The identifier columns one attribution writes. workspace_id and attribution_scope arrive with
// migration 371 -- see recordAiUsage for the row written before it is applied.
export function attributionColumns(a: AiAttribution | null | undefined) {
  return {
    tenant_id: a?.scope === "tenant" ? a.tenantId : null,
    workspace_id: a?.scope === "workspace" ? a.workspaceId : null,
    attribution_scope: a?.scope ?? null,
  };
}

// Best-effort insert of one usage row. Never throws — logging must not break the
// AI call that produced it. But a dropped row IS reported: supabase-js returns a
// failed insert as { error } rather than throwing, so the catch alone never saw
// one, and a foreign-key violation lost every row it touched without a trace.
export async function recordAiUsage(e: AiUsageEntry) {
  const what = `[ai-gateway] usage row for "${e.operation ?? "unknown"}" was NOT recorded`;
  try {
    const admin = createAdminClient() as any;
    const input = e.inputTokens ?? 0, output = e.outputTokens ?? 0;
    const { tenant_id, workspace_id, attribution_scope } = attributionColumns(e.attribution);
    const row = {
      actor_id: e.actorId ?? null, tenant_id,
      operation: e.operation ?? null, tier: e.tier ?? null, provider: e.provider ?? null, model: e.model ?? null,
      input_tokens: input, output_tokens: output, total_tokens: input + output,
      latency_ms: e.latencyMs ?? null, status: e.status, error: e.error ? String(e.error).slice(0, 500) : null,
      cost_usd: estimateCost(e.model, input, output),
    };
    let { error } = await admin.from("plat_ai_requests").insert({ ...row, workspace_id, attribution_scope });
    // ⚠ BEFORE MIGRATION 371 IS APPLIED the two columns do not exist and PostgREST refuses the whole row
    // (PGRST204). Land it without them -- usage counted, workspace unattributed -- rather than lose it.
    if (error?.code === "PGRST204") ({ error } = await admin.from("plat_ai_requests").insert(row));
    if (error) console.error(`${what}: ${error.message}`);
  } catch (err) {
    console.error(`${what}: ${String((err as Error)?.message ?? err)}`);
  }
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
