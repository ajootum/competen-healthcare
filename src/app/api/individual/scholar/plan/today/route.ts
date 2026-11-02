import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { todayService } from "@/lib/individual/scholar/plan-service";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// GET /api/individual/scholar/plan/today -- PLP-01..04. The one next activity (why / why now / if postponed), two alternatives, cards due, the monthly
// review coming, and notes (each automatic change with an undo token).
// OWN ROWS ONLY (the guard's user id, never a body field), experience "scholar" only. NO AI. The logic and its limits are in plan-service.ts.

const json = (r: { status: number; body: Record<string, unknown> }) => NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  return json(await todayService(ctx, req.headers));
}
