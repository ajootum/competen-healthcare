import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { computeMetric, listDataFunctions } from "@/lib/config/metric-runtime";

// Metric Calculation Runtime API (NCP-005 runtime). GET without a metric returns the data-function catalogue
// (the real tokens a formula can reference); with ?metric=&hospital=&unit=&roles= it computes that metric's live
// value + RAG for the context, or reports the unresolved tokens. Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const u = new URL(req.url);
  const metric = u.searchParams.get("metric");
  if (!metric) return NextResponse.json({ functions: listDataFunctions() });
  const ctx = {
    tenantId: u.searchParams.get("tenant") || null,
    hospitalId: u.searchParams.get("hospital") || null,
    unitId: u.searchParams.get("unit") || null,
    roles: (u.searchParams.get("roles") || "").split(",").map(s => s.trim()).filter(Boolean),
    userId: null,
  };
  const r = await computeMetric((c as any).admin, metric, ctx);
  return NextResponse.json({ metric, ...r });
}
