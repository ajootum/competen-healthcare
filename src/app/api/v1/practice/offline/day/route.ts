import { NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { offlineDayPayload } from "@/lib/practice/offline-day";
import { offlineCacheGate } from "@/lib/practice/offline-gate";

// GET /api/v1/practice/offline/day -- CP-OFFLINE-SURVEY-001 s3.3, phase one's one new endpoint.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// IT IS A PROJECTION OF THE DASHBOARD, NOT A SECOND ANSWER TO IT.
//
// The route handler for /api/v1/practice/dashboard says in its own comment that it exists "for the OTHER
// consumers the spec anticipates -- s12's polling fallback, a mobile surface, and the eventual
// event-driven refresh". An offline cache is one of those consumers, and this route is that consumer
// asking the SAME assembler and then throwing nine tenths of the answer away.
//
// ⚠ WHY IT IS NOT SIMPLY /dashboard WITH A QUERY PARAMETER. Because what leaves the server is the whole
// point. The dashboard payload carries dates of birth (through the patient records its cards reach),
// phone numbers, free-text reasons and twelve management metrics. s3.8.1 requires the cache to hold none
// of them -- and a field dropped in the browser has still crossed the wire and still sat in the browser's
// HTTP cache. This route hands over the eight fields per patient that s3.8.1 allows and nothing else.
//
// ── THE CAPABILITY IS THE EXISTING ONE ──────────────────────────────────────────────────────────────
//
// `practice.home.view`, exactly as /practice/today and GET /dashboard. s8: "For phase one: introduce no
// new capability code" -- offline is the same read by the same user. The cohort read additionally
// requires `practice.calendar.view` and reports itself unavailable without it, rather than 403-ing a
// caller who is entitled to the rest of the day.
//
// ⚠ THE FLAG IS NOT SEEDED YET, AND THAT IS THE CORRECT STATE ON DAY ONE. `practice_offline_cache` has no
// row in plat_feature_flags, so `flagState` answers `unresolved / no_such_flag` and this route withholds.
// The migration that seeds it is described in the build report and is NOT written here. Until it exists,
// this endpoint is honestly switched off for everybody and says which switch did it.
//
// NO-STORE, EXPLICITLY. This response names patients. It must never sit in a browser HTTP cache, a proxy
// or a CDN -- the only place it is allowed to persist is the IndexedDB store, which can be labelled with
// its age, expired and purged. A copy in the HTTP cache can be none of those things.

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, private" };

export async function GET() {
  const auth = await requirePracticeContext("practice.home.view");
  if (isDenied(auth)) return auth;

  const gate = await offlineCacheGate(auth.caller.admin, auth.ctx, auth.caller.userId);

  // ⚠ 200 WITH A DECISION, NOT 403. `purge` is an INSTRUCTION the client has to receive and act on: a
  // practice that has switched offline access off needs the day already on the device removed, and a
  // client that got a bare 403 would have no reason to delete anything. The three states travel with it
  // so the browser can tell "somebody switched this off" from "we could not tell", and purge only for
  // the first.
  if (!gate.allowed)
    return NextResponse.json({
      gate: { state: gate.state, reason: gate.reason, purge: gate.purge, decidedBy: gate.decidedBy },
      day: null, correlationId: auth.caller.traceId,
    }, { headers: NO_STORE });

  const result = await offlineDayPayload(auth.caller.admin, auth.ctx);
  if (!result.ok)
    return NextResponse.json({
      // Not a purge. A day that could not be READ is not a decision to stop holding the one already
      // stored -- that day still expires on its own at the end of the clinic day.
      gate: { state: "unresolved" as const, reason: result.reason, purge: false, decidedBy: "allowed" as const },
      day: null, correlationId: auth.caller.traceId,
    }, { headers: NO_STORE });

  return NextResponse.json({
    gate: { state: gate.state, reason: gate.reason, purge: false, decidedBy: gate.decidedBy },
    day: result.day, correlationId: auth.caller.traceId,
  }, { headers: NO_STORE });
}
