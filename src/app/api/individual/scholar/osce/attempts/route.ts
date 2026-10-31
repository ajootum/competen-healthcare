import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { finishOsceAttempt, getOsceStation, openOsceAttempt, startOsceAttempt } from "@/lib/individual/scholar/store";
import { servableOsceStation } from "@/lib/individual/scholar/library-questions";
import { checklistView, osceGate, stationSnapshot } from "@/lib/individual/scholar/osce-service";
import { finishRun, readSnapshot, resumeOf, snapshotOf } from "@/lib/individual/scholar/osce";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/osce/attempts -- SCHOLAR-PRACTICE-EXAMS-01 (720), SCHOLAR-OSCE-01 (721). Body { stationId }.
// A timed practice run of one of the caller's own stations begins. The SERVER's clock is the start: the finish is
// measured from it, never from a time the browser sends.
//
// INTERRUPTION RECOVERY (SCHOLAR-OSCE-01 s7). If the caller already has an open run of this station (left by navigation,
// a reload or a dropped connection), that run is RESUMED, never restarted: its start, its autosaved writing and the time
// left on the server clock come back. If its time is already up, it is finished now with what was saved, and the reply
// says so (the learner goes straight to the self-check). Written work is never thrown away.
//
// A new run keeps the exact station it will be marked against (721 station_version + station_snapshot). A governed
// station is started only while its version is still published and clinically approved.
export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const gate = await osceGate(ctx.admin, ctx.userId);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => ({}));
  const station = await getOsceStation(ctx.admin, ctx.userId, body?.stationId);
  if (!station) return NextResponse.json({ error: "That station could not be found." }, { status: 404 });

  const open = await openOsceAttempt(ctx.admin, ctx.userId, station.id);
  if (open) {
    const snap = readSnapshot(open.snapshot, stationSnapshot(station));
    const started = Date.parse(open.startedAt);
    const now = Math.max(Date.now(), started);
    const r = resumeOf(started, snap.durationMinutes, now);
    if (r.state === "running") {
      return NextResponse.json({
        attemptId: open.id, startedAt: open.startedAt, durationMinutes: snap.durationMinutes, serverNow: new Date(now).toISOString(),
        responses: open.responses, lastSavedAt: open.lastSavedAt, resumed: true,
      });
    }
    const run = finishRun(started, now, snap.durationMinutes);
    const ok = await finishOsceAttempt(ctx.admin, ctx.userId, open.id, { responses: open.responses, finishedAt: new Date(now).toISOString(), durationSeconds: run.durationSeconds, timeUp: true });
    if (!ok) return NextResponse.json({ error: "Your earlier run could not be closed just now. Your writing is still saved. Try again shortly." }, { status: 500 });
    return NextResponse.json({ attemptId: open.id, resumed: true, finished: true, timeUp: true, responses: open.responses, checklist: checklistView(snap.checklist) });
  }

  if (station.source === "library" && !(station.libraryVersionId && (await servableOsceStation(ctx.admin, station.libraryVersionId))))
    return NextResponse.json({ error: "This station's library version is no longer published, so it cannot be practised again. Choose the current version in the station library." }, { status: 409 });
  const snap = stationSnapshot(station);
  const a = await startOsceAttempt(ctx.admin, ctx.userId, station.id, { version: snap.version, snapshot: snapshotOf(snap) });
  if (!a) return NextResponse.json({ error: "The station could not be started just now." }, { status: 500 });
  return NextResponse.json({ attemptId: a.id, startedAt: a.startedAt, durationMinutes: snap.durationMinutes, serverNow: new Date().toISOString(), responses: {}, resumed: false });
}
