import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { entriesListService, entryCreateService } from "@/lib/individual/scholar/plan-service";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// GET  /api/individual/scholar/plan/entries?from=&to=&includeCancelled=  the learner's own calendar occurrences in a range (at most 400 days, within 3 years of today).
// POST /api/individual/scholar/plan/entries { entryType, title, description?, entryDate, startTime?, endTime?, durationMinutes?, link?, recurrence? } creates one entry (a series).
// OWN ROWS ONLY (the guard's user id, never a body field), experience "scholar" only. NO AI. The logic and its limits are in plan-service.ts.

const json = (r: { status: number; body: Record<string, unknown> }) => NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const q = new URL(req.url).searchParams;
  return json(await entriesListService(ctx, { from: q.get("from") ?? undefined, to: q.get("to") ?? undefined, includeCancelled: q.get("includeCancelled") ?? undefined }, req.headers));
}

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  return json(await entryCreateService(ctx, body, req.headers));
}
