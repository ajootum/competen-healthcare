import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { decisionService } from "@/lib/individual/scholar/plan-service";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/plan/decision
//   { kind: "recommendation_declined", ref, fingerprint? }        do not offer this again until its evidence changes
//   { kind: "topic_postponed", ref: <topic>, until? }              leave the topic out until a date (default tomorrow, at most 90 days)
//   { kind: "auto_adjust", ref: <activity ref>@<day>, status: "undone" }   take back an automatic carry-over
// Each is one append-only plan event (migration 840). 409 without 840.
// OWN ROWS ONLY (the guard's user id, never a body field), experience "scholar" only. NO AI. The logic and its limits are in plan-service.ts.

const json = (r: { status: number; body: Record<string, unknown> }) => NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  return json(await decisionService(ctx, body, req.headers));
}
