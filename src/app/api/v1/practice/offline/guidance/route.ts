import { NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { offlineGuidancePayload } from "@/lib/practice/offline-guidance-source";
import { offlineCacheGate } from "@/lib/practice/offline-gate";
import { KNOWLEDGE_CAPABILITIES } from "@/lib/practice/knowledge-constants";
import { workspaceClock } from "@/lib/practice/practice-time";

// GET /api/v1/practice/offline/guidance -- CP-OFFLINE-SURVEY-001 s9 item 4.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE SAME GATE AS THE DAY, AND THAT IS THE POINT.
//
// `offlineCacheGate` answers one question -- may anything at all be held on this device -- and it is the
// practice's own switch plus the platform flag, fail-closed. Guidance is not patient data, so there was a
// case for exempting it; it is NOT taken. A practice that says "do not hold my practice's data on that
// laptop" is not making a fine distinction between a schedule and a protocol, and a second switch would
// mean the honest answer to "is anything cached?" became "it depends".
//
// ⚠ THE CAPABILITY IS `document.view`, NOT `practice.home.view`. The day route gates on home.view because
// a clinic day IS the home screen. Guidance is the document library, which migration 210 already gates on
// document.view, and s8 forbids minting a new code. A caller entitled to their day but not to documents
// gets a clean refusal here and keeps their day -- the two caches are independent all the way down.
//
// NO-STORE, EXPLICITLY. Less sensitive than the day (this response names nobody) but it is still the
// practice's own clinical content, and the only place it is allowed to persist is the IndexedDB store,
// which can be labelled with its age, expired and purged. An HTTP cache entry can be none of those.

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, private" };

export async function GET() {
  const auth = await requirePracticeContext(KNOWLEDGE_CAPABILITIES.view);
  if (isDenied(auth)) return auth;

  const gate = await offlineCacheGate(auth.caller.admin, auth.ctx, auth.caller.userId);

  // ⚠ 200 WITH A DECISION, NOT 403 -- the day route's reasoning, unchanged. `purge` is an INSTRUCTION the
  // client must receive and act on: a practice that switched offline access off needs what is already on
  // the device removed, and a bare 403 gives the browser no reason to delete anything.
  if (!gate.allowed)
    return NextResponse.json({
      gate: { state: gate.state, reason: gate.reason, purge: gate.purge, decidedBy: gate.decidedBy },
      library: null, correlationId: auth.caller.traceId,
    }, { headers: NO_STORE });

  // The practice's own clock, from the one helper that owns it. The review-date verdict is computed on
  // the device against THIS zone rather than the device's, so a practitioner who has travelled does not
  // see a protocol flip to overdue a day early.
  const { timezone } = await workspaceClock(auth.caller.admin, auth.ctx.workspaceId);
  const result = await offlineGuidancePayload(auth.caller.admin, auth.ctx, { timezone });

  if (!result.ok)
    return NextResponse.json({
      // Not a purge. Guidance that could not be READ is not a decision to stop holding what is already
      // stored -- that library still expires on its own.
      gate: { state: "unresolved" as const, reason: result.reason, purge: false, decidedBy: "allowed" as const },
      library: null, correlationId: auth.caller.traceId,
    }, { headers: NO_STORE });

  return NextResponse.json({
    gate: { state: gate.state, reason: gate.reason, purge: false, decidedBy: gate.decidedBy },
    library: result.library, correlationId: auth.caller.traceId,
  }, { headers: NO_STORE });
}
