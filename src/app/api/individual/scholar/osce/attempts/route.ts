import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { getOsceStation, startOsceAttempt } from "@/lib/individual/scholar/store";
import { osceGate } from "@/lib/individual/scholar/osce-service";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/osce/attempts -- SCHOLAR-PRACTICE-EXAMS-01 (720). Body { stationId }. A timed practice run
// of one of the caller's own stations begins. The SERVER's clock is the start: the finish is measured from it, never
// from a time the browser sends.
export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const gate = await osceGate(ctx.admin, ctx.userId);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => ({}));
  const station = await getOsceStation(ctx.admin, ctx.userId, body?.stationId);
  if (!station) return NextResponse.json({ error: "That station could not be found." }, { status: 404 });
  const a = await startOsceAttempt(ctx.admin, ctx.userId, station.id);
  if (!a) return NextResponse.json({ error: "The station could not be started just now." }, { status: 500 });
  return NextResponse.json({ attemptId: a.id, startedAt: a.startedAt, durationMinutes: station.durationMinutes, serverNow: new Date().toISOString() });
}
