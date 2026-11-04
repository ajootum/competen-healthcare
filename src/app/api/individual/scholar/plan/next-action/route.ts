import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { nextActionService } from "@/lib/individual/scholar/next-best-action-data";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/plan/next-action -- SALE-2026-11 R3 / SALE-11 (policy scholar_next_best_action, default off; migration 975).
//   { ref, decision: "accept", date?: "today" | "tomorrow" }   add it to the learner's own calendar, and record the choice
//   { ref, decision: "snooze", days?: 1 | 3 | 7 }                 not offered again until then
//   { ref, decision: "dismiss" }                                  not offered again until its evidence changes
// Each choice is one append-only 840 plan event (kind next_action, 975). The suggestion is recomputed from the caller's OWN records
// (the guard's user id, never a body field), so nothing in the body is written but the choice. 409 without 975. NO AI.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const r = await nextActionService(ctx, body, req.headers);
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "private, no-store" } });
}
