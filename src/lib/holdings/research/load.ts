/* eslint-disable @typescript-eslint/no-explicit-any */
import { POLICY_PATH, WORKFLOWS_PATH, resolveResearchPolicy, resolveWorkflows, workflowOperational, type ResearchPolicy, type Workflow } from "./engine-config";
import { REGISTRY_PATH, RESEARCH_SCOPE, resolveRegistry, type ProviderRecord, type Registry, type ResearchActivity, type ResearchProduct } from "./registry";
import type { ResearchPlan, ResearchUsage, UsageRow } from "./service";

// ── THE ENGINE AT RUNTIME ── what is PUBLISHED, and research usage recorded apart from AI usage ─────────────────────────
//
// Runtime reads only published documents (CONFIG-002). An unreadable read gives the seeded registry, where nothing is
// Active, so nothing can run: the engine fails closed.
//
// Research usage and cost go to plat_research_requests (migration 630), one row per provider call: which source, which
// capability, how many requests and results, the outcome, latency and cost. No query text, no person, no product
// content. They are kept apart from plat_ai_requests so research spend is never read as AI spend.
// ⚠ BUDGETS FAIL CLOSED. A provider's daily budget is checked from those rows before each call; until 630 is applied
// (or when the read fails) nothing is allowed, which with nothing Active by default changes nothing.

export type ResearchEngine = { registry: Registry; policy: ResearchPolicy; workflows: Record<string, Workflow>; readable: boolean };

export async function loadResearchEngine(admin: any): Promise<ResearchEngine> {
  try {
    const { data, error } = await admin.from("workspace_config_overrides").select("config_path, published")
      .eq("scope_type", RESEARCH_SCOPE.scopeType).eq("scope_ref", RESEARCH_SCOPE.scopeRef).in("config_path", [REGISTRY_PATH, POLICY_PATH, WORKFLOWS_PATH]);
    if (error) throw error;
    const get = (p: string) => (data ?? []).find((r: any) => r.config_path === p)?.published ?? null;
    return { registry: resolveRegistry(get(REGISTRY_PATH)), policy: resolveResearchPolicy(get(POLICY_PATH)), workflows: resolveWorkflows(get(WORKFLOWS_PATH)), readable: true };
  } catch {
    return { registry: resolveRegistry(null), policy: resolveResearchPolicy(null), workflows: resolveWorkflows(null), readable: false };
  }
}

/** The plan for one consumer: its product, activity and workflow (Basic unless named). */
export const planFor = (e: ResearchEngine, product: ResearchProduct, activity: ResearchActivity, workflow = "basic"): ResearchPlan =>
  ({ product, activity, registry: e.registry, policy: e.policy, workflow: e.workflows[workflow] });

/** Whether research is operational for this consumer right now: the workflow Active and every capability it needs Active. */
export const researchOperational = (e: ResearchEngine, product: ResearchProduct, activity: ResearchActivity, workflow = "basic") =>
  e.readable && workflowOperational(e.workflows[workflow], e.registry, { product, activity });

const today = () => `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;

/** The recorder and budget check for one action. */
export function researchUsage(admin: any, ctx: { actionId: string | null; product: ResearchProduct; operation: string; workflow: string; policy: ResearchPolicy }): ResearchUsage {
  return {
    async record(row: UsageRow) {
      try {
        await admin.from("plat_research_requests").insert({
          action_id: ctx.actionId, product: ctx.product, operation: ctx.operation.slice(0, 80), workflow: ctx.workflow.slice(0, 40), provider: row.provider.slice(0, 41),
          capability: row.capability, requests: Math.max(0, Math.min(100, row.requests)), results: Math.max(0, Math.min(100, row.results)), outcome: row.outcome,
          latency_ms: Math.max(0, Math.min(600000, Math.round(row.latencyMs))), cost_usd: Math.max(0, row.costUsd),
        });
      } catch { /* best effort: usage is recorded, never blocks a learner */ }
    },
    async allow(r: ProviderRecord) {
      if (r.dailyRequestBudget <= 0) return false;
      const [mine, all] = await Promise.all([
        admin.from("plat_research_requests").select("requests, cost_usd").eq("provider", r.id).gte("created_at", today()).limit(20000),
        admin.from("plat_research_requests").select("requests, cost_usd").gte("created_at", today()).limit(50000),
      ]);
      if (mine.error || all.error) return false;
      const sum = (rows: any[], k: string) => rows.reduce((s, x) => s + (Number(x[k]) || 0), 0);
      if (sum(mine.data ?? [], "requests") >= r.dailyRequestBudget) return false;
      if (r.costPerRequestUsd > 0 && sum(mine.data ?? [], "cost_usd") + r.costPerRequestUsd > r.dailySpendBudgetUsd) return false;
      if (sum(all.data ?? [], "requests") >= ctx.policy.limits.dailyRequests) return false;
      if (r.costPerRequestUsd > 0 && sum(all.data ?? [], "cost_usd") + r.costPerRequestUsd > ctx.policy.limits.dailySpendUsd) return false;
      return true;
    },
  };
}

export type UsageSummaryRow = { provider: string; calls: number; requests: number; failed: number; budget: number; cache: number; costUsd: number; avgLatencyMs: number | null };

/** Pure. HQ analytics: research usage by provider over a window. */
export function summariseResearchUsage(rows: readonly { provider: string; requests: number; outcome: string; latency_ms: number; cost_usd: number | string }[]): UsageSummaryRow[] {
  const by = new Map<string, UsageSummaryRow & { lat: number; latN: number }>();
  for (const r of rows) {
    const x = by.get(r.provider) ?? { provider: r.provider, calls: 0, requests: 0, failed: 0, budget: 0, cache: 0, costUsd: 0, avgLatencyMs: null, lat: 0, latN: 0 };
    x.calls++; x.requests += Number(r.requests) || 0; x.costUsd += Number(r.cost_usd) || 0;
    if (r.outcome === "failed") x.failed++;
    if (r.outcome === "budget") x.budget++;
    if (r.outcome === "cache") x.cache++;
    if (r.outcome === "ok" || r.outcome === "failed") { x.lat += Number(r.latency_ms) || 0; x.latN++; }
    by.set(r.provider, x);
  }
  return [...by.values()].map(({ lat, latN, ...x }) => ({ ...x, costUsd: +x.costUsd.toFixed(4), avgLatencyMs: latN ? Math.round(lat / latN) : null })).sort((a, b) => b.calls - a.calls);
}

export type CostBucket = "accepted" | "partial" | "safe_non_answer" | "error" | "unlinked";
export type CostByOutcome = Record<CostBucket, { actions: number; requests: number; costUsd: number }>;

/**
 * Pure. Research usage and cost attributed to the AI action it served and that action's outcome (plat_ai_outcomes,
 * migration 600), joined on action_id: an answer shown (accepted), partly shown, a safe non-answer (everything
 * withheld by the checks), an error, or unlinked (no action id, or no outcome recorded for it).
 */
export function researchCostByOutcome(
  usage: readonly { action_id: string | null; requests: number; cost_usd: number | string }[],
  outcomes: readonly { action_id: string; outcome: string }[],
): CostByOutcome {
  const of = new Map(outcomes.map(o => [o.action_id, o.outcome]));
  const out = Object.fromEntries((["accepted", "partial", "safe_non_answer", "error", "unlinked"] as CostBucket[]).map(b => [b, { actions: 0, requests: 0, costUsd: 0 }])) as CostByOutcome;
  const seen = new Map<CostBucket, Set<string>>();
  for (const u of usage) {
    const o = u.action_id ? of.get(u.action_id) : undefined;
    const b: CostBucket = !o ? "unlinked" : o === "accepted" ? "accepted" : o === "partial" ? "partial" : o === "rejected" || o === "redirected" ? "safe_non_answer" : "error";
    out[b].requests += Number(u.requests) || 0;
    out[b].costUsd += Number(u.cost_usd) || 0;
    const s = seen.get(b) ?? new Set<string>(); s.add(u.action_id ?? `row-${s.size}`); seen.set(b, s);
  }
  for (const [b, s] of seen) out[b].actions = s.size;
  for (const b of Object.keys(out) as CostBucket[]) out[b].costUsd = +out[b].costUsd.toFixed(6);
  return out;
}
