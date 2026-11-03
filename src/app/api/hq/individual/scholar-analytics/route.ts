import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { buildDashboard } from "@/lib/hq/scholar-analytics/dashboard";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// GET /api/hq/individual/scholar-analytics -- SCHOLAR-ENGAGEMENT-ANALYTICS-01.
//
// ⚠ GATED BY hqApiGate(["hq.scholar.analytics.view"]) (migration 910): the Individual Product Administrator and Reviewer.
// ⚠ IDENTITY IS DECIDED ON THE SERVER (src/lib/hq/scholar-analytics/dashboard.ts), NOT IN THE BROWSER. The default answer
// carries pseudonyms only. `named=1` and `include=` beyond human/unclassified need hq.scholar.analytics.identifiable.read
// (or ownership) and are refused with 403 otherwise, so an unauthorised browser never receives a name, an email or an
// account id. Every identifiable answer writes one audit_log row.
// ⚠ NO LEARNER CONTENT. The loader reads ids, timestamps, statuses and the AI gateway's figures (plane-boundary.ts).

export async function GET(req: Request) {
  const ctx = await hqApiGate(["hq.scholar.analytics.view"]);
  if (isHqRefusal(ctx)) return ctx;
  const s = new URL(req.url).searchParams;
  const p = (k: string) => s.get(k);
  const r = await buildDashboard(ctx.admin, { userId: ctx.userId, fullName: ctx.fullName, isOwner: ctx.isOwner, capabilities: ctx.capabilities },
    { range: p("range"), from: p("from"), to: p("to"), named: p("named"), include: p("include"), q: p("q"), sort: p("sort"), page: p("page"), learner: p("learner") });
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
