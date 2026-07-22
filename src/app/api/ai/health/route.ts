import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { aiStatus } from "@/lib/ai/config";
import { loadAiGovernance } from "@/lib/ai/gateway";

// POS-001 /api/ai/health — AI Runtime Gateway status: provider/config plus live
// 24h request, error and cost telemetry from the usage log. Super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();

  const s = aiStatus();
  const gov = await loadAiGovernance(c.admin as any);
  const health = !s.configured ? "not_configured" : gov.summary.errors24h > 0 ? "degraded" : "operational";
  return NextResponse.json({
    health,
    provider: s.provider,
    configured: s.configured,
    models: s.models,
    telemetry: gov.summary.ready,
    requests24h: gov.summary.requests24h,
    errors24h: gov.summary.errors24h,
    refusals24h: gov.summary.refusals24h,
    tokens24h: gov.summary.tokens24h,
    cost24h: gov.summary.cost24h,
    avgLatencyMs: gov.summary.avgLatencyMs,
  }, { headers: { "Cache-Control": "no-store" } });
}
