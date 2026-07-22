// Intelligence Analytics (AIP-001.6) loader — measures how AI is used, whether it
// performs safely, and whether it creates value. This is the most data-backed AIP
// module: usage, latency, cost, tokens, model/operation/tier breakdowns and the
// 7-day trend all come straight from the AI runtime gateway (plat_ai_requests).
// Responsible-AI signals (errors, refusals) are real; recommendation acceptance,
// model accuracy and outcome tracking have no store yet → honest "—". Knowledge
// coverage is reused from the CKP knowledge-intelligence layer. Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadAiGovernance } from "@/lib/ai/gateway";
import { loadKnowledgeIntelligence } from "@/lib/super-admin/ckp-intelligence";

const DAY = 86400000;
const round = (n: number, d = 2) => +n.toFixed(d);

export async function loadAiAnalytics(admin: any) {
  const [gov, ki, uidRes] = await Promise.all([
    loadAiGovernance(admin),
    loadKnowledgeIntelligence(admin).catch(() => null),
    admin.from("plat_ai_requests").select("actor_id, created_at, status").order("created_at", { ascending: false }).limit(20000),
  ]);
  const s = gov.summary;

  // ── Active users + 7-day usage trend (from real request rows) ───────────────
  const rows = (uidRes.error ? [] : uidRes.data ?? []) as any[];
  const now = Date.now();
  const since24 = now - DAY;
  const dau = new Set(rows.filter(r => new Date(r.created_at).getTime() >= since24 && r.actor_id).map(r => r.actor_id)).size;
  const wau = new Set(rows.filter(r => new Date(r.created_at).getTime() >= now - 7 * DAY && r.actor_id).map(r => r.actor_id)).size;
  const trend: { day: string; n: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const start = now - i * DAY; const d0 = new Date(start); d0.setHours(0, 0, 0, 0);
    const t0 = d0.getTime(), t1 = t0 + DAY;
    const n = rows.filter(r => { const t = new Date(r.created_at).getTime(); return t >= t0 && t < t1; }).length;
    trend.push({ day: d0.toLocaleDateString([], { month: "short", day: "numeric" }), n });
  }
  const trendMax = Math.max(1, ...trend.map(t => t.n));

  // ── Rates (real) ────────────────────────────────────────────────────────────
  const errorRate = s.requests24h ? round((s.errors24h / s.requests24h) * 100, 1) : null;
  const refusalRate = s.requests24h ? round((s.refusals24h / s.requests24h) * 100, 1) : null;
  const safetyEscalations = s.ready ? s.errors24h + s.refusals24h : null;

  const kpis = {
    dau: s.ready ? dau : null,
    requests24h: s.ready ? s.requests24h : null,
    acceptance: null as number | null,     // not stored
    accuracy: null as number | null,        // not metered
    avgLatencyMs: s.avgLatencyMs,
    knowledgeCoverage: ki?.kpis?.coverage ?? null,
    cost24h: s.ready ? s.cost24h : null,
    safetyEscalations,
  };

  // Responsible-AI monitoring: real where we capture it, honest null elsewhere.
  const responsible = [
    { label: "Errors (24h)", value: s.ready ? s.errors24h : null, ok: (s.errors24h ?? 0) === 0 },
    { label: "Refusals (24h)", value: s.ready ? s.refusals24h : null, ok: true },
    { label: "Error rate", value: errorRate == null ? null : `${errorRate}%`, ok: (errorRate ?? 0) < 5 },
    { label: "Refusal rate", value: refusalRate == null ? null : `${refusalRate}%`, ok: true },
    { label: "Bias signals", value: null, ok: null },        // not monitored
    { label: "Privacy incidents", value: null, ok: null },   // not monitored
    { label: "Human override rate", value: null, ok: null }, // not tracked
    { label: "Model drift", value: null, ok: null },         // not monitored
  ];

  // Recommendation analytics — generation is observable (as AI requests); the
  // downstream funnel isn't stored yet.
  const recommendation = [
    { label: "Generated (24h)", value: s.ready ? s.requests24h : null },
    { label: "Viewed", value: null },
    { label: "Accepted", value: null },
    { label: "Modified", value: null },
    { label: "Rejected", value: null },
    { label: "Implemented", value: null },
  ];

  return {
    kpis,
    ready: s.ready,
    byModel: gov.byModel,
    byOperation: gov.byOperation,
    byTier: gov.byTier,
    cost: { cost24h: s.ready ? s.cost24h : null, totalCost: s.ready ? s.totalCost : null, tokens24h: s.ready ? s.tokens24h : null, totalRequests: s.ready ? s.totalRequests : null },
    performance: { avgLatencyMs: s.avgLatencyMs, errorRate, refusalRate },
    responsible,
    recommendation,
    trend, trendMax, dau, wau,
    generatedAt: new Date().toISOString(),
  };
}
