import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { loadPlatformOperations } from "@/lib/platform/operations";

// POS-001 standardized operations API. Serves the Mission Control widget feed
// from the shared operations service — the single source of truth for platform
// health, alerts, tenants, users, approvals, deployments and jobs. The spec's
// per-widget endpoints (/api/platform/health, /api/alerts/summary, …) are
// consolidated here and sliceable via ?widget=<key>. Super_admin (landlord).
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();

  const ops = await loadPlatformOperations(c.admin as any);
  const widget = new URL(req.url).searchParams.get("widget");
  if (widget) {
    const w = ops.widgets.find(x => x.key === widget);
    if (!w) return NextResponse.json({ error: `Unknown widget "${widget}"` }, { status: 404 });
    return NextResponse.json(w, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(ops, { headers: { "Cache-Control": "no-store" } });
}
