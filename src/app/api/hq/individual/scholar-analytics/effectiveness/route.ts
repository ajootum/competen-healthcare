import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { loadCkriPolicy } from "@/lib/knowledge/governance";
import { loadActivityCost } from "@/lib/ai/activity-cost";
import { loadEffectiveness, parseDays } from "@/lib/hq/effectiveness/measures";
import { reportCsv, reportMarkdown } from "@/lib/hq/effectiveness/report";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// GET /api/hq/individual/scholar-analytics/effectiveness?days=90&format=md|csv|json -- SALE-2026-11 R5 (SALE-15, -16, -18).
//
// ⚠ GATED BY hqApiGate(["hq.scholar.analytics.view"]) (migration 910), the same right as the Pilot Evaluation page.
// ⚠ AGGREGATES ONLY. The learning figures come from migration 985 (consented, floored, rounded, no id, no content), the cost
// figures from the ledger, the Learn audit codes and the gateway log. The export is the owner's pilot closure report.

export async function GET(req: Request) {
  const ctx = await hqApiGate(["hq.scholar.analytics.view"]);
  if (isHqRefusal(ctx)) return ctx;
  const s = new URL(req.url).searchParams;
  const days = parseDays(s.get("days"));
  const format = s.get("format") === "csv" ? "csv" : s.get("format") === "json" ? "json" : "md";
  const policy = await loadCkriPolicy(ctx.admin);
  const [readout, cost] = await Promise.all([loadEffectiveness(ctx.admin, policy, days), loadActivityCost(ctx.admin, Math.min(days, 90))]);
  const generatedAt = new Date().toISOString();
  const headers = { "Cache-Control": "no-store" };
  if (format === "json") return NextResponse.json({ generatedAt, readout, cost }, { headers });
  const stamp = generatedAt.slice(0, 10);
  const body = format === "csv" ? reportCsv({ readout, cost, generatedAt }) : reportMarkdown({ readout, cost, generatedAt });
  return new NextResponse(body, {
    headers: {
      ...headers,
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="scholar-pilot-evaluation-${stamp}-${days}d.${format}"`,
    },
  });
}
