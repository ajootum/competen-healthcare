import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { proposalGetService, proposalPostService } from "@/lib/individual/scholar/plan-service";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// GET  /api/individual/scholar/plan/proposal?materialId=  the proposal (sequence, workload, sessions, revision points), the current decision, and whether a plan exists.
// POST /api/individual/scholar/plan/proposal { materialId, decision: accepted | declined | deferred }  keeps the answer (a plan event, migration 840). Learning never waits for it.
// OWN ROWS ONLY (the guard's user id, never a body field), experience "scholar" only. NO AI. The logic and its limits are in plan-service.ts.

const json = (r: { status: number; body: Record<string, unknown> }) => NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  return json(await proposalGetService(ctx, new URL(req.url).searchParams.get("materialId"), req.headers));
}

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  return json(await proposalPostService(ctx, body, req.headers));
}
