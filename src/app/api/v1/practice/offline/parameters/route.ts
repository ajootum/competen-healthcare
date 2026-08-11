import { NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { offlineParametersPayload } from "@/lib/practice/offline-parameters-source";
import { offlineCacheGate } from "@/lib/practice/offline-gate";
import { CAP_RECORD } from "@/lib/practice/parameters-constants";

// GET /api/v1/practice/offline/parameters -- the definitions a device needs in order to record anything.
//
// ⚠ THE SAME GATE AS THE OTHER THREE, EVEN THOUGH THIS PAYLOAD NAMES NOBODY. A practice that switched
// offline access off has said "hold nothing of mine on that device", and a picker of their configured
// measurements is still theirs. More practically: with the gate off there is nothing to record against
// anyway, because the day and the patients are gone too.
//
// ⚠ AND ITS PURGE INSTRUCTION IS HONOURED FOR THE SAME REASON THE OTHERS' ARE -- a bare 403 gives the
// browser no reason to delete what it already holds.

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, private" };

export async function GET() {
  const auth = await requirePracticeContext(CAP_RECORD);
  if (isDenied(auth)) return auth;

  const gate = await offlineCacheGate(auth.caller.admin, auth.ctx, auth.caller.userId);

  if (!gate.allowed)
    return NextResponse.json({
      gate: { state: gate.state, reason: gate.reason, purge: gate.purge, decidedBy: gate.decidedBy },
      set: null, correlationId: auth.caller.traceId,
    }, { headers: NO_STORE });

  const result = await offlineParametersPayload(auth.caller.admin, auth.ctx);

  if (!result.ok)
    return NextResponse.json({
      gate: { state: "unresolved" as const, reason: result.reason, purge: false, decidedBy: "allowed" as const },
      set: null, correlationId: auth.caller.traceId,
    }, { headers: NO_STORE });

  return NextResponse.json({
    gate: { state: gate.state, reason: gate.reason, purge: false, decidedBy: gate.decidedBy },
    set: result.set, correlationId: auth.caller.traceId,
  }, { headers: NO_STORE });
}
